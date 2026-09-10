-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_qr_attendance_auto_credit.sql
--
-- Bug fix: scanning a QR/voucher code for an SDP activity marked the
-- scholar "present" in attendance_records (with hours_earned, etc.) but
-- never inserted the sdp_attendance row that actually feeds
-- recompute_sdp_category_status() — the trigger that sums an activity's
-- credits toward the scholar's 3-required-credits-per-category total.
-- The two attendance mechanisms (self-service QR scan vs. staff's manual
-- "credit a scholar" button) had never been linked, so QR-scanned SDP
-- attendance never actually counted toward SDP completion.
--
-- Fixed at both places attendance_records.status can become 'present'
-- for an SDP session:
--   1. redeem_attendance_code() — the direct/non-survey-gated path
--      (time_in+time_out both stamped, or any voucher redemption).
--   2. _finalize_survey_gated_attendance() — the shared step that flips
--      a scholar's pending_survey attendance to 'present' once they
--      complete or decline the gating survey (called from both
--      submit_survey_response() and the consent-decline path).
-- Both re-created here with their bodies otherwise UNCHANGED from the
-- live versions (confirmed via pg_get_functiondef before writing this),
-- just adding one insert into sdp_attendance — on conflict (activity_id,
-- scholar_id_number) do nothing, so re-scanning a code (e.g. a second
-- voucher redemption) never double-credits. created_by is left null:
-- this is an automated credit, not a staff action, and
-- sdp_attendance.created_by references public.users (staff), not
-- scholars, so the scholar's own auth id doesn't belong there anyway.
-- Formation sessions (sdp_activity_id is null) are left untouched —
-- Formation has no equivalent credit/completion system.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype; v_name text; v_updated uuid;
  v_activity_id uuid; v_survey_gate_id uuid;
  v_final_status text;
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
  if exists (select 1 from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number and ((v_code.kind = 'time_in' and r.time_in_at is not null) or (v_code.kind = 'time_out' and r.time_out_at is not null) or v_code.kind = 'voucher')) then
    raise exception 'You already completed this attendance requirement.';
  end if;
  -- Atomic claim — unchanged. Must happen before any survey check below.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  v_survey_gate_id := null;
  if v_code.kind in ('time_out', 'voucher') then
    v_activity_id := coalesce(v_session.sdp_activity_id, v_session.formation_activity_id);
    select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = v_scholar.scholar_id_number and r.status in ('completed', 'declined')
    ) then
      v_survey_gate_id := null; -- already resolved this survey (completed or declined) — nothing to gate
    end if;
  end if;

  if v_code.kind = 'time_in' then
    insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status)
      values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete')
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
    insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status,pending_survey_id)
      values(v_session.id,v_scholar.scholar_id_number,coalesce(v_session.duration_hours,1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id)
      on conflict(session_id,scholar_id_number) do update
        set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),
            status=case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id=v_survey_gate_id,
            updated_at=now();
  end if;

  -- NEW: if this scholar is now (or already) 'present' for an SDP
  -- session, credit them for the activity — same effect as staff
  -- manually crediting attendance, just triggered by their own QR scan.
  if v_session.sdp_activity_id is not null then
    select status into v_final_status from public.attendance_records where session_id = v_session.id and scholar_id_number = v_scholar.scholar_id_number;
    if v_final_status = 'present' then
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by)
      values (v_session.sdp_activity_id, v_scholar.scholar_id_number, current_date, null)
      on conflict (activity_id, scholar_id_number) do nothing;
    end if;
  end if;

  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id);
end; $function$;

create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare v_rec record; v_count integer := 0; v_sdp_activity_id uuid;
begin
  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    -- NEW: same SDP auto-credit as redeem_attendance_code()'s direct
    -- path — this scholar just became 'present' for this session too,
    -- it just took resolving the gating survey first.
    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by)
      values (v_sdp_activity_id, p_scholar_id_number, current_date, null)
      on conflict (activity_id, scholar_id_number) do nothing;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
