-- UNDO of Phase 4, PART B1: removes the day saved on credits (the days are lost; credits stay). Run after undo_p4_a_functions.sql.
set lock_timeout = '5s';
alter table public.sdp_attendance drop column if exists activity_day;
notify pgrst, 'reload schema';
