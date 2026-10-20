-- UNDO for supabase_migration_sdp_update_p4_day_labels.sql
-- Puts the scan functions back exactly as they were, removes the helper functions and the three new columns (the sub-names and the days saved on codes and
-- credits are lost). Credits, codes and scholars are not otherwise touched.
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
drop function if exists public._apply_attendance(uuid, text, text, date);

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
revoke all on function public.redeem_attendance_code(text) from public, anon;
grant execute on function public.redeem_attendance_code(text) to authenticated;

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
    select r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present'
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester)
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
    v_source := coalesce(v_hint,
      case when new.created_by is not null then 'manual'
           when v_actor.actor_id is null then 'system'
           when v_actor.actor_is_staff then 'monitor_scan'
           else 'scholar_scan' end);
  elsif tg_op = 'DELETE' then
    v_event := 'credit_removed';
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

drop function if exists public._sdp_redeemed_days(uuid, text);
drop function if exists public._sdp_day_sub_name(uuid, date);
drop function if exists public._sdp_schedule_days(uuid);
alter table public.sdp_attendance drop column if exists activity_day;
alter table public.attendance_codes drop column if exists day_date;
alter table public.sdp_activities drop column if exists sub_name;
notify pgrst, 'reload schema';
