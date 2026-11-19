-- undo_consultation_bulk_records.sql: the "Bulk Add" of Daily Records stops working (the button then says the database update is needed). Only one function is removed; the records that were added stay.
begin;

drop function if exists public.counseling_bulk_records(jsonb, boolean);

notify pgrst, 'reload schema';
commit;
