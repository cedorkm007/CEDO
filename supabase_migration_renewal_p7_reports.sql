-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p7_reports.sql
--
-- Scholar Renewal System, Phase 7: the dashboard and the Excel export. Run AFTER the Phase 6 file. Additive and safe to run twice.
--
--   renewal_dashboard(school_year, term)   one read-only answer with every number the dashboard shows (counts by stage, outcome, school,
--                                          rule; applications per day; INC; consultations; documents; the Division Head's queue).
--   renewal_export_data(school_year, term) the rows behind the Excel file (applications, not applied, INC subjects, consultations).
--                                          Every export is written to renewal_export_log (who, when, which term, how many rows),
--                                          because the file contains scholars' names and grades.
-- Who may call them: the evaluator, consultation staff and the Division Head (the same people who can read renewals).
-- ─────────────────────────────────────────────────────────────

create table if not exists public.renewal_export_log (
  id          uuid primary key default gen_random_uuid(),
  exported_by uuid references public.users(id) on delete set null,
  by_label    text not null default '',
  school_year text not null,
  term        text not null,
  what        text not null default 'excel',
  row_count   integer not null default 0,
  at          timestamptz not null default now()
);
alter table public.renewal_export_log enable row level security;
drop policy if exists "evaluator reads export log" on public.renewal_export_log;
create policy "evaluator reads export log" on public.renewal_export_log for select using (public.is_renewal_evaluator());
-- No write policy: rows are written by renewal_export_data().

create or replace function public.renewal_dashboard(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_win public.renewal_windows%rowtype;
  v_res jsonb;
begin
  if not (public.can_view_renewals() or public.has_staff_tag('sead_division_head')) then raise exception 'Not authorized to view renewal reports.'; end if;
  select * into v_win from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term;

  with rec as (
    select r.*, s.school as school_name, s.status as scholar_status
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.school_year = p_school_year and r.term = p_term
  ),
  eligible as (
    select s.scholar_id_number, s.school as school_name
    from public.scholars s
    where s.status not in ('Removed', 'On leave')
      and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term)
  ),
  by_school as (
    select coalesce(x.school_name, '(no school)') as school,
           sum(x.applied) as applied, sum(x.renewed) as renewed, sum(x.removed) as removed, sum(x.pending) as pending, sum(x.not_applied) as not_applied
    from (
      select r.school_name, 1 as applied, (r.stage = 'renewed')::int as renewed, (r.stage = 'removed')::int as removed,
             (r.stage not in ('renewed', 'removed', 'late_declined', 'not_required'))::int as pending, 0 as not_applied
      from rec r where r.stage <> 'not_required'
      union all
      select e.school_name, 0, 0, 0, 0, 1 from eligible e
    ) x group by coalesce(x.school_name, '(no school)')
  )
  select jsonb_build_object(
    'school_year', p_school_year, 'term', p_term, 'term_label', public._renewal_term_label(p_school_year, p_term),
    'window', case when v_win.id is null then null else jsonb_build_object('opens_on', v_win.opens_on, 'closes_on', v_win.closes_on, 'late_allowed', v_win.late_allowed,
        'days_left', greatest(v_win.closes_on - v_today, 0), 'is_open', v_today between v_win.opens_on and v_win.closes_on) end,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'can_renew', (select count(*) from rec where stage <> 'not_required') + (select count(*) from eligible),
      'applied', (select count(*) from rec where stage <> 'not_required'),
      'not_applied', (select count(*) from eligible),
      'not_required', (select count(*) from rec where stage = 'not_required'),
      'late', (select count(*) from rec where is_late),
      'late_waiting', (select count(*) from rec where stage = 'late_pending'),
      'late_declined', (select count(*) from rec where stage = 'late_declined'),
      'renewed', (select count(*) from rec where stage = 'renewed'),
      'renewed_regular', (select count(*) from rec where stage = 'renewed' and result = 'renewed'),
      'renewed_probationary', (select count(*) from rec where stage = 'renewed' and result = 'renewed_probationary'),
      'renewed_reconsidered', (select count(*) from rec where stage = 'renewed' and result = 'reconsidered'),
      'removed', (select count(*) from rec where stage = 'removed'),
      'returned', (select count(*) from rec where stage = 'returned'),
      'avg_days_to_renew', (select round(avg(extract(epoch from (confirmed_at - applied_at)) / 86400.0)::numeric, 1) from rec where stage = 'renewed' and confirmed_at is not null and applied_at is not null)),
    'by_stage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from rec group by stage) q), '{}'::jsonb),
    'by_rule', coalesce((select jsonb_object_agg(rule_code, n) from (select rule_code, count(*) as n from rec where rule_code is not null and stage <> 'not_required' group by rule_code) q), '{}'::jsonb),
    'by_school', coalesce((select jsonb_agg(jsonb_build_object('school', school, 'applied', applied, 'renewed', renewed, 'removed', removed, 'pending', pending, 'not_applied', not_applied) order by school) from by_school), '[]'::jsonb),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'applied', a, 'renewed', n) order by d) from (
        select coalesce(x.d, y.d) as d, coalesce(x.a, 0) as a, coalesce(y.n, 0) as n from
          (select (applied_at at time zone 'Asia/Manila')::date as d, count(*) as a from rec where applied_at is not null group by 1) x
          full join (select (confirmed_at at time zone 'Asia/Manila')::date as d, count(*) as n from rec where stage = 'renewed' and confirmed_at is not null group by 1) y on y.d = x.d) q), '[]'::jsonb),
    'sdp_and_grades', jsonb_build_object(
      'sdp_on_hold', (select count(*) from rec where stage = 'sdp_on_hold'),
      'waiting_grades', (select count(*) from rec where stage = 'waiting_grades'),
      'review_needed', (select count(*) from rec where stage = 'review_needed'),
      'with_failed', (select count(*) from rec where coalesce((evaluation ->> 'failed_effective')::int, 0) > 0 and stage <> 'not_required'),
      'with_inc', (select count(*) from rec where coalesce((evaluation ->> 'open_inc')::int, 0) > 0 and stage <> 'not_required')),
    'inc', jsonb_build_object(
      'open', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open'),
      'no_deadline', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline is null),
      'due_in_7_days', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline between v_today and v_today + 7),
      'overdue', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline < v_today),
      'resolved_passed', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'resolved_passed'),
      'failed_or_counted', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state in ('resolved_failed', 'counted_failed'))),
    'consultations', jsonb_build_object(
      'required', (select count(*) from rec where consultation_required and stage not in ('not_required', 'late_declined')),
      'done', (select count(*) from rec where consultation_done_at is not null),
      'booked_upcoming', (select count(*) from public.counseling_slots x join rec on rec.id = x.record_id where x.state = 'booked' and x.starts_at > now()),
      'attended', (select count(*) from public.counseling_slots x join rec on rec.id = x.record_id where x.state = 'attended'),
      'no_shows', (select coalesce(sum(no_show_count), 0) from rec),
      'need_booking', (select count(*) from rec where consultation_required and consultation_done_at is null and stage not in ('not_required', 'late_declined', 'returned', 'renewed', 'removed')
          and not exists (select 1 from public.counseling_slots x where x.record_id = rec.id and x.state = 'booked'))),
    'documents', jsonb_build_object(
      'waiting_review', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'submitted' and d.kind in ('study_plan', 'inc_letter')),
      'approved', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'accepted'),
      'returned', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'returned')),
    'division_head', jsonb_build_object(
      'waiting', (select count(*) from rec where stage in ('endorsed_division_head', 'needs_consultation_division_head')
          and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = rec.id and f.status = 'forwarded_to_division_head')),
      'sent_back', (select count(*) from public.scholar_counseling_referrals f join rec on rec.id = f.renewal_record_id where f.status = 'reconsideration_requested'),
      'approved_probationary', (select count(*) from rec where division_head_decision = 'approved_probationary'),
      'reconsidered', (select count(*) from rec where division_head_decision = 'reconsidered'),
      'removed', (select count(*) from rec where division_head_decision = 'removed'))
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.renewal_dashboard(text, text) from public, anon;
grant execute on function public.renewal_dashboard(text, text) to authenticated;

-- The rows behind the Excel file. Records who exported what (the file holds names and grades).
create or replace function public.renewal_export_data(p_school_year text, p_term text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apps jsonb;
  v_not jsonb;
  v_inc jsonb;
  v_cons jsonb;
  v_n integer;
begin
  if not (public.can_view_renewals() or public.has_staff_tag('sead_division_head')) then raise exception 'Not authorized to export renewal reports.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'scholar_id_number', s.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
      'school', s.school, 'program', coalesce(r.confirmed_program, s.course), 'year_level', coalesce(r.confirmed_year_level, s.year_level), 'scholar_status', s.status,
      'stage', r.stage, 'rule_code', r.rule_code, 'basis', public._renewal_term_label(r.basis_school_year, r.basis_term),
      'failed_count', coalesce((r.evaluation ->> 'failed_effective')::int, 0), 'inc_open', coalesce((r.evaluation ->> 'open_inc')::int, 0),
      'previous_probation', coalesce((r.evaluation ->> 'previous_probation')::boolean, false),
      'sdp_applicable', coalesce((r.evaluation -> 'sdp' ->> 'applicable')::boolean, false), 'sdp_complied', (r.evaluation -> 'sdp' ->> 'complied')::boolean, 'sdp_missing', r.evaluation -> 'sdp' ->> 'missing',
      'study_plan', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan' order by d.uploaded_at desc limit 1),
      'inc_letter', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'inc_letter' order by d.uploaded_at desc limit 1),
      'prospectus', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'prospectus' order by d.uploaded_at desc limit 1),
      'consultation_required', r.consultation_required, 'consultation_done_at', r.consultation_done_at,
      'next_consultation', (select x.starts_at from public.counseling_slots x where x.record_id = r.id and x.state = 'booked' and x.starts_at > now() order by x.starts_at limit 1),
      'no_shows', r.no_show_count, 'late', r.is_late, 'late_decision', r.late_decision, 'division_head_decision', r.division_head_decision,
      'division_head_decided_at', r.division_head_decided_at, 'result', r.result, 'applied_at', r.applied_at, 'confirmed_at', r.confirmed_at,
      'evaluator_note', r.evaluator_comment, 'scholar_note', r.scholar_note, 'not_required_reason', r.not_required_reason)
    order by s.last_name, s.first_name), '[]'::jsonb)
  into v_apps
  from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term;

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', s.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
      'school', s.school, 'program', s.course, 'year_level', s.year_level, 'scholar_status', s.status) order by s.last_name, s.first_name), '[]'::jsonb)
  into v_not
  from public.scholars s
  where s.status not in ('Removed', 'On leave')
    and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term);

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', i.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name), 'school', s.school,
      'subject_code', i.subject_code, 'subject', i.subject, 'state', i.state, 'consultation_date', i.consultation_date, 'days_given', i.days_given, 'deadline', i.deadline,
      'days_left', case when i.state = 'open' and i.deadline is not null then i.deadline - (now() at time zone 'Asia/Manila')::date end,
      'decision', i.decision, 'decision_reason', i.decision_reason) order by i.deadline nulls last, s.last_name), '[]'::jsonb)
  into v_inc
  from public.renewal_inc_items i join public.renewal_records r on r.id = i.record_id join public.scholars s on s.scholar_id_number = i.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term;

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', x.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name), 'starts_at', x.starts_at, 'state', x.state,
      'staff', public._staff_display_name(x.staff_id)) order by x.starts_at), '[]'::jsonb)
  into v_cons
  from public.counseling_slots x join public.renewal_records r on r.id = x.record_id join public.scholars s on s.scholar_id_number = x.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term and x.state in ('booked', 'attended', 'no_show');

  v_n := jsonb_array_length(v_apps) + jsonb_array_length(v_not);
  insert into public.renewal_export_log (exported_by, by_label, school_year, term, row_count)
  values ((select u.id from public.users u where u.id = auth.uid()), public._actor_name(), p_school_year, p_term, v_n);

  return jsonb_build_object('applications', v_apps, 'not_applied', v_not, 'inc', v_inc, 'consultations', v_cons, 'exported_at', now());
end;
$$;
revoke all on function public.renewal_export_data(text, text) from public, anon;
grant execute on function public.renewal_export_data(text, text) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.renewal_export_log) as exports_logged;
