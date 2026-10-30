-- UNDO for supabase_migration_removal_form_list.sql: the consulting staff's list is again only the forms that can be downloaded (no waiting cases, no year level, school or program).
drop function if exists public.consult_removal_forms();
create or replace function public.consult_removal_forms()
returns table(referral_id uuid, scholar_id_number text, name text, issued_on date, final_decision_made boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select f.id, f.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date, f.status = 'approved'
  from public.scholar_counseling_referrals f
  join public.scholars s on s.scholar_id_number = f.scholar_id_number
  where f.referred_to = auth.uid() and f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end)
  order by f.approved_at desc;
end;
$$;
revoke all on function public.consult_removal_forms() from public, anon;
grant execute on function public.consult_removal_forms() to authenticated;

notify pgrst, 'reload schema';
