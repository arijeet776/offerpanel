const crypto = require('crypto');
const clean = v => String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const rid = n => Math.floor(Math.random() * 10 ** n).toString().padStart(n, '0');
// Random, non-sequential, never re-used after a campaign is deleted. 8 chars, no look-alike letters.
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCampaignId = () => Array.from({ length: 8 }, () => ID_CHARS[crypto.randomInt(ID_CHARS.length)]).join('');
const genId = prefix => prefix + Date.now() + rid(3);
const isValidUpi = s => /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/.test(s);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const likeEscape = s => String(s).replace(/[\\%_]/g, '\\$&');
const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.publicMessage = message; }
}

// Click ID is sent to the network through these macro names, per platform.
const CLICK_ID_MACRO_MAP = {
  OFFER18: ['aff_sub1', 'aff_sub2'],
  TRACKIER: ['p2', 'source'],
  TRACKIX: ['sub1', 'sub2'],
  CUSTOM: ['p1']
};

// Admin types the parameter name(s) where OUR click id must go (e.g. "aff_sub1" or "p2, source").
// Accepts {aff_sub1}, aff_sub1=, spaces; returns a clean list or null if something is invalid.
function parseMacros(v) {
  const list = String(v == null ? '' : v).split(/[,\s]+/).map(x => x.replace(/[{}=%7B7D]/gi, m => (m === '=' || m === '{' || m === '}') ? '' : m).trim()).filter(Boolean);
  const out = [...new Set(list.map(x => x.replace(/^\{+|\}+$/g, '').replace(/=+$/, '')))].filter(Boolean);
  if (!out.length || out.length > 5 || out.some(x => !/^[A-Za-z0-9_.\-]{1,40}$/.test(x))) return null;
  return out;
}
// Campaigns made before the macro field existed fall back to the old per-platform names.
function macroList(c) {
  return parseMacros(c && c.click_macro) || CLICK_ID_MACRO_MAP[String((c && c.click_platform) || 'CUSTOM').toUpperCase()] || CLICK_ID_MACRO_MAP.CUSTOM;
}

function buildRedirect(link, macros, clickId) {
  let url = String(link).trim();
  for (const m of macros) {
    const e = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ph = new RegExp('\\{' + e + '\\}|%7B' + e + '%7D', 'gi');
    if (ph.test(url)) { url = url.replace(ph, encodeURIComponent(clickId)); continue; }
    const ex = new RegExp('([?&]' + e + '=)([^&]*)', 'i');
    if (ex.test(url)) { url = url.replace(ex, '$1' + encodeURIComponent(clickId)); continue; }
    url += (url.includes('?') ? '&' : '?') + m + '=' + encodeURIComponent(clickId);
  }
  return url;
}

async function userPayoutFor(sb, campaign, ref) {
  if (ref && ref !== 'DIRECT') {
    const { data } = await sb.from('generated_links').select('user_payout')
      .eq('campaign_id', campaign.campaign_id).eq('ref_id', ref)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return Number(data.user_payout) || 0;
  }
  return Number(campaign.user_default_payout) || Number(campaign.total_payout) || 0;
}

// ---- Events: any number per campaign (up to MAX_EVENTS). Old campaigns/leads that only have the
// goal_name_1..3 / payout_1..3 / goal..goal3 columns are read through these helpers, so nothing breaks.
const MAX_EVENTS = 20;
function campEvents(c) {
  if (c && Array.isArray(c.events) && c.events.length)
    return c.events.slice(0, MAX_EVENTS).map((e, i) => ({
      name: clean(e && e.name) || (i === 0 ? 'INSTALL' : 'EVENT ' + (i + 1)),
      payout: Math.round((Number(e && e.payout) || 0) * 100) / 100
    }));
  const n = Math.min(3, Math.max(1, Number(c && c.total_events) || 1));
  const names = [c && c.goal_name_1, c && c.goal_name_2, c && c.goal_name_3];
  const pays = [c && c.payout_1, c && c.payout_2, c && c.payout_3];
  const legacy = pays.every(v => v == null); // made before event payouts existed: everything on event 1
  return names.slice(0, n).map((g, i) => ({
    name: clean(g) || (i === 0 ? 'INSTALL' : 'EVENT ' + (i + 1)),
    payout: legacy ? (i === 0 ? Number(c && c.total_payout) || 0 : 0) : Number(pays[i]) || 0
  }));
}
// Events a lead has achieved: [{no, name, at}]
function convEvents(r) {
  if (r && Array.isArray(r.events))
    return r.events.map(e => ({ no: Number(e.no), name: e.name, at: e.at })).filter(e => e.no >= 1 && e.name).sort((a, b) => a.no - b.no);
  return [[1, r && r.goal, r && r.goal_at], [2, r && r.goal2, r && r.goal2_at], [3, r && r.goal3, r && r.goal3_at]]
    .filter(e => e[1]).map(e => ({ no: e[0], name: e[1], at: e[2] }));
}

module.exports = { MAX_EVENTS, campEvents, convEvents, genCampaignId, parseMacros, macroList, clean, num, genId, isValidUpi, isEmail, likeEscape, normName, ah, HttpError, buildRedirect, userPayoutFor, CLICK_ID_MACRO_MAP };
