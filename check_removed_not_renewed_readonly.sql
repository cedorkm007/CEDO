-- check_removed_not_renewed_readonly.sql
-- READ ONLY: it only looks. It changes nothing.
-- Cases endorsed for REMOVAL: how many are recorded as removed, and whether any was ever recorded as renewed (should be 0).
select count(*) filter (where stage = 'removed')                 as recorded_as_removed,
       count(*) filter (where stage = 'renewed')                 as recorded_as_renewed_should_be_0,
       count(*) filter (where stage = 'endorsed_for_approval')   as still_waiting_for_approval,
       count(*)                                                  as all_cases_endorsed_for_removal
from public.renewal_records
where endorsed_status = 'Removed';
