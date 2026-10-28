-- ─────────────────────────────────────────────────────────────
-- LIVE UPDATES: "has anything changed?" for the scholar, staff and school portals.   Safe to run twice.   Undo: undo_live_updates.sql
-- Run AFTER the renewal files (any later file may be missing: the functions simply ignore a table that does not exist yet).
--
-- The three portals ask one of these functions every ~10-15 seconds while the page is open and visible. Each answers with one short code that changes whenever anything the portal
-- shows about the renewal changes (an application moves, a document is reviewed, a booking is made, a notice arrives, grades are uploaded or entered, an SDP reconsideration is
-- decided, a window is edited, a correction request is reviewed...). When the code is different the page reads its data again by itself, so nobody has to refresh.
--   scholar_live_stamp()  for the signed-in scholar: only their own renewal, notices, grades, SDP credits, bookings and status
--   staff_live_stamp()    for renewal staff (evaluator, consultation staff, Division Head, the heads of SEAD, the SDP reconsideration approvers and the Grades Approvers)
--   school_live_stamp()   for the signed-in school: its correction requests, submission, periods, grading setup, scholars and grades
-- The codes hold no names or grades, only counts and times. They read a few counts and "latest change" times, each from an indexed column, so each call is very light.
-- Creates functions only. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- Runs one small query for a code and returns its answer as text; a table or column that does not exist (yet) gives '' instead of an error.
create or replace function public._live_part(p_sql text, p_arg text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_arg is null then execute p_sql into v; else execute p_sql using p_arg into v; end if;
  return coalesce(v, '');
exception when others then
  return '';
end;
$$;
revoke all on function public._live_part(text, text) from public, anon, authenticated;

-- Calls a yes/no function by name, answering false when it does not exist (yet).
create or replace function public._live_can(p_fn text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v boolean;
begin
  if to_regprocedure('public.' || p_fn || '()') is null then return false; end if;
  execute 'select public.' || p_fn || '()' into v;
  return coalesce(v, false);
exception when others then
  return false;
end;
$$;
revoke all on function public._live_can(text) from public, anon, authenticated;

create or replace function public.scholar_live_stamp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_school uuid;
  v_s text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select s.school_id into v_school from public.scholars s where s.scholar_id_number = v_id;
  v_s := concat_ws('|',
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_records where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(h.at)::text, '''') from public.renewal_history h join public.renewal_records r on r.id = h.record_id where r.scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(uploaded_at)::text, '''') || '':'' || coalesce(max(reviewed_at)::text, '''') from public.renewal_documents where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(i.updated_at)::text, '''') from public.renewal_inc_items i join public.renewal_records r on r.id = i.record_id where r.scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(booked_at)::text, '''') || '':'' || coalesce(max(marked_at)::text, '''') from public.counseling_slots where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_counseling_referrals where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') || '':'' || count(*) filter (where read_at is null) from public.scholar_notifications where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_subjects_grades where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.sdp_attendance where scholar_id_number = $1', v_id),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholar_sdp_category_status where scholar_id_number = $1', v_id),
    public._live_part('select status || '':'' || coalesce(updated_at::text, '''') from public.scholars where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_windows'),
    public._live_part('select coalesce(updated_at::text, '''') from public.grading_period_settings where id = true'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, requested_at))::text, '''') from public.sdp_reconsideration_requests where scholar_id_number = $1', v_id),
    public._live_part('select count(*) from public.sdp_reconsideration_debts where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, submitted_at))::text, '''') || '':'' || coalesce(max(official_checked_at)::text, '''') from public.renewal_self_grade_submissions where scholar_id_number = $1', v_id),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.csr_issued where scholar_id_number = $1', v_id),
    case when v_school is null then '' else public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.school_period_submissions where school_id = $1::uuid', v_school::text) end);
  return md5(v_s);
end;
$$;
revoke all on function public.scholar_live_stamp() from public, anon;
grant execute on function public.scholar_live_stamp() to authenticated;

create or replace function public.staff_live_stamp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s text;
begin
  if not (public.can_view_renewals() or public._live_can('can_view_renewal_reports') or public._live_can('can_decide_sdp_reconsideration') or public._live_can('can_approve_scholar_grades')) then
    raise exception 'Not authorized to follow renewal changes.';
  end if;
  v_s := concat_ws('|',
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_records'),
    public._live_part('select count(*) || '':'' || coalesce(max(at)::text, '''') from public.renewal_history'),
    public._live_part('select count(*) || '':'' || coalesce(max(uploaded_at)::text, '''') || '':'' || coalesce(max(reviewed_at)::text, '''') from public.renewal_documents'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_inc_items'),
    public._live_part('select count(*) || '':'' || coalesce(max(booked_at)::text, '''') || '':'' || coalesce(max(marked_at)::text, '''') from public.counseling_slots where state <> ''open'''),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_counseling_referrals'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_windows'),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.csr_issued'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, requested_at))::text, '''') from public.sdp_reconsideration_requests'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, submitted_at))::text, '''') || '':'' || coalesce(max(official_checked_at)::text, '''') from public.renewal_self_grade_submissions'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.school_period_submissions'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholar_subjects_grades'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholars'),
    public._live_part('select coalesce(updated_at::text, '''') from public.grading_period_settings where id = true'));
  return md5(v_s);
end;
$$;
revoke all on function public.staff_live_stamp() from public, anon;
grant execute on function public.staff_live_stamp() to authenticated;

create or replace function public.school_live_stamp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_s text;
begin
  if v_school is null then raise exception 'Not signed in as a school.'; end if;
  v_s := concat_ws('|',
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(reviewed_at, requested_at))::text, '''') || '':'' || coalesce(max(applied_at)::text, '''') from public.grade_correction_requests where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') || '':'' || coalesce(max(reopened_at)::text, '''') from public.school_period_submissions where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.school_submission_events where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.academic_periods'),
    public._live_part('select coalesce(updated_at::text, '''') from public.grading_period_settings where id = true'),
    public._live_part('select coalesce(updated_at::text, '''') from public.school_grading_configs where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) from public.school_letter_grades where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) from public.school_marks where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholars where school_id = $1::uuid', v_school::text),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_subjects_grades where recorded_by_school_id = $1::uuid', v_school::text));
  return md5(v_s);
end;
$$;
revoke all on function public.school_live_stamp() from public, anon;
grant execute on function public.school_live_stamp() to authenticated;

notify pgrst, 'reload schema';
