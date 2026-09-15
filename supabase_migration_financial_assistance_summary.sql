-- ─────────────────────────────────────────────────────────────
-- supabase_migration_financial_assistance_summary.sql
--
-- Adds a read-only Financial Assistance summary to Scholarship Program
-- Information (birds-eye stat counts + Barangay/School breakdown,
-- mirroring Mainstream Scholars' own pattern) — separate from the
-- Financial Assistance Tools management page, which stays gated by the
-- "financial_assistance" tag alone.
--
-- These RPCs are gated by is_scholarship_program_staff() (NOT
-- is_financial_assistance_staff()) — this summary lives on a page only
-- scholarship_program_info-tagged staff can reach, so its own RPCs must
-- check that same tag. Using the wrong predicate here would repeat the
-- exact "wrong tag/helper" bug class fixed earlier in
-- supabase_migration_fix_tag_gate_round2.sql: a scholarship_program_info
-- staff member who lacks financial_assistance would reach this tab (the
-- page-level gate lets them in) but get an authorization error on every
-- RPC call once inside it.
--
-- The applicants table itself needs a SECOND select policy for the same
-- reason — RLS policies are OR'd together, so this adds
-- is_scholarship_program_staff() access alongside the existing
-- is_financial_assistance_staff()-only policy, rather than replacing it.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "scholarship program staff read applicants" on public.financial_assistance_applicants;
create policy "scholarship program staff read applicants" on public.financial_assistance_applicants
  for select using (public.is_scholarship_program_staff());

drop policy if exists "scholarship program staff read periods" on public.financial_assistance_periods;
create policy "scholarship program staff read periods" on public.financial_assistance_periods
  for select using (public.is_scholarship_program_staff());

create or replace function public.financial_assistance_status_counts(p_period_id uuid)
returns table (processing_count bigint, approved_count bigint, total_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'approved'),
    count(*)
  from public.financial_assistance_applicants
  where period_id = p_period_id;
end;
$$;
revoke all on function public.financial_assistance_status_counts(uuid) from public;
grant execute on function public.financial_assistance_status_counts(uuid) to authenticated;

create or replace function public.financial_assistance_by_barangay(p_period_id uuid)
returns table (barangay text, applicant_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select coalesce(nullif(trim(a.barangay), ''), 'No Barangay Set'), count(*)
  from public.financial_assistance_applicants a
  where a.period_id = p_period_id
  group by coalesce(nullif(trim(a.barangay), ''), 'No Barangay Set');
end;
$$;
revoke all on function public.financial_assistance_by_barangay(uuid) from public;
grant execute on function public.financial_assistance_by_barangay(uuid) to authenticated;

create or replace function public.financial_assistance_by_school(p_period_id uuid)
returns table (school text, applicant_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select coalesce(nullif(trim(a.school), ''), 'No School Set'), count(*)
  from public.financial_assistance_applicants a
  where a.period_id = p_period_id
  group by coalesce(nullif(trim(a.school), ''), 'No School Set');
end;
$$;
revoke all on function public.financial_assistance_by_school(uuid) from public;
grant execute on function public.financial_assistance_by_school(uuid) to authenticated;
