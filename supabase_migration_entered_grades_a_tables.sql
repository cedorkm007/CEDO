-- ─────────────────────────────────────────────────────────────
-- SCHOLAR-ENTERED GRADES, FILE A of 3: the tables.   Safe to run twice.   Undo: undo_entered_grades_a.sql
-- Run this FIRST, on its own, then _b_grading_columns.sql, then _c_functions.sql.
--
-- While a renewal waits for the school's grades, the scholar can enter their own grades in the portal: for each subject the code, the name, the units and the grade, plus one or
-- more screenshots / images of the grades, and a tick that they understand false information means disciplinary action or removal from the scholarship. The Grades Approver
-- (a tag it.admin1 gives) approves or returns it. Once approved, the scholar counts as having complete grades; when the school later uploads its grades, they replace the entered
-- ones and any differences are shown to the approver and the evaluator.
--   renewal_self_grade_submissions  one row per try (version 1, 2, ...): who, which renewal, which semester's grades, the tick, the decision, and the comparison with the school's grades
--   renewal_self_grade_lines        the subjects of a try
--   renewal_self_grade_files        the screenshots of a try (the files themselves are in the private renewal-documents folder)
-- All three are locked: only the functions of file C write them; a scholar may read only their own. Creates three new tables; changes no existing table; deletes nothing.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.renewal_self_grade_submissions (
  id                 uuid primary key default gen_random_uuid(),
  record_id          uuid not null references public.renewal_records(id) on delete cascade,
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  school_year        text not null,                 -- the renewal term applied for
  term               text not null,
  basis_school_year  text not null,                 -- the semester whose grades were entered
  basis_term         text not null,
  version            integer not null,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'returned', 'superseded')),
  acknowledged_at    timestamptz not null,          -- the scholar ticked "I understand that wrong or false information means disciplinary action or removal"
  submitted_at       timestamptz not null default now(),
  decided_by         uuid references public.users(id) on delete set null,
  decided_by_label   text,
  decided_at         timestamptz,
  decision_note      text not null default '',
  official_checked_at timestamptz,                  -- when the school's own grades were compared with these (null = the school has not uploaded yet)
  differences        jsonb,                         -- null = not compared; [] = they match; otherwise the subjects that differ
  unique (record_id, version)
);
create index if not exists renewal_self_grade_submissions_status_idx on public.renewal_self_grade_submissions (status, submitted_at);
create index if not exists renewal_self_grade_submissions_basis_idx on public.renewal_self_grade_submissions (scholar_id_number, basis_school_year, basis_term);
alter table public.renewal_self_grade_submissions enable row level security;
revoke all on public.renewal_self_grade_submissions from public, anon, authenticated;
grant select on public.renewal_self_grade_submissions to authenticated;
drop policy if exists "scholars read their own entered grades" on public.renewal_self_grade_submissions;
create policy "scholars read their own entered grades" on public.renewal_self_grade_submissions for select to authenticated
  using (scholar_id_number = (select public.current_scholar_id_number()));

create table if not exists public.renewal_self_grade_lines (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.renewal_self_grade_submissions(id) on delete cascade,
  subject_code   text not null check (btrim(subject_code) <> '' and char_length(subject_code) <= 30),
  subject        text not null check (btrim(subject) <> '' and char_length(subject) <= 150),
  units          numeric not null check (units > 0 and units <= 12),
  grade          text not null check (btrim(grade) <> '' and char_length(grade) <= 12)
);
create index if not exists renewal_self_grade_lines_submission_idx on public.renewal_self_grade_lines (submission_id);
alter table public.renewal_self_grade_lines enable row level security;
revoke all on public.renewal_self_grade_lines from public, anon, authenticated;
grant select on public.renewal_self_grade_lines to authenticated;
drop policy if exists "scholars read their own entered grade lines" on public.renewal_self_grade_lines;
create policy "scholars read their own entered grade lines" on public.renewal_self_grade_lines for select to authenticated
  using (exists (select 1 from public.renewal_self_grade_submissions s where s.id = submission_id and s.scholar_id_number = (select public.current_scholar_id_number())));

create table if not exists public.renewal_self_grade_files (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.renewal_self_grade_submissions(id) on delete cascade,
  storage_path   text not null,                  -- the same image can be kept in a later try of the same application
  file_name      text not null,
  mime_type      text not null,
  size_bytes     bigint not null,
  uploaded_at    timestamptz not null default now(),
  unique (submission_id, storage_path)
);
create index if not exists renewal_self_grade_files_submission_idx on public.renewal_self_grade_files (submission_id);
alter table public.renewal_self_grade_files enable row level security;
revoke all on public.renewal_self_grade_files from public, anon, authenticated;
grant select on public.renewal_self_grade_files to authenticated;
drop policy if exists "scholars read their own entered grade files" on public.renewal_self_grade_files;
create policy "scholars read their own entered grade files" on public.renewal_self_grade_files for select to authenticated
  using (exists (select 1 from public.renewal_self_grade_submissions s where s.id = submission_id and s.scholar_id_number = (select public.current_scholar_id_number())));

notify pgrst, 'reload schema';
