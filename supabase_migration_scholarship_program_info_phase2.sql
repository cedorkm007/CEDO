-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_program_info_phase2.sql
--
-- Phase 2 of the "Scholarship Program Information" tab: the Barangay
-- subtab. scholars_by_barangay() is a plain single-table GROUP BY,
-- scanning the idx_scholars_barangay index added in Phase 1 — no cross
-- join, no per-row subquery, following the same "scope/index the
-- aggregate" principle as the earlier submission-roster performance fix
-- this session. The canonical list of all 80 CDO barangays (including
-- ones with zero scholars) is a static TS constant (ALL_BARANGAYS in
-- src/lib/cdoBarangays.ts), not a DB table, so the client merges this
-- RPC's real counts against that list rather than the RPC trying to
-- enumerate barangays with no scholars itself.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.scholars_by_barangay()
returns table (
  barangay text,
  scholar_count bigint
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
  select s.barangay, count(*) as scholar_count
  from public.scholars s
  group by s.barangay;
end;
$$;

revoke all on function public.scholars_by_barangay() from public;
grant execute on function public.scholars_by_barangay() to authenticated;
