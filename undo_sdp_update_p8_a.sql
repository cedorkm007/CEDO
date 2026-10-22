-- UNDO for supabase_migration_sdp_update_p8_a_scholars.sql: puts back the rule the live project had ("staff full access") and removes the helper. No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 staff with a scholar tool read scholars" on public.scholars;
drop policy if exists "p8 scholar management manages scholars" on public.scholars;
drop policy if exists "staff full access" on public.scholars;
create policy "staff full access" on public.scholars for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop function if exists public._p8_can_read_scholars();
