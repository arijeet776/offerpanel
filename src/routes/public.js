const express = require('express');
const { sb, fetchAll } = require('../db');
const { rateLimit } = require('../auth');
const U = require('../util');
const { ah, HttpError } = U;

const router = express.Router();
const BASE = () => (process.env.PUBLIC_BASE_URL || (process.env.FRONTEND_URL || '').split(',')[0] || '').trim().replace(/\/+$/, '');
const MIN_WITHDRAWAL = () => Number(process.env.MIN_WITHDRAWAL) > 0 ? Number(process.env.MIN_WITHDRAWAL) : 50;

// Campaign IDs are stored in capitals; links may be typed in any case.
async function getCampaign(cid) {
  const id = String(cid || '').trim().toUpperCase();
  if (!id) return null;
  const { data, error } = await sb.from('campaigns').select('*').eq('campaign_id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- Prelander ----------
// Details the offer page collects. UPI ID is always collected.
// collect_fields NULL = campaign made before the per-campaign setting existed: Name + UPI + its old extras.
function fieldsOf(c) {
  const list = s => String(s || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (c.collect_fields == null) return ['NAME', ...list(c.extra_fields_required)];
  return list(c.collect_fields).filter(f => ['NAME', 'MOBILE', 'GMAIL'].includes(f));
}

// Google reCAPTCHA (v2 checkbox). Skipped while RECAPTCHA_SECRET is not set; once it is set, every offer-page submit needs a valid tick.
async function verifyCaptcha(token, ip) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return;
  if (!token) throw new HttpError(400, 'Please tick "I\'m not a robot" first.');
  let ok = false;
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: String(token).slice(0, 4096), remoteip: ip || '' }), signal: AbortSignal.timeout(8000)
    });
    ok = !!(await r.json()).success;
  } catch (e) { console.error('[captcha] could not reach Google:', e.message); throw new HttpError(503, 'Could not verify you right now. Please try again in a moment.'); }
  if (!ok) throw new HttpError(400, 'Verification failed. Please tick "I\'m not a robot" again.');
}

router.get('/campaign-info', ah(async (req, res) => {
  const ref = U.clean(req.query.ref).toUpperCase() || 'DIRECT';
  const c = await getCampaign(U.clean(req.query.cid));
  if (!c) throw new HttpError(404, 'Offer not found.');
  res.json({
    success: true,
    name: c.campaign_name,
    logo: c.logo_url || '',
    status: String(c.status || 'ACTIVE').toUpperCase(),
    userPayout: await U.userPayoutFor(sb, c, ref),
    notes: c.notes || '',
    fields: fieldsOf(c),
    captchaSiteKey: process.env.RECAPTCHA_SITE_KEY || ''
  });
}));

router.post('/prelander', rateLimit(30, 10 * 60e3), ah(async (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.name);
  const upi = U.clean(b.upi).toLowerCase();
  let ref = U.clean(b.ref).toUpperCase() || 'DIRECT';
  const mobile = U.clean(b.mobile);
  const gmail = U.clean(b.gmail).toLowerCase();

  if (!upi) throw new HttpError(400, 'Please enter your UPI ID.');
  if (!U.isValidUpi(upi)) throw new HttpError(400, 'Please enter a valid UPI ID.');

  const c = await getCampaign(U.clean(b.cid));
  if (!c) throw new HttpError(404, 'Offer not found.');
  const cid = c.campaign_id;
  if (String(c.status).toUpperCase() !== 'ACTIVE') throw new HttpError(400, 'This offer is currently paused or inactive.');
  if (!c.affiliate_link) throw new HttpError(400, 'Offer link not configured.');
  await verifyCaptcha(b.captcha, U.clientIp(req));

  // The partner id in the link must be a real, active partner; otherwise the visit counts as direct. Partners cannot use their own link.
  if (ref !== 'DIRECT') {
    const { data: rr } = await sb.from('referrers').select('ref_id,upi,status').eq('ref_id', ref).maybeSingle();
    if (!rr || String(rr.status || '').toUpperCase() !== 'ACTIVE') ref = 'DIRECT';
    else if (String(rr.upi || '').toLowerCase() === upi) throw new HttpError(400, 'You cannot use your own partner link. Please open the offer from a different link.');
  }

  const req_f = fieldsOf(c);
  if (req_f.includes('NAME') && !name) throw new HttpError(400, 'Please enter your Name.');
  if (req_f.includes('MOBILE') && !/^\+?\d{10,14}$/.test(mobile.replace(/\s+/g, ''))) throw new HttpError(400, 'Please enter a valid Mobile Number.');
  if (req_f.includes('GMAIL') && !U.isEmail(gmail)) throw new HttpError(400, 'Please enter a valid Gmail ID.');

  // Max conversions per UPI
  const max = Number(c.max_conversions_per_upi);
  if (max > 0) {
    const { count } = await sb.from('conversions').select('*', { count: 'exact', head: true })
      .eq('campaign_id', cid).ilike('upi', U.likeEscape(upi));
    if ((count || 0) >= max) throw new HttpError(400, 'This UPI ID has already completed this offer.');
  }

  const clickId = 'CLK' + Date.now() + Math.floor(Math.random() * 900 + 100);
  const ua = String(req.headers['user-agent'] || '');
  const { error } = await sb.from('clicks').insert({
    click_id: clickId, campaign_id: cid, ref_id: ref, name: (req_f.includes('NAME') && name) || null, upi,
    ip_address: U.clientIp(req, true), device_type: /mobile|android|iphone/i.test(ua) ? 'Mobile' : 'Web',
    mobile: (req_f.includes('MOBILE') && mobile) || null, gmail: (req_f.includes('GMAIL') && gmail) || null
  });
  if (error) throw error;

  res.json({ success: true, clickId, redirectUrl: U.buildRedirect(c.affiliate_link, U.macroList(c), clickId) });
}));

// ---------- Link generator ----------
router.get('/campaigns/active', ah(async (req, res) => {
  const rows = await fetchAll('campaigns', 'campaign_id,campaign_name,total_payout,user_default_payout,instructions',
    q => q.eq('status', 'ACTIVE').order('created_at'));
  res.json({ success: true, campaigns: rows });
}));

async function findOrCreateReferrer(upi, mobile) {
  const find = async () => (await sb.from('referrers').select('*').ilike('upi', U.likeEscape(upi)).maybeSingle()).data;
  let r = await find();
  for (let i = 0; !r && i < 6; i++) { // a new ID can (very rarely) clash with an existing one: just draw another
    const { error } = await sb.from('referrers').insert({ ref_id: U.genRefId(), upi, mobile, status: 'ACTIVE' });
    if (error && error.code !== '23505') throw error;
    r = await find();
  }
  if (!r) throw new HttpError(503, 'Could not create your referral account. Please try again.');
  // An account made before mobile numbers were collected gets the first valid mobile number given for it.
  if (r && !U.normMobile(r.mobile)) {
    const { error } = await sb.from('referrers').update({ mobile }).eq('ref_id', r.ref_id);
    if (error) throw error;
    r.mobile = mobile;
  }
  return r;
}

router.post('/links/generate', rateLimit(30, 10 * 60e3), ah(async (req, res) => {
  const b = req.body || {};
  const upi = U.clean(b.upi).toLowerCase();
  if (!upi || !U.clean(b.mobile) || !b.campaignId) throw new HttpError(400, 'Please fill UPI, Mobile Number, and select a campaign.');
  if (!U.isValidUpi(upi)) throw new HttpError(400, 'Please enter a valid UPI ID.');
  const mobile = U.normMobile(b.mobile);
  if (!mobile) throw new HttpError(400, 'Please enter a valid 10-digit Mobile Number.');

  const c = await getCampaign(U.clean(b.campaignId));
  if (!c) throw new HttpError(404, 'Campaign not found.');
  if (String(c.status).toUpperCase() !== 'ACTIVE') throw new HttpError(400, 'Campaign is currently paused or inactive.');

  const ref = await findOrCreateReferrer(upi, mobile);
  if (!ref || String(ref.status).toUpperCase() !== 'ACTIVE') throw new HttpError(403, 'This UPI is not active for referrals.');
  if (U.normMobile(ref.mobile) !== mobile) throw new HttpError(403, 'This UPI is registered with a different Mobile Number. Please enter the Mobile Number you used before.');

  const { data: existing } = await sb.from('generated_links').select('*')
    .eq('ref_id', ref.ref_id).eq('campaign_id', c.campaign_id).eq('links_status', 'ACTIVE').order('created_at');
  const multiple = String(c.multiple_allowed).toUpperCase() === 'YES';
  if (!multiple && existing && existing.length) {
    const e = existing[0];
    return res.json({ success: true, isExisting: true, generatedLink: e.generated_link, userPayout: e.user_payout, referralAmount: e.referrer_margin });
  }
  if (multiple && Number(c.max_conversions_per_upi) > 0 && existing.length >= Number(c.max_conversions_per_upi))
    throw new HttpError(400, 'Maximum link limit (' + c.max_conversions_per_upi + ') reached for this campaign.');

  const total = Number(c.total_payout) || 0;
  const user = b.customUserPayout === undefined || b.customUserPayout === '' ? (Number(c.user_default_payout) || total) : U.num(b.customUserPayout, NaN);
  if (!Number.isFinite(user) || user < 0 || user > total) throw new HttpError(400, 'Invalid split: user amount must be between 0 and ' + total + '.');
  const margin = total - user;

  // https://offers.digisanchaar.online/<campaign id>/<referral id>
  const link = BASE() + '/' + encodeURIComponent(c.campaign_id) + '/' + encodeURIComponent(ref.ref_id);
  const { error } = await sb.from('generated_links').insert({
    link_id: U.genId('LNK'), ref_id: ref.ref_id, upi: ref.upi, campaign_id: c.campaign_id, campaign_name: c.campaign_name,
    total_payout: total, user_payout: user, referrer_margin: margin, generated_link: link, links_status: 'ACTIVE'
  });
  if (error) throw error;
  res.json({ success: true, isExisting: false, generatedLink: link, userPayout: user, referralAmount: margin });
}));

// ---------- Partner dashboard + wallet ----------
// Centre of the UPI handle is hidden: rahulkumar@okaxis -> ra******ar@okaxis. Partners never receive a full user UPI.
function maskUpi(u) {
  const [h, ...rest] = String(u || '').split('@');
  const bank = rest.length ? '@' + rest.join('@') : '';
  const keep = h.length <= 2 ? 1 : h.length <= 4 ? 1 : 2;
  const tail = h.length <= 2 ? 0 : keep;
  return h.slice(0, keep) + '*'.repeat(Math.max(2, h.length - keep - tail)) + (tail ? h.slice(-tail) : '') + bank;
}

// Mobile Number AND UPI must both match.
async function authPartner(body) {
  const upi = U.clean(body && body.upi);
  if (!upi || !U.clean(body && body.mobile)) throw new HttpError(400, 'Please enter both your Mobile Number and UPI ID.');
  const mobile = U.normMobile(body.mobile);
  if (!mobile) throw new HttpError(400, 'Please enter a valid 10-digit Mobile Number.');
  const { data: ref } = await sb.from('referrers').select('ref_id,name,upi,mobile,status').ilike('upi', U.likeEscape(upi)).maybeSingle();
  if (!ref || String(ref.status).toUpperCase() !== 'ACTIVE') throw new HttpError(401, 'No referral account found. Please check your Mobile Number and UPI.');
  const stored = U.normMobile(ref.mobile);
  if (!stored) { // account made before mobile numbers were collected: the first login saves the mobile number
    const { error } = await sb.from('referrers').update({ mobile }).eq('ref_id', ref.ref_id);
    if (error) throw error;
    ref.mobile = mobile;
  } else if (stored !== mobile) throw new HttpError(401, 'No referral account found. Please check your Mobile Number and UPI.');
  return ref;
}

// Clicks per campaign for one partner: counted by the database. Falls back to counting rows if the SQL function is not installed yet.
async function clicksPerCampaign(refId) {
  const out = {};
  const r = await sb.rpc('partner_clicks', { p_ref: refId });
  if (!r.error) { (r.data || []).forEach(x => { out[x.campaign_id] = Number(x.click_count) || 0; }); return out; }
  const rows = await fetchAll('clicks', 'click_id,campaign_id', q => q.eq('ref_id', refId).order('click_id'));
  rows.forEach(c => { out[c.campaign_id] = (out[c.campaign_id] || 0) + 1; });
  return out;
}
// Mobile number of each lead sits on its click row: read only the clicks that belong to the leads being shown.
async function mobilesFor(clickIds) {
  const out = {}, ids = [...new Set(clickIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000), chunks = [];
    for (let j = 0; j < part.length; j += 200) chunks.push(part.slice(j, j + 200));
    const rs = await Promise.all(chunks.map(ch => sb.from('clicks').select('click_id,mobile').in('click_id', ch)));
    rs.forEach(r => (r.data || []).forEach(k => { if (k.mobile) out[k.click_id] = k.mobile; }));
  }
  return out;
}

router.post('/partner/login', rateLimit(15, 10 * 60e3), ah(async (req, res) => {
  const ref = await authPartner(req.body);

  const [links, leads, camps, ledger, wds, pays, archived, clickCounts] = await Promise.all([
    fetchAll('generated_links', 'campaign_id,campaign_name,generated_link,user_payout,referrer_margin', q => q.eq('ref_id', ref.ref_id).order('created_at')),
    fetchAll('conversions', 'id,created_at,click_id,upi,campaign,campaign_id,ref_status,ref_payout,user_status,user_payout,events,goal,goal2,goal3,goal_at,goal2_at,goal3_at',
      q => q.eq('ref_id', ref.ref_id).order('created_at', { ascending: false }).order('id')),
    fetchAll('campaigns', 'campaign_id,campaign_name,instructions', q => q.eq('status', 'ACTIVE')),
    fetchAll('wallet_ledger', 'id,created_at,entry_type,reason,amount,campaign_name,note', q => q.eq('ref_id', ref.ref_id).order('id', { ascending: false })),
    fetchAll('withdrawals', 'withdrawal_id,created_at,amount,status,txn_id,admin_note,processed_at', q => q.eq('ref_id', ref.ref_id).order('created_at', { ascending: false })),
    // cashback the admin has paid out to the users who came through this partner's links
    fetchAll('payments', 'conversion_id,amount,created_at', q => q.eq('ref_id', ref.ref_id).eq('pay_type', 'USER').order('created_at', { ascending: false })),
    // summaries of campaigns the admin deleted (totals only, no user details). Empty until the table exists.
    fetchAll('campaign_archive', 'campaign_id,campaign_name,clicks,leads,commission,disbursed,deleted_at', q => q.eq('ref_id', ref.ref_id).order('id', { ascending: false })).catch(() => []),
    clicksPerCampaign(ref.ref_id)
  ]);
  const clickMap = clickCounts, mobileOf = await mobilesFor(leads.map(l => l.click_id));
  const paidBy = {}, paidAt = {};
  pays.forEach(p => {
    paidBy[p.conversion_id] = (paidBy[p.conversion_id] || 0) + (Number(p.amount) || 0);
    if (!paidAt[p.conversion_id] || p.created_at > paidAt[p.conversion_id]) paidAt[p.conversion_id] = p.created_at;
  });

  const sum = (rows, f) => rows.filter(f).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const wallet = {
    balance: sum(ledger, l => l.entry_type === 'CREDIT') - sum(ledger, l => l.entry_type === 'DEBIT'),
    earned: sum(ledger, l => l.reason === 'CONVERSION') - sum(ledger, l => l.reason === 'REVERSAL'),
    withdrawn: sum(wds, w => w.status === 'PAID'),
    pending: sum(wds, w => w.status === 'PENDING'),
    min: MIN_WITHDRAWAL()
  };

  res.json({
    success: true,
    referrer: { ref_id: ref.ref_id, mobile: U.maskMobile(ref.mobile), upi: ref.upi },
    campaigns: camps,
    links: links.map(l => ({ ...l, clicks: clickMap[l.campaign_id] || 0 })),
    // Everything about the referred user is masked here, so the partner never sees a full number or UPI.
    leads: leads.map(l => ({
      id: l.id, created_at: l.created_at, campaign_id: l.campaign_id, campaign: l.campaign || l.campaign_id,
      mobile: U.maskMobile(mobileOf[l.click_id]), upi: maskUpi(l.upi),
      ref_status: l.ref_status, ref_payout: Number(l.ref_payout) || 0,
      user_status: l.user_status, user_payout: Number(l.user_payout) || 0, paid: paidBy[l.id] || 0, paid_at: paidAt[l.id] || null,
      events: U.convEvents(l).map(e => ({ name: e.name, at: e.at }))
    })),
    wallet,
    disbursed: Object.values(paidBy).reduce((t, n) => t + n, 0),
    archived: archived.map(r => ({ ...r, commission: Number(r.commission) || 0, disbursed: Number(r.disbursed) || 0 })),
    history: ledger.slice(0, 1000),
    withdrawals: wds.slice(0, 1000)
  });
}));

// Money is always paid to the UPI registered on the account, so nobody can redirect a payout.
router.post('/partner/withdraw', rateLimit(10, 10 * 60e3), ah(async (req, res) => {
  const ref = await authPartner(req.body);
  const amount = Math.round(U.num(req.body && req.body.amount, NaN) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Please enter a valid amount.');
  const { data, error } = await sb.rpc('request_withdrawal', { p_ref: ref.ref_id, p_amount: amount, p_min: MIN_WITHDRAWAL() });
  if (error) throw error;
  if (!data || !data.ok) throw new HttpError(400, (data && data.error) || 'Could not create the withdrawal request.');
  res.json({ success: true, message: 'Withdrawal request sent. It will be paid to your registered UPI ID.', withdrawalId: data.withdrawalId });
}));


// ---------- Offer status tracker (replaces the old Google Apps Script tracker) ----------
// A user types the UPI ID they used on the offer page. Every attempt (click) is matched to its lead by the
// exact click id, so no guessing by dates or spellings. Only the user's own progress and their own cashback payout
// are returned: no mobile / gmail, no partner or wallet data.
async function trackerAttempts(upiRaw, cidRaw, limit) {
  const upi = U.clean(upiRaw).toLowerCase();
  if (!upi || upi.length > 100) throw new HttpError(400, 'Please enter a valid UPI ID.');
  const cid = U.clean(cidRaw).toUpperCase();

  let q = sb.from('clicks').select('click_id,campaign_id,ref_id,name,created_at').eq('upi', upi); // UPIs are stored in lower case
  if (cid) q = q.eq('campaign_id', cid);
  const { data: clicks, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  if (!clicks.length) return [];

  const clickIds = clicks.map(c => c.click_id);
  const campIds = [...new Set(clicks.map(c => c.campaign_id))];
  const [convRes, campRes] = await Promise.all([
    sb.from('conversions').select('id,click_id,user_payout,events,goal,goal2,goal3,goal_at,goal2_at,goal3_at,user_status,final_status').in('click_id', clickIds),
    sb.from('campaigns').select('*').in('campaign_id', campIds)
  ]);
  if (convRes.error) throw convRes.error;
  if (campRes.error) throw campRes.error;
  const convBy = Object.fromEntries(convRes.data.map(c => [c.click_id, c]));
  const campBy = Object.fromEntries(campRes.data.map(c => [c.campaign_id, c]));

  // cashback already paid out to this user, per lead
  const leadIds = convRes.data.map(c => c.id);
  const paidBy = {};
  if (leadIds.length) {
    const { data: pays, error: pe } = await sb.from('payments').select('conversion_id,amount').eq('pay_type', 'USER').in('conversion_id', leadIds);
    if (pe) throw pe;
    (pays || []).forEach(p => { paidBy[p.conversion_id] = (paidBy[p.conversion_id] || 0) + (Number(p.amount) || 0); });
  }
  const expected = {}; // payout a user will get before any lead exists (same number the offer page showed)
  const expectedFor = (camp, ref) => { const k = camp.campaign_id + '|' + (ref || ''); return expected[k] || (expected[k] = U.userPayoutFor(sb, camp, ref)); };

  return Promise.all(clicks.map(async k => {
    const camp = campBy[k.campaign_id];
    const lead = convBy[k.click_id];
    const evs = camp ? U.campEvents(camp) : [];
    const done = lead ? U.convEvents(lead) : [];
    const doneNos = new Set(done.map(e => e.no));
    const userSt = lead ? String(lead.user_status || '').toUpperCase() : '';
    const rejected = userSt === 'REJECTED' || String(lead ? lead.final_status : '').toUpperCase().includes('REJECT');
    const paid = userSt === 'PAID';

    const goalsList = evs.map((e, i) => ({
      goalName: e.name,
      status: doneNos.has(i + 1) ? 'SUCCESSFUL' : rejected ? 'REJECTED' : 'PENDING'
    }));
    // Cashback is only "successful" once the admin has actually paid the user.
    goalsList.push({ goalName: 'Cashback Payout', status: paid ? 'SUCCESSFUL' : rejected ? 'REJECTED' : 'PENDING' });

    const allDone = evs.length > 0 && evs.every((_, i) => doneNos.has(i + 1));
    const overallStatus = paid ? 'PAID' : rejected ? 'REJECTED' : allDone ? 'SUCCESSFUL' : 'PENDING';
    const last = done.map(e => e.at).filter(Boolean).sort().pop() || null;
    // what the user earns: the payout once its event arrived, otherwise what the offer page promised
    const got = lead ? Number(lead.user_payout) || 0 : 0;
    const amount = got > 0 ? got : camp ? await expectedFor(camp, k.ref_id) : 0;

    return {
      name: k.name || 'User',
      campaignId: k.campaign_id,
      campaign: camp ? camp.campaign_name : k.campaign_id,
      clickAt: k.created_at,
      updatedAt: last,
      overallStatus,
      goalsList,
      // the admin's payment status decides this: PAID -> SUCCESSFUL, otherwise PENDING (or REJECTED)
      payout: { amount, paid: lead ? paidBy[lead.id] || 0 : 0, status: paid ? 'SUCCESSFUL' : rejected ? 'REJECTED' : 'PENDING' }
    };
  }));
}

router.post('/tracker/status', rateLimit(30, 10 * 60e3), ah(async (req, res) => {
  const b = req.body || {};
  const [a] = await trackerAttempts(b.upi, b.cid, 1);
  if (!a) return res.json({ success: true, found: false });
  res.json({ success: true, found: true, ...a });
}));

router.post('/tracker/history', rateLimit(30, 10 * 60e3), ah(async (req, res) => {
  // History spans every campaign this UPI has tried (newest first, latest 50).
  const attempts = await trackerAttempts(req.body && req.body.upi, '', 50);
  res.json({ success: true, found: attempts.length > 0, attempts });
}));

module.exports = router;
