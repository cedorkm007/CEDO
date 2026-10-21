-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6 — STEP 3e: set the shared starting password 123456 for the scholars that step 3 / 3b reset.
--
-- Your decision: instead of handing out individual random passwords, these scholars start with 123456 and must choose their own password the first
-- time they sign in (the website makes them; it refuses 123456 as a new password). Only scholars that have STILL NEVER SIGNED IN are changed.
-- ⚠ While an account still has 123456, anyone who knows the Scholar ID can sign in and take it over. Run p6_step3f_END_123456_after_14_days.sql
--   after 14 days to give every account that is still unclaimed a fresh random password.
--
-- One run does everyone (no list to download: the password is the same for all). It shows how many were changed. Safe to run twice (the second run
-- changes nobody). It also removes the held list of random passwords from step 3b if you made one, because those passwords no longer work.
-- Run it with "Run without RLS".
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

drop table if exists public.p6_held_temporary_passwords;

with targets as (
  select au.id
  from auth.users au
  join public.scholars s on s.id = au.id
  join public.account_password_flags f on f.user_id = au.id and f.reason in ('first_sign_in_reset', 'first_sign_in_reissue')
  where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now()) and s.status is distinct from 'Removed'
),
changed as (
  update auth.users au
     set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf', 8)), updated_at = now()
    from targets t
   where au.id = t.id
  returning au.id, au.encrypted_password as new_hash
),
marked as (
  update public.account_password_flags f
     set temp_hash = c.new_hash, reason = 'shared_start_password', created_at = now()
    from changed c
   where f.user_id = c.id
  returning f.user_id
)
select count(*) as scholars_now_using_123456 from changed;
