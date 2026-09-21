-- referral_date defaulted to Postgres current_date, which is evaluated in
-- the database session's timezone (UTC) — for any Philippine local time
-- before 8am, that's still "yesterday" in UTC, so a referral created at
-- e.g. 2am local time was stored one day behind what the browser (and
-- the person creating it) saw. Fixed the same way todayManilaDateString()
-- (src/app/App.tsx) already solves this elsewhere in the app: compute the
-- Asia/Manila calendar date client-side and pass it in explicitly, rather
-- than trusting the server's own notion of "today".

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
    raise exception 'Not authorized to refer scholars for counseling.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;
  if not exists (select 1 from public.staff_account_tags where staff_id = p_referred_to and tag_key = 'scholar_counseling') then
    raise exception 'The selected staff member is not tagged for the Scholar Counseling Tool.';
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
