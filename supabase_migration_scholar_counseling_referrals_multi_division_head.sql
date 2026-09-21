-- Allow more than one "sead_division_head"-tagged staff member to act as
-- approver (e.g. a backup/co-approver), instead of gating approve/
-- reconsider to the single account forward_referral_to_division_head()
-- happened to pick. forward_referral_to_division_head() now notifies
-- every tagged staff member, and approve_referral()/
-- request_referral_reconsideration() authorize by tag possession rather
-- than by matching the specific division_head_id stored on the referral
-- (which is kept only as an informational "routed via" record).

drop policy if exists "referral parties can view" on public.scholar_counseling_referrals;
create policy "referral parties can view" on public.scholar_counseling_referrals
  for select using (
    public.has_staff_tag('scholar_management')
    or public.has_staff_tag('scholar_counseling')
    or public.has_staff_tag('sead_division_head')
  );

create or replace function public.get_scholar_counseling_referral(p_referral_id uuid)
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users u on u.id = r.referred_by
  where r.id = p_referral_id
    and (
      public.has_staff_tag('scholar_management')
      or public.has_staff_tag('scholar_counseling')
      or public.has_staff_tag('sead_division_head')
    );
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

  -- Notify every sead_division_head-tagged staff member (not just one) —
  -- any of them can approve/reconsider.
  for v_staff in select staff_id from public.staff_account_tags where tag_key = 'sead_division_head' loop
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (
      gen_random_uuid(), 'referral_approval', v_staff.staff_id, coalesce(v_scholar_name, 'a scholar'),
      'Counseling Referral for Approval',
      'A counseling referral for ' || coalesce(v_scholar_name, 'a scholar') || ' has been forwarded for your approval.',
      now(), false, p_referral_id::text
    );
  end loop;
end;
$function$;

create or replace function public.approve_referral(p_referral_id uuid, p_signature_path text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar_id_number text;
  v_endorsed_for text;
  v_new_status text;
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to approve referrals.';
  end if;

  select scholar_id_number, endorsed_for into v_scholar_id_number, v_endorsed_for
  from public.scholar_counseling_referrals
  where id = p_referral_id and status = 'forwarded_to_division_head';
  if v_scholar_id_number is null then
    raise exception 'This referral is not awaiting approval.';
  end if;
  if p_signature_path is null or trim(p_signature_path) = '' then
    raise exception 'A signature is required to approve.';
  end if;

  v_new_status := case v_endorsed_for
    when 'On Probation Status' then 'Probationary'
    when 'Removal' then 'Removed'
    when 'Renewal' then 'Regular'
  end;

  update public.scholars set status = v_new_status where scholar_id_number = v_scholar_id_number;

  update public.scholar_counseling_referrals
  set status = 'approved', signature_path = p_signature_path, approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_referral_id;
end;
$function$;

create or replace function public.request_referral_reconsideration(p_referral_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to act on referrals.';
  end if;
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and status = 'forwarded_to_division_head'
  ) then
    raise exception 'This referral is not awaiting approval.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to send this back for reconsideration.';
  end if;

  update public.scholar_counseling_referrals
  set status = 'reconsideration_requested', reconsideration_reason = trim(p_reason), updated_at = now()
  where id = p_referral_id;
end;
$function$;
