-- SDP Monitoring update, Phase 9 follow-up (C): WHICH staff can see the submission lists in Forms Management but cannot open the files themselves?   READ-ONLY: changes nothing.
-- The list of submissions is allowed by the "Forms Management" tool tag, but the stored FILES (private bucket "submission-uploads") are allowed only to staff with the
-- "Scholar Management" tag. A staff member with Forms Management but not Scholar Management therefore sees the list but not the file contents.
-- This shows those staff (sign-in names and their tags only). Choose "Run without RLS" if asked.
select u.username,
       exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'forms_management') as has_forms_management,
       exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'scholar_management') as has_scholar_management,
       case when exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'scholar_management') then 'can open the files'
            else 'CANNOT open the files (sees the list only)' end as submission_files
from public.users u
where exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'forms_management')
order by 4 desc, 1;
