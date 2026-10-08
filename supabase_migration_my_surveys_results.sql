-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_results.sql
--
-- Phase 6 of "My Surveys": reading survey results back out, for the charts in
-- "View Responses" (My Surveys) and in the Research Project Monitoring tool's
-- Survey Results tab (each survey appears there as its own dataset).
-- Requires the Phase 1 (core) migration. Safe to re-run.
--
-- One function does the aggregation on the server, in one round trip, so the
-- browser never has to download every answer row:
--
--   get_my_survey_results(survey, timezone)
--     Per question: how many people answered, and the numbers its chart needs --
--       choice questions     count per option (zero-count options included)
--       linear scale/rating  count per value, mean, median
--       date / time          count per distinct value (the chart buckets them)
--       short answer/paragraph  the latest 300 answers + the total
--     Plus the survey's response count and responses per day.
--
-- Question versions (Phase 2): a question that was reworded after people had
-- answered it exists as several rows with the same question_key. Every version
-- that has answers is returned as its own row, flagged `archived` when it was
-- replaced or removed, so the charts can show exactly which version each
-- response answered and combine versions only where it makes sense. Versions
-- with no answers are left out.
--
-- Access: the same rule as everywhere in My Surveys -- the owner and the people
-- the survey is shared with (any role). The function checks that itself (it is
-- security definer so aggregating thousands of answers does not run the row-level
-- policy once per row), and nothing else is exposed.
--
-- Live updates: my_survey_responses is added to the supabase_realtime publication
-- so open charts refresh as responses arrive. (Row access for realtime still
-- follows the table's own read policy: members only.)
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'my_survey_responses'
     ) then
    alter publication supabase_realtime add table public.my_survey_responses;
  end if;
end $$;

create or replace function public.get_my_survey_results(p_survey_id uuid, p_timezone text default 'Asia/Manila')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s public.my_surveys%rowtype;
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'Asia/Manila');
  v_total integer;
  v_first timestamptz;
  v_last timestamptz;
  v_timeline jsonb;
  v_questions jsonb;
begin
  if public.my_survey_role(p_survey_id) is null then
    raise exception 'You do not have access to this survey.';
  end if;
  select * into v_s from public.my_surveys where id = p_survey_id;

  -- An unknown time zone name must not break the page: fall back to UTC.
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'UTC';
  end;

  select count(*), min(submitted_at), max(submitted_at)
  into v_total, v_first, v_last
  from public.my_survey_responses where survey_id = p_survey_id;

  select coalesce(jsonb_agg(jsonb_build_object('day', t.d, 'count', t.c) order by t.d), '[]'::jsonb)
  into v_timeline
  from (
    select (r.submitted_at at time zone v_tz)::date as d, count(*) as c
    from public.my_survey_responses r
    where r.survey_id = p_survey_id
    group by 1
  ) t;

  select coalesce(jsonb_agg(x.q order by x.order_index, x.version), '[]'::jsonb)
  into v_questions
  from (
    select
      q.order_index,
      q.version,
      jsonb_build_object(
        'questionId', q.id,
        'questionKey', q.question_key,
        'version', q.version,
        'archived', q.archived_at is not null,
        'orderIndex', q.order_index,
        'type', q.question_type,
        'text', q.question_text,
        'helpText', q.help_text,
        'required', q.required,
        'scaleMin', q.scale_min,
        'scaleMax', q.scale_max,
        'scaleMinLabel', q.scale_min_label,
        'scaleMaxLabel', q.scale_max_label,
        'answered', (select count(distinct a.response_id) from public.my_survey_answers a where a.question_id = q.id),

        'options', case when q.question_type in ('multiple_choice', 'checkboxes', 'dropdown') then
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'optionId', o.id, 'label', o.label,
              'count', (select count(*) from public.my_survey_answers a where a.option_id = o.id)
            ) order by o.order_index, o.created_at)
            from public.my_survey_options o where o.question_id = q.id
          ), '[]'::jsonb) end,

        'numbers', case when q.question_type in ('linear_scale', 'rating') then
          coalesce((
            select jsonb_agg(jsonb_build_object('value', n.v, 'count', n.c) order by n.v)
            from (select a.value_number as v, count(*) as c from public.my_survey_answers a
                  where a.question_id = q.id and a.value_number is not null group by a.value_number) n
          ), '[]'::jsonb) end,
        'mean', case when q.question_type in ('linear_scale', 'rating') then
          (select round(avg(a.value_number), 4) from public.my_survey_answers a where a.question_id = q.id) end,
        'median', case when q.question_type in ('linear_scale', 'rating') then
          (select percentile_cont(0.5) within group (order by a.value_number) from public.my_survey_answers a where a.question_id = q.id) end,

        'values', case when q.question_type in ('date', 'time') then
          coalesce((
            select jsonb_agg(jsonb_build_object('value', v.v, 'count', v.c) order by v.v)
            from (select a.value_text as v, count(*) as c from public.my_survey_answers a
                  where a.question_id = q.id and a.value_text is not null group by a.value_text order by a.value_text limit 2000) v
          ), '[]'::jsonb) end,

        'textTotal', case when q.question_type in ('short_answer', 'paragraph') then
          (select count(*) from public.my_survey_answers a where a.question_id = q.id and a.value_text is not null) end,
        'texts', case when q.question_type in ('short_answer', 'paragraph') then
          coalesce((
            select jsonb_agg(jsonb_build_object('text', t.value_text, 'at', t.at) order by t.at desc)
            from (select a.value_text, r.submitted_at as at
                  from public.my_survey_answers a join public.my_survey_responses r on r.id = a.response_id
                  where a.question_id = q.id and a.value_text is not null
                  order by r.submitted_at desc limit 300) t
          ), '[]'::jsonb) end
      ) as q
    from public.my_survey_questions q
    where q.survey_id = p_survey_id
      and (q.archived_at is null or exists (select 1 from public.my_survey_answers a where a.question_id = q.id))
  ) x;

  return jsonb_build_object(
    'survey', jsonb_build_object(
      'id', v_s.id, 'title', v_s.title, 'status', v_s.status, 'responseCount', v_total,
      'firstResponseAt', v_first, 'lastResponseAt', v_last, 'role', public.my_survey_role(p_survey_id)
    ),
    'timezone', v_tz,
    'timeline', v_timeline,
    'questions', v_questions
  );
end;
$$;
revoke execute on function public.get_my_survey_results(uuid, text) from public, anon;
grant execute on function public.get_my_survey_results(uuid, text) to authenticated;
