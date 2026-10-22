-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring: MANUAL CREDIT FOR A CHOSEN DAY OF A RECURRING ACTIVITY.   Safe to run twice.   Undo: undo_sdp_manual_credit_by_day.sql
--
-- Problem: crediting a scholar by hand (Credited Scholars tab, "Credit") could give only ONE credit per activity: crediting the same scholar again just rewrote the first
-- credit. A recurring activity (several dates) should let staff credit a scholar once for EACH day, up to the number of days.
-- This adds a function that credits a scholar for ONE chosen day of the activity. Rules, checked by the database (not only on screen):
--   • only a day that really belongs to the activity can be credited (its own date or one of its extra dates);
--   • a scholar cannot be credited twice for the same day;
--   • a scholar cannot have more credits for the activity than it has days;
--   • the credit is written like any other (stamped with the semester, the day saved on it, shown in the credit history as "added by hand" with the staff member's name);
--   • a one-time activity works exactly as before (one credit; crediting again only updates its date and semester).
-- Who may use it: the same people who may credit scholars today (SDP Monitoring staff, Scholar Management staff, the activity's monitors).
-- Creates a FUNCTION only: no table is changed or locked, nothing existing is touched. Visitors who are not signed in cannot run it.
-- ─────────────────────────────────────────────────────────────
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
