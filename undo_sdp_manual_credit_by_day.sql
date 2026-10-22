-- UNDO for supabase_migration_sdp_manual_credit_by_day.sql: removes the function. Credits already given through it stay (they are ordinary credits); only the new "credit a chosen day" button stops working
-- (the Credit button on a recurring activity then asks for the database update).
drop function if exists public.credit_scholar_for_day(uuid, text, date, date, text, text);
