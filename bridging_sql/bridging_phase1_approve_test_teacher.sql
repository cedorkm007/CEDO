-- bridging_phase1_approve_test_teacher.sql  (BRIDGING project only, for testing)
-- Approves ONE teacher account so students can choose that teacher, until the admin screen exists (Phase 2).
-- First register the teacher on the website, then change the username below if you used another one.
update public.bridging_profiles set status = 'active', updated_at = now()
where role = 'teacher' and lower(username) = 'test.teacher';

-- Check the result (shows nothing if the username does not match):
select username, last_name, first_name, status from public.bridging_profiles where role = 'teacher' and lower(username) = 'test.teacher';
