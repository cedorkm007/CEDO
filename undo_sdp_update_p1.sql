-- ─────────────────────────────────────────────────────────────
-- UNDO for supabase_migration_sdp_update_p1_codes_history_speed.sql
-- Puts the three functions back exactly as they were, removes the credit-history triggers and DELETES the history table
-- (the lines it recorded are lost). Credits, activities and codes are not touched.
-- NOTE: this brings back the old, UNSAFE code-creation function (it does not check who is calling). It stays closed to direct calls
-- (the two staff screens still work), so you only lose the second layer of protection.
-- ─────────────────────────────────────────────────────────────
drop trigger if exists sdp_attendance_history on public.sdp_attendance;
drop trigger if exists sdp_activities_history on public.sdp_activities;
drop function if exists public._sdp_log_credit_change();
drop function if exists public._sdp_log_activity_change();
drop function if exists public._sdp_history_actor();
drop table if exists public.sdp_credit_history;
drop function if exists public._sdp_credit_history_block_changes();
drop index if exists public.sdp_attendance_scholar_period_idx;
drop index if exists public.sdp_attendance_period_idx;

create or replace function public.generate_attendance_codes(
  p_session_id uuid, p_kind text, p_count integer, p_batch_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_have integer;
  v_remaining integer;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- excludes 0/O, 1/I/L — matches the existing client-side alphabet
  v_max_rounds integer := 50;
  v_round integer := 0;
begin
  select count(*) into v_have from public.attendance_codes
    where session_id = p_session_id and kind = p_kind and batch_number = p_batch_number;
  v_remaining := p_count - v_have;

  while v_remaining > 0 and v_round < v_max_rounds loop
    v_round := v_round + 1;
    -- Each candidate row must get its OWN independently-random code. An
    -- uncorrelated scalar subquery here (e.g. `(select string_agg(...)
    -- from generate_series(1,7))` with no reference back to the outer
    -- row) risks PostgreSQL evaluating it once and reusing the same
    -- cached result for every row in this INSERT ... SELECT — silently
    -- generating one code repeated v_remaining times instead of
    -- v_remaining distinct codes. ON CONFLICT DO NOTHING would then
    -- insert only the first of those (all others collide with it),
    -- making large batches fail the shortfall-retry loop entirely.
    -- Grouping by the candidate row's own number and aggregating a
    -- per-row generate_series(1,7) of individually-random characters
    -- forces one independent 7-character code per candidate row.
    insert into public.attendance_codes (session_id, code, kind, batch_number)
    select
      p_session_id,
      string_agg(
        substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1),
        '' order by character_position.n
      ),
      p_kind,
      p_batch_number
    from generate_series(1, v_remaining) as candidate(n)
    cross join generate_series(1, 7) as character_position(n)
    group by candidate.n
    on conflict (code) do nothing;

    select count(*) into v_have from public.attendance_codes
      where session_id = p_session_id and kind = p_kind and batch_number = p_batch_number;
    v_remaining := p_count - v_have;
  end loop;

  if v_remaining > 0 then
    raise exception 'Could not generate % unique attendance codes for session %, kind % after % attempts — please try again.',
      p_count, p_session_id, p_kind, v_max_rounds;
  end if;
end;
$$;
revoke all on function public.generate_attendance_codes(uuid, text, integer, integer) from public, anon, authenticated;

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

create or replace function public.credit_attended_scholars(p_activity_id uuid)
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
  v_units integer;
  v_occurrence integer;
  v_scholars integer := 0;
begin
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'You are not allowed to credit scholars for this activity.';
  end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then credit the scholars.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  for v_rec in
    select r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present'
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester)
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
    end loop;
    v_scholars := v_scholars + 1;
  end loop;
  return v_scholars;
end;
$$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;

notify pgrst, 'reload schema';
