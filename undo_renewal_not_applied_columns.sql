-- UNDO for supabase_migration_renewal_not_applied_columns.sql: removes the paged "Not applied" function and puts the two referral functions back exactly as they were
-- (only Scholar Management staff can refer; the evaluator can no longer). Nothing else is touched.
drop function if exists public.renewal_not_applied_page(text, text, text, integer, integer);

create or replace function public.list_scholar_counseling_staff()
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select u.id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as name
  from public.users u
  join public.staff_account_tags t on t.staff_id = u.id
  where public.has_staff_tag('scholar_management') and t.tag_key = 'scholar_counseling'
  order by u.last_name;
$function$;

create or replace function public.create_scholar_counseling_referral(
  p_scholar_id_number text, p_referred_to uuid, p_previous_semester_status text,
  p_failed_subjects jsonb, p_lacking_grades jsonb, p_endorsed_for text,
  p_referral_date date default current_date
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.has_staff_tag('scholar_management') then
    raise exception 'Not authorized to refer scholars for consultation.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;
  if not exists (select 1 from public.staff_account_tags where staff_id = p_referred_to and tag_key = 'scholar_counseling') then
    raise exception 'The selected staff member is not tagged for the Scholar Consultation Tool.';
  end if;

  insert into public.scholar_counseling_referrals
    (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, referral_date)
  values
    (p_scholar_id_number, auth.uid(), p_referred_to, p_previous_semester_status,
     coalesce(p_failed_subjects, '[]'::jsonb), coalesce(p_lacking_grades, '[]'::jsonb), p_endorsed_for,
     coalesce(p_referral_date, current_date))
  returning id into v_id;

  return v_id;
end;
$function$;

notify pgrst, 'reload schema';
