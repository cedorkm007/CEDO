-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_sections_safety.sql
-- SURVEY TOOLS UPDATE, PHASE 2: SAFETY FIXES AND SECTIONS.   Safe to run twice.   Undo: undo_survey_sections_safety.sql
--
-- SAFETY (works for today's live screens too, as soon as this is run):
--   * Deleting or replacing a question or choice that has answers keeps the answers (it is only hidden).
--   * A survey with answers cannot be deleted, only deactivated.
--   * A new survey starts as a DRAFT and needs at least one question before it can be activated. Existing surveys stay as they are.
--   * Deactivating a survey gives any credit that was waiting for it.
--   * A new question never takes the position of an existing one (Bulk Upload no longer mixes up the order).
-- SECTIONS: sections, optional questions, "skip to a section", question versions.
-- It changes no answer. The only existing data changed: questions that shared the same position are renumbered (old numbers are kept).
-- Needs supabase_migration_survey_credit_fix.sql (Phase 1).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._survey_missing_credits(text,uuid,timestamptz)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_survey_credit_fix.sql (Phase 1) first.';
  end if;
end $$;

-- ── 1. Tables and columns ────────────────────────────────────
create table if not exists public.research_survey_sections (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_research_survey_sections_survey on public.research_survey_sections(survey_id);
alter table public.research_survey_sections enable row level security;
drop policy if exists "research staff read" on public.research_survey_sections;
create policy "research staff read" on public.research_survey_sections for select using (public.is_research_monitoring_staff());

alter table public.research_survey_questions add column if not exists section_id uuid references public.research_survey_sections(id) on delete set null;
alter table public.research_survey_questions add column if not exists is_optional boolean not null default false;
alter table public.research_survey_questions add column if not exists removed_at timestamptz;
alter table public.research_survey_questions add column if not exists removed_reason text;
alter table public.research_survey_questions add column if not exists version integer not null default 1;
alter table public.research_survey_questions add column if not exists previous_id uuid references public.research_survey_questions(id) on delete set null;

alter table public.research_survey_choices add column if not exists removed_at timestamptz;
alter table public.research_survey_choices add column if not exists removed_reason text;
alter table public.research_survey_choices add column if not exists previous_id uuid references public.research_survey_choices(id) on delete set null;
alter table public.research_survey_choices add column if not exists skip_to_section_id uuid references public.research_survey_sections(id) on delete set null;
alter table public.research_survey_choices drop constraint if exists research_survey_choices_skip_exclusive;
alter table public.research_survey_choices add constraint research_survey_choices_skip_exclusive
  check ((ends_survey::int + (skip_to_question_id is not null)::int + (skip_to_section_id is not null)::int) <= 1);

-- Draft: existing surveys count as already activated once; new ones start inactive.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'research_surveys' and column_name = 'activated_at') then
    alter table public.research_surveys add column activated_at timestamptz;
    update public.research_surveys set activated_at = created_at;
  end if;
end $$;
alter table public.research_surveys alter column is_active set default false;

-- Removed (hidden) questions and choices are no longer listed by the staff screens' direct reads; results use their own function below.
drop policy if exists "research staff read" on public.research_survey_questions;
create policy "research staff read" on public.research_survey_questions for select using (public.is_research_monitoring_staff() and removed_at is null);
drop policy if exists "research staff read" on public.research_survey_choices;
create policy "research staff read" on public.research_survey_choices for select using (public.is_research_monitoring_staff() and removed_at is null);

-- ── 2. Order of questions ────────────────────────────────────
create table if not exists public.survey_sort_backup (question_id uuid primary key, sort_order integer not null);
alter table public.survey_sort_backup enable row level security;
revoke all on table public.survey_sort_backup from anon, authenticated;

create or replace function public._survey_renumber(p_survey_id uuid)
returns void language sql security definer set search_path = public as $$
  with ordered as (
    select q.id, (row_number() over (order by coalesce(s.sort_order, -1), q.sort_order, q.created_at, q.id) - 1)::integer as n
    from public.research_survey_questions q
    left join public.research_survey_sections s on s.id = q.section_id
    where q.survey_id = p_survey_id and q.removed_at is null
  )
  update public.research_survey_questions q set sort_order = o.n from ordered o where q.id = o.id and q.sort_order is distinct from o.n;
$$;
revoke all on function public._survey_renumber(uuid) from public, anon, authenticated;

-- Surveys where two questions share a position: renumber them (keeping the order they were added), remembering the old numbers.
do $$
declare v record;
begin
  for v in select distinct survey_id from public.research_survey_questions where removed_at is null group by survey_id, sort_order having count(*) > 1 loop
    insert into public.survey_sort_backup (question_id, sort_order) select id, sort_order from public.research_survey_questions where survey_id = v.survey_id on conflict (question_id) do nothing;
    perform public._survey_renumber(v.survey_id);
  end loop;
end $$;

create or replace function public._survey_question_placement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- once a survey has sections, every question belongs to one
  if new.section_id is null then
    select id into new.section_id from public.research_survey_sections where survey_id = new.survey_id and removed_at is null order by sort_order desc limit 1;
  end if;
  if exists (select 1 from public.research_survey_questions q where q.survey_id = new.survey_id and q.removed_at is null and q.sort_order = new.sort_order) then
    select coalesce(max(q.sort_order), -1) + 1 into new.sort_order from public.research_survey_questions q where q.survey_id = new.survey_id;
  end if;
  return new;
end; $$;
revoke all on function public._survey_question_placement() from public, anon, authenticated;
drop trigger if exists survey_question_placement on public.research_survey_questions;
create trigger survey_question_placement before insert on public.research_survey_questions for each row execute function public._survey_question_placement();

-- ── 3. Answers are never erased by editing ───────────────────
create or replace function public._survey_keep_answered_question()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- (when the whole survey is being deleted, let it go)
  if exists (select 1 from public.research_surveys s where s.id = old.survey_id)
     and exists (select 1 from public.research_survey_answers a where a.question_id = old.id) then
    update public.research_survey_questions set removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, 'deleted'), updated_at = now() where id = old.id;
    return null;
  end if;
  return old;
end; $$;
revoke all on function public._survey_keep_answered_question() from public, anon, authenticated;
drop trigger if exists survey_keep_answered_question on public.research_survey_questions;
create trigger survey_keep_answered_question before delete on public.research_survey_questions for each row execute function public._survey_keep_answered_question();

create or replace function public._survey_keep_answered_choice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.research_survey_questions q where q.id = old.question_id)
     and exists (select 1 from public.research_survey_answers a where a.choice_id = old.id) then
    update public.research_survey_choices set removed_at = coalesce(removed_at, now()), removed_reason = coalesce(removed_reason, 'deleted') where id = old.id;
    return null;
  end if;
  return old;
end; $$;
revoke all on function public._survey_keep_answered_choice() from public, anon, authenticated;
drop trigger if exists survey_keep_answered_choice on public.research_survey_choices;
create trigger survey_keep_answered_choice before delete on public.research_survey_choices for each row execute function public._survey_keep_answered_choice();

-- A skip target must belong to the same survey. A target that is no longer LATER is allowed to stay (it then acts as "next question").
create or replace function public.validate_survey_choice_skip_target()
returns trigger language plpgsql set search_path = public as $$
declare v_own uuid;
begin
  if new.skip_to_question_id is null and new.skip_to_section_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.skip_to_question_id is not distinct from old.skip_to_question_id and new.skip_to_section_id is not distinct from old.skip_to_section_id then return new; end if;
  select survey_id into v_own from public.research_survey_questions where id = new.question_id;
  if new.skip_to_question_id is not null and not exists (select 1 from public.research_survey_questions where id = new.skip_to_question_id and survey_id = v_own) then
    raise exception 'A choice can only skip to a question in the same survey.';
  end if;
  if new.skip_to_section_id is not null and not exists (select 1 from public.research_survey_sections where id = new.skip_to_section_id and survey_id = v_own) then
    raise exception 'A choice can only skip to a section of the same survey.';
  end if;
  return new;
end; $$;

-- ── 4. Delete, draft and deactivate rules ────────────────────
create or replace function public._survey_protect_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- deleting an activity or a subject still removes its survey, as before (changed in Phase 3)
  if (old.sdp_activity_id is not null and not exists (select 1 from public.sdp_activities a where a.id = old.sdp_activity_id))
     or (old.formation_activity_id is not null and not exists (select 1 from public.formation_activities a where a.id = old.formation_activity_id))
     or (old.quest_subject_id is not null and not exists (select 1 from public.quest_subjects a where a.id = old.quest_subject_id)) then
    return old;
  end if;
  if exists (select 1 from public.research_survey_responses r where r.survey_id = old.id and (r.status in ('completed', 'declined') or exists (select 1 from public.research_survey_answers a where a.response_id = r.id))) then
    raise exception 'This survey has answers, so it cannot be deleted. Deactivate it instead.';
  end if;
  if exists (select 1 from public.attendance_records a where a.pending_survey_id = old.id) then
    raise exception 'Scholars are still waiting on this survey. Deactivate it first (they will get their credit), then delete it.';
  end if;
  return old;
end; $$;
revoke all on function public._survey_protect_delete() from public, anon, authenticated;
drop trigger if exists survey_protect_delete on public.research_surveys;
create trigger survey_protect_delete before delete on public.research_surveys for each row execute function public._survey_protect_delete();

create or replace function public._survey_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quest_subject_id is null and new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if not exists (select 1 from public.research_survey_questions q where q.survey_id = new.id and q.removed_at is null) then
      raise exception 'Add at least one question before activating this survey.';
    end if;
  end if;
  if new.is_active and new.activated_at is null then new.activated_at := now(); end if;
  return new;
end; $$;
revoke all on function public._survey_activation() from public, anon, authenticated;
drop trigger if exists survey_activation on public.research_surveys;
create trigger survey_activation before insert or update on public.research_surveys for each row execute function public._survey_activation();

create or replace function public._survey_release_on_deactivate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if old.is_active and not new.is_active then
    perform set_config('app.sdp_source', 'survey_released', true);
    for v in select distinct s.id, a.scholar_id_number from public.attendance_records a join public.scholars s on s.scholar_id_number = a.scholar_id_number where a.pending_survey_id = new.id loop
      perform public._finalize_survey_gated_attendance(v.id, v.scholar_id_number, new.id);
    end loop;
    perform set_config('app.sdp_source', '', true);
  end if;
  return null;
end; $$;
revoke all on function public._survey_release_on_deactivate() from public, anon, authenticated;
drop trigger if exists survey_release_on_deactivate on public.research_surveys;
create trigger survey_release_on_deactivate after update of is_active on public.research_surveys for each row execute function public._survey_release_on_deactivate();

-- ── 5. What a choice leads to (used for the scholar's path and screen) ──
create or replace function public._survey_choice_target(p_choice_id uuid)
returns table(ends boolean, target_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.research_survey_choices%rowtype; q public.research_survey_questions%rowtype;
  v_own_section integer; v_target_section integer; v_target uuid;
begin
  ends := false; target_id := null;
  select * into c from public.research_survey_choices where id = p_choice_id;
  if not found or c.removed_at is not null then return next; return; end if;
  select * into q from public.research_survey_questions where id = c.question_id;
  if c.ends_survey then
    ends := true;
  elsif c.skip_to_question_id is not null then
    select t.id into target_id from public.research_survey_questions t where t.id = c.skip_to_question_id and t.removed_at is null and t.sort_order > q.sort_order;
  elsif c.skip_to_section_id is not null then
    select coalesce(max(s.sort_order), -1) into v_own_section from public.research_survey_sections s where s.id = q.section_id;
    select s.sort_order into v_target_section from public.research_survey_sections s where s.id = c.skip_to_section_id and s.removed_at is null;
    if v_target_section is not null and v_target_section > v_own_section then
      select t.id into v_target from public.research_survey_questions t join public.research_survey_sections s on s.id = t.section_id
        where t.survey_id = q.survey_id and t.removed_at is null and s.sort_order >= v_target_section and t.sort_order > q.sort_order
        order by t.sort_order limit 1;
      target_id := v_target;
      ends := v_target is null;          -- an empty last section: nothing more to ask
    end if;
  end if;
  return next;
end; $$;
revoke all on function public._survey_choice_target(uuid) from public, anon, authenticated;

-- The questions a scholar MUST answer: those on the path actually taken, except optional ones.
create or replace function public.research_survey_required_question_ids(p_response_id uuid)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_survey_id uuid; v_current public.research_survey_questions%rowtype; v_choice uuid; v_ends boolean; v_target uuid;
  v_guard integer := 0; v_max integer;
begin
  select survey_id into v_survey_id from public.research_survey_responses where id = p_response_id;
  if v_survey_id is null then return; end if;
  select count(*) into v_max from public.research_survey_questions where survey_id = v_survey_id and removed_at is null;
  select * into v_current from public.research_survey_questions where survey_id = v_survey_id and removed_at is null order by sort_order limit 1;
  while v_current.id is not null and v_guard <= v_max loop
    v_guard := v_guard + 1;
    if not v_current.is_optional then return next v_current.id; end if;
    v_choice := null; v_ends := false; v_target := null;
    select a.choice_id into v_choice from public.research_survey_answers a where a.response_id = p_response_id and a.question_id = v_current.id;
    if v_choice is not null then select t.ends, t.target_id into v_ends, v_target from public._survey_choice_target(v_choice) t; end if;
    if v_ends then exit;
    elsif v_target is not null then select * into v_current from public.research_survey_questions where id = v_target;
    else select * into v_current from public.research_survey_questions where survey_id = v_survey_id and removed_at is null and sort_order > v_current.sort_order order by sort_order limit 1;
    end if;
  end loop;
end; $$;
grant execute on function public.research_survey_required_question_ids(uuid) to authenticated;

create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_missing_count integer; v_finalized_count integer; v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can submit surveys.'; end if;
  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0); end if;
  if v_response.status = 'declined' then raise exception 'You already declined to participate in this survey.'; end if;
  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if v_survey.requires_consent and coalesce(v_response.consented, false) is not true then raise exception 'Please respond to the consent question first.'; end if;

  select count(*) into v_missing_count
    from public.research_survey_required_question_ids(p_response_id) req(id)
    where not exists (
      select 1 from public.research_survey_answers a left join public.research_survey_choices c on c.id = a.choice_id
      where a.response_id = p_response_id and a.question_id = req.id and c.removed_at is null
    );
  if v_missing_count > 0 then raise exception 'Please answer every question before submitting.'; end if;

  update public.research_survey_responses set status = 'completed', submitted_at = now(), updated_at = now() where id = p_response_id;
  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);

  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;
  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;
revoke all on function public.submit_survey_response(uuid) from public, anon;
grant execute on function public.submit_survey_response(uuid) to authenticated;

create or replace function public.submit_survey_answer(p_response_id uuid, p_question_id uuid, p_choice_id uuid default null, p_likert_value integer default null, p_text_value text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_question public.research_survey_questions%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can answer surveys.'; end if;
  select * into v_response from public.research_survey_responses where id = p_response_id;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then raise exception 'This survey has already been submitted.'; end if;
  select * into v_question from public.research_survey_questions where id = p_question_id and survey_id = v_response.survey_id;
  if not found then raise exception 'Question not found for this survey.'; end if;
  if v_question.removed_at is not null then raise exception 'This survey was just updated. Please close it and open it again.'; end if;

  -- an optional question left blank
  if v_question.is_optional and p_choice_id is null and p_likert_value is null and coalesce(btrim(p_text_value), '') = '' then
    delete from public.research_survey_answers where response_id = p_response_id and question_id = p_question_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_question.question_type = 'multiple_choice' then
    if p_choice_id is null or p_likert_value is not null or p_text_value is not null then raise exception 'Provide exactly a choice for this question.'; end if;
    if not exists (select 1 from public.research_survey_choices where id = p_choice_id and question_id = p_question_id and removed_at is null) then
      raise exception 'This survey was just updated. Please close it and open it again.';
    end if;
  elsif v_question.question_type = 'likert' then
    if p_likert_value is null or p_choice_id is not null or p_text_value is not null then raise exception 'Provide exactly a scale value for this question.'; end if;
    if p_likert_value < v_question.likert_scale_min or p_likert_value > v_question.likert_scale_max then raise exception 'Scale value out of range.'; end if;
  else
    if p_text_value is null or trim(p_text_value) = '' or p_choice_id is not null or p_likert_value is not null then raise exception 'Provide exactly a text answer for this question.'; end if;
  end if;

  insert into public.research_survey_answers (response_id, question_id, choice_id, likert_value, text_value)
    values (p_response_id, p_question_id, p_choice_id, p_likert_value, p_text_value)
    on conflict (response_id, question_id) do update set choice_id = excluded.choice_id, likert_value = excluded.likert_value, text_value = excluded.text_value, answered_at = now();
  update public.research_survey_responses set updated_at = now() where id = p_response_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.submit_survey_answer(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.submit_survey_answer(uuid, uuid, uuid, integer, text) to authenticated;

create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_sections jsonb; v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description) order by s.sort_order), '[]'::jsonb) into v_sections
  from public.research_survey_sections s
  where s.survey_id = p_survey_id and s.removed_at is null
    and exists (select 1 from public.research_survey_questions q where q.section_id = s.id and q.removed_at is null);

  -- skips are worked out here (skipToQuestionId / endsSurvey), so the screen only has to follow them
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'sectionId', q.section_id, 'isOptional', q.is_optional,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'openEndedFormat', q.open_ended_format,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text, 'skipToQuestionId', t.target_id, 'endsSurvey', t.ends) order by c.sort_order, c.created_at), '[]'::jsonb)
      from public.research_survey_choices c cross join lateral public._survey_choice_target(c.id) t
      where c.question_id = q.id and c.removed_at is null
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id and q.removed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value, 'textValue', a.text_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a
  join public.research_survey_questions q on q.id = a.question_id and q.removed_at is null
  left join public.research_survey_choices c on c.id = a.choice_id
  where a.response_id = v_response.id and c.removed_at is null;

  return jsonb_build_object('responseId', v_response.id, 'status', v_response.status, 'sections', v_sections, 'questions', v_questions, 'answers', v_answers,
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text);
end; $$;
revoke all on function public.start_or_resume_survey_response(uuid) from public, anon;
grant execute on function public.start_or_resume_survey_response(uuid) to authenticated;

-- Results: choices that were removed or changed keep their counts, marked as such.
create or replace function public.research_survey_question_results(p_question_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_question public.research_survey_questions%rowtype; v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  select * into v_question from public.research_survey_questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;

  if v_question.question_type = 'multiple_choice' then
    select jsonb_agg(jsonb_build_object('choiceId', c.id, 'choiceText', c.choice_text, 'count', coalesce(cnt.n, 0), 'removed', c.removed_at is not null, 'removedReason', c.removed_reason) order by c.removed_at is not null, c.sort_order, c.created_at)
    into v_result
    from public.research_survey_choices c
    left join (select choice_id, count(*) n from public.research_survey_answers where question_id = p_question_id group by choice_id) cnt on cnt.choice_id = c.id
    where c.question_id = p_question_id and (c.removed_at is null or coalesce(cnt.n, 0) > 0);
  elsif v_question.question_type = 'open_ended' then
    select jsonb_build_object('texts', coalesce(jsonb_agg(text_value order by answered_at), '[]'::jsonb)) into v_result
    from public.research_survey_answers where question_id = p_question_id;
  else
    select jsonb_build_object('n', stats.n, 'mean', stats.mean, 'median', stats.median, 'stddev', stats.stddev, 'distribution', dist.distribution) into v_result
    from (
      select count(*) n, avg(likert_value) mean, percentile_cont(0.5) within group (order by likert_value) median, stddev_samp(likert_value) stddev
      from public.research_survey_answers where question_id = p_question_id
    ) stats,
    (
      select jsonb_agg(jsonb_build_object('value', pt, 'count', coalesce(a.cnt, 0),
        'percentage', case when stats2.n > 0 then round(coalesce(a.cnt, 0) * 100.0 / stats2.n, 1) else 0 end) order by pt) distribution
      from generate_series(v_question.likert_scale_min, v_question.likert_scale_max) pt
      left join (select likert_value, count(*) cnt from public.research_survey_answers where question_id = p_question_id group by likert_value) a on a.likert_value = pt
      cross join (select count(*) n from public.research_survey_answers where question_id = p_question_id) stats2
    ) dist;
  end if;

  return coalesce(v_result, case when v_question.question_type = 'multiple_choice' then '[]'::jsonb
    when v_question.question_type = 'open_ended' then jsonb_build_object('texts', '[]'::jsonb)
    else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb) end);
end; $$;
grant execute on function public.research_survey_question_results(uuid) to authenticated;

-- ── 6. Staff: read and edit ──────────────────────────────────
create or replace function public._survey_require_staff(p_survey_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  if not exists (select 1 from public.research_surveys s where s.id = p_survey_id and s.quest_subject_id is null) then raise exception 'Survey not found.'; end if;
end; $$;
revoke all on function public._survey_require_staff(uuid) from public, anon, authenticated;

-- p_results = false: the editor (only what is in the survey now). true: results (also removed questions that have answers).
create or replace function public.survey_outline(p_survey_id uuid, p_results boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sections jsonb; v_questions jsonb;
begin
  perform public._survey_require_staff(p_survey_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description, 'removed', s.removed_at is not null) order by s.removed_at is not null, s.sort_order, s.created_at), '[]'::jsonb) into v_sections
  from public.research_survey_sections s
  where s.survey_id = p_survey_id and (s.removed_at is null or (p_results and exists (select 1 from public.research_survey_questions q join public.research_survey_answers a on a.question_id = q.id where q.section_id = s.id)));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'surveyId', q.survey_id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'sectionId', q.section_id, 'isOptional', q.is_optional, 'version', q.version, 'removed', q.removed_at is not null, 'removedReason', q.removed_reason,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max, 'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'openEndedFormat', q.open_ended_format,
    'answerCount', (select count(*) from public.research_survey_answers a where a.question_id = q.id),
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text, 'skipToQuestionId', c.skip_to_question_id, 'skipToSectionId', c.skip_to_section_id, 'endsSurvey', c.ends_survey,
        'answerCount', (select count(*) from public.research_survey_answers a where a.choice_id = c.id)) order by c.sort_order, c.created_at), '[]'::jsonb)
      from public.research_survey_choices c where c.question_id = q.id and c.removed_at is null
    )
  ) order by q.removed_at is not null, q.sort_order, q.created_at), '[]'::jsonb) into v_questions
  from public.research_survey_questions q
  where q.survey_id = p_survey_id and (q.removed_at is null or (p_results and exists (select 1 from public.research_survey_answers a where a.question_id = q.id)));

  return jsonb_build_object('sections', v_sections, 'questions', v_questions);
end; $$;

-- How much would be affected by deleting a survey.
create or replace function public.survey_delete_impact(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._survey_require_staff(p_survey_id);
  return jsonb_build_object(
    'answers', (select count(*) from public.research_survey_answers a join public.research_survey_responses r on r.id = a.response_id where r.survey_id = p_survey_id),
    'finished', (select count(*) from public.research_survey_responses r where r.survey_id = p_survey_id and r.status in ('completed', 'declined')),
    'waiting', (select count(distinct a.scholar_id_number) from public.attendance_records a where a.pending_survey_id = p_survey_id));
end; $$;

-- Add or change a question. p_new_meaning: when something that already has answers was reworded, true = the meaning changed
-- (the old answers stay on the earlier version), false = only the wording was fixed (the answers stay with it).
create or replace function public.survey_question_save(p_survey_id uuid, p_question jsonb, p_new_meaning boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_question ->> 'id', '')::uuid;
  v_old public.research_survey_questions%rowtype; v_choice public.research_survey_choices%rowtype;
  v_type text := p_question ->> 'questionType';
  v_text text := btrim(coalesce(p_question ->> 'questionText', ''));
  v_section uuid := nullif(p_question ->> 'sectionId', '')::uuid;
  v_optional boolean := coalesce((p_question ->> 'isOptional')::boolean, false);
  v_min integer; v_max integer; v_min_label text; v_max_label text; v_format text;
  v_choices jsonb := coalesce(p_question -> 'choices', '[]'::jsonb);
  v_item jsonb; v_n integer := 0; v_choice_id uuid; v_answered boolean := false; v_new_version boolean := false; v_choice_text text;
begin
  perform public._survey_require_staff(p_survey_id);
  if v_text = '' then raise exception 'Enter the question text.'; end if;
  if v_type = 'likert' then
    v_min := (p_question ->> 'likertScaleMin')::integer; v_max := (p_question ->> 'likertScaleMax')::integer;
    v_min_label := btrim(coalesce(p_question ->> 'likertMinLabel', '')); v_max_label := btrim(coalesce(p_question ->> 'likertMaxLabel', ''));
    if v_min is null or v_max is null or v_max <= v_min or v_min_label = '' or v_max_label = '' then raise exception 'Set a valid scale and label both ends.'; end if;
  elsif v_type = 'open_ended' then
    v_format := coalesce(p_question ->> 'openEndedFormat', 'short');
  elsif v_type = 'multiple_choice' then
    if (select count(*) from jsonb_array_elements(v_choices) e where btrim(coalesce(e ->> 'choiceText', '')) <> '') < 2 then raise exception 'Add at least two choices.'; end if;
  else
    raise exception 'Choose the question type.';
  end if;
  if v_section is not null and not exists (select 1 from public.research_survey_sections s where s.id = v_section and s.survey_id = p_survey_id and s.removed_at is null) then
    raise exception 'That section is not part of this survey.';
  end if;

  if v_id is null then
    insert into public.research_survey_questions (survey_id, section_id, question_type, question_text, sort_order, is_optional, likert_scale_min, likert_scale_max, likert_min_label, likert_max_label, open_ended_format)
    values (p_survey_id, v_section, v_type, v_text, 1000000, v_optional, v_min, v_max, v_min_label, v_max_label, v_format) returning id into v_id;
  else
    select * into v_old from public.research_survey_questions where id = v_id and survey_id = p_survey_id and removed_at is null for update;
    if not found then raise exception 'The question was changed by someone else. Reload and try again.'; end if;
    if v_old.question_type <> v_type then raise exception 'The type of a question cannot be changed.'; end if;
    v_section := coalesce(v_section, v_old.section_id);
    v_answered := exists (select 1 from public.research_survey_answers a where a.question_id = v_id);
    v_new_version := v_answered and (
      (v_type = 'likert' and (v_old.likert_scale_min, v_old.likert_scale_max) is distinct from (v_min, v_max))     -- another scale is always another question
      or (p_new_meaning and (v_old.question_text, v_old.likert_min_label, v_old.likert_max_label) is distinct from (v_text, v_min_label, v_max_label))
    );
    if v_new_version then
      update public.research_survey_questions set removed_at = now(), removed_reason = 'changed', updated_at = now() where id = v_id;
      insert into public.research_survey_questions (survey_id, section_id, question_type, question_text, sort_order, is_optional, likert_scale_min, likert_scale_max, likert_min_label, likert_max_label, open_ended_format, version, previous_id)
      values (p_survey_id, v_section, v_type, v_text, v_old.sort_order, v_optional, v_min, v_max, v_min_label, v_max_label, v_format, v_old.version + 1, v_old.id) returning id into v_id;
      update public.research_survey_choices set skip_to_question_id = v_id where skip_to_question_id = v_old.id;
    else
      update public.research_survey_questions set question_text = v_text, is_optional = v_optional, section_id = v_section,
        sort_order = case when v_old.section_id is distinct from v_section then 1000000 else sort_order end,
        likert_scale_min = v_min, likert_scale_max = v_max, likert_min_label = v_min_label, likert_max_label = v_max_label, open_ended_format = v_format, updated_at = now()
      where id = v_id;
    end if;
  end if;

  if v_type = 'multiple_choice' then
    if not v_new_version then
      -- choices taken away (one with answers is only hidden)
      delete from public.research_survey_choices c where c.question_id = v_id and c.removed_at is null
        and not exists (select 1 from jsonb_array_elements(v_choices) e where nullif(e ->> 'id', '')::uuid = c.id and btrim(coalesce(e ->> 'choiceText', '')) <> '');
    end if;
    for v_item in select e from jsonb_array_elements(v_choices) e loop
      v_choice_text := btrim(coalesce(v_item ->> 'choiceText', ''));
      continue when v_choice_text = '';
      v_choice_id := case when v_new_version then null else nullif(v_item ->> 'id', '')::uuid end;
      v_choice := null;
      if v_choice_id is not null then
        select * into v_choice from public.research_survey_choices where id = v_choice_id and question_id = v_id and removed_at is null;
        if v_choice.id is null then raise exception 'The question was changed by someone else. Reload and try again.'; end if;
        if p_new_meaning and v_choice.choice_text <> v_choice_text and exists (select 1 from public.research_survey_answers a where a.choice_id = v_choice_id) then
          update public.research_survey_choices set removed_at = now(), removed_reason = 'changed' where id = v_choice_id;
          v_choice_id := null;
        end if;
      end if;
      if v_choice_id is null then
        insert into public.research_survey_choices (question_id, choice_text, sort_order, skip_to_question_id, skip_to_section_id, ends_survey, previous_id)
        values (v_id, v_choice_text, v_n, nullif(v_item ->> 'skipToQuestionId', '')::uuid, nullif(v_item ->> 'skipToSectionId', '')::uuid, coalesce((v_item ->> 'endsSurvey')::boolean, false), v_choice.id);
      else
        update public.research_survey_choices set choice_text = v_choice_text, sort_order = v_n,
          skip_to_question_id = nullif(v_item ->> 'skipToQuestionId', '')::uuid, skip_to_section_id = nullif(v_item ->> 'skipToSectionId', '')::uuid,
          ends_survey = coalesce((v_item ->> 'endsSurvey')::boolean, false)
        where id = v_choice_id;
      end if;
      v_n := v_n + 1;
    end loop;
  end if;

  perform public._survey_renumber(p_survey_id);
  return v_id;
end; $$;

-- Takes one question out (hidden when it has answers or a choice skips to it, so the editor can warn; otherwise really deleted).
create or replace function public._survey_remove_question(p_question_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.research_survey_answers a where a.question_id = p_question_id)
     or exists (select 1 from public.research_survey_choices c where c.skip_to_question_id = p_question_id and c.removed_at is null) then
    update public.research_survey_questions set removed_at = now(), removed_reason = 'deleted', updated_at = now() where id = p_question_id;
  else
    delete from public.research_survey_questions where id = p_question_id;
  end if;
end; $$;
revoke all on function public._survey_remove_question(uuid) from public, anon, authenticated;

create or replace function public._survey_keep_one_question(p_survey_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.research_surveys s where s.id = p_survey_id and s.is_active)
     and not exists (select 1 from public.research_survey_questions q where q.survey_id = p_survey_id and q.removed_at is null) then
    raise exception 'An active survey needs at least one question. Deactivate the survey first.';
  end if;
end; $$;
revoke all on function public._survey_keep_one_question(uuid) from public, anon, authenticated;

create or replace function public.survey_question_delete(p_question_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_survey uuid;
begin
  select survey_id into v_survey from public.research_survey_questions where id = p_question_id and removed_at is null;
  perform public._survey_require_staff(v_survey);
  perform public._survey_remove_question(p_question_id);
  perform public._survey_keep_one_question(v_survey);
  perform public._survey_renumber(v_survey);
end; $$;

create or replace function public._survey_add_section(p_survey_id uuid, p_title text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_first uuid;
begin
  -- the first time: the questions already there become "Section 1"
  if not exists (select 1 from public.research_survey_sections where survey_id = p_survey_id and removed_at is null)
     and exists (select 1 from public.research_survey_questions where survey_id = p_survey_id and removed_at is null) then
    insert into public.research_survey_sections (survey_id, title, sort_order) values (p_survey_id, 'Section 1', 0) returning id into v_first;
    update public.research_survey_questions set section_id = v_first where survey_id = p_survey_id and removed_at is null;
    if lower(btrim(coalesce(p_title, ''))) = 'section 1' then return v_first; end if;
  end if;
  insert into public.research_survey_sections (survey_id, title, description, sort_order)
  values (p_survey_id, btrim(coalesce(p_title, '')), btrim(coalesce(p_description, '')),
          (select coalesce(max(sort_order), -1) + 1 from public.research_survey_sections where survey_id = p_survey_id and removed_at is null))
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public._survey_add_section(uuid, text, text) from public, anon, authenticated;

create or replace function public.survey_section_save(p_survey_id uuid, p_section_id uuid, p_title text, p_description text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._survey_require_staff(p_survey_id);
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Enter a section title.'; end if;
  if p_section_id is null then return public._survey_add_section(p_survey_id, p_title, p_description); end if;
  update public.research_survey_sections set title = btrim(p_title), description = btrim(coalesce(p_description, '')), updated_at = now()
    where id = p_section_id and survey_id = p_survey_id and removed_at is null returning id into v_id;
  if v_id is null then raise exception 'The section was changed by someone else. Reload and try again.'; end if;
  return v_id;
end; $$;

create or replace function public.survey_section_delete(p_section_id uuid, p_keep_questions boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_section public.research_survey_sections%rowtype; v_to uuid; v_q record;
begin
  select * into v_section from public.research_survey_sections where id = p_section_id and removed_at is null;
  perform public._survey_require_staff(v_section.survey_id);
  if p_keep_questions then
    -- to the section before it; for the first section, the one after it; none left: no sections any more
    select id into v_to from public.research_survey_sections where survey_id = v_section.survey_id and removed_at is null and id <> v_section.id
      order by (sort_order > v_section.sort_order), case when sort_order < v_section.sort_order then -sort_order else sort_order end limit 1;
    update public.research_survey_questions set section_id = v_to where section_id = v_section.id and removed_at is null;
  else
    for v_q in select id from public.research_survey_questions where section_id = v_section.id and removed_at is null order by sort_order desc loop
      perform public._survey_remove_question(v_q.id);
    end loop;
    perform public._survey_keep_one_question(v_section.survey_id);
  end if;
  update public.research_survey_sections set removed_at = now(), updated_at = now() where id = v_section.id;
  perform public._survey_renumber(v_section.survey_id);
end; $$;

-- The whole order after dragging: [{"sectionId": "...or null", "questionIds": ["...", ...]}, ...]
create or replace function public.survey_reorder(p_survey_id uuid, p_layout jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_group jsonb; v_qid text; v_section uuid; v_s integer := 0; v_q integer := 0;
begin
  perform public._survey_require_staff(p_survey_id);
  if (select count(*) from jsonb_array_elements(p_layout) g, jsonb_array_elements_text(g -> 'questionIds') x)
       <> (select count(*) from public.research_survey_questions where survey_id = p_survey_id and removed_at is null)
     or (select count(distinct x) from jsonb_array_elements(p_layout) g, jsonb_array_elements_text(g -> 'questionIds') x
          join public.research_survey_questions q on q.id = x::uuid and q.survey_id = p_survey_id and q.removed_at is null)
       <> (select count(*) from public.research_survey_questions where survey_id = p_survey_id and removed_at is null)
     or (select count(*) from jsonb_array_elements(p_layout) g join public.research_survey_sections s on s.id = nullif(g ->> 'sectionId', '')::uuid and s.survey_id = p_survey_id and s.removed_at is null)
       <> (select count(*) from public.research_survey_sections where survey_id = p_survey_id and removed_at is null) then
    raise exception 'The survey was changed by someone else. Reload and try again.';
  end if;
  for v_group in select g from jsonb_array_elements(p_layout) g loop
    v_section := nullif(v_group ->> 'sectionId', '')::uuid;
    if v_section is not null then
      update public.research_survey_sections set sort_order = v_s, updated_at = now() where id = v_section;
      v_s := v_s + 1;
    end if;
    for v_qid in select jsonb_array_elements_text(v_group -> 'questionIds') loop
      update public.research_survey_questions set section_id = v_section, sort_order = v_q where id = v_qid::uuid and survey_id = p_survey_id;
      v_q := v_q + 1;
    end loop;
  end loop;
  perform public._survey_renumber(p_survey_id);
end; $$;

-- Bulk upload: always AFTER what is there. A row may name its section (a new name creates it); other rows go to p_section_id, or the end.
create or replace function public.survey_questions_import(p_survey_id uuid, p_items jsonb, p_section_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_name text; v_section uuid; v_count integer := 0; v_base integer;
begin
  perform public._survey_require_staff(p_survey_id);
  if jsonb_array_length(p_items) > 500 then raise exception 'At most 500 questions at a time.'; end if;
  if p_section_id is not null and not exists (select 1 from public.research_survey_sections where id = p_section_id and survey_id = p_survey_id and removed_at is null) then
    raise exception 'That section is not part of this survey.';
  end if;
  -- create the new sections first, in the order the file mentions them
  for v_name in select btrim(e ->> 'section') from jsonb_array_elements(p_items) with ordinality t(e, n) where btrim(coalesce(e ->> 'section', '')) <> '' order by n loop
    if not exists (select 1 from public.research_survey_sections where survey_id = p_survey_id and removed_at is null and lower(title) = lower(v_name)) then
      perform public._survey_add_section(p_survey_id, v_name, '');
    end if;
  end loop;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    v_name := btrim(coalesce(v_item ->> 'section', ''));
    v_section := p_section_id;
    if v_name <> '' then
      select id into v_section from public.research_survey_sections where survey_id = p_survey_id and removed_at is null and lower(title) = lower(v_name) order by sort_order limit 1;
    end if;
    perform public.survey_question_save(p_survey_id, (v_item - 'id' - 'section') || jsonb_build_object('sectionId', v_section), false);
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

do $$
declare f text;
begin
  foreach f in array array[
    'survey_outline(uuid, boolean)', 'survey_delete_impact(uuid)', 'survey_question_save(uuid, jsonb, boolean)', 'survey_question_delete(uuid)',
    'survey_section_save(uuid, uuid, text, text)', 'survey_section_delete(uuid, boolean)', 'survey_reorder(uuid, jsonb)', 'survey_questions_import(uuid, jsonb, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 7. Labels for credits given because a survey was turned off ──
do $$
begin
  if to_regprocedure('public._sdp_how_of_source(text)') is not null then
    execute $f$
      create or replace function public._sdp_how_of_source(p_source text) returns text language sql immutable as $b$
        select case p_source when 'scholar_scan' then 'scan' when 'monitor_scan' then 'scan' when 'survey_released' then 'scan' when 'manual' then 'manual' when 'credit_attended' then 'credit_attended'
                             when 'import' then 'import' when 'progress_picture' then 'picture' when 'restore_survey_bug' then 'restored' else 'other' end;
      $b$
    $f$;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
