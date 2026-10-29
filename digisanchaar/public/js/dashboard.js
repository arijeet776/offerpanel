let creds = null, D = null;

const lm = (t, c) => { $('lm').textContent = t; $('lm').className = 'msg ' + (c || ''); };
async function fetchData() { return api('/api/partner/login', { method: 'POST', body: creds }); }

$('lb').addEventListener('click', async () => {
  const name = $('rn').value.trim(), upi = $('ru').value.trim();
  if (!name || !upi) return lm('Please enter both your Registered Name and UPI ID.', 'err');
  creds = { name, upi }; lm('Verifying account details...');
  $('lb').disabled = true;
  try { D = await fetchData(); showDash(); } catch (e) { lm(e.message, 'err'); creds = null; }
  $('lb').disabled = false;
});

const SHOW = 200;
function showDash() {
  $('loginS').classList.add('hidden'); $('dashS').classList.remove('hidden');
  $('pn').textContent = D.referrer.name || creds.name; $('pu').textContent = D.referrer.upi;
  renderWallet(); renderLeads();
}

// Date | Campaign ID | UPI (centre hidden by the server) | events achieved so far | referral amount
function renderLeads() {
  const rows = D.leads.slice(0, SHOW);
  $('tb').innerHTML = rows.length ? rows.map(l => {
    const ev = l.events.length ? l.events.map(e => '<span class="ev">✓ ' + esc(e.name) + '<small>' + esc(fmtDate(e.at || l.created_at)) + '</small></span>').join('') : '—';
    const rej = String(l.ref_status).toUpperCase() === 'REJECTED';
    return '<tr><td style="font-size:12px;white-space:nowrap">' + esc(fmtDate(l.created_at)) + '</td><td style="font-family:var(--fm);font-size:12px">' + esc(l.campaign_id) +
      '</td><td style="font-family:var(--fm);font-size:12px">' + esc(l.upi) + '</td><td>' + ev + '</td><td style="font-weight:800">' + (rej ? inr(0) + '<br><small>reversed</small>' : inr(l.ref_payout)) + '</td></tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px">No conversions yet</td></tr>';
  $('more').textContent = D.leads.length > SHOW ? 'Showing latest ' + SHOW + ' of ' + D.leads.length + ' conversions.' : '';
}

$('rf').addEventListener('click', async () => {
  $('rf').disabled = true; $('rf').textContent = 'Updating...';
  try { D = await fetchData(); showDash(); } catch (e) { alert('Failed to refresh: ' + e.message); }
  $('rf').disabled = false; $('rf').textContent = '⟳ Refresh Data';
});
$('lo').addEventListener('click', () => { creds = null; D = null; $('rn').value = ''; $('ru').value = ''; lm(''); $('wform').classList.add('hidden'); $('dashS').classList.add('hidden'); $('loginS').classList.remove('hidden'); });

// ---------- Wallet ----------
let wtab = 'h';
const REASON = { CONVERSION: 'Earning', REVERSAL: 'Earning reversed', WITHDRAWAL: 'Withdrawal requested', WITHDRAWAL_REFUND: 'Withdrawal rejected (refund)' };
const wmsg = (t, c) => { $('wmsg').textContent = t; $('wmsg').style.color = c === 'err' ? '#ff8fa0' : '#4ade9a'; };
function renderWallet() {
  const w = D.wallet;
  $('wb').textContent = inr(w.balance); $('wte').textContent = inr(w.earned); $('wtw').textContent = inr(w.withdrawn); $('wtp').textContent = inr(w.pending);
  $('whint').textContent = 'Minimum ' + inr(w.min) + '. Money is sent to your registered UPI: ' + D.referrer.upi + '. One request at a time.';
  if (wtab === 'h') {
    $('wth').innerHTML = '<tr><th>Date</th><th>Details</th><th style="text-align:right">Amount</th></tr>';
    $('wtb').innerHTML = D.history.length ? D.history.map(h => { const cr = h.entry_type === 'CREDIT'; return '<tr><td>' + esc(fmtDate(h.created_at)) + '</td><td>' + esc(REASON[h.reason] || h.reason) + (h.campaign_name ? '<br><small>' + esc(h.campaign_name) + '</small>' : '') + '</td><td style="text-align:right" class="' + (cr ? 'cr' : 'db') + '">' + (cr ? '+' : '−') + inr(h.amount) + '</td></tr>'; }).join('') : '<tr><td colspan="3">No wallet activity yet.</td></tr>';
  } else {
    $('wth').innerHTML = '<tr><th>Date</th><th>Amount</th><th>Status</th></tr>';
    $('wtb').innerHTML = D.withdrawals.length ? D.withdrawals.map(x => '<tr><td>' + esc(fmtDate(x.created_at)) + '</td><td>' + inr(x.amount) + '</td><td><b>' + esc(x.status) + '</b>' + (x.txn_id ? '<br><small>Txn: ' + esc(x.txn_id) + '</small>' : '') + (x.status === 'REJECTED' && x.admin_note ? '<br><small>' + esc(x.admin_note) + '</small>' : '') + '</td></tr>').join('') : '<tr><td colspan="3">No withdrawal requests yet.</td></tr>';
  }
  $('tab-h').classList.toggle('on', wtab === 'h'); $('tab-w').classList.toggle('on', wtab === 'w');
}
$('tab-h').addEventListener('click', () => { wtab = 'h'; renderWallet(); });
$('tab-w').addEventListener('click', () => { wtab = 'w'; renderWallet(); });
$('wbtn').addEventListener('click', () => { $('wform').classList.toggle('hidden'); wmsg(''); if (D && !$('wform').classList.contains('hidden')) $('wamt').value = D.wallet.balance > 0 ? D.wallet.balance : ''; });
$('wgo').addEventListener('click', async () => {
  const amount = Number($('wamt').value);
  if (!amount || amount <= 0) return wmsg('Please enter a valid amount.', 'err');
  $('wgo').disabled = true; wmsg('Sending request...', 'ok');
  try {
    const r = await api('/api/partner/withdraw', { method: 'POST', body: { ...creds, amount } });
    D = await fetchData(); showDash(); wtab = 'w'; renderWallet(); wmsg(r.message, 'ok'); $('wamt').value = '';
  } catch (e) { wmsg(e.message, 'err'); }
  $('wgo').disabled = false;
});
