-- When any sead_division_head-tagged staff member approves or requests
-- reconsideration on a referral, every OTHER tagged staff member's copy
-- of that same "forwarded for your approval" notification is now stale
-- (the decision has already been made) — delete all of them server-side
-- rather than relying on the acting client to only clean up its own.

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

  delete from public.notifications where type = 'referral_approval' and reference_id = p_referral_id::text;
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

  delete from public.notifications where type = 'referral_approval' and reference_id = p_referral_id::text;
end;
$function$;
