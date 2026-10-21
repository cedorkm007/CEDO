-- UNDO for supabase_migration_sdp_update_p6_password_security.sql
-- Puts the three sign-in look-ups back as they were (they say plainly whether an account exists, and are not limited), and removes the new tables and
-- functions. CHECKED against the live project on 2026-10-21 (step 0): all three are restored exactly as they were there.
-- Accounts that were marked "must choose a new password" are no longer marked. No account, password or credit is touched.
set lock_timeout = '5s';
create or replace function public.resolve_scholar_login_email(
  p_first_name text default null,
  p_last_name text default null,
  p_middle_initial text default null,
  p_birthday date default null,
  p_scholar_id_number text default null
)
returns text
language sql
security definer
stable
as $$
  select email from public.scholars
  where
    (
      p_scholar_id_number is not null
      and scholar_id_number = p_scholar_id_number
    )
    or (
      p_first_name is not null and p_last_name is not null and p_birthday is not null
      and lower(trim(first_name)) = lower(trim(p_first_name))
      and lower(trim(last_name)) = lower(trim(p_last_name))
      and birthday = p_birthday
      and (
        p_middle_initial is null or p_middle_initial = ''
        or lower(left(trim(middle_name), 1)) = lower(left(trim(p_middle_initial), 1))
      )
    )
  limit 1;
$$;
grant execute on function public.resolve_scholar_login_email(text, text, text, date, text) to anon, authenticated;

create or replace function public.resolve_school_login_email(p_school_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.email
  from public.school_accounts a
  where btrim(coalesce(p_school_name, '')) <> ''
    and (lower(a.username) = lower(btrim(p_school_name)) or lower(a.email) = lower(btrim(p_school_name)))
  limit 1;
$$;
grant execute on function public.resolve_school_login_email(text) to anon, authenticated;

create or replace function public.resolve_staff_login_email(p_username text)
returns text language sql stable security definer set search_path = public
as $$ select u.email from public.users u where lower(u.username) = lower(btrim(coalesce(p_username, ''))) limit 1; $$;
grant execute on function public.resolve_staff_login_email(text) to anon, authenticated;

drop function if exists public.scholar_reset_clear(text);
drop function if exists public.scholar_reset_register_failure(text, text);
drop function if exists public.scholar_reset_is_locked(text);
drop function if exists public.scholar_reset_gate(text, text);
drop function if exists public._auth_rate_limit(text, text, text, integer, integer, interval);
drop function if exists public._auth_client_ip();
drop function if exists public._auth_hash(text);
drop function if exists public.complete_password_change();
drop function if exists public.my_password_change_required();
drop function if exists public.flag_password_change(uuid, text);
drop table if exists public.auth_attempts;
drop table if exists public.account_password_flags;
notify pgrst, 'reload schema';
