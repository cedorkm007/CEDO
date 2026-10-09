-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_audit_documents.sql
--
-- Phase 6 of the Scholar Grades improvements. Run AFTER
-- supabase_migration_gwa_units_exclude.sql. Nothing is deleted or changed in existing
-- rows; safe to re-run.
--
--   1. SUBMISSION AND LOCKING. A school submits a period once every scholar is complete
--      (school_period_submissions). After that its grades are LOCKED: the school cannot add,
--      change or delete them. To change a grade it sends a correction request with a reason
--      (grade_correction_requests); CEDO staff approve or reject it. An approved request lets
--      the school change THAT grade once, then locks again. CEDO can also reopen a whole
--      submission (for added/removed subjects), after which the school edits and resubmits.
--      Staff and other non-school writers are not restricted.
--   2. AUDIT TRAIL (scholar_grade_audit). Every insert, change and delete of a subject/grade
--      is recorded: who, when, old and new values, and how (manual entry, CSV upload,
--      approved correction, staff). Written by a trigger; nobody can edit or delete entries.
--   3. SUPPORTING DOCUMENTS (grade_documents + the private "grade-documents" bucket). A school
--      can attach a PDF or image of the official grade slip / certificate of grades per
--      scholar per period (up to 5, 10 MB each). Staff with the scholars_grades_monitoring
--      tag can view them next to the entered grades.
--   4. FIX: scholars with status "Removed" no longer count in a school's completion figures
--      (they cannot be graded, so a school could otherwise never reach 100% or submit).
--
-- Who may do what is enforced here in the database, not only on the screens.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Removed scholars are not counted in completion % ─────
create or replace function public.scholars_grades_monitoring_schools(p_school_year text, p_semester text)
returns table(school_id uuid, school_name text, total_scholars bigint, complete_scholars bigint, percent_complete numeric)
language sql stable security definer as $$
  with period_grades as (
    select scholar_id_number, bool_and(nullif(trim(coalesce(grade, '')), '') is not null) as all_graded
    from public.scholar_subjects_grades
    where school_year = p_school_year and semester = p_semester
    group by scholar_id_number
  )
  select
    sch.id, sch.name,
    count(s.scholar_id_number) as total_scholars,
    count(*) filter (where pg.all_graded) as complete_scholars,
    case when count(s.scholar_id_number) = 0 then 0
      else round(100.0 * count(*) filter (where pg.all_graded) / count(s.scholar_id_number), 1)
    end as percent_complete
  from public.schools sch
  join public.scholars s on s.school_id = sch.id and s.status <> 'Removed'
  left join period_grades pg on pg.scholar_id_number = s.scholar_id_number
  where public.is_scholars_grades_monitoring_staff()
  group by sch.id, sch.name
  order by sch.name;
$$;
grant execute on function public.scholars_grades_monitoring_schools(text, text) to authenticated;

create or replace function public.scholars_grades_monitoring_programs(p_school_id uuid, p_school_year text, p_semester text)
returns table(program text, total_scholars bigint, complete_scholars bigint, percent_complete numeric)
language sql stable security definer as $$
  with period_grades as (
    select scholar_id_number, bool_and(nullif(trim(coalesce(grade, '')), '') is not null) as all_graded
    from public.scholar_subjects_grades
    where school_year = p_school_year and semester = p_semester
    group by scholar_id_number
  )
  select
    coalesce(nullif(trim(s.course), ''), '(No program set)') as program,
    count(s.scholar_id_number) as total_scholars,
    count(*) filter (where pg.all_graded) as complete_scholars,
    case when count(s.scholar_id_number) = 0 then 0
      else round(100.0 * count(*) filter (where pg.all_graded) / count(s.scholar_id_number), 1)
    end as percent_complete
  from public.scholars s
  left join period_grades pg on pg.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school_id and s.status <> 'Removed' and public.is_scholars_grades_monitoring_staff()
  group by coalesce(nullif(trim(s.course), ''), '(No program set)')
  order by program;
$$;
grant execute on function public.scholars_grades_monitoring_programs(uuid, text, text) to authenticated;

-- ── 2. Tables ───────────────────────────────────────────────
-- One row per school per period. 'submitted' = locked; 'reopened' = CEDO unlocked it for changes.
create table if not exists public.school_period_submissions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  period_id       uuid not null references public.academic_periods(id) on delete restrict,
  status          text not null default 'submitted' check (status in ('submitted', 'reopened')),
  submitted_at    timestamptz,
  submitted_by    uuid,
  scholars_total  integer,
  submit_count    integer not null default 1,
  reopened_at     timestamptz,
  reopened_by     uuid,
  reopen_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, period_id)
);

-- Submission history (submitted / reopened / resubmitted), for the record.
create table if not exists public.school_submission_events (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools(id) on delete cascade,
  period_id   uuid not null references public.academic_periods(id) on delete restrict,
  event       text not null check (event in ('submitted', 'reopened', 'resubmitted')),
  actor_label text,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.grade_correction_requests (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  period_id          uuid not null references public.academic_periods(id) on delete restrict,
  grade_id           uuid references public.scholar_subjects_grades(id) on delete set null,
  scholar_id_number  text not null,
  subject_code       text not null default '',
  subject            text not null,
  current_grade      text,
  proposed_grade     text,
  reason             text not null check (char_length(btrim(reason)) >= 5),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
  requested_by       uuid,
  requested_by_label text,
  requested_at       timestamptz not null default now(),
  reviewed_by        uuid,
  reviewed_by_label  text,
  reviewed_at        timestamptz,
  review_note        text,
  applied_at         timestamptz
);
-- Only one open request per grade at a time.
create unique index if not exists grade_correction_one_open_per_grade
  on public.grade_correction_requests (grade_id) where status in ('pending', 'approved');
create index if not exists idx_grade_corrections_school on public.grade_correction_requests (school_id, status);

create table if not exists public.scholar_grade_audit (
  id                 bigint generated always as identity primary key,
  changed_at         timestamptz not null default now(),
  action             text not null check (action in ('insert', 'update', 'delete')),
  source             text not null check (source in ('manual', 'csv', 'staff', 'correction', 'system')),
  actor_type         text not null check (actor_type in ('school', 'staff', 'system')),
  actor_id           uuid,
  actor_label        text,
  school_id          uuid,
  grade_id           uuid,
  scholar_id_number  text not null,
  period_id          uuid,
  school_year        text,
  semester           text,
  old_subject_code   text, new_subject_code text,
  old_subject        text, new_subject text,
  old_grade          text, new_grade text,
  old_units          numeric, new_units numeric,
  old_exclude        boolean, new_exclude boolean
);
create index if not exists idx_grade_audit_scholar on public.scholar_grade_audit (scholar_id_number, changed_at desc);
create index if not exists idx_grade_audit_school on public.scholar_grade_audit (school_id, changed_at desc);

create table if not exists public.grade_documents (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  period_id          uuid not null references public.academic_periods(id) on delete restrict,
  storage_path       text not null unique,
  file_name          text not null,
  mime_type          text not null,
  size_bytes         bigint not null,
  uploaded_by        uuid,
  uploaded_at        timestamptz not null default now()
);
create index if not exists idx_grade_documents_scholar on public.grade_documents (scholar_id_number, period_id);

-- ── 3. Helper: is this school's period locked (submitted)? ──
create or replace function public._school_period_locked(p_school_id uuid, p_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.school_period_submissions s
    where s.school_id = p_school_id and s.period_id = p_period_id and s.status = 'submitted'
  );
$$;

-- ── 4. Row level security (reads only; every write goes through the functions below) ──
alter table public.school_period_submissions enable row level security;
alter table public.school_submission_events enable row level security;
alter table public.grade_correction_requests enable row level security;
alter table public.scholar_grade_audit enable row level security;
alter table public.grade_documents enable row level security;

drop policy if exists "school reads own submissions" on public.school_period_submissions;
create policy "school reads own submissions" on public.school_period_submissions for select
  using (school_id = public.current_school_id());
drop policy if exists "staff reads submissions" on public.school_period_submissions;
create policy "staff reads submissions" on public.school_period_submissions for select
  using (public.is_scholars_grades_monitoring_staff());

drop policy if exists "school reads own submission events" on public.school_submission_events;
create policy "school reads own submission events" on public.school_submission_events for select
  using (school_id = public.current_school_id());
drop policy if exists "staff reads submission events" on public.school_submission_events;
create policy "staff reads submission events" on public.school_submission_events for select
  using (public.is_scholars_grades_monitoring_staff());

drop policy if exists "school reads own correction requests" on public.grade_correction_requests;
create policy "school reads own correction requests" on public.grade_correction_requests for select
  using (school_id = public.current_school_id());
drop policy if exists "staff reads correction requests" on public.grade_correction_requests;
create policy "staff reads correction requests" on public.grade_correction_requests for select
  using (public.is_scholars_grades_monitoring_staff());

drop policy if exists "school reads own grade audit" on public.scholar_grade_audit;
create policy "school reads own grade audit" on public.scholar_grade_audit for select
  using (school_id = public.current_school_id());
drop policy if exists "staff reads grade audit" on public.scholar_grade_audit;
create policy "staff reads grade audit" on public.scholar_grade_audit for select
  using (public.is_scholars_grades_monitoring_staff());

drop policy if exists "staff reads grade documents" on public.grade_documents;
create policy "staff reads grade documents" on public.grade_documents for select
  using (public.is_scholars_grades_monitoring_staff());
drop policy if exists "school reads own grade documents" on public.grade_documents;
create policy "school reads own grade documents" on public.grade_documents for select
  using (school_id = public.current_school_id());
drop policy if exists "school adds own grade documents" on public.grade_documents;
create policy "school adds own grade documents" on public.grade_documents for insert
  with check (school_id = public.current_school_id());
-- A school may remove a document only while its period is Open and not submitted (evidence stays once submitted).
drop policy if exists "school removes own unlocked grade documents" on public.grade_documents;
create policy "school removes own unlocked grade documents" on public.grade_documents for delete
  using (
    school_id = public.current_school_id()
    and not public._school_period_locked(school_id, period_id)
    and exists (select 1 from public.academic_periods p where p.id = grade_documents.period_id and p.status = 'open')
  );

-- ── 5. The lock: Phase 2/3's guard trigger, extended ────────
-- (open-period rule + grade-on-scale rule are unchanged; the new part is the SUBMITTED lock.)
create or replace function public.scholar_grades_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scholar_subjects_grades;
  v_term text;
  v_year text;
  v_pid uuid;
  v_status text;
  v_old_status text;
  v_grade_error text;
  v_school uuid;
  v_req uuid;
  v_when timestamptz;
  v_is_school boolean := public.is_school_account();
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_year := btrim(v_row.school_year);
  v_term := public.normalize_academic_term(v_row.semester);

  select p.id, p.status into v_pid, v_status
  from public.academic_periods p
  where p.school_year = v_year and p.term = v_term;

  if v_is_school then
    v_school := public.current_school_id();
    if v_pid is null then
      raise exception 'The % % grading period has not been set up by CEDO yet, so grades cannot be saved for it.', v_year, coalesce(v_term, btrim(v_row.semester));
    end if;
    if v_status <> 'open' then
      raise exception 'Grades for % % are % — schools can only change grades in an Open period.', v_year, v_term, v_status;
    end if;
    if tg_op = 'UPDATE' and old.period_id is not null then
      select status into v_old_status from public.academic_periods where id = old.period_id;
      if v_old_status is distinct from 'open' then
        raise exception 'This grade belongs to a period that is % — schools can only change grades in an Open period.', coalesce(v_old_status, 'not set up');
      end if;
    end if;

    -- Submitted periods are locked.
    if tg_op in ('INSERT', 'DELETE') then
      if public._school_period_locked(v_school, v_pid) then
        select s.submitted_at into v_when from public.school_period_submissions s where s.school_id = v_school and s.period_id = v_pid;
        raise exception 'These grades were submitted on % and are locked. To add or remove a subject, ask CEDO to reopen your submission.', to_char(v_when at time zone 'Asia/Manila', 'Mon DD, YYYY');
      end if;
    else
      if public._school_period_locked(v_school, coalesce(old.period_id, v_pid)) or public._school_period_locked(v_school, v_pid) then
        -- Only a grade CEDO approved a correction for may change, once.
        update public.grade_correction_requests
        set status = 'applied', applied_at = now()
        where grade_id = old.id and status = 'approved'
        returning id into v_req;
        if v_req is null then
          select s.submitted_at into v_when from public.school_period_submissions s
            where s.school_id = v_school and s.period_id = coalesce(old.period_id, v_pid);
          raise exception 'These grades were submitted on % and are locked. To change this grade, send a correction request (CEDO must approve it first).', to_char(v_when at time zone 'Asia/Manila', 'Mon DD, YYYY');
        end if;
        if v_pid is distinct from old.period_id or new.scholar_id_number <> old.scholar_id_number then
          raise exception 'A corrected grade must stay with the same scholar and period.';
        end if;
      end if;
    end if;

    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.grade is distinct from old.grade) then
      v_grade_error := public._school_grade_error(v_school, new.grade);
      if v_grade_error is not null then
        raise exception '%', v_grade_error;
      end if;
    end if;
  elsif tg_op <> 'DELETE' and v_pid is null and v_term is not null and v_year ~ '^\d{4}-\d{4}$' then
    insert into public.academic_periods (school_year, term, status)
    values (v_year, v_term, 'open')
    on conflict (school_year, term) do update set school_year = excluded.school_year
    returning id into v_pid;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.school_year := v_year;
  new.period_id := v_pid;
  if v_term is not null then new.semester := v_term; end if;
  return new;
end;
$$;

-- ── 6. Audit trigger: every change, who / when / old / new / how ──
create or replace function public.scholar_grade_audit_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scholar_subjects_grades;
  v_uid uuid := auth.uid();
  v_school_account uuid := public.current_school_id();
  v_actor_type text;
  v_label text;
  v_source text;
  v_school_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.subject_code is not distinct from new.subject_code
     and old.subject is not distinct from new.subject
     and old.grade is not distinct from new.grade
     and old.units is not distinct from new.units
     and old.exclude_from_gwa is not distinct from new.exclude_from_gwa
     and old.period_id is not distinct from new.period_id then
    return null; -- nothing that matters changed (e.g. only updated_at)
  end if;

  if v_school_account is not null then
    v_actor_type := 'school';
    select name into v_label from public.schools where id = v_school_account;
  elsif v_uid is not null and exists (select 1 from public.users u where u.id = v_uid) then
    v_actor_type := 'staff';
    select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') into v_label from public.users u where u.id = v_uid;
  else
    v_actor_type := 'system';
  end if;

  -- 'csv' is set by the bulk-upload function for its own transaction; otherwise it depends on who wrote it.
  v_source := nullif(current_setting('app.grade_source', true), '');
  if v_source is null then
    v_source := case v_actor_type when 'school' then 'manual' when 'staff' then 'staff' else 'system' end;
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.grade_correction_requests r where r.grade_id = new.id and r.status = 'applied' and r.applied_at = now()
  ) then
    v_source := 'correction';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  select s.school_id into v_school_id from public.scholars s where s.scholar_id_number = v_row.scholar_id_number;

  insert into public.scholar_grade_audit (
    action, source, actor_type, actor_id, actor_label, school_id, grade_id, scholar_id_number, period_id, school_year, semester,
    old_subject_code, new_subject_code, old_subject, new_subject, old_grade, new_grade, old_units, new_units, old_exclude, new_exclude
  ) values (
    lower(tg_op), v_source, v_actor_type, v_uid, v_label, v_school_id, v_row.id, v_row.scholar_id_number, v_row.period_id, v_row.school_year, v_row.semester,
    case when tg_op = 'INSERT' then null else old.subject_code end, case when tg_op = 'DELETE' then null else new.subject_code end,
    case when tg_op = 'INSERT' then null else old.subject end,      case when tg_op = 'DELETE' then null else new.subject end,
    case when tg_op = 'INSERT' then null else old.grade end,        case when tg_op = 'DELETE' then null else new.grade end,
    case when tg_op = 'INSERT' then null else old.units end,        case when tg_op = 'DELETE' then null else new.units end,
    case when tg_op = 'INSERT' then null else old.exclude_from_gwa end, case when tg_op = 'DELETE' then null else new.exclude_from_gwa end
  );
  return null;
end;
$$;

drop trigger if exists scholar_grade_audit_trg on public.scholar_subjects_grades;
create trigger scholar_grade_audit_trg
  after insert or update or delete on public.scholar_subjects_grades
  for each row execute function public.scholar_grade_audit_trg();

-- The bulk (CSV) save marks its own rows as "csv" in the audit trail.
create or replace function public.bulk_upsert_scholar_subject_grades(p_rows jsonb)
returns table(row_index int, ok boolean, error text, id uuid)
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_index int := 0;
  v_id uuid;
begin
  perform set_config('app.grade_source', 'csv', true);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_id := public.upsert_scholar_subject_grade(
        case when v_row->>'id' is null or v_row->>'id' = '' then null else (v_row->>'id')::uuid end,
        v_row->>'scholarIdNumber',
        v_row->>'schoolYear',
        v_row->>'semester',
        coalesce(v_row->>'subjectCode', ''),
        v_row->>'subject',
        v_row->>'grade',
        case when v_row->>'units' is null or v_row->>'units' = '' then null else (v_row->>'units')::numeric end,
        case when v_row->>'excludeFromGwa' is null or v_row->>'excludeFromGwa' = '' then null else (v_row->>'excludeFromGwa')::boolean end
      );
      row_index := v_index; ok := true; error := null; id := v_id;
    exception when others then
      row_index := v_index; ok := false; error := sqlerrm; id := null;
    end;
    v_index := v_index + 1;
    return next;
  end loop;
end;
$$;
grant execute on function public.bulk_upsert_scholar_subject_grades(jsonb) to authenticated;

-- ── 7. Submission functions ─────────────────────────────────
create or replace function public._actor_label()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.name from public.schools s where s.id = public.current_school_id()),
    (select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = auth.uid())
  );
$$;

create or replace function public.submit_school_period(p_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_status text;
  v_total int;
  v_incomplete int;
  v_existing text;
  v_when timestamptz := now();
begin
  if v_school is null then raise exception 'Not authorized — no school account found.'; end if;
  select status into v_status from public.academic_periods where id = p_period_id;
  if v_status is null then raise exception 'That grading period does not exist.'; end if;
  if v_status <> 'open' then raise exception 'Only an Open period can be submitted (this one is %).', v_status; end if;
  if not exists (select 1 from public.school_grading_configs c where c.school_id = v_school) then
    raise exception 'Set up your grading scale before submitting grades.';
  end if;
  select status into v_existing from public.school_period_submissions where school_id = v_school and period_id = p_period_id;
  if v_existing = 'submitted' then raise exception 'These grades have already been submitted.'; end if;

  select count(*) into v_total from public.scholars s where s.school_id = v_school and s.status <> 'Removed';
  if v_total = 0 then raise exception 'There are no scholars to submit grades for.'; end if;

  select count(*) into v_incomplete
  from public.scholars s
  left join (
    select g.scholar_id_number,
           count(*) as subjects,
           count(*) filter (where nullif(btrim(coalesce(g.grade, '')), '') is not null) as graded
    from public.scholar_subjects_grades g
    where g.period_id = p_period_id
    group by g.scholar_id_number
  ) pg on pg.scholar_id_number = s.scholar_id_number
  where s.school_id = v_school and s.status <> 'Removed'
    and (coalesce(pg.subjects, 0) = 0 or pg.graded < pg.subjects);
  if v_incomplete > 0 then
    raise exception '% of % scholars are not complete yet. Every scholar needs at least one subject, and every subject needs a grade.', v_incomplete, v_total;
  end if;

  insert into public.school_period_submissions (school_id, period_id, status, submitted_at, submitted_by, scholars_total)
  values (v_school, p_period_id, 'submitted', v_when, auth.uid(), v_total)
  on conflict (school_id, period_id) do update
    set status = 'submitted', submitted_at = v_when, submitted_by = auth.uid(), scholars_total = v_total,
        submit_count = public.school_period_submissions.submit_count + 1,
        reopened_at = null, reopened_by = null, reopen_note = null, updated_at = now();

  insert into public.school_submission_events (school_id, period_id, event, actor_label)
  values (v_school, p_period_id, case when v_existing = 'reopened' then 'resubmitted' else 'submitted' end, public._actor_label());

  return jsonb_build_object('submittedAt', v_when, 'scholars', v_total);
end;
$$;
grant execute on function public.submit_school_period(uuid) to authenticated;

create or replace function public.request_grade_correction(p_grade_id uuid, p_reason text, p_proposed_grade text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_grade public.scholar_subjects_grades%rowtype;
  v_proposed text := nullif(btrim(coalesce(p_proposed_grade, '')), '');
  v_error text;
  v_id uuid;
begin
  if v_school is null then raise exception 'Not authorized — no school account found.'; end if;
  select * into v_grade from public.scholar_subjects_grades where id = p_grade_id;
  if not found or not exists (select 1 from public.scholars s where s.scholar_id_number = v_grade.scholar_id_number and s.school_id = v_school) then
    raise exception 'That grade was not found for your school.';
  end if;
  if v_grade.period_id is null or not public._school_period_locked(v_school, v_grade.period_id) then
    raise exception 'This period has not been submitted, so you can change the grade directly.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a reason for the correction (at least 5 characters).';
  end if;
  if exists (select 1 from public.grade_correction_requests r where r.grade_id = p_grade_id and r.status in ('pending', 'approved')) then
    raise exception 'There is already an open correction request for this grade.';
  end if;
  if v_proposed is not null then
    v_error := public._school_grade_error(v_school, v_proposed);
    if v_error is not null then raise exception '%', v_error; end if;
  end if;

  insert into public.grade_correction_requests (
    school_id, period_id, grade_id, scholar_id_number, subject_code, subject, current_grade, proposed_grade, reason, requested_by, requested_by_label
  ) values (
    v_school, v_grade.period_id, p_grade_id, v_grade.scholar_id_number, v_grade.subject_code, v_grade.subject, v_grade.grade, v_proposed,
    btrim(p_reason), auth.uid(), public._actor_label()
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.request_grade_correction(uuid, text, text) to authenticated;

create or replace function public.cancel_grade_correction(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_n int;
begin
  if v_school is null then raise exception 'Not authorized — no school account found.'; end if;
  update public.grade_correction_requests set status = 'cancelled'
  where id = p_request_id and school_id = v_school and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Only a pending request of your school can be cancelled.'; end if;
end;
$$;
grant execute on function public.cancel_grade_correction(uuid) to authenticated;

create or replace function public.review_grade_correction(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_n int;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to review correction requests.'; end if;
  if not p_approve and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Please tell the school why the request was rejected.';
  end if;
  update public.grade_correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_by_label = public._actor_label(), reviewed_at = now(), review_note = v_note
  where id = p_request_id and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That request is no longer pending.'; end if;
end;
$$;
grant execute on function public.review_grade_correction(uuid, boolean, text) to authenticated;

create or replace function public.reopen_school_period(p_school_id uuid, p_period_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_n int;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to reopen a submission.'; end if;
  if v_note is null or char_length(v_note) < 3 then raise exception 'Please give a reason for reopening this submission.'; end if;
  update public.school_period_submissions
  set status = 'reopened', reopened_at = now(), reopened_by = auth.uid(), reopen_note = v_note, updated_at = now()
  where school_id = p_school_id and period_id = p_period_id and status = 'submitted';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That school has not submitted this period (or it is already reopened).'; end if;

  -- Open correction requests are moot once the whole period is unlocked.
  update public.grade_correction_requests
  set status = 'cancelled', review_note = coalesce(review_note, 'Cancelled because CEDO reopened the submission.'), reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_label = public._actor_label()
  where school_id = p_school_id and period_id = p_period_id and status in ('pending', 'approved');

  insert into public.school_submission_events (school_id, period_id, event, actor_label, note)
  values (p_school_id, p_period_id, 'reopened', public._actor_label(), v_note);
end;
$$;
grant execute on function public.reopen_school_period(uuid, uuid, text) to authenticated;

-- Staff: every school's submission state for one period, for the Schools tab (next to the completion %).
create or replace function public.grades_submission_overview(p_school_year text, p_semester text)
returns table(school_id uuid, status text, submitted_at timestamptz, pending_requests bigint)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select id from public.academic_periods
    where school_year = btrim(p_school_year) and term = public.normalize_academic_term(p_semester)
  )
  select sch.id,
         sub.status,
         sub.submitted_at,
         (select count(*) from public.grade_correction_requests r
           where r.school_id = sch.id and r.period_id = (select id from p) and r.status = 'pending')
  from public.schools sch
  left join public.school_period_submissions sub on sub.school_id = sch.id and sub.period_id = (select id from p)
  where public.is_scholars_grades_monitoring_staff();
$$;
grant execute on function public.grades_submission_overview(text, text) to authenticated;

-- ── 8. Supporting documents ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grade-documents', 'grade-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

-- Objects live at  <school id>/<period id>/<scholar id>/<file>.  A school can add, read and (before submitting) remove
-- only inside its own folder; staff with the monitoring tag can read everything.
drop policy if exists "school adds grade documents" on storage.objects;
create policy "school adds grade documents" on storage.objects for insert
  with check (bucket_id = 'grade-documents' and public.is_school_account()
              and (storage.foldername(name))[1] = public.current_school_id()::text);

drop policy if exists "school or staff reads grade documents" on storage.objects;
create policy "school or staff reads grade documents" on storage.objects for select
  using (bucket_id = 'grade-documents' and (
    (public.is_school_account() and (storage.foldername(name))[1] = public.current_school_id()::text)
    or public.is_scholars_grades_monitoring_staff()));

drop policy if exists "school removes own grade documents" on storage.objects;
create policy "school removes own grade documents" on storage.objects for delete
  using (bucket_id = 'grade-documents' and public.is_school_account()
         and (storage.foldername(name))[1] = public.current_school_id()::text);

-- Friendly, enforced rules for a school adding a document row.
create or replace function public.grade_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_status text;
begin
  if tg_op = 'INSERT' and v_school is not null then
    new.school_id := v_school;
    new.uploaded_by := auth.uid();
    if not exists (select 1 from public.scholars s where s.scholar_id_number = new.scholar_id_number and s.school_id = v_school) then
      raise exception 'That scholar does not belong to your school.';
    end if;
    select status into v_status from public.academic_periods where id = new.period_id;
    if v_status is distinct from 'open' then
      raise exception 'Documents can only be added to an Open period.';
    end if;
    if new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Only PDF, JPG, PNG or WebP files can be attached.';
    end if;
    if new.size_bytes > 10485760 then
      raise exception 'Files can be at most 10 MB.';
    end if;
    if new.storage_path not like (v_school::text || '/' || new.period_id::text || '/' || new.scholar_id_number || '/%') then
      raise exception 'The file is not stored in your school''s folder for this scholar and period.';
    end if;
    if (select count(*) from public.grade_documents d where d.scholar_id_number = new.scholar_id_number and d.period_id = new.period_id) >= 5 then
      raise exception 'A scholar can have at most 5 documents per period. Remove one first.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists grade_documents_guard on public.grade_documents;
create trigger grade_documents_guard before insert on public.grade_documents
  for each row execute function public.grade_documents_guard();

-- Tell the API layer to pick up the new functions right away.
notify pgrst, 'reload schema';

-- ── 9. Result check (shown in the SQL editor) ───────────────
select
  (select count(*) from public.scholar_subjects_grades) as grade_rows,
  (select count(*) from public.school_period_submissions) as submissions,
  (select count(*) from public.grade_correction_requests) as correction_requests,
  (select count(*) from public.scholar_grade_audit) as audit_entries_so_far,
  (select count(*) from storage.buckets where id = 'grade-documents') as documents_bucket;
