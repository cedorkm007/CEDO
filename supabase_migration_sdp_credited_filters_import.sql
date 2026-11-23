-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_credited_filters_import.sql
-- SDP MONITORING > an activity > CREDITED SCHOLARS: FILTERS THAT CAN BE COMBINED, EXPORT OF EVERYTHING THAT MATCHES, AND IMPORT (BULK CREDITING FROM A FILE).
-- Safe to run twice.   Undo: undo_sdp_credited_filters_import.sql   (It adds read-only functions, two import functions and one index; it changes and deletes no record.
--   It does NOT change how credits are counted, who may credit or remove credits, or the credit history log. The functions of the earlier Credited Scholars updates stay as they are.)
--
-- FILTERS (the website sends the choices as one small piece of text; the database does all the matching):
--   * choices WITHIN one filter mean "any of these" (year level 1st OR 2nd); DIFFERENT filters must ALL match (year level AND school AND how credited); the search works together with them.
--   * filters for both sides: year level, school, program, barangay, cluster, scholarship status.   Credited side: semester the credit counts in, date credited (from / to), how credited, the activity day / session.
--     Not credited side: the reason (waiting for the survey, credit saved for later, no credit recorded, no SDP category; for the eligible list: did not attend / scanned once).
--   * sdp_credited_facets(...): for every filter, its options with how many scholars each would match GIVEN THE OTHER FILTERS already chosen (the filter's own choice is not counted against it).
--   * sdp_credited_summary_f(...): the numbers on the buttons, following the filters.  sdp_credited_list(...) / sdp_not_credited_list(...): ONE PAGE (up to 500 rows, which is also how the Export reads everything) with the true total.
--   * How a credit was made ("how credited") and who made it are read from the credit history (QR scan, by hand, "Credit these scholars", imported file, picture approved); a credit with no history line is a scan, or by hand when a staff member made it.
-- IMPORT (two steps, both done again by the database so nothing a browser says is trusted):
--   * sdp_import_check(activity, rows, ...): checks every row and saves NOTHING: valid / warning / error with the reason.  Scholars are matched by Scholar ID only.
--   * sdp_import_save(activity, rows, ...): credits only the rows that pass the same check, never twice and never over an existing credit, with the history line "imported" (who and when).
--     A recurring activity is credited through the existing credit_scholar_for_day (the same day / session rules as crediting by hand). At most 2,000 rows are checked at a time and 500 saved at a time.
-- Who may use all of this: the same people who may credit scholars for that activity.  Needs the earlier updates (supabase_migration_sdp_credited_scholars_paging.sql and supabase_migration_sdp_eligible_did_not_attend.sql).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._sdp_can_manage_credits(uuid)') is null or to_regprocedure('public._sdp_eligible_did_not_attend(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_sdp_credited_scholars_paging.sql and supabase_migration_sdp_eligible_did_not_attend.sql first.';
  end if;
  if to_regprocedure('public.credit_scholar_for_day(uuid,text,date,date,text,text,text)') is null or to_regprocedure('public._sdp_schedule_days(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run the SDP update files (same-day sessions) first.';
  end if;
end $$;

create index if not exists sdp_credit_history_credit_idx on public.sdp_credit_history (activity_id, scholar_id_number, occurrence_number, occurred_at desc) where event_type = 'credit_added';

-- 1. The row every list is made of (one shape for the three lists, so one filter can serve them all).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'sdp_list_row' and typnamespace = 'public'::regnamespace) then
    create type public.sdp_list_row as (
      id uuid, scholar_id_number text, first_name text, last_name text,
      year_v text, school_v text, course_v text, barangay_v text, cluster_v text, status_v text,
      attended_date date, activity_day date, activity_sid text, school_year text, semester text, semester_v text,
      occurrence_number integer, how_v text, credited_by text, day_v text,
      reason_v text, attendance_status text, can_credit boolean
    );
  end if;
end $$;

-- 2. Small helpers.
create or replace function public._sdp_norm(p text) returns text language sql immutable as $$ select coalesce(nullif(btrim(p), ''), '(none)'); $$;
revoke all on function public._sdp_norm(text) from public, anon, authenticated;

create or replace function public._sdp_how_of_source(p_source text) returns text language sql immutable as $$
  select case p_source when 'scholar_scan' then 'scan' when 'monitor_scan' then 'scan' when 'manual' then 'manual' when 'credit_attended' then 'credit_attended'
                       when 'import' then 'import' when 'progress_picture' then 'picture' else 'other' end;
$$;
revoke all on function public._sdp_how_of_source(text) from public, anon, authenticated;

create or replace function public._sdp_d(p text) returns date language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end;
$$;
revoke all on function public._sdp_d(text) from public, anon, authenticated;

-- "this row passes one filter": no filter chosen, or the filter is the one being left out (for the option counts), or the value is one of the chosen ones
create or replace function public._sdp_f(p_filters jsonb, p_key text, p_exclude text, p_value text) returns boolean language sql immutable as $$
  select p_exclude = p_key or p_filters is null or not (p_filters ? p_key) or jsonb_typeof(p_filters -> p_key) <> 'array' or jsonb_array_length(p_filters -> p_key) = 0
         or exists (select 1 from jsonb_array_elements_text(p_filters -> p_key) e where e = p_value);
$$;
revoke all on function public._sdp_f(jsonb, text, text, text) from public, anon, authenticated;

-- 3. The rows of the three lists.
create or replace function public._sdp_credit_rows(p_activity_id uuid)
returns setof public.sdp_list_row
language sql stable security definer set search_path = public as $$
  select x.id, x.scholar_id_number, s.first_name, s.last_name,
         public._sdp_norm(s.year_level), public._sdp_norm(s.school), public._sdp_norm(s.course), public._sdp_norm(s.barangay),
         coalesce(public.cdo_cluster_of_barangay(s.barangay), '(none)'), public._sdp_norm(s.status),
         x.attended_date, x.activity_day, x.activity_sid, x.school_year, x.semester,
         case when x.school_year is null or x.semester is null then 'none' else x.school_year || '|' || x.semester end,
         x.occurrence_number,
         public._sdp_how_of_source(coalesce(h.source, case when x.created_by is not null then 'manual' else 'scholar_scan' end)),
         coalesce(nullif(btrim(h.actor_name), ''), nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')),
         coalesce(x.activity_day::text, '') || '|' || coalesce(x.activity_sid, ''),
         null::text, null::text, null::boolean
  from public.sdp_attendance x
  left join public.scholars s on s.scholar_id_number = x.scholar_id_number
  left join public.users u on u.id = x.created_by
  left join lateral (
    select hh.source, hh.actor_name from public.sdp_credit_history hh
    where hh.activity_id = x.activity_id and hh.scholar_id_number = x.scholar_id_number and hh.occurrence_number is not distinct from x.occurrence_number and hh.event_type = 'credit_added'
    order by hh.occurred_at desc limit 1
  ) h on true
  where x.activity_id = p_activity_id;
$$;
revoke all on function public._sdp_credit_rows(uuid) from public, anon, authenticated;

create or replace function public._sdp_not_credited_rows(p_activity_id uuid)
returns setof public.sdp_list_row
language sql stable security definer set search_path = public as $$
  select null::uuid, r.scholar_id_number, s.first_name, s.last_name,
         public._sdp_norm(s.year_level), public._sdp_norm(s.school), public._sdp_norm(s.course), public._sdp_norm(s.barangay),
         coalesce(public.cdo_cluster_of_barangay(s.barangay), '(none)'), public._sdp_norm(s.status),
         null::date, null::date, null::text, null::text, null::text, null::text,
         null::integer, null::text, null::text, null::text,
         case when r.status = 'pending_survey' then 'survey'
              when a.category is null then 'no_category'
              when exists (select 1 from public.sdp_reserved_credits rc where rc.scholar_id_number = r.scholar_id_number) then 'banked'
              else 'missing' end,
         r.status,
         (r.status = 'present' and a.category is not null and coalesce(s.status, '') <> 'Removed')
  from public.sdp_activities a
  join public.attendance_sessions ses on ses.sdp_activity_id = a.id
  join public.attendance_records r on r.session_id = ses.id and r.status in ('present', 'pending_survey')
  left join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where a.id = p_activity_id
    and not exists (select 1 from public.sdp_attendance x where x.activity_id = a.id and x.scholar_id_number = r.scholar_id_number);
$$;
revoke all on function public._sdp_not_credited_rows(uuid) from public, anon, authenticated;

create or replace function public._sdp_eligible_rows(p_activity_id uuid)
returns setof public.sdp_list_row
language sql stable security definer set search_path = public as $$
  select null::uuid, e.scholar_id_number, s.first_name, s.last_name,
         public._sdp_norm(s.year_level), public._sdp_norm(s.school), public._sdp_norm(s.course), public._sdp_norm(s.barangay),
         coalesce(public.cdo_cluster_of_barangay(s.barangay), '(none)'), public._sdp_norm(s.status),
         null::date, null::date, null::text, null::text, null::text, null::text,
         null::integer, null::text, null::text, null::text,
         coalesce(e.attendance_status, 'none'), e.attendance_status, false
  from public._sdp_eligible_did_not_attend(p_activity_id) e join public.scholars s on s.scholar_id_number = e.scholar_id_number;
$$;
revoke all on function public._sdp_eligible_rows(uuid) from public, anon, authenticated;

-- 4. The one filter: a row passes when it passes EVERY filter of its side (and the search); p_exclude leaves one filter out (used for the option counts).
create or replace function public._sdp_ok(r public.sdp_list_row, p_side text, p_filters jsonb, p_q text, p_exclude text)
returns boolean
language sql stable as $$
  select public._sdp_f(p_filters, 'year', p_exclude, r.year_v) and public._sdp_f(p_filters, 'school', p_exclude, r.school_v) and public._sdp_f(p_filters, 'course', p_exclude, r.course_v)
     and public._sdp_f(p_filters, 'barangay', p_exclude, r.barangay_v) and public._sdp_f(p_filters, 'cluster', p_exclude, r.cluster_v) and public._sdp_f(p_filters, 'status', p_exclude, r.status_v)
     and (p_side <> 'credited' or (
           public._sdp_f(p_filters, 'semester', p_exclude, r.semester_v) and public._sdp_f(p_filters, 'how', p_exclude, r.how_v) and public._sdp_f(p_filters, 'day', p_exclude, r.day_v)
           and (public._sdp_d(p_filters ->> 'from') is null or r.attended_date >= public._sdp_d(p_filters ->> 'from'))
           and (public._sdp_d(p_filters ->> 'to') is null or r.attended_date <= public._sdp_d(p_filters ->> 'to'))))
     and (p_side = 'credited' or public._sdp_f(p_filters, 'reason', p_exclude, r.reason_v))
     and (coalesce(p_q, '') = '' or lower(r.scholar_id_number) like '%' || p_q || '%' or lower(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')) like '%' || p_q || '%'
          or lower(coalesce(r.last_name, '') || ' ' || coalesce(r.first_name, '')) like '%' || p_q || '%');
$$;
revoke all on function public._sdp_ok(public.sdp_list_row, text, jsonb, text, text) from public, anon, authenticated;

create or replace function public._sdp_q(p_search text) returns text language sql immutable as $$
  select replace(replace(replace(lower(btrim(coalesce(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_');
$$;
revoke all on function public._sdp_q(text) from public, anon, authenticated;

-- 5. The numbers on the buttons, following the filters.
create or replace function public.sdp_credited_summary_f(p_activity_id uuid, p_filters jsonb default '{}'::jsonb, p_search text default '')
returns table(credited_count bigint, scholar_count bigint, not_credited_count bigint, creditable_count bigint, eligible_applicable boolean, eligible_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := public._sdp_q(p_search);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_open boolean;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  select (a.submitted_by_scholar_id is null) into v_open from public.sdp_activities a where a.id = p_activity_id;
  if v_open is null then raise exception 'The activity was not found.'; end if;
  return query select
    (select count(*) from public._sdp_credit_rows(p_activity_id) r where public._sdp_ok(r, 'credited', v_f, v_q, '_')),
    (select count(distinct r.scholar_id_number) from public._sdp_credit_rows(p_activity_id) r where public._sdp_ok(r, 'credited', v_f, v_q, '_')),
    (select count(*) from public._sdp_not_credited_rows(p_activity_id) r where public._sdp_ok(r, 'not_credited', v_f, v_q, '_')),
    (select count(*) from public._sdp_not_credited_rows(p_activity_id) r where r.can_credit and public._sdp_ok(r, 'not_credited', v_f, v_q, '_')),
    v_open,
    case when v_open then (select count(*) from public._sdp_eligible_rows(p_activity_id) r where public._sdp_ok(r, 'eligible', v_f, v_q, '_')) else 0::bigint end;
end;
$$;
revoke all on function public.sdp_credited_summary_f(uuid, jsonb, text) from public, anon;
grant execute on function public.sdp_credited_summary_f(uuid, jsonb, text) to authenticated;

-- 6. The options of every filter with how many scholars each would match given the OTHER filters (one pass over the rows).
create or replace function public.sdp_credited_facets(p_activity_id uuid, p_side text default 'credited', p_filters jsonb default '{}'::jsonb, p_search text default '')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_side text := case when p_side in ('credited', 'not_credited', 'eligible') then p_side else 'credited' end;
  v_q text := public._sdp_q(p_search);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_src text;
  v_dims text[];
  v_sql text;
  v_out jsonb;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  v_src := case v_side when 'credited' then 'public._sdp_credit_rows($1)' when 'not_credited' then 'public._sdp_not_credited_rows($1)' else 'public._sdp_eligible_rows($1)' end;
  v_dims := case when v_side = 'credited' then array['year', 'school', 'course', 'barangay', 'cluster', 'status', 'semester', 'how', 'day'] else array['year', 'school', 'course', 'barangay', 'cluster', 'status', 'reason'] end;
  -- only fixed text is put together here (the side and the filter names come from the lists above); what the caller sent goes in as values ($2 ...)
  v_sql := 'with base as materialized (select * from ' || v_src || ') select coalesce(jsonb_object_agg(t.d, t.l), ''{}''::jsonb) from ('
    || 'select ''total'' as d, jsonb_build_object(''rows'', count(*), ''scholars'', count(distinct r.scholar_id_number)) as l from base r where public._sdp_ok(r, $2, $3, $4, ''_'')'
    || coalesce((select string_agg(format(' union all select %L as d, coalesce(jsonb_agg(jsonb_build_object(''v'', q.v, ''n'', q.n) order by q.n desc, q.v), ''[]''::jsonb) as l from (select r.%I as v, count(distinct r.scholar_id_number) as n from base r where public._sdp_ok(r, $2, $3, $4, %L) group by 1) q', d, d || '_v', d), '') from unnest(v_dims) d), '')
    || ') t';
  execute v_sql into v_out using p_activity_id, v_side, v_f, v_q;
  return v_out;
end;
$$;
revoke all on function public.sdp_credited_facets(uuid, text, jsonb, text) from public, anon;
grant execute on function public.sdp_credited_facets(uuid, text, jsonb, text) to authenticated;

-- 7. One page of the credits (up to 500 rows; the Export reads everything page by page).
create or replace function public.sdp_credited_list(
  p_activity_id uuid, p_filters jsonb default '{}'::jsonb, p_search text default '', p_sort text default 'date', p_dir text default 'desc', p_limit integer default 25, p_offset integer default 0
)
returns table(
  id uuid, scholar_id_number text, first_name text, last_name text, year_level text, school text, course text, barangay text, cluster text, scholar_status text,
  attended_date date, activity_day date, activity_sid text, school_year text, semester text, how text, credited_by text, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := public._sdp_q(p_search);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_sort text := case when lower(coalesce(p_sort, '')) = 'name' then 'name' else 'date' end;
  v_dir text := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  return query
  select r.id, r.scholar_id_number, r.first_name, r.last_name, nullif(r.year_v, '(none)'), nullif(r.school_v, '(none)'), nullif(r.course_v, '(none)'), nullif(r.barangay_v, '(none)'), nullif(r.cluster_v, '(none)'), nullif(r.status_v, '(none)'),
         r.attended_date, r.activity_day, r.activity_sid, r.school_year, r.semester, r.how_v, r.credited_by, count(*) over ()
  from public._sdp_credit_rows(p_activity_id) r
  where public._sdp_ok(r, 'credited', v_f, v_q, '_')
  order by
    case when v_sort = 'name' and v_dir = 'asc' then lower(r.last_name) end asc, case when v_sort = 'name' and v_dir = 'asc' then lower(r.first_name) end asc,
    case when v_sort = 'name' and v_dir = 'desc' then lower(r.last_name) end desc, case when v_sort = 'name' and v_dir = 'desc' then lower(r.first_name) end desc,
    case when v_sort = 'date' and v_dir = 'asc' then r.attended_date end asc, case when v_sort = 'date' and v_dir = 'desc' then r.attended_date end desc,
    lower(r.last_name), lower(r.first_name), r.id
  limit v_limit offset v_offset;
end;
$$;
revoke all on function public.sdp_credited_list(uuid, jsonb, text, text, text, integer, integer) from public, anon;
grant execute on function public.sdp_credited_list(uuid, jsonb, text, text, text, integer, integer) to authenticated;

-- 8. One page of the scholars who are not credited: "attended" (scanned / present, no credit) or "eligible" (open to them, did not attend).
create or replace function public.sdp_not_credited_list(
  p_activity_id uuid, p_kind text default 'attended', p_filters jsonb default '{}'::jsonb, p_search text default '', p_limit integer default 25, p_offset integer default 0
)
returns table(
  scholar_id_number text, first_name text, last_name text, year_level text, school text, course text, barangay text, cluster text, scholar_status text,
  attendance_status text, reason_code text, can_credit boolean, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := public._sdp_q(p_search);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  if p_kind = 'eligible' then
    return query
    select r.scholar_id_number, r.first_name, r.last_name, nullif(r.year_v, '(none)'), nullif(r.school_v, '(none)'), nullif(r.course_v, '(none)'), nullif(r.barangay_v, '(none)'), nullif(r.cluster_v, '(none)'), nullif(r.status_v, '(none)'),
           r.attendance_status, r.reason_v, r.can_credit, count(*) over ()
    from public._sdp_eligible_rows(p_activity_id) r where public._sdp_ok(r, 'eligible', v_f, v_q, '_')
    order by lower(r.last_name), lower(r.first_name), r.scholar_id_number limit v_limit offset v_offset;
  else
    return query
    select r.scholar_id_number, r.first_name, r.last_name, nullif(r.year_v, '(none)'), nullif(r.school_v, '(none)'), nullif(r.course_v, '(none)'), nullif(r.barangay_v, '(none)'), nullif(r.cluster_v, '(none)'), nullif(r.status_v, '(none)'),
           r.attendance_status, r.reason_v, r.can_credit, count(*) over ()
    from public._sdp_not_credited_rows(p_activity_id) r where public._sdp_ok(r, 'not_credited', v_f, v_q, '_')
    order by lower(r.last_name), lower(r.first_name), r.scholar_id_number limit v_limit offset v_offset;
  end if;
end;
$$;
revoke all on function public.sdp_not_credited_list(uuid, text, jsonb, text, integer, integer) from public, anon;
grant execute on function public.sdp_not_credited_list(uuid, text, jsonb, text, integer, integer) to authenticated;

-- 9. IMPORT: check every row (nothing is saved). The rows are a list of {i, scholar_id, date, date_text, school_year, semester, day_sub, credits, note}; the dates and the semester are read by the website.
create or replace function public._sdp_import_eval(p_activity_id uuid, p_rows jsonb, p_default_sy text, p_default_sem text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.sdp_activities%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_n integer;
  v_i integer;
  v_msgs text[]; v_errs text[];
  v_scholar text; v_sc public.scholars%rowtype;
  v_date date;
  v_sy text; v_sem text; v_sub text;
  v_sid text; v_day date; v_cnt integer; v_first_sid text;
  v_skip boolean; v_state text;
  v_seen text[] := '{}';
  v_key text;
  v_allowed integer; v_have integer;
  v_default_sy text := p_default_sy; v_default_sem text := p_default_sem;
begin
  select * into a from public.sdp_activities where id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if coalesce(v_default_sy, '') = '' or coalesce(v_default_sem, '') = '' then
    select gps.current_school_year, gps.current_semester into v_default_sy, v_default_sem from public.grading_period_settings gps where gps.id = true;
  end if;
  for v_row, v_n in select e.value, e.ordinality::integer from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(value, ordinality) loop
    v_i := coalesce(nullif(v_row ->> 'i', '')::integer, v_n);
    v_msgs := '{}'; v_errs := '{}'; v_skip := false; v_sid := null; v_day := null; v_sc := null; v_scholar := null; v_date := null; v_sy := null; v_sem := null;
    if a.category is null then v_errs := v_errs || 'This activity has no SDP category, so it gives no credit.'::text; end if;

    -- the scholar: by Scholar ID only, never by name
    select s.* into v_sc from public.scholars s where lower(s.scholar_id_number) = lower(btrim(coalesce(v_row ->> 'scholar_id', ''))) limit 1;
    if v_sc.scholar_id_number is null then v_errs := v_errs || 'Scholar ID not found.'::text; else
      v_scholar := v_sc.scholar_id_number;
      if v_sc.status = 'Removed' then v_msgs := v_msgs || 'This scholar is Removed.'::text; end if;
      if a.submitted_by_scholar_id is null and not ((a.all_year_levels or v_sc.year_level = any (a.target_year_levels)) and public.sdp_activity_visible_to_barangay(a.target_barangays, a.target_clusters, v_sc.barangay)) then
        v_msgs := v_msgs || 'This scholar is not eligible for this activity (year level or barangay). The credit is still added.'::text;
      end if;
    end if;

    -- the date
    v_date := public._sdp_d(v_row ->> 'date');
    if v_date is null then v_errs := v_errs || case when coalesce(btrim(v_row ->> 'date_text'), '') = '' then 'Date credited is missing.' else 'The date is not a valid date.' end; end if;

    -- the semester (blank = the semester chosen at "Counts in")
    if coalesce(btrim(v_row ->> 'school_year'), '') = '' and coalesce(btrim(v_row ->> 'semester'), '') = '' then
      v_sy := v_default_sy; v_sem := v_default_sem;
    else
      v_sy := btrim(v_row ->> 'school_year'); v_sem := btrim(v_row ->> 'semester');
      if coalesce(v_sy, '') = '' or coalesce(v_sem, '') = '' or not public._sdp_period_is_known(v_sy, v_sem) then v_errs := v_errs || 'Semester not found.'::text;
      elsif (v_sy, v_sem) is distinct from (v_default_sy, v_default_sem) then v_msgs := v_msgs || 'The semester is different from the one chosen at “Counts in”.'::text; end if;
    end if;
    if coalesce(v_default_sy, '') = '' and coalesce(v_sy, '') = '' then v_errs := v_errs || 'The current school year and semester are not set yet.'::text; end if;

    if nullif(btrim(coalesce(v_row ->> 'credits', '')), '') is not null and (v_row ->> 'credits') ~ '^\d+(\.\d+)?$' and (v_row ->> 'credits')::numeric is distinct from a.credits::numeric then
      v_msgs := v_msgs || format('This activity gives %s credit%s; the number in the file is ignored.', a.credits, case when a.credits = 1 then '' else 's' end);
    end if;

    if v_scholar is not null and cardinality(v_errs) = 0 then
      if a.activity_type = 'recurring' then
        -- which session: by its sub-name, else by the date when only one session is on that day
        v_sub := nullif(btrim(coalesce(v_row ->> 'day_sub', '')), '');
        if v_sub is not null then
          select count(*) into v_cnt from public._sdp_schedule_days(p_activity_id) d where lower(coalesce(d.sub_name, '')) = lower(v_sub);
          if v_cnt = 0 then v_errs := v_errs || 'The Day sub-name is not one of this activity''s sessions.'::text;
          else
            select d.day, d.sid into v_day, v_sid from public._sdp_schedule_days(p_activity_id) d where lower(coalesce(d.sub_name, '')) = lower(v_sub)
              order by (d.day = v_date) desc, d.ord limit 1;
          end if;
        else
          select count(*) into v_cnt from public._sdp_schedule_days(p_activity_id) d where d.day = v_date;
          if v_cnt = 0 then v_errs := v_errs || 'That date is not one of the days of this activity.'::text;
          elsif v_cnt > 1 then v_errs := v_errs || 'Several sessions are on that date: write the Day sub-name of the session.'::text;
          else select d.day, d.sid into v_day, v_sid from public._sdp_schedule_days(p_activity_id) d where d.day = v_date limit 1; end if;
        end if;
        if cardinality(v_errs) = 0 then
          select d.sid into v_first_sid from public._sdp_schedule_days(p_activity_id) d where d.day = v_day order by d.ord limit 1;
          if exists (
            select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar and (
              (v_sid is not null and c.activity_sid = v_sid)
              or (v_sid is not null and c.activity_sid is null and (c.activity_day = v_day or (c.activity_day is null and c.attended_date = v_day)) and v_sid is not distinct from v_first_sid)
              or (v_sid is null and (c.activity_day = v_day or (c.activity_day is null and c.attended_date = v_day))))
          ) then v_skip := true; v_msgs := v_msgs || 'This scholar already has this credit: it is skipped (nobody is credited twice).'::text; end if;
          v_allowed := public._sdp_allowed_occurrences(p_activity_id);
          select count(*) into v_have from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar;
          if not v_skip and v_have >= v_allowed then v_skip := true; v_msgs := v_msgs || format('This scholar already has all %s credit%s of this activity: it is skipped.', v_allowed, case when v_allowed = 1 then '' else 's' end); end if;
        end if;
      else
        if exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_scholar) then
          v_skip := true; v_msgs := v_msgs || 'This scholar already has this credit: it is skipped (nobody is credited twice).'::text;
        end if;
      end if;
      -- the same scholar (and session) twice in the file: only the first is used
      v_key := v_scholar || '|' || coalesce(v_day::text, '') || '|' || coalesce(v_sid, '');
      if cardinality(v_errs) = 0 and not v_skip and v_key = any (v_seen) then v_skip := true; v_msgs := v_msgs || 'Duplicate row in the file: the first one is used, this one is skipped.'::text; end if;
      if cardinality(v_errs) = 0 and not v_skip then v_seen := v_seen || v_key; end if;
    end if;

    v_state := case when cardinality(v_errs) > 0 then 'error' when cardinality(v_msgs) > 0 then 'warning' else 'valid' end;
    v_out := v_out || jsonb_build_object('i', v_i, 'state', v_state, 'will_credit', (v_state <> 'error' and not v_skip), 'skip', v_skip,
        'messages', to_jsonb(v_errs || v_msgs), 'scholar_id', v_scholar, 'name', case when v_sc.scholar_id_number is null then null else btrim(coalesce(v_sc.first_name, '') || ' ' || coalesce(v_sc.last_name, '')) end,
        'date', v_date, 'school_year', v_sy, 'semester', v_sem, 'session_day', v_day, 'session_sid', v_sid);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._sdp_import_eval(uuid, jsonb, text, text) from public, anon, authenticated;

create or replace function public.sdp_import_check(p_activity_id uuid, p_rows jsonb, p_default_school_year text default null, p_default_semester text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to credit scholars for this activity.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to check.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'A file can have at most 2,000 rows.'; end if;
  v := public._sdp_import_eval(p_activity_id, p_rows, p_default_school_year, p_default_semester);
  return jsonb_build_object('rows', v,
    'valid', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'valid'),
    'warning', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'warning'),
    'error', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'error'),
    'will_credit', (select count(*) from jsonb_array_elements(v) e where (e.value ->> 'will_credit')::boolean),
    'skipped', (select count(*) from jsonb_array_elements(v) e where (e.value ->> 'skip')::boolean));
end;
$$;
revoke all on function public.sdp_import_check(uuid, jsonb, text, text) from public, anon;
grant execute on function public.sdp_import_check(uuid, jsonb, text, text) to authenticated;

-- 10. IMPORT: save. The rows are checked again; only the ones that pass are credited, with the history line "imported" (who and when).
create or replace function public.sdp_import_save(p_activity_id uuid, p_rows jsonb, p_default_school_year text default null, p_default_semester text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  e jsonb;
  v_results jsonb := '[]'::jsonb;
  v_credited integer := 0; v_skipped integer := 0; v_errors integer := 0;
  v_n integer;
  v_msg text;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to credit scholars for this activity.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to save.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Save at most 500 rows at a time.'; end if;
  v := public._sdp_import_eval(p_activity_id, p_rows, p_default_school_year, p_default_semester);
  perform set_config('app.sdp_source', 'import', true);
  for e in select x.value from jsonb_array_elements(v) x loop
    if e ->> 'state' = 'error' then
      v_errors := v_errors + 1; v_results := v_results || jsonb_build_object('i', (e ->> 'i')::integer, 'outcome', 'error', 'message', e -> 'messages' ->> 0);
    elsif (e ->> 'skip')::boolean then
      v_skipped := v_skipped + 1; v_results := v_results || jsonb_build_object('i', (e ->> 'i')::integer, 'outcome', 'skipped', 'message', e -> 'messages' ->> 0);
    else
      begin
        if (select a.activity_type from public.sdp_activities a where a.id = p_activity_id) = 'recurring' then
          perform public.credit_scholar_for_day(p_activity_id, e ->> 'scholar_id', (e ->> 'session_day')::date, (e ->> 'date')::date, e ->> 'school_year', e ->> 'semester', e ->> 'session_sid');
          v_n := 1;
        else
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (p_activity_id, e ->> 'scholar_id', (e ->> 'date')::date, auth.uid(), 1, e ->> 'school_year', e ->> 'semester')
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
          get diagnostics v_n = row_count;
        end if;
        if v_n > 0 then v_credited := v_credited + 1; v_results := v_results || jsonb_build_object('i', (e ->> 'i')::integer, 'outcome', 'credited', 'message', null);
        else v_skipped := v_skipped + 1; v_results := v_results || jsonb_build_object('i', (e ->> 'i')::integer, 'outcome', 'skipped', 'message', 'This scholar already has this credit: it is skipped.'); end if;
      exception when others then
        get stacked diagnostics v_msg = message_text;
        v_errors := v_errors + 1; v_results := v_results || jsonb_build_object('i', (e ->> 'i')::integer, 'outcome', 'error', 'message', v_msg);
      end;
    end if;
  end loop;
  perform set_config('app.sdp_source', '', true);
  return jsonb_build_object('credited', v_credited, 'skipped', v_skipped, 'errors', v_errors, 'results', v_results);
end;
$$;
revoke all on function public.sdp_import_save(uuid, jsonb, text, text) from public, anon;
grant execute on function public.sdp_import_save(uuid, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
