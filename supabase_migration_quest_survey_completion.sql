-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_survey_completion.sql
--
-- Quest Monitoring: who completed a SURVEY-type subject.
--
-- A Question Bank subject whose answers go to "survey_results" (Research Project Monitoring → Survey Results) is never
-- scored, so it writes to quest_survey_attempts and never to scholar_quest_scores. subject_completion_status() only read
-- scholar_quest_scores, so for a survey subject every scholar looked "Not Attempted" and Quest Monitoring could not show
-- who had actually answered.
--
-- This redefines subject_completion_status() (same name, same arguments, same columns) so that:
--   * for a survey subject, "topics attempted" is counted from quest_survey_attempts; every other subject is counted from
--     scholar_quest_scores exactly as before;
--   * the completion rule is unchanged — completed = answered every topic of the subject at least once;
--   * p_status_filter also accepts 'not_completed' (= did_not_complete + not_attempted) and 'answered' (= completed +
--     did_not_complete: submitted at least one topic), which the Scores & Progress tab shows for a survey subject
--     ("Answered" / "Completed" / "Not Completed").
-- Everything else (Removed scholars left out, staff gate, year-level / school filters, paging, counts) is copied from the
-- latest definition in supabase_migration_scholar_removed_status.sql.
--
-- Nothing is deleted or changed in any table. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_completion_status(p_subject_id uuid, p_status_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_year_level text DEFAULT NULL::text, p_school text DEFAULT NULL::text)
 returns table(scholar_id_number text, scholar_name text, year_level text, school text, topics_attempted bigint, total_topics bigint, status text, total_count bigint, completed_count bigint, did_not_complete_count bigint, not_attempted_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_total_topics bigint;
  v_is_survey boolean;
begin
  select count(*) into v_total_topics from quest_topics where subject_id = p_subject_id;
  select coalesce(bool_or(answer_destination = 'survey_results'), false) into v_is_survey from quest_subjects where id = p_subject_id;

  return query
  with attempts as (
    -- Graded subjects: a scored attempt. Survey subjects: a submitted survey. Only one of the two branches can return rows.
    select sqs.scholar_id_number, sqs.topic_id
    from scholar_quest_scores sqs
    where sqs.subject_id = p_subject_id and not v_is_survey
    union all
    select qsa.scholar_id_number, qsa.topic_id
    from quest_survey_attempts qsa
    where qsa.subject_id = p_subject_id and v_is_survey
  ),
  attempt_counts as (
    select
      s.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      s.year_level, s.school,
      count(distinct a.topic_id) as topics_attempted
    from scholars s
    left join attempts a on a.scholar_id_number = s.scholar_id_number
    where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
      and s.status <> 'Removed'
      and (p_year_level is null or s.year_level = p_year_level)
      and (p_school is null or s.school ilike '%' || p_school || '%')
    group by s.scholar_id_number, s.first_name, s.last_name, s.year_level, s.school
  ),
  classified as (
    select
      ac.*,
      case
        when ac.topics_attempted = 0 then 'not_attempted'
        when v_total_topics > 0 and ac.topics_attempted >= v_total_topics then 'completed'
        else 'did_not_complete'
      end as status
    from attempt_counts ac
  ),
  agg as (
    select
      count(*) as total_count,
      count(*) filter (where classified.status = 'completed') as completed_count,
      count(*) filter (where classified.status = 'did_not_complete') as did_not_complete_count,
      count(*) filter (where classified.status = 'not_attempted') as not_attempted_count
    from classified
  )
  select
    c.scholar_id_number, c.scholar_name, c.year_level, c.school,
    c.topics_attempted, v_total_topics, c.status,
    agg.total_count, agg.completed_count, agg.did_not_complete_count, agg.not_attempted_count
  from classified c cross join agg
  where p_status_filter = 'all'
     or c.status = p_status_filter
     or (p_status_filter = 'not_completed' and c.status <> 'completed')
     or (p_status_filter = 'answered' and c.status <> 'not_attempted')
  order by c.scholar_name
  limit p_limit offset p_offset;
end;
$function$;

revoke all on function public.subject_completion_status(uuid, text, integer, integer, text, text) from public;
grant execute on function public.subject_completion_status(uuid, text, integer, integer, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor): how many survey subjects exist and how many scholars have answered each.
select
  qs.name as survey_subject,
  (select count(distinct a.scholar_id_number) from public.quest_survey_attempts a where a.subject_id = qs.id) as scholars_who_answered
from public.quest_subjects qs
where qs.answer_destination = 'survey_results'
order by qs.name;
