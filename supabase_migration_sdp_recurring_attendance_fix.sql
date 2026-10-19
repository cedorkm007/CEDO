-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_recurring_attendance_fix.sql
--
-- SDP recurring activities: a scholar can scan once per DAY of the activity (a 3-day activity = up to 3 scans, each credited).
-- Two things were wrong:
--
--   1. The number of days was counted in UTC, not in Philippine time. A 2-day activity whose first day starts at 9:00 AM and whose second day starts
--      at 5:00 AM (Manila) has both start times on the same UTC date, so it was counted as ONE day and the second scan was refused.
--      Now the days are counted as calendar days in Asia/Manila.
--   2. Only VOUCHER activities could be scanned more than once. A recurring Time-in / Time-out activity allowed one time-in and one time-out in
--      total, so the second day was refused. Now a recurring Time-in / Time-out activity takes up to one time-in and one time-out per day; every
--      COMPLETE pair (time-in + time-out) is one credited occurrence. One-time activities behave exactly as before.
--
-- Run AFTER supabase_migration_monitor_attendance_scan.sql (it replaces _apply_attendance, redeem_attendance_code and
-- _finalize_survey_gated_attendance, keeping everything else in them the same). Safe to run again.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Counters for time-in / time-out ──────────────────────
alter table public.attendance_records add column if not exists time_in_count integer not null default 0;
alter table public.attendance_records add column if not exists time_out_count integer not null default 0;
update public.attendance_records set time_in_count = 1 where time_in_at is not null and time_in_count = 0;
update public.attendance_records set time_out_count = 1 where time_out_at is not null and time_out_count = 0;

-- ── 2. How many scans an activity allows: its days, in Manila time ──
create or replace function public._sdp_allowed_occurrences(p_activity_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when a.activity_type = 'recurring' then greatest(1, (
    select count(distinct x.d) from (
      select (a.date_time at time zone 'Asia/Manila')::date as d where a.date_time is not null
      union
      select ((elem ->> 'date')::timestamptz at time zone 'Asia/Manila')::date
      from jsonb_array_elements(coalesce(a.recurring_dates, '[]'::jsonb)) elem where elem ->> 'date' is not null
    ) x)::integer) else 1 end
  from public.sdp_activities a where a.id = p_activity_id;
$$;
revoke all on function public._sdp_allowed_occurrences(uuid) from public, anon, authenticated;

-- ── 3. The shared core of every scan ────────────────────────
create or replace function public._apply_attendance(p_session_id uuid, p_scholar_id_number text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session public.attendance_sessions%rowtype;
  v_rec public.attendance_records%rowtype;
  v_activity_id uuid; v_survey_gate_id uuid;
  v_final_status text;
  v_max_occurrences integer := 1;
  v_existing_count integer := 0;
  v_in_before integer := 0; v_out_before integer := 0; v_pairs_before integer := 0;
  v_final_voucher_count integer; v_final_in integer; v_final_out integer; v_pairs_after integer; v_units integer;
  v_occurrence integer;
  v_sdp_category text;
  v_prior_category_credits integer;
  v_category_completed boolean := false;
  v_school_year text;
  v_semester text;
  v_activity_credits integer;
  v_name text;
  v_new_credit boolean;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  select * into v_session from public.attendance_sessions where id = p_session_id;
  if not found then raise exception 'Attendance session not found.'; end if;

  if v_session.sdp_activity_id is not null then
    v_max_occurrences := public._sdp_allowed_occurrences(v_session.sdp_activity_id);
  end if;

  select * into v_rec from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = p_scholar_id_number;
  if found then
    v_in_before := greatest(coalesce(v_rec.time_in_count, 0), case when v_rec.time_in_at is not null then 1 else 0 end);
    v_out_before := greatest(coalesce(v_rec.time_out_count, 0), case when v_rec.time_out_at is not null then 1 else 0 end);
    v_existing_count := case p_kind when 'time_in' then v_in_before when 'time_out' then v_out_before else coalesce(v_rec.voucher_redemption_count, 0) end;
    v_pairs_before := least(v_in_before, v_out_before);
  end if;

  if found and v_existing_count >= v_max_occurrences then
    select coalesce(s.name, f.name) into v_name
      from public.attendance_sessions x
      left join public.sdp_activities s on s.id = x.sdp_activity_id
      left join public.formation_activities f on f.id = x.formation_activity_id
      where x.id = v_session.id;
    return jsonb_build_object(
      'alreadyScanned', true, 'kind', p_kind, 'activityName', coalesce(v_name, 'the activity'),
      'attemptsUsed', v_existing_count, 'maxAttempts', v_max_occurrences
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
    insert into public.attendance_records(session_id, scholar_id_number, time_in_at, status, time_in_count)
      values(p_session_id, p_scholar_id_number, now(), 'incomplete', 1)
      on conflict(session_id, scholar_id_number) do update
        set time_in_at = coalesce(attendance_records.time_in_at, excluded.time_in_at),
            time_in_count = v_in_before + 1,
            status = case
              when least(v_in_before + 1, v_out_before) < 1 then 'incomplete'
              when attendance_records.status = 'pending_survey' then 'pending_survey'
              else 'present'
            end,
            updated_at = now();
  elsif p_kind = 'time_out' then
    insert into public.attendance_records(session_id, scholar_id_number, time_out_at, status, time_out_count)
      values(p_session_id, p_scholar_id_number, now(), 'incomplete', 1)
      on conflict(session_id, scholar_id_number) do update
        set time_out_at = coalesce(attendance_records.time_out_at, excluded.time_out_at),
            time_out_count = v_out_before + 1,
            status = case
              when least(v_in_before, v_out_before + 1) < 1 then 'incomplete'
              when v_survey_gate_id is not null then 'pending_survey'
              else 'present'
            end,
            pending_survey_id = case when least(v_in_before, v_out_before + 1) >= 1 then v_survey_gate_id else null end,
            updated_at = now();
  else
    insert into public.attendance_records(session_id, scholar_id_number, hours_earned, status, pending_survey_id, voucher_redemption_count)
      values(p_session_id, p_scholar_id_number, coalesce(v_session.duration_hours, 1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id, 1)
      on conflict(session_id, scholar_id_number) do update
        set hours_earned = attendance_records.hours_earned + coalesce(v_session.duration_hours, 1),
            status = case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id = v_survey_gate_id,
            voucher_redemption_count = attendance_records.voucher_redemption_count + 1,
            updated_at = now();
  end if;

  if v_session.sdp_activity_id is not null then
    select status, voucher_redemption_count, time_in_count, time_out_count into v_final_status, v_final_voucher_count, v_final_in, v_final_out
      from public.attendance_records where session_id = v_session.id and scholar_id_number = p_scholar_id_number;
    v_pairs_after := least(coalesce(v_final_in, 0), coalesce(v_final_out, 0));
    -- A voucher scan is credited every time. A time-in / time-out scan is credited when it COMPLETES a new pair (so the second scan of a day
    -- does not bank or record the same occurrence twice).
    v_new_credit := case when p_kind = 'voucher' then true else v_pairs_after > v_pairs_before end;
    if v_final_status = 'present' and v_new_credit then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_session.sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        v_category_completed := true;
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        v_units := greatest(coalesce(v_final_voucher_count, 0), v_pairs_after, 1);
        for v_occurrence in 1..v_units loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (v_session.sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;
  end if;

  select coalesce(s.name, f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id = x.sdp_activity_id left join public.formation_activities f on f.id = x.formation_activity_id where x.id = v_session.id;
  return jsonb_build_object('alreadyScanned', false, 'kind', p_kind, 'activityName', coalesce(v_name, 'the activity'), 'surveyPending', v_survey_gate_id is not null, 'surveyId', v_survey_gate_id, 'categoryCompleted', v_category_completed);
end;
$function$;
revoke all on function public._apply_attendance(uuid, text, text) from public, anon, authenticated;

-- ── 4. The scholar's own scan: the message now also explains a recurring Time-in / Time-out limit ──
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

  -- Atomic claim. If the scan is then refused below, the whole call is undone, so the code is NOT used up.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, v_code.kind);
  if (v_result ->> 'alreadyScanned')::boolean then
    if (v_result ->> 'maxAttempts')::integer > 1 then
      raise exception 'You already completed this attendance requirement (% of % allowed attendances used).', v_result ->> 'attemptsUsed', v_result ->> 'maxAttempts';
    else
      raise exception 'You already completed this attendance requirement.';
    end if;
  end if;

  return v_result;
end;
$function$;

-- ── 5. Credit after a survey is answered: one credit per complete occurrence ──
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_prior_category_credits integer;
  v_school_year text; v_semester text; v_activity_credits integer; v_units integer;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        v_units := greatest(coalesce(v_rec.voucher_redemption_count, 0), least(coalesce(v_rec.time_in_count, 0), coalesce(v_rec.time_out_count, 0)), 1);
        for v_occurrence in 1..v_units loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
