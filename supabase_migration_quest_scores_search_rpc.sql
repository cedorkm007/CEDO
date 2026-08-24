-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_scores_search_rpc.sql
--
-- Fixes Quest Monitoring → Scores & Progress loading every score row just
-- to compute the Results/Scholars/Average cards and to paginate
-- client-side. search_quest_scores() computes the three summary values
-- as real Postgres aggregates over the FULL filtered set, and returns
-- only one page (LIMIT/OFFSET) of joined, display-ready rows — scholar/
-- subject/topic names come from a real JOIN here, not the chunked .in()
-- lookups fetchScores() used (those existed because no join was
-- available from the client; an RPC can just join directly).
--
-- Does not change the table's own meaning: rows returned are still
-- individual attempt records, one row per scholar_quest_scores row —
-- Scholars is a distinct-count over those rows, not a different grouping.
--
-- Safe to re-run — create or replace throughout.
-- ─────────────────────────────────────────────────────────────

create or replace function public.search_quest_scores(
  p_subject_id uuid default null,
  p_topic_id uuid default null,
  p_scholar_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 10,
  p_offset integer default 0
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
  order by f.date_taken desc nulls last, f.id
  limit p_limit offset p_offset;
$$;

revoke all on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer) from public;
grant execute on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer) to authenticated;

-- Supports both this RPC's ilike partial-match search and the plain
-- .eq()/.gte()/.lte() filters ScoresTab already used.
create index if not exists idx_scholar_quest_scores_subject_date on public.scholar_quest_scores(subject_id, date_taken desc);
create index if not exists idx_scholar_quest_scores_topic on public.scholar_quest_scores(topic_id);
