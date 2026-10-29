-- Run ONCE after re-running schema.sql, ONLY if you already have campaigns/leads from the earlier version.

-- Old campaigns: the whole payout sits on event 1 (edit the campaign in the admin panel to split it across events).
update campaigns set payout_1 = coalesce(total_payout, 0), payout_2 = 0, payout_3 = 0 where payout_1 is null;
update campaigns set goal_name_1 = 'INSTALL' where goal_name_1 is null or goal_name_1 = '';

-- Old "Click Platform" choice becomes the typed macro field.
update campaigns set click_macro = case upper(coalesce(click_platform, 'CUSTOM'))
  when 'OFFER18' then 'aff_sub1,aff_sub2' when 'TRACKIER' then 'p2,source' when 'TRACKIX' then 'sub1,sub2' else 'p1' end
where click_macro is null or click_macro = '';

-- Old leads: the time each event was reached is not known, so use the lead's own time.
update conversions set goal_at  = created_at where goal  is not null and goal_at  is null;
update conversions set goal2_at = created_at where goal2 is not null and goal2_at is null;
update conversions set goal3_at = created_at where goal3 is not null and goal3_at is null;
