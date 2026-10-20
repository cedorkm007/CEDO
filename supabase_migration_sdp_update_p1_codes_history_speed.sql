-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 1.   Safe to re-run.   Undo: undo_sdp_update_p1.sql
--
-- Three things, all additive (no existing row is changed or deleted):
--   1. ATTENDANCE CODES: only the right people can create codes.
--      generate_attendance_codes() used to run for anybody, even a visitor who was not signed in.
--      It now (a) is closed to visitors and signed-in users calling it directly (the two staff
--      screens that need it call it from inside their own staff-checked functions, which keep working)
--      and (b) checks the caller itself: SEAD staff, the SDP Monitoring tag, or a monitor of that activity.
--   2. CREDIT HISTORY: a new table that only grows. Every SDP credit added, removed or moved, and every
--      change of an activity's category, writes one line (who, when, scholar, activity, how). Lines can
--      never be edited or deleted by anybody through the website.
--   3. CHECKLIST SPEED: one calculation is rewritten so the database reads the credit list once instead of
--      searching it again for every scholar. Same answers, about 100 times faster at your size.
-- ─────────────────────────────────────────────────────────────

-- ═══ 1. Attendance codes ═══════════════════════════════════════
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
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_max_rounds integer := 50;
  v_round integer := 0;
  v_sdp_activity uuid;
  v_formation_activity uuid;
begin
  -- Who is calling? A visitor who is not signed in, or a scholar, must never create codes.
  if auth.uid() is null then
    raise exception 'Sign in to create attendance codes.';
  end if;
  select s.sdp_activity_id, s.formation_activity_id into v_sdp_activity, v_formation_activity from public.attendance_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Attendance session not found.';
  end if;
  if not (
    public.is_sead_staff()
    or public.has_staff_tag('sdp_monitoring')
    or (v_sdp_activity is not null and public.is_activity_monitor('sdp', v_sdp_activity))
    or (v_formation_activity is not null and public.is_activity_monitor('formation', v_formation_activity))
  ) then
    raise exception 'You are not allowed to create attendance codes for this activity.';
  end if;

  select count(*) into v_have from public.attendance_codes
    where session_id = p_session_id and kind = p_kind and batch_number = p_batch_number;
  v_remaining := p_count - v_have;

  while v_remaining > 0 and v_round < v_max_rounds loop
    v_round := v_round + 1;
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
-- "from public" alone does NOT close it: Supabase also hands EXECUTE straight to the anon and authenticated roles.
revoke all on function public.generate_attendance_codes(uuid, text, integer, integer) from public, anon, authenticated;

-- ═══ 2. Credit history (append-only) ═══════════════════════════
create table if not exists public.sdp_credit_history (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in ('credit_added', 'credit_removed', 'credit_changed', 'category_changed')),
  source text not null default 'unknown',     -- scholar_scan | monitor_scan | manual | credit_attended | removed | category_edit | system
  activity_id uuid,                           -- no link on purpose: the history must survive if an activity is deleted
  activity_name text,
  scholar_id_number text,
  occurrence_number integer,
  activity_credits numeric,
  category text,
  school_year text,
  semester text,
  actor_id uuid,
  actor_name text,
  details jsonb
);
create index if not exists sdp_credit_history_activity_idx on public.sdp_credit_history (activity_id, occurred_at desc);
create index if not exists sdp_credit_history_scholar_idx on public.sdp_credit_history (scholar_id_number, occurred_at desc);

alter table public.sdp_credit_history enable row level security;
drop policy if exists "read sdp credit history" on public.sdp_credit_history;
create policy "read sdp credit history" on public.sdp_credit_history for select to authenticated
  using (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or (activity_id is not null and public.is_activity_monitor('sdp', activity_id)));
-- No insert / update / delete rule exists, and the website's roles are not given those rights.
revoke all on public.sdp_credit_history from public, anon, authenticated;
grant select on public.sdp_credit_history to authenticated;

-- Nobody (not even a database administrator working through normal SQL) edits or removes a line.
create or replace function public._sdp_credit_history_block_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'The SDP credit history is read-only: lines cannot be edited or deleted.';
end;
$$;
drop trigger if exists sdp_credit_history_no_update_delete on public.sdp_credit_history;
create trigger sdp_credit_history_no_update_delete before update or delete on public.sdp_credit_history
  for each row execute function public._sdp_credit_history_block_changes();
drop trigger if exists sdp_credit_history_no_truncate on public.sdp_credit_history;
create trigger sdp_credit_history_no_truncate before truncate on public.sdp_credit_history
  for each statement execute function public._sdp_credit_history_block_changes();

-- Who is acting right now (staff or scholar), as a readable name.
create or replace function public._sdp_history_actor()
returns table(actor_id uuid, actor_name text, actor_is_staff boolean)
language sql stable security definer set search_path = public as $$
  select u.id, nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), true from public.users u where u.id = auth.uid()
  union all
  select s.id, nullif(btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''), false from public.scholars s where s.id = auth.uid()
  limit 1;
$$;
revoke all on function public._sdp_history_actor() from public, anon, authenticated;

create or replace function public._sdp_log_credit_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row public.sdp_attendance%rowtype;
  v_act record;
  v_actor record;
  v_hint text := nullif(current_setting('app.sdp_source', true), '');
  v_event text;
  v_source text;
  v_details jsonb := null;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select a.name, a.category, a.credits into v_act from public.sdp_activities a where a.id = v_row.activity_id;
  select * into v_actor from public._sdp_history_actor();

  if tg_op = 'INSERT' then
    v_event := 'credit_added';
    v_source := coalesce(v_hint,
      case when new.created_by is not null then 'manual'
           when v_actor.actor_id is null then 'system'
           when v_actor.actor_is_staff then 'monitor_scan'
           else 'scholar_scan' end);
  elsif tg_op = 'DELETE' then
    v_event := 'credit_removed';
    v_source := coalesce(v_hint, 'removed');
  else
    if (old.activity_id, old.scholar_id_number, old.occurrence_number, old.school_year, old.semester, old.attended_date)
       is not distinct from (new.activity_id, new.scholar_id_number, new.occurrence_number, new.school_year, new.semester, new.attended_date) then
      return null;     -- nothing that matters changed
    end if;
    v_event := 'credit_changed';
    v_source := coalesce(v_hint, 'manual');
    v_details := jsonb_build_object(
      'from', jsonb_build_object('activity_id', old.activity_id, 'occurrence_number', old.occurrence_number, 'school_year', old.school_year, 'semester', old.semester, 'attended_date', old.attended_date),
      'to',   jsonb_build_object('activity_id', new.activity_id, 'occurrence_number', new.occurrence_number, 'school_year', new.school_year, 'semester', new.semester, 'attended_date', new.attended_date));
  end if;

  insert into public.sdp_credit_history (event_type, source, activity_id, activity_name, scholar_id_number, occurrence_number, activity_credits, category,
                                         school_year, semester, actor_id, actor_name, details)
  values (v_event, v_source, v_row.activity_id, v_act.name, v_row.scholar_id_number, v_row.occurrence_number, v_act.credits, v_act.category,
          v_row.school_year, v_row.semester, v_actor.actor_id, v_actor.actor_name, v_details);
  return null;
end;
$$;
revoke all on function public._sdp_log_credit_change() from public, anon, authenticated;
drop trigger if exists sdp_attendance_history on public.sdp_attendance;
create trigger sdp_attendance_history after insert or update or delete on public.sdp_attendance
  for each row execute function public._sdp_log_credit_change();

create or replace function public._sdp_log_activity_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor record;
begin
  select * into v_actor from public._sdp_history_actor();
  if old.category is distinct from new.category then
    insert into public.sdp_credit_history (event_type, source, activity_id, activity_name, activity_credits, category, actor_id, actor_name, details)
    values ('category_changed', 'category_edit', new.id, new.name, new.credits, new.category, v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('field', 'category', 'from', old.category, 'to', new.category));
  end if;
  return null;
end;
$$;
revoke all on function public._sdp_log_activity_change() from public, anon, authenticated;
drop trigger if exists sdp_activities_history on public.sdp_activities;
create trigger sdp_activities_history after update on public.sdp_activities
  for each row execute function public._sdp_log_activity_change();

-- "Credit these scholars" labels its own lines (same function as before, plus one line that names the source).
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

  perform set_config('app.sdp_source', 'credit_attended', true);
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
  perform set_config('app.sdp_source', '', true);
  return v_scholars;
end;
$$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;

-- ═══ 3. Checklist speed ════════════════════════════════════════
-- Identical to the version in supabase_migration_sdp_show_total_credits_over_required.sql EXCEPT the first step of "chain":
-- the repeated search "(select e.amt from earned e where ...)" becomes a join. Same rows, same numbers.
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
      coalesce(e1.amt, 0) as total
    from pairs p
    left join earned e1 on e1.scholar_id_number = p.scholar_id_number and e1.category = p.category and e1.rn = 1
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

-- Helps the database find one scholar's credits and one period's credits quickly.
create index if not exists sdp_attendance_scholar_period_idx on public.sdp_attendance (scholar_id_number, school_year, semester);
create index if not exists sdp_attendance_period_idx on public.sdp_attendance (school_year, semester);

notify pgrst, 'reload schema';
