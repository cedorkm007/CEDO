-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, STEP 2b: LOOK at the sign-in accounts that have no staff, school or scholar record.   READ-ONLY: changes nothing.
--
-- This one shows the full email of each (it is YOUR data: keep the result private, do not paste emails anywhere public). It also shows how each account was made:
--   • "made by our server functions" = its sign-up details carry the user name / division / Scholar ID our functions write (so it is probably a leftover of an
--     account whose record was never saved or was later deleted);
--   • "no details" = nothing was written with it (made by the sign-up page or by hand in the dashboard).
-- Use it to recognise each one; do not delete anything until you are sure. Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
select au.id,
       au.email,
       to_char(au.created_at, 'YYYY-MM-DD HH24:MI') as created,
       coalesce(to_char(au.last_sign_in_at, 'YYYY-MM-DD HH24:MI'), 'never') as last_sign_in,
       case when au.email_confirmed_at is null then 'NOT confirmed' else 'confirmed' end as email_status,
       case when au.raw_user_meta_data ?| array['username', 'division', 'role', 'scholarIdNumber', 'kind'] then 'made by our server functions' else 'no details' end as how_it_was_made,
       (select string_agg(k, ', ' order by k) from jsonb_object_keys(coalesce(au.raw_user_meta_data, '{}'::jsonb)) k) as detail_names,
       coalesce(au.banned_until::text, '') as switched_off_until
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id)
  and not exists (select 1 from public.school_accounts a where a.id = au.id)
  and not exists (select 1 from public.scholars s where s.id = au.id)
order by au.created_at;
