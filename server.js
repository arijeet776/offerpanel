try { require('dotenv').config(); } catch (e) { /* dotenv optional on Render */ }
const express = require('express');

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1); // number of proxies in front of this app (optional env TRUST_PROXY)
app.disable('x-powered-by');

// Frontend (Netlify) origins allowed to call this API. Comma separated, no trailing slash.
const origins = () => (process.env.FRONTEND_URL || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

// CORS must be first so the browser's preflight (OPTIONS) request is answered before anything else.
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && origins().includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

try { app.use(require('compression')()); } catch (e) { console.warn('[config] compression is not installed: responses are sent uncompressed'); }
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', require('./src/routes/public'));
const postback = require('./src/routes/postback');
app.get('/postback', postback);
app.post('/postback', postback);

// This server is API-only now. Old links that still point at the Render URL are sent to the new frontend:
//   /?cid=X&ref=Y -> /X/Y     /?page=gen -> /gen     /?page=ref -> /referral
app.get('/', (req, res) => {
  const front = origins()[0];
  if (!front) return res.send('Digi Sanchaar API is running.');
  const cid = String(req.query.cid || req.query.CID || '').trim();
  const ref = String(req.query.ref || req.query.p3 || 'DIRECT').trim();
  const page = String(req.query.page || '').toLowerCase();
  let path = '/';
  if (cid && cid !== 'undefined' && cid !== 'null') path = '/' + encodeURIComponent(cid) + '/' + encodeURIComponent(ref);
  else if (page === 'gen') path = '/gen';
  else if (page === 'ref' || page === 'mydashboard') path = '/referral';
  res.redirect(301, front + path);
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Not found.' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Bad request.' });
  console.error('[error]', req.method, req.originalUrl, err.message || err);
  const status = err.status || 500;
  res.status(status).json({ success: false, message: err.publicMessage || 'Server error. Please try again.', ...(err.unpaid ? { unpaid: err.unpaid } : {}) });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Digi Sanchaar API listening on ' + port));
