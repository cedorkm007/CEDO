-- Scholar Counseling Referral System + Main Dashboard.
-- Connects Scholar Management (Scholars Information's new "For Counseling"
-- column) to the Scholar Counseling Tool: a referral is created by Scholar
-- Management staff, queued for a chosen counseling staff member (Main
-- Dashboard), then forwarded to the SEAD Division Head for approval
-- (via the existing app-wide Notifications system) or reconsideration.

-- ── Visit Type on Daily Records (for the dashboard's KSB Client / Home
--    Visited counts) ──────────────────────────────────────────────────
alter table public.scholar_counseling_records
  add column if not exists visit_type text not null default 'Office'
  check (visit_type = any (array['Office', 'KSB Client', 'Home Visit']));

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
    raise exception 'Not authorized to use the Scholar Counseling Tool.';
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

drop function if exists public.scholar_counseling_daily_records(text);

create or replace function public.scholar_counseling_daily_records(p_search text default ''::text)
 returns table(id uuid, scholar_id_number text, name text, course text, year_level text, school text, status text, date_visited date, consulted_by_name text, failed_subjects text, findings text, staff_recommendations text, visit_type text, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school,
    r.status, r.date_visited,
    trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as consulted_by_name,
    r.failed_subjects, r.findings, r.staff_recommendations, r.visit_type, r.created_at
  from public.scholar_counseling_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users u on u.id = r.consulted_by
  where public.is_scholar_counseling_staff()
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
    )
  order by r.date_visited desc, r.created_at desc;
$function$;

-- ── Referral case table ────────────────────────────────────────────────
create table if not exists public.scholar_counseling_referrals (
  id uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  referred_by uuid not null references public.users(id) default auth.uid(),
  referred_to uuid not null references public.users(id),
  referral_date date not null default current_date,
  previous_semester_status text not null check (previous_semester_status = any (array['Retained', 'On Probation', 'Special Recon'])),
  failed_subjects jsonb not null default '[]'::jsonb,
  lacking_grades jsonb not null default '[]'::jsonb,
  endorsed_for text not null check (endorsed_for = any (array['On Probation Status', 'Removal', 'Renewal'])),
  remarks text not null default '',
  status text not null default 'pending' check (status = any (array['pending', 'forwarded_to_division_head', 'reconsideration_requested', 'approved'])),
  division_head_id uuid references public.users(id),
  reconsideration_reason text,
  signature_path text,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scholar_counseling_referrals enable row level security;

drop policy if exists "referral parties can view" on public.scholar_counseling_referrals;
create policy "referral parties can view" on public.scholar_counseling_referrals
  for select using (
    public.has_staff_tag('scholar_management')
    or public.has_staff_tag('scholar_counseling')
    or auth.uid() = division_head_id
  );
-- No insert/update/delete policy — every write goes through the
-- SECURITY DEFINER RPCs below, each enforcing its own workflow rules.

-- ── Reusable staff signatures ────────────────────────────────────────
create table if not exists public.staff_signatures (
  staff_id uuid primary key references public.users(id),
  storage_path text not null,
  updated_at timestamptz not null default now()
);

alter table public.staff_signatures enable row level security;

drop policy if exists "staff view own signature" on public.staff_signatures;
create policy "staff view own signature" on public.staff_signatures
  for select using (auth.uid() = staff_id);

-- ── Storage bucket for signature images ──────────────────────────────
insert into storage.buckets (id, name, public)
values ('staff-signatures', 'staff-signatures', false)
on conflict (id) do nothing;

drop policy if exists "staff manage own signature file" on storage.objects;
create policy "staff manage own signature file" on storage.objects
  for all
  using (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'staff-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── RPCs ──────────────────────────────────────────────────────────────

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
  p_failed_subjects jsonb, p_lacking_grades jsonb, p_endorsed_for text
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
    (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for)
  values
    (p_scholar_id_number, auth.uid(), p_referred_to, p_previous_semester_status,
     coalesce(p_failed_subjects, '[]'::jsonb), coalesce(p_lacking_grades, '[]'::jsonb), p_endorsed_for)
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.scholar_counseling_queue()
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
  where public.is_scholar_counseling_staff()
    and r.referred_to = auth.uid()
    and r.status in ('pending', 'reconsideration_requested')
  order by r.created_at asc;
$function$;

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
      or r.division_head_id = auth.uid()
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
  v_division_head_id uuid;
  v_scholar_name text;
begin
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and referred_to = auth.uid() and status in ('pending', 'reconsideration_requested')
  ) then
    raise exception 'This referral is not in your queue.';
  end if;

  select staff_id into v_division_head_id from public.staff_account_tags where tag_key = 'sead_division_head' limit 1;
  if v_division_head_id is null then
    raise exception 'No SEAD Division Head is configured — ask it.admin1 to grant that tag from Staff Accounts.';
  end if;

  update public.scholar_counseling_referrals
  set remarks = coalesce(p_remarks, ''), endorsed_for = p_endorsed_for,
      status = 'forwarded_to_division_head', division_head_id = v_division_head_id,
      reconsideration_reason = null, updated_at = now()
  where id = p_referral_id;

  select s.first_name || ' ' || s.last_name into v_scholar_name
  from public.scholar_counseling_referrals r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.id = p_referral_id;

  insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
  values (
    gen_random_uuid(), 'referral_approval', v_division_head_id, coalesce(v_scholar_name, 'a scholar'),
    'Counseling Referral for Approval',
    'A counseling referral for ' || coalesce(v_scholar_name, 'a scholar') || ' has been forwarded for your approval.',
    now(), false, p_referral_id::text
  );
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
  select scholar_id_number, endorsed_for into v_scholar_id_number, v_endorsed_for
  from public.scholar_counseling_referrals
  where id = p_referral_id and division_head_id = auth.uid() and status = 'forwarded_to_division_head';
  if v_scholar_id_number is null then
    raise exception 'This referral is not awaiting your approval.';
  end if;
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to approve referrals.';
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
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and division_head_id = auth.uid() and status = 'forwarded_to_division_head'
  ) then
    raise exception 'This referral is not awaiting your approval.';
  end if;
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to act on referrals.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to send this back for reconsideration.';
  end if;

  update public.scholar_counseling_referrals
  set status = 'reconsideration_requested', reconsideration_reason = trim(p_reason), updated_at = now()
  where id = p_referral_id;
end;
$function$;

create or replace function public.upsert_staff_signature(p_storage_path text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.staff_signatures (staff_id, storage_path, updated_at)
  values (auth.uid(), p_storage_path, now())
  on conflict (staff_id) do update set storage_path = excluded.storage_path, updated_at = excluded.updated_at;
end;
$function$;

create or replace function public.scholar_counseling_dashboard_summary()
 returns table(
   ksb_client_count bigint, home_visited_count bigint,
   probationary_count bigint, on_leave_count bigint, reconsidered_count bigint, removed_count bigint,
   pending_count bigint, reconsideration_count bigint,
   month_label text, clients_served_this_month bigint
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    (select count(*) from public.scholar_counseling_records where visit_type = 'KSB Client'),
    (select count(*) from public.scholar_counseling_records where visit_type = 'Home Visit'),
    (select count(*) from public.scholars where status = 'Probationary'),
    (select count(*) from public.scholars where status = 'On leave'),
    (select count(*) from public.scholars where status = 'Reconsidered'),
    (select count(*) from public.scholars where status = 'Removed'),
    (select count(*) from public.scholar_counseling_referrals where referred_to = auth.uid() and status = 'pending'),
    (select count(*) from public.scholar_counseling_referrals where referred_to = auth.uid() and status = 'reconsideration_requested'),
    to_char(current_date, 'FMMonth YYYY'),
    (select count(*) from public.scholar_counseling_records
      where consulted_by = auth.uid() and date_trunc('month', date_visited) = date_trunc('month', current_date))
  where public.is_scholar_counseling_staff();
$function$;
