-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_gated_attendance.sql
--
-- Gates a scholar's time-out or voucher QR scan on completing that
-- activity's attached survey (if one exists) — time-in is never gated.
-- Superseding version of redeem_attendance_code(), same file-chain
-- convention as its 3 prior versions (supabase_migration_attendance_
-- system.sql -> supabase_migration_formation_attendance.sql ->
-- supabase_migration_attendance_eligibility_and_status.sql -> this one).
--
-- Design, confirmed during planning:
-- - Steps that resolve the scholar, lock+validate the code, check
--   Formation eligibility, check "already completed", and ATOMICALLY
--   CLAIM the code are copied verbatim and unchanged — that ordering is
--   what already prevents a second scholar claiming the same code while
--   this one is mid-survey, and must not be disturbed.
-- - Resumable: since the code is claimed the instant it's scanned, a
--   scholar who closes the app mid-survey still has their scan recorded
--   (time_out_at / hours_earned get written immediately) but held at
--   status='pending_survey' instead of 'present' until they finish the
--   survey — never lost, never re-scannable.
-- - my_completed_activity_attendance() needs NO change: it already
--   filters status='present' only, so 'pending_survey' rows are
--   automatically excluded from what the form-unlock engine trusts as
--   "attendance done".
-- ─────────────────────────────────────────────────────────────

alter table public.attendance_records drop constraint if exists attendance_records_status_check;
alter table public.attendance_records add constraint attendance_records_status_check
  check (status in ('incomplete', 'present', 'pending_survey'));
alter table public.attendance_records add column if not exists pending_survey_id uuid references public.research_surveys(id);

-- Persisted "your attendance was finalized" notice — needed because
-- finalization can now happen in a LATER session than the scan (the
-- scholar closed the app mid-survey and finished it from the dashboard's
-- resume banner later), so the scanning screen may not even be open when
-- finalization actually occurs. Mirrors scholar_form_unlock_notifications'
-- shape/RLS closely, but keyed on (session_id, scholar_id_number) rather
-- than a single attendance_record_id — attendance_records has no `id`
-- column on the live schema (only session_id/scholar_id_number, unique
-- together), unlike what an earlier "create table if not exists" in this
-- repo's history suggested; verified directly against the live table
-- before writing this rather than trusting that file.
create table if not exists public.scholar_attendance_finalized_notifications (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  scholar_id_number text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (session_id, scholar_id_number)
);
create index if not exists idx_scholar_attn_finalized_notif_scholar on public.scholar_attendance_finalized_notifications(scholar_id) where read_at is null;
alter table public.scholar_attendance_finalized_notifications enable row level security;
drop policy if exists "scholar reads own attendance finalized notifications" on public.scholar_attendance_finalized_notifications;
create policy "scholar reads own attendance finalized notifications" on public.scholar_attendance_finalized_notifications for select using (scholar_id = auth.uid());
drop policy if exists "scholar marks own attendance finalized notifications read" on public.scholar_attendance_finalized_notifications;
create policy "scholar marks own attendance finalized notifications read" on public.scholar_attendance_finalized_notifications for update using (scholar_id = auth.uid()) with check (scholar_id = auth.uid());

-- Scholar-facing read on attendance_sessions, scoped to sessions they
-- already have an attendance_records row on (which they can already read
-- via the pre-existing "scholar reads own attendance" policy) — needed so
-- fetchMyPendingSurveys()/fetchAttendanceFinalizedNotifications() can
-- resolve a human-readable activity name via a nested select. Without
-- this, attendance_sessions had NO scholar-facing SELECT policy at all
-- (only staff), so the nested join silently returned null rather than an
-- error, and the banners fell back to a generic "the activity" label —
-- caught by live browser testing, not by the SQL-level RPC tests, since
-- this is a plain table read rather than something the gating RPCs touch.
drop policy if exists "scholar reads own attendance sessions" on public.attendance_sessions;
create policy "scholar reads own attendance sessions" on public.attendance_sessions for select using (
  exists (
    select 1 from public.attendance_records r
    where r.session_id = attendance_sessions.id
    and r.scholar_id_number = (select s.scholar_id_number from public.scholars s where s.id = auth.uid())
  )
);

-- Scholar-facing read on active surveys — needed because
-- fetchMyPendingSurveys() (the dashboard's "resume your survey" banner)
-- reads research_surveys directly rather than through a security-definer
-- RPC, to resolve a pending attendance row's survey title.
drop policy if exists "scholar reads active surveys" on public.research_surveys;
create policy "scholar reads active surveys" on public.research_surveys for select using (
  is_active and exists (select 1 from public.scholars s where s.id = auth.uid())
);

-- Scholar-facing read on their own survey responses/answers (deferred from
-- the Phase B migration until these write RPCs existed to need it). No
-- scholar insert/update/delete policy on either table — all writes go
-- through the security-definer RPCs below, same reasoning as
-- scholar_form_unlock_notifications: a scholar can never insert an
-- arbitrary row via a direct table call.
drop policy if exists "scholar reads own survey responses" on public.research_survey_responses;
create policy "scholar reads own survey responses" on public.research_survey_responses for select using (
  scholar_id_number = (select s.scholar_id_number from public.scholars s where s.id = auth.uid())
);
drop policy if exists "scholar reads own survey answers" on public.research_survey_answers;
create policy "scholar reads own survey answers" on public.research_survey_answers for select using (
  exists (select 1 from public.research_survey_responses r where r.id = response_id
    and r.scholar_id_number = (select s.scholar_id_number from public.scholars s where s.id = auth.uid()))
);

-- ── redeem_attendance_code(): add the survey gate ────────────
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype; v_name text; v_updated uuid;
  v_activity_id uuid; v_survey_gate_id uuid;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid QR code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This QR code has already been claimed.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  if v_session.formation_activity_id is not null and not exists (
    select 1 from public.formation_activities a where a.id = v_session.formation_activity_id
    and (a.all_year_levels or v_scholar.year_level = any(a.target_year_levels))
  ) then raise exception 'You are not eligible to attend this activity.'; end if;
  if exists (select 1 from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number and ((v_code.kind = 'time_in' and r.time_in_at is not null) or (v_code.kind = 'time_out' and r.time_out_at is not null) or v_code.kind = 'voucher')) then
    raise exception 'You already completed this attendance requirement.';
  end if;
  -- Atomic claim — unchanged from the prior version. Must happen before
  -- any survey check below, so a second scholar can't claim this same
  -- code while this one is being evaluated for a survey gate.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  -- Only time_out and voucher can ever be gated; time_in never is.
  v_survey_gate_id := null;
  if v_code.kind in ('time_out', 'voucher') then
    v_activity_id := coalesce(v_session.sdp_activity_id, v_session.formation_activity_id);
    select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = v_scholar.scholar_id_number and r.status = 'completed'
    ) then
      v_survey_gate_id := null; -- already completed this survey — nothing to gate
    end if;
  end if;

  if v_code.kind = 'time_in' then
    insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status)
      values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete')
      on conflict(session_id,scholar_id_number) do update
        set time_out_at=coalesce(attendance_records.time_out_at,excluded.time_out_at),
            status=case
              when attendance_records.time_in_at is null then 'incomplete'
              when v_survey_gate_id is not null then 'pending_survey'
              else 'present'
            end,
            pending_survey_id=case when attendance_records.time_in_at is not null then v_survey_gate_id else null end,
            updated_at=now();
  else
    insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status,pending_survey_id)
      values(v_session.id,v_scholar.scholar_id_number,coalesce(v_session.duration_hours,1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id)
      on conflict(session_id,scholar_id_number) do update
        set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),
            status=case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id=v_survey_gate_id,
            updated_at=now();
  end if;
  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id);
end; $$;

-- ── Scholar-facing survey response RPCs ──────────────────────

/** Idempotent entry point for both "just got gated by a scan" and "resuming from the dashboard banner" — returns the survey's questions/choices plus any already-saved answers so the modal can pick up where the scholar left off. */
create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype;
  v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;

  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text) order by c.sort_order), '[]'::jsonb)
      from public.research_survey_choices c where c.question_id = q.id
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id;

  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a where a.response_id = v_response.id;

  return jsonb_build_object('responseId', v_response.id, 'status', v_response.status, 'questions', v_questions, 'answers', v_answers);
end; $$;
grant execute on function public.start_or_resume_survey_response(uuid) to authenticated;

/** Per-question upsert — its own transaction, separate from finalization, which is what makes the survey resumable: an answered question survives the scholar closing the app before submitting. */
create or replace function public.submit_survey_answer(p_response_id uuid, p_question_id uuid, p_choice_id uuid default null, p_likert_value integer default null)
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

  if v_question.question_type = 'multiple_choice' then
    if p_choice_id is null or p_likert_value is not null then raise exception 'Provide exactly a choice for this question.'; end if;
    if not exists (select 1 from public.research_survey_choices where id = p_choice_id and question_id = p_question_id) then
      raise exception 'Invalid choice for this question.';
    end if;
  else
    if p_likert_value is null or p_choice_id is not null then raise exception 'Provide exactly a scale value for this question.'; end if;
    if p_likert_value < v_question.likert_scale_min or p_likert_value > v_question.likert_scale_max then
      raise exception 'Scale value out of range.';
    end if;
  end if;

  insert into public.research_survey_answers (response_id, question_id, choice_id, likert_value)
    values (p_response_id, p_question_id, p_choice_id, p_likert_value)
    on conflict (response_id, question_id) do update set choice_id = excluded.choice_id, likert_value = excluded.likert_value, answered_at = now();

  update public.research_survey_responses set updated_at = now() where id = p_response_id;

  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.submit_survey_answer(uuid, uuid, uuid, integer) to authenticated;

/** Finalizes a survey response: requires every question answered, marks it completed, then flips every attendance_records row this scholar was holding open for this survey to 'present' — all inside one transaction, with row locks guarding against a concurrent redemption of a different code for the same activity. */
create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype;
  v_question_count integer; v_answer_count integer; v_finalized_count integer := 0;
  v_rec record; v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can submit surveys.'; end if;

  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then
    return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0);
  end if;

  select count(*) into v_question_count from public.research_survey_questions where survey_id = v_response.survey_id;
  select count(distinct question_id) into v_answer_count from public.research_survey_answers where response_id = p_response_id;
  if v_answer_count < v_question_count then
    raise exception 'Please answer every question before submitting.';
  end if;

  update public.research_survey_responses set status = 'completed', submitted_at = now(), updated_at = now() where id = p_response_id;

  for v_rec in
    select * from public.attendance_records where scholar_id_number = v_scholar.scholar_id_number and pending_survey_id = v_response.survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (v_scholar.id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;
    v_finalized_count := v_finalized_count + 1;
  end loop;

  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;

  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;
grant execute on function public.submit_survey_response(uuid) to authenticated;
