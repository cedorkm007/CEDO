-- undo_academic_recheck_targeted.sql: every change raises one number again that makes all open renewals wait for a check, 60 every 5 minutes (as before Phase 2).
-- Puts back the four earlier functions and removes the six new ones. Renewals still waiting in the list are checked first (nothing is lost); the table and its rows stay (nothing is deleted).
-- (Run this ONLY together with putting the previous website version back.)
begin;

do $$ begin
  if to_regprocedure('public._academic_recheck_process(integer)') is not null then
    perform public._academic_recheck_process(100000);
  end if;
end $$;

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
    'open_renewals', (select count(*) from chg c where exists (select 1 from public.renewal_records r where r.scholar_id_number = c.id and r.stage not in ('renewed', 'removed', 'late_declined', 'not_required', 'reconsidered', 'division_head_approved'))))
  into v;
  return v || jsonb_build_object('rule_on', ss.academic_passing_gwa is not null, 'academic_passing_gwa', ss.academic_passing_gwa, 'non_academic_passing_gwa', ss.non_academic_passing_gwa);
end;
$$;
revoke all on function public.academic_status_impact(uuid, jsonb, text[], text, numeric, boolean) from public, anon;
grant execute on function public.academic_status_impact(uuid, jsonb, text[], text, numeric, boolean) to authenticated;

create or replace function public.academic_status_apply(p_school uuid, p_filter jsonb, p_ids text[], p_status text, p_custom numeric default null, p_clear_custom boolean default false, p_reason text default null, p_expected integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := case when p_status = 'not_set' then null else p_status end;
  v_ids text[]; v_changed integer; v_total integer;
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
  select count(*) into v_changed from chg;
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
    update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- the open renewals are checked again in the background
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Academic status of ' || v_changed || ' scholar(s) set to ' || coalesce(p_status, '') || ' (' || v_how || ').');
  end if;
  return jsonb_build_object('changed', v_changed, 'same', v_total - v_changed, 'total', v_total);
end;
$$;
revoke all on function public.academic_status_apply(uuid, jsonb, text[], text, numeric, boolean, text, integer) from public, anon;
grant execute on function public.academic_status_apply(uuid, jsonb, text[], text, numeric, boolean, text, integer) to authenticated;

create or replace function public.academic_bulk_save(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb; e jsonb;
  v_set integer := 0; v_skipped integer := 0; v_errors integer := 0;
  v_old text; v_old_gwa numeric; v_school uuid;
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
      v_set := v_set + 1;
    elsif e ->> 'state' = 'error' then v_errors := v_errors + 1;
    else v_skipped := v_skipped + 1; end if;
  end loop;
  if v_set > 0 then
    update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- the open renewals are checked again in the background
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Bulk upload of scholars'' academic status: ' || v_set || ' set.');
  end if;
  return jsonb_build_object('set', v_set, 'reset', 0, 'skipped', v_skipped, 'errors', v_errors,
    'results', (select coalesce(jsonb_agg(jsonb_build_object('i', (x.value ->> 'i')::integer, 'outcome', case when x.value ->> 'action' = 'set' then 'set' when x.value ->> 'state' = 'error' then 'error' else 'skipped' end,
      'message', x.value -> 'messages' ->> 0)), '[]'::jsonb) from jsonb_array_elements(v) x));
end;
$$;
revoke all on function public.academic_bulk_save(jsonb) from public, anon;
grant execute on function public.academic_bulk_save(jsonb) to authenticated;

create or replace function public.academic_settings_save(p_school uuid, p_academic numeric, p_non_academic numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  perform public._academic_require_manager();
  select name into v_name from public.schools where id = p_school;
  if v_name is null then raise exception 'Choose a school.'; end if;
  perform public._academic_check_gwa(p_school, p_academic);
  perform public._academic_check_gwa(p_school, p_non_academic);
  insert into public.academic_school_settings (school_id, academic_passing_gwa, non_academic_passing_gwa, updated_by, updated_at)
  values (p_school, p_academic, p_non_academic, auth.uid(), now())
  on conflict (school_id) do update set academic_passing_gwa = excluded.academic_passing_gwa, non_academic_passing_gwa = excluded.non_academic_passing_gwa, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  update public.academic_gwa_settings set version = version + 1, updated_by = auth.uid(), updated_at = now() where id;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), v_name || ' passing GWA: Academic ' || coalesce(to_char(p_academic, 'FM990.00'), 'not set') || ', Non-academic ' || coalesce(to_char(p_non_academic, 'FM990.00'), 'not set'));
end;
$$;
revoke all on function public.academic_settings_save(uuid, numeric, numeric) from public, anon;
grant execute on function public.academic_settings_save(uuid, numeric, numeric) to authenticated;

create or replace function public._academic_recheck_batch(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v integer := (select g.version from public.academic_gwa_settings g where g.id);
  n integer := 0;
begin
  for r in select x.id from public.renewal_records x where public._renewal_is_active_stage(x.stage) and coalesce(x.evaluation ->> 'academic_version', '') <> v::text order by x.updated_at limit greatest(1, p_limit) loop
    perform public._renewal_recheck(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._academic_recheck_batch(integer) from public, anon, authenticated;

drop function if exists public.academic_recheck_status();
drop function if exists public.academic_recheck_step(integer);
drop function if exists public._academic_recheck_process(integer);
drop function if exists public._academic_enqueue_recheck(text[], text);
drop function if exists public._academic_passing_of(uuid, text, numeric);
update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- every open renewal is checked again by the old job
notify pgrst, 'reload schema';
commit;
