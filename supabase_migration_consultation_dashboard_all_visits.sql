-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_dashboard_all_visits.sql
-- CONSULTATION TOOL > MAIN DASHBOARD: "CLIENTS SERVED" COUNTS THE VISITS OF EVERY CONSULTANT, AND THE SCHOLAR STATUS NUMBERS (On Leave, Reconsidered, Removed) OPEN A LIST.
-- Safe to run twice.   Undo: undo_consultation_dashboard_all_visits.sql   (It replaces one read-only function and adds one; it changes and deletes no record.)
--
--   * scholar_counseling_dashboard_counts(): the same numbers as before; ONLY "Clients Served this month" changes: it is now the visits of ALL consultants from the 1st of the Philippine month to today
--     (it was the signed-in staff member's own). It equals the Daily Records total with the dates "1st of the month to today" and no consultant chosen. The queue numbers stay the signed-in staff member's own.
--   * scholar_counseling_status_scholars_page(status, search, limit, offset): ONE PAGE (20 at a time) of the scholars who have that scholarship status now (On leave, Reconsidered, Removed or Probationary),
--     with the true total, searched by name or Scholar ID. The Dashboard opens it when one of those numbers is pressed. Only consultation staff can use it.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.scholar_counseling_dashboard_counts()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_consultation_dashboard_paging.sql first.';
  end if;
end $$;

-- 1. The dashboard numbers: Clients Served = every consultant's visits this month.
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
    (select count(*) from public.scholar_counseling_records r where r.date_visited >= date_trunc('month', v_today)::date and r.date_visited <= v_today),
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

-- 2. The scholars with one scholarship status, one page at a time.
create or replace function public.scholar_counseling_status_scholars_page(p_status text, p_search text default '', p_limit integer default 20, p_offset integer default 0)
returns table(scholar_id_number text, name text, course text, year_level text, school text, status text, total_count bigint)
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
  if p_status is null or p_status not in ('On leave', 'Reconsidered', 'Removed', 'Probationary') then raise exception 'Choose On leave, Reconsidered, Removed or Probationary.'; end if;
  return query
  with b as (
    select s.*, count(*) over () as total from public.scholars s
    where s.status = p_status
      and (v_q = '' or s.scholar_id_number ilike '%' || v_q || '%' or s.first_name ilike '%' || v_q || '%' or s.last_name ilike '%' || v_q || '%'
           or concat_ws(' ', s.first_name, s.last_name) ilike '%' || v_q || '%' or concat_ws(' ', s.last_name, s.first_name) ilike '%' || v_q || '%')
    order by lower(s.last_name), lower(s.first_name), s.scholar_id_number
    limit v_limit offset v_offset
  )
  select b.scholar_id_number, btrim(b.last_name || ', ' || b.first_name || ' ' || coalesce(b.middle_name, '')), b.course, b.year_level, b.school, b.status, b.total
  from b order by lower(b.last_name), lower(b.first_name), b.scholar_id_number;
end;
$$;
revoke all on function public.scholar_counseling_status_scholars_page(text, text, integer, integer) from public, anon;
grant execute on function public.scholar_counseling_status_scholars_page(text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
