-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9 follow-up (C2): SEE WHAT ONE STAFF ACCOUNT CAN READ, to find why submission files do not open.   READ-ONLY: changes nothing.
--
-- HOW: on the line marked "<<< CHANGE THIS" below, replace the capital letters between the quotes with the sign-in name of one of the two
-- accounts, then run the whole script ("Run without RLS" if asked). It acts as that person for a moment (the same rules the website applies), counts what they
-- can read in each place and compares with the real totals, then switches back and cancels everything. Nothing is saved.
-- Send me the result (it holds counts and rule texts only, no names of scholars).
-- ─────────────────────────────────────────────────────────────
begin;

create temp table _who as select id as uid from public.users where lower(username) = lower('USERNAME_HERE');   -- <<< CHANGE THIS
create temp table _totals as
select (select count(*) from public.submission_uploads) as uploads,
       (select count(*) from storage.objects where bucket_id = 'submission-uploads') as files,
       (select count(*) from public.scholars) as scholars,
       (select count(*) from public.users) as staff,
       (select count(*) from public.schools) as schools,
       (select count(*) from public.submission_activities) as activities;
grant select on _who, _totals to authenticated;

select set_config('request.jwt.claim.sub', (select uid::text from _who), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select '0. account found' as check_this, case when exists (select 1 from _who) then 'yes' else 'NO: no staff account with that sign-in name' end as this_person_sees, '' as real_total
union all select '1. tools held', coalesce((select string_agg(t.tag_key, ', ' order by t.tag_key) from public.staff_account_tags t where t.staff_id = (select uid from _who)), '(none)'), ''
union all select '2. helper says: Scholar Management (is_sead_staff)', public.is_sead_staff()::text, ''
union all select '2. helper says: Forms Management tag', public.has_staff_tag('forms_management')::text, ''
union all select '3. submission activities readable', (select count(*) from public.submission_activities)::text, (select activities::text from _totals)
union all select '4. submissions (uploads) readable', (select count(*) from public.submission_uploads)::text, (select uploads::text from _totals)
union all select '5. stored files openable (bucket submission-uploads)', (select count(*) from storage.objects where bucket_id = 'submission-uploads')::text, (select files::text from _totals)
union all select '6. scholar records readable (the list joins to them)', (select count(*) from public.scholars)::text, (select scholars::text from _totals)
union all select '7. staff records readable', (select count(*) from public.users)::text, (select staff::text from _totals)
union all select '8. schools readable', (select count(*) from public.schools)::text, (select schools::text from _totals)
union all select '9. the storage rule on the live project says', coalesce((select regexp_replace(p.qual, '\s+', ' ', 'g') from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'staff reads submission uploads'), '(no such rule)'), ''
order by 1;

rollback;
