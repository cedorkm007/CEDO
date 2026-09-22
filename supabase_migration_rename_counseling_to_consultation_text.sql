-- Renames "counseling" -> "consultation" in every USER-VISIBLE string this
-- app generates server-side (notification title/message, RPC error
-- messages) to match the same rename applied throughout the frontend.
-- Internal identifiers (table/column/function names, the 'scholar_counseling'
-- tag key) are left unchanged — this is a terminology change for what
-- people see, not a schema rename.

-- Also drops the old-signature overloads of create_scholar_counseling_record
-- and create_scholar_counseling_referral, left behind when a new parameter
-- was added with CREATE OR REPLACE (which creates a new overload rather
-- than replacing when the signature differs) — dead code, now cleaned up
-- while these functions are being touched anyway.
drop function if exists public.create_scholar_counseling_record(text, text, date, text, text, text);
drop function if exists public.create_scholar_counseling_referral(text, uuid, text, jsonb, jsonb, text);

create or replace function public.create_scholar_counseling_record(
  p_scholar_id_number text, p_status text, p_date_visited date,
  p_failed_subjects text, p_findings text, p_staff_recommendations text,
  p_visit_type text default 'Office'
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_scholar_counseling_staff() then
    raise exception 'Not authorized to use the Scholar Consultation Tool.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;

  insert into public.scholar_counseling_records
    (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type)
  values
    (p_scholar_id_number, p_status, auth.uid(), coalesce(p_date_visited, current_date),
     coalesce(p_failed_subjects, ''), coalesce(p_findings, ''), coalesce(p_staff_recommendations, ''),
     coalesce(nullif(trim(p_visit_type), ''), 'Office'))
  returning id into v_id;

  return v_id;
end;
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

create or replace function public.forward_referral_to_division_head(
  p_referral_id uuid, p_remarks text, p_endorsed_for text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar_name text;
  v_first_division_head_id uuid;
  v_staff record;
begin
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and referred_to = auth.uid() and status in ('pending', 'reconsideration_requested')
  ) then
    raise exception 'This referral is not in your queue.';
  end if;

  select staff_id into v_first_division_head_id from public.staff_account_tags where tag_key = 'sead_division_head' limit 1;
  if v_first_division_head_id is null then
    raise exception 'No SEAD Division Head is configured — ask it.admin1 to grant that tag from Staff Accounts.';
  end if;

  update public.scholar_counseling_referrals
  set remarks = coalesce(p_remarks, ''), endorsed_for = p_endorsed_for,
      status = 'forwarded_to_division_head', division_head_id = v_first_division_head_id,
      reconsideration_reason = null, updated_at = now()
  where id = p_referral_id;

  select s.first_name || ' ' || s.last_name into v_scholar_name
  from public.scholar_counseling_referrals r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.id = p_referral_id;

  for v_staff in select staff_id from public.staff_account_tags where tag_key = 'sead_division_head' loop
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (
      gen_random_uuid(), 'referral_approval', v_staff.staff_id, coalesce(v_scholar_name, 'a scholar'),
      'Consultation Referral for Approval',
      'A consultation referral for ' || coalesce(v_scholar_name, 'a scholar') || ' has been forwarded for your approval.',
      now(), false, p_referral_id::text
    );
  end loop;
end;
$function$;
