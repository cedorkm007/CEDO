-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_renewal_cases_paging.sql
-- CONSULTATION TOOL > RENEWAL CASES: LOAD IN PAGES, THE CURRENT TERM FIRST (with a term selector), THE DOCUMENTS OF A CASE ONLY WHEN IT IS OPENED, AND A LIVE UPDATE THAT TOUCHES ONLY THE CASES THAT CHANGED.
-- Safe to run twice.   Undo: undo_consultation_renewal_cases_paging.sql   (It adds one index and four read-only functions; it changes and deletes no record. The old function renewal_consult_cases stays as it is.)
--
--   * renewal_consult_cases_page(...): ONE PAGE of the open renewal cases (50 at a time) with the true total, for ONE term (or all terms), filtered by group
--       (ready to endorse / documents and consultation / endorsed - waiting for the evaluator) and by a search (name or Scholar ID). A case shows a SUMMARY only (how many documents wait, are approved or returned);
--       the list of documents is NOT in it. It can also return ONE case (p_record_id), which is how a screen refreshes just the case that changed.
--   * renewal_consult_case_documents(record): the documents of ONE case (what is required, what was uploaded, who approved), asked for when that case is opened.
--   * renewal_consult_case_terms(): the terms that have open cases, newest first, with how many are open, and which one is the CURRENT term (the newest renewal window that has opened,
--       a window only for chosen test scholars is not counted; when there is no window yet, the newest term that has cases).
--   * renewal_consult_case_counts(term, search): how many cases are in each group (the numbers on the group buttons).
-- Only consultation staff can use them. The cases are the same ones as before (same stages); nothing about who can see or do what changes.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.renewal_consult_cases()') is null or to_regprocedure('public._probation_recent_terms(integer)') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Renewal consultation file and supabase_migration_consultation_probation_paging.sql first.';
  end if;
end $$;

-- 1. An index for the open cases of a term (an index that exists is left alone).
create index if not exists renewal_records_consult_case_idx on public.renewal_records (school_year, term, stage)
  where stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed');

-- 2. The terms that have open cases.
create or replace function public.renewal_consult_case_terms()
returns table(school_year text, term text, label text, open_count bigint, is_current boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cur_sy text; v_cur_term text;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  select t.school_year, t.term into v_cur_sy, v_cur_term from public._probation_recent_terms(1) t limit 1;
  if v_cur_sy is null then      -- no renewal window yet: the newest term that has cases
    select r.school_year, r.term into v_cur_sy, v_cur_term from public.renewal_records r
    where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
    order by r.school_year desc, case r.term when 'Summer' then 3 when '2nd Semester' then 2 else 1 end desc limit 1;
  end if;
  return query
  with n as (
    select r.school_year as sy, r.term as tm, count(*) as c from public.renewal_records r
    where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
    group by r.school_year, r.term
  ), all_terms as (
    select sy, tm from n union select v_cur_sy, v_cur_term where v_cur_sy is not null
  )
  select a.sy, a.tm, public._renewal_term_label(a.sy, a.tm), coalesce(n.c, 0), (a.sy = v_cur_sy and a.tm = v_cur_term)
  from all_terms a left join n on n.sy = a.sy and n.tm = a.tm
  order by a.sy desc, case a.tm when 'Summer' then 3 when '2nd Semester' then 2 else 1 end desc;
end;
$$;
revoke all on function public.renewal_consult_case_terms() from public, anon;
grant execute on function public.renewal_consult_case_terms() to authenticated;

-- 3. How many cases are in each group (for one term, or all terms when none is given), for the search typed.
create or replace function public.renewal_consult_case_counts(p_school_year text default null, p_term text default null, p_search text default '')
returns table(ready_count bigint, work_count bigint, sent_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  return query
  select count(*) filter (where r.stage = 'ready_for_endorsement'),
         count(*) filter (where r.stage not in ('ready_for_endorsement', 'endorsed_for_approval')),
         count(*) filter (where r.stage = 'endorsed_for_approval')
  from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
    and (p_school_year is null or (r.school_year = p_school_year and r.term = p_term))
    and (v_q = '' or s.scholar_id_number ilike '%' || v_q || '%' or s.first_name ilike '%' || v_q || '%' or s.last_name ilike '%' || v_q || '%'
         or concat_ws(' ', s.first_name, s.last_name) ilike '%' || v_q || '%' or concat_ws(' ', s.last_name, s.first_name) ilike '%' || v_q || '%');
end;
$$;
revoke all on function public.renewal_consult_case_counts(text, text, text) from public, anon;
grant execute on function public.renewal_consult_case_counts(text, text, text) to authenticated;

-- 4. One page of the open cases (a summary of each; no list of documents).
create or replace function public.renewal_consult_cases_page(
  p_school_year text default null,      -- with p_term: one term; both empty: all terms
  p_term text default null,
  p_group text default null,            -- ready | work | sent   (empty: all three)
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0,
  p_record_id uuid default null         -- ONE case (a screen refreshing just that case)
)
returns table(
  record_id uuid, scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, school_year text, term text, term_label text, stage text, grp text,
  rule_code text, rule_text text, failed_subjects jsonb, inc_subjects jsonb, consultation_done_at timestamptz, next_consultation jsonb,
  docs_submitted integer, docs_accepted integer, docs_returned integer, required_count integer, can_endorse boolean,
  endorsed_status text, endorsed_at timestamptz, endorsed_note text, endorsed_by text, legacy boolean, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_group text := case when lower(coalesce(p_group, '')) in ('ready', 'work', 'sent') then lower(p_group) else null end;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  return query
  with b as (
    select r.*, case r.stage when 'ready_for_endorsement' then 'ready' when 'endorsed_for_approval' then 'sent' else 'work' end as g,
           case r.stage when 'ready_for_endorsement' then 0 when 'needs_study_plan_consultation' then 1 when 'endorsed_for_approval' then 3 else 2 end as ord
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
      and (p_record_id is null or r.id = p_record_id)
      and (p_school_year is null or (r.school_year = p_school_year and r.term = p_term))
      and (v_q = '' or s.scholar_id_number ilike '%' || v_q || '%' or s.first_name ilike '%' || v_q || '%' or s.last_name ilike '%' || v_q || '%'
           or concat_ws(' ', s.first_name, s.last_name) ilike '%' || v_q || '%' or concat_ws(' ', s.last_name, s.first_name) ilike '%' || v_q || '%')
  ), f as (
    select b.*, count(*) over () as total from b where v_group is null or b.g = v_group
    order by b.ord, b.updated_at, b.id limit v_limit offset v_offset
  )
  select f.id, s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status,
         f.school_year, f.term, public._renewal_term_label(f.school_year, f.term), f.stage, f.g,
         f.rule_code, f.rule_text, coalesce(f.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb), coalesce(f.evaluation -> 'grades' -> 'inc_subjects', '[]'::jsonb), f.consultation_done_at,
         (select jsonb_build_object('starts_at', x.starts_at, 'staff', public._staff_display_name(x.staff_id))
          from public.counseling_slots x where x.record_id = f.id and x.state = 'booked' and x.starts_at > now() order by x.starts_at limit 1),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'submitted'),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'accepted'),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'returned'),
         coalesce(jsonb_array_length(case when jsonb_typeof(f.evaluation -> 'required_documents') = 'array' then f.evaluation -> 'required_documents' end), 0),
         f.stage = 'ready_for_endorsement',
         f.endorsed_status, f.endorsed_at, f.endorsed_note, public._staff_display_name(f.endorsed_by),
         exists (select 1 from public.scholar_counseling_referrals q where q.renewal_record_id = f.id),
         f.total
  from f join public.scholars s on s.scholar_id_number = f.scholar_id_number
  order by f.ord, f.updated_at, f.id;
end;
$$;
revoke all on function public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid) to authenticated;

-- 5. The documents of ONE case (asked for when the case is opened).
create or replace function public.renewal_consult_case_documents(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  select * into r from public.renewal_records where id = p_record_id;
  if not found then return jsonb_build_object('required_documents', '[]'::jsonb, 'documents', '[]'::jsonb); end if;
  return jsonb_build_object(
    'required_documents', coalesce(r.evaluation -> 'required_documents', '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'status', d.status, 'comment', d.reviewer_comment,
                              'uploaded_at', d.uploaded_at, 'storage_path', d.storage_path) order by d.uploaded_at desc)
                           from public.renewal_documents d where d.record_id = r.id and d.kind in ('study_plan', 'inc_letter', 'clearance')), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_consult_case_documents(uuid) from public, anon;
grant execute on function public.renewal_consult_case_documents(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
