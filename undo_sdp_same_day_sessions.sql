-- undo_sdp_same_day_sessions.sql: back to one "day" per DATE (the credits allowed = the number of different dates; one code and one credit per date).
-- The three new columns and the session ids stay (so nothing is lost); only the rules go back.
begin;

drop trigger if exists sdp_fill_session_ids on public.sdp_activities;
drop function if exists public._sdp_fill_session_ids();

drop function if exists public.credit_scholar_for_day(uuid, text, date, date, text, text, text);
create or replace function public.credit_scholar_for_day(
  p_activity_id uuid,
  p_scholar_id_number text,
  p_day date default null,
  p_attended_date date default null,
  p_school_year text default null,
  p_semester text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_scholar text;
  v_school_year text;
  v_semester text;
  v_days date[];
  v_day date;
  v_allowed integer;
  v_have integer;
  v_occurrence integer;
  v_attended date;
begin
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'You are not allowed to credit scholars for this activity.';
  end if;
  select a.activity_type into v_type from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;

  select s.scholar_id_number into v_scholar from public.scholars s where lower(s.scholar_id_number) = lower(btrim(coalesce(p_scholar_id_number, ''))) limit 1;
  if v_scholar is null then raise exception 'No scholar with Scholar ID "%" was found.', btrim(coalesce(p_scholar_id_number, '')); end if;

  -- The semester the credit counts in: the one chosen, else the current grading period.
  if coalesce(p_school_year, '') = '' and coalesce(p_semester, '') = '' then
    select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  else
    v_school_year := p_school_year; v_semester := p_semester;
    if not public._sdp_period_is_known(v_school_year, v_semester) then raise exception 'That school year and semester are not on record.'; end if;
  end if;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  if v_type is distinct from 'recurring' then
    -- One-time activity: as before. One credit; crediting again only updates its date and semester.
    v_attended := coalesce(p_attended_date, p_day, (now() at time zone 'Asia/Manila')::date);
    insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
    values (p_activity_id, v_scholar, v_attended, auth.uid(), 1, v_school_year, v_semester)
    on conflict (activity_id, scholar_id_number, occurrence_number)
    do update set attended_date = excluded.attended_date, school_year = excluded.school_year, semester = excluded.semester;
    return jsonb_build_object('ok', true, 'occurrence', 1, 'day', null);
  end if;

  -- Recurring activity: one credit for each chosen day, up to the number of days.
  select coalesce(array_agg(x.day order by x.day), '{}'::date[]) into v_days from (select distinct d.day from public._sdp_schedule_days(p_activity_id) d where d.day is not null) x;
  v_allowed := public._sdp_allowed_occurrences(p_activity_id);
  v_day := p_day;
  if v_day is null then
    if coalesce(array_length(v_days, 1), 0) = 1 then v_day := v_days[1];
    else raise exception 'Choose which day of this activity you are crediting.'; end if;
  end if;
  if not (v_day = any (v_days)) then raise exception 'That date is not one of the days of this activity.'; end if;

  if exists (
    select 1 from public.sdp_attendance c
    where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar
      and (c.activity_day = v_day or (c.activity_day is null and c.attended_date = v_day))
  ) then
    raise exception 'This scholar is already credited for %.', to_char(v_day, 'FMMon FMDD, YYYY');
  end if;
  select count(*) into v_have from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar;
  if v_have >= v_allowed then
    raise exception 'This scholar already has all % credit% of this activity.', v_allowed, case when v_allowed = 1 then '' else 's' end;
  end if;

  select coalesce(max(c.occurrence_number), 0) + 1 into v_occurrence from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar;
  v_attended := coalesce(p_attended_date, v_day);
  insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
  values (p_activity_id, v_scholar, v_attended, auth.uid(), v_occurrence, v_school_year, v_semester, v_day);
  return jsonb_build_object('ok', true, 'occurrence', v_occurrence, 'day', v_day);
end;
$$;
revoke all on function public.credit_scholar_for_day(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.credit_scholar_for_day(uuid, text, date, date, text, text) to authenticated;

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

  -- SDP activities that can be credited more than once: one code of each kind from the same batch for each scholar.
  -- (An activity that can be credited only once keeps its plain "already completed" message below.)
  if v_session.sdp_activity_id is not null and public._sdp_allowed_occurrences(v_session.sdp_activity_id) > 1 and exists (
    select 1 from public.attendance_codes c
    where c.session_id = v_code.session_id and c.kind = v_code.kind and coalesce(c.batch_number, 1) = coalesce(v_code.batch_number, 1)
      and c.redeemed_by_scholar_id = v_scholar.scholar_id_number and c.id <> v_code.id
  ) then
    raise exception 'You already scanned a code from this batch. Another credit needs a QR code from a different batch.';
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

drop function if exists public._apply_attendance(uuid, text, text, date, text);
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

drop function if exists public._sdp_session_sub_name(uuid, date, text);
drop function if exists public._sdp_schedule_days(uuid);
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

notify pgrst, 'reload schema';
commit;
