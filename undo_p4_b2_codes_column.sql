-- UNDO of Phase 4, PART B2: removes the day saved on codes (codes stay).
set lock_timeout = '5s';
alter table public.attendance_codes drop column if exists day_date;
notify pgrst, 'reload schema';
