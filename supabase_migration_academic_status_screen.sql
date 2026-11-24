-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_status_screen.sql
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 1B: THE SCHOOL SCREEN (a paged list of ONE school's scholars with their academic status) AND WHAT IT NEEDS.   Safe to run twice.   Undo: undo_academic_status_screen.sql
--   * academic_school_scholars: one page (50 at a time) of the scholars of a school, with search, sorting and combinable filters (status, program, year level, scholarship status, custom passing GWA, removed scholars hidden by default);
--     the true total comes with every page. academic_school_facets: the numbers and the program / year / status choices for the filters of that school.
--   * academic_status_impact: BEFORE any change, what it would do (how many change, from what, how many have an open renewal, whether the school's GWA rule is on). academic_status_apply: the change itself, for the scholars
--     chosen on the screen OR for ALL the scholars that match the filters ("select all N matching"), with an optional reason; every change is written to the history; the open renewals are checked again in the background.
--     The status can be Academic, Non-academic or Not set; a scholar can also get (or lose) a custom passing GWA, which must be a number on the school's own scale. A school's scholars can only be changed through that school.
--   * academic_status_history_scholar / academic_status_history_school: who changed what, when, how and why.
--   * academic_status_of_scholars: the status and the passing GWA used for a few scholars (the Information list, its export and the renewal case show it).
--   Only the accounts that may use the tab (the Scholar Management tag) can use all of these except the last one, which any CEDO staff account can read. Adds one index and eight functions. Nothing is deleted.
-- Needs supabase_migration_academic_scholar_status.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_academic_status') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_scholar_status.sql first.';
  end if;
end $$;

create index if not exists scholars_school_idx on public.scholars (school_id);

-- 1. Which scholars of a school: the ones chosen (p_ids) or, when none are given, all that match the filter. A filter is {search, status, programs[], years[], scholarship[], custom, include_removed}.
create or replace function public._academic_filter_ids(p_school uuid, p_filter jsonb, p_ids text[])
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_search text := nullif(btrim(coalesce(f ->> 'search', '')), '');
  v_status text := nullif(f ->> 'status', '');
  v_programs text[]; v_years text[]; v_sch text[]; v_tokens text[];
  v_custom boolean := case when f ? 'custom' and jsonb_typeof(f -> 'custom') = 'boolean' then (f ->> 'custom')::boolean end;
  v_removed boolean := coalesce(case when jsonb_typeof(f -> 'include_removed') = 'boolean' then (f ->> 'include_removed')::boolean end, false);
begin
  if v_status is not null and v_status not in ('academic', 'non_academic', 'not_set') then raise exception 'The status filter is not valid.'; end if;
  if jsonb_typeof(f -> 'programs') = 'array' then v_programs := array(select jsonb_array_elements_text(f -> 'programs')); end if;
  if jsonb_typeof(f -> 'years') = 'array' then v_years := array(select jsonb_array_elements_text(f -> 'years')); end if;
  if jsonb_typeof(f -> 'scholarship') = 'array' then v_sch := array(select jsonb_array_elements_text(f -> 'scholarship')); end if;
  if v_search is not null then v_tokens := regexp_split_to_array(lower(v_search), '\s+'); end if;
  return query
  select s.scholar_id_number
  from public.scholars s
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school
    and (p_ids is not null and s.scholar_id_number = any (p_ids) or p_ids is null
         and (v_removed or coalesce(s.status, '') <> 'Removed')
         and (v_status is null or (v_status = 'not_set' and t.scholar_id_number is null) or t.academic_status = v_status)
         and (v_programs is null or public._program_key(s.course) = any (v_programs))
         and (v_years is null or coalesce(s.year_level, '') = any (v_years))
         and (v_sch is null or coalesce(s.status, '') = any (v_sch))
         and (v_custom is null or (t.custom_passing_gwa is not null) = v_custom)
         and (v_tokens is null or not exists (select 1 from unnest(v_tokens) tk where tk <> '' and position(tk in lower(concat_ws(' ', s.scholar_id_number, s.first_name, s.middle_name, s.last_name))) = 0)));
end;
$$;
revoke all on function public._academic_filter_ids(uuid, jsonb, text[]) from public, anon, authenticated;

-- 2. One page of a school's scholars.
create or replace function public.academic_school_scholars(p_school uuid, p_filter jsonb default '{}'::jsonb, p_sort text default 'name', p_dir text default 'asc', p_limit integer default 50, p_offset integer default 0)
returns table(total bigint, scholar_id_number text, name text, program text, year_level text, scholarship_status text, academic_status text, is_set boolean, custom_passing_gwa numeric, passing_gwa numeric, updated_at timestamptz, updated_by text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dir text := case when lower(coalesce(p_dir, '')) = 'desc' then 'desc' else 'asc' end;
  v_order text;
begin
  perform public._academic_require_manager();
  v_order := case coalesce(p_sort, 'name')
    when 'id' then format('lower(s.scholar_id_number) %s', v_dir)
    when 'program' then format('lower(coalesce(s.course, '''')) %s, lower(coalesce(s.last_name, '''')), lower(coalesce(s.first_name, ''''))', v_dir)
    when 'year' then format('coalesce(s.year_level, '''') %s, lower(coalesce(s.last_name, ''''))', v_dir)
    when 'scholarship' then format('coalesce(s.status, '''') %s, lower(coalesce(s.last_name, ''''))', v_dir)
    when 'status' then format('coalesce(t.academic_status, ''zzz'') %s, lower(coalesce(s.last_name, ''''))', v_dir)
    when 'updated' then format('t.updated_at %s nulls last, lower(coalesce(s.last_name, ''''))', v_dir)
    else format('lower(coalesce(s.last_name, '''')) %1$s, lower(coalesce(s.first_name, '''')) %1$s', v_dir) end;
  return query execute format($q$
    select count(*) over (), s.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), s.course, s.year_level, s.status,
           t.academic_status, t.scholar_id_number is not null, t.custom_passing_gwa,
           coalesce(t.custom_passing_gwa, case coalesce(t.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end),
           t.updated_at, nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
    from public.scholars s
    join (select x as id from public._academic_filter_ids($1, $2, null) x) m on m.id = s.scholar_id_number
    left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
    left join public.academic_school_settings ss on ss.school_id = s.school_id
    left join public.users u on u.id = t.updated_by
    order by %s, s.scholar_id_number
    limit $3 offset $4$q$, v_order) using p_school, p_filter, least(greatest(coalesce(p_limit, 50), 1), 200), greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_school_scholars(uuid, jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.academic_school_scholars(uuid, jsonb, text, text, integer, integer) to authenticated;

-- 3. The numbers and the choices of the filters of one school (Removed scholars are not counted).
create or replace function public.academic_school_facets(p_school uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._academic_require_manager();
  select jsonb_build_object(
    'total', count(*), 'academic', count(*) filter (where t.academic_status = 'academic'), 'non_academic', count(*) filter (where t.academic_status = 'non_academic'),
    'not_set', count(*) filter (where t.scholar_id_number is null), 'custom', count(*) filter (where t.custom_passing_gwa is not null),
    'removed', (select count(*) from public.scholars r where r.school_id = p_school and r.status = 'Removed'),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'program', x.p, 'n', x.n) order by lower(x.p)) from (
        select public._program_key(a.course) k, coalesce(nullif(min(btrim(a.course)), ''), '(no program)') p, count(*) n from public.scholars a where a.school_id = p_school and coalesce(a.status, '') <> 'Removed' group by 1) x), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(jsonb_build_object('value', x.k, 'n', x.n) order by x.k) from (select coalesce(a.year_level, '') k, count(*) n from public.scholars a where a.school_id = p_school and coalesce(a.status, '') <> 'Removed' group by 1) x), '[]'::jsonb),
    'scholarship', coalesce((select jsonb_agg(jsonb_build_object('value', x.k, 'n', x.n) order by x.k) from (select coalesce(a.status, '') k, count(*) n from public.scholars a where a.school_id = p_school and coalesce(a.status, '') <> 'Removed' group by 1) x), '[]'::jsonb))
  into v
  from public.scholars s left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school and coalesce(s.status, '') <> 'Removed';
  return v;
end;
$$;
revoke all on function public.academic_school_facets(uuid) from public, anon;
grant execute on function public.academic_school_facets(uuid) to authenticated;

-- 4. A change must be a valid one: the status, and a custom passing GWA that is a number on the school's own scale.
create or replace function public._academic_check_change(p_school uuid, p_status text, p_custom numeric, p_clear_custom boolean)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare sc record;
begin
  if p_status is null or p_status not in ('academic', 'non_academic', 'not_set') then raise exception 'Choose Academic, Non-academic or Not set.'; end if;
  if p_status = 'not_set' and (p_custom is not null) then raise exception 'A scholar with no status cannot have a custom passing GWA.'; end if;
  if p_custom is not null then
    select * into sc from public._academic_school_scale(p_school);
    if not found then raise exception 'This school has no grading setup yet, so a custom passing GWA cannot be set.'; end if;
    if p_custom < sc.scale_min or p_custom > sc.scale_max then raise exception 'The custom passing GWA must be between % and % (the school''s own scale).', sc.scale_min, sc.scale_max; end if;
  end if;
end;
$$;
revoke all on function public._academic_check_change(uuid, text, numeric, boolean) from public, anon, authenticated;

-- 5. What a change WOULD do (nothing is saved).
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

-- 6. The change: for the chosen scholars (p_ids) or for all that match the filter. p_expected = the number the staff were shown; if it is not the same any more nothing is changed.
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

-- 7. The history of one scholar and of one school (newest first, paged).
create or replace function public.academic_status_history_scholar(p_scholar text)
returns table(at timestamptz, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select h.at, h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label
  from public.academic_status_history h where h.scholar_id_number = p_scholar order by h.at desc, h.id desc limit 200;
end;
$$;
revoke all on function public.academic_status_history_scholar(text) from public, anon;
grant execute on function public.academic_status_history_scholar(text) to authenticated;

create or replace function public.academic_status_history_school(p_school uuid, p_limit integer default 50, p_offset integer default 0)
returns table(total bigint, at timestamptz, scholar_id_number text, name text, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select count(*) over (), h.at, h.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label
  from public.academic_status_history h left join public.scholars s on s.scholar_id_number = h.scholar_id_number
  where h.school_id = p_school order by h.at desc, h.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_status_history_school(uuid, integer, integer) from public, anon;
grant execute on function public.academic_status_history_school(uuid, integer, integer) to authenticated;

-- 8. The status and the passing GWA used for some scholars (the Information list, its export, the renewal case): any CEDO staff account may read it.
create or replace function public.academic_status_of_scholars(p_ids text[])
returns table(scholar_id_number text, academic_status text, is_set boolean, passing_gwa numeric, custom boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_cedo_staff() or public.is_sead_staff()) then raise exception 'Only CEDO staff can read this.'; end if;
  return query
  select s.scholar_id_number, coalesce(t.academic_status, 'academic'), t.scholar_id_number is not null,
         coalesce(t.custom_passing_gwa, case coalesce(t.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end), t.custom_passing_gwa is not null
  from public.scholars s
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  where s.scholar_id_number = any (p_ids[1:1000]);
end;
$$;
revoke all on function public.academic_status_of_scholars(text[]) from public, anon;
grant execute on function public.academic_status_of_scholars(text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
