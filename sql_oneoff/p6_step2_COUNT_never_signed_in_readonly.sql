-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6 — STEP 2 of 3: COUNT the accounts that have never signed in.   READ-ONLY: changes nothing.
-- Run this first so you can see how many accounts the next file (STEP 3) will give a new temporary password to.
-- An account is counted when: it has never signed in, it is not switched off, and it has not been given a temporary password already.
-- ─────────────────────────────────────────────────────────────
with accounts as (
  select au.id, 'Staff' as kind, u.username as login, au.last_sign_in_at, au.banned_until
  from auth.users au join public.users u on u.id = au.id
  where lower(u.username) <> 'it.admin1'
  union all
  select au.id, 'School', coalesce(a.username, a.email), au.last_sign_in_at, au.banned_until
  from auth.users au join public.school_accounts a on a.id = au.id
  union all
  select au.id, 'Scholar', s.scholar_id_number, au.last_sign_in_at, au.banned_until
  from auth.users au join public.scholars s on s.id = au.id
  where s.status is distinct from 'Removed'
)
select kind,
       count(*)                                                                                        as accounts_in_total,
       count(*) filter (where last_sign_in_at is not null)                                             as have_signed_in,
       count(*) filter (where last_sign_in_at is null and (banned_until is null or banned_until < now())
                          and not exists (select 1 from public.account_password_flags f where f.user_id = accounts.id)) as will_get_a_new_temporary_password
from accounts
group by kind
order by kind;
