-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_reconsideration_live_lacking.sql
-- SDP Reconsideration tab: a request that is still WAITING showed the credits the scholar lacked on the day of the request (a saved copy). When credits were added afterwards the list kept
-- saying "lacking", while "View SDP credits" (which is live) said Complete. Now a waiting request shows what is lacking RIGHT NOW. Decided requests keep what was recorded when they were decided.
-- Nothing is changed in any table; only what the list shows. Deciding behaves as before (when nothing is lacking any more the request is closed as "not needed"). Safe to run twice.
-- ─────────────────────────────────────────────────────────────

begin;

-- The credits a scholar still lacks for a semester RIGHT NOW (the same calculation the Approve / Deny button makes when it is pressed).
create or replace function public._sdp_live_lacking(p_scholar_id_number text, p_school_year text, p_semester text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with req as (select public._sdp_required_map(p_scholar_id_number, p_school_year, p_semester) as m),
       c as (select * from public._sdp_compliance(p_school_year, p_semester, p_scholar_id_number) limit 1)
  select jsonb_build_object(
    'community_service', greatest(0, (req.m ->> 'community_service')::integer - coalesce((select c.community_service from c), 0)),
    'community_volunteerism', greatest(0, (req.m ->> 'community_volunteerism')::integer - coalesce((select c.community_volunteerism from c), 0)),
    'formation_program', greatest(0, (req.m ->> 'formation_program')::integer - coalesce((select c.formation_program from c), 0)))
  from req;
$$;
revoke all on function public._sdp_live_lacking(text, text, text) from public, anon, authenticated;

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
         r.school_year, r.term, r.basis_school_year, r.basis_term, r.status, case when r.status = 'pending' then public._sdp_live_lacking(r.scholar_id_number, r.basis_school_year, r.basis_term) else r.lacking end, r.requested_at, r.decided_at, r.decided_by_label, r.decision_note, r.record_id,
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

commit;
