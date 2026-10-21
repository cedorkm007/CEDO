-- UNDO for supabase_migration_sdp_update_p7_a_staff_tags.sql: puts back the rule the live project had ("staff full access": any staff account may read and change every row).
-- No row is touched.
set lock_timeout = '5s';
drop policy if exists "p7 staff read tags" on public.staff_account_tags;
drop policy if exists "p7 it admin changes tags" on public.staff_account_tags;
drop policy if exists "staff full access" on public.staff_account_tags;
create policy "staff full access" on public.staff_account_tags for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
