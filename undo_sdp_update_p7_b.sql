-- UNDO for supabase_migration_sdp_update_p7_b_users.sql: puts back the rule the live project had ("staff full access") and removes the guard and its helper.
-- No row is touched.
set lock_timeout = '5s';
drop trigger if exists p7_users_guard on public.users;
drop policy if exists "p7 staff read users" on public.users;
drop policy if exists "p7 staff update users" on public.users;
drop policy if exists "p7 it admin adds users" on public.users;
drop policy if exists "p7 it admin deletes users" on public.users;
drop policy if exists "staff full access" on public.users;
create policy "staff full access" on public.users for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop function if exists public._p7_users_guard();
drop function if exists public._p7_is_super_admin();
