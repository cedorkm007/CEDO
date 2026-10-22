-- UNDO for supabase_migration_sdp_update_p9_b_force_change_default_password.sql: puts back the Phase 6 behaviour (only people who were given a temporary password are made to
-- choose a new one), removes the markers this file added for accounts found on 123456, and removes the switch table. No password or account is touched.
set lock_timeout = '5s';
create or replace function public.my_password_change_required()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_flag text; v_now text;
begin
  if auth.uid() is null then return false; end if;
  select f.temp_hash into v_flag from public.account_password_flags f where f.user_id = auth.uid();
  if not found then return false; end if;
  select u.encrypted_password into v_now from auth.users u where u.id = auth.uid();
  if coalesce(v_now, '') is distinct from v_flag then
    delete from public.account_password_flags where user_id = auth.uid();
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.my_password_change_required() from public, anon;
grant execute on function public.my_password_change_required() to authenticated;
delete from public.account_password_flags where reason = 'default_password';
drop table if exists public.p9_default_password_settings;
