-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_probation_paging.sql
-- CONSULTATION TOOL > PROBATIONARY MONITORING: LOAD IN PAGES, ONLY THE CURRENT AND PREVIOUS TERM, DOCUMENTS ONLY WHEN A ROW IS OPENED.
-- Safe to run twice.   Undo: undo_consultation_probation_paging.sql   (It adds indexes and three read-only functions; it changes and deletes no record. The old functions stay as they are.)
--
--   * scholar_probation_monitoring_page(...): ONE PAGE of the probationary scholars (50 at a time) with the true total, searched / filtered / sorted by the database.
--       Filters: "Needs attention" = any of  INC deadline soon (within p_soon_days, 7 by default, counting today) / INC deadline passed / study plan missing;
--                "Type" = temporary probation (INC) or regular probation.
--       Each row carries only a SUMMARY of the renewal (temporary or not, nearest open INC deadline, how many INC items are open / past the deadline, whether a study plan is uploaded) - no documents.
--   * scholar_probation_renewal_detail(scholar): the INC items and the uploaded study plans of ONE scholar, asked for only when that scholar's row is opened.
--   * Both look at the CURRENT term and the PREVIOUS term only (p_terms = 2), not at every renewal ever. The terms are the most recent renewal windows that have opened
--     (windows that are for chosen test scholars only are left out); if no window exists yet, the most recent terms that have renewals.
--   * Indexes for the scholar list (status Probationary, by name) and for the open INC items.
-- "Study plan missing" = no study plan file was uploaded for the scholar's renewal in these terms.  The note columns (Study Plan / Academic Contract Update) are unchanged.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_probation_notes') is null or to_regclass('public.renewal_records') is null or to_regclass('public.renewal_inc_items') is null
     or to_regprocedure('public._require_counseling_staff()') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Consultation, Probationary Monitoring and Scholar Renewal files first.';
  end if;
end $$;

-- 1. Indexes (an index that exists is left alone).
create index if not exists scholars_probationary_name_idx on public.scholars (lower(last_name), lower(first_name)) where status = 'Probationary';
create index if not exists renewal_inc_items_open_idx on public.renewal_inc_items (record_id) where state = 'open';
create index if not exists renewal_records_scholar_term_idx on public.renewal_records (scholar_id_number, school_year, term);

-- 2. The most recent terms (newest first): p_terms of them.
create or replace function public._probation_recent_terms(p_terms integer default 2)
returns table(school_year text, term text)
language sql
stable
security definer
set search_path = public
as $$
  with opened as (
    select w.school_year, w.term from public.renewal_windows w
    where w.testers is null and w.opens_on <= (now() at time zone 'Asia/Manila')::date
  ), pool as (
    select * from opened
    union
    select r.school_year, r.term from public.renewal_records r where not exists (select 1 from opened)      -- no window yet: the terms that have renewals
  )
  select p.school_year, p.term from pool p
  order by p.school_year desc, case p.term when 'Summer' then 3 when '2nd Semester' then 2 else 1 end desc
  limit greatest(coalesce(p_terms, 2), 1);
$$;
revoke all on function public._probation_recent_terms(integer) from public, anon, authenticated;

-- 3. One page of the probationary scholars.
create or replace function public.scholar_probation_monitoring_page(
  p_search text default '',
  p_attention text[] default null,      -- any of: soon, passed, no_study_plan   (a scholar who matches ANY of the chosen ones is shown)
  p_kind text default null,             -- temporary | regular
  p_sort text default 'name',           -- name | deadline (nearest open INC deadline first; scholars without one last)
  p_dir text default 'asc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_terms integer default 2,
  p_soon_days integer default 7
)
returns table(
  scholar_id_number text, name text, course text, year_level text, school text, study_plan text, academic_contract_update text,
  temporary boolean, next_deadline date, open_inc_count integer, passed_inc_count integer, has_study_plan boolean, total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_sort text := case when lower(coalesce(p_sort, '')) = 'deadline' then 'deadline' else 'name' end;
  v_dir text := case when lower(coalesce(p_dir, '')) = 'desc' then 'desc' else 'asc' end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind text := case when lower(coalesce(p_kind, '')) in ('temporary', 'regular') then lower(p_kind) else null end;
  v_attn text[] := case when p_attention is null or cardinality(p_attention) = 0 then null else p_attention end;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_soon integer := least(greatest(coalesce(p_soon_days, 7), 1), 60);
  v_order text;
begin
  perform public._require_counseling_staff();

  v_order := case v_sort
    when 'deadline' then format('x.next_deadline %s nulls last, lower(x.last_name), lower(x.first_name), x.scholar_id_number', v_dir)
    else format('lower(x.last_name) %1$s, lower(x.first_name) %1$s, x.scholar_id_number', v_dir) end;

  -- only fixed text is put together here; everything the caller typed goes in as a value ($1 ...)
  return query execute
    'with terms as (select * from public._probation_recent_terms($2)),
     x as (
       select s.scholar_id_number, s.first_name, s.last_name, s.first_name || '' '' || s.last_name as name, s.course, s.year_level, s.school,
              coalesce(n.study_plan, '''') as study_plan, coalesce(n.academic_contract_update, '''') as academic_contract_update,
              coalesce(rr.temporary, false) as temporary, ii.next_deadline, coalesce(ii.open_n, 0)::integer as open_inc_count,
              coalesce(ii.passed_n, 0)::integer as passed_inc_count, coalesce(ii.soon_n, 0)::integer as soon_n, coalesce(rr.has_plan, false) as has_study_plan
       from public.scholars s
       left join public.scholar_probation_notes n on n.scholar_id_number = s.scholar_id_number
       left join lateral (
         select bool_or(r.temp_probation) as temporary,
                bool_or(exists (select 1 from public.renewal_documents d where d.record_id = r.id and d.kind = ''study_plan'')) as has_plan
         from public.renewal_records r join terms t on t.school_year = r.school_year and t.term = r.term
         where r.scholar_id_number = s.scholar_id_number and r.stage not in (''not_required'', ''late_declined'', ''late_pending'')
       ) rr on true
       left join lateral (
         select min(i.deadline) as next_deadline, count(*) as open_n,
                count(*) filter (where i.deadline < $3) as passed_n,
                count(*) filter (where i.deadline >= $3 and i.deadline <= $3 + $4) as soon_n
         from public.renewal_records r join terms t on t.school_year = r.school_year and t.term = r.term
         join public.renewal_inc_items i on i.record_id = r.id and i.state = ''open''
         where r.scholar_id_number = s.scholar_id_number and r.stage not in (''not_required'', ''late_declined'', ''late_pending'')
       ) ii on true
       where s.status = ''Probationary''
         and ($1 = '''' or s.scholar_id_number ilike ''%'' || $1 || ''%'' or s.first_name ilike ''%'' || $1 || ''%'' or s.last_name ilike ''%'' || $1 || ''%''
              or concat_ws('' '', s.first_name, s.last_name) ilike ''%'' || $1 || ''%'' or concat_ws('' '', s.last_name, s.first_name) ilike ''%'' || $1 || ''%'')
     ), f as (
       select * from x
       where ($5::text[] is null or (''soon'' = any ($5) and x.soon_n > 0) or (''passed'' = any ($5) and x.passed_inc_count > 0) or (''no_study_plan'' = any ($5) and not x.has_study_plan))
         and ($6::text is null or ($6 = ''temporary'' and x.temporary) or ($6 = ''regular'' and not x.temporary))
     )
     select x.scholar_id_number, x.name, x.course, x.year_level, x.school, x.study_plan, x.academic_contract_update,
            x.temporary, x.next_deadline, x.open_inc_count, x.passed_inc_count, x.has_study_plan, count(*) over () as total_count
     from f x order by ' || v_order || ' limit $7 offset $8'
  using v_q, greatest(coalesce(p_terms, 2), 1), v_today, v_soon, v_attn, v_kind, v_limit, v_offset;
end;
$$;
revoke all on function public.scholar_probation_monitoring_page(text, text[], text, text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.scholar_probation_monitoring_page(text, text[], text, text, text, integer, integer, integer, integer) to authenticated;

-- 4. The INC items and study plans of ONE scholar (asked for when the row is opened).
create or replace function public.scholar_probation_renewal_detail(p_scholar_id text, p_terms integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'scholar_id_number', r.scholar_id_number, 'record_id', r.id, 'term_label', r.term || ' ' || r.school_year, 'stage', r.stage, 'temporary_inc', r.temp_probation,
      'inc_items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'subject', i.subject, 'deadline', i.deadline,
          'days_left', case when i.deadline is null then null else i.deadline - (now() at time zone 'Asia/Manila')::date end) order by i.subject)
        from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open'), '[]'::jsonb),
      'study_plans', coalesce((select jsonb_agg(jsonb_build_object('file_name', d.file_name, 'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at) order by d.uploaded_at)
        from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan'), '[]'::jsonb))
      order by r.school_year desc, case r.term when 'Summer' then 3 when '2nd Semester' then 2 else 1 end desc)
    from public.renewal_records r
    join public._probation_recent_terms(p_terms) t on t.school_year = r.school_year and t.term = r.term
    where r.scholar_id_number = p_scholar_id and r.stage not in ('not_required', 'late_declined', 'late_pending')
      and (r.temp_probation or exists (select 1 from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan')
           or exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open'))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.scholar_probation_renewal_detail(text, integer) from public, anon;
grant execute on function public.scholar_probation_renewal_detail(text, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
