-- ─────────────────────────────────────────────────────────────
-- SCHOOL PORTAL: NON-NUMERIC MARKS (F, D/F, W, ...) WITH WHAT THEY STAND FOR.   Safe to run twice.   Undo: undo_school_non_numeric_marks.sql
--
-- Until now a school could enter a number on its scale, INC, DRP, or a letter from its letter table. This lets a school add its OWN non-numeric marks
-- (for example F or D/F), say what each one stands for, and say what it means for renewal:
--   • Passed            - counts as passed
--   • Failed            - counts as a failed subject
--   • Incomplete        - treated like INC (tracked separately, deadline, temporary probation)
--   • Needs review      - the renewal evaluator looks at it
-- INC and DRP stay built in for every school (INC = incomplete, DRP = dropped, counts as failed) and cannot be redefined.
-- A mark is NOT a number, so it never enters the GWA (the subject is simply left out of the average).
-- Creates ONE new table and replaces four small functions. No existing table is altered. Nothing existing is deleted.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.school_marks (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  mark       text not null check (btrim(mark) <> '' and char_length(mark) <= 12),
  meaning    text not null check (btrim(meaning) <> '' and char_length(meaning) <= 120),
  outcome    text not null check (outcome in ('passed', 'failed', 'incomplete', 'review')),
  created_at timestamptz not null default now()
);
create unique index if not exists school_marks_school_mark_key on public.school_marks (school_id, lower(btrim(mark)));

alter table public.school_marks enable row level security;
drop policy if exists "school manages own marks" on public.school_marks;
create policy "school manages own marks" on public.school_marks for all to authenticated
  using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()));
drop policy if exists "staff read school marks" on public.school_marks;
create policy "staff read school marks" on public.school_marks for select to authenticated
  using ((select public.is_scholars_grades_monitoring_staff()) or (select public.is_sead_staff()) or (select public.can_view_renewals()));

-- The school saves its whole list at once (same pattern as the letter table).
create or replace function public.set_school_marks(p_marks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_row jsonb;
  v_mark text; v_meaning text; v_outcome text;
  v_seen text[] := '{}';
begin
  if v_school is null then raise exception 'Not authorized: no school account found.'; end if;
  if jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then raise exception 'The list of marks is not valid.'; end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    v_mark := btrim(coalesce(v_row ->> 'mark', ''));
    v_meaning := btrim(coalesce(v_row ->> 'meaning', ''));
    v_outcome := coalesce(v_row ->> 'outcome', '');
    if v_mark = '' then raise exception 'Every mark needs the mark itself (for example F).'; end if;
    if char_length(v_mark) > 12 then raise exception 'The mark "%" is too long (12 characters at most).', v_mark; end if;
    if v_mark ~ '^\d+([.,]\d+)?$' then raise exception 'The mark "%" is a number. Numbers are graded on your scale, not added here.', v_mark; end if;
    if upper(v_mark) in ('INC', 'DRP') then raise exception 'INC and DRP are built in for every school and cannot be changed.'; end if;
    if v_meaning = '' then raise exception 'Say what "%" stands for.', v_mark; end if;
    if char_length(v_meaning) > 120 then raise exception 'What "%" stands for is too long (120 characters at most).', v_mark; end if;
    if v_outcome not in ('passed', 'failed', 'incomplete', 'review') then raise exception 'Choose what "%" means for renewal.', v_mark; end if;
    if lower(v_mark) = any (v_seen) then raise exception 'The mark "%" is listed twice.', v_mark; end if;
    v_seen := v_seen || lower(v_mark);
  end loop;

  delete from public.school_marks where school_id = v_school;
  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    insert into public.school_marks (school_id, mark, meaning, outcome)
    values (v_school, btrim(v_row ->> 'mark'), btrim(v_row ->> 'meaning'), v_row ->> 'outcome');
  end loop;
end;
$$;
revoke all on function public.set_school_marks(jsonb) from public, anon;
grant execute on function public.set_school_marks(jsonb) to authenticated;

-- A scholar reads the marks of their own school; CEDO staff read the marks of one scholar's school (same pattern as the letter table).
create or replace function public.get_scholar_school_marks()
returns table(mark text, meaning text, outcome text)
language sql stable security definer set search_path = public as $$
  select m.mark, m.meaning, m.outcome
  from public.school_marks m join public.scholars s on s.school_id = m.school_id
  where s.id = auth.uid()
  order by m.mark;
$$;
revoke all on function public.get_scholar_school_marks() from public, anon;
grant execute on function public.get_scholar_school_marks() to authenticated;

create or replace function public.get_scholar_school_marks_for_staff(p_scholar_id_number text)
returns table(mark text, meaning text, outcome text)
language sql stable security definer set search_path = public as $$
  select m.mark, m.meaning, m.outcome
  from public.school_marks m join public.scholars s on s.school_id = m.school_id
  where s.scholar_id_number = p_scholar_id_number
    and (public.is_scholars_grades_monitoring_staff() or public.is_sead_staff() or public.can_view_renewals())
  order by m.mark;
$$;
revoke all on function public.get_scholar_school_marks_for_staff(text) from public, anon;
grant execute on function public.get_scholar_school_marks_for_staff(text) to authenticated;

-- What the database accepts: the school's own marks are now accepted as well (INC and DRP stay accepted for everyone).
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
  -- The school's own non-numeric marks.
  if exists (select 1 from public.school_marks m where m.school_id = p_school_id and lower(btrim(m.mark)) = lower(v_grade)) then return null; end if;
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
    case when v_cfg.uses_letter_grades then ' or in your letter-grade table, or in your list of other marks' else ' or in your list of other marks' end);
end;
$$;

-- What a grade means for renewal. Order: reserved marks (INC, DRP), then the school's own marks, then the passing mark.
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
  v_mark_outcome text;
begin
  if v_grade is null then return 'ungraded'; end if;
  if upper(v_grade) = 'INC' then return 'inc'; end if;
  if upper(v_grade) = 'DRP' then return 'drp'; end if;

  select m.outcome into v_mark_outcome from public.school_marks m where m.school_id = p_school_id and lower(btrim(m.mark)) = lower(v_grade) limit 1;
  if v_mark_outcome is not null then
    return case v_mark_outcome when 'passed' then 'passed' when 'failed' then 'failed' when 'incomplete' then 'inc' else 'review' end;
  end if;

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
revoke all on function public._grade_outcome(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
