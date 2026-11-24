-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_recheck_targeted.sql
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 2: THE OPEN RENEWALS ARE CHECKED AGAIN ONLY WHEN THEY NEED IT, WITH A PROGRESS COUNT.   Safe to run twice.   Undo: undo_academic_recheck_targeted.sql
--   * Until now every change of a status or of a passing GWA raised one number that made EVERY open renewal of every school wait to be checked again, 60 every 5 minutes (hours for a big change).
--   * Now a change checks again only the open renewals of the scholars whose PASSING GWA really changes (a scholar who goes from Not set to Academic keeps the same number: nothing to check). Changing a school's passing GWA checks
--     only that school's scholars whose number changed. The renewals wait in a list (academic_recheck_queue). A small change (up to 10 renewals) is checked in the same action; a bigger one is checked 25 at a time while the
--     staff watch "Re-checking 340 renewals… 120 done" in Grades and Academic Management, and what is left is finished by the 5-minute background job that already exists (a closed tab never loses a check).
--   * A renewal that cannot be checked is tried 3 times, then counted as "could not be checked" (shown to the staff); it is never lost silently.
--   * The impact shown before a change now also says how many renewals will be checked again.
--   Adds 1 table and 6 functions; replaces 4 functions (the originals are in the undo file). Nothing is deleted.
-- Needs supabase_migration_academic_status_screen.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.academic_status_apply(uuid,jsonb,text[],text,numeric,boolean,text,integer)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_status_screen.sql first.';
  end if;
end $$;

-- 1. The list of renewals waiting to be checked again.
create table if not exists public.academic_recheck_queue (
  id                bigint generated always as identity primary key,
  record_id         uuid not null,
  scholar_id_number text not null,
  school_id         uuid,
  reason            text not null default '',
  queued_at         timestamptz not null default now(),
  attempts          integer not null default 0,
  error             text,
  done_at           timestamptz
);
create unique index if not exists academic_recheck_queue_pending_uq on public.academic_recheck_queue (record_id) where done_at is null;
create index if not exists academic_recheck_queue_school_idx on public.academic_recheck_queue (school_id) where done_at is null;
alter table public.academic_recheck_queue enable row level security;
revoke all on table public.academic_recheck_queue from public, anon, authenticated;

-- 2. The passing GWA a scholar would have with a status (Not set counts as Academic) and a custom number: the school's number for it, or the custom one. null = the rule is off.
create or replace function public._academic_passing_of(p_school uuid, p_status text, p_custom numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_custom, case coalesce(p_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end)
  from (select 1) o left join public.academic_school_settings ss on ss.school_id = p_school;
$$;
revoke all on function public._academic_passing_of(uuid, text, numeric) from public, anon, authenticated;

-- 3. Puts the open renewals of the given scholars in the list (one place per renewal); returns how many are waiting for them.
create or replace function public._academic_enqueue_recheck(p_scholars text[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_scholars is null or cardinality(p_scholars) = 0 then return 0; end if;
  insert into public.academic_recheck_queue (record_id, scholar_id_number, school_id, reason)
  select r.id, r.scholar_id_number, s.school_id, coalesce(p_reason, '')
  from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.scholar_id_number = any (p_scholars) and public._renewal_is_active_stage(r.stage)
  on conflict (record_id) where done_at is null do nothing;
  select count(*) into n from public.academic_recheck_queue q where q.done_at is null and q.scholar_id_number = any (p_scholars);
  return n;
end;
$$;
revoke all on function public._academic_enqueue_recheck(text[], text) from public, anon, authenticated;

-- 4. Checks the next renewals of the list (p_limit at a time). One that fails is tried again later, 3 times at most.
create or replace function public._academic_recheck_process(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
  n integer := 0;
begin
  for q in select x.id, x.record_id from public.academic_recheck_queue x where x.done_at is null and x.attempts < 3 order by x.id limit greatest(1, p_limit) for update skip locked loop
    begin
      perform public._renewal_recheck(q.record_id);
      update public.academic_recheck_queue set done_at = now(), error = null where id = q.id;
    exception when others then
      update public.academic_recheck_queue set attempts = attempts + 1, error = left(sqlerrm, 300), done_at = case when attempts + 1 >= 3 then now() else null end where id = q.id;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._academic_recheck_process(integer) from public, anon, authenticated;

-- 5. The 5-minute background job: the list first, then (as before) any renewal still on an older settings number.
create or replace function public._academic_recheck_batch(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v integer := (select g.version from public.academic_gwa_settings g where g.id);
  n integer := public._academic_recheck_process(greatest(1, p_limit));
begin
  if n >= p_limit then return n; end if;
  for r in select x.id from public.renewal_records x where public._renewal_is_active_stage(x.stage) and coalesce(x.evaluation ->> 'academic_version', '') <> v::text order by x.updated_at limit greatest(1, p_limit - n) loop
    perform public._renewal_recheck(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._academic_recheck_batch(integer) from public, anon, authenticated;

-- 6. For the screen: check the next batch now (the staff watch the count), and read where it stands.
create or replace function public.academic_recheck_step(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n integer; v_left integer;
begin
  perform public._academic_require_manager();
  n := public._academic_recheck_process(least(greatest(coalesce(p_limit, 25), 1), 50));
  select count(*) into v_left from public.academic_recheck_queue where done_at is null;
  return jsonb_build_object('processed', n, 'remaining', v_left);
end;
$$;
revoke all on function public.academic_recheck_step(integer) from public, anon;
grant execute on function public.academic_recheck_step(integer) to authenticated;

create or replace function public.academic_recheck_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return jsonb_build_object(
    'pending', (select count(*) from public.academic_recheck_queue where done_at is null),
    'failed', (select count(*) from public.academic_recheck_queue where done_at is not null and error is not null and done_at > now() - interval '7 days'),
    'done_today', (select count(*) from public.academic_recheck_queue where done_at is not null and error is null and done_at > now() - interval '1 day'));
end;
$$;
revoke all on function public.academic_recheck_status() from public, anon;
grant execute on function public.academic_recheck_status() to authenticated;

-- 7. The impact before a change (now with the number of renewals that will be checked again).
create or replace function public.academic_status_impact(p_school uuid, p_filter jsonb, p_ids text[], p_status text, p_custom numeric default null, p_clear_custom boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_new text := case when p_status = 'not_set' then null else p_status end;
  v_ids text[]; v jsonb; ss public.academic_school_settings%rowtype;
begin
  perform public._academic_require_manager();
  perform public._academic_check_change(p_school, p_status, p_custom, p_clear_custom);
  select array_agg(x) into v_ids from public._academic_filter_ids(p_school, p_filter, p_ids) x;
  select * into ss from public.academic_school_settings where school_id = p_school;
  with cur as (
    select i.id, t.academic_status os, t.custom_passing_gwa oc,
           case when p_clear_custom then null when p_custom is not null then p_custom else t.custom_passing_gwa end nc
    from unnest(coalesce(v_ids, '{}'::text[])) i(id) left join public.scholar_academic_status t on t.scholar_id_number = i.id
  ), chg as (select * from cur where os is distinct from v_new or (v_new is not null and oc is distinct from nc))
  select jsonb_build_object(
    'total', (select count(*) from cur), 'will_change', (select count(*) from chg), 'same', (select count(*) from cur) - (select count(*) from chg),
    'from_not_set', (select count(*) from chg where os is null), 'from_academic', (select count(*) from chg where os = 'academic'), 'from_non_academic', (select count(*) from chg where os = 'non_academic'),
    'custom_set', (select count(*) from chg where v_new is not null and nc is not null and oc is distinct from nc), 'custom_cleared', (select count(*) from chg where oc is not null and nc is null),
    'open_renewals', (select count(*) from chg c where exists (select 1 from public.renewal_records r where r.scholar_id_number = c.id and r.stage not in ('renewed', 'removed', 'late_declined', 'not_required', 'reconsidered', 'division_head_approved'))),
    'recheck_renewals', (select count(*) from chg c join public.renewal_records r on r.scholar_id_number = c.id where public._renewal_is_active_stage(r.stage) and public._academic_passing_of(p_school, c.os, c.oc) is distinct from public._academic_passing_of(p_school, v_new, case when v_new is null then null else c.nc end)))
  into v;
  return v || jsonb_build_object('rule_on', ss.academic_passing_gwa is not null, 'academic_passing_gwa', ss.academic_passing_gwa, 'non_academic_passing_gwa', ss.non_academic_passing_gwa);
end;
$$;
revoke all on function public.academic_status_impact(uuid, jsonb, text[], text, numeric, boolean) from public, anon;
grant execute on function public.academic_status_impact(uuid, jsonb, text[], text, numeric, boolean) to authenticated;

-- 8. The change.
create or replace function public.academic_status_apply(p_school uuid, p_filter jsonb, p_ids text[], p_status text, p_custom numeric default null, p_clear_custom boolean default false, p_reason text default null, p_expected integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := case when p_status = 'not_set' then null else p_status end;
  v_ids text[]; v_changed integer; v_total integer; v_rc text[]; v_queued integer := 0; v_now integer := 0;
  v_how text := case when p_ids is null then 'matching' when cardinality(p_ids) = 1 then 'manual' else 'selection' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public._academic_require_manager();
  perform public._academic_check_change(p_school, p_status, p_custom, p_clear_custom);
  if p_ids is not null and cardinality(p_ids) > 20000 then raise exception 'Too many scholars at once (at most 20,000).'; end if;
  select array_agg(x) into v_ids from public._academic_filter_ids(p_school, p_filter, p_ids) x;
  v_total := coalesce(cardinality(v_ids), 0);
  if v_total > 20000 then raise exception 'Too many scholars at once (at most 20,000): narrow the filters.'; end if;
  with cur as (
    select i.id, t.academic_status os, t.custom_passing_gwa oc,
           case when p_clear_custom then null when p_custom is not null then p_custom else t.custom_passing_gwa end nc
    from unnest(coalesce(v_ids, '{}'::text[])) i(id) left join public.scholar_academic_status t on t.scholar_id_number = i.id
  ), chg as (select * from cur where os is distinct from v_new or (v_new is not null and oc is distinct from nc))
  select count(*), array_agg(c.id) filter (where public._academic_passing_of(p_school, c.os, c.oc) is distinct from public._academic_passing_of(p_school, v_new, case when v_new is null then null else c.nc end)) into v_changed, v_rc from chg c;
  if p_expected is not null and p_expected <> v_changed then
    raise exception 'The numbers changed since you looked (% scholars would change now, not %). Nothing was saved: please look again.', v_changed, p_expected;
  end if;
  if v_changed > 0 then
    with cur as (
      select i.id, t.academic_status os, t.custom_passing_gwa oc,
             case when p_clear_custom then null when p_custom is not null then p_custom else t.custom_passing_gwa end nc
      from unnest(v_ids) i(id) left join public.scholar_academic_status t on t.scholar_id_number = i.id
    ), chg as (select * from cur where os is distinct from v_new or (v_new is not null and oc is distinct from nc)),
    hist as (
      insert into public.academic_status_history (scholar_id_number, school_id, old_status, new_status, old_custom_gwa, new_custom_gwa, how, reason, by_user, by_label)
      select c.id, p_school, c.os, v_new, c.oc, case when v_new is null then null else c.nc end, v_how, v_reason, auth.uid(), public._actor_name() from chg c returning 1
    ), up as (
      insert into public.scholar_academic_status (scholar_id_number, academic_status, custom_passing_gwa, source, reason, updated_by, updated_at)
      select c.id, v_new, c.nc, 'manual', v_reason, auth.uid(), now() from chg c where v_new is not null
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, custom_passing_gwa = excluded.custom_passing_gwa, source = 'manual', reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      returning 1
    ), del as (
      delete from public.scholar_academic_status d where v_new is null and d.scholar_id_number in (select id from chg) returning 1
    )
    select (select count(*) from hist) into v_changed;
    v_queued := public._academic_enqueue_recheck(v_rc, 'status');      -- only the open renewals of the scholars whose passing GWA changes
    if v_queued > 0 and v_queued <= 10 then v_now := public._academic_recheck_process(10); end if;      -- a small change is checked now, in this same action
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Academic status of ' || v_changed || ' scholar(s) set to ' || coalesce(p_status, '') || ' (' || v_how || ').');
  end if;
  return jsonb_build_object('changed', v_changed, 'same', v_total - v_changed, 'total', v_total, 'rechecks', v_queued, 'rechecked_now', v_now);
end;
$$;
revoke all on function public.academic_status_apply(uuid, jsonb, text[], text, numeric, boolean, text, integer) from public, anon;
grant execute on function public.academic_status_apply(uuid, jsonb, text[], text, numeric, boolean, text, integer) to authenticated;

-- 9. "Set by file".
create or replace function public.academic_bulk_save(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb; e jsonb;
  v_set integer := 0; v_skipped integer := 0; v_errors integer := 0;
  v_old text; v_old_gwa numeric; v_school uuid; v_rc text[] := '{}'; v_queued integer := 0; v_now integer := 0;
begin
  perform public._academic_require_manager();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to save.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'A file can have at most 3,000 rows.'; end if;
  v := public._academic_bulk_eval(p_rows);
  for e in select x.value from jsonb_array_elements(v) x loop
    if e ->> 'action' = 'set' then
      select t.academic_status, t.custom_passing_gwa into v_old, v_old_gwa from public.scholar_academic_status t where t.scholar_id_number = e ->> 'scholar_id';
      select s.school_id into v_school from public.scholars s where s.scholar_id_number = e ->> 'scholar_id';
      insert into public.scholar_academic_status (scholar_id_number, academic_status, source, updated_by, updated_at) values (e ->> 'scholar_id', e ->> 'new_status', 'file', auth.uid(), now())
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, source = 'file', updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      insert into public.academic_status_history (scholar_id_number, school_id, old_status, new_status, old_custom_gwa, new_custom_gwa, how, by_user, by_label)
        values (e ->> 'scholar_id', v_school, v_old, e ->> 'new_status', v_old_gwa, v_old_gwa, 'file', auth.uid(), public._actor_name());
      if public._academic_passing_of(v_school, v_old, v_old_gwa) is distinct from public._academic_passing_of(v_school, e ->> 'new_status', v_old_gwa) then v_rc := v_rc || (e ->> 'scholar_id'); end if;
      v_set := v_set + 1;
    elsif e ->> 'state' = 'error' then v_errors := v_errors + 1;
    else v_skipped := v_skipped + 1; end if;
  end loop;
  if v_set > 0 then
    v_queued := public._academic_enqueue_recheck(v_rc, 'file');      -- only the open renewals of the scholars whose passing GWA changes
    if v_queued > 0 and v_queued <= 10 then v_now := public._academic_recheck_process(10); end if;
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Bulk upload of scholars'' academic status: ' || v_set || ' set.');
  end if;
  return jsonb_build_object('set', v_set, 'reset', 0, 'skipped', v_skipped, 'errors', v_errors, 'rechecks', v_queued, 'rechecked_now', v_now,
    'results', (select coalesce(jsonb_agg(jsonb_build_object('i', (x.value ->> 'i')::integer, 'outcome', case when x.value ->> 'action' = 'set' then 'set' when x.value ->> 'state' = 'error' then 'error' else 'skipped' end,
      'message', x.value -> 'messages' ->> 0)), '[]'::jsonb) from jsonb_array_elements(v) x));
end;
$$;
revoke all on function public.academic_bulk_save(jsonb) from public, anon;
grant execute on function public.academic_bulk_save(jsonb) to authenticated;

-- 10. The passing GWA of a school.
create or replace function public.academic_settings_save(p_school uuid, p_academic numeric, p_non_academic numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_old public.academic_school_settings%rowtype;
  v_rc text[]; v_queued integer := 0;
begin
  perform public._academic_require_manager();
  select name into v_name from public.schools where id = p_school;
  if v_name is null then raise exception 'Choose a school.'; end if;
  perform public._academic_check_gwa(p_school, p_academic);
  perform public._academic_check_gwa(p_school, p_non_academic);
  select * into v_old from public.academic_school_settings where school_id = p_school;
  insert into public.academic_school_settings (school_id, academic_passing_gwa, non_academic_passing_gwa, updated_by, updated_at)
  values (p_school, p_academic, p_non_academic, auth.uid(), now())
  on conflict (school_id) do update set academic_passing_gwa = excluded.academic_passing_gwa, non_academic_passing_gwa = excluded.non_academic_passing_gwa, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  -- only the open renewals of the scholars of THIS school whose number changed (Academic / Not set follow the Academic number, Non-academic the other; a custom passing GWA is not touched)
  select array_agg(s.scholar_id_number) into v_rc from public.scholars s left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school and t.custom_passing_gwa is null and coalesce(s.status, '') <> 'Removed'
    and ((coalesce(t.academic_status, 'academic') = 'academic' and v_old.academic_passing_gwa is distinct from p_academic) or (t.academic_status = 'non_academic' and v_old.non_academic_passing_gwa is distinct from p_non_academic));
  v_queued := public._academic_enqueue_recheck(v_rc, 'gwa');
  if v_queued > 0 and v_queued <= 10 then perform public._academic_recheck_process(10); end if;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), v_name || ' passing GWA: Academic ' || coalesce(to_char(p_academic, 'FM990.00'), 'not set') || ', Non-academic ' || coalesce(to_char(p_non_academic, 'FM990.00'), 'not set'));
end;
$$;
revoke all on function public.academic_settings_save(uuid, numeric, numeric) from public, anon;
grant execute on function public.academic_settings_save(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
