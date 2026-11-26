-- undo_restore_survey_sdp_credits.sql: removes ONLY what restore_survey_sdp_credits.sql added.
-- The credit history shows "Restore undone". The restore notifications are removed (a scholar who already read one has still seen it).
-- A saved-for-later credit that the scholar has since claimed is left in place and listed at the end.
begin;

do $$
begin
  if to_regclass('public.survey_credit_restore_log') is null then raise exception 'Nothing to undo: the restore was never run.'; end if;
  perform set_config('app.sdp_source', 'restore_survey_bug_undo', true);

  delete from public.scholar_notifications n
    where n.kind = 'sdp_credit_restored' and n.scholar_id_number in (select l.scholar_id_number from public.survey_credit_restore_log l where l.undone_at is null);
  delete from public.sdp_attendance c where c.id in (select l.sdp_attendance_id from public.survey_credit_restore_log l where l.undone_at is null and l.action = 'credit');
  update public.survey_credit_restore_log set undone_at = now() where undone_at is null and action = 'credit';

  with removed as (
    delete from public.sdp_reserved_credits r
    where not r.claimed and r.id in (select l.reserved_credit_id from public.survey_credit_restore_log l where l.undone_at is null and l.action = 'saved')
    returning r.id
  )
  update public.survey_credit_restore_log l set undone_at = now() from removed where l.reserved_credit_id = removed.id;
  perform set_config('app.sdp_source', '', true);
end $$;

commit;

-- Left in place (saved credits the scholar has already claimed):
select scholar_id_number, activity_name, school_year, semester from public.survey_credit_restore_log where undone_at is null;
