const S = { token: sessionStorage.getItem('qx_token') || '', D: { campaigns: [], links: [], conversions: [], payments: [], withdrawals: [] }, editId: null, ctx: null, charts: {}, rep: { tab: 'conv', clicks: null, total: 0, loading: false, err: '' } };
const DONE = ['PAID', 'REJECTED', 'NA', 'CREDITED'];

async function call(path, opts = {}) {
  try { return await api('/api/admin' + path, { ...opts, token: S.token }); }
  catch (e) { if (e.status === 401 && S.token) { logout(true); } throw e; }
}

// ---------- Login ----------
function applyLogin() {
  $('login').classList.add('hidden'); $('login').style.display = 'none'; $('logout').classList.remove('hidden');
  $('greet').textContent = 'Hello, ' + (sessionStorage.getItem('qx_name') || 'Admin');
  $('ctitle').textContent = String(sessionStorage.getItem('qx_company') || 'ADMIN PANEL').toUpperCase();
  loadAll();
}
function logout(expired) {
  sessionStorage.clear(); S.token = '';
  $('login').style.display = 'flex'; $('login').classList.remove('hidden'); $('logout').classList.add('hidden');
  $('lm').textContent = expired ? 'Session expired. Please login again.' : ''; $('lm').className = 'msg err'; $('lp').value = '';
  go('dashboard');
}
$('logout').addEventListener('click', () => logout());
$('lb').addEventListener('click', async () => {
  const name = $('ln').value.trim(), company = $('lc').value.trim(), password = $('lp').value;
  if (!company || !password) { $('lm').textContent = 'Please enter company name and password.'; $('lm').className = 'msg err'; return; }
  $('lb').disabled = true; $('lb').textContent = 'Verifying...';
  try {
    const r = await api('/api/admin/login', { method: 'POST', body: { name, company, password } });
    S.token = r.token; sessionStorage.setItem('qx_token', r.token); sessionStorage.setItem('qx_name', r.name); sessionStorage.setItem('qx_company', r.company);
    applyLogin();
  } catch (e) { $('lm').textContent = e.message; $('lm').className = 'msg err'; }
  $('lb').disabled = false; $('lb').textContent = 'Verify & Unlock';
});
$('lp').addEventListener('keydown', e => { if (e.key === 'Enter') $('lb').click(); });

// ---------- Navigation ----------
function go(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active'); window.scrollTo(0, 0);
  if (name === 'campaigns') renderCampaigns();
  if (name === 'analytics') loadAnalytics();
  if (name === 'conv') { if (S.rep.tab === 'clk') loadClicks(); else renderConv(); }
  if (name === 'links') { fillSelect('l-camp', true); renderLinks(); }
  if (name === 'pay') { fillSelect('p-camp', true); renderPay(); }
  if (name === 'log') renderLog();
  if (name === 'wd') renderWd();
  if (name === 'sheets') loadSheets();
  if (name === 'db') loadDb(true);
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { if (g.dataset.new) startForm(null); go(g.dataset.go); return; }
  const c = e.target.closest('[data-close]'); if (c) { $(c.dataset.close).classList.remove('show'); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const id = a.dataset.id;
  if (a.dataset.act === 'status') setStatus(id, a.dataset.val);
  if (a.dataset.act === 'edit') { startForm(S.D.campaigns.find(x => x.campaign_id === id)); go('form'); }
  if (a.dataset.act === 'del') delCampaign(id);
  if (a.dataset.act === 'pay') openPay(id, a.dataset.party);
  if (a.dataset.act === 'rej') openRej(id, a.dataset.party);
  if (a.dataset.act === 'push') pushSheets([a.dataset.t], a);
  if (a.dataset.act === 'pb') openPb(id);
  if (a.dataset.act === 'copy') copyText(S.pb[Number(a.dataset.i)], a);
  if (a.dataset.act === 'wdpay') openWdPay(id);
  if (a.dataset.act === 'wdrej') openWdRej(id);
});

async function loadAll() {
  try { const r = await call('/data'); S.D = r; fillSelect('l-camp', true); fillSelect('p-camp', true); updWdBadge(); }
  catch (e) { console.error(e); }
}
function fillSelect(id, byId) {
  const el = $(id), cur = el.value;
  el.innerHTML = '<option value="">-- Choose a campaign --</option>' + S.D.campaigns.map(c => '<option value="' + esc(byId ? c.campaign_id : c.campaign_name) + '">' + esc(c.campaign_name) + '</option>').join('');
  el.value = cur;
}
const matchQ = (q, ...f) => !q || f.some(x => String(x || '').toLowerCase().includes(q.toLowerCase()));

// ---------- Campaigns ----------
function evLine(c) {
  return '<div class="small">' + (c.events || []).map(e => esc(e.name) + ' ' + inr(e.payout)).join(' · ') + '</div>';
}
function renderCampaigns() {
  const q = $('q-camp').value;
  const rows = S.D.campaigns.filter(c => matchQ(q, c.campaign_name, c.platform));
  $('camp-body').innerHTML = rows.length ? rows.map(c => {
    const st = String(c.status || 'ACTIVE').toUpperCase(), id = esc(c.campaign_id);
    const b = (v, t, cls) => '<button class="mini ' + (cls || '') + '" data-act="status" data-id="' + id + '" data-val="' + v + '">' + t + '</button>';
    const acts = st === 'ACTIVE' ? b('PAUSED', 'Pause') + b('ENDED', 'End', 'danger') : st === 'PAUSED' ? b('ACTIVE', 'Resume') + b('ENDED', 'End', 'danger') : b('ACTIVE', 'Start', 'ok');
    return '<tr><td>' + esc(c.campaign_name) + '<br><span class="mono">' + esc(c.platform) + ' · ' + id + '</span></td><td class="small">' + esc(c.instructions) + '</td><td class="amt">' + inr(c.total_payout) + evLine(c) +
      '</td><td><span class="badge ' + statusClass(st) + '">' + esc(st) + '</span></td><td><div class="acts">' + acts + '<button class="mini ok" data-act="pb" data-id="' + id + '">Postback</button><button class="mini" data-act="edit" data-id="' + id + '">Edit</button><button class="mini danger" data-act="del" data-id="' + id + '">Delete</button></div></td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">No campaigns found.</td></tr>';
}
$('q-camp').addEventListener('input', renderCampaigns);
async function setStatus(id, status) { try { await call('/campaigns/' + encodeURIComponent(id), { method: 'PATCH', body: { status } }); await loadAll(); renderCampaigns(); } catch (e) { alert(e.message); } }
async function delCampaign(id) {
  try {
    const p = await call('/campaigns/' + encodeURIComponent(id) + '/delete-preview');
    let m = 'PERMANENTLY delete "' + p.name + '" (' + id + ')?\n\nThis erases from the database:\n• ' + p.clicks + ' clicks\n• ' + p.conversions + ' conversions (and their user payment records)\n• ' + p.links + ' referral links\n\nPartner wallets and withdrawals are NOT touched. This cannot be undone.';
    if (!confirm(m)) return;
    let force = false;
    if (p.unpaid > 0) {
      const t = prompt('WARNING: ' + p.unpaid + ' user payout(s) are still UNPAID for this campaign. Deleting will lose them.\n\nType the campaign ID (' + id + ') to delete anyway:');
      if (!t || t.trim().toUpperCase() !== String(id).toUpperCase()) return alert('Cancelled. Campaign was not deleted.');
      force = true;
    }
    await call('/campaigns/' + encodeURIComponent(id), { method: 'DELETE', body: { force } });
    await loadAll(); renderCampaigns();
  } catch (e) { alert(e.message); }
}

// ---------- Campaign form (add + edit) ----------
const LEGACY_MACRO = { OFFER18: 'aff_sub1,aff_sub2', TRACKIER: 'p2,source', TRACKIX: 'sub1,sub2', CUSTOM: 'p1' };
const MAX_EVENTS = 20;
$('f-events').innerHTML = Array.from({ length: MAX_EVENTS }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + (i ? ' Events' : ' Event') + '</option>').join('');
function evRead() { return [...document.querySelectorAll('#f-evs .evrow')].map(r => ({ name: r.querySelector('.ev-n').value, payout: r.querySelector('.ev-p').value })); }
function evTotal() { $('f-total').textContent = inr(evRead().reduce((s, e) => s + (Number(e.payout) || 0), 0)); }
// Draws exactly n event rows and keeps whatever was already typed in them.
function evBuild(n, vals) {
  const cur = vals || evRead();
  $('f-evs').innerHTML = Array.from({ length: n }, (_, i) => {
    const v = cur[i] || { name: '', payout: '' };
    return '<div class="evrow grid2"><input class="ev-n" placeholder="Event ' + (i + 1) + ' name' + (i === 0 ? ' (e.g. Install)' : i === 1 ? ' (e.g. Registration)' : i === 2 ? ' (e.g. KYC)' : '') + '" value="' + esc(v.name) + '">' +
      '<input class="ev-p" type="number" min="0" step="any" placeholder="Event ' + (i + 1) + ' payout ₹" value="' + esc(v.payout) + '"></div>';
  }).join('');
  $('f-events').value = n; evTotal();
}
$('f-events').addEventListener('change', () => evBuild(Number($('f-events').value) || 1));
$('f-evs').addEventListener('input', evTotal);
function logoPrev() {
  const u = $('f-logo').value.trim();
  if (!/^https?:\/\//i.test(u)) { $('f-logo-prev').classList.add('hidden'); return; }
  $('f-logo-img').onerror = () => $('f-logo-prev').classList.add('hidden');
  $('f-logo-img').onload = () => $('f-logo-prev').classList.remove('hidden');
  $('f-logo-img').src = u;
}
$('f-logo').addEventListener('change', logoPrev); $('f-logo').addEventListener('input', logoPrev);
function startForm(c) {
  S.editId = c ? c.campaign_id : null;
  $('form-title').textContent = c ? 'Edit Campaign ' + c.campaign_id : 'Add Campaign'; $('f-save').textContent = c ? 'Save Changes' : 'Add Campaign';
  $('f-cancel').classList.toggle('hidden', !c); $('f-msg').textContent = '';
  const v = c || {};
  $('f-name').value = v.campaign_name || ''; $('f-platform').value = v.platform && v.platform !== 'Web' ? v.platform : '';
  $('f-link').value = v.affiliate_link || '';
  $('f-macro').value = v.click_macro || (c ? LEGACY_MACRO[String(v.click_platform || 'CUSTOM').toUpperCase()] || 'p1' : '');
  const evs = c && v.events && v.events.length ? v.events : [{ name: c ? 'INSTALL' : '', payout: '' }];
  evBuild(evs.length, evs.map(x => ({ name: x.name, payout: c ? x.payout : '' })));
  $('f-user').value = c && Number(v.user_default_payout) !== Number(v.total_payout) ? v.user_default_payout : '';
  $('f-rules').value = c ? (v.instructions || '') : ''; $('f-notes').value = v.notes || ''; $('f-logo').value = v.logo_url || '';
  const cf = c ? (v.collect_fields == null ? ['NAME', ...String(v.extra_fields_required || '').split(',').filter(Boolean)] : String(v.collect_fields).split(',')) : ['MOBILE'];
  $('f-fld-name').checked = cf.includes('NAME'); $('f-fld-mobile').checked = cf.includes('MOBILE'); $('f-fld-gmail').checked = cf.includes('GMAIL'); $('f-multi').value = v.multiple_allowed || 'NO'; $('f-max').value = v.max_conversions_per_upi || '';
  logoPrev();
}
$('f-cancel').addEventListener('click', () => { startForm(null); go('campaigns'); });
$('f-save').addEventListener('click', async () => {
  const msg = (t, c) => { $('f-msg').textContent = t; $('f-msg').className = 'msg ' + c; };
  const evs = evRead(), n = evs.length;
  const body = {
    campaign_name: $('f-name').value, events: evs, total_events: n, platform: $('f-platform').value, click_macro: $('f-macro').value,
    affiliate_link: $('f-link').value, user_default_payout: $('f-user').value, instructions: $('f-rules').value,
    notes: $('f-notes').value, logo_url: $('f-logo').value, collect_fields: ['NAME', 'MOBILE', 'GMAIL'].filter(k => $('f-fld-' + k.toLowerCase()).checked).join(','), multiple_allowed: $('f-multi').value, max_conversions_per_upi: $('f-max').value
  };
  if (!body.campaign_name.trim() || !body.affiliate_link.trim()) return msg('Please fill Campaign Name and Tracking Link.', 'err');
  if (!body.click_macro.trim()) return msg('Please type the Click ID macro (the parameter where our Click ID goes).', 'err');
  for (let i = 0; i < n; i++) if (!evs[i].name.trim()) return msg('Please enter a name for Event ' + (i + 1) + '.', 'err');
  $('f-save').disabled = true; msg('Saving...', 'ok');
  try {
    const r = S.editId ? await call('/campaigns/' + encodeURIComponent(S.editId), { method: 'PATCH', body }) : await call('/campaigns', { method: 'POST', body });
    msg((r.message || 'Saved.') + (r.campaignId ? ' Campaign ID: ' + r.campaignId : ''), 'ok'); await loadAll();
    if (S.editId) { startForm(null); go('campaigns'); } else startForm(null);
  } catch (e) { msg(e.message, 'err'); }
  $('f-save').disabled = false;
});

// ---------- Reports: conversions + clicks ----------
const inRange = (t, d) => {
  if (d === 'ALL') return true;
  if (d === 'TODAY') return dayKey(t) === dayKey(Date.now());
  if (d === 'YESTERDAY') return dayKey(t) === dayKey(Date.now() - 864e5);
  if (d === '7D') return new Date(t).getTime() >= Date.now() - 7 * 864e5;
  return true;
};
const userCell = (name, upi, mobile, gmail) =>
  (name ? '<b>' + esc(name) + '</b><br><span class="mono">' + esc(upi) + '</span>' : '<b class="mono">' + esc(upi || '—') + '</b>') +
  (mobile ? '<br><span class="small">📱 ' + esc(mobile) + '</span>' : '') + (gmail ? '<br><span class="small">✉ ' + esc(gmail) + '</span>' : '');
const goalOf = c => (c.events || []).map(e => e.name).join(' + ') || 'INSTALL';
const finalOf = c => { const f = String(c.final_status || '').toUpperCase(); return ['SUCCESSFUL', 'APPROVED'].includes(f) ? 'SUCCESSFUL' : f.includes('REJECT') ? 'REJECTED' : 'PENDING'; };

function convRows() {
  const q = $('c-q').value, d = $('c-date').value;
  return S.D.conversions.filter(c => matchQ(q, c.upi, c.name, c.mobile, c.gmail, c.campaign, c.click_id, c.network_click_id, c.ref_id, c.ref_mobile) && inRange(c.created_at, d));
}
function clickRows() {
  const q = $('c-q').value, d = $('c-date').value;
  return (S.rep.clicks || []).filter(k => matchQ(q, k.upi, k.name, k.mobile, k.gmail, k.campaign, k.campaign_id, k.click_id, k.network_click_id, k.ref_id, k.ref_label, k.ip_address) && inRange(k.created_at, d));
}

function renderConv() {
  const conv = S.rep.tab === 'conv';
  $('rt-conv').classList.toggle('on', conv); $('rt-clk').classList.toggle('on', !conv);
  $('r-conv').classList.toggle('hidden', !conv); $('r-clk').classList.toggle('hidden', conv);
  $('c-q').placeholder = conv ? 'Search by Name, UPI, Mobile, Click ID, Campaign...' : 'Search by Name, UPI, Mobile, Click ID, Campaign, Partner...';
  if (conv) renderConvTable(); else renderClickTable();
}

// Date & Time | User / UPI | Campaign / Goal | Advertiser Click ID | System Click ID | Final
function renderConvTable() {
  const r = convRows();
  $('r-sum').textContent = r.length + ' of ' + S.D.conversions.length + ' conversions';
  $('c-body').innerHTML = r.length ? r.map(c => '<tr><td class="mono" style="white-space:nowrap">' + esc(fmtDate(c.created_at)) + '</td><td>' + userCell(c.name, c.upi, c.mobile, c.gmail) +
    '</td><td><b>' + esc(c.campaign) + '</b><br><span style="color:var(--gold);font-size:11.5px">' + esc(goalOf(c)) + '</span></td><td><span class="mono">' + esc(c.network_click_id || '—') +
    '</span></td><td><span class="mono">' + esc(c.click_id) + '</span></td><td><span class="badge ' + statusClass(finalOf(c)) + '">' + finalOf(c) + '</span></td></tr>').join('')
    : '<tr><td colspan="6" class="empty">No matching conversion logs.</td></tr>';
}

// Date & Time | User / UPI | Campaign | System Click ID | Partner | Device / IP | Converted
function renderClickTable() {
  if (S.rep.clicks === null) {
    $('r-sum').textContent = S.rep.loading ? 'Loading clicks...' : '';
    $('k-body').innerHTML = '<tr><td colspan="7" class="empty">' + esc(S.rep.loading ? 'Loading...' : (S.rep.err || 'Could not load clicks.')) + '</td></tr>';
    return;
  }
  const r = clickRows(), conv = r.filter(k => k.converted).length;
  $('r-sum').textContent = r.length + ' clicks • ' + conv + ' converted' + (S.rep.total > S.rep.clicks.length ? ' • showing latest ' + S.rep.clicks.length + ' of ' + S.rep.total : '');
  $('k-body').innerHTML = r.length ? r.map(k => '<tr><td class="mono" style="white-space:nowrap">' + esc(fmtDate(k.created_at)) + '</td><td>' + userCell(k.name, k.upi, k.mobile, k.gmail) +
    '</td><td><b>' + esc(k.campaign) + '</b></td><td><span class="mono">' + esc(k.click_id) + '</span></td><td>' +
    (!k.ref_id || k.ref_id === 'DIRECT' ? '<span class="mono">Direct</span>' : '<b>' + esc(k.ref_label || k.ref_id) + '</b><br><span class="mono small">' + esc(k.ref_id) + '</span>') +
    '</td><td>' + esc(k.device_type || '—') + '<br><span class="mono small">' + esc(k.ip_address || '') + '</span></td><td>' +
    (k.converted ? '<span class="badge ok">YES</span>' + (k.network_click_id ? '<br><span class="mono small">' + esc(k.network_click_id) + '</span>' : '') : '<span class="badge wait">NO</span>') + '</td></tr>').join('')
    : '<tr><td colspan="7" class="empty">No matching clicks.</td></tr>';
}

async function loadClicks() {
  if (S.rep.loading) return;
  S.rep.loading = true; S.rep.clicks = null; S.rep.err = ''; renderConv();
  try { const r = await call('/reports/clicks'); S.rep.clicks = r.clicks; S.rep.total = r.total; }
  catch (e) { S.rep.clicks = null; S.rep.err = e.message; }
  S.rep.loading = false; renderConv();
}
$('rt-conv').addEventListener('click', () => { S.rep.tab = 'conv'; renderConv(); });
$('rt-clk').addEventListener('click', () => { S.rep.tab = 'clk'; loadClicks(); });
$('c-q').addEventListener('input', renderConv); $('c-date').addEventListener('change', renderConv);
$('c-csv').addEventListener('click', () => {
  if (S.rep.tab === 'conv') {
    const r = convRows(); if (!r.length) return alert('No conversion data available to export.');
    const head = ['Date & Time', 'Name', 'UPI', 'Mobile', 'Gmail', 'Campaign', 'Goal', 'Advertiser Click ID', 'System Click ID', 'Partner Ref ID', 'Final Status'];
    download('Conversion_Report_' + Date.now() + '.csv', [head, ...r.map(c => [fmtDate(c.created_at), c.name, c.upi, c.mobile, c.gmail, c.campaign, goalOf(c), c.network_click_id, c.click_id, c.ref_id, finalOf(c)])].map(x => x.map(csvCell).join(',')).join('\n'));
  } else {
    const r = clickRows(); if (!r.length) return alert('No click data available to export.');
    const head = ['Date & Time', 'Name', 'UPI', 'Mobile', 'Gmail', 'Campaign', 'System Click ID', 'Partner Ref ID', 'Partner Mobile', 'Device', 'IP Address', 'Converted', 'Advertiser Click ID'];
    download('Click_Report_' + Date.now() + '.csv', [head, ...r.map(k => [fmtDate(k.created_at), k.name, k.upi, k.mobile, k.gmail, k.campaign, k.click_id, k.ref_id, k.ref_label, k.device_type, k.ip_address, k.converted ? 'YES' : 'NO', k.network_click_id])].map(x => x.map(csvCell).join(',')).join('\n'));
  }
});

// ---------- Database viewer ----------
const DB = { tables: [], tab: 'clicks', page: 1, pages: 1, busy: false };
async function loadDb(first) {
  if (DB.busy) return; DB.busy = true;
  try {
    if (first || !DB.tables.length) { const t = await call('/db/tables'); DB.tables = t.tables; DB.page = 1; }
    $('db-tabs').innerHTML = DB.tables.map(t => '<button type="button" class="sec' + (t.key === DB.tab ? ' on' : '') + '" data-db="' + esc(t.key) + '">' + esc(t.label) + ' (' + t.count + ')</button>').join('');
    $('db-sum').textContent = 'Loading...';
    const r = await call('/db/' + DB.tab + '?page=' + DB.page + '&q=' + encodeURIComponent($('db-q').value.trim()));
    DB.pages = r.pages;
    $('db-sum').textContent = r.count + ' record' + (r.count === 1 ? '' : 's') + (r.count > r.rows.length ? ' • showing ' + r.rows.length + ' on this page' : '');
    $('db-pg').textContent = 'Page ' + r.page + ' of ' + r.pages;
    $('db-prev').disabled = r.page <= 1; $('db-next').disabled = r.page >= r.pages;
    $('db-head').innerHTML = r.columns.length ? '<tr>' + r.columns.map(c => '<th>' + esc(c.replace(/_/g, ' ')) + '</th>').join('') + '</tr>' : '';
    const cell = (k, v) => {
      if (v == null || v === '') return '<span style="opacity:.4">—</span>';
      if (typeof v === 'object') v = JSON.stringify(v);
      if (/_at$/.test(k) && !isNaN(Date.parse(v))) return '<span style="white-space:nowrap">' + esc(fmtDate(v)) + '</span>';
      const t = String(v); return '<span class="mono" title="' + esc(t) + '">' + esc(t.length > 48 ? t.slice(0, 48) + '…' : t) + '</span>';
    };
    $('db-body').innerHTML = r.rows.length ? r.rows.map(row => '<tr>' + r.columns.map(c => '<td>' + cell(c, row[c]) + '</td>').join('') + '</tr>').join('') : '<tr><td class="empty">No records found.</td></tr>';
  } catch (e) { $('db-sum').textContent = e.message; }
  DB.busy = false;
}
$('db-tabs').addEventListener('click', e => { const b = e.target.closest('[data-db]'); if (!b) return; DB.tab = b.dataset.db; DB.page = 1; $('db-q').value = ''; loadDb(); });
$('db-prev').addEventListener('click', () => { if (DB.page > 1) { DB.page--; loadDb(); } });
$('db-next').addEventListener('click', () => { if (DB.page < DB.pages) { DB.page++; loadDb(); } });
let dbT; $('db-q').addEventListener('input', () => { clearTimeout(dbT); dbT = setTimeout(() => { DB.page = 1; loadDb(); }, 400); });

// ---------- Referral links ----------
function renderLinks() {
  const id = $('l-camp').value;
  if (!id) { $('l-body').innerHTML = '<tr><td colspan="5" class="empty">Select a campaign above.</td></tr>'; return; }
  const rows = S.D.links.filter(l => l.campaign_id === id);
  $('l-body').innerHTML = rows.length ? rows.map(l => {
    const cv = S.D.conversions.filter(c => c.ref_id === l.ref_id && c.campaign_id === id);
    const earned = cv.filter(c => String(c.ref_status).toUpperCase() !== 'REJECTED').reduce((s, c) => s + (Number(c.ref_payout) || 0), 0);
    return '<tr><td><b>' + esc(l.ref_name || l.ref_mobile || 'Unknown') + '</b><br><span class="mono">' + esc(l.upi) + '</span>' + (l.ref_name && l.ref_mobile ? '<br><span class="small">📱 ' + esc(l.ref_mobile) + '</span>' : '') + '</td><td class="small" style="word-break:break-all;max-width:250px;color:var(--violet)"><a href="' + esc(l.generated_link) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + esc(l.generated_link) +
      '</a></td><td class="small">' + esc(fmtDate(l.created_at)) + '</td><td style="text-align:center;color:var(--emerald);font-weight:700">' + cv.length + '</td><td class="amt">' + inr(earned) + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">No links generated for this campaign yet.</td></tr>';
}
$('l-camp').addEventListener('change', renderLinks);

// ---------- Payments ----------
// What was already paid to the user for this lead (a lead with several events can be paid in parts)
const userPaid = c => (S.D.payments || []).filter(p => String(p.conversion_id) === String(c.id) && p.pay_type === 'USER').reduce((s, p) => s + (Number(p.amount) || 0), 0);
const dueOf = c => Math.max(0, Math.round(((Number(c.user_payout) || 0) - userPaid(c)) * 100) / 100);
function partyCell(c, party) {
  const st = String(party === 'USER' ? c.user_status : c.ref_status).toUpperCase();
  const amt = party === 'USER' ? dueOf(c) : c.ref_payout;
  const paidNote = party === 'USER' && userPaid(c) > 0 ? '<div class="small">Paid ' + inr(userPaid(c)) + ' of ' + inr(c.user_payout) + '</div>' : '';
  if (st === 'NA') return '—';
  if (party === 'REFERRER' && st === 'CREDITED') return '<span class="badge b-ok">IN WALLET</span> <span class="amt">' + inr(amt) + '</span><div class="acts" style="margin-top:6px"><button class="mini danger" data-act="rej" data-id="' + c.id + '" data-party="REFERRER">Reverse</button></div>';
  if (party === 'REFERRER' && st === 'PENDING') return '<span class="amt">' + inr(amt) + '</span><div class="small">No wallet credit yet</div>';
  if (st === 'PAID') return '<span class="badge b-ok">PAID</span>';
  if (st === 'REJECTED') return '<span class="badge b-bad">REJECTED</span>' + ((party === 'USER' ? c.user_note : c.ref_note) ? '<div class="small">' + esc(party === 'USER' ? c.user_note : c.ref_note) + '</div>' : '');
  return '<span class="amt">' + inr(amt) + '</span>' + paidNote + '<div class="acts" style="margin-top:6px"><button class="mini ok" data-act="pay" data-id="' + c.id + '" data-party="' + party + '">Pay</button><button class="mini danger" data-act="rej" data-id="' + c.id + '" data-party="' + party + '">Reject</button></div>';
}
function renderPay() {
  const id = $('p-camp').value, q = $('p-q').value;
  if (!id) { $('p-body').innerHTML = '<tr><td colspan="5" class="empty">Select a campaign above.</td></tr>'; return; }
  const rows = S.D.conversions.filter(c => c.campaign_id === id && !(DONE.includes(String(c.user_status).toUpperCase()) && DONE.includes(String(c.ref_status).toUpperCase())) && matchQ(q, c.name, c.upi, c.mobile, c.ref_name, c.ref_mobile, c.ref_upi));
  $('p-body').innerHTML = rows.length ? rows.map(c => '<tr><td>' + userCell(c.name, c.upi, c.mobile, '') + '</td><td>' + (c.ref_id === 'DIRECT' ? '<span class="mono">Direct</span>' : '<b>' + esc(c.ref_name || c.ref_mobile || 'Referrer') + '</b><br><span class="mono">' + esc(c.ref_upi) + '</span>') +
    '</td><td><span class="badge ' + statusClass(finalOf(c)) + '">' + finalOf(c) + '</span></td><td>' + partyCell(c, 'USER') + '</td><td>' + partyCell(c, 'REFERRER') + '</td></tr>').join('')
    : '<tr><td colspan="5" class="empty">No pending payment entries for this campaign.</td></tr>';
}
$('p-camp').addEventListener('change', renderPay); $('p-q').addEventListener('input', renderPay);

function convById(id) { return S.D.conversions.find(c => String(c.id) === String(id)); }
function payee(c, party) { return party === 'USER' ? { name: c.name || 'No name', upi: c.upi, amt: dueOf(c) } : { name: c.ref_name || c.ref_mobile, upi: c.ref_upi, amt: c.ref_payout }; }
function openPay(id, party) {
  const c = convById(id); if (!c) return; const p = payee(c, party);
  if (finalOf(c) !== 'SUCCESSFUL' && !confirm('Final status is ' + finalOf(c) + ' ). Pay anyway?')) return;
  S.ctx = { id, party, kind: 'conv' };
  $('mp-title').textContent = 'Pay ' + p.name + ' (' + party + ')'; $('mp-owed').textContent = 'Amount: ' + inr(p.amt) + ' • UPI: ' + p.upi;
  $('mp-amt').value = Number(p.amt) || ''; $('mp-txn').value = ''; $('mp-note').value = ''; $('mp-msg').textContent = ''; $('m-pay').classList.add('show');
}
function openRej(id, party) {
  const c = convById(id); if (!c) return; const p = payee(c, party);
  S.ctx = { id, party, kind: 'conv' }; $('mr-title').textContent = (party === 'REFERRER' ? 'Reverse wallet credit: ' : 'Reject ') + p.name; $('mr-owed').textContent = 'Amount: ' + inr(p.amt) + ' • UPI: ' + p.upi; $('mr-note').value = ''; $('mr-msg').textContent = ''; $('m-rej').classList.add('show');
}
$('mp-ok').addEventListener('click', async () => {
  const txn = $('mp-txn').value.trim(), amount = Number($('mp-amt').value);
  if (!txn) { $('mp-msg').textContent = 'Please enter Transaction ID.'; $('mp-msg').className = 'msg err'; return; }
  if (!amount) { $('mp-msg').textContent = 'Please enter Amount.'; $('mp-msg').className = 'msg err'; return; }
  $('mp-ok').disabled = true;
  try {
    if (S.ctx.kind === 'wd') { await call('/withdrawals/' + encodeURIComponent(S.ctx.id) + '/pay', { method: 'POST', body: { txnId: txn, note: $('mp-note').value } }); $('m-pay').classList.remove('show'); await loadAll(); renderWd(); }
    else { await call('/pay', { method: 'POST', body: { conversionId: S.ctx.id, party: S.ctx.party, amount, txnId: txn, note: $('mp-note').value } }); $('m-pay').classList.remove('show'); await loadAll(); renderPay(); }
  }
  catch (e) { $('mp-msg').textContent = e.message; $('mp-msg').className = 'msg err'; }
  $('mp-ok').disabled = false;
});
$('mr-ok').addEventListener('click', async () => {
  $('mr-ok').disabled = true;
  try {
    if (S.ctx.kind === 'wd') { await call('/withdrawals/' + encodeURIComponent(S.ctx.id) + '/reject', { method: 'POST', body: { note: $('mr-note').value } }); $('m-rej').classList.remove('show'); await loadAll(); renderWd(); }
    else { await call('/reject', { method: 'POST', body: { conversionId: S.ctx.id, party: S.ctx.party, note: $('mr-note').value } }); $('m-rej').classList.remove('show'); await loadAll(); renderPay(); }
  }
  catch (e) { $('mr-msg').textContent = e.message; $('mr-msg').className = 'msg err'; }
  $('mr-ok').disabled = false;
});

// ---------- Payment log ----------
function renderLog() {
  const q = $('g-q').value, rows = S.D.payments.filter(p => matchQ(q, p.name, p.upi, p.campaign, p.transaction_id));
  $('g-body').innerHTML = rows.length ? rows.map(p => '<tr><td><b>' + esc(p.name) + '</b><br><span class="mono">' + esc(p.upi) + '</span></td><td style="font-weight:700;color:var(--violet)">' + esc(p.campaign) + '</td><td><span class="badge b-wait">' + esc(p.pay_type) +
    '</span></td><td class="amt">' + inr(p.amount) + '</td><td class="small">' + esc(fmtDate(p.created_at)) + '</td><td class="mono">' + esc(p.transaction_id) + '</td></tr>').join('')
    : '<tr><td colspan="6" class="empty">No payment log found.</td></tr>';
}
$('g-q').addEventListener('input', renderLog);

// ---------- Analytics ----------
function chart(id, cfg) { if (S.charts[id]) S.charts[id].destroy(); S.charts[id] = new Chart($(id).getContext('2d'), cfg); }
async function loadAnalytics() {
  try {
    const r = await call('/analytics'), k = r.kpi;
    $('k-clicks').textContent = k.clicks; $('k-total').textContent = k.total; $('k-success').textContent = k.success; $('k-pending').textContent = k.pending; $('k-rejected').textContent = k.rejected; $('k-paid').textContent = inr(k.totalPaid); $('k-owed').textContent = inr(k.walletOwed); $('k-wd').textContent = k.pendingWd;
    if (typeof Chart === 'undefined') return;
    const tick = { ticks: { color: '#4A5885' }, grid: { color: 'rgba(10,26,92,.1)' }, beginAtZero: true };
    chart('ch-pie', { type: 'pie', data: { labels: ['Paid', 'Awaiting payment', 'Rejected'], datasets: [{ data: [k.success, k.pending, k.rejected], backgroundColor: ['#5DB32B', '#F0A500', '#D14343'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#0A1A5C' } } } } });
    const cn = Object.keys(r.byCampaign);
    chart('ch-camp', { type: 'bar', data: { labels: cn.length ? cn : ['No Data'], datasets: [{ label: 'Leads', data: cn.length ? Object.values(r.byCampaign) : [0], backgroundColor: '#0A9AF5', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ...tick, beginAtZero: false }, y: tick }, plugins: { legend: { display: false } } } });
    const top = r.topReferrers;
    chart('ch-lead', { type: 'bar', data: { labels: top.length ? top.map(t => t[0]) : ['No Referrers'], datasets: [{ label: 'Leads Driven', data: top.length ? top.map(t => t[1]) : [0], backgroundColor: '#5DB32B', borderRadius: 6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: tick, y: { ticks: { color: '#0A1A5C' }, grid: { color: 'rgba(10,26,92,.1)' } } }, plugins: { legend: { display: false } } } });
  } catch (e) { console.error(e); }
}

// ---------- Postback URLs ----------
S.pb = [];
async function copyText(t, btn) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  if (btn) { const o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = o, 1400); }
}
async function openPb(id) {
  try {
    const r = await call('/campaigns/' + encodeURIComponent(id) + '/postback');
    S.pb = [...r.urls, ...r.links].map(x => x.url);
    const row = (x, i) => '<label>' + esc(x.label) + '</label><div class="hint mono" style="word-break:break-all;user-select:all">' + esc(x.url) + '</div><button class="mini" data-act="copy" data-i="' + i + '" style="margin-top:6px">Copy</button>';
    $('pb-title').textContent = 'Postback — ' + r.name;
    $('pb-note').textContent = 'Give the Postback URL to your advertiser/network. Keep {click_id} (their click ID) and {' + r.macro + '} (our Click ID comes back through it) exactly as they are; the network replaces them. If the network uses other macro names, rename only the part inside { }. Campaign ID ' + id + ' is already inside. The time of each event is the moment the postback arrives.' + (r.secretSet ? '' : ' ⚠ POSTBACK_SECRET is not set on the server, so this URL is open to anyone.');
    $('pb-list').innerHTML = '<h3 style="margin-top:14px">Postback URLs</h3>' + r.urls.map((x, i) => row(x, i)).join('') +
      '<h3 style="margin-top:20px">Public links for this campaign</h3>' + r.links.map((x, i) => row(x, r.urls.length + i)).join('') +
      '<h3 style="margin-top:20px">Last 10 postbacks received</h3>' + ((r.recent || []).length ? r.recent.map(x => '<div class="small" style="margin:6px 0"><span class="badge ' + (/^OK/.test(x.result) ? 'b-ok' : x.result === 'DUPLICATE' ? 'b-wait' : 'b-bad') + '">' + esc(x.result) + '</span> ' + esc(fmtDate(x.created_at)) + ' · ' + esc(x.event_name || 'no event') + '<br><span class="mono">' + esc(x.click_id || '-') + ' / network: ' + esc(x.network_click_id || '-') + '</span></div>').join('') : '<div class="small">Nothing received yet.</div>');
    $('m-pb').classList.add('show');
  } catch (e) { alert(e.message); }
}

// ---------- Withdrawals ----------
const wdById = id => S.D.withdrawals.find(w => w.withdrawal_id === id);
function updWdBadge() {
  const n = (S.D.withdrawals || []).filter(w => w.status === 'PENDING').length;
  $('wd-badge').textContent = n; $('wd-badge').classList.toggle('hidden', !n);
}
function renderWd() {
  const f = $('wd-f').value, rows = (S.D.withdrawals || []).filter(w => f === 'ALL' || w.status === f);
  $('wd-body').innerHTML = rows.length ? rows.map(w => {
    const st = String(w.status).toUpperCase();
    const act = st === 'PENDING' ? '<div class="acts"><button class="mini ok" data-act="wdpay" data-id="' + esc(w.withdrawal_id) + '">Pay</button><button class="mini danger" data-act="wdrej" data-id="' + esc(w.withdrawal_id) + '">Reject</button></div>'
      : '<div class="small">' + (w.txn_id ? 'Txn: <span class="mono">' + esc(w.txn_id) + '</span>' : '') + (w.admin_note ? '<br>' + esc(w.admin_note) : '') + '</div>';
    return '<tr><td><b>' + esc(w.ref_name || w.ref_mobile || w.name) + '</b><br><span class="mono">' + esc(w.upi) + '</span>' + (w.ref_name && w.ref_mobile ? '<br><span class="small">📱 ' + esc(w.ref_mobile) + '</span>' : '') + '</td><td class="amt">' + inr(w.amount) + '</td><td class="small">' + esc(fmtDate(w.created_at)) + '</td><td><span class="badge ' + statusClass(st) + '">' + esc(st) + '</span></td><td>' + act + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">No withdrawal requests here.</td></tr>';
}
$('wd-f').addEventListener('change', renderWd);
function openWdPay(id) {
  const w = wdById(id); if (!w) return;
  S.ctx = { id, kind: 'wd' };
  $('mp-title').textContent = 'Pay withdrawal — ' + (w.ref_name || w.ref_mobile || w.name); $('mp-owed').textContent = 'Send ' + inr(w.amount) + ' to UPI: ' + w.upi;
  $('mp-amt').value = Number(w.amount) || ''; $('mp-txn').value = ''; $('mp-note').value = ''; $('mp-msg').textContent = ''; $('m-pay').classList.add('show');
}
function openWdRej(id) {
  const w = wdById(id); if (!w) return;
  S.ctx = { id, kind: 'wd' };
  $('mr-title').textContent = 'Reject withdrawal — ' + (w.ref_name || w.ref_mobile || w.name); $('mr-owed').textContent = inr(w.amount) + ' will go back into their wallet.'; $('mr-note').value = ''; $('mr-msg').textContent = ''; $('m-rej').classList.add('show');
}

// ---------- Send to Sheets ----------
const sm = (t, c) => { $('s-msg').textContent = t; $('s-msg').className = 'msg ' + (c || ''); };
async function loadSheets() {
  try {
    const r = await call('/sync/status');
    if (!r.configured) sm('Sheets is not connected yet: set SHEETS_WEBHOOK_URL and SHEETS_SECRET on Render.', 'err'); else sm('');
    $('s-body').innerHTML = Object.entries(r.tables).map(([k, v]) => '<tr><td><b>' + esc(v.sheet) + '</b></td><td class="amt">' + (v.all ? 'all (refreshed each time)' : v.pending + ' new/edited') +
      '</td><td><button class="mini" data-act="push" data-t="' + k + '">Send</button></td></tr>').join('');
    $('s-log').innerHTML = r.log.length ? r.log.map(l => '<tr><td class="small">' + esc(fmtDate(l.created_at)) + '</td><td>' + esc(l.table_name) + '</td><td>' + l.rows_sent + '</td><td><span class="badge ' + (l.status === 'OK' ? 'b-ok' : 'b-bad') + '">' + esc(l.status) + '</span>' + (l.message ? '<div class="small">' + esc(l.message) + '</div>' : '') + '</td></tr>').join('')
      : '<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>';
  } catch (e) { sm(e.message, 'err'); }
}
async function pushSheets(tables, btn) {
  const all = !tables; document.querySelectorAll('#screen-sheets button').forEach(b => b.disabled = true);
  sm('Sending to Google Sheets... please wait.', 'ok');
  try {
    const r = await call('/sync/push', { method: 'POST', body: { tables } });
    const bad = Object.entries(r.result).filter(([, v]) => !v.ok), sent = Object.values(r.result).reduce((s, v) => s + (v.sent || 0), 0);
    if (bad.length) sm('Some tabs failed: ' + bad.map(([k, v]) => k + ' (' + v.error + ')').join('; '), 'err'); else sm('✅ Done. ' + sent + ' rows sent.', 'ok');
  } catch (e) { sm(e.message, 'err'); }
  document.querySelectorAll('#screen-sheets button').forEach(b => b.disabled = false);
  loadSheets();
}
$('s-all').addEventListener('click', () => pushSheets(null));

if (S.token) applyLogin();
