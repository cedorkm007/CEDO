-- check_survey_ask_once_readonly.sql
-- READ ONLY: it only looks. It changes nothing.
-- Run it BEFORE supabase_migration_survey_ask_once.sql: it lists who is waiting NOW for a survey they already responded to.
-- Running the update gives these scholars their held attendance / credit and stops asking them. No rows = nobody is affected.
select x.scholar_id_number, s.title as survey, x.waiting_for, x.kind
from (
  select a.scholar_id_number, a.pending_survey_id as survey_id,
         coalesce((select n.name from public.sdp_activities n where n.id = b.sdp_activity_id), (select f.name from public.formation_activities f where f.id = b.formation_activity_id), 'an activity') as waiting_for,
         'attendance and credit are waiting' as kind
  from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
  where a.pending_survey_id is not null
  union all
  select k.scholar_id_number, k.survey_id, k.activity_name, 'asked afterwards (nothing is held)'
  from public.research_survey_asks k where k.closed_at is null and k.activity_type <> 'reconsideration'
    and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
) x
join public.research_surveys s on s.id = x.survey_id
where exists (select 1 from public.research_survey_responses r where r.survey_id = x.survey_id and r.scholar_id_number = x.scholar_id_number and r.status in ('completed', 'declined'))
order by s.title, x.scholar_id_number;
