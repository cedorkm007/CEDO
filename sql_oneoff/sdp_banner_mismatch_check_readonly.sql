-- ─────────────────────────────────────────────────────────────
-- SDP: SCHOLARS WITH 3 OR MORE CREDITS WHOSE PROFILE BANNER WAS NOT GREEN.   READ-ONLY.   Nothing is changed or deleted.
-- The banner's green / grey marks come from a saved "completed" mark per category; the SDP tab's credits come from the real total of the current period.
-- This lists every scholar and category where the real total is 3 or more but the saved mark is missing or says "not completed", and why it may differ.
-- Scholar ID numbers, categories and numbers only (no names). Send me all the rows (the first row is the summary).
-- ─────────────────────────────────────────────────────────────
with cur as (select gps.current_school_year y, gps.current_semester s from public.grading_period_settings gps where gps.id = true),
tot as (select t.scholar_id_number, t.category, t.total from cur, lateral public._sdp_period_totals(cur.y, cur.s) t where t.total >= public.sdp_category_credit_required()),
life as (select a.scholar_id_number, act.category, sum(act.credits)::int as lifetime from public.sdp_attendance a join public.sdp_activities act on act.id = a.activity_id group by 1, 2),
bad as (
  select t.scholar_id_number, t.category, t.total, coalesce(l.lifetime, 0) as lifetime_attendance_credits, st.completed as saved_mark
  from tot t
  left join public.scholar_sdp_category_status st on st.scholar_id_number = t.scholar_id_number and st.category = t.category
  left join life l on l.scholar_id_number = t.scholar_id_number and l.category = t.category
  join public.scholars s on s.scholar_id_number = t.scholar_id_number and s.status <> 'Removed'
  where st.completed is not true
)
select 0 as n, 'SUMMARY' as scholar_id_number, 'scholar-categories affected: ' || count(*) || ' | scholars: ' || count(distinct scholar_id_number)
         || ' | saved mark missing: ' || count(*) filter (where saved_mark is null) || ' | saved mark says not completed: ' || count(*) filter (where saved_mark = false)
         || ' | credits come only from carry-over / set-aside credit (lifetime attendance < 3): ' || count(*) filter (where lifetime_attendance_credits < 3) as detail
  from bad
union all
select 1, scholar_id_number, category || ': current total ' || total || ', lifetime attendance credits ' || lifetime_attendance_credits || ', saved mark ' || coalesce(saved_mark::text, 'missing') from bad
order by 1, 2, 3;
