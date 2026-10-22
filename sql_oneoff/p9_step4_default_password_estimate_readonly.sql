-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, STEP 4: HOW MANY ACCOUNTS ARE STILL ON THE OLD DEFAULT PASSWORD (123456)?   READ-ONLY: changes nothing, shows no names.
--
-- Phase 6 made everyone who NEVER signed in choose a new password. People who signed in long ago with 123456 and never changed it are not forced to. This counts
-- how many still are. Staff and the school (24 accounts) are checked one by one; scholars are checked on a RANDOM SAMPLE of 250 who have signed in (checking all
-- 5,600 would take minutes), and the share is scaled up. It only compares a scrambled password with the scrambled form of 123456: nobody's password is shown.
-- Takes about 30 seconds. Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
with staff as (
  select 'staff' as kind, count(*) as checked, count(*) filter (where (case when au.encrypted_password like '$2%' then au.encrypted_password = extensions.crypt('123456', au.encrypted_password) else false end)) as still_default
  from auth.users au join public.users u on u.id = au.id
), schools as (
  select 'school' as kind, count(*) as checked, count(*) filter (where (case when au.encrypted_password like '$2%' then au.encrypted_password = extensions.crypt('123456', au.encrypted_password) else false end)) as still_default
  from auth.users au join public.school_accounts a on a.id = au.id
), picked as (
  select au.encrypted_password
  from auth.users au join public.scholars s on s.id = au.id
  where au.last_sign_in_at is not null
  order by random() limit 250
), sample as (
  select 'scholars (random sample of those who have signed in)' as kind, count(*) as checked, count(*) filter (where case when encrypted_password like '$2%' then encrypted_password = extensions.crypt('123456', encrypted_password) else false end) as still_default from picked
)
select kind, checked, still_default, round(100.0 * still_default / nullif(checked, 0), 1) as percent_still_default,
       case when kind like 'scholars%' then (select (round(count(*) * still_default::numeric / nullif(checked, 0)))::text || ' of ' || count(*)::text || ' scholars who have signed in (estimate)' from auth.users au join public.scholars s on s.id = au.id where au.last_sign_in_at is not null) else '' end as estimate_for_everyone
from (select * from staff union all select * from schools union all select * from sample) t
order by 1;
