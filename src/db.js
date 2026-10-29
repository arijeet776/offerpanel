const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) console.error('[config] SUPABASE_URL / SUPABASE_SERVICE_KEY are missing');

const sb = createClient(url || 'http://localhost:54321', key || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Supabase returns max 1000 rows per request, so read in pages.
async function fetchAll(table, select = '*', build) {
  const size = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    let q = sb.from(table).select(select);
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

module.exports = { sb, fetchAll };
