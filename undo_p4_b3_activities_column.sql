-- UNDO of Phase 4, PART B3: removes the sub-name of the first day on activities (the sub-names of the other days are inside the list of days and stay unused).
set lock_timeout = '5s';
alter table public.sdp_activities drop column if exists sub_name;
notify pgrst, 'reload schema';
