-- Deletes the holding table that renewal_test_data_REVERT.sql made (public._renewal_test_backup), once you are sure you do not need to put the test data back.
-- Do not run it before you have checked the Scholar Renewal screens after the revert. This cannot be undone.
drop table if exists public._renewal_test_backup;
select 'the holding table is gone' as result;
