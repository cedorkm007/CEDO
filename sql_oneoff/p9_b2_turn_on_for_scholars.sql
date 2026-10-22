-- SDP Monitoring update, Phase 9: TURN ON the "still on 123456? choose a new password" check for SCHOLARS.
-- Run this AFTER the scholars have been told (the announcement text is in the Phase 9 walkthrough) and after supabase_migration_sdp_update_p9_b_force_change_default_password.sql.
-- From then on, a scholar who still uses 123456 is asked to choose a new password the next time they open the portal. Nothing is changed for anyone else. Turn it off again with
-- p9_b3_turn_off_for_scholars.sql.
set lock_timeout = '5s';
update public.p9_default_password_settings set scholars = true where id;
select scholars as scholars_check_is_on, staff_and_schools as staff_and_schools_check_is_on from public.p9_default_password_settings;
