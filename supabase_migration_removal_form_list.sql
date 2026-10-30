-- ─────────────────────────────────────────────────────────────
-- SCHOLARSHIP TERMINATION FORMS: THE LIST FOR THE CONSULTING STAFF, ORGANIZED BY NAME, YEAR LEVEL, SCHOOL AND PROGRAM.   Safe to run twice.   Undo: undo_removal_form_list.sql
-- Run AFTER supabase_migration_removal_form.sql.
--
-- The consulting staff member's list of termination forms now also has the removals still WAITING for the Division Head's approval (so the list shows what is to be approved as well
-- as what can be downloaded) and says, for each scholar, the year level, the school and the program. Each row has a state:
--   waiting   the case was endorsed for removal and waits for the Division Head (no form yet)
--   ready     the Division Head approved and signed: the form can be downloaded (the final decision is still to be made)
--   done      the final decision was made: the form can still be downloaded
-- Replaces one function (consult_removal_forms: it has more columns). No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
drop function if exists public.consult_removal_forms();
create or replace function public.consult_removal_forms()
returns table(referral_id uuid, scholar_id_number text, name text, year_level text, school text, program text, issued_on date, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select f.id, f.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), coalesce(s.year_level, ''), coalesce(s.school, ''), coalesce(s.course, ''),
         case when f.status = 'forwarded_to_division_head' then null else ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date end,
         case f.status when 'forwarded_to_division_head' then 'waiting' when 'division_head_approved' then 'ready' else 'done' end
  from public.scholar_counseling_referrals f
  join public.scholars s on s.scholar_id_number = f.scholar_id_number
  where f.referred_to = auth.uid()
    and ((f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end))
         or (f.status = 'forwarded_to_division_head' and f.endorsed_for = 'Removal'))
  order by s.last_name, s.first_name, f.scholar_id_number;
end;
$$;
revoke all on function public.consult_removal_forms() from public, anon;
grant execute on function public.consult_removal_forms() to authenticated;

notify pgrst, 'reload schema';
