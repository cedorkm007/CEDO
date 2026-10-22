-- UNDO for supabase_migration_sdp_update_p8_d_sdp_status.sql: puts back the broader rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 other staff read sdp status" on public.scholar_sdp_category_status;
drop policy if exists "staff full access" on public.scholar_sdp_category_status;
create policy "staff full access" on public.scholar_sdp_category_status for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
