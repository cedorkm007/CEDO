-- SDP Monitoring update, Phase 6 — STEP 3d: DELETE the held list of temporary passwords (run ONLY after you have saved the CSV from step 3c).
-- After this no temporary password is stored anywhere. It cannot be brought back; the only way to give someone a new one is the Reset Password button.
set lock_timeout = '5s';
drop table if exists public.p6_held_temporary_passwords;
