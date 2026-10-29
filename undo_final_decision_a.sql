-- UNDO for supabase_migration_final_decision_a_referral_columns.sql. Run undo_final_decision_b.sql FIRST. It stops (changing nothing) while a case is waiting for a final decision.
set lock_timeout = '5s';
do $$ declare n integer; begin
  select count(*) into n from public.scholar_counseling_referrals where status = 'division_head_approved';
  if n > 0 then raise exception 'STOPPED, nothing changed: % case(s) are waiting for the consulting staff''s final decision.', n; end if;
end $$;
alter table public.scholar_counseling_referrals drop constraint if exists scholar_counseling_referrals_status_check;
alter table public.scholar_counseling_referrals add constraint scholar_counseling_referrals_status_check
  check (status = any (array['awaiting_booking', 'booked', 'pending', 'forwarded_to_division_head', 'reconsideration_requested', 'approved']));
alter table public.scholar_counseling_referrals drop column if exists finalized_by;
alter table public.scholar_counseling_referrals drop column if exists finalized_at;

notify pgrst, 'reload schema';
