-- Deletes the holding table that period_test_data_REVERT.sql made (public._period_test_backup), once you are sure you do not need to put anything back.
-- Do not run it before you have checked the grades and the SDP screens after the revert. This cannot be undone.
drop table if exists public._period_test_backup;
select 'the holding table is gone' as result;
