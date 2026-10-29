-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL > SCHOLAR LIST: "ACTION NEEDED" AND "RENEWAL STATUS" COLUMNS.   Safe to run twice.   Undo: undo_renewal_actions_needed.sql
-- Run AFTER supabase_migration_renewal_scholar_list.sql, the SDP reconsideration files and the entered grades files (up to D).
--
--   1. renewal_scholar_actions(): for the scholars on one page of the Scholar List, where each one stands: the application and its stage, the documents waiting for review, the grades
--      (school / approved / pending / returned / none), the Division Head's referral, the consultation referral and the booked consultation. It only reads.
--   2. The people who act on the list can open it: the Grades Approver and the SDP Reconsideration Approver (the Division Head and the evaluator could already). The four reading
--      functions of the list (the page, the count table, the filter values and the SDP credits view) accept them through can_view_renewal_list(). Refreshing the check stays
--      with the evaluator. Nobody loses anything.
-- Creates two functions and replaces four. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._eg_grades_status(text,text,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_entered_grades_d_apply_flow.sql first.';
  end if;
  if to_regprocedure('public.can_approve_scholar_grades()') is null or to_regprocedure('public.can_decide_sdp_reconsideration()') is null then
    raise exception 'STOPPED, nothing changed: run the entered grades files and the SDP reconsideration files first.';
  end if;
  if to_regprocedure('public.renewal_scholar_list_options(text,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_scholar_list.sql first.';
  end if;
end $$;

-- Who may read the Scholar List: the people who may view renewals (evaluator, consultation staff, Division Head), and the two kinds of approver whose work starts from it.
create or replace function public.can_view_renewal_list()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_renewals() or public.can_approve_scholar_grades() or public.can_decide_sdp_reconsideration();
$$;
revoke all on function public.can_view_renewal_list() from public, anon;
grant execute on function public.can_view_renewal_list() to authenticated;

-- Where each of the given scholars (one page of the list) stands for the term, for the Action needed and Renewal status columns. Reads only.
create or replace function public.renewal_scholar_actions(p_school_year text, p_term text, p_ids text[])
returns table(
  scholar_id_number text, record_id uuid, stage text, is_late boolean, applied_at timestamptz, docs_to_review integer,
  consultation_required boolean, consultation_done_at timestamptz, next_consultation timestamptz,
  grades_status text, dh_referral_id uuid, dh_status text, referral_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_basis_year text; v_basis_term text;
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  select b.basis_school_year, b.basis_term into v_basis_year, v_basis_term from public._renewal_basis(p_school_year, p_term) b;
  return query
  select s.scholar_id_number, r.id, r.stage, coalesce(r.is_late, false), r.applied_at,
         (select count(*)::integer from public.renewal_documents d where d.record_id = r.id and d.status = 'submitted'),
         coalesce(r.consultation_required, false), r.consultation_done_at,
         (select x.starts_at from public.counseling_slots x where x.record_id = r.id and x.state = 'booked' order by x.starts_at limit 1),
         public._eg_grades_status(s.scholar_id_number, v_basis_year, v_basis_term),
         f.id, f.status,
         (select rf.status from public.scholar_counseling_referrals rf where rf.scholar_id_number = s.scholar_id_number and rf.status <> 'approved' order by rf.created_at desc limit 1)
  from public.scholars s
  left join public.renewal_records r on r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term
  left join lateral (select ff.id, ff.status from public.scholar_counseling_referrals ff where r.id is not null and ff.renewal_record_id = r.id order by ff.created_at desc limit 1) f on true
  where s.scholar_id_number = any (coalesce(p_ids, '{}'::text[]))
  order by s.scholar_id_number
  limit 200;
end;
$$;
revoke all on function public.renewal_scholar_actions(text, text, text[]) from public, anon;
grant execute on function public.renewal_scholar_actions(text, text, text[]) to authenticated;

-- The four reading functions of the Scholar List, now open to everyone can_view_renewal_list() lets in (the only change in each is the check on the first line).
create or replace function public.renewal_scholar_list(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_eligibility text[] default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.status, s.school_id, s.school, s.year_level, s.course,
         c.sdp_applicable, c.sdp_complied, c.sdp_missing,
         (select r.status from public.sdp_reconsideration_requests r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term),
         c.grades_state, c.graded, c.total, c.failed, c.drp, c.inc, c.review, c.eligibility, c.computed_at,
         count(*) over ()
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (coalesce(cardinality(p_eligibility), 0) = 0 or c.eligibility && p_eligibility)
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) from public, anon;
grant execute on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) to authenticated;

create or replace function public.renewal_scholar_list_matrix(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null)
returns table(school_id uuid, school text, ready bigint, consultation bigint, sdp_reconsideration bigint, waiting bigint, review bigint, total bigint, last_checked timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.school_id, coalesce(sc.name, nullif(btrim(coalesce(s.school, '')), ''), '(no school set)'),
         count(*) filter (where 'ready' = any (c.eligibility)), count(*) filter (where 'consultation' = any (c.eligibility)), count(*) filter (where 'sdp_reconsideration' = any (c.eligibility)),
         count(*) filter (where 'waiting' = any (c.eligibility)), count(*) filter (where 'review' = any (c.eligibility)), count(*), min(c.computed_at)
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  left join public.schools sc on sc.id = s.school_id
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  group by s.school_id, 2
  order by 2;
end;
$$;
revoke all on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) from public, anon;
grant execute on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) to authenticated;

create or replace function public.renewal_scholar_list_options(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return (
    with base as (
      select s.scholar_id_number, s.school_id, s.school, s.year_level, s.course from public.scholars s
      where s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    )
    select jsonb_build_object(
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', x.school_id, 'name', x.nm) order by x.nm) from (
          select b.school_id, coalesce(sc.name, '(no school set)') as nm from base b left join public.schools sc on sc.id = b.school_id group by b.school_id, 2) x), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(y order by y) from (select distinct nullif(btrim(year_level), '') as y from base) q where y is not null), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(p order by p) from (select distinct nullif(btrim(course), '') as p from base) q where p is not null), '[]'::jsonb),
      'scholars', (select count(*) from base),
      'checked', (select count(*) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term),
      'last_checked', (select min(c.computed_at) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term)));
end;
$$;
revoke all on function public.renewal_scholar_list_options(text, text) from public, anon;
grant execute on function public.renewal_scholar_list_options(text, text) to authenticated;

create or replace function public.renewal_scholar_sdp_credits(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b_year text; v_b_term text;
  v_ev jsonb;
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_ev := public._renewal_evaluate(p_scholar_id_number, p_school_year, p_term);
  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'required', public.sdp_category_credit_required(),
    'sdp', v_ev -> 'sdp',
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object('activity', coalesce(act.name, '(activity removed)'), 'category', act.category, 'credits', act.credits, 'attended_date', a.attended_date,
                                          'activity_day', a.activity_day, 'school_year', a.school_year, 'semester', a.semester) order by a.attended_date, act.name)
      from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
      where a.scholar_id_number = p_scholar_id_number and a.school_year = v_b_year and a.semester = v_b_term), '[]'::jsonb),
    'reserved', coalesce((
      select jsonb_agg(jsonb_build_object('category', r.category, 'amount', r.amount, 'from_school_year', r.source_school_year, 'from_semester', r.source_semester, 'claimed', r.claimed,
                                          'claimed_school_year', r.claimed_school_year, 'claimed_semester', r.claimed_semester) order by r.created_at)
      from public.sdp_reserved_credits r where r.scholar_id_number = p_scholar_id_number), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_scholar_sdp_credits(text, text, text) from public, anon;
grant execute on function public.renewal_scholar_sdp_credits(text, text, text) to authenticated;

notify pgrst, 'reload schema';
