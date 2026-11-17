-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_checklist_reconsideration_note.sql
-- SDP CHECKLIST: SAY WHY A SCHOLAR IS "COMPLIED" WITH FEWER THAN 3 CREDITS.   Safe to run twice.   Undo: undo_sdp_checklist_reconsideration_note.sql
--
--   * A scholar whose SDP reconsideration for the semester was APPROVED counts as Complied for it (the credits that were lacking are added to the next semester). That rule is not new and is not changed.
--   * This adds one function that only READS: given the scholars on the page of the Checklist, which of them have an approved reconsideration for the semester being viewed.
--     The screen uses it to write "Reconsideration approved" under the Complied chip of those scholars, so staff can see why 0/3 reads as Complied.
--   * No table is changed. Nothing is deleted. The credits and the Complied / Not complied result are not touched.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.sdp_reconsideration_requests') is null then
    raise exception 'STOPPED, nothing changed: run the SDP reconsideration files first.';
  end if;
end $$;

create or replace function public.scholars_sdp_reconsidered(p_school_year text, p_semester text, p_ids text[])
returns table(scholar_id_number text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  return query
  select distinct r.scholar_id_number
  from public.sdp_reconsideration_requests r
  where r.status = 'approved' and r.basis_school_year = p_school_year and r.basis_term = p_semester
    and r.scholar_id_number = any (coalesce(p_ids, '{}'::text[]));
end;
$$;
revoke all on function public.scholars_sdp_reconsidered(text, text, text[]) from public, anon;
grant execute on function public.scholars_sdp_reconsidered(text, text, text[]) to authenticated;

notify pgrst, 'reload schema';

commit;
