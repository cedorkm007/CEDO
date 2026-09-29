-- ─────────────────────────────────────────────────────────────
-- supabase_migration_monitor_attendance_scan.sql
--
-- Phase 2 (final step) of the per-activity attendance monitor feature.
-- Depends on: supabase_migration_sdp_voucher_occurrence_cap_fix.sql,
-- supabase_migration_sdp_eligibility.sql, supabase_migration_scholar_qr_
-- and_emergency_contact.sql, supabase_migration_activity_monitor_helpers_
-- and_policies.sql — apply this one last.
--
-- Extracts the shared core of redeem_attendance_code() (everything from
-- resolving the session through the SDP category-cap/banking upserts —
-- NOT the attendance_codes-specific claim step, NOT the formation/SDP
-- eligibility pre-check, both of which stay/move to each caller) into a
-- new _apply_attendance(session, scholar, kind) function, so the new
-- monitor-scan RPC below reuses the exact same category-cap/banking/
-- survey-gating logic instead of duplicating it.
--
-- Behavior note: the "already completed this requirement" duplicate
-- check now runs INSIDE _apply_attendance, after the calling code's own
-- claim step (redeem_attendance_code still atomically claims the QR code
-- before calling in, same as before) rather than before it. This means a
-- scholar who is already at their cap and scans a fresh, valid QR code
-- will now have that code marked as claimed even though nothing further
-- is recorded — functionally identical (that code could never succeed
-- for this scholar either way, cap or no cap), the only visible
-- difference is which exact error message would show on a hypothetical
-- second attempt with the same already-claimed code.
--
-- redeem_attendance_code()'s own scholar-facing behavior (messages,
-- eligibility check, claim ordering) is otherwise unchanged.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public._apply_attendance(p_session_id uuid, p_scholar_id_number text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session public.attendance_sessions%rowtype;
  v_activity_id uuid; v_survey_gate_id uuid;
  v_final_status text;
  v_max_occurrences integer := 1;
  v_existing_voucher_count integer := 0;
  v_sdp_activity_type text;
  v_sdp_recurring_dates jsonb;
  v_sdp_date_time timestamptz;
  v_final_voucher_count integer;
  v_occurrence integer;
  v_sdp_category text;
  v_prior_category_credits integer;
  v_category_completed boolean := false;
  v_school_year text;
  v_semester text;
  v_activity_credits integer;
  v_name text;
  v_already_scanned boolean := false;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  select * into v_session from public.attendance_sessions where id = p_session_id;
  if not found then raise exception 'Attendance session not found.'; end if;

  if p_kind = 'voucher' and v_session.sdp_activity_id is not null then
    select activity_type, recurring_dates, date_time into v_sdp_activity_type, v_sdp_recurring_dates, v_sdp_date_time
      from public.sdp_activities where id = v_session.sdp_activity_id;
    if v_sdp_activity_type = 'recurring' then
      select count(distinct occurrence_day) into v_max_occurrences
      from (
        select v_sdp_date_time::date as occurrence_day
        union
        select (elem->>'date')::timestamptz::date as occurrence_day
        from jsonb_array_elements(coalesce(v_sdp_recurring_dates, '[]'::jsonb)) as elem
      ) all_days;
      v_max_occurrences := greatest(coalesce(v_max_occurrences, 1), 1);
    end if;
    select coalesce(r.voucher_redemption_count, 0) into v_existing_voucher_count
      from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = p_scholar_id_number;
    v_existing_voucher_count := coalesce(v_existing_voucher_count, 0);
  end if;

  if exists (
    select 1 from public.attendance_records r
    where r.session_id = v_session.id and r.scholar_id_number = p_scholar_id_number
      and (
        (p_kind = 'time_in' and r.time_in_at is not null)
        or (p_kind = 'time_out' and r.time_out_at is not null)
        or (p_kind = 'voucher' and coalesce(r.voucher_redemption_count, 0) >= v_max_occurrences)
      )
  ) then
    v_already_scanned := true;
  end if;

  if v_already_scanned then
    select coalesce(s.name, f.name) into v_name
      from public.attendance_sessions x
      left join public.sdp_activities s on s.id = x.sdp_activity_id
      left join public.formation_activities f on f.id = x.formation_activity_id
      where x.id = v_session.id;
    return jsonb_build_object(
      'alreadyScanned', true, 'kind', p_kind, 'activityName', coalesce(v_name, 'the activity'),
      'attemptsUsed', v_existing_voucher_count, 'maxAttempts', v_max_occurrences
    );
  end if;

  v_survey_gate_id := null;
  if p_kind in ('time_out', 'voucher') then
    v_activity_id := coalesce(v_session.sdp_activity_id, v_session.formation_activity_id);
    select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = p_scholar_id_number and r.status in ('completed', 'declined')
    ) then
      v_survey_gate_id := null; -- already resolved this survey (completed or declined) — nothing to gate
    end if;
  end if;

  if p_kind = 'time_in' then
    insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(p_session_id,p_scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif p_kind = 'time_out' then
    insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status)
      values(p_session_id,p_scholar_id_number,now(),'incomplete')
      on conflict(session_id,scholar_id_number) do update
        set time_out_at=coalesce(attendance_records.time_out_at,excluded.time_out_at),
            status=case
              when attendance_records.time_in_at is null then 'incomplete'
              when v_survey_gate_id is not null then 'pending_survey'
              else 'present'
            end,
            pending_survey_id=case when attendance_records.time_in_at is not null then v_survey_gate_id else null end,
            updated_at=now();
  else
    insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status,pending_survey_id,voucher_redemption_count)
      values(p_session_id,p_scholar_id_number,coalesce(v_session.duration_hours,1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id, 1)
      on conflict(session_id,scholar_id_number) do update
        set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),
            status=case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id=v_survey_gate_id,
            voucher_redemption_count=attendance_records.voucher_redemption_count+1,
            updated_at=now();
  end if;

  if v_session.sdp_activity_id is not null then
    select status, voucher_redemption_count into v_final_status, v_final_voucher_count
      from public.attendance_records where session_id = v_session.id and scholar_id_number = p_scholar_id_number;
    if v_final_status = 'present' then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_session.sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        v_category_completed := true;
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        for v_occurrence in 1..greatest(coalesce(v_final_voucher_count, 0), 1) loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (v_session.sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;
  end if;

  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('alreadyScanned', false, 'kind',p_kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id,'categoryCompleted', v_category_completed);
end;
$function$;

-- redeem_attendance_code(): now a thin wrapper — resolve+validate the
-- code, run the formation eligibility check, atomically claim the code,
-- then delegate to _apply_attendance. Scholar-facing behavior unchanged.
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_code public.attendance_codes%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype;
  v_updated uuid;
  v_result jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid QR code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This QR code has already been claimed.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  if v_session.formation_activity_id is not null and not exists (
    select 1 from public.formation_activities a where a.id = v_session.formation_activity_id
    and (a.all_year_levels or v_scholar.year_level = any(a.target_year_levels))
  ) then raise exception 'You are not eligible to attend this activity.'; end if;

  -- Atomic claim — unchanged. Must happen before any survey check / attendance recording.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, v_code.kind);
  if (v_result->>'alreadyScanned')::boolean then
    if v_code.kind = 'voucher' and (v_result->>'maxAttempts')::integer > 1 then
      raise exception 'You already completed this attendance requirement (% of % allowed attendances used).', v_result->>'attemptsUsed', v_result->>'maxAttempts';
    else
      raise exception 'You already completed this attendance requirement.';
    end if;
  end if;

  return v_result;
end;
$function$;

-- record_monitor_attendance(): the new monitor-facing scan entry point.
-- Authorizes via is_activity_monitor() instead of trusting auth.uid() to
-- be the scholar; resolves the scholar from their permanent qr_token
-- instead of an activity-scoped code; requires attendance to already be
-- enabled for this activity (an existing attendance_sessions row) since
-- only whoever ran the existing "Enable Attendance" flow (a tag-holder or
-- the creator, who always has full-dashboard access since CREATE stays
-- tag-gated) could have set its type/duration/expected-count correctly.
create or replace function public.record_monitor_attendance(
  p_activity_type text, p_activity_id uuid, p_scholar_qr_token uuid, p_kind text
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

  select * into v_scholar from public.scholars where qr_token = p_scholar_qr_token;
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
grant execute on function public.record_monitor_attendance(text, uuid, uuid, text) to authenticated;
