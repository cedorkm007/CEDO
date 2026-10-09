-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_show_total_credits_over_required.sql
--
-- SDP credit above the 3-per-category requirement used to be diverted into
-- sdp_reserved_credits and shown as a "+N reserved" badge, and a scholar had
-- to claim it into a later period by hand (a claim button that was never
-- wired up). New rules:
--
--   * Within a period the count is the real total: 6 credits shows 6/3,
--     4 credits shows 4/3. The requirement is simply "at least 3".
--   * Whatever is above 3 CARRIES FORWARD automatically into the next
--     semester, and keeps carrying while it lasts: earn 6 in 1st Sem →
--     3/3 carried into 2nd Sem (before any new scan) → with nothing new the
--     2nd Sem total is 3/3 and nothing carries further. Earn 7 → 4 carried
--     → 4/3 in 2nd Sem → 1 carried into the next.
--
-- How:
--   1. sdp_category_credit_goal() is the knob every scan path reads
--      (redeem_attendance_code, the monitor scan, and the survey-gated
--      finalizer all do `credits_so_far >= sdp_category_credit_goal()` → bank
--      as reserved, else insert into sdp_attendance). It is raised out of
--      reach so every credited scan now lands in sdp_attendance, stamped with
--      its period, and nothing new is ever banked. The 3-credit REQUIREMENT
--      is a separate function below.
--   2. _sdp_period_totals() computes each scholar's per-category total for one
--      period = credit earned in that period + what carried in from earlier
--      periods (excess over the requirement, cascading period to period).
--      Credit that was already banked in sdp_reserved_credits before this
--      migration is counted as earned in the period it was banked
--      (source_school_year/semester), so it is neither lost nor double
--      counted; the claimed/unclaimed flag no longer matters.
--   3. _sdp_period_credits() (used inside the scan functions),
--      fetch_scholar_sdp_progress() and scholars_sdp_checklist() all read
--      those totals. Their signatures are unchanged; the "reserved" columns
--      remain but are always 0.
--
-- Periods are ordered by school year, then 1st Semester, 2nd Semester,
-- Summer, then anything else alphabetically. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Scan-time cap out of reach; the requirement lives separately ──
create or replace function public.sdp_category_credit_goal()
returns integer
language sql
immutable
as $$ select 1000000; $$;

create or replace function public.sdp_category_credit_required()
returns integer
language sql
immutable
as $$ select 3; $$;

-- ── 2. Per-period totals with carry-over ─────────────────────
create or replace function public._sdp_period_totals(p_school_year text, p_semester text, p_scholar_id_number text default null)
returns table(scholar_id_number text, category text, total integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  all_periods as (
    select a.school_year, a.semester from public.sdp_attendance a
      where a.school_year is not null and a.semester is not null
    union
    select rc.source_school_year, rc.source_semester from public.sdp_reserved_credits rc
      where rc.source_school_year is not null and rc.source_semester is not null
    union
    select p_school_year, p_semester
  ),
  periods as (
    select ap.school_year, ap.semester,
      row_number() over (
        order by ap.school_year,
          case when ap.semester ilike '1st%' then 1 when ap.semester ilike '2nd%' then 2 when ap.semester ilike 'summer%' then 3 else 4 end,
          ap.semester
      )::integer as rn
    from all_periods ap
  ),
  target as (
    select pr.rn from periods pr where pr.school_year = p_school_year and pr.semester = p_semester
  ),
  earned as (
    select x.scholar_id_number, x.category, pr.rn, sum(x.amt)::integer as amt
    from (
      select a.scholar_id_number, act.category, a.school_year, a.semester, act.credits::integer as amt
      from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      where a.school_year is not null and a.semester is not null and act.category is not null
        and (p_scholar_id_number is null or a.scholar_id_number = p_scholar_id_number)
      union all
      select rc.scholar_id_number, rc.category, rc.source_school_year, rc.source_semester, rc.amount
      from public.sdp_reserved_credits rc
      where rc.source_school_year is not null and rc.source_semester is not null
        and (p_scholar_id_number is null or rc.scholar_id_number = p_scholar_id_number)
    ) x
    join periods pr on pr.school_year = x.school_year and pr.semester = x.semester
    where pr.rn <= (select t.rn from target t)
    group by x.scholar_id_number, x.category, pr.rn
  ),
  pairs as (
    select distinct e.scholar_id_number, e.category from earned e
  ),
  chain as (
    select p.scholar_id_number, p.category, 1 as rn,
      coalesce((select e.amt from earned e
                where e.scholar_id_number = p.scholar_id_number and e.category = p.category and e.rn = 1), 0) as total
    from pairs p
    union all
    select c.scholar_id_number, c.category, c.rn + 1,
      coalesce(e.amt, 0) + greatest(0, c.total - public.sdp_category_credit_required())
    from chain c
    left join earned e on e.scholar_id_number = c.scholar_id_number and e.category = c.category and e.rn = c.rn + 1
    where c.rn < (select t.rn from target t)
  )
  select c.scholar_id_number, c.category, c.total::integer
  from chain c
  where c.rn = (select t.rn from target t) and c.total > 0;
$$;

-- ── 3. Single-scholar total (used by the scan functions) ─────
create or replace function public._sdp_period_credits(p_scholar_id_number text, p_category text, p_school_year text, p_semester text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select t.total from public._sdp_period_totals(p_school_year, p_semester, p_scholar_id_number) t
    where t.category = p_category
  ), 0);
$$;

-- ── 4. Scholar-facing progress: totals incl. carry-over, no reserved ──
create or replace function public.fetch_scholar_sdp_progress()
returns table(category text, credits integer, reserved integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_scholar_id_number text;
  v_school_year text;
  v_semester text;
begin
  select s.scholar_id_number into v_scholar_id_number from public.scholars s where s.id = auth.uid();
  if v_scholar_id_number is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  return query
  select c.key, coalesce(t.total, 0)::integer, 0::integer
  from (values ('community_service'), ('community_volunteerism'), ('formation_program')) as c(key)
  left join public._sdp_period_totals(v_school_year, v_semester, v_scholar_id_number) t on t.category = c.key;
end;
$function$;
grant execute on function public.fetch_scholar_sdp_progress() to authenticated;

-- ── 5. Staff checklist: same totals, pre-aggregated (kept fast) ──
drop function if exists public.scholars_sdp_checklist();

create or replace function public.scholars_sdp_checklist()
returns table(
  scholar_id_number text, name text,
  community_service integer, community_volunteerism integer, formation_program integer,
  community_service_reserved integer, community_volunteerism_reserved integer, formation_program_reserved integer
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_school_year text;
  v_semester text;
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  return query
  with totals as (
    select
      t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service') as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism') as cv,
      sum(t.total) filter (where t.category = 'formation_program') as fp
    from public._sdp_period_totals(v_school_year, v_semester) t
    group by t.scholar_id_number
  )
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name,
    coalesce(tt.cs, 0)::integer,
    coalesce(tt.cv, 0)::integer,
    coalesce(tt.fp, 0)::integer,
    0::integer, 0::integer, 0::integer
  from public.scholars s
  left join totals tt on tt.scholar_id_number = s.scholar_id_number
  where s.status <> 'Removed'
  order by s.last_name, s.first_name;
end;
$function$;

revoke all on function public.scholars_sdp_checklist() from public;
grant execute on function public.scholars_sdp_checklist() to authenticated;
