-- Expose the approved signature/approver on referral reads, and add a
-- list of a counseling staff member's own approved referrals, so the
-- printed "signed" referral form can embed the Division Head's actual
-- signature image rather than a blank line.

-- The storage policy from the original migration only let the signature's
-- OWNER read/write it — but printing an approved referral means a
-- different person (the counseling staff who handled it) needs to fetch
-- the Division Head's signature image. Split into a narrow write policy
-- (owner only) and a broader read policy (anyone who could legitimately
-- see the referral in the first place).
drop policy if exists "staff manage own signature file" on storage.objects;

create policy "staff write own signature file" on storage.objects
  for insert
  with check (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff replace own signature file" on storage.objects
  for update
  using (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff delete own signature file" on storage.objects
  for delete
  using (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "referral parties can read signatures" on storage.objects
  for select
  using (
    bucket_id = 'staff-signatures'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_staff_tag('scholar_management')
      or public.has_staff_tag('scholar_counseling')
      or public.has_staff_tag('sead_division_head')
    )
  );

drop function if exists public.get_scholar_counseling_referral(uuid);

create or replace function public.get_scholar_counseling_referral(p_referral_id uuid)
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz,
   signature_path text, approved_by_name text, approved_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at,
    r.signature_path, trim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, '')) as approved_by_name, r.approved_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users rb on rb.id = r.referred_by
  left join public.users ab on ab.id = r.approved_by
  where r.id = p_referral_id
    and (
      public.has_staff_tag('scholar_management')
      or public.has_staff_tag('scholar_counseling')
      or public.has_staff_tag('sead_division_head')
    );
$function$;

create or replace function public.scholar_counseling_approved_referrals()
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz,
   signature_path text, approved_by_name text, approved_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at,
    r.signature_path, trim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, '')) as approved_by_name, r.approved_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users rb on rb.id = r.referred_by
  left join public.users ab on ab.id = r.approved_by
  where public.is_scholar_counseling_staff()
    and r.referred_to = auth.uid()
    and r.status = 'approved'
  order by r.approved_at desc;
$function$;
