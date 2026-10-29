// Link format: /<campaign id>/<referral id>   (old ?cid=&ref= links still work)
const qs = new URLSearchParams(location.search);
const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
const fromPath = parts.length && !/\.html$/i.test(parts[0]) ? parts : [];
const cid = (fromPath[0] || qs.get('cid') || qs.get('CID') || '').trim().toUpperCase();
const ref = (fromPath[1] || qs.get('ref') || qs.get('p3') || 'DIRECT').trim().toUpperCase();
let fields = ['MOBILE']; // details this campaign collects (UPI ID is always asked); the admin sets them per campaign

function fail(m) { $('err').textContent = m; $('err').classList.remove('hidden'); }
function show(t, type) { $('msg').textContent = t; $('msg').className = 'msg ' + (type || ''); $('msg').style.display = t ? 'block' : 'none'; }

(async function init() {
  try {
    const c = await api('/api/campaign-info?cid=' + encodeURIComponent(cid) + '&ref=' + encodeURIComponent(ref));
    const live = c.status === 'ACTIVE';
    $('main').classList.remove('hidden');
    $('cname').textContent = c.name;
    $('price').textContent = '₹' + c.userPayout;
    $('tag').textContent = live ? 'LIVE' : 'INACTIVE';
    $('tag').classList.toggle('off', !live);
    $('ring').style.setProperty('--ring', live ? '#5DB32B' : '#ef4444');
    if (!live) { $('cdot').style.background = '#ef4444'; $('btn').disabled = true; $('bt').textContent = 'Offer is not active'; }
    const fb = () => { $('ringin').textContent = c.name.slice(0, 3).toUpperCase(); };
    if (c.logo) { const i = new Image(); i.alt = c.name; i.onerror = fb; i.src = c.logo; $('ringin').appendChild(i); } else fb();
    $('track').href = '/tracker/' + encodeURIComponent(cid); $('track').classList.remove('hidden');
    fields = Array.isArray(c.fields) ? c.fields : ['MOBILE'];
    [['NAME', 'w-name'], ['MOBILE', 'w-mobile'], ['GMAIL', 'w-gmail']].forEach(([k, id]) => $(id).classList.toggle('hidden', !fields.includes(k)));
    // How-to steps: one step per line (a single paragraph is split at full stops, as before)
    const raw = String(c.notes || '').trim();
    let pts = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean), dot = false;
    if (pts.length === 1) { pts = raw.split('.').map(s => s.trim()).filter(Boolean); dot = true; }
    if (pts.length) { pts.forEach(p => { const li = document.createElement('li'); li.textContent = dot ? p + '.' : p; $('nl').appendChild(li); }); $('notes').classList.remove('hidden'); }
  } catch (e) { fail(e.message || 'Offer not found.'); }
})();

$('f').addEventListener('submit', async ev => {
  ev.preventDefault();
  const v = id => $(id).value.trim();
  const name = v('name'), upi = v('upi'), mobile = v('mobile'), gmail = v('gmail');
  if (!upi) return show('Please enter your UPI ID.', 'err');
  if (!upi.includes('@')) return show("Please enter a valid UPI ID (must contain '@').", 'err');
  if (fields.includes('NAME') && !name) return show('Please enter your Name.', 'err');
  if (fields.includes('MOBILE') && !/^\+?\d{10,14}$/.test(mobile.replace(/\s+/g, ''))) return show('Please enter a valid Mobile Number.', 'err');
  if (fields.includes('GMAIL') && !gmail.includes('@')) return show('Please enter a valid Gmail ID.', 'err');
  $('btn').disabled = true; $('bt').textContent = 'Redirecting...'; show('');
  try {
    const r = await api('/api/prelander', { method: 'POST', body: { name, upi, cid, ref, mobile, gmail } });
    $('s2').className = 'step done'; confetti();
    setTimeout(() => { try { window.top.location.href = r.redirectUrl; } catch (e) { location.href = r.redirectUrl; } }, 650);
  } catch (e) {
    $('btn').disabled = false; $('bt').textContent = 'Continue to task →'; show(e.message, 'err');
  }
});

function confetti() {
  const c = $('bg'); c.width = innerWidth; c.height = innerHeight;
  const x = c.getContext('2d'), P = [], C = ['#5DB32B', '#A8D000', '#0A9AF5', '#0A1A5C'];
  for (let i = 0; i < 90; i++) { const a = Math.random() * 6.28, v = 3 + Math.random() * 7; P.push({ x: c.width / 2, y: c.height / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, w: 3 + Math.random() * 5, h: 3 + Math.random() * 5, r: Math.random() * 3, vr: (Math.random() - .5) * .3, c: C[i % 4] }); }
  const s = performance.now();
  (function f(n) {
    const t = (n - s) / 900; x.clearRect(0, 0, c.width, c.height); if (t >= 1) return;
    P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .18; p.r += p.vr; x.save(); x.globalAlpha = 1 - t; x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); });
    requestAnimationFrame(f);
  })(s);
}
