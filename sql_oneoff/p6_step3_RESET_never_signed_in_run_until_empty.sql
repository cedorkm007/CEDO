-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6 — STEP 3 of 3 (ONE TIME, in rounds): give every account that has NEVER signed in a new RANDOM temporary password.
--
-- Why: until now new accounts started with one shared password. Anyone who has not signed in yet could still be using it, so each of them gets their own
-- random password, and must choose a new one at their first sign-in (the website asks for it: this needs the Phase 6 database update first).
--
-- What it does, each time you run it: takes up to 800 accounts that have never signed in (staff, schools, scholars; not switched off; not
-- it.admin1; not already given a temporary password), gives each a random password, marks it "must choose a new password", and SHOWS YOU THE LIST
-- (kind, login, name, temporary password). The passwords are NOT stored anywhere readable: THIS LIST IS THE ONLY COPY.
--   • Download the result as CSV (the Results panel has an export button) and keep it private; give each person only their own password.
--   • Run the file again and again until it shows NO rows. (800 at a time keeps each run quick; about 11 runs for 8,000 scholars.)
--   • Accounts that have ALREADY signed in are not touched.
-- Run STEP 2 (p6_step2…COUNT…) first.  To stop at any time, just stop running it: every round is complete on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

-- One fair random whole number from 0 to n-1 (rejects the few byte values that would favour the first characters). Lives only for this run.
create or replace function pg_temp.p6_pick(n int) returns int
language plpgsql as $$
declare b int; lim int := 256 - (256 % n);
begin
  loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    if b < lim then return b % n; end if;
  end loop;
end $$;

-- A random password like "Kd7m-Xt4q-Wn9R" (12 characters: capitals, small letters and digits, no look-alike characters such as 0/O or 1/l).
create or replace function pg_temp.p6_new_password() returns text
language plpgsql as $$
declare
  upper_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  lower_chars text := 'abcdefghijkmnpqrstuvwxyz';
  digit_chars text := '23456789';
  all_chars   text := upper_chars || lower_chars || digit_chars;
  chars text[] := '{}';
  i int; j int; tmp text;
begin
  for i in 1..2 loop chars := chars || substr(upper_chars, 1 + pg_temp.p6_pick(length(upper_chars)), 1); end loop;
  for i in 1..2 loop chars := chars || substr(lower_chars, 1 + pg_temp.p6_pick(length(lower_chars)), 1); end loop;
  for i in 1..2 loop chars := chars || substr(digit_chars, 1 + pg_temp.p6_pick(length(digit_chars)), 1); end loop;
  while array_length(chars, 1) < 12 loop chars := chars || substr(all_chars, 1 + pg_temp.p6_pick(length(all_chars)), 1); end loop;
  for i in reverse 12..2 loop   -- shuffle, so the guaranteed ones are not always first
    j := 1 + pg_temp.p6_pick(i);
    tmp := chars[i]; chars[i] := chars[j]; chars[j] := tmp;
  end loop;
  return array_to_string(chars[1:4], '') || '-' || array_to_string(chars[5:8], '') || '-' || array_to_string(chars[9:12], '');
end $$;

with accounts as (
  select au.id, 'Staff' as kind, u.username as login, btrim(u.first_name || ' ' || u.last_name) as person
  from auth.users au join public.users u on u.id = au.id
  where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now()) and lower(u.username) <> 'it.admin1'
  union all
  select au.id, 'School', coalesce(a.username, a.email), sc.name
  from auth.users au join public.school_accounts a on a.id = au.id left join public.schools sc on sc.id = a.school_id
  where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now())
  union all
  select au.id, 'Scholar', s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name)
  from auth.users au join public.scholars s on s.id = au.id
  where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now()) and s.status is distinct from 'Removed'
),
picked as (
  select a.id, a.kind, a.login, a.person, pg_temp.p6_new_password() as pw
  from accounts a
  where not exists (select 1 from public.account_password_flags f where f.user_id = a.id)
  order by a.kind, a.login
  limit 800
),
changed as (
  update auth.users au
     set encrypted_password = extensions.crypt(p.pw, extensions.gen_salt('bf', 8)), updated_at = now()
    from picked p
   where au.id = p.id
  returning au.id, p.kind, p.login, p.person, p.pw, au.encrypted_password as new_hash
),
marked as (
  insert into public.account_password_flags (user_id, temp_hash, reason)
  select id, new_hash, 'first_sign_in_reset' from changed
  on conflict (user_id) do update set temp_hash = excluded.temp_hash, reason = excluded.reason, created_at = now()
  returning user_id
)
select c.kind, c.login, c.person as name, c.pw as temporary_password
from changed c
order by c.kind, c.login;
