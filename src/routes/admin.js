const express = require('express');
const { sb, fetchAll } = require('../db');
const { sign, safeEq, requireAdmin, rateLimit } = require('../auth');
const sheets = require('../sheets');
const U = require('../util');
const { ah, HttpError } = U;

const router = express.Router();
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

// ---------- Login ----------
router.post('/login', rateLimit(10, 10 * 60e3), ah(async (req, res) => {
  const { name, company, password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_TOKEN_SECRET) throw new HttpError(500, 'Server is missing ADMIN_PASSWORD / ADMIN_TOKEN_SECRET.');
  if (!safeEq(password || '', process.env.ADMIN_PASSWORD)) throw new HttpError(401, 'Invalid login details.');
  const { data } = await sb.from('admin_users').select('company_name');
  const allowed = (data || []).map(r => norm(r.company_name));
  if (!allowed.length && process.env.ADMIN_COMPANY_NAME) allowed.push(norm(process.env.ADMIN_COMPANY_NAME));
  if (!allowed.includes(norm(company))) throw new HttpError(401, 'Invalid login details.');
  const display = U.clean(company);
  res.json({ success: true, token: sign({ name: U.clean(name) || 'Admin', company: display }), name: U.clean(name) || 'Admin', company: display });
}));

router.use(requireAdmin);

// Mobile / Gmail of each lead live on its click row; read them in small batches.
async function clickInfo(ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 200) chunks.push(uniq.slice(i, i + 200));
  try {
    for (let i = 0; i < chunks.length; i += 5) {
      const rs = await Promise.all(chunks.slice(i, i + 5).map(ch => sb.from('clicks').select('click_id,mobile,gmail').in('click_id', ch)));
      rs.forEach(r => (r.data || []).forEach(k => { out[k.click_id] = k; }));
    }
  } catch (e) { console.error('[admin] click details lookup failed:', e.message); }
  return out;
}

// ---------- All data ----------
router.get('/data', ah(async (req, res) => {
  const [campaigns, referrers, links, conversions, payments, withdrawals] = await Promise.all([
    fetchAll('campaigns', '*', q => q.neq('status', 'DELETED').order('created_at').order('campaign_id')),
    fetchAll('referrers', 'ref_id,name,upi,mobile', q => q.order('ref_id')),
    fetchAll('generated_links', '*', q => q.order('created_at', { ascending: false }).order('link_id')),
    fetchAll('conversions', 'id,click_id,upi,name,status,campaign,goal,ref_id,user_status,ref_status,final_status,created_at,network_click_id,campaign_id,goal2,goal3,user_payout,ref_payout,user_note,ref_note,goal_at,goal2_at,goal3_at,events', q => q.order('created_at', { ascending: false }).order('id')),
    fetchAll('payments', '*', q => q.order('created_at', { ascending: false }).order('payment_id')),
    fetchAll('withdrawals', '*', q => q.order('created_at', { ascending: false }).order('withdrawal_id'))
  ]);
  const rm = Object.fromEntries(referrers.map(r => [r.ref_id, r]));
  const ci = await clickInfo(conversions.map(c => c.click_id)); // mobile / gmail the user gave on the offer page
  res.json({
    success: true, campaigns: campaigns.map(c => ({ ...c, events: U.campEvents(c) })), payments,
    withdrawals: withdrawals.map(w => ({ ...w, ref_name: (rm[w.ref_id] || {}).name || w.name || '', ref_mobile: (rm[w.ref_id] || {}).mobile || '' })),
    links: links.map(l => ({ ...l, ref_name: (rm[l.ref_id] || {}).name || '', ref_mobile: (rm[l.ref_id] || {}).mobile || '' })),
    conversions: conversions.map(c => ({
      ...c, events: U.convEvents(c), ref_name: (rm[c.ref_id] || {}).name || '', ref_mobile: (rm[c.ref_id] || {}).mobile || '', ref_upi: (rm[c.ref_id] || {}).upi || '',
      mobile: (ci[c.click_id] || {}).mobile || '', gmail: (ci[c.click_id] || {}).gmail || ''
    }))
  });
}));

// ---------- Click report (latest 5000 clicks, newest first) ----------
router.get('/reports/clicks', ah(async (req, res) => {
  const LIMIT = 5000;
  const { count } = await sb.from('clicks').select('*', { count: 'exact', head: true });
  const rows = [];
  for (let from = 0; from < LIMIT; from += 1000) {
    const { data, error } = await sb.from('clicks').select('*').order('created_at', { ascending: false }).order('click_id').range(from, Math.min(from + 999, LIMIT - 1));
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const [convs, camps, refs] = await Promise.all([
    fetchAll('conversions', 'click_id,network_click_id,final_status', q => q.order('id')),
    fetchAll('campaigns', 'campaign_id,campaign_name', q => q.order('campaign_id')),
    fetchAll('referrers', 'ref_id,name,mobile', q => q.order('ref_id'))
  ]);
  const cv = Object.fromEntries(convs.map(c => [c.click_id, c]));
  const cn = Object.fromEntries(camps.map(c => [c.campaign_id, c.campaign_name]));
  const rm = Object.fromEntries(refs.map(r => [r.ref_id, r]));
  res.json({
    success: true, total: count || rows.length, shown: rows.length,
    clicks: rows.map(k => ({
      click_id: k.click_id, created_at: k.created_at, campaign_id: k.campaign_id, campaign: cn[k.campaign_id] || k.campaign_id,
      ref_id: k.ref_id, ref_label: (rm[k.ref_id] || {}).mobile || (rm[k.ref_id] || {}).name || '',
      name: k.name || '', upi: k.upi || '', mobile: k.mobile || '', gmail: k.gmail || '', ip_address: k.ip_address || '', device_type: k.device_type || '',
      converted: !!cv[k.click_id], network_click_id: (cv[k.click_id] || {}).network_click_id || '', final_status: (cv[k.click_id] || {}).final_status || ''
    }))
  });
}));

// ---------- Which IP does the server see for a visitor? (admin check) ----------
router.get('/debug/ip', (req, res) => {
  const h = n => req.headers[n] || null;
  res.json({
    success: true, detected: U.clientIp(req, true), usedForRateLimit: U.clientIp(req),
    seen: { 'cf-connecting-ip': h('cf-connecting-ip'), 'true-client-ip': h('true-client-ip'), 'x-forwarded-for': h('x-forwarded-for'), 'req.ip': req.ip },
    clientIpHeaderEnv: process.env.CLIENT_IP_HEADER || null, trustProxyEnv: process.env.TRUST_PROXY || null
  });
});

// ---------- Database viewer (read-only) ----------
const DB_TABLES = {
  campaigns:       { label: 'Campaigns',      order: 'created_at', search: ['campaign_id', 'campaign_name', 'platform', 'status'] },
  referrers:       { label: 'Partners',       order: 'created_at', search: ['ref_id', 'upi', 'mobile', 'name', 'status'] },
  generated_links: { label: 'Referral Links', order: 'created_at', search: ['link_id', 'ref_id', 'upi', 'campaign_name', 'campaign_id'] },
  clicks:          { label: 'Clicks',         order: 'created_at', search: ['click_id', 'upi', 'name', 'mobile', 'gmail', 'ref_id', 'campaign_id', 'ip_address'] },
  conversions:     { label: 'Conversions',    order: 'id',         search: ['click_id', 'network_click_id', 'upi', 'name', 'campaign', 'ref_id', 'final_status'] },
  payments:        { label: 'Payments',       order: 'created_at', search: ['payment_id', 'ref_id', 'upi', 'name', 'transaction_id', 'campaign'] },
  wallet_ledger:   { label: 'Wallet Ledger',  order: 'id',         search: ['ref_id', 'reason', 'campaign_name', 'withdrawal_id', 'note'] },
  withdrawals:     { label: 'Withdrawals',    order: 'created_at', search: ['withdrawal_id', 'ref_id', 'upi', 'name', 'status', 'txn_id'] },
  postback_log:    { label: 'Postback Log',   order: 'id',         search: ['result', 'campaign_id', 'click_id', 'network_click_id', 'event_name'] },
  campaign_archive: { label: 'Deleted Campaign Summary', order: 'id', search: ['campaign_id', 'campaign_name', 'ref_id'] },
  sync_log:        { label: 'Sheets Sync Log', order: 'id',        search: ['table_name', 'status', 'message'] }
};
const SECRET_KEY = /key|secret|token|pass|auth/i;
const redact = v => Array.isArray(v) ? v.map(redact) : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[hidden]' : redact(x)])) : v;
const dbRow = r => {
  const o = { ...r }; delete o.synced_at;
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') o[k] = redact(o[k]);
  return o;
};

router.get('/db/tables', ah(async (req, res) => {
  const keys = Object.keys(DB_TABLES);
  const counts = await Promise.all(keys.map(async k => { const { count } = await sb.from(k).select('*', { count: 'exact', head: true }); return count || 0; }));
  res.json({ success: true, tables: keys.map((k, i) => ({ key: k, label: DB_TABLES[k].label, count: counts[i] })) });
}));

router.get('/db/:table', ah(async (req, res) => {
  const key = req.params.table, t = DB_TABLES[key];
  if (!t) throw new HttpError(404, 'Unknown table.');
  const size = 50, page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const term = String(req.query.q || '').replace(/[,()%*\\"'`]/g, ' ').trim().slice(0, 60);
  let q = sb.from(key).select('*', { count: 'exact' });
  if (term) q = q.or(t.search.map(c => c + '.ilike.%' + term + '%').join(','));
  const { data, count, error } = await q.order(t.order, { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) throw error;
  const rows = (data || []).map(dbRow);
  res.json({ success: true, table: key, label: t.label, count: count || 0, page, pages: Math.max(1, Math.ceil((count || 0) / size)), columns: rows.length ? Object.keys(rows[0]) : [], rows });
}));

// ---------- Analytics ----------
router.get('/analytics', ah(async (req, res) => {
  const [conv, refs, clicksRes] = await Promise.all([
    fetchAll('conversions', 'id,campaign,ref_id,user_payout,ref_payout,user_status,ref_status', q => q.order('id')),
    fetchAll('referrers', 'ref_id,name,mobile', q => q.order('ref_id')),
    sb.from('clicks').select('*', { count: 'exact', head: true })
  ]);
  const rn = Object.fromEntries(refs.map(r => [r.ref_id, r.name || r.mobile]));
  const k = { total: conv.length, success: 0, pending: 0, rejected: 0, clicks: clicksRes.count || 0 };
  const byCampaign = {}, byRef = {};
  conv.forEach(c => {
    // A postback is final, so progress is measured by the user payout: PAID / REJECTED / still waiting
    const f = String(c.user_status || '').toUpperCase();
    if (f === 'PAID') k.success++; else if (f.includes('REJECT')) k.rejected++; else k.pending++;
    byCampaign[c.campaign || 'Unknown'] = (byCampaign[c.campaign || 'Unknown'] || 0) + 1;
    if (c.ref_id && c.ref_id !== 'DIRECT') { const n = rn[c.ref_id] || c.ref_id; byRef[n] = (byRef[n] || 0) + 1; }
  });
  const top = Object.entries(byRef).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const { data: pays } = await sb.from('payments').select('amount');
  k.totalPaid = (pays || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const ledger = await fetchAll('wallet_ledger', 'entry_type,amount', q => q.order('id'));
  k.walletOwed = ledger.reduce((s, l) => s + (l.entry_type === 'CREDIT' ? 1 : -1) * (Number(l.amount) || 0), 0);
  const { count: pw } = await sb.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
  k.pendingWd = pw || 0;
  res.json({ success: true, kpi: k, byCampaign, topReferrers: top });
}));

// ---------- Campaigns ----------
const FIELD_KEYS = ['NAME', 'MOBILE', 'GMAIL']; // details the offer page can ask for (UPI ID is always asked)

// Everything a campaign needs is validated here, once, for both Add and Edit.
function buildCampaign(b) {
  const name = U.clean(b.campaign_name), link = U.clean(b.affiliate_link);
  if (!name) throw new HttpError(400, 'Campaign name is required.');
  if (!/^https?:\/\//i.test(link)) throw new HttpError(400, 'Tracking link must start with http:// or https://');
  const logo = U.clean(b.logo_url);
  if (logo && !/^https?:\/\//i.test(logo)) throw new HttpError(400, 'Logo URL must start with http:// or https://');
  const macros = U.parseMacros(b.click_macro);
  if (!macros) throw new HttpError(400, 'Click ID macro is required: type the parameter name where our Click ID goes (e.g. aff_sub1). Letters, numbers, _ - . only; separate several with commas.');

  // Events: any number (1..MAX_EVENTS). New admin sends b.events = [{name, payout}]; the old goal_name_N/payout_N keys still work.
  let raw = Array.isArray(b.events) ? b.events : null;
  if (!raw) {
    const cnt = Math.min(3, Math.max(1, parseInt(b.total_events, 10) || 1));
    raw = Array.from({ length: cnt }, (_, i) => ({ name: b['goal_name_' + (i + 1)], payout: b['payout_' + (i + 1)] }));
  }
  if (!raw.length) throw new HttpError(400, 'Add at least one event.');
  if (raw.length > U.MAX_EVENTS) throw new HttpError(400, 'A campaign can have at most ' + U.MAX_EVENTS + ' events.');
  const events = raw.map((e, i) => {
    const g = U.clean(e && e.name);
    if (!g) throw new HttpError(400, 'Please enter a name for Event ' + (i + 1) + '.');
    const p = e.payout === '' || e.payout == null ? 0 : U.num(e.payout, NaN);
    if (!Number.isFinite(p) || p < 0) throw new HttpError(400, 'Payout for Event ' + (i + 1) + ' must be 0 or more.');
    return { name: g, payout: Math.round(p * 100) / 100 };
  });
  // The admin picks the ONE event that pays (payout_event, 1-based). Every other event is Rs0: its postback only shows as successful.
  const pe = parseInt(b.payout_event, 10);
  if (Number.isInteger(pe) && pe >= 1 && pe <= events.length) events.forEach((e, i) => { if (i !== pe - 1) e.payout = 0; });
  const n = events.length;
  const used = events.map(e => e.name.toLowerCase());
  if (new Set(used).size !== used.length) throw new HttpError(400, 'Event names must be different from each other.');
  const total = Math.round(events.reduce((s, e) => s + e.payout, 0) * 100) / 100;
  if (total <= 0) throw new HttpError(400, 'Set a payout above 0 on the event that should pay.');
  const at = i => events[i] || { name: '', payout: 0 }; // old columns still hold the first 3 events

  let user = U.num(b.user_default_payout, 0);
  if (user <= 0 || user > total) user = total;
  const want = (Array.isArray(b.collect_fields) ? b.collect_fields : String(b.collect_fields == null ? 'MOBILE' : b.collect_fields).split(',')).map(s => String(s).trim().toUpperCase());
  const fields = FIELD_KEYS.filter(k => want.includes(k));
  const max = parseInt(b.max_conversions_per_upi, 10);
  return {
    campaign_name: name, platform: U.clean(b.platform) || 'Web', affiliate_link: link, click_macro: macros.join(','),
    total_payout: total, user_default_payout: user, referrer_default_payout: Math.round((total - user) * 100) / 100,
    events, total_events: n,
    payout_1: at(0).payout, payout_2: at(1).payout, payout_3: at(2).payout,
    goal_name_1: at(0).name, goal_name_2: at(1).name, goal_name_3: at(2).name,
    notes: U.clean(b.notes), instructions: U.clean(b.instructions) || 'Follow standard campaign rules.',
    multiple_allowed: String(b.multiple_allowed).toUpperCase() === 'YES' ? 'YES' : 'NO',
    max_conversions_per_upi: max > 0 ? max : null, campaign_type: 'ONLINE',
    collect_fields: fields.join(','), extra_fields_required: fields.filter(k => k !== 'NAME').join(','), logo_url: logo
  };
}

router.post('/campaigns', ah(async (req, res) => {
  const row = buildCampaign(req.body || {});
  for (let i = 0; i < 5; i++) {
    const id = U.genCampaignId();
    const { error } = await sb.from('campaigns').insert({ ...row, campaign_id: id, status: 'ACTIVE' });
    if (!error) return res.json({ success: true, message: 'Campaign added successfully!', campaignId: id });
    if (error.code !== '23505') throw error;
  }
  throw new HttpError(500, 'Could not generate campaign ID. Try again.');
}));

router.patch('/campaigns/:id', ah(async (req, res) => {
  const b = req.body || {};
  let patch;
  if (b.campaign_name !== undefined) patch = buildCampaign(b);
  else {
    const st = String(b.status || '').toUpperCase();
    if (!['ACTIVE', 'PAUSED', 'ENDED'].includes(st)) throw new HttpError(400, 'Invalid status.');
    patch = { status: st };
  }
  const { data, error } = await sb.from('campaigns').update(patch).eq('campaign_id', req.params.id).select('campaign_id');
  if (error) throw error;
  if (!data.length) throw new HttpError(404, 'Campaign not found.');
  res.json({ success: true, message: 'Campaign updated.' });
}));

// ---------- Postback URLs (one per event, per campaign) ----------
router.get('/campaigns/:id/postback', ah(async (req, res) => {
  const { data: c } = await sb.from('campaigns').select('*').eq('campaign_id', req.params.id).maybeSingle();
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const api = (process.env.API_PUBLIC_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
  const front = (process.env.PUBLIC_BASE_URL || (process.env.FRONTEND_URL || '').split(',')[0] || '').trim().replace(/\/+$/, '');
  const macros = U.macroList(c);
  const m = macros[0];
  const key = process.env.POSTBACK_SECRET ? '&key=' + encodeURIComponent(process.env.POSTBACK_SECRET) : '';
  // {click_id} = the network's own click id; {<macro>} = comes back with OUR click id (the macro set on this campaign)
  const base = api + '/postback?click_id={click_id}' + (m.toLowerCase() === 'click_id' ? '' : '&' + m + '={' + m + '}');
  const tail = '&cid=' + encodeURIComponent(c.campaign_id) + key;
  const urls = U.campEvents(c).map((e, i) => ({
    label: 'Event ' + (i + 1) + ': ' + e.name + ' (payout ₹' + e.payout + ')',
    url: base + '&goal=' + encodeURIComponent(e.name) + tail
  }));
  urls.push({
    label: 'ONE URL for all events (network sends the event name: replace {event} with the network\u2019s own event macro, e.g. {goal})',
    url: base + '&goal={event}' + tail
  });
  let recent = [];
  try {
    const r = await sb.from('postback_log').select('created_at,result,event_name,click_id,network_click_id').eq('campaign_id', c.campaign_id).order('id', { ascending: false }).limit(10);
    recent = r.data || [];
  } catch (e) { /* table not created yet */ }
  res.json({
    success: true, name: c.campaign_name, macro: macros[0], secretSet: !!process.env.POSTBACK_SECRET, urls, recent,
    links: [
      { label: 'Direct offer link (no referrer)', url: front + '/' + c.campaign_id + '/DIRECT' },
      { label: 'Partner link generator', url: front + '/gen/' + c.campaign_id },
      { label: 'Offer status tracker', url: front + '/tracker/' + c.campaign_id }
    ]
  });
}));

// ---------- Delete campaign = remove it (and all its data) from the database ----------
const countOf = async (table, col, id, extra) => {
  let q = sb.from(table).select('*', { count: 'exact', head: true }).eq(col, id);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
};

router.get('/campaigns/:id/delete-preview', ah(async (req, res) => {
  const id = req.params.id;
  const { data: c } = await sb.from('campaigns').select('campaign_name').eq('campaign_id', id).maybeSingle();
  if (!c) throw new HttpError(404, 'Campaign not found.');
  const [clicks, conversions, links, unpaid] = await Promise.all([
    countOf('clicks', 'campaign_id', id), countOf('conversions', 'campaign_id', id), countOf('generated_links', 'campaign_id', id),
    countOf('conversions', 'campaign_id', id, q => q.eq('user_status', 'PENDING'))
  ]);
  res.json({ success: true, name: c.campaign_name, clicks, conversions, links, unpaid });
}));

router.delete('/campaigns/:id', ah(async (req, res) => {
  const id = req.params.id;
  const unpaid = await countOf('conversions', 'campaign_id', id, q => q.eq('user_status', 'PENDING'));
  if (unpaid > 0 && !(req.body && req.body.force)) {
    const e = new HttpError(409, unpaid + ' user payout(s) are still unpaid for this campaign.');
    e.unpaid = unpaid; throw e;
  }
  const { data, error } = await sb.rpc('purge_campaign', { p_id: id });
  if (error) { if (String(error.message).includes('not_found')) throw new HttpError(404, 'Campaign not found.'); throw error; }
  res.json({ success: true, message: 'Campaign deleted. Partners keep only a totals summary for it.', removed: data });
}));

// ---------- Payments ----------
async function getConv(id) {
  const { data } = await sb.from('conversions').select('*').eq('id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'Conversion not found.');
  return data;
}
const partyOf = b => {
  const p = String(b.party || '').toUpperCase();
  if (!['USER', 'REFERRER'].includes(p)) throw new HttpError(400, 'Invalid party.');
  return p;
};

router.post('/pay', ah(async (req, res) => {
  const b = req.body || {};
  if (partyOf(b) !== 'USER') throw new HttpError(400, 'Referrer earnings are paid from the wallet (Withdrawals screen).');
  const amount = Math.round(U.num(b.amount, 0) * 100) / 100;
  const txn = U.clean(b.txnId);
  if (amount <= 0) throw new HttpError(400, 'Please enter a valid amount.');
  if (!txn) throw new HttpError(400, 'Please enter Transaction ID.');
  const { data, error } = await sb.rpc('pay_conversion', { p_id: Number(b.conversionId), p_amount: amount, p_txn: txn, p_note: U.clean(b.note) });
  if (error) throw error;
  if (!data || !data.ok) throw new HttpError(409, (data && data.error) || 'Could not record the payment.');
  res.json({ success: true, message: data.remaining > 0 ? 'Part payment recorded. ₹' + data.remaining + ' is still due.' : 'Payment recorded.' });
}));

router.post('/reject', ah(async (req, res) => {
  const b = req.body || {};
  const party = partyOf(b);
  const c = await getConv(b.conversionId);
  const col = party === 'USER' ? 'user_status' : 'ref_status';
  const st = String(c[col]).toUpperCase();
  if (st === 'PAID') throw new HttpError(409, 'Already paid, cannot reject.');
  if (st === 'REJECTED') throw new HttpError(409, 'Already rejected.');
  // A credited referrer share is taken back out of the wallet (the balance can go negative if it was already withdrawn).
  if (party === 'REFERRER' && st === 'CREDITED') {
    const { data: cr, error: ce } = await sb.from('wallet_ledger').select('amount').eq('conversion_id', c.id).eq('reason', 'CONVERSION');
    if (ce) throw ce;
    const credited = (cr || []).reduce((t, r) => t + (Number(r.amount) || 0), 0);
    if (credited > 0) {
      const { error } = await sb.from('wallet_ledger').insert({
        ref_id: c.ref_id, entry_type: 'DEBIT', reason: 'REVERSAL', amount: credited,
        conversion_id: c.id, campaign_name: c.campaign, note: U.clean(b.note)
      });
      if (error && error.code !== '23505') throw error;
    }
  }
  const { error } = await sb.from('conversions').update({ [col]: 'REJECTED', [party === 'USER' ? 'user_note' : 'ref_note']: U.clean(b.note) }).eq('id', c.id);
  if (error) throw error;
  res.json({ success: true, message: party === 'REFERRER' ? 'Wallet credit reversed.' : 'Marked as rejected.' });
}));

// ---------- Wallet withdrawals ----------
router.post('/withdrawals/:id/pay', ah(async (req, res) => {
  const b = req.body || {};
  const txn = U.clean(b.txnId);
  if (!txn) throw new HttpError(400, 'Please enter Transaction ID.');
  const { data, error } = await sb.from('withdrawals')
    .update({ status: 'PAID', txn_id: txn, admin_note: U.clean(b.note), processed_at: new Date().toISOString() })
    .eq('withdrawal_id', req.params.id).eq('status', 'PENDING').select('*');
  if (error) throw error;
  if (!data.length) throw new HttpError(409, 'This request is not pending any more.');
  const w = data[0];
  let payName = w.name;
  if (!payName) { const { data: rr } = await sb.from('referrers').select('name,mobile').eq('ref_id', w.ref_id).maybeSingle(); payName = (rr && (rr.name || rr.mobile)) || ''; }
  const { error: e2 } = await sb.from('payments').insert({
    payment_id: 'PAY_' + Date.now() + Math.floor(Math.random() * 900 + 100), ref_id: w.ref_id, upi: w.upi, name: payName,
    amount: w.amount, transaction_id: txn, pay_type: 'WITHDRAWAL', campaign: 'WALLET', remarks: 'Wallet withdrawal ' + w.withdrawal_id
  });
  if (e2) console.error('[withdrawal] payment log insert failed', w.withdrawal_id, e2.message);
  res.json({ success: true, message: 'Withdrawal marked as paid.' });
}));

router.post('/withdrawals/:id/reject', ah(async (req, res) => {
  const { data, error } = await sb.rpc('reject_withdrawal', { p_id: req.params.id, p_note: U.clean(req.body && req.body.note) });
  if (error) throw error;
  if (!data || !data.ok) throw new HttpError(409, (data && data.error) || 'Could not reject.');
  res.json({ success: true, message: 'Request rejected. Amount returned to the partner wallet.' });
}));

// ---------- Send to Sheets ----------
router.get('/sync/status', ah(async (req, res) => res.json({ success: true, ...(await sheets.status()) })));

router.post('/sync/push', ah(async (req, res) => {
  const only = Array.isArray(req.body && req.body.tables) && req.body.tables.length ? req.body.tables.filter(t => sheets.ORDER.includes(t)) : null;
  try { res.json({ success: true, result: await sheets.pushAll(only) }); }
  catch (e) { throw new HttpError(409, e.message); }
}));

module.exports = router;
