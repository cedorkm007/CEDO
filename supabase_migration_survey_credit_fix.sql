-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_credit_fix.sql
-- SURVEY TOOLS UPDATE, PHASE 1: THE SDP CREDIT BUG.   Safe to run twice.   Undo: undo_survey_credit_fix.sql
--
-- WHAT WAS WRONG (since the update that added skip questions and written answers):
--   * A scholar who FINISHED a survey was marked present but got no SDP credit.
--   * A voluntary survey no longer asked "do you agree to participate?" and the server no longer checked the answer.
-- WHAT THIS DOES:
--   * Finishing a survey gives the credit again, once. Never a second credit for one that already exists (added by staff, import, picture, a later scan).
--   * The voluntary survey asks for consent again.
--   * A credit that waited for a survey is dated and placed in the semester of the SCAN, and keeps its day and session.
-- WHAT IT DOES NOT DO: it changes no past record. Missing credits are restored by restore_survey_sdp_credits.sql, after you check the list.
-- Needs the survey, SDP same-day-sessions and credit-history updates already run.
-- ─────────────────────────────────────────────────────────────

begin;

-- Stop (changing nothing) if the live database is not what this file was written for.
do $$
begin
  if to_regprocedure('public.submit_survey_response(uuid)') is null or position('research_survey_required_question_ids' in pg_get_functiondef('public.submit_survey_response(uuid)'::regprocedure)) = 0 then
    raise exception 'STOPPED, nothing changed: the live "finish survey" step is not the version this file expects. Tell CEDO''s developer.';
  end if;
  if to_regprocedure('public.start_or_resume_survey_response(uuid)') is null or position('skipToQuestionId' in pg_get_functiondef('public.start_or_resume_survey_response(uuid)'::regprocedure)) = 0 then
    raise exception 'STOPPED, nothing changed: the live "open survey" step is not the version this file expects. Tell CEDO''s developer.';
  end if;
  if to_regprocedure('public._finalize_survey_gated_attendance(uuid,text,uuid)') is null or position('_sdp_redeemed_days' in pg_get_functiondef('public._finalize_survey_gated_attendance(uuid,text,uuid)'::regprocedure))
       + position('_survey_missing_credits' in pg_get_functiondef('public._finalize_survey_gated_attendance(uuid,text,uuid)'::regprocedure)) = 0 then
    raise exception 'STOPPED, nothing changed: the live "give the held credit" step is not the version this file expects. Tell CEDO''s developer.';
  end if;
  if to_regprocedure('public._sdp_allowed_occurrences(uuid)') is null or to_regclass('public.sdp_credit_history') is null then
    raise exception 'STOPPED, nothing changed: run the SDP updates (same-day sessions, credit history) first.';
  end if;
end $$;

-- 1. Remember when (and in which semester) an attendance started waiting for a survey.
alter table public.attendance_records add column if not exists held_at timestamptz;
alter table public.attendance_records add column if not exists held_school_year text;
alter table public.attendance_records add column if not exists held_semester text;

create or replace function public._survey_stamp_held()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending_survey' and (tg_op = 'INSERT' or old.status is distinct from 'pending_survey') then
    new.held_at := now();
    select gps.current_school_year, gps.current_semester into new.held_school_year, new.held_semester from public.grading_period_settings gps where gps.id = true;
  end if;
  return new;
end; $$;
revoke all on function public._survey_stamp_held() from public, anon, authenticated;
drop trigger if exists survey_stamp_held on public.attendance_records;
create trigger survey_stamp_held before insert or update on public.attendance_records
  for each row execute function public._survey_stamp_held();

-- 2. Which credits a scholar's scans of one activity have earned but do not have yet.
--    p_up_to empty = every scan so far; p_up_to given = only the scans made up to that moment (used for restoring).
create or replace function public._survey_missing_credits(p_scholar_id_number text, p_session_id uuid, p_up_to timestamptz default null)
returns table(day date, sid text, scan_date date, scanned_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with ses as (
    select s.id, s.sdp_activity_id as activity_id from public.attendance_sessions s where s.id = p_session_id and s.sdp_activity_id is not null
  ),
  rec as (
    select r.* from public.attendance_records r where r.session_id = p_session_id and r.scholar_id_number = p_scholar_id_number
  ),
  codes as (
    select c.day_date, nullif(btrim(coalesce(c.session_sid, '')), '') as sid, c.redeemed_at as ts
    from public.attendance_codes c
    where c.session_id = p_session_id and c.redeemed_by_scholar_id = p_scholar_id_number and c.kind in ('voucher', 'time_out')
      and (p_up_to is null or c.redeemed_at <= p_up_to)
  ),
  -- scans with no code of their own (a monitor scanned the ID card)
  extra as (
    select null::date as day_date, null::text as sid, coalesce(r.time_out_at, r.held_at, p_up_to, now()) as ts
    from rec r
    cross join lateral generate_series(1,
      case when p_up_to is not null and exists (select 1 from codes) then 0
           else greatest(0, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) - (select count(*) from codes)::integer)
      end) g(n)
  ),
  scans as (
    select u.sid, u.ts, (u.ts at time zone 'Asia/Manila')::date as scan_date,
           coalesce(u.day_date, (select d.day from public._sdp_schedule_days((select activity_id from ses)) d where d.day = (u.ts at time zone 'Asia/Manila')::date limit 1)) as day
    from (select * from codes union all select * from extra) u
    where exists (select 1 from ses)
  ),
  numbered as (
    select s.*, row_number() over (partition by s.day, s.sid order by s.ts) as k from scans s
  ),
  credits as (
    select c.activity_day, c.activity_sid from public.sdp_attendance c where c.activity_id = (select activity_id from ses) and c.scholar_id_number = p_scholar_id_number
  ),
  unmatched as (
    select n.*, row_number() over (order by n.ts, n.k) as pos
    from numbered n
    where n.k > (select count(*) from credits c where (n.sid is not null and c.activity_sid = n.sid) or (n.day is not null and c.activity_day = n.day and (n.sid is null or c.activity_sid is null)))
  )
  select u.day, u.sid, u.scan_date, u.ts
  from unmatched u
  where u.pos > (select count(*) from credits c where c.activity_day is null and c.activity_sid is null)   -- credits not tied to a day cover the earliest scans
  order by u.pos
  limit greatest(0, coalesce(public._sdp_allowed_occurrences((select activity_id from ses)), 0) - (select count(*) from credits)::integer);
$$;
revoke all on function public._survey_missing_credits(text, uuid, timestamptz) from public, anon, authenticated;

-- 3. Give the held attendance and credit (used when a survey is finished or declined).
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
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
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null and exists (select 1 from public._survey_missing_credits(p_scholar_id_number, v_rec.session_id)) then
      -- the semester of the scan; the current one when it was not recorded (attendance that was already waiting before this update)
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
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;

-- 4. Finish a survey: check consent, check every question on the scholar's path, then give what was held.
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
  if v_response.status = 'completed' then
    return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0);
  end if;
  if v_response.status = 'declined' then raise exception 'You already declined to participate in this survey.'; end if;

  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if v_survey.requires_consent and coalesce(v_response.consented, false) is not true then
    raise exception 'Please respond to the consent question first.';
  end if;

  select count(*) into v_missing_count
    from public.research_survey_required_question_ids(p_response_id) req(id)
    where not exists (
      select 1 from public.research_survey_answers a
      where a.response_id = p_response_id and a.question_id = req.id
    );
  if v_missing_count > 0 then
    raise exception 'Please answer every question before submitting.';
  end if;

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

-- 5. Open a survey: also tell the app whether it is voluntary and what the scholar chose.
create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;

  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'openEndedFormat', q.open_ended_format,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'choiceText', c.choice_text,
        'skipToQuestionId', c.skip_to_question_id, 'endsSurvey', c.ends_survey
      ) order by c.sort_order), '[]'::jsonb)
      from public.research_survey_choices c where c.question_id = q.id
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id;

  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value, 'textValue', a.text_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a where a.response_id = v_response.id;

  return jsonb_build_object('responseId', v_response.id, 'status', v_response.status, 'questions', v_questions, 'answers', v_answers,
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text);
end; $$;
revoke all on function public.start_or_resume_survey_response(uuid) from public, anon;
grant execute on function public.start_or_resume_survey_response(uuid) to authenticated;

-- 6. The list used by the check file and the restore file: credits lost to the bug, one line per credit.
--    Only attendance that was released by FINISHING a survey (declining always gave the credit).
create table if not exists public.survey_credit_restore_log (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  scholar_id_number text not null,
  activity_id uuid not null,
  activity_name text,
  session_id uuid not null,
  action text not null check (action in ('credit', 'saved')),
  sdp_attendance_id uuid,
  reserved_credit_id uuid,
  attended_date date,
  school_year text,
  semester text,
  response_id uuid,
  undone_at timestamptz
);
alter table public.survey_credit_restore_log enable row level security;
revoke all on table public.survey_credit_restore_log from anon, authenticated;

create or replace function public._survey_restore_plan()
returns table(action text, scholar_id_number text, scholar_name text, activity_name text, scan_date date, school_year text, semester text, semester_basis text,
              finished_on date, activity_id uuid, session_id uuid, activity_day date, activity_sid text, scanned_at timestamptz, response_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with period as (
    select current_school_year as sy, current_semester as sem, updated_at from public.grading_period_settings where id = true
  ),
  held as (
    select r.id as response_id, r.scholar_id_number, r.submitted_at, n.session_id, s.sdp_activity_id as activity_id
    from public.research_survey_responses r
    -- the "your attendance was finalized" note is written in the same moment the survey is finished, and only for attendance that was waiting
    join public.scholar_attendance_finalized_notifications n on n.scholar_id_number = r.scholar_id_number and n.created_at = r.submitted_at
    join public.attendance_sessions s on s.id = n.session_id and s.sdp_activity_id is not null
    where r.status = 'completed' and r.submitted_at >= timestamptz '2026-09-15 00:00:00+08'      -- the bug arrived with the update of this date
      and not exists (select 1 from public.sdp_reserved_credits rc where rc.scholar_id_number = r.scholar_id_number and rc.created_at = r.submitted_at)   -- already saved for later at the time
      and not exists (select 1 from public.survey_credit_restore_log l where l.response_id = r.id and l.session_id = n.session_id and l.action = 'saved' and l.undone_at is null)
  ),
  missing as (
    select h.*, m.day, m.sid, m.scan_date, m.scanned_at
    from held h cross join lateral public._survey_missing_credits(h.scholar_id_number, h.session_id, h.submitted_at) m
  ),
  placed as (
    select x.*,
      case when p.updated_at <= x.scanned_at then p.sy else coalesce(h.school_year, a.school_year, p.sy) end as school_year,
      case when p.updated_at <= x.scanned_at then p.sem else coalesce(h.semester, a.semester, p.sem) end as semester,
      case when p.updated_at <= x.scanned_at then 'current semester (not changed since this scan)'
           when h.school_year is not null then 'from other scans around that day'
           when a.school_year is not null then 'from other scan credits around that day'
           else 'NOT CERTAIN: current semester used, please check' end as semester_basis
    from missing x
    cross join period p
    left join lateral (
      select c.school_year, c.semester from public.sdp_credit_history c
      where c.event_type = 'credit_added' and c.source in ('scholar_scan', 'monitor_scan') and c.school_year is not null
        and c.occurred_at between x.scanned_at - interval '7 days' and x.scanned_at + interval '7 days'
      order by abs(extract(epoch from (c.occurred_at - x.scanned_at))) limit 1
    ) h on true
    left join lateral (
      select c.school_year, c.semester from public.sdp_attendance c
      where c.created_by is null and c.school_year is not null and c.attended_date between x.scan_date - 7 and x.scan_date + 7
      order by abs(c.attended_date - x.scan_date) limit 1
    ) a on true
  )
  select
    case
      when sc.status = 'Removed' then 'NOT restored: the scholar was removed from the program'
      when act.category is null then 'NOT restored: the activity has no SDP category'
      when exists (select 1 from public.sdp_credit_history c where c.event_type = 'credit_removed' and c.activity_id = p.activity_id and c.scholar_id_number = p.scholar_id_number
                   and c.source <> 'restore_survey_bug_undo') then 'NOT restored: staff removed a credit of this activity (please decide by hand)'
      else 'WILL RESTORE'
    end,
    p.scholar_id_number,
    btrim(coalesce(sc.last_name, '') || ', ' || coalesce(sc.first_name, '')),
    act.name, p.scan_date, p.school_year, p.semester, p.semester_basis,
    (p.submitted_at at time zone 'Asia/Manila')::date,
    p.activity_id, p.session_id, p.day, p.sid, p.scanned_at, p.response_id
  from placed p
  join public.scholars sc on sc.scholar_id_number = p.scholar_id_number
  join public.sdp_activities act on act.id = p.activity_id;
$$;
revoke all on function public._survey_restore_plan() from public, anon, authenticated;

-- 7. The credit filters know restored credits (only when the filters update has been run).
do $$
begin
  if to_regprocedure('public._sdp_how_of_source(text)') is not null then
    execute $f$
      create or replace function public._sdp_how_of_source(p_source text) returns text language sql immutable as $b$
        select case p_source when 'scholar_scan' then 'scan' when 'monitor_scan' then 'scan' when 'manual' then 'manual' when 'credit_attended' then 'credit_attended'
                             when 'import' then 'import' when 'progress_picture' then 'picture' when 'restore_survey_bug' then 'restored' else 'other' end;
      $b$
    $f$;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
