-- bridging_phase1_test_schools.sql  (BRIDGING project only, for testing)
-- Adds three made-up schools so registration can be tried before the admin screen exists (Phase 2). Safe to run twice.
-- To hide them later:  update public.bridging_schools set is_active = false where name like 'TEST %';
insert into public.bridging_schools (name, offers_jhs, offers_shs, offers_college, offers_als) values
  ('TEST National High School', true, true, false, false),
  ('TEST City College', false, false, true, false),
  ('TEST Community Learning Center', false, false, false, true)
on conflict ((lower(btrim(name)))) do nothing;
