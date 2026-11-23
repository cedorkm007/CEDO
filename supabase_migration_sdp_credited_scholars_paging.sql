-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_credited_scholars_paging.sql
-- SDP MONITORING > an activity > CREDITED SCHOLARS: PAGES, A "NOT CREDITED" LIST, FAST COUNTS, A FAST SCHOLAR SEARCH.
-- Safe to run twice.   Undo: undo_sdp_credited_scholars_paging.sql   (It adds indexes and read-only / helper functions; it changes and deletes no record, and it does NOT change how credits are counted.)
--
--   * sdp_credited_summary(activity): the numbers on the two buttons "Credited (N)" / "Not credited (N)" in ONE small answer: how many credits, how many scholars, how many scholars attended but have no credit,
--     how many of those can be credited, and which semesters the credits count in (for the semester filter).
--   * sdp_credited_page(...): ONE PAGE of the credits of an activity with the true total, searched by name or Scholar ID, filtered by semester, sorted by name or date.
--   * sdp_not_credited_page(...): ONE PAGE of the scholars who scanned the QR code / were marked present but have NO credit, with the reason (a code; the website words it) and whether they can be credited.
--   * sdp_credit_selected(activity, scholars, school year, semester): credits only the ticked scholars. It follows EXACTLY the same rules as the existing "Credit these scholars"
--     (credit_attended_scholars): only scholars who are present and have no credit yet, the activity must have a category, one credit per finished day, nobody is credited twice, the same history line.
--   * sdp_move_credits_semester(credits, school year, semester): moves several credits to another semester at once (the same rule and history line as the existing single move).
--   * sdp_search_scholars(text, activity, limit): the scholar search of the credit form: matches the Scholar ID, the first or last name, or the full name written either way ("juan dela cruz", "cruz juan"); first 10.
--   * Indexes for the activity's credits and for the search.
-- Who may use them: the same people who may credit scholars for that activity (SEAD staff, SDP monitoring staff, the activity's monitors and creator).
-- Needs the SDP update files (day labels, same-day sessions, semesters) to be run already.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.credit_attended_scholars(uuid,text,text)') is null or to_regprocedure('public.move_sdp_credit_semester(uuid,text,text)') is null
     or to_regprocedure('public.is_activity_monitor(text,uuid)') is null or to_regprocedure('public._sdp_redeemed_days(uuid,text)') is null then
    raise exception 'STOPPED, nothing changed: run the SDP update files (supabase_migration_sdp_update_p4_day_labels.sql and supabase_migration_sdp_update_p5_semester.sql) first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sdp_attendance' and column_name = 'activity_sid') then
    raise exception 'STOPPED, nothing changed: run supabase_migration_sdp_same_day_sessions.sql first.';
  end if;
end $$;

-- 1. Indexes (an index that exists is left alone).
create extension if not exists pg_trgm;
create index if not exists sdp_attendance_activity_date_idx on public.sdp_attendance (activity_id, attended_date desc, id);
create index if not exists sdp_attendance_activity_period_idx on public.sdp_attendance (activity_id, school_year, semester);
create index if not exists scholars_full_name_trgm_idx on public.scholars using gin ((lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops);
create index if not exists scholars_full_name_rev_trgm_idx on public.scholars using gin ((lower(coalesce(last_name, '') || ' ' || coalesce(first_name, ''))) gin_trgm_ops);

-- 2. Who may see / change the credits of an activity (the same rule as crediting).
create or replace function public._sdp_can_manage_credits(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id); $$;
revoke all on function public._sdp_can_manage_credits(uuid) from public, anon, authenticated;

-- 3. The numbers for the two buttons and the semester filter.
create or replace function public.sdp_credited_summary(p_activity_id uuid)
returns table(credited_count bigint, scholar_count bigint, not_credited_count bigint, creditable_count bigint, semesters jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  return query
  with c as (select x.scholar_id_number, x.school_year, x.semester from public.sdp_attendance x where x.activity_id = p_activity_id),
  miss as (
    select r.scholar_id_number, r.status, sc.status as scholar_status
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id and r.status in ('present', 'pending_survey')
    left join public.scholars sc on sc.scholar_id_number = r.scholar_id_number
    where s.sdp_activity_id = p_activity_id
      and not exists (select 1 from public.sdp_attendance x where x.activity_id = p_activity_id and x.scholar_id_number = r.scholar_id_number)
  ),
  sem as (
    select c.school_year, c.semester, count(*) as n from c group by c.school_year, c.semester
  )
  select (select count(*) from c), (select count(distinct c.scholar_id_number) from c),
         (select count(*) from miss),
         (select count(*) from miss where miss.status = 'present' and v_category is not null and coalesce(miss.scholar_status, '') <> 'Removed'),
         coalesce((select jsonb_agg(jsonb_build_object('school_year', sem.school_year, 'semester', sem.semester, 'n', sem.n)
                     order by public._grading_period_rank(sem.school_year, sem.semester) desc nulls last, sem.school_year desc nulls last, sem.semester) from sem), '[]'::jsonb);
end;
$$;
revoke all on function public.sdp_credited_summary(uuid) from public, anon;
grant execute on function public.sdp_credited_summary(uuid) to authenticated;

-- 4. One page of the credits of an activity.
create or replace function public.sdp_credited_page(
  p_activity_id uuid,
  p_search text default '',
  p_school_year text default null,      -- with p_semester: only the credits that count in that semester
  p_semester text default null,
  p_no_semester boolean default false,  -- only the credits that count in no semester
  p_sort text default 'date',           -- name | date
  p_dir text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  id uuid, scholar_id_number text, first_name text, last_name text, attended_date date, activity_day date, activity_sid text, school_year text, semester text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(lower(btrim(coalesce(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_');
  v_sort text := case when lower(coalesce(p_sort, '')) = 'name' then 'name' else 'date' end;
  v_dir text := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_order text;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  v_order := case v_sort
    when 'name' then format('lower(s.last_name) %1$s, lower(s.first_name) %1$s, x.attended_date desc, x.id', v_dir)
    else format('x.attended_date %1$s, lower(s.last_name), lower(s.first_name), x.id', v_dir) end;
  return query execute
    'select x.id, x.scholar_id_number, s.first_name, s.last_name, x.attended_date, x.activity_day, x.activity_sid, x.school_year, x.semester, count(*) over () as total_count
     from public.sdp_attendance x left join public.scholars s on s.scholar_id_number = x.scholar_id_number
     where x.activity_id = $1
       and ($2 = '''' or lower(x.scholar_id_number) like ''%'' || $2 || ''%'' or lower(coalesce(s.first_name, '''') || '' '' || coalesce(s.last_name, '''')) like ''%'' || $2 || ''%'' or lower(coalesce(s.last_name, '''') || '' '' || coalesce(s.first_name, '''')) like ''%'' || $2 || ''%'')
       and ($3::text is null or (x.school_year = $3 and x.semester = $4))
       and (not $5 or (x.school_year is null and x.semester is null))
     order by ' || v_order || ' limit $6 offset $7'
  using p_activity_id, v_q, p_school_year, p_semester, coalesce(p_no_semester, false), v_limit, v_offset;
end;
$$;
revoke all on function public.sdp_credited_page(uuid, text, text, text, boolean, text, text, integer, integer) from public, anon;
grant execute on function public.sdp_credited_page(uuid, text, text, text, boolean, text, text, integer, integer) to authenticated;

-- 5. One page of the scholars who attended (scanned the QR code / are present) but have NO credit.
create or replace function public.sdp_not_credited_page(p_activity_id uuid, p_search text default '', p_limit integer default 25, p_offset integer default 0)
returns table(scholar_id_number text, first_name text, last_name text, attendance_status text, reason_code text, can_credit boolean, total_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(lower(btrim(coalesce(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_category text;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  return query
  with m as (
    select r.scholar_id_number as sid, r.status as st, count(*) over () as total, s.first_name as fn, s.last_name as ln, s.status as scholar_status
    from public.attendance_sessions ses
    join public.attendance_records r on r.session_id = ses.id and r.status in ('present', 'pending_survey')
    left join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where ses.sdp_activity_id = p_activity_id
      and not exists (select 1 from public.sdp_attendance x where x.activity_id = p_activity_id and x.scholar_id_number = r.scholar_id_number)
      and (v_q = '' or lower(r.scholar_id_number) like '%' || v_q || '%' or lower(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) like '%' || v_q || '%' or lower(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')) like '%' || v_q || '%')
  )
  select m.sid, m.fn, m.ln, m.st,
         case when m.st = 'pending_survey' then 'survey'
              when v_category is null then 'no_category'
              when exists (select 1 from public.sdp_reserved_credits rc where rc.scholar_id_number = m.sid) then 'banked'
              else 'missing' end,
         (m.st = 'present' and v_category is not null and coalesce(m.scholar_status, '') <> 'Removed'),
         m.total
  from m order by lower(m.ln), lower(m.fn), m.sid limit v_limit offset v_offset;
end;
$$;
revoke all on function public.sdp_not_credited_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.sdp_not_credited_page(uuid, text, integer, integer) to authenticated;

-- 6. Credit ONLY the ticked scholars: the very same rules as credit_attended_scholars (present, no credit yet, a category, one credit per finished day, nobody twice).
create or replace function public.sdp_credit_selected(p_activity_id uuid, p_scholar_ids text[], p_school_year text default null, p_semester text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_school_year text;
  v_semester text;
  v_rec record;
  v_occurrence integer;
  v_scholars integer := 0;
  v_days date[];
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to credit scholars for this activity.'; end if;
  if p_scholar_ids is null or cardinality(p_scholar_ids) = 0 then return 0; end if;
  if cardinality(p_scholar_ids) > 500 then raise exception 'Choose at most 500 scholars at a time.'; end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then credit the scholars.'; end if;
  if coalesce(p_school_year, '') = '' and coalesce(p_semester, '') = '' then
    select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  else
    v_school_year := p_school_year; v_semester := p_semester;
    if not public._sdp_period_is_known(v_school_year, v_semester) then raise exception 'That school year and semester are not on record.'; end if;
  end if;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  perform set_config('app.sdp_source', 'credit_attended', true);
  for v_rec in
    select s.id as session_id, r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present' and r.scholar_id_number = any (p_scholar_ids)
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    v_days := public._sdp_redeemed_days(v_rec.session_id, v_rec.scholar_id_number);
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester, v_days[v_occurrence])
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
    end loop;
    v_scholars := v_scholars + 1;
  end loop;
  perform set_config('app.sdp_source', '', true);
  return v_scholars;
end;
$$;
revoke all on function public.sdp_credit_selected(uuid, text[], text, text) from public, anon;
grant execute on function public.sdp_credit_selected(uuid, text[], text, text) to authenticated;

-- 7. Move several credits to another semester at once (the same rule and the same history line as the single move).
create or replace function public.sdp_move_credits_semester(p_credit_ids uuid[], p_school_year text, p_semester text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_activity uuid;
  v_moved integer := 0;
  v_n integer;
begin
  if p_credit_ids is null or cardinality(p_credit_ids) = 0 then return 0; end if;
  if cardinality(p_credit_ids) > 500 then raise exception 'Choose at most 500 credits at a time.'; end if;
  if not public._sdp_period_is_known(p_school_year, p_semester) then raise exception 'That school year and semester are not on record.'; end if;
  for v_id in select unnest(p_credit_ids) loop
    select a.activity_id into v_activity from public.sdp_attendance a where a.id = v_id;
    if not found then continue; end if;
    if not public._sdp_can_manage_credits(v_activity) then raise exception 'You are not allowed to change this credit.'; end if;
  end loop;
  perform set_config('app.sdp_source', 'semester_move', true);
  update public.sdp_attendance set school_year = p_school_year, semester = p_semester
    where id = any (p_credit_ids) and (school_year is distinct from p_school_year or semester is distinct from p_semester);
  get diagnostics v_n = row_count;
  v_moved := v_n;
  perform set_config('app.sdp_source', '', true);
  return v_moved;
end;
$$;
revoke all on function public.sdp_move_credits_semester(uuid[], text, text) from public, anon;
grant execute on function public.sdp_move_credits_semester(uuid[], text, text) to authenticated;

-- 8. The scholar search of the credit form (indexed; the first 10).
create or replace function public.sdp_search_scholars(p_query text, p_activity_id uuid default null, p_limit integer default 10)
returns table(scholar_id_number text, name text, school text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(lower(btrim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if not (case when p_activity_id is null then (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring')) else public._sdp_can_manage_credits(p_activity_id) end) then
    raise exception 'You are not allowed to search scholars here.';
  end if;
  if v_q = '' then return; end if;
  return query
  select s.scholar_id_number, s.first_name || ' ' || s.last_name, s.school
  from public.scholars s
  where s.status <> 'Removed'
    and (lower(s.scholar_id_number) like '%' || v_q || '%' or lower(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) like '%' || v_q || '%' or lower(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')) like '%' || v_q || '%')
  order by (lower(s.scholar_id_number) = v_q) desc, (lower(s.scholar_id_number) like v_q || '%') desc, lower(s.last_name), lower(s.first_name), s.scholar_id_number
  limit v_limit;
end;
$$;
revoke all on function public.sdp_search_scholars(text, uuid, integer) from public, anon;
grant execute on function public.sdp_search_scholars(text, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
