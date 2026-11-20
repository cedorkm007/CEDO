-- undo_consultation_dashboard_all_visits.sql: "Clients Served" goes back to counting only the signed-in staff member's own visits, and the scholar status list function is removed.
-- No record is changed or deleted. (Run this ONLY together with putting the previous version of the website back, because the new website needs the status list function.)
begin;

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

drop function if exists public.scholar_counseling_status_scholars_page(text, text, integer, integer);

notify pgrst, 'reload schema';
commit;
