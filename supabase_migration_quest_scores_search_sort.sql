-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_scores_search_sort.sql
--
-- Adds server-side column sorting to search_quest_scores() (backs the
-- Quest Monitoring → Scores & Progress table's clickable column
-- headers). Same approach as search_scholars' own sort migration: two
-- new optional params, p_sort_column/p_sort_direction, defaulting to
-- the function's prior fixed order (date_taken desc, id) so every
-- existing caller is unaffected until it opts in. Stays `language sql`
-- with a static CASE-based ORDER BY rather than dynamic EXECUTE.
--
-- Drops the old 7-arg signature first — same reasoning as
-- search_scholars' sort migration: `create or replace` can't change a
-- function's arity, and leaving both overloads risks ambiguous-call
-- errors from PostgREST requests that omit the new params.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.search_quest_scores(uuid, uuid, text, date, date, integer, integer);

create or replace function public.search_quest_scores(
  p_subject_id uuid default null,
  p_topic_id uuid default null,
  p_scholar_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 10,
  p_offset integer default 0,
  p_sort_column text default null,
  p_sort_direction text default 'asc'
)
returns table (
  id uuid,
  scholar_id_number text,
  scholar_name text,
  subject_name text,
  topic_name text,
  quest_name text,
  score numeric,
  max_score numeric,
  date_taken date,
  total_count bigint,
  distinct_scholar_count bigint,
  avg_percentage numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with filtered as (
    select
      sq.id, sq.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      qs.name as subject_name, qt.name as topic_name,
      sq.quest_name, sq.score, sq.max_score, sq.date_taken
    from scholar_quest_scores sq
    join scholars s on s.scholar_id_number = sq.scholar_id_number
    left join quest_subjects qs on qs.id = sq.subject_id
    left join quest_topics qt on qt.id = sq.topic_id
    where public.is_sead_staff()
      and (p_subject_id is null or sq.subject_id = p_subject_id)
      and (p_topic_id is null or sq.topic_id = p_topic_id)
      and (p_date_from is null or sq.date_taken >= p_date_from)
      and (p_date_to is null or sq.date_taken <= p_date_to)
      and (
        p_scholar_search is null or trim(p_scholar_search) = '' or
        sq.scholar_id_number ilike '%' || p_scholar_search || '%' or
        s.first_name ilike '%' || p_scholar_search || '%' or
        s.last_name ilike '%' || p_scholar_search || '%' or
        (s.first_name || ' ' || s.last_name) ilike '%' || p_scholar_search || '%' or
        (s.last_name || ' ' || s.first_name) ilike '%' || p_scholar_search || '%'
      )
  ),
  agg as (
    select
      count(*) as total_count,
      count(distinct scholar_id_number) as distinct_scholar_count,
      avg(case when max_score > 0 then (score::numeric / max_score) * 100 end) as avg_percentage
    from filtered
  )
  select f.id, f.scholar_id_number, f.scholar_name, f.subject_name, f.topic_name,
    f.quest_name, f.score, f.max_score, f.date_taken,
    agg.total_count, agg.distinct_scholar_count, agg.avg_percentage
  from filtered f cross join agg
  order by
    case when p_sort_column = 'scholar' and p_sort_direction = 'asc' then f.scholar_name end asc,
    case when p_sort_column = 'scholar' and p_sort_direction = 'desc' then f.scholar_name end desc,
    case when p_sort_column = 'subject' and p_sort_direction = 'asc' then f.subject_name end asc,
    case when p_sort_column = 'subject' and p_sort_direction = 'desc' then f.subject_name end desc,
    case when p_sort_column = 'topic' and p_sort_direction = 'asc' then f.topic_name end asc,
    case when p_sort_column = 'topic' and p_sort_direction = 'desc' then f.topic_name end desc,
    case when p_sort_column = 'quest' and p_sort_direction = 'asc' then f.quest_name end asc,
    case when p_sort_column = 'quest' and p_sort_direction = 'desc' then f.quest_name end desc,
    case when p_sort_column = 'score' and p_sort_direction = 'asc' then f.score end asc,
    case when p_sort_column = 'score' and p_sort_direction = 'desc' then f.score end desc,
    case when p_sort_column = 'date' and p_sort_direction = 'asc' then f.date_taken end asc,
    case when p_sort_column = 'date' and p_sort_direction = 'desc' then f.date_taken end desc,
    f.date_taken desc nulls last, f.id
  limit p_limit offset p_offset;
$$;

revoke all on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer, text, text) from public;
grant execute on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer, text, text) to authenticated;
