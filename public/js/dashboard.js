let creds = null, D = null;

const lm = (t, c) => { $('lm').textContent = t; $('lm').className = 'msg ' + (c || ''); };
async function fetchData() { return api('/api/partner/login', { method: 'POST', body: creds }); }

$('lb').addEventListener('click', async () => {
  const mobile = $('rn').value.trim(), upi = $('ru').value.trim();
  if (!mobile || !upi) return lm('Please enter both your Mobile Number and UPI ID.', 'err');
  if (!/^[6-9]\d{9}$/.test(mobile.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))) return lm('Please enter a valid 10-digit Mobile Number.', 'err');
  creds = { mobile, upi }; lm('Verifying account details...');
  $('lb').disabled = true;
  try { D = await fetchData(); showDash(); } catch (e) { lm(e.message, 'err'); creds = null; }
  $('lb').disabled = false;
});

function showDash() {
  $('loginS').classList.add('hidden'); $('dashS').classList.remove('hidden');
  $('pn').textContent = D.referrer.mobile || '-'; $('pu').textContent = D.referrer.upi;
  renderWallet(); fillCampaigns(); renderReports();
}

$('rf').addEventListener('click', async () => {
  $('rf').disabled = true; $('rf').textContent = 'Updating...';
  try { D = await fetchData(); showDash(); } catch (e) { alert('Failed to refresh: ' + e.message); }
  $('rf').disabled = false; $('rf').textContent = '⟳ Refresh Data';
});
$('lo').addEventListener('click', () => {
  creds = null; D = null; $('rn').value = ''; $('ru').value = ''; lm('');
  $('wform').classList.add('hidden'); $('dashS').classList.add('hidden'); $('loginS').classList.remove('hidden');
  resetFilters(); R.tab = 'ref';
});

// ---------- Wallet ----------
const wmsg = (t, c) => { $('wmsg').textContent = t; $('wmsg').style.color = c === 'err' ? '#ff8fa0' : '#4ade9a'; };
function renderWallet() {
  const w = D.wallet;
  $('wb').textContent = inr(w.balance); $('wte').textContent = inr(w.earned); $('wtw').textContent = inr(w.withdrawn); $('wtp').textContent = inr(w.pending);
  $('whint').textContent = 'Minimum ' + inr(w.min) + '. Money is sent to your registered UPI: ' + D.referrer.upi + '. One request at a time.';
}
$('wbtn').addEventListener('click', () => { $('wform').classList.toggle('hidden'); wmsg(''); if (D && !$('wform').classList.contains('hidden')) $('wamt').value = D.wallet.balance > 0 ? D.wallet.balance : ''; });
$('wgo').addEventListener('click', async () => {
  const amount = Number($('wamt').value);
  if (!amount || amount <= 0) return wmsg('Please enter a valid amount.', 'err');
  $('wgo').disabled = true; wmsg('Sending request...', 'ok');
  try {
    const r = await api('/api/partner/withdraw', { method: 'POST', body: { ...creds, amount } });
    D = await fetchData(); R.tab = 'wd'; resetFilters(); showDash(); wmsg(r.message, 'ok'); $('wamt').value = '';
  } catch (e) { wmsg(e.message, 'err'); }
  $('wgo').disabled = false;
});

// ---------- Reports: Referrals | Withdrawals | Wallet Statement ----------
const PAGE = 50;
const R = { tab: 'ref', shown: PAGE };
const REASON = { CONVERSION: 'Referral earning', REVERSAL: 'Earning reversed', WITHDRAWAL: 'Withdrawal requested', WITHDRAWAL_REFUND: 'Withdrawal rejected (refunded)' };

// Dates are shown in Indian time, so the period filter counts days in Indian time as well.
const istKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const shift = (key, days) => { const t = new Date(key + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
function range() {
  const p = $('f-per').value, today = istKey(Date.now());
  if (p === 'TODAY') return [today, today];
  if (p === 'YESTERDAY') return [shift(today, -1), shift(today, -1)];
  if (p === '7D') return [shift(today, -6), today];
  if (p === '30D') return [shift(today, -29), today];
  if (p === 'MONTH') return [today.slice(0, 8) + '01', today];
  if (p === 'LASTMONTH') { const first = today.slice(0, 8) + '01', last = shift(first, -1); return [last.slice(0, 8) + '01', last]; }
  if (p === 'CUSTOM') return [$('f-from').value || '', $('f-to').value || ''];
  return ['', ''];
}
const inPeriod = iso => { if (!iso) return false; const [a, b] = range(), k = istKey(iso); return (!a || k >= a) && (!b || k <= b); };
const hit = (q, ...f) => !q || f.join(' ').toLowerCase().includes(q.toLowerCase());
const sumOf = (rows, f) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
const cashState = l => { const s = String(l.user_status || '').toUpperCase(); return s === 'PAID' ? 'PAID' : s.includes('REJECT') ? 'REJECTED' : 'PENDING'; };
const tile = (label, val, sub, cls) => '<div class="tile ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + val + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
const bd = (cls, t) => '<span class="bd ' + cls + '">' + esc(t) + '</span>';

function fillCampaigns() {
  const cur = $('f-camp').value, names = [...new Set(D.leads.map(l => l.campaign).filter(Boolean))].sort();
  $('f-camp').innerHTML = '<option value="">All Campaigns</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('');
  if (names.includes(cur)) $('f-camp').value = cur;
}
function setStatusOptions() {
  const opts = { ref: ['Cashback Status', ['', 'All'], ['PAID', 'Paid'], ['PENDING', 'Pending'], ['REJECTED', 'Rejected']],
                 wd: ['Status', ['', 'All'], ['PENDING', 'Pending'], ['PAID', 'Paid'], ['REJECTED', 'Rejected']],
                 led: ['Type', ['', 'All'], ['CREDIT', 'Credits'], ['DEBIT', 'Debits']], arc: ['Status', ['', 'All']] }[R.tab];
  $('f-stl').textContent = opts[0];
  const cur = $('f-st').value;
  $('f-st').innerHTML = opts.slice(1).map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');
  if (opts.slice(1).some(o => o[0] === cur)) $('f-st').value = cur;
}

// the rows currently selected by the filters, for the active tab
function rowsNow() {
  const q = $('f-q').value.trim(), st = $('f-st').value, camp = $('f-camp').value;
  if (R.tab === 'ref') return D.leads.filter(l => inPeriod(l.created_at) && (!camp || l.campaign === camp) && (!st || cashState(l) === st) &&
    hit(q, l.campaign, l.campaign_id, l.mobile, l.upi, l.events.map(e => e.name).join(' ')));
  if (R.tab === 'wd') return D.withdrawals.filter(w => inPeriod(w.created_at) && (!st || w.status === st) && hit(q, w.txn_id, w.admin_note, w.withdrawal_id));
  if (R.tab === 'arc') return D.archived.filter(a => inPeriod(a.deleted_at) && hit(q, a.campaign_name, a.campaign_id));
  return D.history.filter(h => inPeriod(h.created_at) && (!st || h.entry_type === st) && hit(q, REASON[h.reason] || h.reason, h.campaign_name, h.note));
}

function renderReports() {
  setStatusOptions();
  if (R.tab === 'arc' && !D.archived.length) R.tab = 'ref';
  $('t-arc').classList.toggle('hidden', !D.archived.length);
  $('t-ref').classList.toggle('on', R.tab === 'ref'); $('t-wd').classList.toggle('on', R.tab === 'wd'); $('t-led').classList.toggle('on', R.tab === 'led'); $('t-arc').classList.toggle('on', R.tab === 'arc');
  $('f-campw').classList.toggle('hidden', R.tab !== 'ref'); $('f-stw').classList.toggle('hidden', R.tab === 'arc');
  $('f-cust').classList.toggle('hidden', $('f-per').value !== 'CUSTOM');
  $('f-q').placeholder = { ref: 'Search campaign, number, UPI, event...', wd: 'Search transaction ID...', led: 'Search details...', arc: 'Search campaign name...' }[R.tab];
  const rows = rowsNow(), part = rows.slice(0, R.shown);
  let tiles = '', head = '', body = '';

  if (R.tab === 'ref') {
    const earned = sumOf(rows.filter(l => String(l.ref_status).toUpperCase() === 'CREDITED'), l => l.ref_payout);
    const disbursed = sumOf(rows, l => l.paid);
    const due = sumOf(rows.filter(l => cashState(l) === 'PENDING'), l => Math.max(0, l.user_payout - l.paid));
    tiles = tile('Referrals', rows.length, 'in selected period') + tile('Commission Earned', inr(earned), 'credited to your wallet', 'g') +
      tile('Total Amount Disbursed', inr(disbursed), 'cashback paid to your users', 'hl') + tile('Cashback Pending', inr(due), 'yet to be paid to users');
    head = '<tr><th>Date &amp; Time</th><th>Campaign</th><th>Number / UPI</th><th>Events Achieved</th><th class="num">Your Commission</th><th class="num">User Cashback</th></tr>';
    body = part.map(l => {
      const ev = l.events.length ? l.events.map(e => '<span class="ev">✓ ' + esc(e.name) + '<small>' + esc(fmtDate(e.at || l.created_at)) + '</small></span>').join('') : '—';
      const rs = String(l.ref_status).toUpperCase();
      const com = rs === 'REJECTED' ? '<b>' + inr(0) + '</b><br>' + bd('bad', 'Reversed') : '<b>' + inr(l.ref_payout) + '</b><br>' + (rs === 'CREDITED' ? bd('ok', 'Credited') : bd('wait', 'Pending'));
      const cs = cashState(l);
      const cash = cs === 'REJECTED' ? bd('bad', 'Rejected') : l.user_payout <= 0 && l.paid <= 0 ? '—'
        : cs === 'PAID' ? '<b>' + inr(l.paid) + '</b><br>' + bd('ok', 'Paid') + (l.paid_at ? '<br><small style="color:var(--mute)">' + esc(fmtDate(l.paid_at)) + '</small>' : '')
        : l.paid > 0 ? '<b>' + inr(l.paid) + '</b> of ' + inr(l.user_payout) + '<br>' + bd('wait', 'Part paid')
        : '<b>' + inr(l.user_payout) + '</b><br>' + bd('wait', 'Pending');
      return '<tr><td data-label="Date &amp; Time" style="white-space:nowrap">' + esc(fmtDate(l.created_at)) + '</td><td data-label="Campaign"><b>' + esc(l.campaign) + '</b></td>' +
        '<td data-label="Number / UPI">' + (l.mobile ? '<span class="mono"><b>' + esc(l.mobile) + '</b></span><br>' : '') + '<span class="mono">' + esc(l.upi) + '</span></td>' +
        '<td data-label="Events">' + ev + '</td><td data-label="Your Commission" class="num">' + com + '</td><td data-label="User Cashback" class="num">' + cash + '</td></tr>';
    }).join('');
  } else if (R.tab === 'wd') {
    tiles = tile('Requests', rows.length, 'in selected period') + tile('Withdrawn', inr(sumOf(rows.filter(w => w.status === 'PAID'), w => w.amount)), 'paid to your UPI', 'hl') +
      tile('Pending', inr(sumOf(rows.filter(w => w.status === 'PENDING'), w => w.amount)), 'awaiting payment', 'g') + tile('Rejected', inr(sumOf(rows.filter(w => w.status === 'REJECTED'), w => w.amount)), 'refunded to wallet');
    head = '<tr><th>Requested On</th><th class="num">Amount</th><th>Status</th><th>Transaction ID</th><th>Processed On</th><th>Remarks</th></tr>';
    body = part.map(w => '<tr><td data-label="Requested On" style="white-space:nowrap">' + esc(fmtDate(w.created_at)) + '</td><td data-label="Amount" class="num"><b>' + inr(w.amount) + '</b></td>' +
      '<td data-label="Status">' + (w.status === 'PAID' ? bd('ok', 'Paid') : w.status === 'REJECTED' ? bd('bad', 'Rejected') : bd('wait', 'Pending')) + '</td>' +
      '<td data-label="Transaction ID"><span class="mono">' + esc(w.txn_id || '—') + '</span></td><td data-label="Processed On" style="white-space:nowrap">' + (w.processed_at ? esc(fmtDate(w.processed_at)) : '—') + '</td>' +
      '<td data-label="Remarks">' + esc(w.admin_note || '—') + '</td></tr>').join('');
  } else if (R.tab === 'arc') {
    tiles = tile('Deleted Campaigns', rows.length, 'totals only') + tile('Commission Earned', inr(sumOf(rows, a => a.commission)), 'from these campaigns', 'g') +
      tile('Total Amount Disbursed', inr(sumOf(rows, a => a.disbursed)), 'cashback paid to your users', 'hl') + tile('Clicks / Leads', sumOf(rows, a => a.clicks) + ' / ' + sumOf(rows, a => a.leads), 'across these campaigns');
    head = '<tr><th>Campaign</th><th class="num">Clicks</th><th class="num">Leads</th><th class="num">Commission Earned</th><th class="num">Cashback Disbursed</th><th>Deleted On</th></tr>';
    body = part.map(a => '<tr><td data-label="Campaign"><b>' + esc(a.campaign_name || a.campaign_id) + '</b></td><td data-label="Clicks" class="num">' + a.clicks + '</td><td data-label="Leads" class="num">' + a.leads +
      '</td><td data-label="Commission Earned" class="num"><b>' + inr(a.commission) + '</b></td><td data-label="Cashback Disbursed" class="num"><b>' + inr(a.disbursed) + '</b></td><td data-label="Deleted On" style="white-space:nowrap">' + esc(fmtDate(a.deleted_at)) + '</td></tr>').join('');
  } else {
    const cr = sumOf(rows.filter(h => h.entry_type === 'CREDIT'), h => h.amount), dr = sumOf(rows.filter(h => h.entry_type === 'DEBIT'), h => h.amount);
    tiles = tile('Credits', inr(cr), 'money added', 'g') + tile('Debits', inr(dr), 'money deducted') + tile('Net Change', (cr - dr < 0 ? '−' : '') + inr(Math.abs(cr - dr)), 'in selected period', 'hl');
    head = '<tr><th>Date &amp; Time</th><th>Details</th><th class="num">Amount</th></tr>';
    body = part.map(h => { const c = h.entry_type === 'CREDIT'; return '<tr><td data-label="Date &amp; Time" style="white-space:nowrap">' + esc(fmtDate(h.created_at)) + '</td><td data-label="Details"><b>' + esc(REASON[h.reason] || h.reason) + '</b>' +
      (h.campaign_name ? '<br><small style="color:var(--mute)">' + esc(h.campaign_name) + '</small>' : '') + '</td><td data-label="Amount" class="num"><b style="color:' + (c ? 'var(--green-d)' : '#B33030') + '">' + (c ? '+' : '−') + inr(h.amount) + '</b></td></tr>'; }).join('');
  }
  $('tiles').innerHTML = tiles; $('rh').innerHTML = head;
  $('rb').innerHTML = body || '<tr><td class="empty" colspan="6">No records found for the selected filters.</td></tr>';
  $('more').classList.toggle('hidden', rows.length <= R.shown);
  $('more').textContent = 'Show more (' + (rows.length - R.shown) + ' remaining)';
  $('rcount').textContent = R.tab === 'arc' ? 'Details of deleted campaigns (users, UPIs, individual leads) are removed. Only these totals are kept.' : rows.length ? 'Showing ' + part.length + ' of ' + rows.length + ' record' + (rows.length === 1 ? '' : 's') + '.' : '';
}

function resetFilters() {
  $('f-per').value = 'ALL'; $('f-from').value = ''; $('f-to').value = ''; $('f-camp').value = ''; $('f-st').value = ''; $('f-q').value = ''; R.shown = PAGE;
}
const redraw = () => { R.shown = PAGE; if (D) renderReports(); };
['t-ref', 't-wd', 't-led', 't-arc'].forEach(id => $(id).addEventListener('click', () => { R.tab = { 't-ref': 'ref', 't-wd': 'wd', 't-led': 'led', 't-arc': 'arc' }[id]; $('f-st').value = ''; $('f-q').value = ''; redraw(); }));
['f-per', 'f-from', 'f-to', 'f-camp', 'f-st'].forEach(id => $(id).addEventListener('change', redraw));
$('f-q').addEventListener('input', redraw);
$('f-reset').addEventListener('click', () => { resetFilters(); redraw(); });
$('more').addEventListener('click', () => { R.shown += PAGE; renderReports(); });

// Excel-friendly CSV of exactly what the filters select (numbers and UPIs are already masked by the server)
$('f-csv').addEventListener('click', () => {
  const rows = rowsNow(); if (!rows.length) return alert('No data to export for the selected filters.');
  let head, data;
  if (R.tab === 'ref') {
    head = ['Date & Time', 'Campaign', 'Number', 'UPI', 'Events Achieved', 'Commission', 'Commission Status', 'User Cashback Amount', 'Cashback Paid', 'Cashback Status', 'Cashback Paid On'];
    data = rows.map(l => [fmtDate(l.created_at), l.campaign, l.mobile, l.upi, l.events.map(e => e.name).join(' + '), l.ref_payout, l.ref_status, l.user_payout, l.paid, cashState(l), l.paid_at ? fmtDate(l.paid_at) : '']);
  } else if (R.tab === 'wd') {
    head = ['Requested On', 'Amount', 'Status', 'Transaction ID', 'Processed On', 'Remarks'];
    data = rows.map(w => [fmtDate(w.created_at), w.amount, w.status, w.txn_id, w.processed_at ? fmtDate(w.processed_at) : '', w.admin_note]);
  } else if (R.tab === 'arc') {
    head = ['Campaign', 'Clicks', 'Leads', 'Commission Earned', 'Cashback Disbursed', 'Deleted On'];
    data = rows.map(a => [a.campaign_name || a.campaign_id, a.clicks, a.leads, a.commission, a.disbursed, fmtDate(a.deleted_at)]);
  } else {
    head = ['Date & Time', 'Details', 'Campaign', 'Type', 'Amount'];
    data = rows.map(h => [fmtDate(h.created_at), REASON[h.reason] || h.reason, h.campaign_name, h.entry_type, h.amount]);
  }
  const cell = v => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const csv = '\ufeff' + [head, ...data].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = { ref: 'Referrals', wd: 'Withdrawals', led: 'Wallet_Statement', arc: 'Deleted_Campaigns' }[R.tab] + '_' + istKey(Date.now()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
});
