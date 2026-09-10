-- ─────────────────────────────────────────────────────────────
-- supabase_migration_forms_management_fix_tag_gate.sql
--
-- Bug fix: the SELECT policies on form_materials and
-- form_material_conditions checked public.is_sead_staff() — a flag
-- unrelated to the "forms_management" tag it.admin1 actually grants
-- from Staff Accounts. Every account currently tagged for this tool
-- (sead.sma1, sead.sma5, sead.sma6, sead.sma7, sead.admin1, it.admin1)
-- has is_sead_staff = false, so the Forms Management page rendered but
-- could never read any material — RLS denial looks like "no rows," not
-- an error, so it just showed empty. Write access was already correctly
-- scoped to the tag (see supabase_migration_form_material_unlock_engine.sql
-- step 6) — only these two read policies were missed.
--
-- Same fix shape as supabase_migration_scholarship_program_info_fix_tag_gate.sql.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "staff read form materials" on public.form_materials;
create policy "staff read form materials" on public.form_materials
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read form material conditions" on public.form_material_conditions;
create policy "staff read form material conditions" on public.form_material_conditions
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );
