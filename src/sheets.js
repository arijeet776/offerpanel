const { sb, fetchAll } = require('./db');
const U = require('./util');

const TZ = process.env.TZ_NAME || 'Asia/Kolkata';
const fmt = ts => ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: TZ }) : '';

// Sheet tab names + key column used to update existing rows. Edit here if your tabs are named differently.
const TABLES = {
  campaigns: {
    table: 'campaigns', pk: 'campaign_id', sheet: 'Campaigns', key: 'Campaign_ID',
    map: r => ({
      Campaign_ID: r.campaign_id, Campaign_Name: r.campaign_name, Platform: r.platform, Affiliate_Link: r.affiliate_link,
      Total_Payout: r.total_payout, Status: r.status, User_Default_Payout: r.user_default_payout,
      Referrer_Default_Payout: r.referrer_default_payout, Created_Date: fmt(r.created_at), Notes: r.notes,
      Updated_Date: fmt(r.updated_at), Multiple_Allowed: r.multiple_allowed,
      Max_Conversions: r.max_conversions_per_upi, Max_Conversions_Per_UPI: r.max_conversions_per_upi,
      Instructions: r.instructions, Campaign_Type: r.campaign_type, Total_Events: r.total_events,
      Goal_Name_1: r.goal_name_1, Goal_Name_2: r.goal_name_2, Goal_Name_3: r.goal_name_3,
      All_Events: U.campEvents(r).map(e => e.name + ' ₹' + e.payout).join(' | '),
      Click_Platform: r.click_platform, Extra_Fields_Required: r.extra_fields_required, Logo_URL: r.logo_url
    })
  },
  referrers: {
    table: 'referrers', pk: 'ref_id', sheet: 'Referrer', key: 'Ref_ID', all: true,
    map: (r, st) => ({
      Ref_ID: r.ref_id, Name: r.name, UPI: r.upi, Mobile: r.mobile, Status: r.status, Created_Date: fmt(r.created_at),
      Total_Leads: st.leads, Approved_Leads: st.approved, Paid_Amount: st.paid, Balance: st.balance
    })
  },
  generated_links: {
    table: 'generated_links', pk: 'link_id', sheet: 'Generated_Links', key: 'Link_ID',
    map: r => ({
      Link_ID: r.link_id, Ref_ID: r.ref_id, UPI: r.upi, Campaign_ID: r.campaign_id, Campaign_Name: r.campaign_name,
      Total_Payout: r.total_payout, User_Payout: r.user_payout, Referrer_Margin: r.referrer_margin,
      Generated_Link: r.generated_link, Links_Status: r.links_status, Created_Date: fmt(r.created_at)
    })
  },
  clicks: {
    table: 'clicks', pk: 'click_id', sheet: 'click log', key: 'Click_ID',
    map: r => ({
      Click_ID: r.click_id, Campaign_ID: r.campaign_id, Ref_ID: r.ref_id, Name: r.name, UPI_ID: r.upi,
      IP_Address: r.ip_address, Device_Type: r.device_type, Date_Time: fmt(r.created_at), Mobile: r.mobile, Gmail: r.gmail
    })
  },
  conversions: {
    table: 'conversions', pk: 'id', sheet: 'Sheet1', key: 'Conversion_ID',
    map: r => ({
      Conversion_ID: r.id, upi: r.upi, name: r.name, status: r.status, campaign: r.campaign,
      click_id: r.network_click_id || r.click_id, Unique_Click_ID: r.click_id, goal: r.goal, date: fmt(r.created_at),
      p3: r.ref_id, Ref_ID: r.ref_id, user_status: r.user_status, ref_status: r.ref_status, final_status: r.final_status,
      goal2: r.goal2, goal3: r.goal3, All_Events: U.convEvents(r).map(e => e.name).join(' + '), user_payout: r.user_payout, ref_payout: r.ref_payout, Campaign_ID: r.campaign_id
    })
  },
  payments: {
    table: 'payments', pk: 'payment_id', sheet: 'Payments', key: 'Payment_ID',
    map: r => ({
      Payment_ID: r.payment_id, Ref_ID: r.ref_id, UPI: r.upi, Name: r.name, Amount: r.amount,
      Payment_Date: fmt(r.created_at), Transaction_ID: r.transaction_id, Remarks: r.pay_type, Pay_Type: r.pay_type,
      CAMPAIGN: r.campaign, Credit: r.remarks
    })
  }
};
const ORDER = ['campaigns', 'referrers', 'generated_links', 'clicks', 'conversions', 'payments'];

// Text typed by users (name, etc.) must never run as a spreadsheet formula: a leading = + - @ gets a leading apostrophe.
const safeCell = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;
const safeRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)]));

async function post(sheet, key, rows) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) throw new Error('SHEETS_WEBHOOK_URL is not set');
  const r = await fetch(url, {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: process.env.SHEETS_SECRET || '', sheet, key, rows: rows.map(safeRow) })
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error('Sheets endpoint returned: ' + text.slice(0, 120)); }
  if (!j.ok) throw new Error(j.error || 'Sheets endpoint error');
  return j;
}

async function referrerStats() {
  const [conv, pays] = await Promise.all([
    fetchAll('conversions', 'id,ref_id,final_status,ref_payout,ref_status', q => q.order('id')),
    fetchAll('payments', 'payment_id,ref_id,amount,pay_type', q => q.order('payment_id'))
  ]);
  const s = {};
  const g = id => (s[id] = s[id] || { leads: 0, approved: 0, earned: 0, paid: 0 });
  conv.forEach(c => {
    if (!c.ref_id || c.ref_id === 'DIRECT') return;
    const x = g(c.ref_id); x.leads++;
    if (['SUCCESSFUL', 'APPROVED'].includes(String(c.final_status).toUpperCase())) x.approved++;
    if (String(c.ref_status).toUpperCase() !== 'REJECTED') x.earned += Number(c.ref_payout) || 0;
  });
  pays.filter(p => p.pay_type === 'REFERRER').forEach(p => { g(p.ref_id).paid += Number(p.amount) || 0; });
  Object.values(s).forEach(x => { x.balance = Math.max(0, x.earned - x.paid); });
  return s;
}

async function pushTable(name) {
  const cfg = TABLES[name];
  const BATCH = 300;
  let sent = 0;
  const stats = cfg.all ? await referrerStats() : null;
  for (;;) {
    let q = sb.from(cfg.table).select('*').order(cfg.pk).limit(BATCH);
    q = cfg.all ? q : q.is('synced_at', null);
    if (cfg.all) q = q.range(sent, sent + BATCH - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data.length) break;
    const rows = data.map(r => cfg.map(r, stats ? (stats[r.ref_id] || { leads: 0, approved: 0, paid: 0, balance: 0 }) : null));
    await post(cfg.sheet, cfg.key, rows);
    const { error: e2 } = await sb.from(cfg.table).update({ synced_at: new Date().toISOString() }).in(cfg.pk, data.map(r => r[cfg.pk]));
    if (e2) throw e2;
    sent += data.length;
    if (data.length < BATCH) break;
  }
  return sent;
}

let running = false;
async function pushAll(names) {
  if (running) throw new Error('A sync is already running. Please wait.');
  running = true;
  const result = {};
  try {
    for (const n of ORDER.filter(n => !names || names.includes(n))) {
      try {
        const sent = await pushTable(n);
        result[n] = { ok: true, sent };
        await sb.from('sync_log').insert({ table_name: n, rows_sent: sent, status: 'OK', message: '' });
      } catch (e) {
        result[n] = { ok: false, error: e.message };
        await sb.from('sync_log').insert({ table_name: n, rows_sent: 0, status: 'FAILED', message: String(e.message).slice(0, 300) });
      }
    }
  } finally { running = false; }
  return result;
}

async function status() {
  const out = {};
  for (const n of ORDER) {
    const cfg = TABLES[n];
    let q = sb.from(cfg.table).select('*', { count: 'exact', head: true });
    if (!cfg.all) q = q.is('synced_at', null);
    const { count } = await q;
    out[n] = { sheet: cfg.sheet, pending: count || 0, all: !!cfg.all };
  }
  const { data: log } = await sb.from('sync_log').select('*').order('id', { ascending: false }).limit(12);
  return { tables: out, log: log || [], configured: !!process.env.SHEETS_WEBHOOK_URL };
}

module.exports = { pushAll, status, ORDER };
