-- Run ONCE, after re-running schema.sql, ONLY if you already have live data from the old version.

-- 1) Referrer earnings that were still PENDING go into each partner's wallet.
insert into wallet_ledger (ref_id, entry_type, reason, amount, conversion_id, campaign_name)
select ref_id, 'CREDIT', 'CONVERSION', ref_payout, id, campaign
from conversions
where ref_id is not null and ref_id <> 'DIRECT' and ref_status = 'PENDING' and coalesce(ref_payout, 0) > 0
on conflict do nothing;

update conversions set ref_status = 'CREDITED'
where ref_id is not null and ref_id <> 'DIRECT' and ref_status = 'PENDING' and coalesce(ref_payout, 0) > 0;

-- 2) Report sync is gone: a postback is now final. Mark old waiting leads successful (skip this line if you want to review them first).
update conversions set final_status = 'SUCCESSFUL' where final_status = 'PENDING';

-- 3) Old referral links -> new format.
update generated_links
set generated_link = 'https://offers.digisanchaar.online/' || campaign_id || '/' || ref_id;

-- 4) Campaigns that were only "soft deleted" before are now removed for real.
select purge_campaign(campaign_id) from campaigns where status = 'DELETED';
