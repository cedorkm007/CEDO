-- ─────────────────────────────────────────────────────────────
-- STAFF ACCOUNTS THAT CANNOT SIGN IN EVEN WITH THE RIGHT PASSWORD: WHAT IS WRONG WITH THEM?   READ-ONLY.   Nothing is changed or deleted.
-- Staff sign in by username -> the email saved on the staff record -> the sign-in service checks that email and the password. If any link is wrong for ONE account,
-- that account always gets "Incorrect username or password". This lists accounts with a wrong link. Usernames and a short problem description only; emails are masked.
-- Send me all the rows (an empty result, apart from the summary, means none of these problems exist).
-- ─────────────────────────────────────────────────────────────
with m as (select lower(btrim(username)) as uname, count(*) as c from public.users group by 1)
select 0 as n, 'SUMMARY' as username, 'staff records: ' || (select count(*) from public.users) || ' | in the sign-in service: ' || (select count(*) from public.users u join auth.users a on a.id = u.id) as problem
union all
select 1, u.username, 'no sign-in account exists for this staff record (it cannot sign in at all)' from public.users u where not exists (select 1 from auth.users a where a.id = u.id)
union all
select 2, u.username, 'the email on the staff record (' || left(u.email, 2) || '***@' || split_part(u.email, '@', 2) || ') is NOT the sign-in email (' || left(a.email, 2) || '***@' || split_part(a.email, '@', 2) || '): the username finds the wrong email'
  from public.users u join auth.users a on a.id = u.id where lower(btrim(coalesce(u.email, ''))) <> lower(btrim(coalesce(a.email, '')))
union all
select 3, u.username, 'the email on the staff record has a space or is empty' from public.users u where u.email is null or btrim(u.email) = '' or u.email <> btrim(u.email) or u.email like '% %'
union all
select 4, u.username, 'another staff record has the same username when capitals and spaces are ignored (the sign-in may pick the other one)' from public.users u join m on m.uname = lower(btrim(u.username)) where m.c > 1
union all
select 5, u.username, 'the username has a space at the start or end, or inside it' from public.users u where u.username <> btrim(u.username) or btrim(u.username) like '% %'
union all
select 6, u.username, 'the account is switched off (banned until ' || a.banned_until::date || ')' from public.users u join auth.users a on a.id = u.id where a.banned_until is not null and a.banned_until > now()
union all
select 7, u.username, 'the email was never confirmed in the sign-in service' from public.users u join auth.users a on a.id = u.id where a.email_confirmed_at is null
order by 1, 2;
