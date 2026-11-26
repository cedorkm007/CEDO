-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_multi_activity.sql
-- SURVEY TOOLS UPDATE, PHASE 3: ONE SURVEY, SEVERAL ACTIVITIES.   Safe to run twice.   Undo: undo_survey_multi_activity.sql
--
--   * A survey can be attached to several SDP / Formation activities. An activity still has only ONE survey.
--   * A scholar answers it once PER ACTIVITY (a recurring activity counts as one).
--   * Each response records its activity and how it was asked (QR scan / Scanning Tools).
--   * Detaching an activity keeps its answers and gives any credit that was waiting.
--   * Deleting an activity no longer deletes the survey or its answers.
--   * Results can be filtered by activity, with counts per activity.
-- Existing links and answers are copied over. Old answers get the survey's current activity and "not recorded" as how they were asked.
-- The old activity columns are kept (today's live screens keep working until the new version is merged).
-- Needs the Phase 1 and Phase 2 files.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.survey_outline(uuid,boolean)') is null or to_regprocedure('public._survey_missing_credits(text,uuid,timestamptz)') is null then
    raise exception 'STOPPED, nothing changed: run the Phase 1 and Phase 2 survey files first.';
  end if;
end $$;

-- ── 1. Which activities a survey is attached to ──────────────
create table if not exists public.research_survey_activities (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  activity_type text not null check (activity_type in ('sdp', 'formation')),
  activity_id uuid not null,            -- no link on purpose: answers must survive if the activity is deleted
  activity_name text not null default '',
  attached_at timestamptz not null default now(),
  detached_at timestamptz,
  unique (survey_id, activity_id)
);
create unique index if not exists research_survey_activities_one_survey on public.research_survey_activities (activity_id) where detached_at is null;
create index if not exists research_survey_activities_survey on public.research_survey_activities (survey_id);
alter table public.research_survey_activities enable row level security;
drop policy if exists "research staff read" on public.research_survey_activities;
create policy "research staff read" on public.research_survey_activities for select using (public.is_research_monitoring_staff());

-- copy today's links
insert into public.research_survey_activities (survey_id, activity_type, activity_id, activity_name, attached_at)
select s.id, 'sdp', s.sdp_activity_id, coalesce(a.name, ''), s.created_at from public.research_surveys s join public.sdp_activities a on a.id = s.sdp_activity_id
union all
select s.id, 'formation', s.formation_activity_id, coalesce(f.name, ''), s.created_at from public.research_surveys s join public.formation_activities f on f.id = s.formation_activity_id
on conflict do nothing;

-- a survey no longer disappears with its activity
do $$
declare v record;
begin
  for v in
    select c.conname, a.attname, c.confrelid::regclass::text as target
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.research_surveys'::regclass and c.contype = 'f' and a.attname in ('sdp_activity_id', 'formation_activity_id') and c.confdeltype <> 'n'
  loop
    execute format('alter table public.research_surveys drop constraint %I', v.conname);
    execute format('alter table public.research_surveys add constraint %I foreign key (%I) references %s(id) on delete set null', v.conname, v.attname, v.target);
  end loop;
end $$;
alter table public.research_surveys drop constraint if exists research_surveys_exactly_one_activity;
alter table public.research_surveys add constraint research_surveys_exactly_one_activity check (num_nonnulls(sdp_activity_id, formation_activity_id, quest_subject_id) <= 1);

-- ── 2. Responses: one per scholar per survey PER ACTIVITY ────
alter table public.research_survey_responses add column if not exists activity_type text;
alter table public.research_survey_responses add column if not exists activity_id uuid;
alter table public.research_survey_responses add column if not exists activity_name text;
alter table public.research_survey_responses add column if not exists ask_trigger text;     -- 'qr', 'scanner'; empty = not recorded

update public.research_survey_responses r
set activity_type = l.activity_type, activity_id = l.activity_id, activity_name = l.activity_name
from public.research_survey_activities l
where r.activity_id is null and l.survey_id = r.survey_id and l.detached_at is null
  and (select count(*) from public.research_survey_activities x where x.survey_id = r.survey_id) = 1;

do $$
declare v record;
begin
  -- the old "one response per scholar per survey" rule (whatever it is called)
  for v in
    select i.indexrelid::regclass::text as index_name, c.conname
    from pg_index i left join pg_constraint c on c.conindid = i.indexrelid
    where i.indrelid = 'public.research_survey_responses'::regclass and i.indisunique and not i.indisprimary and i.indexprs is null
      and (select array_agg(a.attname order by a.attname) from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['scholar_id_number', 'survey_id']::name[]
  loop
    if v.conname is not null then execute format('alter table public.research_survey_responses drop constraint %I', v.conname);
    else execute format('drop index %s', v.index_name); end if;
  end loop;
end $$;
create unique index if not exists research_survey_responses_per_activity
  on public.research_survey_responses (survey_id, scholar_id_number, (coalesce(activity_id, '00000000-0000-0000-0000-000000000000'::uuid)));

-- ── 3. How a waiting attendance was recorded ─────────────────
alter table public.attendance_records add column if not exists held_trigger text;
create or replace function public._survey_stamp_held()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending_survey' and (tg_op = 'INSERT' or old.status is distinct from 'pending_survey') then
    new.held_at := now();
    select gps.current_school_year, gps.current_semester into new.held_school_year, new.held_semester from public.grading_period_settings gps where gps.id = true;
    new.held_trigger := case when exists (select 1 from public.scholars s where s.id = auth.uid() and s.scholar_id_number = new.scholar_id_number) then 'qr' else 'scanner' end;
  end if;
  return new;
end; $$;
revoke all on function public._survey_stamp_held() from public, anon, authenticated;

-- ── 4. Should this scan wait for a survey? ───────────────────
create or replace function public._survey_gate(p_activity_id uuid, p_scholar_id_number text)
returns uuid language sql stable security definer set search_path = public as $$
  select l.survey_id
  from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id and s.is_active
  where l.activity_id = p_activity_id and l.detached_at is null
    and not exists (select 1 from public.research_survey_responses r
                    where r.survey_id = l.survey_id and r.scholar_id_number = p_scholar_id_number and r.activity_id = p_activity_id and r.status in ('completed', 'declined'))
  limit 1;
$$;
revoke all on function public._survey_gate(uuid, text) from public, anon, authenticated;

-- the attendance function: replace only its "is there a survey to wait for" part, in the LIVE function
do $patch$
declare
  v_def text; v_pattern constant text := 'select id into v_survey_gate_id from public\.research_surveys.*?v_survey_gate_id := null; -- already resolved[^\n]*\n\s*end if;';
  v_new constant text := 'v_survey_gate_id := public._survey_gate(v_activity_id, p_scholar_id_number);';
  v_fn regprocedure;
begin
  v_fn := coalesce(to_regprocedure('public._apply_attendance(uuid,text,text,date,text)'), to_regprocedure('public._apply_attendance(uuid,text,text,date)'), to_regprocedure('public._apply_attendance(uuid,text,text)'));
  if v_fn is null then raise exception 'STOPPED, nothing changed: the attendance function was not found.'; end if;
  v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
  if position(v_new in v_def) > 0 then return; end if;
  if (select count(*) from regexp_matches(v_def, v_pattern, 'g')) <> 1 then
    raise exception 'STOPPED, nothing changed: the live attendance function is not the version this file expects. Tell CEDO''s developer.';
  end if;
  execute regexp_replace(v_def, v_pattern, v_new);
end
$patch$;

-- ── 5. Give what was held: for one activity ──────────────────
drop function if exists public._finalize_survey_gated_attendance(uuid, text, uuid);
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid, p_activity_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_item record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_activity_credits integer;
  v_current_year text; v_current_semester text; v_school_year text; v_semester text;
begin
  select gps.current_school_year, gps.current_semester into v_current_year, v_current_semester
    from public.grading_period_settings gps where gps.id = true;

  for v_rec in
    select * from public.attendance_records r
    where r.scholar_id_number = p_scholar_id_number and r.pending_survey_id = p_survey_id
      and (p_activity_id is null or exists (select 1 from public.attendance_sessions x where x.id = r.session_id and coalesce(x.sdp_activity_id, x.formation_activity_id) = p_activity_id))
    for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null and exists (select 1 from public._survey_missing_credits(p_scholar_id_number, v_rec.session_id)) then
      v_school_year := coalesce(nullif(v_rec.held_school_year, ''), v_current_year);
      v_semester := coalesce(nullif(v_rec.held_semester, ''), v_current_semester);
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_sdp_activity_id;
      if v_sdp_category is not null and public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester) >= public.sdp_category_credit_goal() then
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        for v_item in select * from public._survey_missing_credits(p_scholar_id_number, v_rec.session_id) loop
          select coalesce(max(c.occurrence_number), 0) + 1 into v_occurrence from public.sdp_attendance c where c.activity_id = v_sdp_activity_id and c.scholar_id_number = p_scholar_id_number;
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day, activity_sid)
          values (v_sdp_activity_id, p_scholar_id_number, v_item.scan_date, null, v_occurrence, v_school_year, v_semester, v_item.day, v_item.sid)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid, uuid) from public, anon, authenticated;

-- Turning a survey off, or detaching an activity: everyone waiting gets their attendance and credit, and stays listed as "released".
create or replace function public._survey_release(p_survey_id uuid, p_activity_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform set_config('app.sdp_source', 'survey_released', true);
  for v in
    select s.id as scholar_id, r.scholar_id_number, x.activity_id, x.activity_type, x.activity_name, r.held_trigger
    from public.attendance_records r
    join public.scholars s on s.scholar_id_number = r.scholar_id_number
    join lateral (
      select coalesce(a.sdp_activity_id, a.formation_activity_id) as activity_id, case when a.sdp_activity_id is not null then 'sdp' else 'formation' end as activity_type,
             coalesce((select n.name from public.sdp_activities n where n.id = a.sdp_activity_id), (select f.name from public.formation_activities f where f.id = a.formation_activity_id), '') as activity_name
      from public.attendance_sessions a where a.id = r.session_id
    ) x on true
    where r.pending_survey_id = p_survey_id and (p_activity_id is null or x.activity_id = p_activity_id)
  loop
    insert into public.research_survey_responses (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
    values (p_survey_id, v.scholar_id_number, v.activity_type, v.activity_id, v.activity_name, v.held_trigger)
    on conflict do nothing;
    perform public._finalize_survey_gated_attendance(v.scholar_id, v.scholar_id_number, p_survey_id, v.activity_id);
  end loop;
  perform set_config('app.sdp_source', '', true);
end; $$;
revoke all on function public._survey_release(uuid, uuid) from public, anon, authenticated;

create or replace function public._survey_release_on_deactivate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and not new.is_active then perform public._survey_release(new.id); end if;
  return null;
end; $$;
revoke all on function public._survey_release_on_deactivate() from public, anon, authenticated;

-- ── 6. The scholar's survey steps ────────────────────────────
drop function if exists public.start_or_resume_survey_response(uuid);
create or replace function public.start_or_resume_survey_response(p_survey_id uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_activity uuid := p_activity_id; v_type text; v_name text; v_trigger text;
  v_sections jsonb; v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

  -- which activity: the one asked for, else the one most recently left waiting, else one already started, else the only one
  if v_activity is null then
    select coalesce(x.sdp_activity_id, x.formation_activity_id) into v_activity
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id
      order by r.held_at desc nulls last, r.updated_at desc limit 1;
  end if;
  if v_activity is null then
    select r.activity_id into v_activity from public.research_survey_responses r
      where r.survey_id = p_survey_id and r.scholar_id_number = v_scholar.scholar_id_number order by (r.status = 'in_progress') desc, r.updated_at desc limit 1;
  end if;
  if v_activity is null and (select count(*) from public.research_survey_activities l where l.survey_id = p_survey_id and l.detached_at is null) = 1 then
    select l.activity_id into v_activity from public.research_survey_activities l where l.survey_id = p_survey_id and l.detached_at is null;
  end if;
  if v_activity is null then raise exception 'There is nothing waiting for this survey.'; end if;

  select * into v_response from public.research_survey_responses r
    where r.survey_id = p_survey_id and r.scholar_id_number = v_scholar.scholar_id_number and r.activity_id = v_activity;
  if not found then
    select l.activity_type, l.activity_name into v_type, v_name from public.research_survey_activities l where l.survey_id = p_survey_id and l.activity_id = v_activity;
    if v_type is null then raise exception 'This survey is not for that activity.'; end if;
    select r.held_trigger into v_trigger from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id and coalesce(x.sdp_activity_id, x.formation_activity_id) = v_activity limit 1;
    insert into public.research_survey_responses (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (p_survey_id, v_scholar.scholar_id_number, v_type, v_activity, v_name, v_trigger)
      returning * into v_response;
  else
    update public.research_survey_responses set updated_at = now() where id = v_response.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description) order by s.sort_order), '[]'::jsonb) into v_sections
  from public.research_survey_sections s
  where s.survey_id = p_survey_id and s.removed_at is null
    and exists (select 1 from public.research_survey_questions q where q.section_id = s.id and q.removed_at is null);

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
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text, 'activityName', v_response.activity_name);
end; $$;
revoke all on function public.start_or_resume_survey_response(uuid, uuid) from public, anon;
grant execute on function public.start_or_resume_survey_response(uuid, uuid) to authenticated;

create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_missing_count integer; v_finalized_count integer;
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
  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id, v_response.activity_id);
  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_response.activity_name, 'the activity'));
end; $$;
revoke all on function public.submit_survey_response(uuid) from public, anon;
grant execute on function public.submit_survey_response(uuid) to authenticated;

create or replace function public.submit_survey_consent(p_response_id uuid, p_agree boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_finalized_count integer := 0;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status in ('completed', 'declined') then
    return jsonb_build_object('ok', true, 'declined', v_response.status = 'declined', 'finalizedCount', 0);
  end if;
  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if not v_survey.requires_consent then raise exception 'This survey does not require consent.'; end if;
  if p_agree then
    update public.research_survey_responses set consented = true, updated_at = now() where id = p_response_id;
    return jsonb_build_object('ok', true, 'declined', false, 'finalizedCount', 0);
  end if;
  update public.research_survey_responses set consented = false, status = 'declined', submitted_at = now(), updated_at = now() where id = p_response_id;
  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id, v_response.activity_id);
  return jsonb_build_object('ok', true, 'declined', true, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_response.activity_name, 'the activity'));
end; $$;
revoke all on function public.submit_survey_consent(uuid, boolean) from public, anon;
grant execute on function public.submit_survey_consent(uuid, boolean) to authenticated;

-- ── 7. Attaching and detaching ───────────────────────────────
-- the old single-activity columns mirror the first attached activity (for today's live screens)
create or replace function public._survey_mirror_primary(p_survey_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.research_survey_activities%rowtype;
begin
  select * into v from public.research_survey_activities l where l.survey_id = p_survey_id and l.detached_at is null
    and (exists (select 1 from public.sdp_activities a where a.id = l.activity_id) or exists (select 1 from public.formation_activities f where f.id = l.activity_id))
    order by l.attached_at, l.activity_id limit 1;
  perform set_config('app.survey_links', 'set', true);
  update public.research_surveys set
    sdp_activity_id = case when v.activity_type = 'sdp' then v.activity_id end,
    formation_activity_id = case when v.activity_type = 'formation' then v.activity_id end,
    updated_at = now()
  where id = p_survey_id and quest_subject_id is null;
  perform set_config('app.survey_links', '', true);
end; $$;
revoke all on function public._survey_mirror_primary(uuid) from public, anon, authenticated;

create or replace function public._survey_attach(p_survey_id uuid, p_type text, p_activity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_other text;
begin
  if p_type = 'sdp' then select name into v_name from public.sdp_activities where id = p_activity_id;
  elsif p_type = 'formation' then select name into v_name from public.formation_activities where id = p_activity_id;
  end if;
  if v_name is null then raise exception 'That activity was not found.'; end if;
  select s.title into v_other from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id
    where l.activity_id = p_activity_id and l.detached_at is null and l.survey_id <> p_survey_id;
  if v_other is not null then raise exception '"%" already has the survey "%". An activity can have only one survey.', v_name, v_other; end if;
  insert into public.research_survey_activities (survey_id, activity_type, activity_id, activity_name)
  values (p_survey_id, p_type, p_activity_id, v_name)
  on conflict (survey_id, activity_id) do update set detached_at = null, activity_name = excluded.activity_name,
    attached_at = case when public.research_survey_activities.detached_at is null then public.research_survey_activities.attached_at else now() end;
end; $$;
revoke all on function public._survey_attach(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._survey_detach(p_survey_id uuid, p_activity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._survey_release(p_survey_id, p_activity_id);
  update public.research_survey_activities set detached_at = now() where survey_id = p_survey_id and activity_id = p_activity_id and detached_at is null;
end; $$;
revoke all on function public._survey_detach(uuid, uuid) from public, anon, authenticated;

-- today's live screens write the old columns: keep the list of attachments in step with them
create or replace function public._survey_columns_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_new uuid := coalesce(new.sdp_activity_id, new.formation_activity_id);
begin
  if coalesce(current_setting('app.survey_links', true), '') = 'set' then return null; end if;
  if tg_op = 'UPDATE' then v_old := coalesce(old.sdp_activity_id, old.formation_activity_id); end if;
  if v_old is not distinct from v_new then return null; end if;
  -- (the column also empties when its activity is being deleted: that is handled by the activity's own trigger, and there is nothing to release)
  if v_old is not null then
    if exists (select 1 from public.sdp_activities a where a.id = v_old) or exists (select 1 from public.formation_activities f where f.id = v_old) then
      perform public._survey_detach(new.id, v_old);
    elsif v_new is null then
      perform public._survey_mirror_primary(new.id);        -- the next attached activity takes its place in the old column
    end if;
  end if;
  if v_new is not null then perform public._survey_attach(new.id, case when new.sdp_activity_id is not null then 'sdp' else 'formation' end, v_new); end if;
  return null;
end; $$;
revoke all on function public._survey_columns_changed() from public, anon, authenticated;
drop trigger if exists survey_columns_changed on public.research_surveys;
create trigger survey_columns_changed after insert or update of sdp_activity_id, formation_activity_id on public.research_surveys
  for each row execute function public._survey_columns_changed();

-- a deleted activity is marked detached; its survey and answers stay
create or replace function public._survey_activity_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.research_survey_activities set detached_at = coalesce(detached_at, now()), activity_name = old.name where activity_id = old.id;
  update public.research_survey_responses set activity_name = old.name where activity_id = old.id;
  return old;
end; $$;
revoke all on function public._survey_activity_deleted() from public, anon, authenticated;
drop trigger if exists survey_activity_deleted on public.sdp_activities;
create trigger survey_activity_deleted before delete on public.sdp_activities for each row execute function public._survey_activity_deleted();
drop trigger if exists survey_activity_deleted on public.formation_activities;
create trigger survey_activity_deleted before delete on public.formation_activities for each row execute function public._survey_activity_deleted();

-- Create or change a survey together with its activities: [{"type": "sdp", "id": "..."}, ...]
create or replace function public.survey_save(p_survey_id uuid, p_title text, p_description text, p_requires_consent boolean, p_consent_text text, p_activities jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_survey_id; v record; v_item jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Enter a survey title.'; end if;
  if coalesce(jsonb_array_length(p_activities), 0) = 0 then raise exception 'Choose at least one activity.'; end if;
  if p_requires_consent and btrim(coalesce(p_consent_text, '')) = '' then raise exception 'Enter the consent question text.'; end if;
  if v_id is null then
    insert into public.research_surveys (title, description, requires_consent, consent_text, created_by)
    values (btrim(p_title), btrim(coalesce(p_description, '')), p_requires_consent, coalesce(nullif(btrim(p_consent_text), ''), 'This survey is voluntary. Do you agree to participate?'), (select u.id from public.users u where u.id = auth.uid()))
    returning id into v_id;
  else
    perform public._survey_require_staff(v_id);
    update public.research_surveys set title = btrim(p_title), description = btrim(coalesce(p_description, '')), requires_consent = p_requires_consent,
      consent_text = coalesce(nullif(btrim(p_consent_text), ''), consent_text), updated_at = now() where id = v_id;
  end if;
  -- detach what is no longer chosen (deleted activities stay as they are)
  for v in select l.activity_id from public.research_survey_activities l where l.survey_id = v_id and l.detached_at is null
             and not exists (select 1 from jsonb_array_elements(p_activities) e where (e ->> 'id')::uuid = l.activity_id) loop
    perform public._survey_detach(v_id, v.activity_id);
  end loop;
  perform public._survey_mirror_primary(v_id);          -- frees the old column before another survey takes that activity
  for v_item in select e from jsonb_array_elements(p_activities) e loop
    perform public._survey_attach(v_id, v_item ->> 'type', (v_item ->> 'id')::uuid);
  end loop;
  perform public._survey_mirror_primary(v_id);
  return v_id;
end; $$;
revoke all on function public.survey_save(uuid, text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.survey_save(uuid, text, text, boolean, text, jsonb) to authenticated;

-- Every activity, with the survey it already has.
create or replace function public.survey_activity_options()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'id', x.id, 'name', x.name, 'category', x.category, 'subCategory', x.sub_category, 'date', x.at,
                                                 'surveyId', l.survey_id, 'surveyTitle', s.title) order by x.at desc nulls last, x.name), '[]'::jsonb)
    from (
      select 'sdp' as type, a.id, a.name, a.category, to_jsonb(a) ->> 'sub_category' as sub_category, a.date_time as at from public.sdp_activities a
      union all
      select 'formation', f.id, f.name, null, null, f.date_time from public.formation_activities f
    ) x
    left join public.research_survey_activities l on l.activity_id = x.id and l.detached_at is null
    left join public.research_surveys s on s.id = l.survey_id
  );
end; $$;
revoke all on function public.survey_activity_options() from public, anon;
grant execute on function public.survey_activity_options() to authenticated;

-- For the activity pop-up in SDP Monitoring.
create or replace function public.survey_for_activity(p_activity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_research_monitoring_staff() or public.is_sead_staff() or public.has_staff_tag('sdp_monitoring')
          or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'Not authorized.';
  end if;
  return (select jsonb_build_object('title', s.title, 'active', s.is_active)
          from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id
          where l.activity_id = p_activity_id and l.detached_at is null);
end; $$;
revoke all on function public.survey_for_activity(uuid) from public, anon;
grant execute on function public.survey_for_activity(uuid) to authenticated;

-- ── 8. Results by activity ───────────────────────────────────
drop function if exists public.research_survey_question_results(uuid);
create or replace function public.research_survey_question_results(p_question_id uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_question public.research_survey_questions%rowtype; v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  select * into v_question from public.research_survey_questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;

  with picked as (
    select a.choice_id, a.likert_value, a.text_value, a.answered_at
    from public.research_survey_answers a join public.research_survey_responses r on r.id = a.response_id
    where a.question_id = p_question_id and (p_activity_id is null or r.activity_id = p_activity_id)
  )
  select case v_question.question_type
    when 'multiple_choice' then (
      select jsonb_agg(jsonb_build_object('choiceId', c.id, 'choiceText', c.choice_text, 'count', coalesce(cnt.n, 0), 'removed', c.removed_at is not null, 'removedReason', c.removed_reason) order by c.removed_at is not null, c.sort_order, c.created_at)
      from public.research_survey_choices c
      left join (select choice_id, count(*) n from picked group by choice_id) cnt on cnt.choice_id = c.id
      where c.question_id = p_question_id and (c.removed_at is null or coalesce(cnt.n, 0) > 0))
    when 'open_ended' then (select jsonb_build_object('texts', coalesce(jsonb_agg(text_value order by answered_at), '[]'::jsonb)) from picked)
    else (
      select jsonb_build_object('n', stats.n, 'mean', stats.mean, 'median', stats.median, 'stddev', stats.stddev, 'distribution', dist.distribution)
      from (select count(*) n, avg(likert_value) mean, percentile_cont(0.5) within group (order by likert_value) median, stddev_samp(likert_value) stddev from picked) stats,
      (select jsonb_agg(jsonb_build_object('value', pt, 'count', coalesce(a.cnt, 0),
                'percentage', case when total.n > 0 then round(coalesce(a.cnt, 0) * 100.0 / total.n, 1) else 0 end) order by pt) distribution
       from generate_series(v_question.likert_scale_min, v_question.likert_scale_max) pt
       left join (select likert_value, count(*) cnt from picked group by likert_value) a on a.likert_value = pt
       cross join (select count(*) n from picked) total) dist)
  end into v_result;

  return coalesce(v_result, case when v_question.question_type = 'multiple_choice' then '[]'::jsonb
    when v_question.question_type = 'open_ended' then jsonb_build_object('texts', '[]'::jsonb)
    else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb) end);
end; $$;
revoke all on function public.research_survey_question_results(uuid, uuid) from public, anon;
grant execute on function public.research_survey_question_results(uuid, uuid) to authenticated;

-- Who was asked, for which activity: pending (still waiting), completed, declined, or released (given their credit without answering).
-- "released" is only sent when asked for: today's live results screen does not know that word, so it keeps getting the old ones.
drop function if exists public.research_survey_gating_roster(uuid);
create or replace function public.research_survey_gating_roster(p_survey_id uuid, p_activity_id uuid default null, p_with_released boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  with held as (
    select r.scholar_id_number, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id, max(r.updated_at) as updated_at
    from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
    where r.pending_survey_id = p_survey_id
    group by 1, 2
  ),
  everyone as (
    select r.scholar_id_number, r.activity_id, r.activity_name,
           case when r.status in ('completed', 'declined') then r.status when h.scholar_id_number is not null or not p_with_released then 'in_progress' else 'released' end as status,
           r.updated_at
    from public.research_survey_responses r
    left join held h on h.scholar_id_number = r.scholar_id_number and h.activity_id is not distinct from r.activity_id
    where r.survey_id = p_survey_id
    union all
    select h.scholar_id_number, h.activity_id, l.activity_name, 'in_progress', h.updated_at
    from held h left join public.research_survey_activities l on l.survey_id = p_survey_id and l.activity_id = h.activity_id
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = h.scholar_id_number and r.activity_id is not distinct from h.activity_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', e.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), e.scholar_id_number),
    'activityId', e.activity_id, 'activityName', coalesce(e.activity_name, 'Not recorded'),
    'status', e.status, 'updatedAt', e.updated_at
  ) order by e.status, e.scholar_id_number, e.activity_name), '[]'::jsonb)
  into v_result
  from everyone e left join public.scholars s on s.scholar_id_number = e.scholar_id_number
  where p_activity_id is null or e.activity_id = p_activity_id;
  return v_result;
end; $$;
revoke all on function public.research_survey_gating_roster(uuid, uuid, boolean) from public, anon;
grant execute on function public.research_survey_gating_roster(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
