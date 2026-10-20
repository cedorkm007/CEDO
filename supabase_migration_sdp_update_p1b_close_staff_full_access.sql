-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 1b.   Safe to re-run.   Undo: undo_sdp_update_p1b.sql
--
-- Why: the live database has a rule named "staff full access" on attendance_sessions and attendance_codes that lets ANY staff account
-- (even one with no tools) read, add, change and delete attendance codes and sessions directly. Locking the code-creation function
-- (Phase 1, file A) did not close that door. This file closes it and keeps everything that legitimately needs these tables:
--   • attendance_sessions: any staff can still READ (the activity monitors' scanner reads a session's type); only SEAD staff and the
--     SDP Monitoring tag can add / change / delete (their existing rule "cedo monitors manage attendance sessions" is untouched).
--   • attendance_codes: only SEAD staff, the SDP Monitoring tag and the Formation tag can READ codes (the SDP and Formation screens do);
--     only SEAD staff and the SDP Monitoring tag can add / change / delete (their existing rule is untouched).
--   • The two Formation functions are no longer open to visitors who are not signed in (they already refused them inside).
-- Nothing in the tables is changed or deleted.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "staff full access" on public.attendance_sessions;
drop policy if exists "staff full access" on public.attendance_codes;

drop policy if exists "staff read attendance sessions" on public.attendance_sessions;
create policy "staff read attendance sessions" on public.attendance_sessions for select to authenticated
  using (public.is_cedo_staff());

drop policy if exists "tool staff read attendance codes" on public.attendance_codes;
create policy "tool staff read attendance codes" on public.attendance_codes for select to authenticated
  using (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.has_staff_tag('scholars_formation'));

revoke execute on function public.create_formation_attendance_session_with_codes(uuid, text, integer, integer) from anon;
revoke execute on function public.add_formation_attendance_codes(uuid, text, integer) from anon;

notify pgrst, 'reload schema';
