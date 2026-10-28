-- ─────────────────────────────────────────────────────────────
-- WHY CAN ONE STAFF ACCOUNT NOT SIGN IN?   READ-ONLY.   Nothing is changed or deleted.
-- Change the username on the next line (keep the quotes) if you want to check someone else. Emails are masked; no password or hash is shown.
-- Send me all the rows.
-- ─────────────────────────────────────────────────────────────
with p as (select 'sead.sac15'::text as uname),
m as (select u.* from public.users u, p where lower(btrim(u.username)) = lower(btrim(p.uname))),
a as (select au.* from auth.users au where au.id in (select id from m))
select 1 as n, 'USERNAME FOUND' as item, (select count(*) from m)::text || ' staff record(s) match this username (expected: 1)' as value
union all select 2, 'SIMILAR USERNAMES', coalesce((select string_agg(u.username, ', ' order by u.username) from public.users u, p where u.username ilike '%' || replace(split_part(p.uname, '.', 2), ' ', '') || '%' or u.username ilike '%' || split_part(p.uname, '.', 1) || '%sac%'), 'none')
union all select 3, 'STAFF RECORD', (select 'role ' || m.role || ' | sead staff ' || m.is_sead_staff || ' | created ' || m.created_at::date || ' | email ' || left(m.email, 2) || '***@' || split_part(m.email, '@', 2) from m limit 1)
union all select 4, 'SIGN-IN ACCOUNT EXISTS', case when exists (select 1 from a) then 'yes' else 'NO: there is no sign-in account for this staff record' end
union all select 5, 'SIGN-IN EMAIL SAME AS STAFF RECORD', (select case when lower(btrim(a.email)) = lower(btrim(m.email)) then 'yes' else 'NO: sign-in email is ' || left(a.email, 2) || '***@' || split_part(a.email, '@', 2) end from a join m on m.id = a.id limit 1)
union all select 6, 'EMAIL CONFIRMED', (select coalesce(a.email_confirmed_at::text, 'NO: never confirmed') from a limit 1)
union all select 7, 'SWITCHED OFF (BANNED)', (select case when a.banned_until is not null and a.banned_until > now() then 'YES, until ' || a.banned_until::date else 'no' end from a limit 1)
union all select 8, 'HAS A PASSWORD SET', (select case when a.encrypted_password is null or a.encrypted_password = '' then 'NO: no password is set on this account' else 'yes' end from a limit 1)
union all select 9, 'LAST SIGNED IN', (select coalesce(a.last_sign_in_at::text, 'never') from a limit 1)
union all select 10, 'ACCOUNT LAST CHANGED (a password reset also changes this)', (select a.updated_at::text from a limit 1)
union all select 11, 'TRIES THIS USERNAME HAS MADE, LAST 15 MINUTES (limit 10 from one address)', (select count(*)::text from public.auth_attempts t, p where t.kind = 'staff_lookup' and t.key_hash = public._auth_hash(p.uname) and t.at > now() - interval '15 minutes')
union all select 12, 'BUSIEST ADDRESS FOR STAFF SIGN-IN, LAST 15 MINUTES (limit 60 per address)', coalesce((select max(c)::text from (select count(*) c from public.auth_attempts t where t.kind = 'staff_lookup' and t.at > now() - interval '15 minutes' group by t.ip_hash) x), '0')
order by 1;
