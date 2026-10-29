let camps = [], sel = null;
const msg = (t, c) => { $('msg').textContent = t; $('msg').className = 'msg ' + (c || ''); };

(async function () {
  try {
    const r = await api('/api/campaigns/active');
    camps = r.campaigns;
    $('camp').innerHTML = camps.length
      ? '<option value="">-- Select a campaign --</option>' + camps.map(c => '<option value="' + esc(c.campaign_id) + '">' + esc(c.campaign_name) + ' (₹' + esc(c.total_payout) + ')</option>').join('')
      : '<option value="">No active campaigns available</option>';
    // /gen/<campaign id> opens with that campaign already selected
    const want = (location.pathname.split('/').filter(Boolean)[1] || '').toUpperCase();
    if (want) {
      if (camps.some(c => c.campaign_id.toUpperCase() === want)) {
        $('camp').value = camps.find(c => c.campaign_id.toUpperCase() === want).campaign_id;
        $('camp').dispatchEvent(new Event('change')); $('camp').disabled = true;
      } else { $('camp').innerHTML = '<option value="">This campaign is not available</option>'; msg('This campaign link is not active or does not exist.', 'err'); }
    }
  } catch (e) { $('camp').innerHTML = '<option value="">Error loading campaigns</option>'; }
})();

function labels(u, r) { $('ua').textContent = '₹' + u; $('ra').textContent = '₹' + r; }
$('camp').addEventListener('change', () => {
  sel = camps.find(c => c.campaign_id === $('camp').value) || null;
  $('res').classList.remove('show');
  if (!sel) { $('slider').disabled = true; $('gen').disabled = true; labels(0, 0); $('rule').classList.add('hidden'); return; }
  const total = Number(sel.total_payout) || 0, def = Number(sel.user_default_payout) || total;
  Object.assign($('slider'), { min: 0, max: total, value: def, disabled: false });
  $('gen').disabled = false; labels(def, total - def);
  $('rt').textContent = sel.instructions || 'Follow standard campaign rules.'; $('rule').classList.remove('hidden');
});
$('slider').addEventListener('input', () => { if (sel) { const u = Number($('slider').value); labels(u, (Number(sel.total_payout) || 0) - u); } });
$('rx').addEventListener('click', () => $('rule').classList.add('hidden'));

$('gen').addEventListener('click', async () => {
  const upi = $('upi').value.trim(), name = $('name').value.trim();
  msg('');
  if (!upi || !name || !sel) return msg('Please fill UPI, Name, and select a campaign.', 'err');
  if (!upi.includes('@')) return msg('Please enter a valid UPI ID', 'err');
  $('gen').disabled = true; $('gen').textContent = 'Generating...';
  try {
    const r = await api('/api/links/generate', { method: 'POST', body: { upi, name, campaignId: sel.campaign_id, customUserPayout: Number($('slider').value) } });
    msg(r.isExisting ? 'Existing link retrieved.' : 'Link generated successfully!', 'ok');
    $('lt').textContent = r.generatedLink; $('res').classList.add('show');
  } catch (e) { msg(e.message, 'err'); }
  $('gen').disabled = false; $('gen').textContent = 'Generate Link';
});

$('copy').addEventListener('click', async () => {
  const t = $('lt').textContent;
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  $('copy').textContent = 'Copied!'; setTimeout(() => $('copy').textContent = 'Copy Link', 1500);
});
