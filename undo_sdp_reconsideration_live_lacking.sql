-- ─────────────────────────────────────────────────────────────
-- undo_sdp_reconsideration_live_lacking.sql
-- Puts the list back to showing the saved copy of the lacking credits, and removes the helper.
-- ─────────────────────────────────────────────────────────────

begin;

drop function if exists public.sdp_reconsideration_list(text, text, integer, integer);
create or replace function public.sdp_reconsideration_list(p_status text default 'pending', p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  id uuid, scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, school_year text, term text, basis_school_year text, basis_term text,
  status text, lacking jsonb, requested_at timestamptz, decided_at timestamptz, decided_by_label text, decision_note text, record_id uuid, previous jsonb,
  next_school_year text, next_semester text, can_decide boolean, grades_status text, grades_complete boolean, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_decide boolean := public.can_decide_sdp_reconsideration();
begin
  if not (public.can_view_renewals() or v_decide) then raise exception 'Not authorized to view SDP reconsideration requests.'; end if;
  return query
  select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status,
         r.school_year, r.term, r.basis_school_year, r.basis_term, r.status, r.lacking, r.requested_at, r.decided_at, r.decided_by_label, r.decision_note, r.record_id,
         coalesce((select jsonb_agg(jsonb_build_object('school_year', o.school_year, 'term', o.term, 'status', o.status, 'lacking', o.lacking, 'decided_at', o.decided_at) order by o.requested_at desc)
                     from public.sdp_reconsideration_requests o where o.scholar_id_number = r.scholar_id_number and o.id <> r.id), '[]'::jsonb),
         nx.school_year, nx.semester, v_decide and r.status = 'pending', public._eg_grades_status(r.scholar_id_number, r.basis_school_year, r.basis_term), public._eg_grades_complete(r.scholar_id_number, r.basis_school_year, r.basis_term), count(*) over ()
  from public.sdp_reconsideration_requests r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  cross join lateral public._sdp_next_semester(r.basis_school_year, r.basis_term) nx
  where (coalesce(p_status, 'pending') = 'all' or r.status = coalesce(p_status, 'pending'))
    and (v_q is null or r.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by case when r.status = 'pending' then 0 else 1 end, case when r.status = 'pending' then r.requested_at end asc, r.decided_at desc nulls last, r.requested_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.sdp_reconsideration_list(text, text, integer, integer) from public, anon;
grant execute on function public.sdp_reconsideration_list(text, text, integer, integer) to authenticated;

drop function if exists public._sdp_live_lacking(text, text, text);

commit;
