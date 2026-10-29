const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, { method = 'GET', body, token } = {}) {
  let r;
  try {
    r = await fetch((window.QX_API || '') + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw new Error('Network error. Please check your connection.'); }
  let j;
  try { j = await r.json(); } catch (e) { j = { success: false, message: 'Bad server response' }; }
  if (!r.ok || j.success === false) { const err = new Error(j.message || 'Request failed (' + r.status + ')'); err.status = r.status; err.data = j; throw err; }
  return j;
}

// CSV-safe cell (also blocks spreadsheet formula injection)
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: type || 'text/csv;charset=utf-8;' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const fmtDate = s => s ? new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'N/A';
const dayKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const inr = n => '₹' + (Math.round((Number(n) || 0) * 100) / 100);
function statusClass(v) {
  v = String(v || '').toUpperCase();
  if (['SUCCESSFUL', 'APPROVED', 'PAID', 'ACTIVE', 'CREDITED'].includes(v)) return 'ok';
  if (v.includes('REJECT') || v === 'ENDED') return 'bad';
  return 'wait';
}
