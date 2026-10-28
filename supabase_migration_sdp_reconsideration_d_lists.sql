-- ─────────────────────────────────────────────────────────────
-- SDP RECONSIDERATION, FILE D (an addition to files A, B and C): the lists.   Safe to run twice.   Undo: undo_sdp_reconsideration_d.sql
-- Run AFTER _c_renewal.sql, and AFTER the Scholar List file.
--   • The Scholar List gets one more column: the status of the scholar's SDP reconsideration request for the term (pending / approved / denied / not_needed, or empty).
--   • SDP Monitoring can ask which scholars owe extra credits for a semester (an approved reconsideration of the semester before), so its credit columns can show "3 / 5".
-- Replaces one function (the Scholar List page; the original is in the undo file) and adds one. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
drop function if exists public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer);

create or replace function public.renewal_scholar_list(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_eligibility text[] default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.status, s.school_id, s.school, s.year_level, s.course,
         c.sdp_applicable, c.sdp_complied, c.sdp_missing,
         (select r.status from public.sdp_reconsideration_requests r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term),
         c.grades_state, c.graded, c.total, c.failed, c.drp, c.inc, c.review, c.eligibility, c.computed_at,
         count(*) over ()
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (coalesce(cardinality(p_eligibility), 0) = 0 or c.eligibility && p_eligibility)
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) from public, anon;
grant execute on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) to authenticated;

-- Who owes extra credits for a semester (only those who do): for the SDP Checklist.
create or replace function public.scholars_sdp_extra_required(p_school_year text, p_semester text)
returns table(scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('sdp_monitoring') or public.can_view_renewals() or public.can_decide_sdp_reconsideration()) then raise exception 'Not authorized to view the SDP checklist.'; end if;
  return query
  select d.scholar_id_number,
         coalesce(sum(d.amount) filter (where d.category = 'community_service'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'community_volunteerism'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'formation_program'), 0)::integer
  from public.sdp_reconsideration_debts d
  where d.apply_school_year = p_school_year and d.apply_semester = p_semester
  group by d.scholar_id_number;
end;
$$;
revoke all on function public.scholars_sdp_extra_required(text, text) from public, anon;
grant execute on function public.scholars_sdp_extra_required(text, text) to authenticated;

notify pgrst, 'reload schema';
