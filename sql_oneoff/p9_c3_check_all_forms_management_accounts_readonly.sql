-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9 follow-up (C3): WHICH Forms Management accounts can and cannot read the submissions?   READ-ONLY: changes nothing, saves nothing.
--
-- For EVERY staff account that holds the Forms Management tool, this acts as that person for a moment (the same rules the website applies) and counts what they can
-- read: submission activities, submissions, submissions together with their scholar, stored files, scholar records. A row where a number is LOWER than the real total
-- (shown in the first row) is an account that is affected. Shows sign-in names, tools and counts only. Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
begin;

create temp table _tot as
select (select count(*) from public.submission_activities) as activities,
       (select count(*) from public.submission_uploads) as uploads,
       (select count(*) from public.submission_uploads u join public.scholars s on s.id = u.scholar_id) as joined,
       (select count(*) from storage.objects where bucket_id = 'submission-uploads') as files,
       (select count(*) from public.scholars) as scholars;
create temp table _res (username text, tools text, activities bigint, uploads bigint, uploads_with_scholar bigint, files bigint, scholars bigint);
grant select on _tot to authenticated;
grant insert, select on _res to authenticated;

do $$
declare r record; a bigint; u bigint; j bigint; f bigint; s bigint;
begin
  for r in
    select us.id, us.username,
           (select string_agg(t.tag_key, ', ' order by t.tag_key) from public.staff_account_tags t where t.staff_id = us.id) as tools
    from public.users us
    where exists (select 1 from public.staff_account_tags t where t.staff_id = us.id and t.tag_key = 'forms_management')
    order by us.username
  loop
    perform set_config('request.jwt.claim.sub', r.id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    select count(*) into a from public.submission_activities;
    select count(*) into u from public.submission_uploads;
    select count(*) into j from public.submission_uploads x join public.scholars sc on sc.id = x.scholar_id;
    select count(*) into f from storage.objects where bucket_id = 'submission-uploads';
    select count(*) into s from public.scholars;
    insert into _res values (r.username, r.tools, a, u, j, f, s);
    execute 'reset role';
  end loop;
end $$;

select '0. REAL TOTALS (what everyone should see)' as account, '' as tools, activities::text as submission_activities, uploads::text as submissions, joined::text as submissions_with_scholar, files::text as stored_files, scholars::text as scholar_records, '' as verdict
from _tot
union all
select r.username, r.tools, r.activities::text, r.uploads::text, r.uploads_with_scholar::text, r.files::text, r.scholars::text,
       case when r.activities = t.activities and r.uploads = t.uploads and r.uploads_with_scholar = t.joined and r.files = t.files and r.scholars = t.scholars then 'sees everything'
            else 'AFFECTED: ' || concat_ws(', ', case when r.activities < t.activities then 'activities' end, case when r.uploads < t.uploads then 'submissions' end,
                                           case when r.uploads_with_scholar < t.joined then 'submissions with scholar' end, case when r.files < t.files then 'stored files' end,
                                           case when r.scholars < t.scholars then 'scholar records' end) end
from _res r cross join _tot t
order by 1;

rollback;
