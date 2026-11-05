-- Undo of supabase_migration_sdp_progress_b_qr_guard.sql: takes the guard off the QR attendance. Nothing else changes.
set lock_timeout = '5s';
drop trigger if exists sdp_progress_block_qr on public.attendance_sessions;
drop function if exists public._sdp_progress_block_qr();
reset lock_timeout;
