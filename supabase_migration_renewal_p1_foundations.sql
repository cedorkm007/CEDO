-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p1_foundations.sql
--
-- Scholar Renewal System — PHASE 1 (foundations). Run AFTER supabase_migration_standing_cleanup_logins.sql.
-- Additive and safe to re-run: nothing is deleted or overwritten.
--
--   1. PASSING MARK per school (school_grading_configs.passing_mark, on the school's own scale) saved from the Grading System
--      tab. A grade worse than the passing mark = failed. Empty until the school sets it.
--   2. INC and DRP are reserved marks every school may enter (_school_grade_error). DRP counts as FAILED; INC is tracked
--      separately (never failed by itself). "Exclude from GWA" subjects still count for pass/fail.
--   3. _grade_outcome(school, grade) — the ONE place the database decides: ungraded / passed / failed / inc / drp /
--      review (a mark that cannot be read) / no_passing_mark. Later phases' renewal rules call it; the website's highlighting
--      (src/lib/subjectOutcome.ts) is tested to give the same answers.
--   4. REMARKS / TAGS on a subject (the remarks column already existed; schools can now write it, on screen and in the CSV).
--   5. SDP COMPLIED / NOT COMPLIED per scholar per semester (scholars_sdp_compliance) with the reason, using the existing
--      per-period credit totals including carried-over credit. Not checked for Summer.
--   6. SCHOLAR STATUS HISTORY: every status change from now on is recorded (who, when, term, source, temporary yes/no) by a
--      trigger, so it does not matter which screen changes a status. Existing history is added by the separate, reviewed
--      backfill script (renewal_status_history_backfill_*.sql) — nothing is backfilled here.
-- ─────────────────────────────────────────────────────────────

alter table public.school_grading_configs add column if not exists passing_mark numeric;

-- ── 1. Passing mark ─────────────────────────────────────────
drop function if exists public.upsert_school_grading_config(numeric, numeric, text, boolean, numeric);
create or replace function public.upsert_school_grading_config(
  p_scale_min numeric,
  p_scale_max numeric,
  p_direction text,
  p_uses_letter_grades boolean,
  p_retention_threshold numeric default null,
  p_passing_mark numeric default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;
  if p_direction not in ('lower_is_better', 'higher_is_better') then
    raise exception 'Invalid direction: %', p_direction;
  end if;
  if p_scale_max <= p_scale_min then
    raise exception 'The scale maximum must be higher than the minimum.';
  end if;
  if p_retention_threshold is not null and (p_retention_threshold < p_scale_min or p_retention_threshold > p_scale_max) then
    raise exception 'The retention requirement must be on your grading scale (% to %).', p_scale_min::float8, p_scale_max::float8;
  end if;

  if p_passing_mark is not null and (p_passing_mark < p_scale_min or p_passing_mark > p_scale_max) then
    raise exception 'The passing mark must be on your grading scale (% to %).', p_scale_min::float8, p_scale_max::float8;
  end if;

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold, passing_mark, updated_at)
  values (v_school_id, p_scale_min, p_scale_max, p_direction, p_uses_letter_grades, p_retention_threshold, p_passing_mark, now())
  on conflict (school_id) do update
    set scale_min = excluded.scale_min,
        scale_max = excluded.scale_max,
        direction = excluded.direction,
        uses_letter_grades = excluded.uses_letter_grades,
        retention_threshold = excluded.retention_threshold,
        passing_mark = excluded.passing_mark,
        updated_at = now();
end;
$$;
grant execute on function public.upsert_school_grading_config(numeric, numeric, text, boolean, numeric, numeric) to authenticated;

-- ── 2. INC / DRP accepted by every school ──────────────────
create or replace function public._school_grade_error(p_school_id uuid, p_grade text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_cfg public.school_grading_configs%rowtype;
  v_min text; v_max text;
begin
  if v_grade is null then return null; end if;

  select * into v_cfg from public.school_grading_configs where school_id = p_school_id;
  if not found then
    return 'Set up your grading scale in the Grading System tab before entering grades.';
  end if;
  -- INC (incomplete) and DRP (dropped) are reserved marks every school may enter, whatever its scale or letter table.
  if upper(v_grade) in ('INC', 'DRP') then return null; end if;
  v_min := v_cfg.scale_min::float8::text;
  v_max := v_cfg.scale_max::float8::text;

  if v_grade ~ '^\d+(\.\d+)?$' then
    if v_grade::numeric between v_cfg.scale_min and v_cfg.scale_max then return null; end if;
    return format('Grade %s is outside your grading scale (%s to %s).', v_grade, v_min, v_max);
  end if;

  if v_cfg.uses_letter_grades and exists (
    select 1 from public.school_letter_grades l
    where l.school_id = p_school_id and lower(btrim(l.letter)) = lower(v_grade)
  ) then
    return null;
  end if;

  return format('Grade "%s" is not on your grading scale (%s to %s)%s.', v_grade, v_min, v_max,
    case when v_cfg.uses_letter_grades then ' or in your letter-grade table' else '' end);
end;
$$;

-- ── 3. Subject remarks / tags ───────────────────────────────
drop function if exists public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean);
create or replace function public.upsert_scholar_subject_grade(
  p_id uuid,
  p_scholar_id_number text,
  p_school_year text,
  p_semester text,
  p_subject_code text,
  p_subject text,
  p_grade text,
  p_units numeric default null,
  p_exclude_from_gwa boolean default null,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_row_id uuid;
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;
  if not exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id) then
    raise exception 'That scholar does not belong to your school.';
  end if;
  if p_units is not null and p_units <= 0 then
    raise exception 'Units must be a positive number.';
  end if;

  if p_id is not null then
    update public.scholar_subjects_grades
    set subject_code = p_subject_code, subject = p_subject, grade = nullif(trim(p_grade), ''),
        units = coalesce(p_units, units),
        exclude_from_gwa = coalesce(p_exclude_from_gwa, exclude_from_gwa),
        remarks = case when p_remarks is null then remarks else left(btrim(p_remarks), 200) end,
        updated_at = now()
    where id = p_id and scholar_id_number = p_scholar_id_number
      and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id)
    returning id into v_row_id;
    if v_row_id is null then
      raise exception 'Grade row not found or not editable by your school.';
    end if;
  else
    insert into public.scholar_subjects_grades
      (scholar_id_number, school_year, semester, subject_code, subject, grade, units, exclude_from_gwa, remarks, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, nullif(trim(p_grade), ''), p_units, coalesce(p_exclude_from_gwa, false), left(btrim(coalesce(p_remarks, '')), 200), v_school_id)
    returning id into v_row_id;
  end if;
  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean, text) to authenticated;

create or replace function public.bulk_upsert_scholar_subject_grades(p_rows jsonb)
returns table(row_index int, ok boolean, error text, id uuid)
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_index int := 0;
  v_id uuid;
begin
  perform set_config('app.grade_source', 'csv', true);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_id := public.upsert_scholar_subject_grade(
        case when v_row->>'id' is null or v_row->>'id' = '' then null else (v_row->>'id')::uuid end,
        v_row->>'scholarIdNumber',
        v_row->>'schoolYear',
        v_row->>'semester',
        coalesce(v_row->>'subjectCode', ''),
        v_row->>'subject',
        v_row->>'grade',
        case when v_row->>'units' is null or v_row->>'units' = '' then null else (v_row->>'units')::numeric end,
        case when v_row->>'excludeFromGwa' is null or v_row->>'excludeFromGwa' = '' then null else (v_row->>'excludeFromGwa')::boolean end,
        -- remarks: only touched when the upload carries them (an absent key keeps what is stored)
        case when v_row ? 'remarks' then coalesce(v_row->>'remarks', '') else null end
      );
      row_index := v_index; ok := true; error := null; id := v_id;
    exception when others then
      row_index := v_index; ok := false; error := sqlerrm; id := null;
    end;
    v_index := v_index + 1;
    return next;
  end loop;
end;
$$;
grant execute on function public.bulk_upsert_scholar_subject_grades(jsonb) to authenticated;

-- ── 4. The grading-config reads (scholar's own / staff) also return the passing mark ──
drop function if exists public.get_scholar_grading_config();
drop function if exists public.get_scholar_grading_config_for_staff(text);
create or replace function public.get_scholar_grading_config()
returns table(scale_min numeric, scale_max numeric, direction text, uses_letter_grades boolean, passing_mark numeric)
language sql stable security definer as $$
  select c.scale_min, c.scale_max, c.direction, c.uses_letter_grades, c.passing_mark
  from public.school_grading_configs c
  join public.scholars s on s.school_id = c.school_id
  where s.id = auth.uid();
$$;
grant execute on function public.get_scholar_grading_config() to authenticated;

create or replace function public.get_scholar_grading_config_for_staff(p_scholar_id_number text)
returns table(scale_min numeric, scale_max numeric, direction text, uses_letter_grades boolean, passing_mark numeric)
language sql stable security definer as $$
  select c.scale_min, c.scale_max, c.direction, c.uses_letter_grades, c.passing_mark
  from public.school_grading_configs c
  join public.scholars s on s.school_id = c.school_id
  where s.scholar_id_number = p_scholar_id_number
    and public.is_scholars_grades_monitoring_staff();
$$;
grant execute on function public.get_scholar_grading_config_for_staff(text) to authenticated;

-- ── 5. _grade_outcome: the single rule for pass / fail / INC / DRP ──
-- Order matters: reserved marks first (so an INC row in a school's own letter table is still INC), then the passing mark.
-- A passing grade EQUAL to the passing mark passes. lower_is_better: failed when the grade is higher than the mark;
-- higher_is_better: failed when it is lower. Exclude-from-GWA is deliberately ignored here: those subjects still count.
create or replace function public._grade_outcome(p_school_id uuid, p_grade text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_cfg public.school_grading_configs%rowtype;
  v_value numeric;
begin
  if v_grade is null then return 'ungraded'; end if;
  if upper(v_grade) = 'INC' then return 'inc'; end if;
  if upper(v_grade) = 'DRP' then return 'drp'; end if;

  select * into v_cfg from public.school_grading_configs where school_id = p_school_id;
  if not found or v_cfg.passing_mark is null then return 'no_passing_mark'; end if;

  if v_grade ~ '^\d+(\.\d+)?$' then
    v_value := v_grade::numeric;
  elsif v_cfg.uses_letter_grades then
    select l.numeric_value into v_value from public.school_letter_grades l
    where l.school_id = p_school_id and lower(btrim(l.letter)) = lower(v_grade)
    limit 1;
  end if;
  if v_value is null then return 'review'; end if;

  if v_cfg.direction = 'lower_is_better' then
    return case when v_value > v_cfg.passing_mark then 'failed' else 'passed' end;
  end if;
  return case when v_value < v_cfg.passing_mark then 'failed' else 'passed' end;
end;
$$;
-- Internal: called by other security-definer functions, never directly by a website visitor.
revoke all on function public._grade_outcome(uuid, text) from public, anon, authenticated;

-- ── 6. SDP Complied / Not complied ──────────────────────────
-- Complied = every one of the three categories has at least sdp_category_credit_required() (3) credits in the semester,
-- counting credit carried over from earlier semesters (_sdp_period_totals). Summer has no SDP requirement.
create or replace function public._sdp_compliance(p_school_year text, p_semester text, p_scholar_id_number text default null)
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language sql
stable
security definer
set search_path = public
as $$
  with req as (select public.sdp_category_credit_required() as n, not (coalesce(p_semester, '') ilike 'summer%') as applicable),
  totals as (
    select t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service')::integer as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism')::integer as cv,
      sum(t.total) filter (where t.category = 'formation_program')::integer as fp
    from public._sdp_period_totals(p_school_year, p_semester, p_scholar_id_number) t
    group by t.scholar_id_number
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed' and (p_scholar_id_number is null or s.scholar_id_number = p_scholar_id_number)
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then (b.cs >= r.n and b.cv >= r.n and b.fp >= r.n) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n then 'Institutional Volunteerism: ' || b.cs || ' of ' || r.n end,
           case when b.cv < r.n then 'Community Volunteerism: ' || b.cv || ' of ' || r.n end,
           case when b.fp < r.n then 'Formation Program: ' || b.fp || ' of ' || r.n end), '') end
  from base b cross join req r;
$$;
revoke all on function public._sdp_compliance(text, text, text) from public, anon, authenticated;

create or replace function public.scholars_sdp_compliance(p_school_year text, p_semester text)
returns table(
  scholar_id_number text, name text,
  community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  return query
  select c.scholar_id_number, s.first_name || ' ' || s.last_name,
         c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
  from public._sdp_compliance(p_school_year, p_semester) c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  order by s.last_name, s.first_name;
end;
$$;
revoke all on function public.scholars_sdp_compliance(text, text) from public, anon;
grant execute on function public.scholars_sdp_compliance(text, text) to authenticated;

-- ── 7. Scholar status history ───────────────────────────────
create table if not exists public.scholar_status_history (
  id                uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  status            text not null,
  previous_status   text,
  -- True for the temporary probation a scholar is placed on while an INC is open. It does NOT count as "previous probation".
  is_temporary      boolean not null default false,
  school_year       text,
  term              text,
  changed_by        uuid references public.users(id) on delete set null,
  changed_at        timestamptz not null default now(),
  -- manual | bulk | referral | removal | renewal | system | baseline | counseling_record  (the later phases set app.status_source)
  source            text not null default 'manual',
  note              text not null default ''
);
create index if not exists scholar_status_history_scholar_idx on public.scholar_status_history (scholar_id_number, changed_at desc);
alter table public.scholar_status_history enable row level security;
drop policy if exists "staff read status history" on public.scholar_status_history;
create policy "staff read status history" on public.scholar_status_history for select
  using (public.is_sead_staff() or public.has_staff_tag('scholar_counseling') or public.has_staff_tag('scholar_management'));
-- No insert / update / delete policy: only the trigger below (and the reviewed backfill script, run by an administrator) writes here.

create or replace function public.scholar_status_history_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text;
  v_term text;
  v_source text;
  v_temp boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select gps.current_school_year, gps.current_semester into v_year, v_term from public.grading_period_settings gps where gps.id = true;
  v_source := coalesce(nullif(current_setting('app.status_source', true), ''), case when auth.uid() is null then 'system' else 'manual' end);
  v_temp := coalesce(nullif(current_setting('app.status_temporary', true), ''), 'false')::boolean;
  insert into public.scholar_status_history (scholar_id_number, status, previous_status, is_temporary, school_year, term, changed_by, source, note)
  values (
    new.scholar_id_number, new.status, case when tg_op = 'UPDATE' then old.status end, v_temp, v_year, v_term,
    (select u.id from public.users u where u.id = auth.uid()), v_source, coalesce(current_setting('app.status_note', true), '')
  );
  return null;
end;
$$;
drop trigger if exists scholar_status_history_trg on public.scholars;
create trigger scholar_status_history_trg after insert or update of status on public.scholars
  for each row execute function public.scholar_status_history_trg();

create or replace function public.scholar_status_history_for(p_scholar_id_number text)
returns table(id uuid, status text, previous_status text, is_temporary boolean, school_year text, term text, changed_by_name text, changed_at timestamptz, source text, note text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_sead_staff() or public.has_staff_tag('scholar_counseling') or public.has_staff_tag('scholar_management')) then
    raise exception 'Not authorized to view status history.';
  end if;
  return query
  select h.id, h.status, h.previous_status, h.is_temporary, h.school_year, h.term,
         nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), h.changed_at, h.source, h.note
  from public.scholar_status_history h
  left join public.users u on u.id = h.changed_by
  where h.scholar_id_number = p_scholar_id_number
  order by h.changed_at desc, h.id;
end;
$$;
revoke all on function public.scholar_status_history_for(text) from public, anon;
grant execute on function public.scholar_status_history_for(text) to authenticated;

-- "Previous probation" = the scholar was on REGULAR (not temporary) Probationary status at any time in the history.
-- Used by the renewal rules in the next phase. Internal.
create or replace function public.scholar_had_regular_probation(p_scholar_id_number text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.scholar_status_history h
    where h.scholar_id_number = p_scholar_id_number and h.status = 'Probationary' and not h.is_temporary
  );
$$;
revoke all on function public.scholar_had_regular_probation(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select
  (select count(*) from public.school_grading_configs) as school_setups,
  (select count(*) from public.school_grading_configs where passing_mark is not null) as schools_with_a_passing_mark,
  (select count(*) from public.scholar_status_history) as status_history_rows_so_far;
