-- ─────────────────────────────────────────────────────────────
-- supabase_migration_monitor_attendance_by_scholar_id.sql
--
-- The scanning tool's manual-entry fallback asked monitors to type a
-- scholar's qr_token (a UUID) — impractical to type or read aloud.
-- Switch it to the scholar's own human-readable scholar_id_number
-- instead, while leaving the QR-scan path (still resolved via qr_token)
-- unchanged. record_monitor_attendance() now accepts either identifier.
--
-- Depends on: supabase_migration_monitor_attendance_scan.sql.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.record_monitor_attendance(text, uuid, uuid, text);

create or replace function public.record_monitor_attendance(
  p_activity_type text, p_activity_id uuid, p_kind text,
  p_scholar_qr_token uuid default null, p_scholar_id_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_scholar public.scholars%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_all_year_levels boolean;
  v_target_year_levels text[];
  v_scholar_name text;
  v_result jsonb;
begin
  if p_activity_type not in ('sdp', 'formation') then
    raise exception 'Invalid activity type.';
  end if;
  if not public.is_activity_monitor(p_activity_type, p_activity_id) then
    raise exception 'Not authorized to scan attendance for this activity.';
  end if;
  if p_scholar_qr_token is null and p_scholar_id_number is null then
    raise exception 'Must provide either a QR token or a scholar ID.';
  end if;

  if p_scholar_qr_token is not null then
    select * into v_scholar from public.scholars where qr_token = p_scholar_qr_token;
  else
    select * into v_scholar from public.scholars where scholar_id_number = trim(p_scholar_id_number);
  end if;
  if not found then
    return jsonb_build_object('outcome', 'unrecognized_token');
  end if;
  v_scholar_name := v_scholar.first_name || ' ' || v_scholar.last_name;

  if v_scholar.status = 'Removed' then
    return jsonb_build_object('outcome', 'removed_scholar', 'scholarName', v_scholar_name);
  end if;

  if p_activity_type = 'sdp' then
    select all_year_levels, target_year_levels into v_all_year_levels, v_target_year_levels
      from public.sdp_activities where id = p_activity_id;
  else
    select all_year_levels, target_year_levels into v_all_year_levels, v_target_year_levels
      from public.formation_activities where id = p_activity_id;
  end if;
  if not (coalesce(v_all_year_levels, true) or v_scholar.year_level = any(coalesce(v_target_year_levels, '{}'))) then
    return jsonb_build_object('outcome', 'not_eligible', 'scholarName', v_scholar_name);
  end if;

  if p_activity_type = 'sdp' then
    select * into v_session from public.attendance_sessions where sdp_activity_id = p_activity_id;
  else
    select * into v_session from public.attendance_sessions where formation_activity_id = p_activity_id;
  end if;
  if not found then
    return jsonb_build_object('outcome', 'attendance_not_enabled', 'scholarName', v_scholar_name);
  end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, p_kind);
  if (v_result->>'alreadyScanned')::boolean then
    return jsonb_build_object('outcome', 'already_scanned', 'scholarName', v_scholar_name, 'activityName', v_result->>'activityName');
  end if;

  return v_result || jsonb_build_object('outcome', 'success', 'scholarName', v_scholar_name);
end;
$function$;
grant execute on function public.record_monitor_attendance(text, uuid, text, uuid, text) to authenticated;
