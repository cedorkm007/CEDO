-- SDP Monitoring update, Phase 6 — STEP 3c: show EVERY temporary password still held from step 3b (READ-ONLY). Download it as CSV and keep it private.
-- Nothing here changes any account. When everything is saved, run p6_step3d_DELETE_held_list.sql.
select kind, login, name, temporary_password, issued_at
from public.p6_held_temporary_passwords
order by kind, login;
