// Offer status tracker. Campaign id comes from the URL: /tracker/<campaign id>
const CID = (location.pathname.split('/').filter(Boolean)[1] || '').trim().toUpperCase();
let lastUpi = '', cached = null, histOpen = false;
const show = (id, on, disp) => { $(id).style.display = on ? (disp || 'block') : 'none'; };
const IST = d => {
  if (!d) return 'N/A';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return p.day + '-' + p.month + '-' + p.year + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second + ' IST';
};

// ---------- sound (can be muted; choice is remembered) ----------
let muted = false, ac = null;
try { muted = localStorage.getItem('ds_muted') === '1'; } catch (e) {}
function ctx() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; try { ac = new A(); } catch (e) { return null; } }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(f, t, d, type, v) {
  if (muted) return; const a = ctx(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f, a.currentTime + t);
    g.gain.setValueAtTime(0.0001, a.currentTime + t); g.gain.exponentialRampToValueAtTime(v || 0.05, a.currentTime + t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + d);
    o.connect(g); g.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + d + 0.05);
  } catch (e) {}
}
const sHello = () => { tone(660, 0, .09, 'square', .045); tone(880, .11, .12, 'square', .05); };
const sFound = () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * .09, i === 3 ? .22 : .12, 'triangle', .07)); };
const sSad = () => { tone(392, 0, .18, 'sine', .06); tone(311, .2, .3, 'sine', .055); };
const sWin = () => { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * .08, i === 4 ? .28 : .1, 'triangle', i > 2 ? .09 : .07)); };
function renderMute() { $('mute').classList.toggle('muted', muted); $('sOn').style.display = muted ? 'none' : 'block'; $('sOff').style.display = muted ? 'block' : 'none'; }
$('mute').addEventListener('click', () => { muted = !muted; try { localStorage.setItem('ds_muted', muted ? '1' : '0'); } catch (e) {} renderMute(); if (!muted) tone(1180, 0, .06, 'sine', .028); });
renderMute();

// ---------- rendering ----------
function renderRecord(r) {
  $('vName').textContent = r.name || 'User';
  $('vClick').textContent = IST(r.clickAt);
  $('vUpd').textContent = r.updatedAt ? IST(r.updatedAt) : 'Task in progress';
  $('vCamp').textContent = r.campaign || 'N/A';
  $('goals').innerHTML = (r.goalsList || []).map((g, i) => {
    const s = String(g.status || 'PENDING').toUpperCase();
    const cls = s === 'SUCCESSFUL' ? 'successful' : s === 'REJECTED' ? 'rejected' : 'pending';
    return '<div class="citem" style="animation-delay:' + (i * 80) + 'ms"><div class="cbadge ' + cls + '">' + (cls === 'successful' ? '✓' : cls === 'rejected' ? '✕' : '⏳') + '</div><div class="gt">' + esc(g.goalName) + '</div><div class="st ' + cls + '">' + (cls === 'successful' ? 'SUCCESSFUL' : cls === 'rejected' ? 'REJECTED' : 'PENDING') + '</div></div>';
  }).join('');
  show('res', true);
  if ((r.goalsList || []).length && r.goalsList.every(g => String(g.status).toUpperCase() === 'SUCCESSFUL')) setTimeout(sWin, 500);
}

async function search() {
  const upi = $('upi').value.trim();
  if (!upi) return alert('Please enter a valid UPI ID.');
  ctx(); sHello();
  show('ld', true); show('err', false); show('res', false); show('back', false); show('hlist', false); show('hchip', false);
  lastUpi = upi; cached = null; histOpen = false; $('hlabel').textContent = '🕑 View Previous Entries';
  try {
    const r = await api('/api/tracker/status', { method: 'POST', body: { upi, cid: CID } });
    show('ld', false);
    if (r.found) { renderRecord(r); sFound(); show('hchip', true); }
    else { $('err').innerHTML = '<strong>No records</strong> found for this UPI ID under this offer. Please check the spelling or try again later.'; show('err', true); sSad(); }
  } catch (e) {
    show('ld', false); $('err').innerHTML = '<strong>' + esc(e.status === 429 ? 'Too many tries.' : 'Error:') + '</strong> ' + esc(e.message); show('err', true); sSad();
  }
}

function listHtml(a) {
  $('hcount').textContent = a.length + (a.length === 1 ? ' entry' : ' entries');
  $('hrows').innerHTML = a.map((x, i) => {
    const st = String(x.overallStatus || 'PENDING').toUpperCase();
    return '<div class="arow" style="animation-delay:' + (i * 60) + 'ms" data-i="' + i + '"><div class="l"><div class="c">' + esc(x.campaign || 'N/A') + '</div><div class="d">' + esc(IST(x.clickAt)) + '</div></div><div class="pill2 ' + st.toLowerCase() + '">' + esc(st) + '</div></div>';
  }).join('');
}
async function toggleHistory() {
  if (histOpen) { show('hlist', false); histOpen = false; $('hlabel').textContent = '🕑 View Previous Entries'; return; }
  if (!cached) {
    show('hld', true);
    try { const r = await api('/api/tracker/history', { method: 'POST', body: { upi: lastUpi } }); cached = r.attempts || []; }
    catch (e) { show('hld', false); $('hrows').innerHTML = '<div class="nohist">' + esc(e.message || 'Could not load previous entries.') + '</div>'; $('hcount').textContent = ''; show('hlist', true); histOpen = true; return; }
    show('hld', false);
  }
  if (cached.length) listHtml(cached); else { $('hrows').innerHTML = '<div class="nohist">No previous entries found for this UPI.</div>'; $('hcount').textContent = ''; }
  show('hlist', true); histOpen = true; $('hlabel').textContent = '▲ Hide Previous Entries';
}
$('hrows').addEventListener('click', e => {
  const row = e.target.closest('.arow'); if (!row || !cached) return;
  renderRecord(cached[Number(row.dataset.i)]); show('hlist', false); histOpen = false; $('hlabel').textContent = '🕑 View Previous Entries'; show('back', true);
  $('res').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('backGo').addEventListener('click', () => { show('back', false); if (cached) { listHtml(cached); show('hlist', true); histOpen = true; $('hlabel').textContent = '▲ Hide Previous Entries'; } });
$('hchip').addEventListener('click', toggleHistory);
$('go').addEventListener('click', search);
$('upi').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
