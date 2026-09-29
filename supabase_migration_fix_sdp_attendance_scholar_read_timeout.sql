-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_sdp_attendance_scholar_read_timeout.sql
--
-- Same anti-pattern as scholar_quest_scores' original policy (fixed in
-- supabase_migration_fix_scholar_profile_load_timeout.sql), found during a
-- broader audit: "scholar reads own sdp attendance" filters through a plain
-- subquery against public.scholars, which is itself RLS-protected. It times
-- fast today (sdp_attendance is still a small table) but shares the exact
-- shape that made scholar_quest_scores take up to 8.4s once it grew — fixing
-- now while it's cheap, before it becomes a live incident.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "scholar reads own sdp attendance" on public.sdp_attendance;
create policy "scholar reads own sdp attendance" on public.sdp_attendance
  for select using (scholar_id_number = public.current_scholar_id_number());
