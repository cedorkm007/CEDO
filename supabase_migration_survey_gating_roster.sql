-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_gating_roster.sql
--
-- Staff-facing roster of every scholar whose attendance/voucher has ever
-- been gated by a given survey, with their current status: still pending
-- (scanned in, hasn't finished/declined yet), completed, or declined.
-- Shown in Survey Results alongside the existing per-question stats.
--
-- Population logic: a scholar can be found via EITHER of two routes,
-- which are mutually exclusive at any point in time —
--   - research_survey_responses has a row for them (any status: their
--     response was at least started, whether or not it's resolved yet),
--   - OR they have an attendance_records row with pending_survey_id set
--     to this survey but NO response row yet (redeem_attendance_code set
--     the gate, but the scholar hasn't opened the survey modal at all —
--     start_or_resume_survey_response is what creates the response row,
--     and that only runs once the modal actually loads).
-- Once a response resolves (completed/declined), attendance_records.
-- pending_survey_id is cleared, so the response row becomes the sole
-- record of that scholar's involvement — which is why the union below
-- excludes attendance-only rows for scholars who already have a response.
-- ─────────────────────────────────────────────────────────────

create or replace function public.research_survey_gating_roster(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then
    raise exception 'Not authorized.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', x.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), x.scholar_id_number),
    'status', x.status,
    'updatedAt', x.updated_at
  ) order by x.status, x.scholar_id_number), '[]'::jsonb)
  into v_result
  from (
    select scholar_id_number, status, updated_at
    from public.research_survey_responses
    where survey_id = p_survey_id
    union all
    select scholar_id_number, 'in_progress' as status, max(updated_at) as updated_at
    from public.attendance_records
    where pending_survey_id = p_survey_id
      and scholar_id_number not in (
        select scholar_id_number from public.research_survey_responses where survey_id = p_survey_id
      )
    group by scholar_id_number
  ) x
  left join public.scholars s on s.scholar_id_number = x.scholar_id_number;

  return v_result;
end; $$;
grant execute on function public.research_survey_gating_roster(uuid) to authenticated;
