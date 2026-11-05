// Fills the business details into the footer and legal pages from window.SITE_INFO (see site-info.js).
(function () {
  var I = window.SITE_INFO || {}, todo = [];
  var raw = function (k) { var v = I[k]; return v == null ? '' : String(v).trim(); };
  var isTodo = function (v) { return /^REPLACE/i.test(v); };

  document.querySelectorAll('[data-si]').forEach(function (el) {
    var k = el.getAttribute('data-si'), v = raw(k);
    if (!v && k === 'grievanceEmail') v = raw('email');
    if (!v) return;
    if (isTodo(v)) { todo.push(k); el.textContent = '[' + v.replace(/^REPLACE:?\s*/i, 'Add ') + ']'; el.classList.add('si-missing'); return; }
    el.textContent = v;
    var kind = el.getAttribute('data-link');
    if (kind === 'mail' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) el.setAttribute('href', 'mailto:' + v);
    if (kind === 'tel') { var d = v.replace(/\D/g, ''); if (d.length >= 10) el.setAttribute('href', 'tel:+' + (d.length === 10 ? '91' + d : d)); }
  });
  document.querySelectorAll('[data-si="supportHandle"]').forEach(function (el) {
    var m = /telegram\s*@?([A-Za-z0-9_]{4,})/i.exec(raw('supportHandle')); if (!m) return;
    var a = document.createElement('a'); a.href = 'https://t.me/' + m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = raw('supportHandle');
    el.textContent = ''; el.appendChild(a);
  });
  document.querySelectorAll('[data-si-optional]').forEach(function (el) { if (!raw(el.getAttribute('data-si-optional'))) el.style.display = 'none'; });
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  var sec = document.getElementById('sfSecTxt');
  if (sec) sec.textContent = location.protocol === 'https:' ? 'Secure HTTPS' : 'HTTPS secured when live';
  if (todo.length && window.console) console.warn('[site-info] still to fill in public/js/site-info.js:', todo.filter(function (x, i) { return todo.indexOf(x) === i; }).join(', '));
})();
