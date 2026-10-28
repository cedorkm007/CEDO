-- ─────────────────────────────────────────────────────────────
-- SCHOLAR-ENTERED GRADES, FILE C of 3: the process.   Safe to run twice.   Undo: undo_entered_grades_c.sql
-- Run AFTER _a_tables.sql and _b_grading_columns.sql, and AFTER the renewal files, the SDP reconsideration files and the SDP Monitoring files.
--
-- THE PROCESS
--   1. While the school has not uploaded its grades for the semester the renewal looks at, a scholar with an application can ENTER their grades: for every subject the code, the
--      name, the units and the grade; one to five screenshots / images of the grades; and the tick that wrong or false information means disciplinary action or removal from
--      the scholarship. Nothing is entered without the tick and at least one image.
--   2. The GRADES APPROVER (a staff tag it.admin1 gives, "Grades Approver") sees it, with the images, and APPROVES it or RETURNS it with a reason (the scholar can then enter it again).
--   3. APPROVED: the scholar counts as having COMPLETE grades; the entered grades are judged with the school's grading system (so the school needs a passing mark: Scholars' Grades
--      Monitoring staff can set one up for the time being) and the renewal moves on by the same rules as with the school's grades.
--   4. When the school UPLOADS its grades, the school's grades replace the entered ones, the two are compared subject by subject, the scholar is told the school uploaded, and when
--      anything differs the Grades Approver and the evaluators are told which subjects differ. Nothing is done to the scholar by the system itself.
-- Also: the new staff tag, the storage rule that lets the approver open the images, the setup screens' functions for Scholars' Grades Monitoring staff, and the renewal check
-- (same stages and rules as before; its "grades" part also says whether the grades are the scholar's own entered ones). No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- This file uses the table of non-numeric marks that supabase_migration_school_non_numeric_marks.sql creates. If that file has not been run, stop here with a clear message (nothing has been changed yet).
do $$
begin
  if to_regclass('public.school_marks') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_school_non_numeric_marks.sql first (it creates the table of non-numeric marks that this file uses), then run this file again.';
  end if;
end $$;

create or replace function public.can_approve_scholar_grades()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'scholar_grades_approver');
$$;
revoke all on function public.can_approve_scholar_grades() from public, anon;
grant execute on function public.can_approve_scholar_grades() to authenticated;

-- Tells the Grades Approvers (and, when asked, the renewal evaluators) with a bell notice.
create or replace function public._eg_notify_approvers(p_title text, p_message text, p_record_id uuid, p_about text, p_with_evaluators boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  for a in select distinct x.staff_id as uid from public.staff_account_tags x where x.tag_key = 'scholar_grades_approver'
           union select distinct y.staff_id from public.staff_account_tags y where p_with_evaluators and y.tag_key = 'scholar_renewal_evaluator' loop
    perform public._notify_staff_member(a.uid, p_title, p_message, p_record_id, p_about);
  end loop;
end;
$$;
revoke all on function public._eg_notify_approvers(text, text, uuid, text, boolean) from public, anon, authenticated;

-- "1.5" and "1.50" are the same grade; otherwise the text is compared without capitals and spaces.
create or replace function public._eg_same_grade(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
  select case when btrim(coalesce(p_a, '')) ~ '^\d+([.,]\d+)?$' and btrim(coalesce(p_b, '')) ~ '^\d+([.,]\d+)?$'
              then replace(btrim(p_a), ',', '.')::numeric = replace(btrim(p_b), ',', '.')::numeric
              else lower(btrim(coalesce(p_a, ''))) = lower(btrim(coalesce(p_b, ''))) end;
$$;
revoke all on function public._eg_same_grade(text, text) from public, anon, authenticated;

-- The subjects where an entered try and the school's own grades differ: a different grade, a subject the school does not have, or one the scholar left out.
create or replace function public._eg_differences(p_submission_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sub as (select * from public.renewal_self_grade_submissions where id = p_submission_id),
  e as (select upper(btrim(l.subject_code)) as k, l.subject_code, l.subject, l.grade from public.renewal_self_grade_lines l where l.submission_id = p_submission_id),
  s as (
    select upper(btrim(coalesce(nullif(btrim(g.subject_code), ''), g.subject))) as k, g.subject_code, g.subject, g.grade
    from public.scholar_subjects_grades g, sub
    where g.scholar_id_number = sub.scholar_id_number and g.school_year = sub.basis_school_year and g.semester = sub.basis_term
  )
  select coalesce(jsonb_agg(x.j order by x.o), '[]'::jsonb) from (
    select jsonb_build_object('code', e.subject_code, 'subject', e.subject, 'entered', e.grade, 'school', s.grade, 'kind', 'different') as j, e.k as o
      from e join s on s.k = e.k where not public._eg_same_grade(e.grade, s.grade)
    union all
    select jsonb_build_object('code', e.subject_code, 'subject', e.subject, 'entered', e.grade, 'school', null, 'kind', 'missing_in_school'), e.k
      from e where not exists (select 1 from s where s.k = e.k)
    union all
    select jsonb_build_object('code', s.subject_code, 'subject', s.subject, 'entered', null, 'school', s.grade, 'kind', 'missing_in_entered'), s.k
      from s where not exists (select 1 from e where e.k = s.k)
  ) x;
$$;
revoke all on function public._eg_differences(uuid) from public, anon, authenticated;

-- Can this application enter grades now? null = yes, otherwise the reason (in words for the scholar).
create or replace function public._eg_cannot_enter(p_record_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rec public.renewal_records%rowtype;
  ev jsonb;
  v_self public.renewal_self_grade_submissions%rowtype;
begin
  select * into rec from public.renewal_records where id = p_record_id;
  if not found then return 'That application was not found.'; end if;
  if rec.stage in ('renewed', 'removed', 'reconsidered', 'division_head_approved', 'not_required', 'late_declined', 'late_pending', 'returned') then
    return 'Your application is at a stage where grades cannot be entered.';
  end if;
  ev := public._renewal_evaluate(rec.scholar_id_number, rec.school_year, rec.term);
  if coalesce((ev -> 'grades' ->> 'school_submitted')::boolean, false) then return 'Your school has already uploaded your grades, so they are used instead.'; end if;
  select * into v_self from public.renewal_self_grade_submissions e where e.scholar_id_number = rec.scholar_id_number and e.basis_school_year = rec.basis_school_year and e.basis_term = rec.basis_term
    and e.status in ('pending', 'approved') order by e.version desc limit 1;
  if v_self.status = 'approved' then return 'The grades you entered were approved.'; end if;
  return null;
end;
$$;
revoke all on function public._eg_cannot_enter(uuid) from public, anon, authenticated;

-- The scholar sends the grades they entered.   p_lines: [{"code": "MATH101", "subject": "College Algebra", "units": 3, "grade": "1.75"}, ...]
-- p_files: [{"path": "<scholar>/<record>/grade-entries/<file>", "name": "...", "mime": "image/png", "size": 12345}, ...]   (the images are uploaded first, to the scholar's own folder)
create or replace function public.renewal_self_grades_submit(p_record_id uuid, p_lines jsonb, p_files jsonb, p_acknowledged boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  rec public.renewal_records%rowtype;
  v_why text;
  v_ver integer;
  v_sub uuid;
  l jsonb;
  f jsonb;
  v_code text; v_name text; v_grade text; v_units numeric;
  v_seen text[] := '{}';
  v_prefix text;
  v_n integer;
  v_label text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  v_why := public._eg_cannot_enter(p_record_id);
  if v_why is not null then raise exception '%', v_why; end if;
  if not coalesce(p_acknowledged, false) then raise exception 'Please tick the box to say you understand that wrong or false information means disciplinary action or removal from the scholarship.'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one subject.'; end if;
  if jsonb_array_length(p_lines) > 25 then raise exception 'You can enter at most 25 subjects.'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_code := btrim(coalesce(l ->> 'code', '')); v_name := btrim(coalesce(l ->> 'subject', '')); v_grade := btrim(coalesce(l ->> 'grade', ''));
    if v_code = '' or v_name = '' or v_grade = '' then raise exception 'Every subject needs a subject code, a subject name and a grade.'; end if;
    if char_length(v_code) > 30 or char_length(v_name) > 150 or char_length(v_grade) > 12 then raise exception 'A subject code, name or grade is too long.'; end if;
    begin v_units := (l ->> 'units')::numeric; exception when others then v_units := null; end;
    if v_units is null or v_units <= 0 or v_units > 12 then raise exception 'The units of % must be a number from 0.5 to 12.', v_code; end if;
    if upper(v_code) = any (v_seen) then raise exception 'The subject code % is listed twice.', v_code; end if;
    v_seen := v_seen || upper(v_code);
  end loop;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then raise exception 'Upload at least one screenshot or image of your grades.'; end if;
  if jsonb_array_length(p_files) > 5 then raise exception 'You can upload at most 5 images.'; end if;
  v_prefix := v_id || '/' || p_record_id::text || '/grade-entries/';
  for f in select * from jsonb_array_elements(p_files) loop
    if left(coalesce(f ->> 'path', ''), char_length(v_prefix)) <> v_prefix then raise exception 'An image is not in your own folder. Please upload it again.'; end if;
    if coalesce(f ->> 'mime', '') not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Only JPG, PNG or WEBP images can be uploaded.'; end if;
    if coalesce((f ->> 'size')::bigint, 0) <= 0 or (f ->> 'size')::bigint > 10485760 then raise exception 'An image is too big (10 MB at most).'; end if;
  end loop;

  select coalesce(max(version), 0) + 1 into v_ver from public.renewal_self_grade_submissions where record_id = p_record_id;
  update public.renewal_self_grade_submissions set status = 'superseded' where record_id = p_record_id and status in ('pending', 'returned');
  insert into public.renewal_self_grade_submissions (record_id, scholar_id_number, school_year, term, basis_school_year, basis_term, version, acknowledged_at)
  values (rec.id, rec.scholar_id_number, rec.school_year, rec.term, rec.basis_school_year, rec.basis_term, v_ver, now())
  returning id into v_sub;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.renewal_self_grade_lines (submission_id, subject_code, subject, units, grade)
    values (v_sub, btrim(l ->> 'code'), btrim(l ->> 'subject'), (l ->> 'units')::numeric, btrim(l ->> 'grade'));
  end loop;
  for f in select * from jsonb_array_elements(p_files) loop
    insert into public.renewal_self_grade_files (submission_id, storage_path, file_name, mime_type, size_bytes)
    values (v_sub, f ->> 'path', left(coalesce(f ->> 'name', 'image'), 200), f ->> 'mime', (f ->> 'size')::bigint);
  end loop;
  v_n := jsonb_array_length(p_lines);
  v_label := public._renewal_term_label(rec.basis_school_year, rec.basis_term);
  perform public._notify_scholar(v_id, 'grades_entry_submitted', 'Your grades were sent for approval',
    'You entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '. The Grades Approver will check them against your screenshot. Until then your renewal waits. When your school uploads its grades, they replace the ones you entered.', rec.id);
  perform public._eg_notify_approvers('Entered grades to approve', public._renewal_scholar_label(v_id) || ' entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '.', rec.id, public._renewal_scholar_label(v_id));
  perform public._renewal_log(rec.id, rec.stage, rec.stage, 'The scholar entered grades for ' || v_label || ' (try ' || v_ver || ') and sent them for approval.', 'Scholar');
  perform public._renewal_recheck(rec.id);
  return v_sub;
end;
$$;
revoke all on function public.renewal_self_grades_submit(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.renewal_self_grades_submit(uuid, jsonb, jsonb, boolean) to authenticated;

-- What the scholar's own screen needs for one application: whether grades can be entered, the newest try (subjects, images, decision, comparison) and whether the school has a passing mark.
create or replace function public.renewal_my_self_grades(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  rec public.renewal_records%rowtype;
  s public.renewal_self_grade_submissions%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  select * into s from public.renewal_self_grade_submissions e where e.record_id = rec.id and e.status <> 'superseded' order by e.version desc limit 1;
  if not found then
    select * into s from public.renewal_self_grade_submissions e where e.scholar_id_number = v_id and e.basis_school_year = rec.basis_school_year and e.basis_term = rec.basis_term and e.status <> 'superseded' order by e.version desc limit 1;
  end if;
  return jsonb_build_object(
    'cannot_enter_reason', public._eg_cannot_enter(rec.id),
    'submission', case when s.id is null then null else jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at, 'decided_at', s.decided_at,
        'note', s.decision_note, 'official_checked_at', s.official_checked_at, 'differences', s.differences) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('code', l.subject_code, 'subject', l.subject, 'units', l.units, 'grade', l.grade) order by l.subject_code) from public.renewal_self_grade_lines l where l.submission_id = s.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('name', x.file_name, 'path', x.storage_path) order by x.uploaded_at) from public.renewal_self_grade_files x where x.submission_id = s.id), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_my_self_grades(uuid) from public, anon;
grant execute on function public.renewal_my_self_grades(uuid) to authenticated;

-- The Grades Approver's decision.
create or replace function public.renewal_self_grades_decide(p_submission_id uuid, p_approve boolean, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.renewal_self_grade_submissions%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_label text;
  v_term text;
  v_stage text;
  ev jsonb;
  v_result text;
begin
  if not public.can_approve_scholar_grades() then raise exception 'Only a Grades Approver can approve or return entered grades.'; end if;
  select * into s from public.renewal_self_grade_submissions where id = p_submission_id for update;
  if not found then raise exception 'That submission was not found.'; end if;
  if s.status <> 'pending' then raise exception 'This submission was already decided or replaced.'; end if;
  if not coalesce(p_approve, false) and v_note = '' then raise exception 'Please write the reason for returning the grades, so the scholar can correct them.'; end if;
  v_label := public._actor_name();
  v_term := public._renewal_term_label(s.basis_school_year, s.basis_term);
  select stage into v_stage from public.renewal_records where id = s.record_id;
  update public.renewal_self_grade_submissions set status = case when coalesce(p_approve, false) then 'approved' else 'returned' end, decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note
    where id = s.id;
  if coalesce(p_approve, false) then
    perform public._notify_scholar(s.scholar_id_number, 'grades_entry_approved', 'The grades you entered were approved',
      'The Grades Approver approved the grades you entered for ' || v_term || '. They count as your complete grades for the renewal until your school uploads its own.' || case when v_note <> '' then ' Note: ' || v_note else '' end, s.record_id);
    v_result := 'approved';
  else
    perform public._notify_scholar(s.scholar_id_number, 'grades_entry_returned', 'Please correct the grades you entered',
      'The Grades Approver returned the grades you entered for ' || v_term || '. Reason: ' || v_note || ' Please enter them again.', s.record_id);
    v_result := 'returned';
  end if;
  perform public._renewal_log(s.record_id, v_stage, v_stage, case when coalesce(p_approve, false) then 'Entered grades approved (try ' || s.version || ').' else 'Entered grades returned: ' || v_note end, v_label);
  perform public._renewal_recheck(s.record_id);
  perform public._renewal_scholar_list_refresh_one(s.scholar_id_number, s.school_year, s.term);
  if v_result = 'approved' then
    ev := public._renewal_evaluate(s.scholar_id_number, s.school_year, s.term);
    if (ev -> 'grades' ->> 'state') = 'review' and (ev -> 'grades' ->> 'reason') ilike '%passing mark%' then v_result := 'approved_needs_setup'; end if;
  end if;
  return v_result;
end;
$$;
revoke all on function public.renewal_self_grades_decide(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_self_grades_decide(uuid, boolean, text) to authenticated;

-- The approver's list (and the evaluator's, read-only), one page at a time. p_status: pending | approved | returned | all.
create or replace function public.renewal_self_grades_list(p_status text default 'pending', p_query text default null, p_limit integer default 20, p_offset integer default 0)
returns table(
  id uuid, record_id uuid, scholar_id_number text, name text, school text, program text, year_level text, school_year text, term text, basis_school_year text, basis_term text,
  version integer, status text, submitted_at timestamptz, decided_at timestamptz, decided_by_label text, decision_note text, lines jsonb, files jsonb, differences jsonb,
  official_checked_at timestamptz, school_submitted boolean, grading_ready boolean, previous_count bigint, can_decide boolean, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_decide boolean := public.can_approve_scholar_grades();
begin
  if not (public.can_view_renewals() or v_decide) then raise exception 'Not authorized to view entered grades.'; end if;
  return query
  select e.id, e.record_id, e.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, e.school_year, e.term,
         e.basis_school_year, e.basis_term, e.version, e.status, e.submitted_at, e.decided_at, e.decided_by_label, e.decision_note,
         coalesce((select jsonb_agg(jsonb_build_object('code', l.subject_code, 'subject', l.subject, 'units', l.units, 'grade', l.grade) order by l.subject_code) from public.renewal_self_grade_lines l where l.submission_id = e.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('name', x.file_name, 'path', x.storage_path, 'mime', x.mime_type) order by x.uploaded_at) from public.renewal_self_grade_files x where x.submission_id = e.id), '[]'::jsonb),
         e.differences, e.official_checked_at,
         exists (select 1 from public.school_period_submissions sp join public.academic_periods ap on ap.id = sp.period_id
                 where sp.school_id = s.school_id and ap.school_year = e.basis_school_year and ap.term = e.basis_term and sp.status = 'submitted'),
         exists (select 1 from public.school_grading_configs c where c.school_id = s.school_id and c.passing_mark is not null),
         (select count(*) from public.renewal_self_grade_submissions o where o.scholar_id_number = e.scholar_id_number and o.id <> e.id and o.status <> 'superseded'),
         v_decide and e.status = 'pending', count(*) over ()
  from public.renewal_self_grade_submissions e
  join public.scholars s on s.scholar_id_number = e.scholar_id_number
  where e.status <> 'superseded' and (coalesce(p_status, 'pending') = 'all' or e.status = coalesce(p_status, 'pending'))
    and (v_q is null or e.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by case when e.status = 'pending' then 0 else 1 end, case when e.status = 'pending' then e.submitted_at end asc, e.decided_at desc nulls last, e.submitted_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_self_grades_list(text, text, integer, integer) from public, anon;
grant execute on function public.renewal_self_grades_list(text, text, integer, integer) to authenticated;

create or replace function public.renewal_self_grades_counts()
returns table(pending bigint, approved bigint, returned bigint, differing bigint, can_decide boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_view_renewals() or public.can_approve_scholar_grades()) then raise exception 'Not authorized to view entered grades.'; end if;
  return query select count(*) filter (where e.status = 'pending'), count(*) filter (where e.status = 'approved'), count(*) filter (where e.status = 'returned'),
    count(*) filter (where e.status <> 'superseded' and e.differences is not null and jsonb_array_length(e.differences) > 0), public.can_approve_scholar_grades()
  from public.renewal_self_grade_submissions e where e.status <> 'superseded';
end;
$$;
revoke all on function public.renewal_self_grades_counts() from public, anon;
grant execute on function public.renewal_self_grades_counts() to authenticated;

-- When the school uploads (submits) its grades for a semester: compare them with what the scholars entered, tell the scholars, alert the approvers and evaluators about differences,
-- and check the applications again (the school's grades are the ones that count from then on).
create or replace function public._renewal_self_grades_on_school_submit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  sub record;
  r record;
  v_diffs jsonb;
  v_label text;
  v_n integer;
begin
  select ap.school_year, ap.term into p from public.academic_periods ap where ap.id = new.period_id;
  if not found then return null; end if;
  v_label := public._renewal_term_label(p.school_year, p.term);
  for sub in
    select e.* from public.renewal_self_grade_submissions e join public.scholars sc on sc.scholar_id_number = e.scholar_id_number
    where sc.school_id = new.school_id and e.basis_school_year = p.school_year and e.basis_term = p.term and e.status in ('pending', 'approved')
  loop
    v_diffs := public._eg_differences(sub.id);
    v_n := jsonb_array_length(v_diffs);
    update public.renewal_self_grade_submissions set official_checked_at = now(), differences = v_diffs where id = sub.id;
    if v_n = 0 then
      perform public._notify_scholar(sub.scholar_id_number, 'grades_school_uploaded', 'Your school uploaded your grades',
        'Your school uploaded your grades for ' || v_label || '. They match the grades you entered. The school''s grades are now the ones that count.', sub.record_id);
    else
      perform public._notify_scholar(sub.scholar_id_number, 'grades_school_uploaded', 'Your school uploaded your grades',
        'Your school uploaded your grades for ' || v_label || '. ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' differ from what you entered. The school''s grades are now the ones that count, and the evaluator will review the differences.', sub.record_id);
      perform public._eg_notify_approvers('Entered grades differ from the school''s grades', public._renewal_scholar_label(sub.scholar_id_number) || ': ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' differ for ' || v_label || '.', sub.record_id, public._renewal_scholar_label(sub.scholar_id_number), true);
    end if;
  end loop;
  -- scholars who applied but entered nothing: they are told too
  for r in
    select rec.id, rec.scholar_id_number from public.renewal_records rec join public.scholars sc on sc.scholar_id_number = rec.scholar_id_number
    where sc.school_id = new.school_id and rec.basis_school_year = p.school_year and rec.basis_term = p.term
      and rec.stage not in ('renewed', 'removed', 'reconsidered', 'division_head_approved', 'not_required', 'late_declined', 'returned')
      and not exists (select 1 from public.renewal_self_grade_submissions e where e.scholar_id_number = rec.scholar_id_number and e.basis_school_year = p.school_year and e.basis_term = p.term and e.status in ('pending', 'approved'))
  loop
    perform public._notify_scholar(r.scholar_id_number, 'grades_school_uploaded', 'Your school uploaded your grades', 'Your school uploaded your grades for ' || v_label || '. We are checking them for your renewal.', r.id);
  end loop;
  for r in
    select rec.id from public.renewal_records rec join public.scholars sc on sc.scholar_id_number = rec.scholar_id_number
    where sc.school_id = new.school_id and rec.basis_school_year = p.school_year and rec.basis_term = p.term
  loop
    perform public._renewal_recheck(r.id);
  end loop;
  return null;
end;
$$;
revoke all on function public._renewal_self_grades_on_school_submit() from public, anon, authenticated;
drop trigger if exists renewal_self_grades_on_school_submit on public.school_period_submissions;
create trigger renewal_self_grades_on_school_submit after insert or update of status on public.school_period_submissions
  for each row when (new.status = 'submitted') execute function public._renewal_self_grades_on_school_submit();

-- The approver opens the images (the folder of a scholar is readable by the scholar and by renewal staff; now also by the Grades Approver).
drop policy if exists "scholar or staff reads renewal documents" on storage.objects;
create policy "scholar or staff reads renewal documents" on storage.objects for select
  using (bucket_id = 'renewal-documents' and ((storage.foldername(name))[1] = public.current_scholar_id_number() or public.can_view_renewals() or public.can_approve_scholar_grades()));

-- ── Setting up a school's grading system for the time being (Scholars' Grades Monitoring staff) ──
create or replace function public.grading_setup_schools()
returns table(school_id uuid, name text, scholars bigint, has_setup boolean, passing_mark numeric, set_by_staff boolean, letters bigint, marks bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  return query
  select sc.id, sc.name, (select count(*) from public.scholars s where s.school_id = sc.id and s.status not in ('Removed', 'On leave')),
         c.school_id is not null, c.passing_mark, coalesce(c.set_by_staff, false),
         (select count(*) from public.school_letter_grades l where l.school_id = sc.id), (select count(*) from public.school_marks m where m.school_id = sc.id)
  from public.schools sc left join public.school_grading_configs c on c.school_id = sc.id
  order by sc.name;
end;
$$;
revoke all on function public.grading_setup_schools() from public, anon;
grant execute on function public.grading_setup_schools() to authenticated;

create or replace function public.grading_setup_get(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.school_grading_configs%rowtype;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  select * into c from public.school_grading_configs where school_id = p_school_id;
  return jsonb_build_object(
    'school', (select sc.name from public.schools sc where sc.id = p_school_id),
    'config', case when c.school_id is null then null else jsonb_build_object('scale_min', c.scale_min, 'scale_max', c.scale_max, 'direction', c.direction, 'uses_letter_grades', c.uses_letter_grades,
        'passing_mark', c.passing_mark, 'set_by_staff', c.set_by_staff, 'staff_note', c.staff_note, 'staff_set_at', c.staff_set_at) end,
    'letters', coalesce((select jsonb_agg(jsonb_build_object('letter', l.letter, 'numeric_value', l.numeric_value) order by l.letter) from public.school_letter_grades l where l.school_id = p_school_id), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('mark', m.mark, 'meaning', m.meaning, 'outcome', m.outcome) order by m.mark) from public.school_marks m where m.school_id = p_school_id), '[]'::jsonb));
end;
$$;
revoke all on function public.grading_setup_get(uuid) from public, anon;
grant execute on function public.grading_setup_get(uuid) to authenticated;

-- Saves the whole setup of a school at once and marks it "set by staff, temporary" (the school's own save clears the mark).
--   p_config: {"scale_min": 1, "scale_max": 5, "direction": "lower_is_better", "passing_mark": 3, "uses_letter_grades": false}
--   p_letters: [{"letter": "A", "numeric_value": 4}, ...]      p_marks: [{"mark": "F", "meaning": "Failed", "outcome": "failed"}, ...]   (outcome: passed | failed | incomplete | review)
create or replace function public.grading_setup_save(p_school_id uuid, p_config jsonb, p_letters jsonb, p_marks jsonb, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min numeric; v_max numeric; v_pass numeric; v_dir text; v_letters boolean;
  v_row jsonb;
  v_text text; v_meaning text; v_outcome text;
  v_seen text[] := '{}';
  v_num numeric;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  if not exists (select 1 from public.schools where id = p_school_id) then raise exception 'That school was not found.'; end if;
  begin v_min := (p_config ->> 'scale_min')::numeric; v_max := (p_config ->> 'scale_max')::numeric; v_pass := (p_config ->> 'passing_mark')::numeric; exception when others then raise exception 'The scale and the passing mark must be numbers.'; end;
  v_dir := coalesce(p_config ->> 'direction', 'lower_is_better');
  v_letters := coalesce((p_config ->> 'uses_letter_grades')::boolean, false);
  if v_min is null or v_max is null or v_min >= v_max then raise exception 'The lowest grade must be smaller than the highest grade.'; end if;
  if v_dir not in ('lower_is_better', 'higher_is_better') then raise exception 'Choose whether a lower or a higher number is better.'; end if;
  if v_pass is null or v_pass < v_min or v_pass > v_max then raise exception 'The passing mark must be on the school''s scale (from % to %).', v_min, v_max; end if;
  if jsonb_typeof(coalesce(p_letters, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then raise exception 'The lists of letters and marks are not valid.'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb)) loop
    v_text := btrim(coalesce(v_row ->> 'letter', ''));
    if v_text = '' or char_length(v_text) > 12 then raise exception 'Every letter grade needs a letter (12 characters at most).'; end if;
    if lower(v_text) = any (v_seen) then raise exception 'The letter "%" is listed twice.', v_text; end if;
    v_seen := v_seen || lower(v_text);
    if v_row ->> 'numeric_value' is not null and btrim(v_row ->> 'numeric_value') <> '' then
      begin v_num := (v_row ->> 'numeric_value')::numeric; exception when others then raise exception 'The number for "%" is not valid.', v_text; end;
    end if;
  end loop;
  v_seen := '{}';
  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    v_text := btrim(coalesce(v_row ->> 'mark', '')); v_meaning := btrim(coalesce(v_row ->> 'meaning', '')); v_outcome := coalesce(v_row ->> 'outcome', '');
    if v_text = '' or char_length(v_text) > 12 then raise exception 'Every mark needs the mark itself (12 characters at most).'; end if;
    if v_text ~ '^\d+([.,]\d+)?$' then raise exception 'The mark "%" is a number; numbers are graded on the scale, not added here.', v_text; end if;
    if upper(v_text) in ('INC', 'DRP') then raise exception 'INC and DRP are built in and cannot be changed.'; end if;
    if v_meaning = '' or char_length(v_meaning) > 120 then raise exception 'Say what "%" stands for (120 characters at most).', v_text; end if;
    if v_outcome not in ('passed', 'failed', 'incomplete', 'review') then raise exception 'Choose what "%" means for renewal.', v_text; end if;
    if lower(v_text) = any (v_seen) then raise exception 'The mark "%" is listed twice.', v_text; end if;
    v_seen := v_seen || lower(v_text);
  end loop;

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, passing_mark, set_by_staff, staff_note, staff_set_at, staff_set_by, updated_at)
  values (p_school_id, v_min, v_max, v_dir, v_letters, v_pass, true, left(btrim(coalesce(p_note, '')), 500), now(), auth.uid(), now())
  on conflict (school_id) do update set scale_min = excluded.scale_min, scale_max = excluded.scale_max, direction = excluded.direction, uses_letter_grades = excluded.uses_letter_grades,
    passing_mark = excluded.passing_mark, set_by_staff = true, staff_note = excluded.staff_note, staff_set_at = excluded.staff_set_at, staff_set_by = excluded.staff_set_by, updated_at = now();
  delete from public.school_letter_grades where school_id = p_school_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb)) loop
    insert into public.school_letter_grades (school_id, letter, numeric_value)
    values (p_school_id, btrim(v_row ->> 'letter'), case when v_row ->> 'numeric_value' is null or btrim(v_row ->> 'numeric_value') = '' then null else (v_row ->> 'numeric_value')::numeric end);
  end loop;
  delete from public.school_marks where school_id = p_school_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    insert into public.school_marks (school_id, mark, meaning, outcome) values (p_school_id, btrim(v_row ->> 'mark'), btrim(v_row ->> 'meaning'), v_row ->> 'outcome');
  end loop;
  -- grades that could not be judged before (no passing mark) can be now: check the applications of that school's scholars again
  perform public._renewal_recheck(r.id) from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where s.school_id = p_school_id and r.stage in ('waiting_grades', 'review_needed', 'sdp_on_hold', 'submitted');
end;
$$;
revoke all on function public.grading_setup_save(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.grading_setup_save(uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- When the SCHOOL itself changes its grading system, the "set by staff, temporary" mark goes away.
create or replace function public._grading_staff_mark_cleared_by_school()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := case when tg_op = 'DELETE' then old.school_id else new.school_id end;
begin
  if public.current_school_id() is not null then
    update public.school_grading_configs set set_by_staff = false where school_id = v_school and set_by_staff;
  end if;
  return null;
end;
$$;
revoke all on function public._grading_staff_mark_cleared_by_school() from public, anon, authenticated;
drop trigger if exists grading_staff_mark_cleared_config on public.school_grading_configs;
create trigger grading_staff_mark_cleared_config after update on public.school_grading_configs for each row execute function public._grading_staff_mark_cleared_by_school();
drop trigger if exists grading_staff_mark_cleared_letters on public.school_letter_grades;
create trigger grading_staff_mark_cleared_letters after insert or update or delete on public.school_letter_grades for each row execute function public._grading_staff_mark_cleared_by_school();
drop trigger if exists grading_staff_mark_cleared_marks on public.school_marks;
create trigger grading_staff_mark_cleared_marks after insert or update or delete on public.school_marks for each row execute function public._grading_staff_mark_cleared_by_school();

-- The renewal check. Same stages and rules as before; the grades part also counts the scholar's APPROVED entered grades while the school has not uploaded, says so, and waits for the
-- Grades Approver while a try is pending.
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
  v_rc public.sdp_reconsideration_requests%rowtype;
  v_req jsonb;
  v_next record;
  v_self public.renewal_self_grade_submissions%rowtype;
  v_use_self boolean := false;
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
  v_study_have integer := 0;  v_inc_have integer := 0;  v_prosp_have integer := 0;  v_study_approved integer := 0;  v_inc_approved integer := 0;
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
    -- what each category needs (3, plus what the scholar owes for this semester), what is lacking, and the semester after (where a reconsideration's lacking credits are added)
    v_req := public._sdp_required_map(p_scholar_id_number, v_b_year, v_b_term);
    select n.school_year, n.semester into v_next from public._sdp_next_semester(v_b_year, v_b_term) n;
    v_sdp_json := v_sdp_json || jsonb_build_object('required', v_req,
      'lacking', jsonb_build_object(
        'community_service', greatest(0, (v_req ->> 'community_service')::integer - coalesce((v_sdp_json ->> 'community_service')::integer, 0)),
        'community_volunteerism', greatest(0, (v_req ->> 'community_volunteerism')::integer - coalesce((v_sdp_json ->> 'community_volunteerism')::integer, 0)),
        'formation_program', greatest(0, (v_req ->> 'formation_program')::integer - coalesce((v_sdp_json ->> 'formation_program')::integer, 0))),
      'next_school_year', v_next.school_year, 'next_semester', v_next.semester);
  end if;
  -- the scholar's SDP reconsideration request for this term, if there is one (an approved one already made the check above say "complied")
  select * into v_rc from public.sdp_reconsideration_requests r where r.scholar_id_number = p_scholar_id_number and r.school_year = p_school_year and r.term = p_term;
  if found then
    v_sdp_json := v_sdp_json || jsonb_build_object('reconsideration', jsonb_build_object('id', v_rc.id, 'status', v_rc.status, 'requested_at', v_rc.requested_at,
      'decided_at', v_rc.decided_at, 'note', v_rc.decision_note, 'lacking', v_rc.lacking));
    if v_rc.status = 'approved' then v_sdp_json := v_sdp_json || jsonb_build_object('by_reconsideration', true); end if;
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
    -- the grades the scholar entered in the portal for this semester (the newest try that is waiting or approved)
    select * into v_self from public.renewal_self_grade_submissions e where e.scholar_id_number = p_scholar_id_number and e.basis_school_year = v_b_year and e.basis_term = v_b_term
      and e.status in ('pending', 'approved') order by e.version desc limit 1;
    if not v_submitted then
      if v_self.status = 'approved' then
        v_use_self := true;     -- the school has not uploaded yet: the entered grades the Grades Approver approved count as the scholar's grades
      elsif v_self.status = 'pending' then
        v_state := 'waiting';
        v_reason := 'The grades you entered for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are waiting for the Grades Approver.';
      else
        v_state := 'waiting';
        v_reason := 'Your school has not submitted its grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.';
      end if;
    end if;
  end if;

  if v_state = 'ready' or v_state = 'waiting' then
    for g in
      select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id
      from public.scholar_subjects_grades r
      where not v_use_self and r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term
      union all
      select l.id, l.subject_code, l.subject, l.grade, null::uuid
      from public.renewal_self_grade_lines l
      where v_use_self and l.submission_id = v_self.id
      order by 2, 3
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
    select count(*) filter (where d.kind = 'study_plan'), count(*) filter (where d.kind = 'inc_letter'), count(*) filter (where d.kind = 'prospectus'),
           count(*) filter (where d.kind = 'study_plan' and d.status = 'accepted'), count(*) filter (where d.kind = 'inc_letter' and d.status = 'accepted')
      into v_study_have, v_inc_have, v_prosp_have, v_study_approved, v_inc_approved
    from public.renewal_documents d where d.record_id = v_rec.id and d.status <> 'returned';
  end if;
  if v_need_study then
    -- "satisfied" = uploaded; "approved" = the evaluator accepted it (the scholar cannot book a consultation, and the case cannot be endorsed, before that).
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'study_plan', 'label', 'Study plan', 'satisfied', v_study_have > 0, 'approved', v_study_approved > 0));
    if v_study_have = 0 or v_study_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_inc then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'inc_letter', 'label', 'INC letter from your dean', 'satisfied', v_inc_have > 0, 'approved', v_inc_approved > 0));
    if v_inc_have = 0 or v_inc_approved = 0 then v_docs_complete := false; end if;
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
    v_code := 'SDP_HOLD';
    v_text := case when v_rc.status = 'pending' then 'SDP is not complied: an SDP reconsideration was requested and is waiting for a decision. It is re-checked automatically.'
                   when v_rc.status = 'denied' then 'SDP is not complied: the SDP reconsideration request was denied, so the application is on hold until the missing credits are recorded. It is re-checked automatically.'
                   else 'SDP is not complied: the application is on hold until the missing credits are recorded. It is re-checked automatically.' end;
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
      'self_reported', v_use_self, 'self_status', v_self.status, 'self_submission_id', v_self.id,
      'counts', jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_failed, 'drp', v_drp, 'inc', v_inc, 'review', v_review, 'ungraded', v_ungraded),
      'failed_subjects', v_failed_list, 'inc_subjects', v_inc_list, 'review_subjects', v_review_list),
    'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consultation_required', v_consult_required, 'consultation_done', v_consult_done);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
