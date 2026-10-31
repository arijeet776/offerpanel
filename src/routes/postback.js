const { sb } = require('../db');
const { safeEq } = require('../auth');
const U = require('../util');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const CLK = /^CLK\d+$/i;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const str = v => String(Array.isArray(v) ? (v[0] == null ? '' : v[0]) : (v == null ? '' : v)).trim();
// A macro the network did not fill in arrives as the literal text, e.g. "{click_id}" or "%7Bclick_id%7D".
const unresolved = v => !v || /^(\{.*\}|%7B.*%7D|null|undefined)$/i.test(v);
// Parameter names networks use to carry the event / goal. We read all of them and use the first one that matches an event of the campaign.
const EVENT_KEYS = ['goal', 'event', 'event_name', 'goal_name', 'goal_value', 'event_type', 'action', 'conversion_type'];
// Parameter names networks use for THEIR click id. `click_id` is the standard one.
const NET_KEYS = ['click_id', 'network_click_id', 'clickid', 'transaction_id', 'txn_id', 'aff_click_id', 'tid', 'conversion_id'];

// Network postback (one URL per campaign; the admin panel -> All Campaigns -> Postback shows the ready URLs):
//   /postback?click_id={click_id}&<our macro>={<our macro>}&goal={event}&cid=CAMPAIGN_ID&key=SECRET
//   click_id      = the advertiser's / network's own click id (stored with the lead)
//   <our macro>   = the macro chosen when the campaign was created; our Click ID (CLK...) comes back through it
//   goal / event  = which event was reached (any of the names in EVENT_KEYS)
//   time          = never sent by networks: the moment this postback arrives is stored as the event time
module.exports = U.ah(async (req, res) => {
  const raw = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  const lp = {};                                    // same params, names lower-cased (networks differ in case)
  const safe = {};                                  // what we keep: everything except the secret
  for (const [k, v] of Object.entries(raw)) { lp[k.toLowerCase()] = v; if (k.toLowerCase() !== 'key') safe[k] = v; }

  const secret = process.env.POSTBACK_SECRET;
  if (!secret) { console.error('[postback] POSTBACK_SECRET is not set: refusing postbacks until it is'); return res.status(503).send('postback secret not configured'); }
  if (!safeEq(str(lp.key), secret)) return res.status(403).send('forbidden');

  const cidIn = str(lp.cid).toUpperCase();
  const seen = { click: null, campaign: cidIn || null, net: null, event: null };
  // Every postback is written to postback_log (best effort) so the admin can see exactly what a network sent.
  const finish = async result => {
    try {
      await sb.from('postback_log').insert({
        result, campaign_id: seen.campaign, click_id: seen.click, network_click_id: seen.net, event_name: seen.event, params: safe
      });
      if (Math.random() < 0.01) await sb.from('postback_log').delete().lt('created_at', new Date(Date.now() - 30 * 864e5).toISOString()); // keep 30 days
    } catch (e) { /* log table missing or full: never block the postback */ }
    return res.status(200).send(result);
  };

  // ---- 1. OUR click id: first from the campaign's own macro, then from any parameter that looks like one
  let camp = null;
  if (cidIn) {
    const { data } = await sb.from('campaigns').select('*').eq('campaign_id', cidIn).maybeSingle();
    camp = data || null;
  }
  const cand = [];
  if (camp) U.macroList(camp).forEach(m => cand.push(str(lp[m.toLowerCase()])));
  Object.values(lp).forEach(v => cand.push(str(v)));
  const mine = [...new Set(cand.filter(v => CLK.test(v)).map(v => v.toUpperCase()))];
  if (!mine.length) { console.warn('[postback] no CLK id', JSON.stringify(safe)); return finish('IGNORED_NO_CLICK_ID'); }

  const { data: click } = await sb.from('clicks').select('*').in('click_id', mine).limit(1).maybeSingle();
  if (!click) { console.warn('[postback] unknown click', mine); return finish('IGNORED_UNKNOWN_CLICK'); }
  seen.click = click.click_id; seen.campaign = click.campaign_id;

  if (cidIn && cidIn !== String(click.campaign_id).toUpperCase()) {
    console.warn('[postback] campaign mismatch', cidIn, click.campaign_id);
    return finish('IGNORED_CAMPAIGN_MISMATCH');
  }
  if (!camp) {
    const { data } = await sb.from('campaigns').select('*').eq('campaign_id', click.campaign_id).maybeSingle();
    camp = data || null;
  }
  if (!camp) return finish('IGNORED_UNKNOWN_CAMPAIGN');

  // ---- 2. the ADVERTISER's click id (kept with the lead)
  seen.net = NET_KEYS.map(k => str(lp[k])).find(v => !unresolved(v) && !CLK.test(v)) || null;

  // ---- 3. which event is this?
  const evs = U.campEvents(camp);
  const names = evs.map(x => x.name);
  const given = EVENT_KEYS.map(k => U.clean(str(lp[k]))).filter(v => !unresolved(v));
  seen.event = given[0] || null;
  const { data: ex } = await sb.from('conversions').select('events,goal,goal2,goal3,goal_at,goal2_at,goal3_at').eq('click_id', click.click_id).maybeSingle();
  const done = new Set(ex ? U.convEvents(ex).map(x => x.no) : []);

  let idx = 0;
  for (const g of given) {                                  // exact name (ignoring case, spaces and symbols)
    const i = names.findIndex(n => norm(n) === norm(g));
    if (i >= 0) { idx = i + 1; seen.event = names[i]; break; }
  }
  if (!idx) {
    if (evs.length === 1) idx = 1;                          // single-event campaign: nothing to mix up
    else if (!given.length) idx = evs.findIndex((_, i) => !done.has(i + 1)) + 1; // network sends no event at all: take them in order
    else { console.warn('[postback] unknown event', JSON.stringify(given), 'for', camp.campaign_id); return finish('IGNORED_UNKNOWN_EVENT'); }
  }
  if (!idx || done.has(idx)) return finish('DUPLICATE');

  // Max conversions per UPI is checked here too: several clicks can be open at the same time, so only the postback can count reliably.
  const maxConv = Number(camp.max_conversions_per_upi);
  if (!ex && maxConv > 0) {
    const { count } = await sb.from('conversions').select('*', { count: 'exact', head: true }).eq('campaign_id', click.campaign_id).ilike('upi', U.likeEscape(click.upi));
    if ((count || 0) >= maxConv) return finish('IGNORED_UPI_LIMIT');
  }

  // ---- 4. money: this event's payout, split user / referrer by the link's ratio
  const ref = click.ref_id || 'DIRECT';
  const evPay = evs[idx - 1].payout;
  // The user is paid the same share the offer page promised: the link's split, or the campaign's default split for direct visits.
  let gl = null;
  if (ref !== 'DIRECT') {
    const r = await sb.from('generated_links').select('user_payout,total_payout')
      .eq('campaign_id', click.campaign_id).eq('ref_id', ref).order('created_at', { ascending: false }).limit(1).maybeSingle();
    gl = r.data || null;
  }
  const total = Number(gl ? gl.total_payout : camp.total_payout) || 0;
  const user = gl ? Number(gl.user_payout) : (Number(camp.user_default_payout) || total);
  const ratio = total > 0 ? Math.min(1, Math.max(0, user / total)) : 1; // share that goes to the user
  const userAmt = round2(evPay * ratio);
  const refAmt = ref === 'DIRECT' ? 0 : round2(evPay - userAmt);

  // ---- 5. save. The event time is the moment this postback arrived (record_event stamps now()).
  const { data, error } = await sb.rpc('record_event', {
    p_click: click.click_id, p_campaign_id: click.campaign_id, p_campaign: camp.campaign_name, p_upi: click.upi, p_name: click.name,
    p_ref: ref, p_idx: idx, p_goal: names[idx - 1], p_net: seen.net, p_user: userAmt, p_refamt: refAmt, p_raw: safe
  });
  if (error) throw error;
  return finish(data && data.result === 'duplicate' ? 'DUPLICATE' : idx === 1 && !ex ? 'OK' : 'OK_EVENT_ADDED');
});
