-- UNDO for supabase_migration_sdp_update_p8_e_legacy_scholar_tables.sql: puts back the rule the live project had ("staff full access") on both tables. No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 scholar management manages scholar_sdp" on public.scholar_sdp;
drop policy if exists "staff full access" on public.scholar_sdp;
create policy "staff full access" on public.scholar_sdp for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "p8 scholar management manages scholar_services" on public.scholar_services;
drop policy if exists "staff full access" on public.scholar_services;
create policy "staff full access" on public.scholar_services for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
