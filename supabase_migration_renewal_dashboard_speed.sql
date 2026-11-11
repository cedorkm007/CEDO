-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_dashboard_speed.sql
-- SCHOLAR RENEWAL > DASHBOARD: FASTER (no more "Couldn't load the dashboard: canceling statement due to statement timeout").   Safe to run twice.   Undo: undo_renewal_dashboard_speed.sql
-- Run AFTER supabase_migration_renewal_lists_speed.sql.
--
-- WHY IT WAS SLOW: to count the scholars who have not applied, the dashboard asked "is this scholar in a renewal window of this term?" separately for every scholar (thousands of times),
-- and it carried the whole stored check of every application through its calculations. The lists got the same fix earlier (supabase_migration_renewal_lists_speed.sql); the dashboard was missed.
-- WHAT CHANGES: the same question is answered ONCE, as a set (_renewal_window_members), and only the few columns the numbers need are read. The numbers are exactly the same.
-- Replaces 1 function. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._renewal_window_members(text,text)') is null or to_regprocedure('public.can_view_renewal_dashboard()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_lists_speed.sql and supabase_migration_renewal_dashboard_for_sdp_approver.sql first.';
  end if;
end $$;

create or replace function public.renewal_dashboard(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_opens date; v_closes date; v_late boolean; v_nwin integer;
  v_res jsonb;
begin
  if not public.can_view_renewal_dashboard() then raise exception 'Not authorized to view renewal reports.'; end if;
  -- a term can have several windows (one per group of schools): the dashboard shows the first opening to the last closing of the term
  select min(w.opens_on), max(w.closes_on), bool_or(w.late_allowed), count(*)::integer into v_opens, v_closes, v_late, v_nwin from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term;

  with rec as (
    select r.id, r.stage, r.result, r.is_late, r.applied_at, r.confirmed_at, r.rule_code, r.consultation_required, r.consultation_done_at, r.no_show_count, r.division_head_decision,
           coalesce((r.evaluation ->> 'failed_effective')::int, 0) as failed_eff, coalesce((r.evaluation ->> 'open_inc')::int, 0) as open_inc_n,
           s.school as school_name, s.status as scholar_status
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.school_year = p_school_year and r.term = p_term
  ),
  eligible as (
    select s.scholar_id_number, s.school as school_name
    from public.scholars s
    where s.status not in ('Removed', 'On leave')
      and s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m)
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
    'window', case when coalesce(v_nwin, 0) = 0 then null else jsonb_build_object('opens_on', v_opens, 'closes_on', v_closes, 'late_allowed', v_late, 'windows', v_nwin,
        'days_left', greatest(v_closes - v_today, 0), 'is_open', exists (select 1 from public.renewal_windows w2 where w2.school_year = p_school_year and w2.term = p_term and v_today between w2.opens_on and w2.closes_on)) end,
    'generated_at', now(),
    'filter_options', jsonb_build_object(
      'schools', coalesce((select jsonb_agg(distinct x.school_name order by x.school_name) from (select school_name from rec union all select school_name from eligible) x where x.school_name is not null), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(distinct y order by y) from (select coalesce(r.confirmed_year_level, s.year_level) as y from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number where r.school_year = p_school_year and r.term = p_term
          union all select s.year_level from public.scholars s where s.status not in ('Removed', 'On leave')) q where y is not null and y <> ''), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(distinct p order by p) from (select coalesce(r.confirmed_program, s.course) as p from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number where r.school_year = p_school_year and r.term = p_term
          union all select s.course from public.scholars s where s.status not in ('Removed', 'On leave')) q where p is not null and p <> ''), '[]'::jsonb)),
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
      'with_failed', (select count(*) from rec where failed_eff > 0 and stage <> 'not_required'),
      'with_inc', (select count(*) from rec where open_inc_n > 0 and stage <> 'not_required')),
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

notify pgrst, 'reload schema';
