-- ─────────────────────────────────────────────────────────────
-- REVERT THE TEST DATA LEFT IN THE GRADING PERIODS AND THE SDP CREDITS.   Run it TWICE: first as it is (a DRY RUN that only counts and lists), then with 'YES'.
--
-- WHAT THE CHECK SHOWED: the 2nd Semester 2026-2027 was opened for testing (4 grades from one school, 1 submission, no SDP credit in it); the current grading period is
-- already back on the 1st Semester. A few grades were also entered by the same test setup in the 1st Semester 2026-2027, with 1 submission and 1 correction request.
--
-- WHAT IT REMOVES (and only this):
--   2nd Semester 2026-2027 (opened for the test): its grades, submissions, correction requests, evidence files' records, and the period itself (a real 2nd semester is
--     opened again later, normally);
--   1st Semester 2026-2027 (the REAL semester): only the grades of the TEST accounts entered since the renewal tests began, the correction requests of those, and the
--     school's submission ONLY IF the school has no other grade left in that period. (An old test submission would otherwise keep that school LOCKED out of entering
--     its real 1st-semester grades.);
--   the grade-change lines (audit) of the test accounts in those two periods since the tests began;
--   SDP credits of the TEST accounts that were added since the renewal tests began, in any semester (their renewal needs have gone with the renewal test data);
--   SDP credits stamped with the 2nd Semester 2026-2027 that belong to the THREE scholars you named (2306-01451, 2507-00328 and 2306-00134): you asked for these to be
--     removed too, although they are not test accounts. Only credits stamped with that semester, only those three scholars. Their credits in any other semester stay.
-- WHAT IT KEEPS: every credit and grade of every other scholar; the current grading period (already the 1st Semester); the 1st Semester 2026-2027 period itself; credits
--   set aside for later; the SDP credit HISTORY (it cannot be edited by design: removing a credit adds a "credit removed" line to it, it does not erase the old lines).
-- SAFETY: it STOPS and changes nothing if it finds a grade, credit or correction request in these two periods that belongs to someone who is NOT a test account (it lists
--   their Scholar IDs), or a school that still has other grades in the 1st Semester but a submission to remove. Before it removes anything it COPIES every row to a
--   locked holding table (public._period_test_backup). It lists the evidence FILES to delete by hand (Storage), because a SQL file cannot delete files.
-- Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_confirm text := 'NO';     -- <<<<<  CHANGE 'NO' TO 'YES' (keep the quotes) for the second run, the one that removes
  v_year text := '2026-2027';
  v_test_term text := '2nd Semester';        -- the semester that was opened for testing
  v_real_term text := '1st Semester';        -- the real semester (only the test accounts' entries are removed from it)
  v_testers text[];
  v_extra text[] := array['2306-01451', '2507-00328', '2306-00134'];     -- the three scholars (not test accounts) whose 2nd-Semester-stamped credits you asked to remove as well
  v_start timestamptz;
  v_p2 uuid; v_p1 uuid;
  v_bad text;
  v_n bigint;
  f record;
begin
  drop table if exists pg_temp._rv;
  create temp table _rv (n serial, step text, what text, rows bigint);

  select coalesce(array_agg(distinct t), '{}') into v_testers from public.renewal_windows w, unnest(w.testers) t where w.testers is not null;
  select min(created_at) into v_start from public.renewal_windows;
  select id into v_p2 from public.academic_periods where school_year = v_year and term = v_test_term;
  select id into v_p1 from public.academic_periods where school_year = v_year and term = v_real_term;
  insert into _rv (step, what, rows) values ('0. TEST ACCOUNTS', array_to_string(v_testers, ', '), cardinality(v_testers)), ('0. TESTS BEGAN', to_char(v_start at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), 0);
  if cardinality(v_testers) = 0 or v_start is null then raise exception 'STOPPED, nothing changed: the list of test accounts or the start of the tests cannot be found (the testers-only renewal window is needed). Tell me.'; end if;

  -- ── stop if anything that is NOT a test account's is involved ──
  select string_agg(distinct g.scholar_id_number, ', ') into v_bad from public.scholar_subjects_grades g
    where ((g.school_year = v_year and g.semester = v_test_term) or (g.school_year = v_year and g.semester = v_real_term and g.created_at >= v_start)) and not (g.scholar_id_number = any (v_testers));
  if v_bad is not null then raise exception 'STOPPED, nothing changed: grades of people who are not test accounts were entered in these periods: %. Tell me, do not run this.', v_bad; end if;
  select string_agg(distinct a.scholar_id_number, ', ') into v_bad from public.sdp_attendance a where a.school_year = v_year and a.semester = v_test_term and not (a.scholar_id_number = any (v_testers) or a.scholar_id_number = any (v_extra));
  if v_bad is not null then raise exception 'STOPPED, nothing changed: SDP credits of people who are not test accounts are stamped with the % %: %. They may be real scans. Tell me, do not run this.', v_year, v_test_term, v_bad; end if;
  select string_agg(distinct q.scholar_id_number, ', ') into v_bad from public.grade_correction_requests q
    where (q.period_id = v_p2 or q.period_id = v_p1) and q.requested_at >= v_start and not (q.scholar_id_number = any (v_testers));
  if v_bad is not null then raise exception 'STOPPED, nothing changed: correction requests of people who are not test accounts: %. Tell me, do not run this.', v_bad; end if;
  -- a submission in the real semester may only go if every grade of that school in it is a test grade
  select string_agg(distinct s.school_id::text, ', ') into v_bad from public.school_period_submissions s
    where s.period_id = v_p1 and s.created_at >= v_start
      and exists (select 1 from public.scholar_subjects_grades g where g.recorded_by_school_id = s.school_id and g.school_year = v_year and g.semester = v_real_term
                    and not (g.scholar_id_number = any (v_testers) and g.created_at >= v_start));
  if v_bad is not null then raise exception 'STOPPED, nothing changed: a school that submitted for the % % also has grades of other scholars in it (school id %). Tell me, do not run this.', v_year, v_real_term, v_bad; end if;

  -- ── what would be removed ──
  insert into _rv (step, what, rows) values
    ('1. REMOVE', 'grades in ' || v_test_term || ' ' || v_year || ' (the semester opened for the test)', (select count(*) from public.scholar_subjects_grades where school_year = v_year and semester = v_test_term)),
    ('1. REMOVE', 'grades of the test accounts in the REAL ' || v_real_term || ' ' || v_year || ', entered since the tests began', (select count(*) from public.scholar_subjects_grades where school_year = v_year and semester = v_real_term and created_at >= v_start and scholar_id_number = any (v_testers))),
    ('1. REMOVE', 'school submissions (they lock a school out of entering grades)', (select count(*) from public.school_period_submissions s where s.period_id = v_p2 or (s.period_id = v_p1 and s.created_at >= v_start))),
    ('1. REMOVE', 'submission history lines', (select count(*) from public.school_submission_events e where e.period_id = v_p2 or (e.period_id = v_p1 and e.created_at >= v_start))),
    ('1. REMOVE', 'grade correction requests', (select count(*) from public.grade_correction_requests q where q.period_id = v_p2 or (q.period_id = v_p1 and q.requested_at >= v_start))),
    ('1. REMOVE', 'evidence file records', (select count(*) from public.grade_documents d where d.period_id = v_p2 or (d.period_id = v_p1 and d.uploaded_at >= v_start and d.scholar_id_number = any (v_testers)))),
    ('1. REMOVE', 'grade-change (audit) lines of the test accounts in these two periods since the tests began', (select count(*) from public.scholar_grade_audit a where a.scholar_id_number = any (v_testers) and a.school_year = v_year and a.semester in (v_test_term, v_real_term) and a.changed_at >= v_start)),
    ('1. REMOVE', 'the period ' || v_test_term || ' ' || v_year || ' itself', (select count(*) from public.academic_periods where id = v_p2)),
    ('1. REMOVE', 'SDP credits of the test accounts added since the tests began (any semester)', (select count(*) from public.sdp_attendance a where a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start)),
    ('1. REMOVE', 'SDP credits of the named scholars (' || array_to_string(v_extra, ', ') || ') stamped ' || v_test_term || ' ' || v_year, (select count(*) from public.sdp_attendance a where a.scholar_id_number = any (v_extra) and a.school_year = v_year and a.semester = v_test_term)),
    ('1. KEPT', 'SDP credits of the named scholars in any other semester (they stay)', (select count(*) from public.sdp_attendance a where a.scholar_id_number = any (v_extra) and not (a.school_year = v_year and a.semester = v_test_term))),
    ('1. KEPT', 'grades in the REAL ' || v_real_term || ' ' || v_year || ' that stay', (select count(*) from public.scholar_subjects_grades where school_year = v_year and semester = v_real_term) - (select count(*) from public.scholar_subjects_grades where school_year = v_year and semester = v_real_term and created_at >= v_start and scholar_id_number = any (v_testers))),
    ('1. KEPT', 'SDP credits of everyone else in ' || v_year || ' ' || v_real_term, (select count(*) from public.sdp_attendance a where a.school_year = v_year and a.semester = v_real_term and not (a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start)));
  for f in select g.scholar_id_number s, g.semester sem, count(*) c from public.scholar_subjects_grades g
            where (g.school_year = v_year and g.semester = v_test_term) or (g.school_year = v_year and g.semester = v_real_term and g.created_at >= v_start and g.scholar_id_number = any (v_testers)) group by 1, 2 order by 2, 1 loop
    insert into _rv (step, what, rows) values ('2. GRADES to remove, by scholar', f.s || ' · ' || f.sem, f.c);
  end loop;
  for f in select coalesce(act.name, '(activity removed)') nm, a.school_year y, a.semester sem, count(*) c from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
            where a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start group by 1, 2, 3 order by 1 loop
    insert into _rv (step, what, rows) values ('3. SDP CREDITS to remove, by activity', f.nm || ' · ' || coalesce(f.y, '?') || ' ' || coalesce(f.sem, ''), f.c);
  end loop;
  for f in select a.scholar_id_number s, coalesce(act.name, '(activity removed)') nm, coalesce(act.category, '?') cat, coalesce(act.credits::text, '?') cr, coalesce(a.attended_date::text, '?') dy
            from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
            where a.scholar_id_number = any (v_extra) and a.school_year = v_year and a.semester = v_test_term order by 1, 5 loop
    insert into _rv (step, what, rows) values ('3b. CREDIT OF A NAMED SCHOLAR to remove', f.s || ' · ' || f.nm || ' · ' || f.cat || ' · ' || f.cr || ' credit(s) · day ' || f.dy, 1);
  end loop;
  for f in select d.storage_path from public.grade_documents d where d.period_id = v_p2 or (d.period_id = v_p1 and d.uploaded_at >= v_start and d.scholar_id_number = any (v_testers)) loop
    insert into _rv (step, what, rows) values ('4. FILE TO DELETE BY HAND (Storage > the grade documents folder)', f.storage_path, 1);
  end loop;

  if v_confirm <> 'YES' then
    insert into _rv (step, what, rows) values ('RESULT', 'DRY RUN: nothing was changed. If these numbers are what you expect, change ''NO'' to ''YES'' at the top and run again.', 0);
    return;
  end if;

  -- ── copy everything that is about to go into a locked holding table ──
  create table if not exists public._period_test_backup (id bigserial primary key, table_name text not null, row_data jsonb not null, saved_at timestamptz not null default now());
  alter table public._period_test_backup enable row level security;
  revoke all on public._period_test_backup from anon, authenticated;
  insert into public._period_test_backup (table_name, row_data)
    select 'scholar_subjects_grades', to_jsonb(g) from public.scholar_subjects_grades g
      where (g.school_year = v_year and g.semester = v_test_term) or (g.school_year = v_year and g.semester = v_real_term and g.created_at >= v_start and g.scholar_id_number = any (v_testers))
    union all select 'school_period_submissions', to_jsonb(s) from public.school_period_submissions s where s.period_id = v_p2 or (s.period_id = v_p1 and s.created_at >= v_start)
    union all select 'school_submission_events', to_jsonb(e) from public.school_submission_events e where e.period_id = v_p2 or (e.period_id = v_p1 and e.created_at >= v_start)
    union all select 'grade_correction_requests', to_jsonb(q) from public.grade_correction_requests q where q.period_id = v_p2 or (q.period_id = v_p1 and q.requested_at >= v_start)
    union all select 'grade_documents', to_jsonb(d) from public.grade_documents d where d.period_id = v_p2 or (d.period_id = v_p1 and d.uploaded_at >= v_start and d.scholar_id_number = any (v_testers))
    union all select 'scholar_grade_audit', to_jsonb(a) from public.scholar_grade_audit a where a.scholar_id_number = any (v_testers) and a.school_year = v_year and a.semester in (v_test_term, v_real_term) and a.changed_at >= v_start
    union all select 'academic_periods', to_jsonb(p) from public.academic_periods p where p.id = v_p2
    union all select 'sdp_attendance', to_jsonb(a) from public.sdp_attendance a where a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start
    union all select 'sdp_attendance', to_jsonb(a) from public.sdp_attendance a where a.scholar_id_number = any (v_extra) and a.school_year = v_year and a.semester = v_test_term
      and not (a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start);
  select count(*) into v_n from public._period_test_backup;
  insert into _rv (step, what, rows) values ('5. BACKED UP', 'rows copied to public._period_test_backup (locked table)', v_n);

  -- ── remove (in the order the links allow) ──
  delete from public.grade_correction_requests q where q.period_id = v_p2 or (q.period_id = v_p1 and q.requested_at >= v_start);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'correction requests', v_n);
  delete from public.grade_documents d where d.period_id = v_p2 or (d.period_id = v_p1 and d.uploaded_at >= v_start and d.scholar_id_number = any (v_testers));
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'evidence file records', v_n);
  delete from public.school_submission_events e where e.period_id = v_p2 or (e.period_id = v_p1 and e.created_at >= v_start);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'submission history lines', v_n);
  delete from public.school_period_submissions s where s.period_id = v_p2 or (s.period_id = v_p1 and s.created_at >= v_start);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'submissions', v_n);
  delete from public.scholar_subjects_grades g
    where (g.school_year = v_year and g.semester = v_test_term) or (g.school_year = v_year and g.semester = v_real_term and g.created_at >= v_start and g.scholar_id_number = any (v_testers));
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'grades', v_n);
  -- removing the grades wrote "deleted" lines into the audit trail; the test accounts' lines in these periods go too, so the trail shows nothing of the test
  delete from public.scholar_grade_audit a where a.scholar_id_number = any (v_testers) and a.school_year = v_year and a.semester in (v_test_term, v_real_term) and a.changed_at >= v_start;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'grade-change (audit) lines', v_n);
  delete from public.academic_periods where id = v_p2;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'the period ' || v_test_term || ' ' || v_year, v_n);
  delete from public.sdp_attendance a where a.scholar_id_number = any (v_testers) and (to_jsonb(a) ->> 'created_at')::timestamptz >= v_start;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'SDP credits of the test accounts', v_n);
  delete from public.sdp_attendance a where a.scholar_id_number = any (v_extra) and a.school_year = v_year and a.semester = v_test_term;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('6. REMOVED', 'SDP credits of the named scholars stamped ' || v_test_term || ' ' || v_year, v_n);

  insert into _rv (step, what, rows) values ('RESULT', 'DONE. Delete the evidence file(s) listed above by hand. The copy is in public._period_test_backup until you drop it (period_test_data_drop_backup.sql).', 0);
end $$;

select step, what, rows from _rv order by n;
