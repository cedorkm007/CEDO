-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 5: THE SEMESTER A CREDIT COUNTS IN.   Safe to re-run.   Undo: undo_sdp_update_p5.sql
--
--   • "Credit these scholars" can now be given a semester (it still defaults to the current grading period when none is given).
--   • A new function lets SDP Monitoring staff (or the activity's monitor) MOVE one credit to another semester, for example a credit that was stamped
--     2nd Semester but belongs to the 1st. The move is written to the credit history (Phase 1) with the old and the new semester.
--   • Only known semesters are accepted (those on record in the academic periods, or the current grading period).
-- Creates and replaces FUNCTIONS only: no table is locked, so it can be run at any time. Changes no existing data.
-- ─────────────────────────────────────────────────────────────

-- Is this school year + semester one the system knows (an academic period, or the current grading period)?
create or replace function public._sdp_period_is_known(p_school_year text, p_semester text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.academic_periods ap where ap.school_year = p_school_year and ap.term = p_semester)
      or exists (select 1 from public.grading_period_settings gps where gps.id = true and gps.current_school_year = p_school_year and gps.current_semester = p_semester);
$$;
revoke all on function public._sdp_period_is_known(text, text) from public, anon, authenticated;

-- "Credit these scholars" with a chosen semester.
create or replace function public.credit_attended_scholars(p_activity_id uuid, p_school_year text, p_semester text)
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
  if coalesce(p_school_year, '') = '' and coalesce(p_semester, '') = '' then
    -- No semester chosen: the current grading period, as before.
    select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  else
    v_school_year := p_school_year; v_semester := p_semester;
    if not public._sdp_period_is_known(v_school_year, v_semester) then raise exception 'That school year and semester are not on record.'; end if;
  end if;
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
revoke all on function public.credit_attended_scholars(uuid, text, text) from public, anon;
grant execute on function public.credit_attended_scholars(uuid, text, text) to authenticated;

-- The older one-argument form (current grading period) stays, so nothing that calls it breaks.
create or replace function public.credit_attended_scholars(p_activity_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$ select public.credit_attended_scholars(p_activity_id, null::text, null::text); $$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;

-- Move ONE credit to another semester. It never adds or removes a credit; it only changes which semester it counts in.
create or replace function public.move_sdp_credit_semester(p_credit_id uuid, p_school_year text, p_semester text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity uuid;
begin
  select a.activity_id into v_activity from public.sdp_attendance a where a.id = p_credit_id;
  if not found then raise exception 'The credit was not found.'; end if;
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', v_activity)) then
    raise exception 'You are not allowed to change this credit.';
  end if;
  if not public._sdp_period_is_known(p_school_year, p_semester) then raise exception 'That school year and semester are not on record.'; end if;
  perform set_config('app.sdp_source', 'semester_move', true);
  update public.sdp_attendance set school_year = p_school_year, semester = p_semester
    where id = p_credit_id and (school_year is distinct from p_school_year or semester is distinct from p_semester);
  perform set_config('app.sdp_source', '', true);
end;
$$;
revoke all on function public.move_sdp_credit_semester(uuid, text, text) from public, anon;
grant execute on function public.move_sdp_credit_semester(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
