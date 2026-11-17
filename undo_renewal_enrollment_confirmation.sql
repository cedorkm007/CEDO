-- undo_renewal_enrollment_confirmation.sql: the tick box and the export are gone from the database. The three columns on renewal_records (who ticked, and when) are KEPT, so nothing that was ticked is lost.
begin;

drop function if exists public.renewal_enrollment_export(text, text, date, date, integer, integer);
drop function if exists public.renewal_enrollment_summary(text, text, date, date);
drop function if exists public.renewal_enrollment_set(uuid, boolean);
drop function if exists public.renewal_enrollment_status(text, text, text[]);

notify pgrst, 'reload schema';
commit;
