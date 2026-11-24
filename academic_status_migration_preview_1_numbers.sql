-- ─────────────────────────────────────────────────────────────
-- academic_status_migration_preview_1_numbers.sql      READ-ONLY: it only COUNTS. It changes nothing, so there is nothing to undo.
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 1A, STEP 1: what would each scholar's academic status be if it were set on the scholar today?
--
--   For every scholar who is not Removed, the status that applies TODAY is:
--     1) the scholar's own status (from the bulk file), if there is one;
--     2) otherwise the placement of the scholar's program in the scholar's school;
--     3) otherwise NOT SET (the scholar is NOT made Academic silently).
--
--   How to use it: paste the whole file in the Supabase SQL Editor and press Run. You get ONE table: a row per school and a last row "ALL SCHOOLS".
--   Please send me that table (a screenshot is fine) or use "Download CSV" under the result. Run the second file (..._2_lists.sql) too if you want the names.
--
--   Columns:
--     school                 the school
--     scholars               scholars of the school who are not Removed
--     academic / non_academic / not_set      how many would get each status
--     from_own_status        of those with a status, how many come from the scholar's OWN status
--     from_program           of those with a status, how many come from their PROGRAM
--     not_set_no_program     not set because the scholar has no program written on the record
--     not_set_program_unplaced  not set because the program is not placed under Academic / Non-academic yet
--     special_program        scholars in a program that has its OWN ("special") passing GWA (and no own status): their special number would be kept as a custom passing GWA
--     academic_passing_gwa / non_academic_passing_gwa     the two numbers set for the school (empty = the GWA rule never triggers for that school)
-- ─────────────────────────────────────────────────────────────

with base as (
  select s.scholar_id_number, s.school_id, nullif(btrim(coalesce(s.course, '')), '') as course,
         o.academic_status as own_status, sp.academic_status as program_status, sp.special_passing_gwa
  from public.scholars s
  left join public.academic_scholar_overrides o on o.scholar_id_number = s.scholar_id_number
  left join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
  where coalesce(s.status, '') <> 'Removed'
), per_school as (
  select coalesce(sc.name, '(no school on record)') as school, sc.id as school_id,
         count(*) as scholars,
         count(*) filter (where coalesce(b.own_status, b.program_status) = 'academic') as academic,
         count(*) filter (where coalesce(b.own_status, b.program_status) = 'non_academic') as non_academic,
         count(*) filter (where coalesce(b.own_status, b.program_status) is null) as not_set,
         count(*) filter (where b.own_status is not null) as from_own_status,
         count(*) filter (where b.own_status is null and b.program_status is not null) as from_program,
         count(*) filter (where coalesce(b.own_status, b.program_status) is null and b.course is null) as not_set_no_program,
         count(*) filter (where coalesce(b.own_status, b.program_status) is null and b.course is not null) as not_set_program_unplaced,
         count(*) filter (where b.own_status is null and b.special_passing_gwa is not null) as special_program
  from base b left join public.schools sc on sc.id = b.school_id
  group by sc.id, sc.name
)
select t.school, t.scholars, t.academic, t.non_academic, t.not_set, t.from_own_status, t.from_program, t.not_set_no_program, t.not_set_program_unplaced, t.special_program, t.academic_passing_gwa, t.non_academic_passing_gwa from (
select p.school, p.scholars, p.academic, p.non_academic, p.not_set, p.from_own_status, p.from_program, p.not_set_no_program, p.not_set_program_unplaced, p.special_program,
       ss.academic_passing_gwa, ss.non_academic_passing_gwa, 1 as sort_order
from per_school p left join public.academic_school_settings ss on ss.school_id = p.school_id
union all
select 'ALL SCHOOLS', sum(scholars), sum(academic), sum(non_academic), sum(not_set), sum(from_own_status), sum(from_program), sum(not_set_no_program), sum(not_set_program_unplaced), sum(special_program), null, null, 2
from per_school
) t
order by t.sort_order, t.school;
