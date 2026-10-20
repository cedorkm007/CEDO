-- UNDO for supabase_migration_sdp_update_p1b_close_staff_full_access.sql
-- Brings back the open "staff full access" rules (any staff account can read and change attendance codes and sessions again).
drop policy if exists "staff read attendance sessions" on public.attendance_sessions;
drop policy if exists "tool staff read attendance codes" on public.attendance_codes;
drop policy if exists "staff full access" on public.attendance_sessions;
create policy "staff full access" on public.attendance_sessions for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
drop policy if exists "staff full access" on public.attendance_codes;
create policy "staff full access" on public.attendance_codes for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
grant execute on function public.create_formation_attendance_session_with_codes(uuid, text, integer, integer) to anon;
grant execute on function public.add_formation_attendance_codes(uuid, text, integer) to anon;
notify pgrst, 'reload schema';
