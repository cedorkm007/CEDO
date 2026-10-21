-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, STEP 0: find every rule on the LIVE project that lets "any staff account" (or any signed-in person) read or change a table.   READ-ONLY.
--
-- Why: the tool tags (Scholar Management, Grades Monitoring, SDP Monitoring, …) only hide menus unless the database rules ALSO check the tag. Phase 8 makes the
-- rules match the tags, table by table. The live project has rules that are not in our files, so I need to see the real ones before I change anything.
-- Choose "Run without RLS" if asked (it only makes a temporary table that disappears by itself). Send me the result: use "Export" (CSV) or copy all rows.
-- Nothing personal is in the result: table names, rule names, rule conditions and row counts only.
-- ─────────────────────────────────────────────────────────────
drop table if exists pg_temp._p8;
create temp table _p8 (n serial, part text, thing text, detail text);

-- 1. Every rule in the public area, sorted into: who it lets in.
--    ANY SIGNED-IN = any account that can sign in (staff, scholar or school);  ANY STAFF = any staff account whatever its tools;
--    TAG = needs a tool tag;  OWN = the person's own rows;  OTHER = something else (read the condition).
insert into _p8 (part, thing, detail)
select '1. RULE', p.tablename,
       case
         when coalesce(p.qual, p.with_check) is null then 'OTHER'
         when regexp_replace(coalesce(p.qual, ''), '\s', '', 'g') in ('true', '(true)') and p.cmd in ('SELECT', 'ALL') and 'authenticated' = any (p.roles) then 'ANY SIGNED-IN'
         when coalesce(p.qual, '') ~* '(auth\.role\(\)\s*=\s*''authenticated''|auth\.uid\(\)\s+is\s+not\s+null)' or coalesce(p.with_check, '') ~* '(auth\.role\(\)\s*=\s*''authenticated''|auth\.uid\(\)\s+is\s+not\s+null)' then 'ANY SIGNED-IN'
         when coalesce(p.qual, '') ~* 'is_cedo_staff' or coalesce(p.with_check, '') ~* 'is_cedo_staff' then 'ANY STAFF'
         when coalesce(p.qual, '') ~* '(has_staff_tag|is_sead_staff|is_it_admin|has_tag|_staff_tag)' or coalesce(p.with_check, '') ~* '(has_staff_tag|is_sead_staff|is_it_admin|has_tag|_staff_tag)' then 'TAG'
         when coalesce(p.qual, '') ~* '(auth\.uid\(\)|current_scholar|current_school)' or coalesce(p.with_check, '') ~* '(auth\.uid\(\)|current_scholar|current_school)' then 'OWN'
         else 'OTHER' end
       || ' | ' || p.policyname || ' | ' || p.cmd || ' | for ' || array_to_string(p.roles, ',')
       || ' | USING ' || left(regexp_replace(coalesce(p.qual, '(none)'), '\s+', ' ', 'g'), 220)
       || ' | CHECK ' || left(regexp_replace(coalesce(p.with_check, '(none)'), '\s+', ' ', 'g'), 220)
from pg_policies p
where p.schemaname = 'public'
order by p.tablename, p.policyname;

-- 2. How many rows each of those tables holds (so we start with the tables that matter).
insert into _p8 (part, thing, detail)
select '2. ROWS', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
order by c.relname;

-- 3. Tables with protection OFF or ON but with no rule at all.
insert into _p8 (part, thing, detail)
select '3. NO PROTECTION', c.relname, case when c.relrowsecurity then 'ON but no rule (nobody can read it through the website)' else 'OFF: anybody holding the website key can read and change it' end
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and (not c.relrowsecurity or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname))
order by c.relname;

-- 4. The "who is calling" helper functions and what each checks (so the new rules can reuse them).
insert into _p8 (part, thing, detail)
select '4. HELPER', p.proname || '(' || left(pg_get_function_identity_arguments(p.oid), 40) || ')', left(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'), 600)
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and (p.proname ~ '^(is|has|can|current)_' or p.proname in ('is_cedo_staff', 'is_sead_staff'))
order by p.proname;

-- 5. Which tool tags exist and how many staff hold each (names of tags and numbers only).
insert into _p8 (part, thing, detail)
select '5. TAG', t.tag_key, count(*)::text || ' staff'
from public.staff_account_tags t group by t.tag_key order by t.tag_key;

select part, thing, detail from _p8 order by n;
