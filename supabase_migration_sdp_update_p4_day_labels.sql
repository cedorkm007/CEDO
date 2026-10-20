-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 4: SUB-NAMES FOR THE DAYS OF A RECURRING ACTIVITY.   Safe to re-run.   Undo: undo_sdp_update_p4.sql
-- Run AFTER supabase_migration_sdp_update_p1_codes_history_speed.sql and the Phase 3 file.
--
-- A recurring activity keeps its main name; each of its days can have an optional sub-name ("Day 1 - Macabalan Beach"). You chose Option X:
--   • Codes are made PER DAY. A code can carry the day it is for (attendance_codes.day_date). Older codes have no day and keep working exactly as before.
--   • A credit remembers which day it was for (sdp_attendance.activity_day), so every list can show "Main name - Sub-name".
--   • One new rule: a scholar cannot use two codes of the SAME day (and the same kind: time-in, time-out, voucher). The refused scan does not use up the code.
--   • Nothing else about counting changes: still one credit per day, the number of days still limits the scans, a Time-in / Time-out day still needs both.
--   • Sub-names are labels only. The scan that happens on a day that has no code of its own (an old code, or a monitor scanning an ID card) is labelled
--     with TODAY when today is one of the activity's days.
-- Only ADDS three optional columns and small helper functions, and replaces the scan functions with the same text plus the day.
-- ─────────────────────────────────────────────────────────────
alter table public.sdp_activities add column if not exists sub_name text;          -- the sub-name of the activity's own (first) date
alter table public.attendance_codes add column if not exists day_date date;        -- the day (Philippine calendar date) a code is for; empty = any day
alter table public.sdp_attendance add column if not exists activity_day date;      -- the day of the activity a credit is for; empty = not tied to a day

-- The days of an activity: its own date first, then each extra date, as Philippine calendar days with their sub-names.
create or replace function public._sdp_schedule_days(p_activity_id uuid)
returns table(day date, sub_name text, ord integer)
language sql
stable
security definer
set search_path = public
as $$
  select (a.date_time at time zone 'Asia/Manila')::date, nullif(btrim(a.sub_name), ''), 0
  from public.sdp_activities a where a.id = p_activity_id and a.date_time is not null
  union all
  select ((e.elem ->> 'date')::timestamptz at time zone 'Asia/Manila')::date, nullif(btrim(e.elem ->> 'subName'), ''), e.n::integer
  from public.sdp_activities a, jsonb_array_elements(coalesce(a.recurring_dates, '[]'::jsonb)) with ordinality as e(elem, n)
  where a.id = p_activity_id and e.elem ->> 'date' is not null;
$$;
revoke all on function public._sdp_schedule_days(uuid) from public, anon, authenticated;

-- The sub-name of one day of an activity (empty when that day has none, or is not one of its days).
create or replace function public._sdp_day_sub_name(p_activity_id uuid, p_day date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.sub_name from public._sdp_schedule_days(p_activity_id) d where d.day = p_day and d.sub_name is not null order by d.ord limit 1;
$$;
revoke all on function public._sdp_day_sub_name(uuid, date) from public, anon, authenticated;

-- The days of the codes a scholar redeemed in a session, in the order they were redeemed (vouchers and time-out codes: one per credited day).
create or replace function public._sdp_redeemed_days(p_session_id uuid, p_scholar_id_number text)
returns date[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(c.day_date order by c.redeemed_at, c.id), '{}'::date[])
  from public.attendance_codes c
  where c.session_id = p_session_id and c.redeemed_by_scholar_id = p_scholar_id_number and c.kind in ('voucher', 'time_out');
$$;
revoke all on function public._sdp_redeemed_days(uuid, text) from public, anon, authenticated;

-- The scan core, with the day. The old three-argument form stays (the monitor's ID-card scan uses it) and simply passes no day.
create or replace function public._apply_attendance(p_session_id uuid, p_scholar_id_number text, p_kind text, p_day date)
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
  v_day date := p_day;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  select * into v_session from public.attendance_sessions where id = p_session_id;
  if not found then raise exception 'Attendance session not found.'; end if;

  if v_session.sdp_activity_id is not null then
    v_max_occurrences := public._sdp_allowed_occurrences(v_session.sdp_activity_id);
    -- A scan with no day of its own (an older code, or a monitor scanning an ID card) is labelled with TODAY when today is one of the activity's days.
    if v_day is null and exists (select 1 from public._sdp_schedule_days(v_session.sdp_activity_id) d where d.day = (now() at time zone 'Asia/Manila')::date) then
      v_day := (now() at time zone 'Asia/Manila')::date;
    end if;
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
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
          values (v_session.sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester, case when v_occurrence = v_units then v_day else null end)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;
  end if;

  select coalesce(s.name, f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id = x.sdp_activity_id left join public.formation_activities f on f.id = x.formation_activity_id where x.id = v_session.id;
  return jsonb_build_object('alreadyScanned', false, 'kind', p_kind, 'activityName', coalesce(v_name, 'the activity'), 'surveyPending', v_survey_gate_id is not null, 'surveyId', v_survey_gate_id, 'categoryCompleted', v_category_completed,
    'day', v_day, 'daySubName', case when v_session.sdp_activity_id is not null then public._sdp_day_sub_name(v_session.sdp_activity_id, v_day) end);
end;
$function$;
revoke all on function public._apply_attendance(uuid, text, text, date) from public, anon, authenticated;

create or replace function public._apply_attendance(p_session_id uuid, p_scholar_id_number text, p_kind text)
returns jsonb
language sql
security definer
set search_path = public
as $$ select public._apply_attendance(p_session_id, p_scholar_id_number, p_kind, null::date); $$;
revoke all on function public._apply_attendance(uuid, text, text) from public, anon, authenticated;

-- The scholar's own scan: same as before, plus the one-code-per-day rule and the day of the code.
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

  -- A code made for one day of a recurring activity: one code per day (and per kind) for each scholar. The refusal undoes the claim above.
  if v_code.day_date is not null and exists (
    select 1 from public.attendance_codes c
    where c.session_id = v_code.session_id and c.kind = v_code.kind and c.day_date = v_code.day_date
      and c.redeemed_by_scholar_id = v_scholar.scholar_id_number and c.id <> v_code.id
  ) then
    raise exception 'You already scanned a code for this day%.', coalesce(' (' || nullif(public._sdp_day_sub_name(v_session.sdp_activity_id, v_code.day_date), '') || ')', '');
  end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, v_code.kind, v_code.day_date);
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
revoke all on function public.redeem_attendance_code(text) from public, anon;
grant execute on function public.redeem_attendance_code(text) to authenticated;

-- Credit after a survey is answered: same as before, each credit remembers its day.
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_prior_category_credits integer;
  v_school_year text; v_semester text; v_activity_credits integer; v_units integer; v_days date[];
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
        v_days := public._sdp_redeemed_days(v_rec.session_id, p_scholar_id_number);
        for v_occurrence in 1..v_units loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
          values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester, v_days[v_occurrence])
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;

-- "Credit these scholars": same as before, each credit remembers its day.
create or replace function public.credit_attended_scholars(p_activity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_school_year text;
  v_semester text;
  v_rec record;
  v_units integer;
  v_occurrence integer;
  v_scholars integer := 0;
  v_days date[];
begin
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'You are not allowed to credit scholars for this activity.';
  end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then credit the scholars.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  perform set_config('app.sdp_source', 'credit_attended', true);
  for v_rec in
    select s.id as session_id, r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present'
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    v_days := public._sdp_redeemed_days(v_rec.session_id, v_rec.scholar_id_number);
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester, v_days[v_occurrence])
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
    end loop;
    v_scholars := v_scholars + 1;
  end loop;
  perform set_config('app.sdp_source', '', true);
  return v_scholars;
end;
$$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;

-- The credit history (Phase 1) also notes the day of a credit.
create or replace function public._sdp_log_credit_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.sdp_attendance%rowtype;
  v_act record;
  v_actor record;
  v_hint text := nullif(current_setting('app.sdp_source', true), '');
  v_event text;
  v_source text;
  v_details jsonb := null;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select a.name, a.category, a.credits into v_act from public.sdp_activities a where a.id = v_row.activity_id;
  select * into v_actor from public._sdp_history_actor();

  if tg_op = 'INSERT' then
    v_event := 'credit_added';
    v_details := case when new.activity_day is not null then jsonb_build_object('activity_day', new.activity_day) end;
    v_source := coalesce(v_hint,
      case when new.created_by is not null then 'manual'
           when v_actor.actor_id is null then 'system'
           when v_actor.actor_is_staff then 'monitor_scan'
           else 'scholar_scan' end);
  elsif tg_op = 'DELETE' then
    v_event := 'credit_removed';
    v_details := case when old.activity_day is not null then jsonb_build_object('activity_day', old.activity_day) end;
    v_source := coalesce(v_hint, 'removed');
  else
    if (old.activity_id, old.scholar_id_number, old.occurrence_number, old.school_year, old.semester, old.attended_date)
       is not distinct from (new.activity_id, new.scholar_id_number, new.occurrence_number, new.school_year, new.semester, new.attended_date) then
      return null;     -- nothing that matters changed
    end if;
    v_event := 'credit_changed';
    v_source := coalesce(v_hint, 'manual');
    v_details := jsonb_build_object(
      'from', jsonb_build_object('activity_id', old.activity_id, 'occurrence_number', old.occurrence_number, 'school_year', old.school_year, 'semester', old.semester, 'attended_date', old.attended_date),
      'to',   jsonb_build_object('activity_id', new.activity_id, 'occurrence_number', new.occurrence_number, 'school_year', new.school_year, 'semester', new.semester, 'attended_date', new.attended_date));
  end if;

  insert into public.sdp_credit_history (event_type, source, activity_id, activity_name, scholar_id_number, occurrence_number, activity_credits, category,
                                         school_year, semester, actor_id, actor_name, details)
  values (v_event, v_source, v_row.activity_id, v_act.name, v_row.scholar_id_number, v_row.occurrence_number, v_act.credits, v_act.category,
          v_row.school_year, v_row.semester, v_actor.actor_id, v_actor.actor_name, v_details);
  return null;
end;
$$;
revoke all on function public._sdp_log_credit_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
