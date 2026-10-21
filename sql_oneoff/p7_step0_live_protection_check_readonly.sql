-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, STEP 0: LOOK at how the 12 older tables are protected on the LIVE project.   READ-ONLY: it changes nothing.
--
-- Why: these 12 tables were made by hand on the live database, so our files cannot say whether they are protected. The protection switched on in the
-- next step has to fit what is already there (an extra rule can only ADD access; an old open rule has to be replaced), so I must see the real state first.
-- Choose "Run without RLS" if asked (it only makes a temporary table that disappears by itself). Send me the result: use "Export" (CSV) or copy all rows.
-- Nothing in the result is personal: names of tables, rules and counts only (no rows of data, no emails, no names).
-- ─────────────────────────────────────────────────────────────
drop table if exists pg_temp._p7;
create temp table _p7 (n serial, part text, thing text, detail text);

-- 1. Is protection ("row-level security") switched on for each of the 12 tables?
insert into _p7 (part, thing, detail)
select '1. PROTECTION', t.name,
       case when c.oid is null then 'TABLE NOT FOUND'
            when c.relrowsecurity then 'ON' || case when c.relforcerowsecurity then ' (forced)' else '' end
            else 'OFF: anybody holding the public website key can read AND change every row' end
from (values ('users'), ('staff_account_tags'), ('notifications'), ('leave_requests'), ('submissions'), ('accomplishment_logs'), ('chat_messages'),
             ('divisions'), ('programs'), ('division_change_log'), ('sead_scholar_account_log'), ('sdp_attendance')) as t(name)
left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by t.name;

-- 2. Every rule (policy) on those tables: who it is for, what it allows, and its exact condition.
insert into _p7 (part, thing, detail)
select '2. RULE', p.tablename,
       p.policyname || ' | ' || p.cmd || ' | for ' || array_to_string(p.roles, ',') || ' | ' || p.permissive
       || ' | USING ' || left(regexp_replace(coalesce(p.qual, '(none)'), '\s+', ' ', 'g'), 400)
       || ' | CHECK ' || left(regexp_replace(coalesce(p.with_check, '(none)'), '\s+', ' ', 'g'), 400)
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('users', 'staff_account_tags', 'notifications', 'leave_requests', 'submissions', 'accomplishment_logs', 'chat_messages',
                      'divisions', 'programs', 'division_change_log', 'sead_scholar_account_log', 'sdp_attendance')
order by p.tablename, p.policyname;

-- 3. What the two outside roles may do at the table level (visitor = anon, any signed-in person = authenticated).
insert into _p7 (part, thing, detail)
select '3. GRANTS', t.name,
       'visitor: ' || coalesce(nullif(concat_ws('/', case when has_table_privilege('anon', c.oid, 'select') then 'read' end, case when has_table_privilege('anon', c.oid, 'insert') then 'add' end,
                                                 case when has_table_privilege('anon', c.oid, 'update') then 'change' end, case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end), ''), 'nothing')
       || ' | signed-in: ' || coalesce(nullif(concat_ws('/', case when has_table_privilege('authenticated', c.oid, 'select') then 'read' end, case when has_table_privilege('authenticated', c.oid, 'insert') then 'add' end,
                                                         case when has_table_privilege('authenticated', c.oid, 'update') then 'change' end, case when has_table_privilege('authenticated', c.oid, 'delete') then 'delete' end), ''), 'nothing')
from (values ('users'), ('staff_account_tags'), ('notifications'), ('leave_requests'), ('submissions'), ('accomplishment_logs'), ('chat_messages'),
             ('divisions'), ('programs'), ('division_change_log'), ('sead_scholar_account_log'), ('sdp_attendance')) as t(name)
join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by t.name;

-- 4. The columns of each table (names only), so the rules can be fitted to them.
insert into _p7 (part, thing, detail)
select '4. COLUMNS', c.table_name, string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position)
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('users', 'staff_account_tags', 'notifications', 'leave_requests', 'submissions', 'accomplishment_logs', 'chat_messages',
                       'divisions', 'programs', 'division_change_log', 'sead_scholar_account_log', 'sdp_attendance')
group by c.table_name order by c.table_name;

-- 5. How many rows each table holds (numbers only).
insert into _p7 (part, thing, detail)
select '5. ROWS', t.name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.name), false, true, '')))[1]::text
from (values ('users'), ('staff_account_tags'), ('notifications'), ('leave_requests'), ('submissions'), ('accomplishment_logs'), ('chat_messages'),
             ('divisions'), ('programs'), ('division_change_log'), ('sead_scholar_account_log'), ('sdp_attendance')) as t(name)
where to_regclass('public.' || t.name) is not null
order by t.name;

-- 6. Triggers on those tables (they can change data on their own, e.g. the lifetime SDP flag).
insert into _p7 (part, thing, detail)
select '6. TRIGGER', c.relname, tg.tgname || ' runs ' || p.proname
from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
where not tg.tgisinternal and c.relnamespace = 'public'::regnamespace
  and c.relname in ('users', 'staff_account_tags', 'notifications', 'leave_requests', 'submissions', 'accomplishment_logs', 'chat_messages',
                    'divisions', 'programs', 'division_change_log', 'sead_scholar_account_log', 'sdp_attendance')
order by c.relname, tg.tgname;

-- 7. Which of them send live updates to the website (protection also decides who receives those).
insert into _p7 (part, thing, detail)
select '7. LIVE UPDATES', pt.tablename, 'sends live updates'
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public'
  and pt.tablename in ('users', 'staff_account_tags', 'notifications', 'leave_requests', 'submissions', 'accomplishment_logs', 'chat_messages',
                       'divisions', 'programs', 'division_change_log', 'sead_scholar_account_log', 'sdp_attendance')
order by pt.tablename;

-- 8. The "who is calling" helper functions the rules would use (text of each, so I can reuse what exists instead of inventing new ones).
insert into _p7 (part, thing, detail)
select '8. HELPER FUNCTION', p.proname || '(' || left(pg_get_function_identity_arguments(p.oid), 60) || ')',
       left(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'), 700)
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and p.proname in ('is_cedo_staff', 'is_sead_staff', 'has_staff_tag', 'is_admin', 'is_super_admin', 'is_it_admin', 'current_user_role')
order by p.proname;

-- 9. Any OTHER table in the public area with protection OFF (so nothing else is missed).
insert into _p7 (part, thing, detail)
select '9. OTHER TABLE WITH PROTECTION OFF', c.relname, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::text || ' rules'
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
  and c.relname not in ('users', 'staff_account_tags', 'notifications', 'leave_requests', 'submissions', 'accomplishment_logs', 'chat_messages',
                        'divisions', 'programs', 'division_change_log', 'sead_scholar_account_log', 'sdp_attendance')
order by c.relname;

select part, thing, detail from _p7 order by n;
