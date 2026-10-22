-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, STEP 2: are there sign-in accounts that nobody on our side created?   READ-ONLY: changes nothing.
--
-- Every account that can sign in should belong to a staff member, a school or a scholar. If public sign-up was ever left switched on, strangers could have
-- made accounts of their own. This lists the accounts that have NO staff, school or scholar record, and counts the rest. It shows numbers, the creation date
-- and the part of an email AFTER the @ (never the name part), so nothing personal is shown. Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
select '1. accounts in total' as part, count(*)::text as detail from auth.users
union all
select '2. staff accounts', count(*)::text from auth.users au join public.users u on u.id = au.id
union all
select '2. school accounts', count(*)::text from auth.users au join public.school_accounts a on a.id = au.id
union all
select '2. scholar accounts', count(*)::text from auth.users au join public.scholars s on s.id = au.id
union all
select '3. ACCOUNTS WITH NO STAFF, SCHOOL OR SCHOLAR RECORD', count(*)::text
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id) and not exists (select 1 from public.school_accounts a where a.id = au.id) and not exists (select 1 from public.scholars s where s.id = au.id)
union all
select '3. no record: ' || to_char(au.created_at, 'YYYY-MM-DD') || ' | signed in: ' || coalesce(to_char(au.last_sign_in_at, 'YYYY-MM-DD'), 'never') || ' | provider: ' || coalesce(au.raw_app_meta_data ->> 'provider', '?'),
       'email domain: ' || coalesce(split_part(au.email, '@', 2), '(none)')
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id) and not exists (select 1 from public.school_accounts a where a.id = au.id) and not exists (select 1 from public.scholars s where s.id = au.id)
union all
select '4. accounts that were not made by us (a provider other than email)', count(*)::text from auth.users where coalesce(raw_app_meta_data ->> 'provider', 'email') <> 'email'
union all
select '5. email domains in use', split_part(email, '@', 2) || ' : ' || count(*)::text from auth.users group by split_part(email, '@', 2)
order by 1, 2;
