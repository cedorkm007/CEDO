-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_dashboard_paging.sql
-- CONSULTATION TOOL > MAIN DASHBOARD: COUNTS THAT STAY FAST AS RECORDS GROW AND MATCH THE TABS, AND THE TWO LISTS THAT GROW (Scholars to be Consulted, Approved Referrals) IN PAGES.
-- Safe to run twice.   Undo: undo_consultation_dashboard_paging.sql   (It adds indexes and three read-only functions; it changes and deletes no record. The old functions stay as they are.)
--
--   * scholar_counseling_dashboard_counts(): the numbers on the dashboard cards in ONE pass (one look at the scholars by status, one at the visits by visit type), with the SAME rules as the tabs they belong to:
--       Probationary = the scholars on Probationary status (= the total of the Probationary Monitoring tab);  KSB Client / Home Visited = the visits of that type (= the Daily Records total with that Visit type);
--       Clients Served = the visits the signed-in staff member consulted from the 1st of the month up to today (= the Daily Records total for that consultant with the quick pick "This month").
--       The month is the PHILIPPINE month (the old count used the database's own clock, which is a day behind in the early morning of the 1st of a month).
--       On Leave / Reconsidered / Removed count the scholars with that status now (there is no tab that lists scholars by those statuses).
--       Pending / For Reconsideration = the signed-in staff member's own queue (= the total of "Scholars to be Consulted"); approved_count = their approved referrals (= the total of "Approved Referrals").
--   * scholar_counseling_queue_page(limit, offset) and scholar_counseling_approved_page(search, limit, offset): the staff member's own two lists, ONE PAGE at a time with the true total (the same rows, the same order as before).
--   * Indexes for those lists.
-- Only consultation staff can use them (the same rule as before).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.scholar_counseling_dashboard_summary()') is null or to_regprocedure('public.scholar_counseling_queue()') is null or to_regprocedure('public.scholar_counseling_approved_referrals()') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Consultation and Scholar Renewal files first.';
  end if;
end $$;

-- 1. Indexes (an index that exists is left alone).
create index if not exists scholar_counseling_referrals_to_status_idx on public.scholar_counseling_referrals (referred_to, status, created_at);
create index if not exists scholar_counseling_referrals_approved_idx on public.scholar_counseling_referrals (referred_to, approved_at desc) where status = 'approved';

-- 2. The numbers on the dashboard cards.
create or replace function public.scholar_counseling_dashboard_counts()
returns table(
  ksb_client_count bigint, home_visited_count bigint, probationary_count bigint, on_leave_count bigint, reconsidered_count bigint, removed_count bigint,
  pending_count bigint, reconsideration_count bigint, month_label text, clients_served_this_month bigint, approved_count bigint, me uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these numbers.'; end if;
  return query
  select
    (select count(*) from public.scholar_counseling_records r where r.visit_type = 'KSB Client'),
    (select count(*) from public.scholar_counseling_records r where r.visit_type = 'Home Visit'),
    s.probationary, s.on_leave, s.reconsidered, s.removed,
    f.pending, f.reconsideration,
    to_char(v_today, 'FMMonth YYYY'),
    (select count(*) from public.scholar_counseling_records r where r.consulted_by = auth.uid() and r.date_visited >= date_trunc('month', v_today)::date and r.date_visited <= v_today),
    f.approved,
    auth.uid()
  from (select count(*) filter (where x.status = 'Probationary') as probationary, count(*) filter (where x.status = 'On leave') as on_leave,
               count(*) filter (where x.status = 'Reconsidered') as reconsidered, count(*) filter (where x.status = 'Removed') as removed
        from public.scholars x where x.status in ('Probationary', 'On leave', 'Reconsidered', 'Removed')) s,
       (select count(*) filter (where q.status = 'pending' and q.renewal_record_id is null) as pending,
               count(*) filter (where q.status = 'reconsideration_requested' and q.renewal_record_id is null) as reconsideration,
               count(*) filter (where q.status = 'approved') as approved
        from public.scholar_counseling_referrals q where q.referred_to = auth.uid() and q.status in ('pending', 'reconsideration_requested', 'approved')) f;
end;
$$;
revoke all on function public.scholar_counseling_dashboard_counts() from public, anon;
grant execute on function public.scholar_counseling_dashboard_counts() to authenticated;

-- 3. "Scholars to be Consulted": one page.
create or replace function public.scholar_counseling_queue_page(p_limit integer default 20, p_offset integer default 0)
returns table(
  id uuid, scholar_id_number text, name text, course text, year_level text, school text,
  barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
  lacking_grades jsonb, endorsed_for text, remarks text, status text,
  referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these numbers.'; end if;
  return query
  with b as (
    select r.*, count(*) over () as total from public.scholar_counseling_referrals r
    where r.referred_to = auth.uid() and r.renewal_record_id is null and r.status in ('pending', 'reconsideration_requested')
    order by r.created_at asc, r.id limit v_limit offset v_offset
  )
  select b.id, b.scholar_id_number, s.first_name || ' ' || s.last_name, s.course, s.year_level, s.school, s.barangay, s.contact_no,
         b.previous_semester_status, b.failed_subjects, b.lacking_grades, b.endorsed_for, b.remarks, b.status,
         trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), b.referral_date, b.reconsideration_reason, b.created_at, b.total
  from b join public.scholars s on s.scholar_id_number = b.scholar_id_number left join public.users u on u.id = b.referred_by
  order by b.created_at asc, b.id;
end;
$$;
revoke all on function public.scholar_counseling_queue_page(integer, integer) from public, anon;
grant execute on function public.scholar_counseling_queue_page(integer, integer) to authenticated;

-- 4. "Approved Referrals": one page, newest first, with a search by name or Scholar ID.
create or replace function public.scholar_counseling_approved_page(p_search text default '', p_limit integer default 20, p_offset integer default 0)
returns table(
  id uuid, scholar_id_number text, name text, course text, year_level text, school text,
  barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
  lacking_grades jsonb, endorsed_for text, remarks text, status text,
  referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz,
  signature_path text, approved_by_name text, approved_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these numbers.'; end if;
  return query
  with b as (
    select r.*, count(*) over () as total from public.scholar_counseling_referrals r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.referred_to = auth.uid() and r.status = 'approved'
      and (v_q = '' or s.scholar_id_number ilike '%' || v_q || '%' or s.first_name ilike '%' || v_q || '%' or s.last_name ilike '%' || v_q || '%'
           or concat_ws(' ', s.first_name, s.last_name) ilike '%' || v_q || '%' or concat_ws(' ', s.last_name, s.first_name) ilike '%' || v_q || '%')
    order by r.approved_at desc, r.id limit v_limit offset v_offset
  )
  select b.id, b.scholar_id_number, s.first_name || ' ' || s.last_name, s.course, s.year_level, s.school, s.barangay, s.contact_no,
         b.previous_semester_status, b.failed_subjects, b.lacking_grades, b.endorsed_for, b.remarks, b.status,
         trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')), b.referral_date, b.reconsideration_reason, b.created_at,
         b.signature_path, trim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, '')), b.approved_at, b.total
  from b join public.scholars s on s.scholar_id_number = b.scholar_id_number
  left join public.users rb on rb.id = b.referred_by left join public.users ab on ab.id = b.approved_by
  order by b.approved_at desc, b.id;
end;
$$;
revoke all on function public.scholar_counseling_approved_page(text, integer, integer) from public, anon;
grant execute on function public.scholar_counseling_approved_page(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
