-- ─────────────────────────────────────────────────────────────
-- supabase_migration_school_account_username.sql
--
-- School accounts can now be created with a USERNAME + PASSWORD chosen by
-- IT, instead of a real email address + the fixed default password.
--
--   * school_accounts.username  -- new, nullable (accounts created before
--     this change have none and keep working: they sign in by school name).
--     Stored lowercase; letters/digits with single '.', '_' or '-'
--     separators between them, 3-30 chars (it is also the local part of the
--     hidden login email, so it has to be a valid one).
--   * The Supabase Auth login email for a new account is generated as
--     <username>@schools.cedo.local -- same idea as scholars'
--     <scholar id>@scholars.cedo.local. Nobody types or receives mail at it.
--     It is stored in school_accounts.email as before, so everything that
--     already reads that column keeps working.
--
-- LOGIN: resolve_school_login_email() keeps its exact signature (so the
-- currently deployed app keeps working while this rolls out) but now
-- matches a USERNAME first, then falls back to the school name -- existing
-- schools can keep signing in with their school name.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.school_accounts add column if not exists username text;

create unique index if not exists school_accounts_username_unique
  on public.school_accounts (lower(username)) where username is not null;

alter table public.school_accounts drop constraint if exists school_accounts_username_format;
alter table public.school_accounts add constraint school_accounts_username_format
  check (username is null or (username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(username) between 3 and 30));

create or replace function public.resolve_school_login_email(p_school_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select a.email
       from public.school_accounts a
      where a.username is not null and lower(a.username) = lower(trim(p_school_name))
      limit 1),
    (select a.email
       from public.school_accounts a
       join public.schools sch on sch.id = a.school_id
      where lower(trim(sch.name)) = lower(trim(p_school_name))
      limit 1)
  );
$$;
grant execute on function public.resolve_school_login_email(text) to anon, authenticated;
