const crypto = require('crypto');

const secret = () => process.env.ADMIN_TOKEN_SECRET || '';

function sign(payload, ttlMs = 12 * 3600e3) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || !secret()) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p) return res.status(401).json({ success: false, message: 'Please login again.' });
  req.admin = p;
  next();
}

const buckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + '|' + req.baseUrl + req.path;
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
    if (++b.n > max) return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 600000).unref();

module.exports = { sign, verify, safeEq, requireAdmin, rateLimit };
