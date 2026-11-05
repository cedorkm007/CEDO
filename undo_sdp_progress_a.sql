-- Undo of supabase_migration_sdp_progress_a_tables_functions.sql.
-- WARNING: this removes the progress monitoring settings and the record of every picture (who sent what, approved or not). The credits that approvals already gave stay (they are
-- ordinary SDP credits). The picture FILES stay in the "sdp-progress-photos" folder (storage is not touched by SQL files); delete them in Storage if you want them gone.
-- Run undo_sdp_progress_b.sql first if step B was run.
drop function if exists public.sdp_progress_reject(uuid, text);
drop function if exists public.sdp_progress_approve(uuid);
drop function if exists public.sdp_progress_counts(uuid);
drop function if exists public.sdp_progress_list(text, uuid, text, integer, integer);
drop function if exists public.sdp_progress_submit(uuid, text, timestamptz, numeric, numeric, numeric, text);
drop function if exists public.sdp_progress_disable(uuid);
drop function if exists public.sdp_progress_enable(uuid);
drop policy if exists "scholar removes own progress picture" on storage.objects;
drop policy if exists "scholar or reviewer reads progress picture" on storage.objects;
drop policy if exists "scholar adds own progress picture" on storage.objects;
drop policy if exists "scholar or reviewer reads progress pictures" on public.sdp_progress_submissions;
drop table if exists public.sdp_progress_submissions;
drop policy if exists "signed-in users read progress monitoring" on public.sdp_progress_monitoring;
drop table if exists public.sdp_progress_monitoring;
drop function if exists public._sdp_progress_can_review(uuid);
drop function if exists public._sdp_progress_staff();
