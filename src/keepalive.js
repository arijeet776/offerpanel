// Keeps the Supabase free-tier project from being paused for inactivity: sends one tiny read query now and then.
// Runs inside this server only (no public route), with the same server-side client the API already uses.
// Every failure is caught and logged, so a network error can never crash the app.
const { sb } = require('./db');

const DAY = 24 * 60 * 60 * 1000;
const MAX_DELAY = 2147483647; // longest delay setTimeout accepts (about 24 days)
// A request that hangs forever must not stop the schedule: give up on it after a while.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('no answer from Supabase after ' + Math.round(ms / 1000) + 's')), ms); if (t.unref) t.unref(); })]);

function start(opts = {}) {
  const client = opts.sb || sb;
  const log = opts.log || console;
  const days = Number(process.env.KEEPALIVE_DAYS) > 0 ? Number(process.env.KEEPALIVE_DAYS) : 3;
  const everyMs = opts.everyMs || days * DAY;          // normal gap between pings
  const retryMs = opts.retryMs || 30 * 60 * 1000;      // after a failed ping, try again soon instead of waiting days
  const firstMs = opts.firstMs != null ? opts.firstMs : 60 * 1000; // first ping shortly after every start / deploy
  const timeoutMs = opts.timeoutMs || 30 * 1000;
  let timer = null, stopped = false;

  async function ping() {
    try {
      const { error } = await withTimeout(client.from('admin_users').select('company_name').limit(1), timeoutMs);
      if (error) throw error;
      log.log('[keepalive] Supabase ping ok');
      return true;
    } catch (e) {
      log.error('[keepalive] Supabase ping failed, will retry soon:', (e && e.message) || e);
      return false;
    }
  }
  function schedule(ms) {
    if (stopped) return;
    timer = setTimeout(run, Math.min(ms, MAX_DELAY));
    if (timer && timer.unref) timer.unref(); // never keeps the process alive on its own
  }
  async function run() { schedule(await ping() ? everyMs : retryMs); }

  schedule(firstMs);
  log.log('[keepalive] on: first Supabase ping in ' + Math.round(firstMs / 1000) + 's, then every ' + (everyMs / DAY) + ' day(s)');
  return { ping, stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { start };
