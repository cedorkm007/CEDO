-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL > SCHOLAR LIST.   Safe to run twice.   Undo: undo_renewal_scholar_list.sql
-- Run AFTER the renewal files (Phase 2 to 8b) and the choose-schools files.
--
-- The new "Scholar List" tab shows every scholar who can renew in the chosen term, with the SDP status, the grades and the renewal eligibility, filterable and cross-matched.
-- The numbers come from the SAME renewal check an application uses (_renewal_evaluate, the one function that holds the rules), so the list can never disagree with an application.
-- Checking thousands of scholars takes time, so each result is SAVED (renewal_scholar_list_cache) and the list reads the saved results: opening the tab is instant, and the evaluator
-- presses "Refresh" to check everybody again (the website does it in small steps of 100 scholars with a progress bar, so no single step is long). The list says when it was last checked.
--
-- RENEWAL ELIGIBILITY (judged from the result of the check):
--   consultation         For consultation: a failed subject or a DRP (a DRP counts as failed), or an INC (an incomplete subject goes to consultation in the renewal rules);
--   sdp_reconsideration  For SDP reconsideration: the SDP credits needed are lacking (not for a Summer term, which has no SDP requirement);
--   ready                Ready for renewal: the SDP is complete (or not required) AND all subjects are graded and passed;
--   waiting              Waiting for grades: some subjects are not graded yet, or the school has not submitted its grades;
--   review               Needs review: a mark nobody can read, no passing mark set, or the scholar is not linked to a school.
-- A scholar can be both "For consultation" and "For SDP reconsideration". "Ready for renewal" is never combined with another label.
-- Creates one table (locked: only the functions below read or write it) and functions. Nothing existing is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.renewal_scholar_list_cache (
  school_year       text not null,
  term              text not null,
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  computed_at       timestamptz not null default now(),
  sdp_applicable    boolean not null default true,
  sdp_complied      boolean,
  sdp_missing       text,
  grades_state      text,
  graded            integer not null default 0,
  total             integer not null default 0,
  failed            integer not null default 0,      -- failed subjects, NOT counting DRP
  drp               integer not null default 0,
  inc               integer not null default 0,
  review            integer not null default 0,
  eligibility       text[] not null default '{}',
  primary key (school_year, term, scholar_id_number)
);
create index if not exists renewal_scholar_list_cache_computed_idx on public.renewal_scholar_list_cache (school_year, term, computed_at);
alter table public.renewal_scholar_list_cache enable row level security;      -- no policy: only the functions below touch it
revoke all on public.renewal_scholar_list_cache from public, anon, authenticated;

-- The eligibility labels of one result of the renewal check.
create or replace function public._renewal_list_eligibility(p_ev jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_labels text[] := '{}';
  v_applicable boolean := coalesce((p_ev -> 'sdp' ->> 'applicable')::boolean, true);
  v_complied boolean := (p_ev -> 'sdp' ->> 'complied')::boolean;
  v_state text := p_ev -> 'grades' ->> 'state';
  v_failed integer := coalesce((p_ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0);     -- includes DRP
  v_inc integer := coalesce((p_ev -> 'grades' -> 'counts' ->> 'inc')::integer, 0);
  v_review integer := coalesce((p_ev -> 'grades' -> 'counts' ->> 'review')::integer, 0);
  v_sdp_ok boolean;
begin
  if p_ev ? 'error' then return array['review']; end if;
  v_sdp_ok := (not v_applicable) or coalesce(v_complied, false);
  if v_applicable and not v_sdp_ok then v_labels := array_append(v_labels, 'sdp_reconsideration'); end if;
  if v_failed > 0 or v_inc > 0 then v_labels := array_append(v_labels, 'consultation'); end if;
  if v_state = 'review' or v_review > 0 then v_labels := array_append(v_labels, 'review');
  elsif v_state in ('waiting', 'no_grades') then v_labels := array_append(v_labels, 'waiting');
  end if;
  if cardinality(v_labels) = 0 and v_sdp_ok and v_state = 'ready' then v_labels := array['ready']; end if;
  return v_labels;
end;
$$;
revoke all on function public._renewal_list_eligibility(jsonb) from public, anon, authenticated;

-- Checks up to p_limit scholars whose saved result is missing or older than p_since (null = start a new round now), and saves the results. The website calls it again and again with the
-- returned "since" until nothing remains. Returns what was done in this step, how many remain, how many scholars are in the list in all, and the time this round started.
create or replace function public.renewal_scholar_list_refresh(p_school_year text, p_term text, p_since timestamptz, p_limit integer default 100)
returns table(done integer, remaining bigint, total bigint, since timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 300));
  v_since timestamptz := coalesce(p_since, now());
  v_done integer := 0;
  s record;
  ev jsonb;
begin
  perform public._renewal_require_evaluator();
  for s in
    select sc.scholar_id_number
    from public.scholars sc
    where sc.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, sc.scholar_id_number)
      and not exists (select 1 from public.renewal_scholar_list_cache c where c.school_year = p_school_year and c.term = p_term and c.scholar_id_number = sc.scholar_id_number and c.computed_at >= v_since)
    order by sc.scholar_id_number
    limit v_limit
  loop
    ev := public._renewal_evaluate(s.scholar_id_number, p_school_year, p_term);
    insert into public.renewal_scholar_list_cache (school_year, term, scholar_id_number, computed_at, sdp_applicable, sdp_complied, sdp_missing, grades_state, graded, total, failed, drp, inc, review, eligibility)
    values (p_school_year, p_term, s.scholar_id_number, now(),
            coalesce((ev -> 'sdp' ->> 'applicable')::boolean, true), (ev -> 'sdp' ->> 'complied')::boolean, ev -> 'sdp' ->> 'missing', ev -> 'grades' ->> 'state',
            greatest(0, coalesce((ev -> 'grades' -> 'counts' ->> 'total')::integer, 0) - coalesce((ev -> 'grades' -> 'counts' ->> 'ungraded')::integer, 0)),
            coalesce((ev -> 'grades' -> 'counts' ->> 'total')::integer, 0),
            greatest(0, coalesce((ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0) - coalesce((ev -> 'grades' -> 'counts' ->> 'drp')::integer, 0)),
            coalesce((ev -> 'grades' -> 'counts' ->> 'drp')::integer, 0), coalesce((ev -> 'grades' -> 'counts' ->> 'inc')::integer, 0), coalesce((ev -> 'grades' -> 'counts' ->> 'review')::integer, 0),
            public._renewal_list_eligibility(ev))
    on conflict (school_year, term, scholar_id_number) do update set
      computed_at = excluded.computed_at, sdp_applicable = excluded.sdp_applicable, sdp_complied = excluded.sdp_complied, sdp_missing = excluded.sdp_missing, grades_state = excluded.grades_state,
      graded = excluded.graded, total = excluded.total, failed = excluded.failed, drp = excluded.drp, inc = excluded.inc, review = excluded.review, eligibility = excluded.eligibility;
    v_done := v_done + 1;
  end loop;
  return query
  select v_done,
         (select count(*) from public.scholars sc where sc.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, sc.scholar_id_number)
            and not exists (select 1 from public.renewal_scholar_list_cache c where c.school_year = p_school_year and c.term = p_term and c.scholar_id_number = sc.scholar_id_number and c.computed_at >= v_since)),
         (select count(*) from public.scholars sc where sc.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, sc.scholar_id_number)),
         v_since;
end;
$$;
revoke all on function public.renewal_scholar_list_refresh(text, text, timestamptz, integer) from public, anon;
grant execute on function public.renewal_scholar_list_refresh(text, text, timestamptz, integer) to authenticated;

-- The list, one page at a time, with the filters (an empty or null list means "no filter on that"; the filters of different kinds are applied TOGETHER).
create or replace function public.renewal_scholar_list(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_eligibility text[] default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
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
         c.sdp_applicable, c.sdp_complied, c.sdp_missing, c.grades_state, c.graded, c.total, c.failed, c.drp, c.inc, c.review, c.eligibility, c.computed_at,
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

-- The cross-match table: for the scholars that pass the school / year level / program filters (not the eligibility filter), how many fall under each eligibility, school by school.
create or replace function public.renewal_scholar_list_matrix(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null)
returns table(school_id uuid, school text, ready bigint, consultation bigint, sdp_reconsideration bigint, waiting bigint, review bigint, total bigint, last_checked timestamptz)
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
  select s.school_id, coalesce(sc.name, nullif(btrim(coalesce(s.school, '')), ''), '(no school set)'),
         count(*) filter (where 'ready' = any (c.eligibility)), count(*) filter (where 'consultation' = any (c.eligibility)), count(*) filter (where 'sdp_reconsideration' = any (c.eligibility)),
         count(*) filter (where 'waiting' = any (c.eligibility)), count(*) filter (where 'review' = any (c.eligibility)), count(*), min(c.computed_at)
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  left join public.schools sc on sc.id = s.school_id
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  group by s.school_id, 2
  order by 2;
end;
$$;
revoke all on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) from public, anon;
grant execute on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) to authenticated;

-- The values to choose from in the filters (schools, year levels, programs) among the scholars who can renew in the term, how many scholars that is, how many have a saved result, and the
-- oldest save. Does not need the saved results.
create or replace function public.renewal_scholar_list_options(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  return (
    with base as (
      select s.scholar_id_number, s.school_id, s.school, s.year_level, s.course from public.scholars s
      where s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    )
    select jsonb_build_object(
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', x.school_id, 'name', x.nm) order by x.nm) from (
          select b.school_id, coalesce(sc.name, '(no school set)') as nm from base b left join public.schools sc on sc.id = b.school_id group by b.school_id, 2) x), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(y order by y) from (select distinct nullif(btrim(year_level), '') as y from base) q where y is not null), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(p order by p) from (select distinct nullif(btrim(course), '') as p from base) q where p is not null), '[]'::jsonb),
      'scholars', (select count(*) from base),
      'checked', (select count(*) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term),
      'last_checked', (select min(c.computed_at) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term)));
end;
$$;
revoke all on function public.renewal_scholar_list_options(text, text) from public, anon;
grant execute on function public.renewal_scholar_list_options(text, text) to authenticated;

-- One scholar's SDP credits, for the "View credits" button on a "Not complied" scholar: the credits needed and had in each category (carry-over included, as the check counts them),
-- the credits stamped to the semester being checked, and the credits set aside for later.
create or replace function public.renewal_scholar_sdp_credits(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b_year text; v_b_term text;
  v_ev jsonb;
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_ev := public._renewal_evaluate(p_scholar_id_number, p_school_year, p_term);
  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'required', public.sdp_category_credit_required(),
    'sdp', v_ev -> 'sdp',
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object('activity', coalesce(act.name, '(activity removed)'), 'category', act.category, 'credits', act.credits, 'attended_date', a.attended_date,
                                          'activity_day', a.activity_day, 'school_year', a.school_year, 'semester', a.semester) order by a.attended_date, act.name)
      from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
      where a.scholar_id_number = p_scholar_id_number and a.school_year = v_b_year and a.semester = v_b_term), '[]'::jsonb),
    'reserved', coalesce((
      select jsonb_agg(jsonb_build_object('category', r.category, 'amount', r.amount, 'from_school_year', r.source_school_year, 'from_semester', r.source_semester, 'claimed', r.claimed,
                                          'claimed_school_year', r.claimed_school_year, 'claimed_semester', r.claimed_semester) order by r.created_at)
      from public.sdp_reserved_credits r where r.scholar_id_number = p_scholar_id_number), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_scholar_sdp_credits(text, text, text) from public, anon;
grant execute on function public.renewal_scholar_sdp_credits(text, text, text) to authenticated;

notify pgrst, 'reload schema';
