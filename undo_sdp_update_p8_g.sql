-- UNDO for supabase_migration_sdp_update_p8_g_schools_and_settings.sql: puts back the rule the live project had ("staff full access") on all five tables. No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 staff read schools" on public.schools;
drop policy if exists "p8 grades and scholar staff change schools" on public.schools;
drop policy if exists "staff full access" on public.schools;
create policy "staff full access" on public.schools for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "p8 it admin manages school accounts" on public.school_accounts;
drop policy if exists "staff full access" on public.school_accounts;
create policy "staff full access" on public.school_accounts for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "p8 grades staff manage school grading configs" on public.school_grading_configs;
drop policy if exists "staff full access" on public.school_grading_configs;
create policy "staff full access" on public.school_grading_configs for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "p8 grades staff manage school letter grades" on public.school_letter_grades;
drop policy if exists "staff full access" on public.school_letter_grades;
create policy "staff full access" on public.school_letter_grades for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "p8 grades staff change grading period" on public.grading_period_settings;
drop policy if exists "staff full access" on public.grading_period_settings;
create policy "staff full access" on public.grading_period_settings for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
