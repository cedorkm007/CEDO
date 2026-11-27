-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_ask_once.sql
-- A SCHOLAR WHO HAS ALREADY RESPONDED IS NOT ASKED THE SAME SURVEY AGAIN.   Safe to run twice.   Undo: undo_survey_ask_once.sql
--
--   * After a scholar answers (or declines) a survey once, no activity asks it of them again: not a QR scan, not Scanning Tools,
--     not manual credit, not a picture approval. Their credit is given at once.
--   * The SDP reconsideration survey is still asked for each NEW request.
--   * Answering it also releases anything else of theirs that was waiting for the same survey.
--   * Running this file releases what is waiting NOW for a survey the scholar already responded to (see the check file for who).
-- It deletes no answer. Needs the Phase 4 survey file.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.survey_announce(uuid)') is not null then
    raise exception 'STOPPED, nothing changed: the survey announcement update is already in place, so this older file must not be run again.';
  end if;
  if to_regprocedure('public.my_pending_surveys()') is null or to_regclass('public.research_survey_asks') is null then
    raise exception 'STOPPED, nothing changed: run the Phase 4 survey file (supabase_migration_survey_triggers.sql) first.';
  end if;
end $$;

-- Has this scholar already responded to this survey (any activity)?
create or replace function public._survey_responded(p_survey_id uuid, p_scholar_id_number text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.research_survey_responses r
                 where r.survey_id = p_survey_id and r.scholar_id_number = p_scholar_id_number and r.status in ('completed', 'declined'));
$$;
revoke all on function public._survey_responded(uuid, text) from public, anon, authenticated;

-- Everything of theirs that waits for this survey for an ACTIVITY is finished: held attendance and credit are given, "asked afterwards" lines removed.
create or replace function public._survey_settle(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  v_count := public._finalize_survey_gated_attendance(p_scholar_id, p_scholar_id_number, p_survey_id, null);
  delete from public.research_survey_asks k
    where k.survey_id = p_survey_id and k.scholar_id_number = p_scholar_id_number and k.activity_type <> 'reconsideration'
      and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id);
  return v_count;
end; $$;
revoke all on function public._survey_settle(uuid, text, uuid) from public, anon, authenticated;

-- ── QR scan / Scanning Tools ──
create or replace function public._survey_gate(p_activity_id uuid, p_scholar_id_number text)
returns uuid language sql stable security definer set search_path = public as $$
  select l.survey_id
  from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id and s.is_active
  where l.activity_id = p_activity_id and l.detached_at is null
    and not public._survey_responded(l.survey_id, p_scholar_id_number)
    and (
      case when exists (select 1 from public.scholars x where x.id = auth.uid() and x.scholar_id_number = p_scholar_id_number) then s.ask_qr else s.ask_scanner end
      or exists (select 1 from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
                 where a.scholar_id_number = p_scholar_id_number and a.pending_survey_id = l.survey_id and coalesce(b.sdp_activity_id, b.formation_activity_id) = p_activity_id)
    )
  limit 1;
$$;
revoke all on function public._survey_gate(uuid, text) from public, anon, authenticated;

-- ── Manual credit and picture approval ──
create or replace function public._survey_ask_after_credit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hint text := nullif(current_setting('app.sdp_source', true), '');
  v_trigger text; v record;
begin
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
       and not public._survey_responded(v.survey_id, new.scholar_id_number)
       and not exists (select 1 from public.research_survey_responses r where r.survey_id = v.survey_id and r.scholar_id_number = new.scholar_id_number and r.activity_id = new.activity_id)
       and not exists (select 1 from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
                       where a.scholar_id_number = new.scholar_id_number and a.pending_survey_id = v.survey_id and b.sdp_activity_id = new.activity_id) then
      insert into public.research_survey_asks (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (v.survey_id, new.scholar_id_number, v.activity_type, new.activity_id, v.activity_name, v_trigger)
      on conflict (survey_id, scholar_id_number, activity_id) do nothing;
    end if;
  exception when others then
    raise warning 'survey not asked for this credit: %', sqlerrm;
  end;
  return null;
end; $$;
revoke all on function public._survey_ask_after_credit() from public, anon, authenticated;

-- ── Finishing or declining settles everything of theirs for that survey ──
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
  v_finalized_count := public._survey_settle(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);
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
  v_finalized_count := public._survey_settle(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);
  return jsonb_build_object('ok', true, 'declined', true, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_response.activity_name, 'the activity'));
end; $$;
revoke all on function public.submit_survey_consent(uuid, boolean) from public, anon;
grant execute on function public.submit_survey_consent(uuid, boolean) to authenticated;

-- ── Opening a survey: one already responded to is not shown again ──
create or replace function public.start_or_resume_survey_response(p_survey_id uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_activity uuid := p_activity_id; v_type text; v_name text; v_trigger text; v_settled integer := 0;
  v_sections jsonb; v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

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

  -- already responded: this request (reconsideration), or the survey itself (activities). Nothing is asked; anything waiting is given.
  if v_response.status in ('completed', 'declined')
     or (not exists (select 1 from public.research_survey_asks k where k.survey_id = p_survey_id and k.scholar_id_number = v_scholar.scholar_id_number and k.activity_id = v_activity and k.activity_type = 'reconsideration')
         and coalesce(v_response.activity_type, '') <> 'reconsideration'
         and public._survey_responded(p_survey_id, v_scholar.scholar_id_number)) then
    v_settled := public._survey_settle(v_scholar.id, v_scholar.scholar_id_number, p_survey_id);
    if v_response.id is null then
      select * into v_response from public.research_survey_responses r
        where r.survey_id = p_survey_id and r.scholar_id_number = v_scholar.scholar_id_number and r.status in ('completed', 'declined') order by r.submitted_at desc nulls last limit 1;
    end if;
    return jsonb_build_object('responseId', v_response.id, 'status', 'completed', 'alreadyAnswered', true, 'finalizedCount', v_settled,
      'sections', '[]'::jsonb, 'questions', '[]'::jsonb, 'answers', '[]'::jsonb, 'requiresConsent', false, 'consented', null, 'consentText', '',
      'activityName', coalesce(v_response.activity_name, 'the activity'));
  end if;

  if v_response.id is null then
    select k.activity_type, k.activity_name, k.ask_trigger into v_type, v_name, v_trigger from public.research_survey_asks k
      where k.survey_id = p_survey_id and k.scholar_id_number = v_scholar.scholar_id_number and k.activity_id = v_activity;
    if v_type is null then
      select l.activity_type, l.activity_name into v_type, v_name from public.research_survey_activities l where l.survey_id = p_survey_id and l.activity_id = v_activity;
    end if;
    if v_type is null then raise exception 'This survey is not for that activity.'; end if;
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

-- ── The banner: one line per survey for activities, one per reconsideration request ──
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
             coalesce(r.held_trigger, 'qr') as ask_trigger, true as holds, false as recon, coalesce(r.held_at, r.updated_at) as made_at
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_sid and r.status = 'pending_survey' and r.pending_survey_id is not null
    ),
    asked as (
      select k.survey_id, k.activity_id, k.activity_name, k.ask_trigger, false as holds, k.activity_type = 'reconsideration' as recon, k.created_at as made_at
      from public.research_survey_asks k join public.research_surveys s on s.id = k.survey_id and s.is_active
      where k.scholar_id_number = v_sid and k.closed_at is null
        and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = v_sid and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
        and (k.activity_type = 'reconsideration' or not public._survey_responded(k.survey_id, v_sid))
        and not exists (select 1 from held h where h.survey_id = k.survey_id and h.activity_id = k.activity_id)
    ),
    everything as (select * from held union all select * from asked),
    lines as (
      -- every activity waiting for the same survey is one thing to answer
      select e.survey_id, (array_agg(e.activity_id order by e.holds desc, e.made_at desc))[1] as activity_id,
             string_agg(distinct e.activity_name, ', ') as activity_name, bool_or(e.holds) as holds,
             (array_agg(e.ask_trigger order by e.holds desc, e.made_at desc))[1] as ask_trigger
      from everything e where not e.recon group by e.survey_id
      union all
      select e.survey_id, e.activity_id, e.activity_name, e.holds, e.ask_trigger from everything e where e.recon
    )
    select coalesce(jsonb_agg(jsonb_build_object('surveyId', l.survey_id, 'activityId', l.activity_id, 'surveyTitle', s.title, 'activityName', l.activity_name,
                                                 'holdsCredit', l.holds, 'trigger', l.ask_trigger) order by l.holds desc, l.activity_name), '[]'::jsonb)
    from lines l join public.research_surveys s on s.id = l.survey_id
  );
end; $$;
revoke all on function public.my_pending_surveys() from public, anon;
grant execute on function public.my_pending_surveys() to authenticated;

-- ── Release what is waiting now for a survey already responded to ──
do $$
declare v record;
begin
  for v in
    select distinct s.id as scholar_id, x.scholar_id_number, x.survey_id
    from (
      select a.scholar_id_number, a.pending_survey_id as survey_id from public.attendance_records a where a.pending_survey_id is not null
      union
      select k.scholar_id_number, k.survey_id from public.research_survey_asks k where k.closed_at is null and k.activity_type <> 'reconsideration'
    ) x
    join public.scholars s on s.scholar_id_number = x.scholar_id_number
    where public._survey_responded(x.survey_id, x.scholar_id_number)
  loop
    perform public._survey_settle(v.scholar_id, v.scholar_id_number, v.survey_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
