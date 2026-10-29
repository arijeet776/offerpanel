-- Safe to run on a fresh project OR on top of the first script you already ran.

create table if not exists campaigns (
  campaign_id text primary key,
  campaign_name text not null,
  platform text default 'Web',
  affiliate_link text,
  total_payout numeric default 0,
  status text default 'ACTIVE',
  user_default_payout numeric default 0,
  referrer_default_payout numeric default 0,
  notes text,
  instructions text,
  multiple_allowed text default 'NO',
  max_conversions_per_upi int,
  campaign_type text default 'ONLINE',
  total_events int default 1,
  goal_name_1 text, goal_name_2 text, goal_name_3 text,
  click_platform text default 'CUSTOM',
  extra_fields_required text default '',
  logo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  synced_at timestamptz
);

create table if not exists referrers (
  ref_id text primary key,
  name text,
  upi text not null,
  mobile text,
  status text default 'ACTIVE',
  created_at timestamptz default now(),
  synced_at timestamptz
);
create unique index if not exists referrers_upi_uq on referrers (lower(upi));

create table if not exists generated_links (
  link_id text primary key,
  ref_id text,
  upi text,
  campaign_id text,
  campaign_name text,
  total_payout numeric,
  user_payout numeric,
  referrer_margin numeric,
  generated_link text,
  links_status text default 'ACTIVE',
  created_at timestamptz default now(),
  synced_at timestamptz
);
create index if not exists links_ref_camp_idx on generated_links (ref_id, campaign_id);

create table if not exists clicks (
  click_id text primary key,
  campaign_id text,
  ref_id text,
  name text,
  upi text,
  ip_address text,
  device_type text,
  mobile text,
  gmail text,
  created_at timestamptz default now(),
  synced_at timestamptz
);
create index if not exists clicks_campaign_idx on clicks (campaign_id);
create index if not exists clicks_ref_idx on clicks (ref_id);

create table if not exists conversions (
  id bigserial primary key,
  click_id text,
  upi text,
  name text,
  status text default 'SUCCESSFUL',
  campaign text,
  goal text,
  ref_id text,
  user_status text default 'PENDING',
  ref_status text default 'PENDING',
  final_status text default 'PENDING',
  created_at timestamptz default now(),
  synced_at timestamptz
);
alter table conversions add column if not exists network_click_id text;
alter table conversions add column if not exists campaign_id text;
alter table conversions add column if not exists goal2 text;
alter table conversions add column if not exists goal3 text;
alter table conversions add column if not exists user_payout numeric default 0;
alter table conversions add column if not exists ref_payout numeric default 0;
alter table conversions add column if not exists user_note text;
alter table conversions add column if not exists ref_note text;
alter table conversions add column if not exists raw_params jsonb;

drop index if exists conversions_click_goal_uq;
create unique index if not exists conversions_click_uq on conversions (click_id);
create index if not exists conversions_ref_idx on conversions (ref_id);
create index if not exists conversions_campaign_idx on conversions (campaign_id);
create index if not exists conversions_netclick_idx on conversions (network_click_id);

create table if not exists payments (
  payment_id text primary key,
  ref_id text,
  upi text,
  name text,
  amount numeric,
  transaction_id text,
  pay_type text,
  campaign text,
  remarks text,
  created_at timestamptz default now(),
  synced_at timestamptz
);
alter table payments add column if not exists conversion_id bigint;

create table if not exists admin_users (
  id bigserial primary key,
  company_name text unique not null
);

create table if not exists sync_log (
  id bigserial primary key,
  table_name text,
  rows_sent int,
  status text,
  message text,
  created_at timestamptz default now()
);

-- Any edit to a row clears synced_at, so the next "Send to Sheets" updates that row in the sheet.
create or replace function touch_unsynced() returns trigger as $$
begin
  if new.synced_at is distinct from old.synced_at then
    return new;
  end if;
  new.synced_at := null;
  if tg_table_name = 'campaigns' then new.updated_at := now(); end if;
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['campaigns','referrers','generated_links','clicks','conversions','payments'] loop
    execute format('drop trigger if exists trg_touch_unsynced on %I', t);
    execute format('create trigger trg_touch_unsynced before update on %I for each row execute function touch_unsynced()', t);
  end loop;
end $$;

-- Lock tables from the browser. Only the server (service_role key) can access them.
alter table campaigns enable row level security;
alter table referrers enable row level security;
alter table generated_links enable row level security;
alter table clicks enable row level security;
alter table conversions enable row level security;
alter table payments enable row level security;
alter table admin_users enable row level security;
alter table sync_log enable row level security;

-- Allowed admin companies (login also needs ADMIN_PASSWORD). Change the name:
insert into admin_users (company_name) values ('Digi Sanchaar') on conflict do nothing;
-- Rebrand: the old Quantix login name is retired (log in with the new company name above).
delete from admin_users where company_name = 'Quantix Cashflow';


-- =====================================================================
-- v2: wallet, withdrawals, campaign purge  (safe to re-run)
-- =====================================================================

-- Wallet ledger: every rupee in/out of a partner's wallet. Kept even when a campaign is deleted.
create table if not exists wallet_ledger (
  id bigserial primary key,
  ref_id text not null,
  entry_type text not null check (entry_type in ('CREDIT','DEBIT')),
  reason text not null,            -- CONVERSION | REVERSAL | WITHDRAWAL | WITHDRAWAL_REFUND
  amount numeric not null check (amount > 0),
  conversion_id bigint,
  withdrawal_id text,
  campaign_name text,
  note text,
  created_at timestamptz default now()
);
create index if not exists wallet_ref_idx on wallet_ledger (ref_id);
-- (v3 replaced the old one-credit-per-conversion index with one credit per EVENT, wallet_conv_event_uq below. It is no longer created here, so re-running this file never fails on leads that have several events.)
create unique index if not exists wallet_conv_reversal_uq on wallet_ledger (conversion_id) where reason = 'REVERSAL';

create table if not exists withdrawals (
  withdrawal_id text primary key,
  ref_id text not null,
  name text,
  upi text,
  amount numeric not null check (amount > 0),
  status text default 'PENDING',   -- PENDING | PAID | REJECTED
  txn_id text,
  admin_note text,
  created_at timestamptz default now(),
  processed_at timestamptz
);
create index if not exists withdrawals_ref_idx on withdrawals (ref_id);
create index if not exists withdrawals_status_idx on withdrawals (status);

alter table wallet_ledger enable row level security;
alter table withdrawals enable row level security;

create or replace function wallet_balance(p_ref text) returns numeric language sql stable as $$
  select coalesce(sum(case when entry_type = 'CREDIT' then amount else -amount end), 0) from wallet_ledger where ref_id = p_ref
$$;

-- Atomic: locks the partner row so two requests at the same moment cannot both spend the same balance.
create or replace function request_withdrawal(p_ref text, p_amount numeric, p_min numeric) returns jsonb language plpgsql as $$
declare r referrers%rowtype; bal numeric; wid text;
begin
  select * into r from referrers where ref_id = p_ref for update;
  if not found or upper(coalesce(r.status, '')) <> 'ACTIVE' then return jsonb_build_object('ok', false, 'error', 'Account is not active.'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'Please enter a valid amount.'); end if;
  if p_amount < p_min then return jsonb_build_object('ok', false, 'error', 'Minimum withdrawal is ₹' || p_min::text || '.'); end if;
  if exists (select 1 from withdrawals where ref_id = p_ref and status = 'PENDING') then
    return jsonb_build_object('ok', false, 'error', 'You already have a pending withdrawal request. Please wait until it is processed.');
  end if;
  bal := wallet_balance(p_ref);
  if p_amount > bal then return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance (available ₹' || bal::text || ').'); end if;
  wid := 'WDR' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || lpad((floor(random() * 1000))::int::text, 3, '0');
  insert into withdrawals (withdrawal_id, ref_id, name, upi, amount, status) values (wid, r.ref_id, r.name, r.upi, p_amount, 'PENDING');
  insert into wallet_ledger (ref_id, entry_type, reason, amount, withdrawal_id) values (r.ref_id, 'DEBIT', 'WITHDRAWAL', p_amount, wid);
  return jsonb_build_object('ok', true, 'withdrawalId', wid, 'balance', bal - p_amount);
end $$;

-- Admin rejects a request: the held amount goes back to the wallet.
create or replace function reject_withdrawal(p_id text, p_note text) returns jsonb language plpgsql as $$
declare w withdrawals%rowtype;
begin
  update withdrawals set status = 'REJECTED', admin_note = p_note, processed_at = now()
    where withdrawal_id = p_id and status = 'PENDING' returning * into w;
  if not found then return jsonb_build_object('ok', false, 'error', 'This request is not pending any more.'); end if;
  insert into wallet_ledger (ref_id, entry_type, reason, amount, withdrawal_id, note)
    values (w.ref_id, 'CREDIT', 'WITHDRAWAL_REFUND', w.amount, w.withdrawal_id, p_note);
  return jsonb_build_object('ok', true);
end $$;

-- Deletes one campaign and everything attached to it, in one transaction. Wallet ledger + withdrawals are NOT touched.
create or replace function purge_campaign(p_id text) returns jsonb language plpgsql as $$
declare n_pay int; n_conv int; n_clk int; n_lnk int;
begin
  perform 1 from campaigns where campaign_id = p_id;
  if not found then raise exception 'not_found'; end if;
  delete from payments where conversion_id in (select id from conversions where campaign_id = p_id);
  get diagnostics n_pay = row_count;
  delete from conversions where campaign_id = p_id;      get diagnostics n_conv = row_count;
  delete from clicks where campaign_id = p_id;           get diagnostics n_clk = row_count;
  delete from generated_links where campaign_id = p_id;  get diagnostics n_lnk = row_count;
  delete from campaigns where campaign_id = p_id;
  return jsonb_build_object('payments', n_pay, 'conversions', n_conv, 'clicks', n_clk, 'links', n_lnk);
end $$;

-- These functions must only be callable by the server (service_role), never from a browser with the public key.
revoke all on function wallet_balance(text) from public, anon, authenticated;
revoke all on function request_withdrawal(text, numeric, numeric) from public, anon, authenticated;
revoke all on function reject_withdrawal(text, text) from public, anon, authenticated;
revoke all on function purge_campaign(text) from public, anon, authenticated;
grant execute on function wallet_balance(text) to service_role;
grant execute on function request_withdrawal(text, numeric, numeric) to service_role;
grant execute on function reject_withdrawal(text, text) to service_role;
grant execute on function purge_campaign(text) to service_role;

-- (Double payment protection now lives in pay_conversion() + payments_conv_txn_uq, see v6 at the end.)


-- =====================================================================
-- v3: events with their own payouts, click-id macro typed by admin, event timestamps (safe to re-run)
-- =====================================================================
alter table campaigns add column if not exists payout_1 numeric;
alter table campaigns add column if not exists payout_2 numeric;
alter table campaigns add column if not exists payout_3 numeric;
alter table campaigns add column if not exists click_macro text;

alter table conversions add column if not exists goal_at timestamptz;
alter table conversions add column if not exists goal2_at timestamptz;
alter table conversions add column if not exists goal3_at timestamptz;

-- One wallet credit per conversion PER EVENT (was: one per conversion)
alter table wallet_ledger add column if not exists event_no int;
drop index if exists wallet_conv_credit_uq;
create unique index if not exists wallet_conv_event_uq on wallet_ledger (conversion_id, coalesce(event_no, 0)) where reason = 'CONVERSION';

-- Records one achieved event for a click, atomically: creates the lead on the first event, adds the event
-- (name + time), adds this event's payouts, and credits the referrer's wallet. Safe against double postbacks.
create or replace function record_event(
  p_click text, p_campaign_id text, p_campaign text, p_upi text, p_name text, p_ref text,
  p_idx int, p_goal text, p_net text, p_user numeric, p_refamt numeric, p_raw jsonb
) returns jsonb language plpgsql as $$
declare c conversions%rowtype;
begin
  select * into c from conversions where click_id = p_click for update;
  if not found then
    begin
      insert into conversions (click_id, network_click_id, upi, name, status, campaign, campaign_id, ref_id,
                               user_status, ref_status, final_status, user_payout, ref_payout, raw_params)
      values (p_click, p_net, p_upi, p_name, 'SUCCESSFUL', p_campaign, p_campaign_id, p_ref,
              'PENDING', case when p_ref = 'DIRECT' then 'NA' else 'PENDING' end, 'SUCCESSFUL', 0, 0, p_raw)
      returning * into c;
    exception when unique_violation then
      select * into c from conversions where click_id = p_click for update;
    end;
  end if;

  if (p_idx = 1 and c.goal is not null) or (p_idx = 2 and c.goal2 is not null) or (p_idx = 3 and c.goal3 is not null) then
    return jsonb_build_object('result', 'duplicate', 'id', c.id);
  end if;

  update conversions set
    goal  = case when p_idx = 1 then p_goal else goal end,   goal_at  = case when p_idx = 1 then now() else goal_at end,
    goal2 = case when p_idx = 2 then p_goal else goal2 end,  goal2_at = case when p_idx = 2 then now() else goal2_at end,
    goal3 = case when p_idx = 3 then p_goal else goal3 end,  goal3_at = case when p_idx = 3 then now() else goal3_at end,
    user_payout = coalesce(user_payout, 0) + coalesce(p_user, 0),
    ref_payout  = coalesce(ref_payout, 0) + coalesce(p_refamt, 0),
    -- user was already fully paid, a later event adds a new amount: payable again (v6)
    user_status = case when upper(coalesce(user_status, '')) = 'PAID' and coalesce(p_user, 0) > 0 then 'PENDING' else user_status end,
    network_click_id = coalesce(network_click_id, p_net)
  where id = c.id returning * into c;

  if p_ref <> 'DIRECT' and coalesce(p_refamt, 0) > 0 and upper(coalesce(c.ref_status, '')) in ('PENDING', 'CREDITED') then
    insert into wallet_ledger (ref_id, entry_type, reason, amount, conversion_id, event_no, campaign_name)
      values (p_ref, 'CREDIT', 'CONVERSION', p_refamt, c.id, p_idx, c.campaign)
      on conflict do nothing;
    update conversions set ref_status = 'CREDITED' where id = c.id and ref_status = 'PENDING';
  end if;
  return jsonb_build_object('result', 'ok', 'id', c.id);
end $$;

revoke all on function record_event(text, text, text, text, text, text, int, text, text, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function record_event(text, text, text, text, text, text, int, text, text, numeric, numeric, jsonb) to service_role;


-- =====================================================================
-- v4: admin chooses, per campaign, which details the offer page collects (safe to re-run)
-- collect_fields = comma list of NAME, MOBILE, GMAIL (UPI ID is always collected).
-- NULL = campaign made before this setting existed: it keeps asking Name + UPI (+ its old extras).
-- =====================================================================
alter table campaigns add column if not exists collect_fields text;


-- =====================================================================
-- v5: UNLIMITED events per campaign (safe to re-run)
-- campaigns.events   = [{"name":"Install","payout":10}, {"name":"KYC","payout":25}, ...]   (any number, in order)
-- conversions.events = [{"no":1,"name":"Install","at":"2026-10-29T10:00:00Z"}, ...]
-- The old goal_name_1..3 / payout_1..3 / goal..goal3 columns are still filled for the first 3 events,
-- so Google Sheets and old reports keep working.
-- =====================================================================
alter table campaigns   add column if not exists events jsonb;
alter table conversions add column if not exists events jsonb;

-- Old campaigns -> events list (event 1 carries the whole payout for campaigns made before event payouts existed)
update campaigns c set events = coalesce((
  select jsonb_agg(jsonb_build_object(
           'name',   coalesce(nullif(v.n, ''), case when v.i = 1 then 'INSTALL' else 'EVENT ' || v.i end),
           'payout', coalesce(v.p, case when v.i = 1 and c.payout_1 is null and c.payout_2 is null and c.payout_3 is null then c.total_payout end, 0)
         ) order by v.i)
  from (values (1, c.goal_name_1, c.payout_1), (2, c.goal_name_2, c.payout_2), (3, c.goal_name_3, c.payout_3)) as v(i, n, p)
  where v.i <= greatest(1, least(3, coalesce(c.total_events, 1)))
), '[]'::jsonb) where c.events is null;

-- Old leads -> achieved-events list
update conversions c set events = coalesce((
  select jsonb_agg(jsonb_build_object('no', v.i, 'name', v.g, 'at', coalesce(v.t, c.created_at)) order by v.i)
  from (values (1, c.goal, c.goal_at), (2, c.goal2, c.goal2_at), (3, c.goal3, c.goal3_at)) as v(i, g, t)
  where v.g is not null and v.g <> ''
), '[]'::jsonb) where c.events is null;

-- Same function name + arguments as before, now for ANY event number.
create or replace function record_event(
  p_click text, p_campaign_id text, p_campaign text, p_upi text, p_name text, p_ref text,
  p_idx int, p_goal text, p_net text, p_user numeric, p_refamt numeric, p_raw jsonb
) returns jsonb language plpgsql as $$
declare c conversions%rowtype; ev jsonb;
begin
  if p_idx is null or p_idx < 1 then
    return jsonb_build_object('result', 'duplicate', 'id', null);
  end if;

  select * into c from conversions where click_id = p_click for update;
  if not found then
    begin
      insert into conversions (click_id, network_click_id, upi, name, status, campaign, campaign_id, ref_id,
                               user_status, ref_status, final_status, user_payout, ref_payout, raw_params, events)
      values (p_click, p_net, p_upi, p_name, 'SUCCESSFUL', p_campaign, p_campaign_id, p_ref,
              'PENDING', case when p_ref = 'DIRECT' then 'NA' else 'PENDING' end, 'SUCCESSFUL', 0, 0, p_raw, '[]'::jsonb)
      returning * into c;
    exception when unique_violation then
      select * into c from conversions where click_id = p_click for update;
    end;
  end if;

  ev := c.events;
  if ev is null then  -- lead saved before v5: rebuild its list from the old columns
    ev := coalesce((
      select jsonb_agg(jsonb_build_object('no', v.i, 'name', v.g, 'at', coalesce(v.t, c.created_at)) order by v.i)
      from (values (1, c.goal, c.goal_at), (2, c.goal2, c.goal2_at), (3, c.goal3, c.goal3_at)) as v(i, g, t)
      where v.g is not null and v.g <> ''
    ), '[]'::jsonb);
  end if;

  if exists (select 1 from jsonb_array_elements(ev) e where (e->>'no')::int = p_idx) then
    return jsonb_build_object('result', 'duplicate', 'id', c.id);
  end if;
  ev := ev || jsonb_build_array(jsonb_build_object('no', p_idx, 'name', p_goal, 'at', to_jsonb(now())));

  update conversions set
    events = ev,
    goal  = case when p_idx = 1 then p_goal else goal end,   goal_at  = case when p_idx = 1 then now() else goal_at end,
    goal2 = case when p_idx = 2 then p_goal else goal2 end,  goal2_at = case when p_idx = 2 then now() else goal2_at end,
    goal3 = case when p_idx = 3 then p_goal else goal3 end,  goal3_at = case when p_idx = 3 then now() else goal3_at end,
    user_payout = coalesce(user_payout, 0) + coalesce(p_user, 0),
    ref_payout  = coalesce(ref_payout, 0) + coalesce(p_refamt, 0),
    network_click_id = coalesce(network_click_id, p_net)
  where id = c.id returning * into c;

  if p_ref <> 'DIRECT' and coalesce(p_refamt, 0) > 0 and upper(coalesce(c.ref_status, '')) in ('PENDING', 'CREDITED') then
    insert into wallet_ledger (ref_id, entry_type, reason, amount, conversion_id, event_no, campaign_name)
      values (p_ref, 'CREDIT', 'CONVERSION', p_refamt, c.id, p_idx, c.campaign)
      on conflict do nothing;
    update conversions set ref_status = 'CREDITED' where id = c.id and ref_status = 'PENDING';
  end if;
  return jsonb_build_object('result', 'ok', 'id', c.id);
end $$;

revoke all on function record_event(text, text, text, text, text, text, int, text, text, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function record_event(text, text, text, text, text, text, int, text, text, numeric, numeric, jsonb) to service_role;


-- =====================================================================
-- v6: postback log (safe to re-run). Every postback received, with the result and exactly what the network sent.
-- Shown in the admin panel under All Campaigns -> Postback. Housekeeping (run now and then):
--   delete from postback_log where created_at < now() - interval '30 days';
-- =====================================================================
create table if not exists postback_log (
  id bigserial primary key,
  created_at timestamptz default now(),
  result text,
  campaign_id text,
  click_id text,
  network_click_id text,
  event_name text,
  params jsonb
);
create index if not exists postback_log_camp_idx on postback_log (campaign_id, id desc);
alter table postback_log enable row level security;


-- =====================================================================
-- v6b: user payouts in parts (safe to re-run)
-- A lead with several events earns the user money event by event. pay_conversion() pays what is still due
-- (total user_payout minus what was already paid), under a row lock, so nothing is lost or paid twice.
-- =====================================================================
drop index if exists payments_conv_party_uq;
create unique index if not exists payments_conv_txn_uq on payments (conversion_id, pay_type, transaction_id) where conversion_id is not null;

create or replace function pay_conversion(p_id bigint, p_amount numeric, p_txn text, p_note text) returns jsonb language plpgsql as $$
declare c conversions%rowtype; paid numeric; owed numeric;
begin
  select * into c from conversions where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Conversion not found.'); end if;
  if upper(coalesce(c.user_status, '')) = 'REJECTED' then return jsonb_build_object('ok', false, 'error', 'This user payout was rejected.'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'Please enter a valid amount.'); end if;
  paid := coalesce((select sum(amount) from payments where conversion_id = c.id and pay_type = 'USER'), 0);
  owed := round(coalesce(c.user_payout, 0) - paid, 2);
  if owed <= 0 then return jsonb_build_object('ok', false, 'error', 'Already paid.'); end if;
  if p_amount > owed + 0.009 then return jsonb_build_object('ok', false, 'error', 'Amount is more than the ₹' || owed::text || ' still due.'); end if;
  if exists (select 1 from payments where conversion_id = c.id and pay_type = 'USER' and transaction_id = p_txn) then
    return jsonb_build_object('ok', false, 'error', 'This transaction ID is already recorded for this lead.');
  end if;
  insert into payments (payment_id, ref_id, upi, name, amount, transaction_id, pay_type, campaign, remarks, conversion_id)
    values ('PAY_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || lpad((floor(random() * 1000))::int::text, 3, '0'),
            c.ref_id, c.upi, c.name, p_amount, p_txn, 'USER', c.campaign, coalesce(nullif(p_note, ''), 'Paid via Admin'), c.id);
  update conversions set user_status = case when paid + p_amount >= round(coalesce(user_payout, 0), 2) - 0.009 then 'PAID' else 'PENDING' end where id = c.id;
  return jsonb_build_object('ok', true, 'remaining', greatest(0, owed - p_amount));
end $$;
revoke all on function pay_conversion(bigint, numeric, text, text) from public, anon, authenticated;
grant execute on function pay_conversion(bigint, numeric, text, text) to service_role;
