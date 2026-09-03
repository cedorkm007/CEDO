-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_program_info_phase1.sql
--
-- Phase 1 of the new "Scholarship Program Information" staff tab
-- (gated by the scholarship_program_info tag — see staffToolTags.ts).
--
-- Indexes: every later phase of this feature groups scholars by status,
-- barangay, or (school, year_level, course) — none of these columns had
-- an index. Added up front so every phase's aggregate RPC scans an index
-- instead of the full 7,133+-row table, following the same reasoning as
-- supabase_migration_submission_roster_status_rpc_v4.sql's fix earlier
-- this session (scope/index aggregates, don't cross-join the whole org).
--
-- scholarship_status_counts(): a single-row summary of how many scholars
-- currently hold each Scholarship Status value — the 4 top-line numbers
-- shown when the tab first opens. Plain filtered counts over an indexed
-- column; no drill-down needed here since the 4 buckets are the whole
-- picture (CHECK-constrained, not derived from a join).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_scholars_status on public.scholars(status);
create index if not exists idx_scholars_barangay on public.scholars(barangay);
create index if not exists idx_scholars_school_year_course on public.scholars(school, year_level, course);

create or replace function public.scholarship_status_counts()
returns table (
  regular_count bigint,
  probationary_count bigint,
  on_leave_count bigint,
  reconsidered_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_sead_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select
    count(*) filter (where status = 'Regular'),
    count(*) filter (where status = 'Probationary'),
    count(*) filter (where status = 'On leave'),
    count(*) filter (where status = 'Reconsidered')
  from public.scholars;
end;
$$;

revoke all on function public.scholarship_status_counts() from public;
grant execute on function public.scholarship_status_counts() to authenticated;
