-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_triggers.sql
-- SURVEY TOOLS UPDATE, PHASE 4: THE SURVEY'S CREATOR CHOOSES WHEN IT IS ASKED.   Safe to run twice.   Undo: undo_survey_triggers.sql
--
--   * Tick boxes per survey: QR scan / typed code, Scanning Tools (both on, as today), manual credit by staff, picture approval, SDP reconsideration.
--   * QR and Scanning Tools: attendance waits for the survey (as today).
--   * Manual credit ("by hand", "Credit selected", "Credit these scholars") and picture approval: the credit is given AT ONCE; the survey is asked afterwards.
--   * ONE survey can be the SDP reconsideration survey. It is asked when a scholar sends a reconsideration request; the request does not wait.
--   * A scholar is asked once per activity (once per request), whatever happens. Time In and file import never ask.
--   * Results can be filtered by how the survey was asked.
-- Existing surveys keep asking exactly as today. Triggers count from the moment they are set: earlier attendance is not asked.
-- Needs the Phase 1, 2 and 3 files.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.research_survey_activities') is null or to_regprocedure('public._survey_release(uuid,uuid)') is null then
    raise exception 'STOPPED, nothing changed: run the Phase 1, 2 and 3 survey files first.';
  end if;
end $$;

-- ── 1. What each survey asks about ───────────────────────────
alter table public.research_surveys add column if not exists ask_qr boolean not null default true;
alter table public.research_surveys add column if not exists ask_scanner boolean not null default true;
alter table public.research_surveys add column if not exists ask_manual boolean not null default false;
alter table public.research_surveys add column if not exists ask_picture boolean not null default false;
alter table public.research_surveys add column if not exists ask_reconsideration boolean not null default false;
create unique index if not exists research_surveys_one_reconsideration on public.research_surveys (ask_reconsideration) where ask_reconsideration;

-- Surveys asked AFTER something already happened (nothing is held back).
create table if not exists public.research_survey_asks (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  activity_type text not null check (activity_type in ('sdp', 'formation', 'reconsideration')),
  activity_id uuid not null,              -- the activity, or the reconsideration request
  activity_name text not null default '',
  ask_trigger text not null check (ask_trigger in ('manual', 'picture', 'reconsideration')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,                  -- the survey was turned off or the activity detached: no longer asked
  unique (survey_id, scholar_id_number, activity_id)
);
create index if not exists research_survey_asks_scholar on public.research_survey_asks (scholar_id_number) where closed_at is null;
alter table public.research_survey_asks enable row level security;
drop policy if exists "research staff read" on public.research_survey_asks;
create policy "research staff read" on public.research_survey_asks for select using (public.is_research_monitoring_staff());

-- ── 2. QR scan / Scanning Tools: should attendance wait? ─────
create or replace function public._survey_gate(p_activity_id uuid, p_scholar_id_number text)
returns uuid language sql stable security definer set search_path = public as $$
  select l.survey_id
  from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id and s.is_active
  where l.activity_id = p_activity_id and l.detached_at is null
    and not exists (select 1 from public.research_survey_responses r
                    where r.survey_id = l.survey_id and r.scholar_id_number = p_scholar_id_number and r.activity_id = p_activity_id and r.status in ('completed', 'declined'))
    and (
      -- the scholar scanning is "QR scan or code"; anyone else scanning the scholar is "Scanning Tools"
      case when exists (select 1 from public.scholars x where x.id = auth.uid() and x.scholar_id_number = p_scholar_id_number) then s.ask_qr else s.ask_scanner end
      -- something already waiting for this activity keeps waiting
      or exists (select 1 from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
                 where a.scholar_id_number = p_scholar_id_number and a.pending_survey_id = l.survey_id and coalesce(b.sdp_activity_id, b.formation_activity_id) = p_activity_id)
    )
  limit 1;
$$;
revoke all on function public._survey_gate(uuid, text) from public, anon, authenticated;

-- ── 3. Manual credit and picture approval: ask afterwards ────
create or replace function public._survey_ask_after_credit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hint text := nullif(current_setting('app.sdp_source', true), '');
  v_trigger text; v record;
begin
  -- scans have no "added by" and no hint; imports, restores and survey releases carry their own hint and never ask
  v_trigger := case
    when v_hint = 'progress_picture' then 'picture'
    when v_hint = 'credit_attended' then 'manual'
    when v_hint is null and new.created_by is not null then 'manual'
  end;
  if v_trigger is null then return null; end if;
  begin
    select l.survey_id, l.activity_type, l.activity_name into v
    from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id and s.is_active
    where l.activity_id = new.activity_id and l.detached_at is null
      and case v_trigger when 'manual' then s.ask_manual else s.ask_picture end;
    if found
       and exists (select 1 from public.scholars x where x.scholar_id_number = new.scholar_id_number and x.status <> 'Removed')
       and not exists (select 1 from public.research_survey_responses r where r.survey_id = v.survey_id and r.scholar_id_number = new.scholar_id_number and r.activity_id = new.activity_id)
       and not exists (select 1 from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
                       where a.scholar_id_number = new.scholar_id_number and a.pending_survey_id = v.survey_id and b.sdp_activity_id = new.activity_id) then
      insert into public.research_survey_asks (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (v.survey_id, new.scholar_id_number, v.activity_type, new.activity_id, v.activity_name, v_trigger)
      on conflict (survey_id, scholar_id_number, activity_id) do nothing;
    end if;
  exception when others then
    raise warning 'survey not asked for this credit: %', sqlerrm;        -- a survey must never stop a credit
  end;
  return null;
end; $$;
revoke all on function public._survey_ask_after_credit() from public, anon, authenticated;
drop trigger if exists survey_ask_after_credit on public.sdp_attendance;
create trigger survey_ask_after_credit after insert on public.sdp_attendance for each row execute function public._survey_ask_after_credit();

-- ── 4. SDP reconsideration: ask when the request is sent ─────
create or replace function public._survey_ask_after_reconsideration()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_survey uuid;
begin
  begin
    select s.id into v_survey from public.research_surveys s where s.ask_reconsideration and s.is_active;
    if v_survey is not null then
      insert into public.research_survey_asks (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (v_survey, new.scholar_id_number, 'reconsideration', new.id, 'SDP reconsideration – ' || new.school_year || ' ' || new.term, 'reconsideration')
      on conflict (survey_id, scholar_id_number, activity_id) do nothing;
    end if;
  exception when others then
    raise warning 'survey not asked for this reconsideration request: %', sqlerrm;      -- a survey must never hold a renewal back
  end;
  return null;
end; $$;
revoke all on function public._survey_ask_after_reconsideration() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.sdp_reconsideration_requests') is not null then
    drop trigger if exists survey_ask_after_reconsideration on public.sdp_reconsideration_requests;
    create trigger survey_ask_after_reconsideration after insert on public.sdp_reconsideration_requests for each row execute function public._survey_ask_after_reconsideration();
  end if;
end $$;

-- ── 5. Turned off / detached / deleted: nothing more is asked ─
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
  update public.research_survey_asks set closed_at = now() where survey_id = p_survey_id and closed_at is null and (p_activity_id is null or activity_id = p_activity_id);
end; $$;
revoke all on function public._survey_release(uuid, uuid) from public, anon, authenticated;

create or replace function public._survey_activity_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.research_survey_activities set detached_at = coalesce(detached_at, now()), activity_name = old.name where activity_id = old.id;
  update public.research_survey_responses set activity_name = old.name where activity_id = old.id;
  update public.research_survey_asks set closed_at = coalesce(closed_at, now()), activity_name = old.name where activity_id = old.id;
  return old;
end; $$;
revoke all on function public._survey_activity_deleted() from public, anon, authenticated;

-- ── 6. The scholar's waiting surveys ─────────────────────────
create or replace function public.my_pending_surveys()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_sid text;
begin
  select scholar_id_number into v_sid from public.scholars where id = auth.uid();
  if v_sid is null then raise exception 'Only signed-in scholars have surveys.'; end if;
  return (
    with held as (
      select r.pending_survey_id as survey_id, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id,
             coalesce((select n.name from public.sdp_activities n where n.id = x.sdp_activity_id), (select f.name from public.formation_activities f where f.id = x.formation_activity_id), 'the activity') as activity_name,
             coalesce(r.held_trigger, 'qr') as ask_trigger
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_sid and r.status = 'pending_survey' and r.pending_survey_id is not null
    ),
    asked as (
      select k.survey_id, k.activity_id, k.activity_name, k.ask_trigger
      from public.research_survey_asks k join public.research_surveys s on s.id = k.survey_id and s.is_active
      where k.scholar_id_number = v_sid and k.closed_at is null
        and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = v_sid and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
        and not exists (select 1 from held h where h.survey_id = k.survey_id and h.activity_id = k.activity_id)
    )
    select coalesce(jsonb_agg(jsonb_build_object('surveyId', p.survey_id, 'activityId', p.activity_id, 'surveyTitle', s.title, 'activityName', p.activity_name,
                                                 'holdsCredit', p.holds, 'trigger', p.ask_trigger) order by p.holds desc, p.activity_name), '[]'::jsonb)
    from (select h.*, true as holds from held h union all select a.*, false from asked a) p
    join public.research_surveys s on s.id = p.survey_id
  );
end; $$;
revoke all on function public.my_pending_surveys() from public, anon;
grant execute on function public.my_pending_surveys() to authenticated;

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

  -- which activity: the one asked for, else the one most recently left waiting, else one asked afterwards, else one already started, else the only one
  if v_activity is null then
    select coalesce(x.sdp_activity_id, x.formation_activity_id) into v_activity
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id
      order by r.held_at desc nulls last, r.updated_at desc limit 1;
  end if;
  if v_activity is null then
    select k.activity_id into v_activity from public.research_survey_asks k
      where k.survey_id = p_survey_id and k.scholar_id_number = v_scholar.scholar_id_number and k.closed_at is null
        and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
      order by k.created_at desc limit 1;
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
    select k.activity_type, k.activity_name, k.ask_trigger into v_type, v_name, v_trigger from public.research_survey_asks k
      where k.survey_id = p_survey_id and k.scholar_id_number = v_scholar.scholar_id_number and k.activity_id = v_activity;
    if v_type is null then
      select l.activity_type, l.activity_name into v_type, v_name from public.research_survey_activities l where l.survey_id = p_survey_id and l.activity_id = v_activity;
    end if;
    if v_type is null then raise exception 'This survey is not for that activity.'; end if;
    -- attendance waiting for it says how it was scanned; otherwise keep what the "asked afterwards" line says
    v_trigger := coalesce((select r.held_trigger from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id and coalesce(x.sdp_activity_id, x.formation_activity_id) = v_activity limit 1), v_trigger);
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

-- ── 7. Saving a survey with its triggers ─────────────────────
-- p_triggers: {"qr": true, "scanner": true, "manual": false, "picture": false, "reconsideration": false}; null = leave as they are
drop function if exists public.survey_save(uuid, text, text, boolean, text, jsonb);
create or replace function public.survey_save(p_survey_id uuid, p_title text, p_description text, p_requires_consent boolean, p_consent_text text, p_activities jsonb, p_triggers jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_survey_id; v record; v_item jsonb; v_old public.research_surveys%rowtype;
  v_qr boolean; v_scanner boolean; v_manual boolean; v_picture boolean; v_recon boolean;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Enter a survey title.'; end if;
  if p_requires_consent and btrim(coalesce(p_consent_text, '')) = '' then raise exception 'Enter the consent question text.'; end if;
  if v_id is not null then
    perform public._survey_require_staff(v_id);
    select * into v_old from public.research_surveys where id = v_id;
  end if;
  v_qr := coalesce((p_triggers ->> 'qr')::boolean, v_old.ask_qr, true);
  v_scanner := coalesce((p_triggers ->> 'scanner')::boolean, v_old.ask_scanner, true);
  v_manual := coalesce((p_triggers ->> 'manual')::boolean, v_old.ask_manual, false);
  v_picture := coalesce((p_triggers ->> 'picture')::boolean, v_old.ask_picture, false);
  v_recon := coalesce((p_triggers ->> 'reconsideration')::boolean, v_old.ask_reconsideration, false);
  if not (v_qr or v_scanner or v_manual or v_picture or v_recon) then raise exception 'Tick at least one time to ask this survey.'; end if;
  if coalesce(jsonb_array_length(p_activities), 0) = 0 and not v_recon then raise exception 'Choose at least one activity.'; end if;

  -- only one survey can be the reconsideration survey: ticking it here takes it from the other one
  if v_recon then
    update public.research_surveys set ask_reconsideration = false, updated_at = now() where ask_reconsideration and id is distinct from v_id;
  end if;

  if v_id is null then
    insert into public.research_surveys (title, description, requires_consent, consent_text, created_by, ask_qr, ask_scanner, ask_manual, ask_picture, ask_reconsideration)
    values (btrim(p_title), btrim(coalesce(p_description, '')), p_requires_consent, coalesce(nullif(btrim(p_consent_text), ''), 'This survey is voluntary. Do you agree to participate?'),
            (select u.id from public.users u where u.id = auth.uid()), v_qr, v_scanner, v_manual, v_picture, v_recon)
    returning id into v_id;
  else
    update public.research_surveys set title = btrim(p_title), description = btrim(coalesce(p_description, '')), requires_consent = p_requires_consent,
      consent_text = coalesce(nullif(btrim(p_consent_text), ''), consent_text),
      ask_qr = v_qr, ask_scanner = v_scanner, ask_manual = v_manual, ask_picture = v_picture, ask_reconsideration = v_recon, updated_at = now()
    where id = v_id;
  end if;
  for v in select l.activity_id from public.research_survey_activities l where l.survey_id = v_id and l.detached_at is null
             and not exists (select 1 from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb)) e where (e ->> 'id')::uuid = l.activity_id) loop
    perform public._survey_detach(v_id, v.activity_id);
  end loop;
  perform public._survey_mirror_primary(v_id);
  for v_item in select e from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb)) e loop
    perform public._survey_attach(v_id, v_item ->> 'type', (v_item ->> 'id')::uuid);
  end loop;
  perform public._survey_mirror_primary(v_id);
  return v_id;
end; $$;
revoke all on function public.survey_save(uuid, text, text, boolean, text, jsonb, jsonb) from public, anon;
grant execute on function public.survey_save(uuid, text, text, boolean, text, jsonb, jsonb) to authenticated;

-- ── 8. Results by how the survey was asked ───────────────────
-- p_trigger: 'qr', 'scanner', 'manual', 'picture', 'reconsideration', 'none' (not recorded); null = all
drop function if exists public.research_survey_question_results(uuid, uuid);
create or replace function public.research_survey_question_results(p_question_id uuid, p_activity_id uuid default null, p_trigger text default null)
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
      and (p_trigger is null or coalesce(r.ask_trigger, 'none') = p_trigger)
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
revoke all on function public.research_survey_question_results(uuid, uuid, text) from public, anon;
grant execute on function public.research_survey_question_results(uuid, uuid, text) to authenticated;

create or replace function public.research_survey_gating_roster(p_survey_id uuid, p_activity_id uuid default null, p_with_released boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  with held as (
    select r.scholar_id_number, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id, max(r.updated_at) as updated_at, max(r.held_trigger) as ask_trigger,
           max(case when x.sdp_activity_id is not null then 'sdp' else 'formation' end) as activity_type
    from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
    where r.pending_survey_id = p_survey_id
    group by 1, 2
  ),
  asks as (select * from public.research_survey_asks k where k.survey_id = p_survey_id),
  everyone as (
    select r.scholar_id_number, r.activity_id, r.activity_type, r.activity_name, coalesce(r.ask_trigger, h.ask_trigger, k.ask_trigger) as ask_trigger,
           case when r.status in ('completed', 'declined') then r.status
                when h.scholar_id_number is not null or (k.id is not null and k.closed_at is null) or not p_with_released then 'in_progress'
                else 'released' end as status,
           r.updated_at
    from public.research_survey_responses r
    left join held h on h.scholar_id_number = r.scholar_id_number and h.activity_id is not distinct from r.activity_id
    left join asks k on k.scholar_id_number = r.scholar_id_number and k.activity_id is not distinct from r.activity_id
    where r.survey_id = p_survey_id
    union all
    -- asked afterwards and not opened yet
    select k.scholar_id_number, k.activity_id, k.activity_type, k.activity_name, k.ask_trigger,
           case when k.closed_at is null or not p_with_released then 'in_progress' else 'released' end, k.created_at
    from asks k
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id)
    union all
    select h.scholar_id_number, h.activity_id, h.activity_type, l.activity_name, h.ask_trigger, 'in_progress', h.updated_at
    from held h left join public.research_survey_activities l on l.survey_id = p_survey_id and l.activity_id = h.activity_id
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = h.scholar_id_number and r.activity_id is not distinct from h.activity_id)
      and not exists (select 1 from asks k where k.scholar_id_number = h.scholar_id_number and k.activity_id = h.activity_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', e.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), e.scholar_id_number),
    'activityId', e.activity_id, 'activityType', e.activity_type, 'activityName', coalesce(e.activity_name, 'Not recorded'),
    'trigger', e.ask_trigger, 'status', e.status, 'updatedAt', e.updated_at
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
