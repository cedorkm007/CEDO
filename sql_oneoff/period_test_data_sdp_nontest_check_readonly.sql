-- ─────────────────────────────────────────────────────────────
-- THE SDP CREDITS THAT STOPPED THE PERIOD REVERT: WHOSE ARE THEY AND WHEN WERE THEY MADE?   READ-ONLY.   Nothing is changed or deleted.
-- The revert stopped because credits of two scholars who are not test accounts are stamped with the 2026-2027 2nd Semester (the semester that was opened for the test).
-- A credit gets the semester that is "current" at the moment it is given, so a REAL scan made while the 2nd Semester was current carries that stamp. This lists those credits
-- (Scholar ID, activity, category, credits, dates) and each scholar's other credits in 2026-2027, so we can see what they really are. No names. Send me all the rows.
-- ─────────────────────────────────────────────────────────────
with t as (select coalesce(array_agg(distinct x), '{}') as ids from public.renewal_windows w, unnest(w.testers) x where w.testers is not null),
odd as (
  select a.*, to_jsonb(a) as j from public.sdp_attendance a, t
  where a.school_year = '2026-2027' and a.semester = '2nd Semester' and not (a.scholar_id_number = any (t.ids))
)
select 1 as n, 'THE TESTS BEGAN (first renewal window created)' as part, '' as scholar, to_char((select min(created_at) from public.renewal_windows) at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as detail
union all select 2, 'GRADING PERIOD NOW', '', (select gps.current_school_year || ' ' || gps.current_semester from public.grading_period_settings gps where gps.id = true)
union all select 3, 'THE 2ND SEMESTER 2026-2027 PERIOD WAS CREATED', '', coalesce((select to_char(p.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') from public.academic_periods p where p.school_year = '2026-2027' and p.term = '2nd Semester'), 'no such period')
union all select 4, 'CREDIT STAMPED 2nd Semester', o.scholar_id_number,
  coalesce(act.name, '(activity removed)') || ' | ' || coalesce(act.category, '?') || ' | ' || coalesce(act.credits::text, '?') || ' credit(s) | day credited ' || coalesce(o.attended_date::text, '?')
  || ' | activity day ' || coalesce(o.activity_day::text, '-') || ' | made ' || coalesce(to_char((o.j ->> 'created_at')::timestamptz at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '?')
  || ' | by ' || case when o.j ->> 'created_by' is null then 'nobody signed in (a scan or a script)' else 'a staff account' end
  from odd o left join public.sdp_activities act on act.id = o.activity_id
union all select 5, 'SAME SCHOLAR, OTHER CREDITS IN 2026-2027', a.scholar_id_number,
  coalesce(a.semester, '?') || ' | ' || coalesce(act.name, '(activity removed)') || ' | day ' || coalesce(a.attended_date::text, '?')
  from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
  where a.school_year = '2026-2027' and a.scholar_id_number in (select scholar_id_number from odd) and not (a.semester = '2nd Semester')
order by 1, 3, 4;
