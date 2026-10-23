-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL > NOT APPLIED: SDP STATUS, GRADES STATUS AND THE CONSULTATION REFERRAL.   Safe to run twice.   Undo: undo_renewal_not_applied_columns.sql
--
-- The "Not applied" list gets three columns: the scholar's SDP status (Complied / Not complied), the grades status (all passed, how many failed or INC, waiting for
-- grades, needs review) and the consultation referral (the "For Consultation" column that used to be on the Scholars tab). The numbers come from the SAME
-- renewal check (_renewal_evaluate) the application uses, so the list can never disagree with what an application would show.
--   • renewal_not_applied_page(): the list one page at a time (25 by default, 100 at most) with the search done by the database. The check is made only for the
--     scholars on the page, so it stays fast with thousands of scholars. (The old renewal_not_applied() stays as it was, for the Excel file and older screens.)
--   • The Scholar Renewal Evaluator can now make a consultation referral (the Refer button is on this list): the two functions the referral form uses allow the
--     evaluator as well as Scholar Management staff. Nobody who could do it before loses anything.
-- Creates one function and replaces two. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
create or replace function public.renewal_not_applied_page(p_school_year text, p_term text, p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, school text, program text, year_level text, status text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text,
  grades_state text, grades_submitted boolean, failed_count integer, inc_count integer, review_count integer, ungraded_count integer,
  referral_status text, total_rows bigint
)
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
  with base as (
    select s.scholar_id_number as sid, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')) as nm, s.school as sc, s.course as pr, s.year_level as yl, s.status as st,
           count(*) over () as total,
           row_number() over (order by s.last_name, s.first_name, s.scholar_id_number) as ord
    from public.scholars s
    where s.status not in ('Removed', 'On leave')
      and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
      and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term)
      and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or s.school ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%'
           or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%' or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
    order by s.last_name, s.first_name, s.scholar_id_number
    limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
  )
  select b.sid, b.nm, b.sc, b.pr, b.yl, b.st,
         coalesce((e.ev -> 'sdp' ->> 'applicable')::boolean, true), (e.ev -> 'sdp' ->> 'complied')::boolean, e.ev -> 'sdp' ->> 'missing',
         e.ev -> 'grades' ->> 'state', coalesce((e.ev -> 'grades' ->> 'school_submitted')::boolean, false),
         coalesce((e.ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0), coalesce((e.ev -> 'grades' -> 'counts' ->> 'inc')::integer, 0),
         coalesce((e.ev -> 'grades' -> 'counts' ->> 'review')::integer, 0), coalesce((e.ev -> 'grades' -> 'counts' ->> 'ungraded')::integer, 0),
         (select rf.status from public.scholar_counseling_referrals rf where rf.scholar_id_number = b.sid and rf.status <> 'approved' order by rf.created_at desc limit 1),
         b.total
  from base b
  cross join lateral (select public._renewal_evaluate(b.sid, p_school_year, p_term) as ev) e
  order by b.ord;
end;
$$;
revoke all on function public.renewal_not_applied_page(text, text, text, integer, integer) from public, anon;
grant execute on function public.renewal_not_applied_page(text, text, text, integer, integer) to authenticated;

-- The referral form's "Refer to" list and the referral itself: the evaluator may use them too (same text as before plus the evaluator).
create or replace function public.list_scholar_counseling_staff()
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select u.id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as name
  from public.users u
  join public.staff_account_tags t on t.staff_id = u.id
  where (public.has_staff_tag('scholar_management') or public.is_renewal_evaluator()) and t.tag_key = 'scholar_counseling'
  order by u.last_name;
$function$;

create or replace function public.create_scholar_counseling_referral(
  p_scholar_id_number text, p_referred_to uuid, p_previous_semester_status text,
  p_failed_subjects jsonb, p_lacking_grades jsonb, p_endorsed_for text,
  p_referral_date date default current_date
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not (public.has_staff_tag('scholar_management') or public.is_renewal_evaluator()) then
    raise exception 'Not authorized to refer scholars for consultation.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;
  if not exists (select 1 from public.staff_account_tags where staff_id = p_referred_to and tag_key = 'scholar_counseling') then
    raise exception 'The selected staff member is not tagged for the Scholar Consultation Tool.';
  end if;

  insert into public.scholar_counseling_referrals
    (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, referral_date)
  values
    (p_scholar_id_number, auth.uid(), p_referred_to, p_previous_semester_status,
     coalesce(p_failed_subjects, '[]'::jsonb), coalesce(p_lacking_grades, '[]'::jsonb), p_endorsed_for,
     coalesce(p_referral_date, current_date))
  returning id into v_id;

  return v_id;
end;
$function$;

notify pgrst, 'reload schema';
