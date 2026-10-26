-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6 — STEP 3f: END the shared 123456 start password after 14 days.
--
-- Run this 14 days or more after p6_step3e_SET_123456_for_reset_scholars.sql. Every scholar who STILL has not signed in (so the account is still open
-- with 123456) gets a NEW random temporary password instead, and the old 123456 stops working. Scholars who already signed in are not touched.
-- Like step 3b, each list is also kept in the locked holding table public.p6_held_temporary_passwords: pull it again with
-- p6_step3c_SHOW_held_list_readonly.sql and delete it afterwards with p6_step3d_DELETE_held_list.sql.
-- Run it again and again until it shows NO rows (800 per run). Before the 14 days are over it shows nothing and changes nothing.
-- Run it with "Run without RLS" and download each list straight away.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

create table if not exists public.p6_held_temporary_passwords (
  user_id uuid primary key,
  kind text not null,
  login text not null,
  name text,
  temporary_password text not null,
  issued_at timestamptz not null default now()
);
alter table public.p6_held_temporary_passwords enable row level security;
revoke all on public.p6_held_temporary_passwords from public, anon, authenticated;

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
  select au.id, 'Scholar' as kind, s.scholar_id_number as login, btrim(s.last_name || ', ' || s.first_name) as person
  from auth.users au
  join public.scholars s on s.id = au.id
  join public.account_password_flags f on f.user_id = au.id and f.reason = 'shared_start_password' and f.created_at < now() - interval '14 days'
  where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now()) and s.status is distinct from 'Removed'
),
picked as (
  select a.id, a.kind, a.login, a.person, pg_temp.p6_new_password() as pw
  from accounts a
  order by a.login
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
  update public.account_password_flags f
     set temp_hash = c.new_hash, reason = 'first_sign_in_reissue', created_at = now()
    from changed c
   where f.user_id = c.id
  returning f.user_id
),
held as (
  insert into public.p6_held_temporary_passwords (user_id, kind, login, name, temporary_password)
  select id, kind, login, person, pw from changed
  on conflict (user_id) do update set temporary_password = excluded.temporary_password, issued_at = now()
  returning user_id
)
select c.kind, c.login, c.person as name, c.pw as temporary_password
from changed c
order by c.kind, c.login;
