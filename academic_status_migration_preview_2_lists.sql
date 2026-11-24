-- ─────────────────────────────────────────────────────────────
-- academic_status_migration_preview_2_lists.sql      READ-ONLY: it only LISTS. It changes nothing, so there is nothing to undo.
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 1A, STEP 1: the scholars you may want to look at before the migration.
--
--   You get ONE table (use "Download CSV" under the result to open it in Excel). The column "list" says why a scholar is listed:
--     NOT SET - no program on record          the scholar has no program written on the record, so no status can be worked out
--     NOT SET - program not placed            the scholar's program is not placed under Academic / Non-academic for the school
--     SPECIAL PROGRAM                         the program has its own ("special") passing GWA; the number is shown in special_passing_gwa
--     OWN STATUS (from the bulk file)         the scholar already has an own status (shown in status_today)
--   Scholars who are Removed are not listed.
-- ─────────────────────────────────────────────────────────────

with base as (
  select s.scholar_id_number, btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) as name, s.last_name, s.first_name, s.status as scholarship_status, s.year_level,
         sc.name as school, nullif(btrim(coalesce(s.course, '')), '') as program,
         o.academic_status as own_status, sp.academic_status as program_status, sp.special_passing_gwa
  from public.scholars s
  left join public.schools sc on sc.id = s.school_id
  left join public.academic_scholar_overrides o on o.scholar_id_number = s.scholar_id_number
  left join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
  where coalesce(s.status, '') <> 'Removed'
)
select x.list, x.scholar_id_number, x.name, x.school, x.program, x.year_level, x.scholarship_status,
       case coalesce(x.own_status, x.program_status) when 'academic' then 'Academic' when 'non_academic' then 'Non-academic' else 'Not set' end as status_today,
       x.special_passing_gwa
from (
  select 'NOT SET - no program on record' as list, b.* from base b where coalesce(b.own_status, b.program_status) is null and b.program is null
  union all
  select 'NOT SET - program not placed', b.* from base b where coalesce(b.own_status, b.program_status) is null and b.program is not null
  union all
  select 'SPECIAL PROGRAM', b.* from base b where b.own_status is null and b.special_passing_gwa is not null
  union all
  select 'OWN STATUS (from the bulk file)', b.* from base b where b.own_status is not null
) x
order by x.list, x.school, x.last_name, x.first_name, x.scholar_id_number;
