-- ─────────────────────────────────────────────────────────────
-- WHAT WAS ENTERED IN THE SEMESTER THAT WAS OPENED FOR TESTING?   READ-ONLY.   Nothing is changed or deleted.
--
-- Why: when a semester is opened (the current grading period, or a period schools can enter grades in), SDP credits are stamped with it and schools can enter grades
-- in it. Before anything is deleted I need to see, for EACH semester, how much was entered, by whom (staff, a school, a scan) and when, so I can tell test entries
-- from real ones (a real scan of a real event during those days is real attendance, and deleting it would take a real credit away from a scholar).
-- Choose "Run without RLS" if asked. Send me the result (Export CSV or copy all rows).
-- Personal details are NOT in the result: counts, dates, school names, activity names and Scholar ID numbers only (no scholar names).
-- ─────────────────────────────────────────────────────────────
drop table if exists pg_temp._pt;
create temp table _pt (n serial, part text, item text, value text);

do $$
declare
  r record;
begin
  -- 1. Which semester is "current", and which semesters are open for schools.
  begin
    insert into _pt (part, item, value)
      select '1. CURRENT PERIOD', 'the current grading period (set by staff)', coalesce(nullif(current_school_year, ''), '(none)') || ' · ' || coalesce(nullif(current_semester, ''), '(none)') || ' | last changed ' || to_char(updated_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')
      from public.grading_period_settings;
    for r in select * from public.academic_periods order by school_year, term loop
      insert into _pt (part, item, value) values ('1. PERIODS', r.school_year || ' · ' || r.term,
        'status ' || r.status || ' | deadline ' || coalesce(r.submission_deadline::text, 'none') || ' | made ' || to_char(r.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' | changed ' || to_char(r.updated_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'));
    end loop;
  exception when others then insert into _pt (part, item, value) values ('ERROR', '1. periods', sqlerrm); end;

  -- 2. Grades by semester: how many, which schools, and when they were first and last entered.
  begin
    for r in
      select g.school_year, g.semester, count(*) c, count(distinct g.scholar_id_number) s, count(distinct g.recorded_by_school_id) sch,
             to_char(min(g.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') first_in, to_char(max(g.created_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') last_in,
             to_char(max(g.updated_at) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') last_change, count(*) filter (where g.recorded_by is not null) by_staff
      from public.scholar_subjects_grades g group by g.school_year, g.semester order by g.school_year, g.semester
    loop
      insert into _pt (part, item, value) values ('2. GRADES', r.school_year || ' · ' || r.semester,
        r.c || ' grades, ' || r.s || ' scholars, ' || r.sch || ' schools | first entered ' || r.first_in || ', last entered ' || r.last_in || ', last changed ' || r.last_change || ' | typed by staff: ' || r.by_staff);
    end loop;
  exception when others then insert into _pt (part, item, value) values ('ERROR', '2. grades', sqlerrm); end;

  -- 3. Schools' submissions, correction requests and the grade audit trail, by semester.
  begin
    for r in
      select p.school_year, p.term, count(*) c, string_agg(distinct s.status, ', ') st from public.school_period_submissions s join public.academic_periods p on p.id = s.period_id group by p.school_year, p.term order by 1, 2
    loop insert into _pt (part, item, value) values ('3. SUBMISSIONS', r.school_year || ' · ' || r.term, r.c || ' submission(s), status: ' || r.st); end loop;
    for r in
      select p.school_year, p.term, count(*) c from public.grade_correction_requests q join public.academic_periods p on p.id = q.period_id group by p.school_year, p.term order by 1, 2
    loop insert into _pt (part, item, value) values ('3. CORRECTIONS', r.school_year || ' · ' || r.term, r.c || ' correction request(s)'); end loop;
    for r in
      select a.school_year, a.semester, count(*) c, string_agg(distinct a.source || '/' || a.actor_type, ', ') who, to_char(min(a.changed_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') first_at
      from public.scholar_grade_audit a where a.changed_at >= (select min(created_at) from public.renewal_windows) group by a.school_year, a.semester order by 1, 2
    loop insert into _pt (part, item, value) values ('3. GRADE AUDIT since the renewal tests began', coalesce(r.school_year, '?') || ' · ' || coalesce(r.semester, '?'), r.c || ' change(s) by ' || r.who || ' | first ' || r.first_at); end loop;
  exception when others then insert into _pt (part, item, value) values ('ERROR', '3. submissions / corrections / audit', sqlerrm); end;

  -- 4. SDP credits by semester: how many, how they got there, and which activities.
  begin
    for r in
      select a.school_year, a.semester, count(*) c, count(distinct a.scholar_id_number) s, count(distinct a.activity_id) acts, count(*) filter (where a.created_by is not null) by_staff,
             to_char(min((to_jsonb(a) ->> 'created_at')::timestamptz) at time zone 'Asia/Manila', 'YYYY-MM-DD') first_in, to_char(max((to_jsonb(a) ->> 'created_at')::timestamptz) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') last_in
      from public.sdp_attendance a group by a.school_year, a.semester order by a.school_year nulls first, a.semester
    loop
      insert into _pt (part, item, value) values ('4. SDP CREDITS', coalesce(r.school_year, '(no semester)') || ' · ' || coalesce(r.semester, ''),
        r.c || ' credits, ' || r.s || ' scholars, ' || r.acts || ' activities | added by staff by hand: ' || r.by_staff || ' (the rest: QR scans) | first ' || coalesce(r.first_in, '?') || ', last ' || coalesce(r.last_in, '?'));
    end loop;
    for r in
      select h.school_year, h.semester, h.event_type, h.source, count(*) c, to_char(min(h.occurred_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') first_at, to_char(max(h.occurred_at) at time zone 'Asia/Manila', 'YYYY-MM-DD') last_at
      from public.sdp_credit_history h where h.occurred_at >= (select min(created_at) from public.renewal_windows) group by 1, 2, 3, 4 order by 1, 2, 3, 4
    loop
      insert into _pt (part, item, value) values ('4. SDP HISTORY since the renewal tests began', coalesce(r.school_year, '?') || ' · ' || coalesce(r.semester, '?') || ' · ' || r.event_type || ' · ' || r.source, r.c || ' line(s), ' || r.first_at || ' to ' || r.last_at);
    end loop;
    for r in
      select act.name, act.activity_type, to_char(act.date_time at time zone 'Asia/Manila', 'YYYY-MM-DD') d, (select count(*) from public.sdp_attendance a where a.activity_id = act.id and a.school_year = '2026-2027' and a.semester = '2nd Semester') c,
             to_char(act.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD') made
      from public.sdp_activities act where exists (select 1 from public.sdp_attendance a where a.activity_id = act.id and a.school_year = '2026-2027' and a.semester = '2nd Semester') order by act.date_time
    loop
      insert into _pt (part, item, value) values ('4. SDP CREDITS in 2026-2027 · 2nd Semester, by activity', r.name, r.c || ' credit(s) | ' || r.activity_type || ' | activity date ' || r.d || ' | activity made ' || r.made);
    end loop;
    for r in
      select a.scholar_id_number, count(*) c from public.sdp_attendance a where a.school_year = '2026-2027' and a.semester = '2nd Semester' group by 1 order by 1 limit 200
    loop insert into _pt (part, item, value) values ('4. SCHOLARS with a credit in 2026-2027 · 2nd Semester', r.scholar_id_number, r.c || ' credit(s)'); end loop;
  exception when others then insert into _pt (part, item, value) values ('ERROR', '4. sdp credits', sqlerrm); end;

  -- 5. Credits set aside for later (reserved), and activities made since the renewal tests began.
  begin
    insert into _pt (part, item, value) values
      ('5. RESERVED CREDITS', 'set aside / claimed, from or into 2026-2027 · 2nd Semester', (select count(*) filter (where source_school_year = '2026-2027' and source_semester = '2nd Semester') || ' set aside from it / ' || count(*) filter (where claimed_school_year = '2026-2027' and claimed_semester = '2nd Semester') || ' claimed into it (of ' || count(*) || ' in all)' from public.sdp_reserved_credits));
    for r in select name, activity_type, to_char(date_time at time zone 'Asia/Manila', 'YYYY-MM-DD') d, to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM-DD') made from public.sdp_activities where created_at >= (select min(created_at) from public.renewal_windows) order by created_at loop
      insert into _pt (part, item, value) values ('5. ACTIVITIES made since the renewal tests began', r.name, r.activity_type || ' | activity date ' || r.d || ' | made ' || r.made);
    end loop;
  exception when others then insert into _pt (part, item, value) values ('ERROR', '5. reserved / activities', sqlerrm); end;
end $$;

select part, item, value from _pt order by n;
