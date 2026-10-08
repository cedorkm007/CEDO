-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_export_and_polish.sql
--
-- Phase 7 of "My Surveys": response export, true status in the survey list, and a
-- fix so automatic closing never looks like somebody edited the survey.
-- Requires the Phase 1 (core) migration. Safe to re-run.
--
-- NOTE -- this file redefines ONE Phase 1 function, my_surveys_guard_update().
-- If you ever re-run the Phase 1 migration file, run this file again afterwards.
-- (Everything else here only adds new functions.)
--
-- 1. my_surveys_guard_update()  -- the trigger that stamps revision / last edited by.
--    Phase 3 closes a survey automatically when its response limit or closing date is
--    reached; that update comes from the public respondent (no signed-in staff user).
--    Before, it bumped the revision like a human edit, so an editor with unsaved work
--    got a "someone else saved" conflict naming nobody who had actually saved. An
--    update with no signed-in user (auth.uid() is null) no longer touches revision,
--    updated_at or last_edited_by. Every staff action still does, exactly as before.
--
-- 2. list_my_surveys_with_state(scope)  -- same rows as list_my_surveys plus the
--    closing date and response limit, with `status` already resolved: a survey that is
--    still marked Open but is past its closing date, or at its response limit, is
--    reported as Closed (closing is otherwise lazy -- it happens when someone next
--    visits the survey). list_my_surveys itself is left alone.
--
-- 3. get_my_survey_export_page(survey, offset, limit)  -- one page of responses for
--    CSV / Excel export, plus the question columns. Paged (max 1000 per call) so a
--    survey with thousands of responses never has to travel in one request. Choice
--    answers come back as their option labels, joined with "; " for checkboxes.
--    Same access rule as everywhere: the owner and people the survey is shared with.
--    The respondent's device id is deliberately NOT exported.
-- ─────────────────────────────────────────────────────────────

-- ── 1. guard trigger ────────────────────────────────────────

create or replace function public.my_surveys_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'The owner of a survey cannot be changed.';
  end if;
  -- No signed-in staff user = an automatic change (e.g. the public page closing a
  -- survey that hit its limit). Not an edit: leave the edit stamps alone.
  if auth.uid() is null then
    return new;
  end if;
  new.updated_at := now();
  new.last_edited_by := coalesce(auth.uid(), old.last_edited_by);
  new.revision := old.revision + 1;
  return new;
end;
$$;

-- ── 2. list with the true status ────────────────────────────

create or replace function public.list_my_surveys_with_state(p_scope text default 'mine')
returns table (
  id uuid,
  title text,
  status text,
  public_slug text,
  owner_id uuid,
  owner_name text,
  my_role text,
  response_count bigint,
  last_edited_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  closes_at timestamptz,
  response_limit integer
)
language sql
stable
set search_path = public
as $$
  select
    s.id,
    s.title,
    case
      when s.status = 'open' and (
        (s.closes_at is not null and s.closes_at <= now())
        or (s.response_limit is not null and rc.n >= s.response_limit)
      ) then 'closed'
      else s.status
    end as status,
    s.public_slug,
    s.owner_id,
    nullif(trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')), '') as owner_name,
    public.my_survey_role(s.id) as my_role,
    rc.n as response_count,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '') as last_edited_by_name,
    s.created_at,
    s.updated_at,
    s.closes_at,
    s.response_limit
  from public.my_surveys s
  cross join lateral (select count(*) as n from public.my_survey_responses r where r.survey_id = s.id) rc
  left join public.users o on o.id = s.owner_id
  left join public.users e on e.id = s.last_edited_by
  where case when p_scope = 'shared' then s.owner_id <> auth.uid() else s.owner_id = auth.uid() end
  order by s.updated_at desc;
$$;
revoke execute on function public.list_my_surveys_with_state(text) from public, anon;
grant execute on function public.list_my_surveys_with_state(text) to authenticated;

-- ── 3. export ───────────────────────────────────────────────

create or replace function public.get_my_survey_export_page(p_survey_id uuid, p_offset integer default 0, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s public.my_surveys%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_questions jsonb;
  v_responses jsonb;
begin
  if public.my_survey_role(p_survey_id) is null then
    raise exception 'You do not have access to this survey.';
  end if;
  select * into v_s from public.my_surveys where id = p_survey_id;

  select count(*) into v_total from public.my_survey_responses where survey_id = p_survey_id;

  -- One column per question VERSION that has answers (plus every current question),
  -- in survey order, so a reworded question exports as clearly separate columns.
  select coalesce(jsonb_agg(jsonb_build_object(
           'questionId', q.id, 'questionKey', q.question_key, 'version', q.version,
           'archived', q.archived_at is not null, 'type', q.question_type,
           'text', q.question_text, 'orderIndex', q.order_index
         ) order by q.order_index, q.version), '[]'::jsonb)
  into v_questions
  from public.my_survey_questions q
  where q.survey_id = p_survey_id
    and (q.archived_at is null or exists (select 1 from public.my_survey_answers a where a.question_id = q.id));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'submittedAt', r.submitted_at,
           'consentGiven', r.consent_given,
           'answers', coalesce((
             select jsonb_object_agg(g.question_id, g.val)
             from (
               select a.question_id,
                      coalesce(string_agg(o.label, '; ' order by o.order_index), max(a.value_text), max(a.value_number)::text) as val
               from public.my_survey_answers a
               left join public.my_survey_options o on o.id = a.option_id
               where a.response_id = r.id
               group by a.question_id
             ) g
           ), '{}'::jsonb)
         ) order by r.submitted_at, r.id), '[]'::jsonb)
  into v_responses
  from (
    select * from public.my_survey_responses
    where survey_id = p_survey_id
    order by submitted_at, id
    offset v_offset limit v_limit
  ) r;

  return jsonb_build_object(
    'survey', jsonb_build_object('id', v_s.id, 'title', v_s.title, 'consentEnabled', v_s.consent_enabled),
    'total', v_total,
    'offset', v_offset,
    'questions', v_questions,
    'responses', v_responses
  );
end;
$$;
revoke execute on function public.get_my_survey_export_page(uuid, integer, integer) from public, anon;
grant execute on function public.get_my_survey_export_page(uuid, integer, integer) to authenticated;
