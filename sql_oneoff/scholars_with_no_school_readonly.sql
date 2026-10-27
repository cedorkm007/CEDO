-- ─────────────────────────────────────────────────────────────
-- SCHOLARS WITH NO SCHOOL SET.   READ-ONLY.   Nothing is changed or deleted.
--
-- Why: a renewal window limited to chosen schools includes a scholar only if the scholar's record is LINKED to one of the schools in the Schools list. A scholar whose school
-- is blank, or typed in a way that matches no school (a spelling nobody merged), has no link and would be left out. This lists them so their school can be fixed (in the
-- Scholars tool: choose the school, or type the official name) BEFORE you open a restricted window. Only ACTIVE scholars are listed (not Removed, not On leave).
-- Choose "Run without RLS" if asked. Send me the result (Export CSV or copy all rows), or just fix them yourself from part 2.
-- Personal details are NOT in the result: Scholar ID numbers, status, year level and the school text typed on the record only (no names).
-- ─────────────────────────────────────────────────────────────
with unlinked as (
  select s.scholar_id_number, s.status, s.year_level, nullif(btrim(coalesce(s.school, '')), '') as typed
  from public.scholars s
  where s.school_id is null and s.status not in ('Removed', 'On leave')
), typed_groups as (
  select coalesce(typed, '(nothing typed)') as what, count(*) as c, min(scholar_id_number) as first_id, max(scholar_id_number) as last_id
  from unlinked group by 1
)
select '1. SUMMARY' as part, 'active scholars with no school linked' as item, (select count(*)::text from unlinked) as value
union all select '1. SUMMARY', 'active scholars in all', (select count(*)::text from public.scholars where status not in ('Removed', 'On leave'))
union all select '1. SUMMARY', 'schools in the Schools list', (select count(*)::text from public.schools)
union all
-- what is typed on the record, most common first (the same school spelled several ways shows as several lines: merge or correct the spelling)
select '2. BY WHAT IS TYPED', what, c::text || ' scholar(s) · IDs ' || first_id || case when first_id <> last_id then ' … ' || last_id else '' end from typed_groups
union all
select '3. THE OFFICIAL SCHOOLS (for reference)', sc.name, (select count(*)::text from public.scholars x where x.school_id = sc.id and x.status not in ('Removed', 'On leave')) || ' active scholar(s)'
from public.schools sc
union all
-- every scholar, up to 500 (use the grouped lines above first)
select * from (
  select '4. EACH SCHOLAR (first 500)' as part, u.scholar_id_number as item, u.status || ' · ' || coalesce(nullif(u.year_level, ''), 'no year level') || ' · typed: ' || coalesce(u.typed, '(nothing)') as value
  from unlinked u order by u.typed nulls first, u.scholar_id_number limit 500
) each_one
order by 1, 2;
