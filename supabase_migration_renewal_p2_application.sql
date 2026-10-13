-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p2_application.sql
-- Scholar Renewal System, Phase 2: online application, the renewal rules, and the evaluator's board.
-- Run AFTER supabase_migration_renewal_p1_foundations.sql. Additive and safe to run twice: new tables, new functions, one new
-- private storage folder. Nothing existing is deleted or overwritten.
--
-- What this adds
--   1. A new staff tool tag key, "scholar_renewal_evaluator" (granted from the Staff Accounts page like the others).
--   2. renewal_windows           the evaluator opens a window per term (start and end date).
--   3. renewal_records           one per scholar per term: the stage, the rule applied, the evaluator's decision.
--      renewal_history           every stage change: who, when, a note.
--      renewal_documents         study plan / INC letter / prospectus (private folder "renewal-documents").
--      renewal_inc_items         one per INC subject, with the deadline and its extension history.
--      scholar_notifications     the scholar's in-portal notifications (the bell); push comes in a later phase.
--   4. _renewal_evaluate()       THE renewal rules, in one place. Everything else asks it.
--   5. Automatic re-checks       when a school submits, grades change, SDP credits change, or a document is added.
--   6. Scholar and evaluator functions (apply, flag a problem, confirm, return, accept/decline late, INC decisions …).
-- ─────────────────────────────────────────────────────────────

-- ── 1. Who may do what ──────────────────────────────────────
create or replace function public.is_renewal_evaluator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'scholar_renewal_evaluator');
$$;
grant execute on function public.is_renewal_evaluator() to authenticated;

-- Staff who may READ renewal records: the evaluator, consultation staff (they consult), the Division Head (they decide).
create or replace function public.can_view_renewals()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key in ('scholar_renewal_evaluator', 'scholar_counseling', 'sead_division_head')
  );
$$;
grant execute on function public.can_view_renewals() to authenticated;

-- ── 2. Tables ───────────────────────────────────────────────
create table if not exists public.renewal_windows (
  id            uuid primary key default gen_random_uuid(),
  school_year   text not null,
  term          text not null check (term in ('1st Semester', '2nd Semester', 'Summer')),
  opens_on      date not null,
  closes_on     date not null,
  -- After the window closes a scholar may still apply; it goes to the "Late - needs evaluator acceptance" list. Switch off to refuse.
  late_allowed  boolean not null default true,
  note          text not null default '',
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (school_year, term),
  check (closes_on >= opens_on)
);
alter table public.renewal_windows enable row level security;
drop policy if exists "signed in users read renewal windows" on public.renewal_windows;
create policy "signed in users read renewal windows" on public.renewal_windows for select using (auth.uid() is not null);
-- No write policy: windows are saved through renewal_window_save().

create table if not exists public.renewal_records (
  id                     uuid primary key default gen_random_uuid(),
  scholar_id_number      text not null references public.scholars(scholar_id_number) on delete cascade,
  school_year            text not null,
  term                   text not null check (term in ('1st Semester', '2nd Semester', 'Summer')),
  window_id              uuid references public.renewal_windows(id) on delete set null,
  stage                  text not null check (stage in (
    'submitted', 'late_pending', 'late_declined', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation',
    'ready_to_endorse', 'endorsed_division_head', 'needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements',
    'returned', 'renewed', 'removed', 'reconsidered', 'not_required')),
  -- The semester whose grades and SDP are checked for this term (1st Sem <- previous 2nd Sem; 2nd Sem <- same year 1st Sem; Summer <- same year 2nd Sem).
  basis_school_year      text,
  basis_term             text,
  applied_at             timestamptz,
  is_late                boolean not null default false,
  late_decision          text check (late_decision in ('pending', 'accepted', 'declined')),
  late_reason            text,
  -- Details the scholar confirmed when applying.
  confirmed_school       text,
  confirmed_program      text,
  confirmed_year_level   text,
  scholar_note           text not null default '',
  scholar_note_at        timestamptz,
  rule_code              text,
  rule_text              text,
  evaluation             jsonb not null default '{}'::jsonb,
  consultation_required  boolean not null default false,
  consultation_done_at   timestamptz,         -- set by the appointment system (next phase)
  hard_copy_received_at  timestamptz,         -- Summer: prospectus hard copy received at the consultation (next phase)
  no_show_flag           boolean not null default false,
  -- Temporary (INC) probation placed by this record, so it can be lifted again.
  temp_probation         boolean not null default false,
  temp_previous_status   text,
  evaluator_comment      text,
  returned_at            timestamptz,
  confirmed_at           timestamptz,
  confirmed_by           uuid references public.users(id) on delete set null,
  result                 text check (result in ('renewed', 'renewed_probationary', 'removed', 'reconsidered')),
  not_required_reason    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (scholar_id_number, school_year, term)
);
create index if not exists renewal_records_term_idx on public.renewal_records (school_year, term, stage);
alter table public.renewal_records enable row level security;
drop policy if exists "scholar reads own renewal records" on public.renewal_records;
create policy "scholar reads own renewal records" on public.renewal_records for select
  using (scholar_id_number = public.current_scholar_id_number());
drop policy if exists "staff read renewal records" on public.renewal_records;
create policy "staff read renewal records" on public.renewal_records for select using (public.can_view_renewals());

create table if not exists public.renewal_history (
  id          uuid primary key default gen_random_uuid(),
  record_id   uuid not null references public.renewal_records(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  actor_id    uuid references public.users(id) on delete set null,
  actor_label text not null default 'System',
  note        text not null default '',
  at          timestamptz not null default now()
);
create index if not exists renewal_history_record_idx on public.renewal_history (record_id, at);
alter table public.renewal_history enable row level security;
drop policy if exists "scholar reads own renewal history" on public.renewal_history;
create policy "scholar reads own renewal history" on public.renewal_history for select
  using (exists (select 1 from public.renewal_records r where r.id = record_id and r.scholar_id_number = public.current_scholar_id_number()));
drop policy if exists "staff read renewal history" on public.renewal_history;
create policy "staff read renewal history" on public.renewal_history for select using (public.can_view_renewals());

create table if not exists public.renewal_documents (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null references public.renewal_records(id) on delete cascade,
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  kind              text not null check (kind in ('study_plan', 'inc_letter', 'prospectus')),
  storage_path      text not null unique,
  file_name         text not null,
  mime_type         text not null,
  size_bytes        bigint not null default 0,
  status            text not null default 'submitted' check (status in ('submitted', 'accepted', 'returned')),
  reviewer_comment  text,
  reviewed_by       uuid references public.users(id) on delete set null,
  reviewed_at       timestamptz,
  uploaded_at       timestamptz not null default now()
);
create index if not exists renewal_documents_record_idx on public.renewal_documents (record_id, kind);
alter table public.renewal_documents enable row level security;
drop policy if exists "scholar reads own renewal documents" on public.renewal_documents;
create policy "scholar reads own renewal documents" on public.renewal_documents for select
  using (scholar_id_number = public.current_scholar_id_number());
drop policy if exists "scholar adds own renewal documents" on public.renewal_documents;
create policy "scholar adds own renewal documents" on public.renewal_documents for insert
  with check (scholar_id_number = public.current_scholar_id_number());
drop policy if exists "scholar removes own renewal documents" on public.renewal_documents;
create policy "scholar removes own renewal documents" on public.renewal_documents for delete
  using (scholar_id_number = public.current_scholar_id_number() and status in ('submitted', 'returned'));
drop policy if exists "staff read renewal documents" on public.renewal_documents;
create policy "staff read renewal documents" on public.renewal_documents for select using (public.can_view_renewals());

create table if not exists public.renewal_inc_items (
  id                 uuid primary key default gen_random_uuid(),
  record_id          uuid not null references public.renewal_records(id) on delete cascade,
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  subject_code       text not null,
  subject            text not null,
  -- open | resolved_passed | resolved_failed | counted_failed (evaluator) | decided (evaluator chose another action)
  state              text not null default 'open' check (state in ('open', 'resolved_passed', 'resolved_failed', 'counted_failed', 'decided')),
  consultation_date  date,
  days_given         integer check (days_given is null or days_given > 0),
  deadline           date,
  decision           text,
  decision_reason    text,
  decided_by         uuid references public.users(id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (record_id, subject_code)
);
create index if not exists renewal_inc_items_scholar_idx on public.renewal_inc_items (scholar_id_number, state);
alter table public.renewal_inc_items enable row level security;
drop policy if exists "scholar reads own inc items" on public.renewal_inc_items;
create policy "scholar reads own inc items" on public.renewal_inc_items for select using (scholar_id_number = public.current_scholar_id_number());
drop policy if exists "staff read inc items" on public.renewal_inc_items;
create policy "staff read inc items" on public.renewal_inc_items for select using (public.can_view_renewals());

create table if not exists public.renewal_inc_extensions (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.renewal_inc_items(id) on delete cascade,
  old_deadline  date,
  new_deadline  date not null,
  reason        text not null,
  changed_by    uuid references public.users(id) on delete set null,
  changed_by_label text not null default '',
  changed_at    timestamptz not null default now()
);
alter table public.renewal_inc_extensions enable row level security;
drop policy if exists "scholar reads own inc extensions" on public.renewal_inc_extensions;
create policy "scholar reads own inc extensions" on public.renewal_inc_extensions for select
  using (exists (select 1 from public.renewal_inc_items i where i.id = item_id and i.scholar_id_number = public.current_scholar_id_number()));
drop policy if exists "staff read inc extensions" on public.renewal_inc_extensions;
create policy "staff read inc extensions" on public.renewal_inc_extensions for select using (public.can_view_renewals());

create table if not exists public.scholar_notifications (
  id                uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  kind              text not null,
  title             text not null,
  body              text not null default '',
  record_id         uuid references public.renewal_records(id) on delete set null,
  created_at        timestamptz not null default now(),
  read_at           timestamptz
);
create index if not exists scholar_notifications_scholar_idx on public.scholar_notifications (scholar_id_number, created_at desc);
alter table public.scholar_notifications enable row level security;
drop policy if exists "scholar reads own notifications" on public.scholar_notifications;
create policy "scholar reads own notifications" on public.scholar_notifications for select using (scholar_id_number = public.current_scholar_id_number());
-- Marking as read goes through scholar_notifications_mark_read(); there is no update policy.

-- ── 3. Small helpers ────────────────────────────────────────
create or replace function public._actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Staff')
  from public.users u where u.id = auth.uid();
$$;
revoke all on function public._actor_name() from public, anon, authenticated;

-- The semester whose grades and SDP are checked for a renewal of (year, term).
create or replace function public._renewal_basis(p_school_year text, p_term text)
returns table(basis_school_year text, basis_term text)
language plpgsql
immutable
as $$
declare
  v_a integer;
  v_b integer;
begin
  if p_term = '1st Semester' then
    v_a := nullif(split_part(p_school_year, '-', 1), '')::integer;
    v_b := nullif(split_part(p_school_year, '-', 2), '')::integer;
    return query select ((v_a - 1) || '-' || (v_b - 1))::text, '2nd Semester'::text;
  elsif p_term = '2nd Semester' then
    return query select p_school_year, '1st Semester'::text;
  else
    return query select p_school_year, '2nd Semester'::text;
  end if;
end;
$$;
revoke all on function public._renewal_basis(text, text) from public, anon, authenticated;

create or replace function public._notify_scholar(p_scholar_id_number text, p_kind text, p_title text, p_body text, p_record_id uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scholar_notifications (scholar_id_number, kind, title, body, record_id)
  values (p_scholar_id_number, p_kind, p_title, coalesce(p_body, ''), p_record_id);
$$;
revoke all on function public._notify_scholar(text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._renewal_log(p_record_id uuid, p_from text, p_to text, p_note text, p_label text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.renewal_history (record_id, from_stage, to_stage, actor_id, actor_label, note)
  values (p_record_id, p_from, p_to, (select u.id from public.users u where u.id = auth.uid()),
          coalesce(p_label, case when auth.uid() is null then 'System' else public._actor_name() end), coalesce(p_note, ''));
$$;
revoke all on function public._renewal_log(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public._renewal_term_label(p_school_year text, p_term text)
returns text
language sql
immutable
as $$ select p_term || ' ' || p_school_year; $$;
revoke all on function public._renewal_term_label(text, text) from public, anon, authenticated;

-- ── 4. THE RULES: _renewal_evaluate ─────────────────────────
-- One function decides everything about a renewal case. It only READS (never writes); callers store or show its answer.
-- Returned JSON (the parts the website shows): basis, sdp, grades, previous_probation, rule_code, rule_text, stage, required_documents,
-- consultation_required, consultation_done, open_inc, failed_effective, reason.
create or replace function public._renewal_evaluate(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scholar public.scholars%rowtype;
  v_rec public.renewal_records%rowtype;
  v_b_year text;
  v_b_term text;
  v_summer boolean := (p_term = 'Summer');
  v_sdp record;
  v_sdp_json jsonb := jsonb_build_object('applicable', not v_summer, 'complied', null, 'missing', null);
  v_sdp_ok boolean := true;
  v_period_id uuid;
  v_submitted boolean := false;
  v_state text := 'ready';
  v_reason text := '';
  v_total integer := 0;  v_passed integer := 0;  v_failed integer := 0;  v_drp integer := 0;  v_inc integer := 0;
  v_review integer := 0; v_ungraded integer := 0; v_nopm integer := 0;
  v_failed_list jsonb := '[]'::jsonb;  v_inc_list jsonb := '[]'::jsonb;  v_review_list jsonb := '[]'::jsonb;
  g record;
  v_outcome text;
  v_school uuid;
  v_item public.renewal_inc_items%rowtype;
  v_counted_failed integer := 0;
  v_inc_open integer := 0;
  v_inc_open_without_deadline integer := 0;
  v_inc_overdue integer := 0;
  v_prev boolean;
  v_failed_eff integer;
  v_c boolean;
  v_b boolean;
  v_docs jsonb := '[]'::jsonb;
  v_need_study boolean := false;
  v_need_inc boolean := false;
  v_docs_complete boolean := true;
  v_study_have integer := 0;  v_inc_have integer := 0;  v_prosp_have integer := 0;
  v_consult_done boolean := false;
  v_hard_copy boolean := false;
  v_consult_required boolean := false;
  v_stage text;
  v_code text;
  v_text text;
begin
  select * into v_scholar from public.scholars where scholar_id_number = p_scholar_id_number;
  if not found then return jsonb_build_object('error', 'Scholar not found.'); end if;
  select * into v_rec from public.renewal_records where scholar_id_number = p_scholar_id_number and school_year = p_school_year and term = p_term;

  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_prev := public.scholar_had_regular_probation(p_scholar_id_number);

  -- SDP (1st and 2nd Semester only), checked for the basis semester.
  if not v_summer then
    select * into v_sdp from public._sdp_compliance(v_b_year, v_b_term, p_scholar_id_number) limit 1;
    if found then
      v_sdp_ok := coalesce(v_sdp.complied, false);
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', v_sdp.complied, 'missing', v_sdp.missing,
        'community_service', v_sdp.community_service, 'community_volunteerism', v_sdp.community_volunteerism, 'formation_program', v_sdp.formation_program);
    else
      v_sdp_ok := false;
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', false, 'missing', 'No SDP record found');
    end if;
  end if;

  -- Grades for the basis semester: has the school submitted it?
  select p.id into v_period_id from public.academic_periods p where p.school_year = v_b_year and p.term = v_b_term;
  if v_scholar.school_id is null then
    v_state := 'review'; v_reason := 'The scholar is not linked to a school.';
  else
    select exists (
      select 1 from public.school_period_submissions s
      where s.school_id = v_scholar.school_id and s.period_id = v_period_id and s.status = 'submitted'
    ) into v_submitted;
    if not v_submitted then
      v_state := 'waiting';
      v_reason := 'Your school has not submitted its grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.';
    end if;
  end if;

  if v_state = 'ready' or v_state = 'waiting' then
    for g in
      select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id
      from public.scholar_subjects_grades r
      where r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term
      order by r.subject_code, r.subject
    loop
      v_school := coalesce(g.recorded_by_school_id, v_scholar.school_id);
      v_outcome := public._grade_outcome(v_school, g.grade);
      v_total := v_total + 1;
      if v_outcome = 'passed' then v_passed := v_passed + 1;
      elsif v_outcome = 'failed' or v_outcome = 'drp' then
        v_failed := v_failed + 1; if v_outcome = 'drp' then v_drp := v_drp + 1; end if;
        v_failed_list := v_failed_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      elsif v_outcome = 'inc' then
        v_inc := v_inc + 1;
        v_item := null;
        if v_rec.id is not null then
          select * into v_item from public.renewal_inc_items i where i.record_id = v_rec.id and i.subject_code = g.subject_code;
        end if;
        v_inc_list := v_inc_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade,
          'state', coalesce(v_item.state, 'open'), 'deadline', v_item.deadline, 'item_id', v_item.id));
        if coalesce(v_item.state, 'open') = 'counted_failed' then v_counted_failed := v_counted_failed + 1;
        elsif coalesce(v_item.state, 'open') = 'open' then
          v_inc_open := v_inc_open + 1;
          if v_item.deadline is null then v_inc_open_without_deadline := v_inc_open_without_deadline + 1;
          elsif v_item.deadline < (now() at time zone 'Asia/Manila')::date then v_inc_overdue := v_inc_overdue + 1; end if;
        end if;
      elsif v_outcome = 'ungraded' then v_ungraded := v_ungraded + 1;
      else
        v_review := v_review + 1; if v_outcome = 'no_passing_mark' then v_nopm := v_nopm + 1; end if;
        v_review_list := v_review_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      end if;
    end loop;

    if v_state = 'ready' then
      if v_total = 0 then
        v_state := 'no_grades'; v_reason := 'No grades are recorded for ' || public._renewal_term_label(v_b_year, v_b_term) || '.';
      elsif v_ungraded > 0 then
        v_state := 'waiting'; v_reason := 'Some grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are still blank.';
      elsif v_nopm > 0 then
        v_state := 'review'; v_reason := 'The school has not set its passing mark, so the grades cannot be judged yet.';
      elsif v_review > 0 then
        v_state := 'review'; v_reason := 'Some marks cannot be read as passed or failed and need the evaluator''s review.';
      end if;
    end if;
  end if;

  v_failed_eff := v_failed + v_counted_failed;
  v_c := (v_failed_eff >= 2) or (v_failed_eff = 1 and v_prev);
  v_b := (v_failed_eff = 1 and not v_prev);
  v_consult_done := v_rec.consultation_done_at is not null;
  v_hard_copy := v_rec.hard_copy_received_at is not null;

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    v_need_study := v_b;
    v_need_inc := v_inc_open > 0;
  end if;
  if v_rec.id is not null then
    select count(*) filter (where d.kind = 'study_plan'), count(*) filter (where d.kind = 'inc_letter'), count(*) filter (where d.kind = 'prospectus')
      into v_study_have, v_inc_have, v_prosp_have
    from public.renewal_documents d where d.record_id = v_rec.id and d.status <> 'returned';
  end if;
  if v_need_study then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'study_plan', 'label', 'Study plan', 'satisfied', v_study_have > 0));
    if v_study_have = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_inc then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'inc_letter', 'label', 'INC letter from your dean', 'satisfied', v_inc_have > 0));
    if v_inc_have = 0 then v_docs_complete := false; end if;
  end if;
  if v_summer then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'prospectus', 'label', 'Prospectus (bring the hard copy to your consultation)', 'satisfied', v_prosp_have > 0));
    if v_prosp_have = 0 then v_docs_complete := false; end if;
  end if;

  v_consult_required := (v_state = 'ready') and (v_failed_eff >= 1 or v_inc_open > 0 or v_summer);

  -- Rule code and plain-language text.
  if v_state = 'ready' then
    if v_c then v_code := case when v_failed_eff >= 2 then 'C2' else 'C1P' end;
      v_text := case when v_failed_eff >= 2
        then 'Two or more failed subjects: consultation, then the Division Head decides (Removed if approved).'
        else 'One failed subject and the scholar was on probation before: treated like two or more failed subjects — consultation, then the Division Head decides (Removed if approved).' end;
    elsif v_b then v_code := 'B';
      v_text := 'One failed subject and no previous probation: study plan and consultation, then the evaluator endorses the scholar for Probationary to the Division Head, who approves (Renewed as Probationary if approved).';
    elsif v_inc_open > 0 then v_code := 'D';
      v_text := 'Has an INC subject: INC letter from the dean, temporary probation and a consultation where staff set the days to comply. Decided after the INC is resolved.';
    else v_code := 'A';
      v_text := 'All subjects passed: no documents needed. The evaluator confirms the renewal.';
    end if;
    if v_inc_open > 0 and v_failed_eff >= 1 then
      v_code := v_code || '+D';
      v_text := v_text || ' The INC stays on temporary probation until it is resolved, then the case is re-checked.';
    end if;
    if v_summer then
      v_code := v_code || '+S';
      v_text := v_text || ' Summer: no SDP requirement; the prospectus and a face-to-face consultation (hard copy received) are always required before the evaluator confirms.';
    end if;
  end if;

  -- The stage.
  if not v_sdp_ok then
    v_stage := 'sdp_on_hold'; v_reason := coalesce(v_sdp_json ->> 'missing', 'SDP not complied');
    v_code := 'SDP_HOLD'; v_text := 'SDP is not complied: the application is on hold until the missing credits are recorded. It is re-checked automatically.';
  elsif v_state = 'waiting' then
    v_stage := 'waiting_grades'; v_code := 'WAITING'; v_text := 'Waiting for grades: re-checked automatically when the school submits.';
  elsif v_state in ('no_grades', 'review') then
    v_stage := 'review_needed'; v_code := 'REVIEW'; v_text := 'Needs the evaluator''s manual review: ' || v_reason;
  elsif v_c then v_stage := 'needs_consultation_division_head';
  elsif v_b then
    v_stage := case when v_docs_complete and v_consult_done and v_inc_open = 0 then 'ready_to_endorse' else 'needs_study_plan_consultation' end;
  elsif v_inc_open > 0 then
    v_stage := case when v_inc_open_without_deadline > 0 then 'needs_inc_letter_consultation'
                    when v_inc_overdue > 0 then 'inc_deadline_passed'
                    else 'inc_waiting_compliance' end;
  elsif v_summer then
    v_stage := case when v_docs_complete and v_consult_done and v_hard_copy then 'ready_for_confirmation' else 'summer_requirements' end;
  else
    v_stage := 'ready_for_confirmation';
  end if;

  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'sdp', v_sdp_json,
    'grades', jsonb_build_object(
      'state', v_state, 'school_submitted', v_submitted, 'reason', v_reason,
      'counts', jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_failed, 'drp', v_drp, 'inc', v_inc, 'review', v_review, 'ungraded', v_ungraded),
      'failed_subjects', v_failed_list, 'inc_subjects', v_inc_list, 'review_subjects', v_review_list),
    'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consultation_required', v_consult_required, 'consultation_done', v_consult_done);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

-- ── 5. Applying the rules to a stored record ────────────────
-- Stages the rules may move a record between automatically. Anything else (returned, renewed, removed, late …) is left alone.
create or replace function public._renewal_is_active_stage(p_stage text)
returns boolean
language sql
immutable
as $$
  select p_stage in ('submitted', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation', 'ready_to_endorse',
    'needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements');
$$;
revoke all on function public._renewal_is_active_stage(text) from public, anon, authenticated;

create or replace function public._renewal_set_status(p_scholar_id_number text, p_status text, p_temporary boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.status_source', 'renewal', true);
  perform set_config('app.status_temporary', case when p_temporary then 'true' else 'false' end, true);
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.scholars set status = p_status, updated_at = now() where scholar_id_number = p_scholar_id_number and status is distinct from p_status;
  if not found and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.status = p_status) then
    -- The status is already this one (for example temporary Probationary turned into regular Probationary): the trigger only fires on a
    -- change, so record the decision in the history by hand.
    insert into public.scholar_status_history (scholar_id_number, status, previous_status, is_temporary, school_year, term, changed_by, source, note)
    select p_scholar_id_number, p_status, p_status, p_temporary, gps.current_school_year, gps.current_semester,
           (select u.id from public.users u where u.id = auth.uid()), 'renewal', coalesce(p_note, '')
    from public.grading_period_settings gps where gps.id = true;
  end if;
  perform set_config('app.status_source', '', true);
  perform set_config('app.status_temporary', '', true);
  perform set_config('app.status_note', '', true);
end;
$$;
revoke all on function public._renewal_set_status(text, text, boolean, text) from public, anon, authenticated;

create or replace function public._renewal_stage_title(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'submitted' then 'Application submitted'
    when 'late_pending' then 'Late — needs evaluator acceptance'
    when 'late_declined' then 'Late application declined'
    when 'sdp_on_hold' then 'On hold — SDP not complied'
    when 'waiting_grades' then 'Waiting for grades'
    when 'review_needed' then 'Needs evaluator review'
    when 'ready_for_confirmation' then 'Ready for evaluator confirmation'
    when 'ready_to_endorse' then 'Ready to endorse to the Division Head'
    when 'endorsed_division_head' then 'Endorsed — waiting for the Division Head'
    when 'needs_study_plan_consultation' then 'Needs study plan and consultation'
    when 'needs_consultation_division_head' then 'Needs consultation and Division Head decision'
    when 'needs_inc_letter_consultation' then 'Needs INC letter and consultation'
    when 'inc_waiting_compliance' then 'Temporary probation — waiting for INC compliance'
    when 'inc_deadline_passed' then 'INC deadline passed — decision needed'
    when 'summer_requirements' then 'Summer: prospectus and consultation needed'
    when 'returned' then 'Returned with comments'
    when 'renewed' then 'Renewed'
    when 'removed' then 'Removed'
    when 'reconsidered' then 'Reconsidered'
    when 'not_required' then 'Not required this term'
    else p_stage end;
$$;
revoke all on function public._renewal_stage_title(text) from public, anon, authenticated;

-- Re-runs the rules for one record, saves the answer, keeps the INC items and temporary probation in step, and tells the scholar
-- when something changed that they need to know about. Called by the triggers and by the functions below.
create or replace function public._renewal_recheck(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_old_stage text;
  v_new_stage text;
  v_term_label text;
  v_item jsonb;
  v_state text;
  v_outcome text;
  v_old_docs text[];
  v_new_docs text[];
  v_doc text;
  v_labels text;
  v_inc_open integer;
  v_scholar public.scholars%rowtype;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or not public._renewal_is_active_stage(v_rec.stage) then return; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_rec.scholar_id_number;

  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' then return; end if;
  v_old_stage := v_rec.stage;
  v_new_stage := v_ev ->> 'stage';
  v_term_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- INC items: one per INC subject; settled when the school enters the completed grade.
  for v_item in select * from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') loop
    insert into public.renewal_inc_items (record_id, scholar_id_number, subject_code, subject)
    values (v_rec.id, v_rec.scholar_id_number, v_item ->> 'code', v_item ->> 'subject')
    on conflict (record_id, subject_code) do nothing;
  end loop;
  for v_item in
    select jsonb_build_object('id', i.id, 'code', i.subject_code) from public.renewal_inc_items i
    where i.record_id = v_rec.id and i.state = 'open'
      and not exists (select 1 from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') s where s ->> 'code' = i.subject_code)
  loop
    select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome
    from public.scholar_subjects_grades g
    where g.scholar_id_number = v_rec.scholar_id_number and g.school_year = v_ev ->> 'basis_school_year'
      and g.semester = v_ev ->> 'basis_term' and g.subject_code = v_item ->> 'code'
    order by g.updated_at desc limit 1;
    v_state := case v_outcome when 'passed' then 'resolved_passed' when 'failed' then 'resolved_failed' when 'drp' then 'resolved_failed' else null end;
    if v_state is not null then
      update public.renewal_inc_items set state = v_state, updated_at = now() where id = (v_item ->> 'id')::uuid;
      perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage,
        'INC in ' || (v_item ->> 'code') || ' resolved with a ' || case when v_state = 'resolved_passed' then 'passing' else 'failing' end || ' grade.', 'System');
    end if;
  end loop;

  -- Temporary probation while an INC is open; lifted when none is left open.
  select count(*) into v_inc_open from public.renewal_inc_items i where i.record_id = v_rec.id and i.state = 'open';
  if v_inc_open > 0 and not v_rec.temp_probation and v_scholar.status in ('Regular', 'Reconsidered') and v_new_stage <> 'sdp_on_hold' and v_new_stage <> 'waiting_grades' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', true, 'Temporary probation while an INC is open (renewal ' || v_term_label || ').');
    update public.renewal_records set temp_probation = true, temp_previous_status = v_scholar.status where id = v_rec.id;
    v_rec.temp_probation := true; v_rec.temp_previous_status := v_scholar.status;
  elsif v_inc_open = 0 and v_rec.temp_probation then
    if exists (select 1 from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number and s.status = 'Probationary') then
      perform public._renewal_set_status(v_rec.scholar_id_number, coalesce(v_rec.temp_previous_status, 'Regular'), false, 'Temporary INC probation lifted (renewal ' || v_term_label || ').');
    end if;
    update public.renewal_records set temp_probation = false where id = v_rec.id;
    v_rec.temp_probation := false;
  end if;

  update public.renewal_records set
    stage = v_new_stage, evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text',
    basis_school_year = v_ev ->> 'basis_school_year', basis_term = v_ev ->> 'basis_term',
    consultation_required = coalesce((v_ev ->> 'consultation_required')::boolean, false), updated_at = now()
  where id = v_rec.id;

  if v_new_stage is distinct from v_old_stage then
    perform public._renewal_log(v_rec.id, v_old_stage, v_new_stage,
      case v_new_stage
        when 'sdp_on_hold' then 'On hold: ' || coalesce(v_ev ->> 'reason', '')
        when 'waiting_grades' then v_ev ->> 'reason'
        when 'review_needed' then v_ev ->> 'reason'
        else coalesce(v_ev ->> 'rule_text', '') end, 'System');
    if v_new_stage = 'sdp_on_hold' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Your renewal is on hold',
        'Your SDP credits for ' || public._renewal_term_label(v_ev ->> 'basis_school_year', v_ev ->> 'basis_term') || ' are not complete yet: ' || coalesce(v_ev ->> 'reason', '') || '. We will check again automatically when new credits are recorded.', v_rec.id);
    elsif v_new_stage = 'waiting_grades' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Waiting for your grades',
        coalesce(v_ev ->> 'reason', '') || ' We will check again automatically when they are submitted.', v_rec.id);
    elsif v_new_stage in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements') then
      perform public._notify_scholar(v_rec.scholar_id_number, 'consultation_needed', 'A consultation is needed for your renewal',
        'Please see what is needed in your Renewal tile. ' || coalesce(v_ev ->> 'rule_text', ''), v_rec.id);
    elsif v_new_stage = 'ready_to_endorse' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will review your case and send it to the Division Head for approval.', v_rec.id);
    elsif v_new_stage = 'ready_for_confirmation' and v_old_stage <> 'submitted' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will confirm your renewal for ' || v_term_label || '.', v_rec.id);
    elsif v_new_stage = 'inc_deadline_passed' then
      null;
    end if;
  end if;

  -- A new document became necessary after the scholar had already applied.
  if v_rec.evaluation <> '{}'::jsonb then
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_old_docs from jsonb_array_elements(v_rec.evaluation -> 'required_documents') d;
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_new_docs from jsonb_array_elements(v_ev -> 'required_documents') d;
    v_labels := null;
    foreach v_doc in array v_new_docs loop
      if not (v_doc = any (v_old_docs)) then
        v_labels := concat_ws(', ', v_labels, (select d ->> 'label' from jsonb_array_elements(v_ev -> 'required_documents') d where d ->> 'kind' = v_doc limit 1));
      end if;
    end loop;
    if v_labels is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'A new document is needed', 'Please upload: ' || v_labels || '.', v_rec.id);
    end if;
  end if;
end;
$$;
revoke all on function public._renewal_recheck(uuid) from public, anon, authenticated;

create or replace function public._renewal_recheck_scholar(p_scholar_id_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.renewal_records where scholar_id_number = p_scholar_id_number loop
    perform public._renewal_recheck(r.id);
  end loop;
end;
$$;
revoke all on function public._renewal_recheck_scholar(text) from public, anon, authenticated;

-- ── 6. Automatic re-checks ──────────────────────────────────
create or replace function public._renewal_trg_scholar_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public._renewal_recheck_scholar(old.scholar_id_number);
  else
    perform public._renewal_recheck_scholar(new.scholar_id_number);
    if tg_op = 'UPDATE' and old.scholar_id_number is distinct from new.scholar_id_number then
      perform public._renewal_recheck_scholar(old.scholar_id_number);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists renewal_recheck_on_grades on public.scholar_subjects_grades;
create trigger renewal_recheck_on_grades after insert or update or delete on public.scholar_subjects_grades
  for each row execute function public._renewal_trg_scholar_rows();
drop trigger if exists renewal_recheck_on_sdp_attendance on public.sdp_attendance;
create trigger renewal_recheck_on_sdp_attendance after insert or update or delete on public.sdp_attendance
  for each row execute function public._renewal_trg_scholar_rows();
drop trigger if exists renewal_recheck_on_sdp_reserved on public.sdp_reserved_credits;
create trigger renewal_recheck_on_sdp_reserved after insert or update or delete on public.sdp_reserved_credits
  for each row execute function public._renewal_trg_scholar_rows();

-- A school submits (or CEDO reopens) a period: re-check every active record whose basis semester is that period, for that school's scholars.
create or replace function public._renewal_trg_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select rr.id
    from public.renewal_records rr
    join public.scholars s on s.scholar_id_number = rr.scholar_id_number
    join public.academic_periods p on p.id = new.period_id
    where s.school_id = new.school_id and rr.basis_school_year = p.school_year and rr.basis_term = p.term
  loop
    perform public._renewal_recheck(r.id);
  end loop;
  return null;
end;
$$;
drop trigger if exists renewal_recheck_on_submission on public.school_period_submissions;
create trigger renewal_recheck_on_submission after insert or update on public.school_period_submissions
  for each row execute function public._renewal_trg_submission();

create or replace function public._renewal_trg_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._renewal_recheck(coalesce(new.record_id, old.record_id));
  return null;
end;
$$;
drop trigger if exists renewal_recheck_on_documents on public.renewal_documents;
create trigger renewal_recheck_on_documents after insert or update or delete on public.renewal_documents
  for each row execute function public._renewal_trg_documents();

-- Friendly, enforced rules for a scholar adding a document.
create or replace function public._renewal_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_required boolean;
begin
  select * into v_rec from public.renewal_records where id = new.record_id;
  if not found or v_rec.scholar_id_number <> new.scholar_id_number then
    raise exception 'That renewal application was not found.';
  end if;
  if new.scholar_id_number is distinct from public.current_scholar_id_number() and public.current_scholar_id_number() is not null then
    raise exception 'You can only add documents to your own application.';
  end if;
  if not public._renewal_is_active_stage(v_rec.stage) and v_rec.stage <> 'returned' then
    raise exception 'This application is closed, so documents can no longer be added.';
  end if;
  if new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'Only PDF, Word, JPG, PNG or WebP files can be uploaded.';
  end if;
  if new.size_bytes > 10485760 then raise exception 'Files can be at most 10 MB.'; end if;
  if new.storage_path not like (new.scholar_id_number || '/' || new.record_id::text || '/' || new.kind || '/%') then
    raise exception 'The file is not stored in your folder for this application.';
  end if;
  select exists (select 1 from jsonb_array_elements(coalesce(v_rec.evaluation -> 'required_documents', '[]'::jsonb)) d where d ->> 'kind' = new.kind) into v_required;
  if not v_required then
    raise exception 'That document is not needed for your case right now.';
  end if;
  if (select count(*) from public.renewal_documents d where d.record_id = new.record_id and d.kind = new.kind) >= 3 then
    raise exception 'You can upload at most 3 files of each kind. Remove one first.';
  end if;
  return new;
end;
$$;
drop trigger if exists renewal_documents_guard on public.renewal_documents;
create trigger renewal_documents_guard before insert on public.renewal_documents
  for each row execute function public._renewal_documents_guard();

-- Private folder for renewal documents: <scholar id number>/<record id>/<kind>/<file>. A scholar reaches only their own folder;
-- renewal staff can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renewal-documents', 'renewal-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "scholar adds renewal documents" on storage.objects;
create policy "scholar adds renewal documents" on storage.objects for insert
  with check (bucket_id = 'renewal-documents' and (storage.foldername(name))[1] = public.current_scholar_id_number());
drop policy if exists "scholar or staff reads renewal documents" on storage.objects;
create policy "scholar or staff reads renewal documents" on storage.objects for select
  using (bucket_id = 'renewal-documents' and ((storage.foldername(name))[1] = public.current_scholar_id_number() or public.can_view_renewals()));
drop policy if exists "scholar removes own renewal documents" on storage.objects;
create policy "scholar removes own renewal documents" on storage.objects for delete
  using (bucket_id = 'renewal-documents' and (storage.foldername(name))[1] = public.current_scholar_id_number());

-- ── 7. Scholar functions ────────────────────────────────────
-- What the Renewal tile needs: the windows, and the scholar's own record in each.
create or replace function public.renewal_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_out jsonb := '[]'::jsonb;
  w record;
  v_rec public.renewal_records%rowtype;
  v_state text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  for w in
    select * from public.renewal_windows
    where opens_on <= v_today + 14 or exists (select 1 from public.renewal_records r where r.window_id = renewal_windows.id and r.scholar_id_number = v_id)
    order by opens_on desc limit 6
  loop
    select * into v_rec from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term;
    v_state := case when v_today < w.opens_on then 'upcoming' when v_today <= w.closes_on then 'open'
                    when w.late_allowed then 'late' else 'closed' end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'window', to_jsonb(w), 'state', v_state,
      'record', case when v_rec.id is null then null else to_jsonb(v_rec) end,
      'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
      'inc_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.subject) from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb)));
  end loop;
  return jsonb_build_object(
    'scholar', jsonb_build_object('scholar_id_number', v_scholar.scholar_id_number, 'school', v_scholar.school, 'program', v_scholar.course, 'year_level', v_scholar.year_level, 'status', v_scholar.status),
    'windows', v_out);
end;
$$;
revoke all on function public.renewal_my_overview() from public, anon;
grant execute on function public.renewal_my_overview() to authenticated;

-- "What the system has for me": the SDP result and grades for the term, before (or after) applying. Writes nothing.
create or replace function public.renewal_my_preview(p_window_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  w public.renewal_windows%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  return public._renewal_evaluate(v_id, w.school_year, w.term);
end;
$$;
revoke all on function public.renewal_my_preview(uuid) from public, anon;
grant execute on function public.renewal_my_preview(uuid) to authenticated;

create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  w public.renewal_windows%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_rec public.renewal_records%rowtype;
  v_late boolean;
  v_record_id uuid;
  v_basis record;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  if v_scholar.status = 'Removed' then raise exception 'Your scholarship account is not active, so you cannot apply.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if v_today < w.opens_on then raise exception 'This renewal window opens on %.', to_char(w.opens_on, 'FMMonth FMDD, YYYY'); end if;
  v_late := v_today > w.closes_on;
  if v_late and not w.late_allowed then raise exception 'This renewal window has closed and is not accepting late applications.'; end if;
  if btrim(coalesce(p_school, '')) = '' or btrim(coalesce(p_program, '')) = '' or btrim(coalesce(p_year_level, '')) = '' then
    raise exception 'Please confirm your school, program and year level.';
  end if;

  select * into v_rec from public.renewal_records where scholar_id_number = v_id and school_year = w.school_year and term = w.term;
  if found then
    if v_rec.stage = 'returned' then
      return public.renewal_resubmit(v_rec.id, p_note);
    end if;
    raise exception 'You have already applied for % — see your Renewal tile for its progress.', public._renewal_term_label(w.school_year, w.term);
  end if;

  select * into v_basis from public._renewal_basis(w.school_year, w.term);
  insert into public.renewal_records (scholar_id_number, school_year, term, window_id, stage, basis_school_year, basis_term, applied_at, is_late, late_decision,
      confirmed_school, confirmed_program, confirmed_year_level, scholar_note, scholar_note_at)
  values (v_id, w.school_year, w.term, w.id, case when v_late then 'late_pending' else 'submitted' end, v_basis.basis_school_year, v_basis.basis_term, now(),
      v_late, case when v_late then 'pending' end, btrim(p_school), btrim(p_program), btrim(p_year_level),
      left(btrim(coalesce(p_note, '')), 1000), case when btrim(coalesce(p_note, '')) <> '' then now() end)
  returning id into v_record_id;

  perform public._renewal_log(v_record_id, null, case when v_late then 'late_pending' else 'submitted' end,
    case when v_late then 'Applied after the window closed — waiting for the evaluator to accept.' else 'Application submitted.' end, 'Scholar');
  perform public._notify_scholar(v_id, 'application_received', 'We received your renewal application',
    case when v_late then 'Your application for ' || public._renewal_term_label(w.school_year, w.term) || ' came after the window closed, so the evaluator needs to accept it first.'
         else 'We are checking your SDP and grades for ' || public._renewal_term_label(w.school_year, w.term) || '.' end, v_record_id);
  if not v_late then perform public._renewal_recheck(v_record_id); end if;
  return v_record_id;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text) to authenticated;

create or replace function public.renewal_resubmit(p_record_id uuid, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_rec public.renewal_records%rowtype;
begin
  select * into v_rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  if v_rec.stage <> 'returned' then raise exception 'This application was not returned to you.'; end if;
  update public.renewal_records set stage = 'submitted', returned_at = null,
    scholar_note = case when btrim(coalesce(p_note, '')) <> '' then left(btrim(p_note), 1000) else scholar_note end,
    scholar_note_at = case when btrim(coalesce(p_note, '')) <> '' then now() else scholar_note_at end, updated_at = now()
  where id = p_record_id;
  perform public._renewal_log(p_record_id, 'returned', 'submitted', 'Application resubmitted.', 'Scholar');
  perform public._renewal_recheck(p_record_id);
  return p_record_id;
end;
$$;
revoke all on function public.renewal_resubmit(uuid, text) from public, anon;
grant execute on function public.renewal_resubmit(uuid, text) to authenticated;

create or replace function public.renewal_flag_problem(p_record_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_rec public.renewal_records%rowtype;
begin
  select * into v_rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  if v_rec.stage in ('renewed', 'removed', 'reconsidered', 'late_declined', 'not_required') then raise exception 'This application is closed.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Please describe the problem (at least 5 characters).'; end if;
  update public.renewal_records set scholar_note = left(btrim(p_note), 1000), scholar_note_at = now(), updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, v_rec.stage, v_rec.stage, 'Scholar flagged a problem: ' || left(btrim(p_note), 300), 'Scholar');
end;
$$;
revoke all on function public.renewal_flag_problem(uuid, text) from public, anon;
grant execute on function public.renewal_flag_problem(uuid, text) to authenticated;

create or replace function public.scholar_notifications_list(p_limit integer default 30)
returns table(id uuid, kind text, title text, body text, record_id uuid, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.record_id, n.created_at, n.read_at
  from public.scholar_notifications n
  where n.scholar_id_number = public.current_scholar_id_number()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
revoke all on function public.scholar_notifications_list(integer) from public, anon;
grant execute on function public.scholar_notifications_list(integer) to authenticated;

create or replace function public.scholar_notifications_mark_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.scholar_notifications set read_at = now()
  where scholar_id_number = public.current_scholar_id_number() and read_at is null and (p_ids is null or id = any (p_ids));
$$;
revoke all on function public.scholar_notifications_mark_read(uuid[]) from public, anon;
grant execute on function public.scholar_notifications_mark_read(uuid[]) to authenticated;

-- ── 8. Evaluator functions ──────────────────────────────────
create or replace function public._renewal_require_evaluator()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can do this.'; end if;
end;
$$;
revoke all on function public._renewal_require_evaluator() from public, anon, authenticated;

create or replace function public.renewal_window_save(p_id uuid, p_school_year text, p_term text, p_opens_on date, p_closes_on date, p_late_allowed boolean, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._renewal_require_evaluator();
  if p_school_year !~ '^\d{4}-\d{4}$' then raise exception 'The school year must look like 2026-2027.'; end if;
  if p_term not in ('1st Semester', '2nd Semester', 'Summer') then raise exception 'Choose 1st Semester, 2nd Semester or Summer.'; end if;
  if p_opens_on is null or p_closes_on is null or p_closes_on < p_opens_on then raise exception 'The closing date cannot be before the opening date.'; end if;
  if p_id is null then
    if exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term) then
      raise exception 'There is already a renewal window for % — edit that one instead.', public._renewal_term_label(p_school_year, p_term);
    end if;
    insert into public.renewal_windows (school_year, term, opens_on, closes_on, late_allowed, note, created_by)
    values (p_school_year, p_term, p_opens_on, p_closes_on, coalesce(p_late_allowed, true), left(btrim(coalesce(p_note, '')), 500), auth.uid())
    returning id into v_id;
  else
    update public.renewal_windows set opens_on = p_opens_on, closes_on = p_closes_on, late_allowed = coalesce(p_late_allowed, true),
      note = left(btrim(coalesce(p_note, '')), 500), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That renewal window was not found.'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text) to authenticated;

create or replace function public.renewal_window_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._renewal_require_evaluator();
  if exists (select 1 from public.renewal_records r where r.window_id = p_id) then
    raise exception 'Scholars have already applied in this window, so it cannot be deleted.';
  end if;
  delete from public.renewal_windows where id = p_id;
end;
$$;
revoke all on function public.renewal_window_delete(uuid) from public, anon;
grant execute on function public.renewal_window_delete(uuid) to authenticated;

-- Internal: deadlines that have passed move the case to "decision needed" without waiting for a scheduler.
create or replace function public._renewal_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct i.record_id from public.renewal_inc_items i
    join public.renewal_records rr on rr.id = i.record_id
    where i.state = 'open' and i.deadline is not null and i.deadline < (now() at time zone 'Asia/Manila')::date and rr.stage = 'inc_waiting_compliance'
  loop
    perform public._renewal_recheck(r.record_id);
  end loop;
end;
$$;
revoke all on function public._renewal_sweep() from public, anon, authenticated;

create or replace function public.renewal_board(p_school_year text, p_term text)
returns table(
  record_id uuid, scholar_id_number text, name text, school text, program text, year_level text, stage text, is_late boolean, late_decision text,
  applied_at timestamptz, rule_code text, failed_count integer, inc_count integer, sdp_complied boolean, sdp_missing text,
  consultation_required boolean, consultation_done boolean, no_show_flag boolean, scholar_note text, updated_at timestamptz, result text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  perform public._renewal_sweep();
  return query
  select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school,
         coalesce(r.confirmed_program, s.course), coalesce(r.confirmed_year_level, s.year_level), r.stage, r.is_late, r.late_decision, r.applied_at, r.rule_code,
         coalesce((r.evaluation -> 'failed_effective')::text::integer, 0), coalesce((r.evaluation -> 'open_inc')::text::integer, 0),
         nullif(r.evaluation -> 'sdp' ->> 'complied', '')::boolean, r.evaluation -> 'sdp' ->> 'missing',
         r.consultation_required, r.consultation_done_at is not null, r.no_show_flag, r.scholar_note, r.updated_at, r.result
  from public.renewal_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term
  order by s.last_name, s.first_name;
end;
$$;
revoke all on function public.renewal_board(text, text) from public, anon;
grant execute on function public.renewal_board(text, text) to authenticated;

-- Scholars who have not applied for the term: not Removed, not On leave, and no record (a "not required" mark counts as a record).
create or replace function public.renewal_not_applied(p_school_year text, p_term text)
returns table(scholar_id_number text, name text, school text, program text, year_level text, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status
  from public.scholars s
  where s.status not in ('Removed', 'On leave')
    and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term)
  order by s.last_name, s.first_name;
end;
$$;
revoke all on function public.renewal_not_applied(text, text) from public, anon;
grant execute on function public.renewal_not_applied(text, text) to authenticated;

-- INC compliance list for a term: every open INC item, soonest deadline first (no deadline last).
create or replace function public.renewal_inc_list(p_school_year text, p_term text)
returns table(
  item_id uuid, record_id uuid, scholar_id_number text, name text, school text, subject_code text, subject text, state text,
  consultation_date date, days_given integer, deadline date, days_left integer, stage text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  perform public._renewal_sweep();
  return query
  select i.id, i.record_id, i.scholar_id_number, btrim(s.last_name || ', ' || s.first_name), s.school, i.subject_code, i.subject, i.state,
         i.consultation_date, i.days_given, i.deadline,
         case when i.deadline is null then null else (i.deadline - (now() at time zone 'Asia/Manila')::date) end, r.stage
  from public.renewal_inc_items i
  join public.renewal_records r on r.id = i.record_id
  join public.scholars s on s.scholar_id_number = i.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term and i.state = 'open'
  order by i.deadline nulls last, s.last_name;
end;
$$;
revoke all on function public.renewal_inc_list(text, text) from public, anon;
grant execute on function public.renewal_inc_list(text, text) to authenticated;

-- Everything the scholar detail page shows (staff).
create or replace function public.renewal_record_detail(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_s public.scholars%rowtype;
  v_fresh jsonb;
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal record was not found.'; end if;
  select * into v_s from public.scholars where scholar_id_number = v_rec.scholar_id_number;
  v_fresh := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  return jsonb_build_object(
    'record', to_jsonb(v_rec),
    'scholar', jsonb_build_object('scholar_id_number', v_s.scholar_id_number, 'name', btrim(v_s.last_name || ', ' || v_s.first_name || ' ' || coalesce(v_s.middle_name, '')),
        'school', v_s.school, 'program', v_s.course, 'year_level', v_s.year_level, 'status', v_s.status, 'contact_no', v_s.contact_no),
    'evaluation', v_fresh,
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'from_stage', h.from_stage, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
    'inc_items', coalesce((select jsonb_agg(jsonb_build_object('item', to_jsonb(i),
        'extensions', coalesce((select jsonb_agg(to_jsonb(x) order by x.changed_at) from public.renewal_inc_extensions x where x.item_id = i.id), '[]'::jsonb)) order by i.subject)
      from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
    'status_history', coalesce((select jsonb_agg(jsonb_build_object('status', h.status, 'previous_status', h.previous_status, 'is_temporary', h.is_temporary,
        'school_year', h.school_year, 'term', h.term, 'changed_at', h.changed_at, 'source', h.source, 'note', h.note) order by h.changed_at desc)
      from public.scholar_status_history h where h.scholar_id_number = v_rec.scholar_id_number), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_record_detail(uuid) from public, anon;
grant execute on function public.renewal_record_detail(uuid) to authenticated;

create or replace function public.renewal_confirm(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage = 'ready_to_endorse' then raise exception 'A case with a failed subject is endorsed to the Division Head, not confirmed by the evaluator.'; end if;
  if v_rec.stage <> 'ready_for_confirmation' then raise exception 'This renewal is not ready for confirmation yet (%).', public._renewal_stage_title(v_rec.stage); end if;
  -- Make sure the answer is still right at this moment.
  perform public._renewal_recheck(p_record_id);
  select * into v_rec from public.renewal_records where id = p_record_id;
  if v_rec.stage <> 'ready_for_confirmation' then raise exception 'Something changed just now: this renewal is now "%".', public._renewal_stage_title(v_rec.stage); end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  update public.renewal_records set stage = 'renewed', result = 'renewed',
    confirmed_at = now(), confirmed_by = auth.uid(), evaluator_comment = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_record_id;
  perform public._renewal_log(p_record_id, 'ready_for_confirmation', 'renewed',
    'Renewal confirmed.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end);
  perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
    'You are renewed for ' || v_label || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
end;
$$;
revoke all on function public.renewal_confirm(uuid, text) from public, anon;
grant execute on function public.renewal_confirm(uuid, text) to authenticated;

-- A "1 failed subject" case is NOT confirmed by the evaluator: once the study plan and the consultation are done, the evaluator
-- ENDORSES the scholar for Probationary to the Division Head, who approves (the Division Head's decision is built in a later phase).
create or replace function public.renewal_endorse(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'ready_to_endorse' then raise exception 'This case is not ready to be endorsed yet (%).', public._renewal_stage_title(v_rec.stage); end if;
  perform public._renewal_recheck(p_record_id);
  select * into v_rec from public.renewal_records where id = p_record_id;
  if v_rec.stage <> 'ready_to_endorse' then raise exception 'Something changed just now: this renewal is now "%".', public._renewal_stage_title(v_rec.stage); end if;
  update public.renewal_records set stage = 'endorsed_division_head', evaluator_comment = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, 'ready_to_endorse', 'endorsed_division_head',
    'Endorsed to the Division Head for Probationary approval.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end);
  perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your case was sent to the Division Head',
    'The evaluator endorsed you for Probationary and sent your case to the Division Head for approval. We will tell you the result.', p_record_id);
end;
$$;
revoke all on function public.renewal_endorse(uuid, text) from public, anon;
grant execute on function public.renewal_endorse(uuid, text) to authenticated;

create or replace function public.renewal_return(p_record_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_comment, ''))) < 5 then raise exception 'Please write a comment for the scholar (at least 5 characters).'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if not public._renewal_is_active_stage(v_rec.stage) then raise exception 'This application can no longer be returned (%).', public._renewal_stage_title(v_rec.stage); end if;
  update public.renewal_records set stage = 'returned', returned_at = now(), evaluator_comment = btrim(p_comment), updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, v_rec.stage, 'returned', 'Returned with comments: ' || btrim(p_comment));
  perform public._notify_scholar(v_rec.scholar_id_number, 'application_returned', 'Your renewal application was returned',
    'The evaluator wrote: ' || btrim(p_comment) || ' Please fix it and submit again from your Renewal tile.', p_record_id);
end;
$$;
revoke all on function public.renewal_return(uuid, text) from public, anon;
grant execute on function public.renewal_return(uuid, text) to authenticated;

create or replace function public.renewal_late_decide(p_record_id uuid, p_accept boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason.'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'late_pending' then raise exception 'This application is not waiting for a late-application decision.'; end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  if p_accept then
    update public.renewal_records set stage = 'submitted', late_decision = 'accepted', late_reason = btrim(p_reason), updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'late_pending', 'submitted', 'Late application accepted: ' || btrim(p_reason));
    perform public._notify_scholar(v_rec.scholar_id_number, 'late_accepted', 'Your late application was accepted',
      'Your application for ' || v_label || ' will now be checked like any other.', p_record_id);
    perform public._renewal_recheck(p_record_id);
  else
    update public.renewal_records set stage = 'late_declined', late_decision = 'declined', late_reason = btrim(p_reason), updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'late_pending', 'late_declined', 'Late application declined: ' || btrim(p_reason));
    perform public._notify_scholar(v_rec.scholar_id_number, 'late_declined', 'Your late application was declined',
      'The evaluator wrote: ' || btrim(p_reason) || ' Please contact the CEDO office if you have questions.', p_record_id);
  end if;
end;
$$;
revoke all on function public.renewal_late_decide(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_late_decide(uuid, boolean, text) to authenticated;

create or replace function public.renewal_mark_not_required(p_scholar_id_number text, p_school_year text, p_term text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_basis record;
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (for example "graduating").'; end if;
  if not exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  if exists (select 1 from public.renewal_records r where r.scholar_id_number = p_scholar_id_number and r.school_year = p_school_year and r.term = p_term) then
    raise exception 'This scholar already has a renewal record for that term.';
  end if;
  select * into v_basis from public._renewal_basis(p_school_year, p_term);
  insert into public.renewal_records (scholar_id_number, school_year, term, stage, basis_school_year, basis_term, not_required_reason)
  values (p_scholar_id_number, p_school_year, p_term, 'not_required', v_basis.basis_school_year, v_basis.basis_term, btrim(p_reason))
  returning id into v_id;
  perform public._renewal_log(v_id, null, 'not_required', 'Marked not required this term: ' || btrim(p_reason));
  return v_id;
end;
$$;
revoke all on function public.renewal_mark_not_required(text, text, text, text) from public, anon;
grant execute on function public.renewal_mark_not_required(text, text, text, text) to authenticated;

-- ── 9. INC deadline and the evaluator's decision after it passes ──
-- Used by the Daily Record in the Consultation Tool: ONLY consultation staff set (or change) an INC deadline. (After the deadline
-- has passed the evaluator can still extend it as a decision, see renewal_decide_inc.) Changing an existing deadline needs a reason;
-- the history of changes is kept.
create or replace function public.renewal_set_inc_deadline(p_item_id uuid, p_consultation_date date, p_days_given integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.renewal_inc_items%rowtype;
  v_new date;
  v_scholar text;
begin
  if not public.has_staff_tag('scholar_counseling') then
    raise exception 'Only consultation staff set the INC deadline (in the Daily Record of the consultation).';
  end if;
  select * into v_item from public.renewal_inc_items where id = p_item_id for update;
  if not found then raise exception 'That INC item was not found.'; end if;
  if v_item.state <> 'open' then raise exception 'This INC is already settled.'; end if;
  if p_days_given is null or p_days_given < 1 then raise exception 'The days given to comply must be at least 1.'; end if;
  if p_consultation_date is null then raise exception 'Please give the consultation date.'; end if;
  v_new := p_consultation_date + p_days_given;
  if v_item.deadline is not null and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A deadline already exists. Please give a reason for changing it.';
  end if;
  update public.renewal_inc_items set consultation_date = p_consultation_date, days_given = p_days_given, deadline = v_new, updated_at = now() where id = p_item_id;
  if v_item.deadline is not null then
    insert into public.renewal_inc_extensions (item_id, old_deadline, new_deadline, reason, changed_by, changed_by_label)
    values (p_item_id, v_item.deadline, v_new, btrim(p_reason), auth.uid(), public._actor_name());
  end if;
  update public.renewal_records set consultation_done_at = coalesce(consultation_done_at, p_consultation_date::timestamptz) where id = v_item.record_id;
  v_scholar := v_item.scholar_id_number;
  perform public._renewal_log(v_item.record_id, null, (select stage from public.renewal_records where id = v_item.record_id),
    case when v_item.deadline is null then 'INC deadline set for ' else 'INC deadline changed for ' end || v_item.subject || ' to ' || to_char(v_new, 'Mon DD, YYYY') || ' (' || p_days_given || ' days).');
  perform public._notify_scholar(v_scholar, case when v_item.deadline is null then 'inc_deadline_set' else 'deadline_extended' end,
    case when v_item.deadline is null then 'Your INC deadline is set' else 'Your INC deadline was changed' end,
    'Complete your INC in ' || v_item.subject || ' by ' || to_char(v_new, 'FMMonth FMDD, YYYY') || '.', v_item.record_id);
  perform public._renewal_recheck(v_item.record_id);
end;
$$;
revoke all on function public.renewal_set_inc_deadline(uuid, date, integer, text) from public, anon;
grant execute on function public.renewal_set_inc_deadline(uuid, date, integer, text) to authenticated;

-- The evaluator decides a case whose INC deadline has passed. A reason is required.
--   extend        -> new deadline
--   count_failed  -> the INC counts as a failed subject; the normal rules apply
--   set_status    -> change the scholar's status: 'Probationary' (counts as previous probation), 'Regular', or 'removal' (refer for removal)
--   other         -> another action, described in the notes
create or replace function public.renewal_decide_inc(p_item_id uuid, p_action text, p_reason text, p_new_deadline date default null, p_status text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.renewal_inc_items%rowtype;
  v_rec public.renewal_records%rowtype;
  v_label text;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason is required (at least 5 characters).'; end if;
  select * into v_item from public.renewal_inc_items where id = p_item_id for update;
  if not found then raise exception 'That INC item was not found.'; end if;
  if v_item.state <> 'open' then raise exception 'This INC is already settled.'; end if;
  select * into v_rec from public.renewal_records where id = v_item.record_id for update;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  if p_action = 'extend' then
    if p_new_deadline is null or p_new_deadline <= v_today then raise exception 'Choose a new deadline that is after today.'; end if;
    insert into public.renewal_inc_extensions (item_id, old_deadline, new_deadline, reason, changed_by, changed_by_label)
    values (p_item_id, v_item.deadline, p_new_deadline, btrim(p_reason), auth.uid(), public._actor_name());
    update public.renewal_inc_items set deadline = p_new_deadline, updated_at = now() where id = p_item_id;
    perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'INC deadline for ' || v_item.subject || ' extended to ' || to_char(p_new_deadline, 'Mon DD, YYYY') || ': ' || btrim(p_reason));
    perform public._notify_scholar(v_rec.scholar_id_number, 'deadline_extended', 'Your INC deadline was extended',
      'Complete your INC in ' || v_item.subject || ' by ' || to_char(p_new_deadline, 'FMMonth FMDD, YYYY') || '.', v_rec.id);
  elsif p_action = 'count_failed' then
    update public.renewal_inc_items set state = 'counted_failed', decision = 'count_failed', decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_item_id;
    perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Evaluator counted the INC in ' || v_item.subject || ' as a failed subject: ' || btrim(p_reason));
  elsif p_action = 'set_status' then
    if p_status not in ('Probationary', 'Regular', 'removal') then raise exception 'Choose Probationary, Regular or refer for removal.'; end if;
    update public.renewal_inc_items set state = 'decided', decision = 'set_status:' || p_status, decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_item_id;
    if p_status = 'removal' then
      -- Referred for removal: the case goes to the Division Head step (decided in a later phase).
      update public.renewal_records set stage = 'needs_consultation_division_head', temp_probation = false, updated_at = now() where id = v_rec.id;
      perform public._renewal_log(v_rec.id, v_rec.stage, 'needs_consultation_division_head', 'Evaluator referred the case for removal after the INC deadline passed: ' || btrim(p_reason));
    else
      -- The status given AFTER the compliance period is what counts: regular Probationary counts as previous probation, Regular does not.
      perform public._renewal_set_status(v_rec.scholar_id_number, p_status, false, 'Decided after the INC deadline passed (' || v_label || '): ' || btrim(p_reason));
      update public.renewal_records set temp_probation = false, updated_at = now() where id = v_rec.id;
      perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Evaluator set the status to ' || p_status || ' after the INC deadline passed: ' || btrim(p_reason));
    end if;
  elsif p_action = 'other' then
    update public.renewal_inc_items set state = 'decided', decision = 'other', decision_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_item_id;
    update public.renewal_records set temp_probation = false, updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Evaluator decided another action for the INC in ' || v_item.subject || ': ' || btrim(p_reason));
  else
    raise exception 'Unknown decision.';
  end if;
  perform public._renewal_recheck(v_rec.id);
end;
$$;
revoke all on function public.renewal_decide_inc(uuid, text, text, date, text) from public, anon;
grant execute on function public.renewal_decide_inc(uuid, text, text, date, text) to authenticated;

-- Staff can read the scholar's documents through a short-lived link; this just says whether the caller may (the storage policy enforces it).
notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select
  (select count(*) from public.renewal_windows) as windows,
  (select count(*) from public.renewal_records) as records,
  (select count(*) from storage.buckets where id = 'renewal-documents') as documents_bucket;
