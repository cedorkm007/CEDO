-- ─────────────────────────────────────────────────────────────
-- SCHOOL GRADING RULES, FILE C of 2 (Phase 1): the functions to check, save and read a school's grading rules.   Safe to run twice.   Undo: undo_school_grading_rules_c.sql
-- Run AFTER supabase_migration_school_grading_rules_a_tables.sql.
--
--   * school_grading_rules_save(): a school saves a new VERSION of its rules (the conversion table, the passing mark and the programs that have their own, how grades are entered, and the
--     GWA settings). The database checks every rule again (the same rules, in the same order, as the screen), works out where the version starts (the current period, or the next one when the
--     current period is submitted or not open, so a locked period can never change), writes the audit row, and refuses a save that changes nothing.
--   * school_grading_rules_overview() / school_grading_rules_version(): the school reads its own rules, the versions and the audit trail.
--   * staff_school_grading_rules() / staff_school_grading_rules_version(): CEDO staff (Scholars' Grades Monitoring, SEAD, renewal staff) read ANY school's rules, read-only.
-- Nothing is changed or deleted: this file adds functions only, and the three new tables of file A are the only thing they write to. The school's existing scale, letters, marks, grades and
-- passing mark are read, never changed. Nothing in the website uses these rules for grades or renewal yet (that is Phase 2).
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regclass('public.school_grading_versions') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_school_grading_rules_a_tables.sql first.';
  end if;
end $$;

-- 1. Periods: the order of periods, and the one after a given one (1st, 2nd, Summer, then the 1st of the next school year).
create or replace function public._grading_period_rank(p_year text, p_term text)
returns integer
language sql
immutable
as $$
  select coalesce(nullif(split_part(p_year, '-', 1), '')::integer, 0) * 10 + case p_term when '1st Semester' then 1 when '2nd Semester' then 2 when 'Summer' then 3 else 0 end;
$$;
revoke all on function public._grading_period_rank(text, text) from public, anon, authenticated;

create or replace function public._grading_next_period(p_year text, p_term text)
returns table(school_year text, term text)
language sql
immutable
as $$
  select case when p_term = 'Summer' then (split_part(p_year, '-', 1)::integer + 1)::text || '-' || (split_part(p_year, '-', 2)::integer + 1)::text else p_year end,
         case p_term when '1st Semester' then '2nd Semester' when '2nd Semester' then 'Summer' else '1st Semester' end;
$$;
revoke all on function public._grading_next_period(text, text) from public, anon, authenticated;

-- 2. What an equivalent grade stands for on the school's scale: {"value": n, "problem": null}, or a problem (off_scale | letter_no_number).
create or replace function public._grading_equivalent_value(p_grade text, p_min numeric, p_max numeric, p_letters jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  g text := btrim(coalesce(p_grade, ''));
  v numeric;
  l jsonb;
begin
  if g ~ '^\d+(\.\d+)?$' then
    v := g::numeric;
    if v >= p_min and v <= p_max then return jsonb_build_object('value', v, 'problem', null); end if;
    return jsonb_build_object('value', null, 'problem', 'off_scale');
  end if;
  select e into l from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb)) e where lower(btrim(e ->> 'letter')) = lower(g) limit 1;
  if l is null then return jsonb_build_object('value', null, 'problem', 'off_scale'); end if;
  if l ->> 'numericValue' is null then return jsonb_build_object('value', null, 'problem', 'letter_no_number'); end if;
  return jsonb_build_object('value', (l ->> 'numericValue')::numeric, 'problem', null);
end;
$$;
revoke all on function public._grading_equivalent_value(text, numeric, numeric, jsonb) from public, anon, authenticated;

-- 3. The checks. Returns the FIRST problem (code + message) or no row. The same checks, in the same order, as validateRules() in src/lib/gradingRules.ts; tests/school-grading-rules runs the
--    same cases against both, so the screen and the database always agree.
create or replace function public._grading_rules_check(p_rules jsonb, p_scale_min numeric, p_scale_max numeric, p_direction text, p_letters jsonb, p_marks text[])
returns table(code text, message text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_mode text := p_rules ->> 'entryMode';
  v_bands jsonb := coalesce(p_rules -> 'bands', '[]'::jsonb);
  v_prog jsonb := coalesce(p_rules -> 'programPassing', '[]'::jsonb);
  v_gwa jsonb := coalesce(p_rules -> 'gwa', '{}'::jsonb);
  n integer; k integer; row_no integer; j integer;
  el jsonb;
  ft text; tt text; f numeric; t numeric;
  a_from numeric[]; a_to numeric[]; a_grade text[]; a_rem text[]; vals numeric[] := '{}';
  ev jsonb; wrong boolean;
  p numeric; pt text; thr numeric[]; who text[]; ti integer; vmap jsonb; passed boolean; key text;
  has_pass boolean; has_fail boolean;
  known text[] := array['inc', 'drp'] || coalesce(p_marks, '{}'::text[]);
  lo numeric; hi numeric; seen text[] := '{}'; nm text; pp numeric; sk text; sv jsonb; cd text;
  fmt text := 'FM990.00';
begin
  if jsonb_typeof(v_bands) <> 'array' or jsonb_typeof(v_prog) <> 'array' then return query select 'band_range'::text, 'The rules are not valid.'::text; return; end if;
  if v_mode is null or v_mode not in ('grade', 'percentage', 'either') then return query select 'entry_mode'::text, 'Choose how grades are entered.'::text; return; end if;
  n := jsonb_array_length(v_bands);
  if n > 40 then return query select 'too_many_rows'::text, 'A conversion table can have at most 40 rows.'::text; return; end if;

  if n = 0 then
    if v_mode <> 'grade' then return query select 'needs_table'::text, 'Entering percentages needs a conversion table.'::text; return; end if;
    if jsonb_array_length(v_prog) > 0 then return query select 'needs_table_program'::text, 'A program''s own passing mark needs a conversion table.'::text; return; end if;
  else
    -- every row has a valid percentage range (in the order given)
    for k in 0 .. n - 1 loop
      el := v_bands -> k; ft := el ->> 'from'; tt := el ->> 'to';
      if ft is null or tt is null or ft !~ '^\d+(\.\d{1,2})?$' or tt !~ '^\d+(\.\d{1,2})?$' or ft::numeric > 100 or tt::numeric > 100 then
        return query select 'band_range'::text, format('Row %s: both percentages must be numbers from 0 to 100 with at most 2 decimals.', k + 1); return;
      end if;
      if ft::numeric > tt::numeric then return query select 'band_range'::text, format('Row %s: From must not be higher than To.', k + 1); return; end if;
    end loop;

    select array_agg((e ->> 'from')::numeric order by (e ->> 'from')::numeric, (e ->> 'to')::numeric),
           array_agg((e ->> 'to')::numeric order by (e ->> 'from')::numeric, (e ->> 'to')::numeric),
           array_agg(btrim(coalesce(e ->> 'equivalentGrade', '')) order by (e ->> 'from')::numeric, (e ->> 'to')::numeric),
           array_agg(btrim(coalesce(e ->> 'remarks', '')) order by (e ->> 'from')::numeric, (e ->> 'to')::numeric)
      into a_from, a_to, a_grade, a_rem
    from jsonb_array_elements(v_bands) e;
    -- (ascending position k is row n - k + 1 from the top)

    for k in 2 .. n loop
      if a_from[k] <= a_to[k - 1] + 0.000000001 then
        return query select 'overlap'::text, format('Rows %s and %s overlap.', n - k + 1, n - k + 2); return;
      elsif a_from[k] - a_to[k - 1] > 0.01 + 0.000000001 then
        return query select 'gap'::text, format('There is a gap between row %s and row %s: %s to %s has no row.', n - k + 1, n - k + 2, to_char(a_to[k - 1] + 0.01, fmt), to_char(a_from[k] - 0.01, fmt)); return;
      end if;
    end loop;
    if a_from[1] > 0.000000001 then return query select 'starts_at_zero'::text, 'The lowest row must start at 0.00 so that every percentage has a row.'::text; return; end if;
    if a_to[n] < 100 - 0.000000001 then return query select 'ends_at_hundred'::text, 'The highest row must end at 100.00 so that every percentage has a row.'::text; return; end if;

    -- each row, from the top: remarks, equivalent grade on the scale
    for row_no in 1 .. n loop
      k := n - row_no + 1;
      if a_rem[k] = '' then return query select 'remarks_empty'::text, format('Row %s: the remarks cannot be empty.', row_no); return; end if;
      if a_grade[k] = '' then return query select 'equivalent_empty'::text, format('Row %s: enter the equivalent grade.', row_no); return; end if;
      ev := public._grading_equivalent_value(a_grade[k], p_scale_min, p_scale_max, p_letters);
      if ev ->> 'problem' = 'letter_no_number' then return query select 'letter_no_number'::text, format('Row %s: the letter "%s" has no number in your letter table.', row_no, a_grade[k]); return; end if;
      if ev ->> 'problem' = 'off_scale' then return query select 'equivalent_off_scale'::text, format('Row %s: "%s" is not on your grading scale or in your letter table.', row_no, a_grade[k]); return; end if;
      vals[k] := (ev ->> 'value')::numeric;
    end loop;

    -- the grade must not get worse as the percentage goes up
    for k in 2 .. n loop
      wrong := case when p_direction = 'lower_is_better' then vals[k] > vals[k - 1] else vals[k] < vals[k - 1] end;
      if wrong then return query select 'direction'::text, format('Row %s has a worse grade than row %s although its percentage is higher.', n - k + 1, n - k + 2); return; end if;
    end loop;

    -- the passing mark, and the programs that have their own
    pt := p_rules ->> 'passingMarkPct';
    if pt is null then return query select 'passing_missing'::text, 'Enter the passing mark (a percentage).'::text; return; end if;
    if pt !~ '^\d+(\.\d{1,2})?$' or pt::numeric <= 0 or pt::numeric > 100 then return query select 'passing_range'::text, 'The passing mark must be a percentage above 0 and up to 100, with at most 2 decimals.'::text; return; end if;
    p := pt::numeric;
    for row_no in 1 .. n loop
      k := n - row_no + 1;
      if a_from[k] < p and p <= a_to[k] then return query select 'passing_straddle'::text, format('The passing mark %s falls inside row %s. Split that row so one row starts at %s.', to_char(p, fmt), row_no, to_char(p, fmt)); return; end if;
    end loop;
    thr := array[p]; who := array['your passing mark'];
    for j in 0 .. jsonb_array_length(v_prog) - 1 loop
      el := v_prog -> j; nm := btrim(coalesce(el ->> 'program', ''));
      if nm = '' then return query select 'program_empty'::text, 'A program with its own passing mark needs the program''s name.'::text; return; end if;
      if lower(nm) = any (seen) then return query select 'program_duplicate'::text, format('The program "%s" is listed twice.', nm); return; end if;
      seen := seen || lower(nm);
      pt := el ->> 'passingPct';
      if pt is null or pt !~ '^\d+(\.\d{1,2})?$' or pt::numeric <= 0 or pt::numeric > 100 then return query select 'program_range'::text, format('The passing mark of "%s" must be a percentage above 0 and up to 100, with at most 2 decimals.', nm); return; end if;
      pp := pt::numeric;
      for row_no in 1 .. n loop
        k := n - row_no + 1;
        if a_from[k] < pp and pp <= a_to[k] then return query select 'program_straddle'::text, format('The passing mark %s of "%s" falls inside row %s.', to_char(pp, fmt), nm, row_no); return; end if;
      end loop;
      thr := thr || pp; who := who || format('the passing mark of "%s"', nm);
    end loop;

    -- rows with the same grade must mean the same result; there must be a Passed row and a Failed row
    for ti in 1 .. array_length(thr, 1) loop
      vmap := '{}'::jsonb;
      for row_no in 1 .. n loop
        k := n - row_no + 1;
        passed := a_from[k] >= thr[ti];
        key := vals[k]::float8::text;
        if vmap ? key and (vmap ->> key)::boolean <> passed then
          return query select 'same_grade_result'::text, format('Two rows have the same grade (%s) but, with %s, one is Passed and the other Failed.', a_grade[k], who[ti]); return;
        end if;
        vmap := vmap || jsonb_build_object(key, passed);
      end loop;
    end loop;
    has_pass := false; has_fail := false;
    for k in 1 .. n loop
      if a_from[k] >= p then has_pass := true; end if;
      if a_to[k] < p then has_fail := true; end if;
    end loop;
    if not has_pass or not has_fail then return query select 'no_passed_or_failed'::text, 'The table needs at least one Passed row and one Failed row.'::text; return; end if;
  end if;

  -- the GWA settings
  if coalesce(v_gwa ->> 'method', '') not in ('weighted', 'simple') then return query select 'gwa_method'::text, 'Choose how the GWA is computed.'::text; return; end if;
  if coalesce(v_gwa ->> 'gradeUsed', '') not in ('equivalent', 'percentage') then return query select 'gwa_grade_used'::text, 'Choose which grade the GWA uses.'::text; return; end if;
  if coalesce(v_gwa ->> 'decimals', '') not in ('2', '3', '4') then return query select 'gwa_decimals'::text, 'Choose 2, 3 or 4 decimal places for the GWA.'::text; return; end if;
  if coalesce(v_gwa ->> 'rounding', '') not in ('round', 'cut') then return query select 'gwa_rounding'::text, 'Choose whether the GWA is rounded or the extra decimals are cut off.'::text; return; end if;
  if v_gwa ->> 'gradeUsed' = 'percentage' and v_mode = 'grade' then return query select 'gwa_percent_needs_percentage'::text, 'To work out the GWA from percentages, choose that percentages are entered.'::text; return; end if;
  if v_gwa ->> 'gradeUsed' = 'percentage' then lo := 0; hi := 100; else lo := p_scale_min; hi := p_scale_max; end if;
  if v_gwa ->> 'retentionThreshold' is not null then
    if (v_gwa ->> 'retentionThreshold') !~ '^\d+(\.\d+)?$' or (v_gwa ->> 'retentionThreshold')::numeric < lo or (v_gwa ->> 'retentionThreshold')::numeric > hi then
      return query select 'retention_range'::text, format('The retention requirement must be a number from %s to %s, or left blank.', lo, hi); return;
    end if;
  end if;
  if jsonb_typeof(coalesce(v_gwa -> 'specialValues', '{}'::jsonb)) <> 'object' then return query select 'special_key'::text, 'The special marks are not valid.'::text; return; end if;
  for sk, sv in select * from jsonb_each(coalesce(v_gwa -> 'specialValues', '{}'::jsonb)) loop
    if btrim(sk) = '' or btrim(sk) ~ '^\d+(\.\d+)?$' then return query select 'special_key'::text, format('"%s" is a number, not a special mark.', sk); return; end if;
    if not (lower(btrim(sk)) = any (known)) then return query select 'special_unknown'::text, format('"%s" is not one of your marks.', sk); return; end if;
    if jsonb_typeof(sv) <> 'number' or (sv #>> '{}')::numeric < lo or (sv #>> '{}')::numeric > hi then return query select 'special_value'::text, format('The number for "%s" must be from %s to %s.', sk, lo, hi); return; end if;
  end loop;
  seen := '{}';
  if jsonb_typeof(coalesce(v_gwa -> 'excludedCodes', '[]'::jsonb)) <> 'array' then return query select 'excluded_code'::text, 'The subject codes are not valid.'::text; return; end if;
  for cd in select upper(btrim(e)) from jsonb_array_elements_text(coalesce(v_gwa -> 'excludedCodes', '[]'::jsonb)) e loop
    if cd = '' or char_length(cd) > 20 or cd ~ '[,;\s]' then return query select 'excluded_code'::text, format('"%s" is not a valid subject code.', cd); return; end if;
    if cd = any (seen) then return query select 'excluded_code'::text, format('The subject code %s is listed twice.', cd); return; end if;
    seen := seen || cd;
  end loop;
end;
$$;
revoke all on function public._grading_rules_check(jsonb, numeric, numeric, text, jsonb, text[]) from public, anon, authenticated;

-- 4. One version as JSON: the rules (the same shape the screen sends) and where it starts.
create or replace function public._grading_version_json(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id, 'versionNo', v.version_no, 'effectiveYear', v.effective_year, 'effectiveTerm', v.effective_term, 'createdAt', v.created_at, 'createdByLabel', v.created_by_label, 'note', v.note,
    'rules', jsonb_build_object(
      'entryMode', v.entry_mode, 'passingMarkPct', v.passing_mark_pct, 'programPassing', v.program_passing_marks,
      'bands', coalesce((select jsonb_agg(jsonb_build_object('from', b.pct_from, 'to', b.pct_to, 'equivalentGrade', b.equivalent_grade, 'equivalentValue', b.equivalent_value, 'remarks', b.remarks, 'result', b.result) order by b.sort_no)
                         from public.school_grade_bands b where b.version_id = v.id), '[]'::jsonb),
      'gwa', jsonb_build_object('method', v.gwa_method, 'gradeUsed', v.gwa_grade_used, 'decimals', v.gwa_decimals, 'rounding', v.gwa_rounding, 'includeFailed', v.gwa_include_failed,
                                'specialValues', v.gwa_special_values, 'excludedCodes', to_jsonb(v.gwa_excluded_codes), 'retentionThreshold', v.retention_threshold)))
  from public.school_grading_versions v where v.id = p_version_id;
$$;
revoke all on function public._grading_version_json(uuid) from public, anon, authenticated;

-- 5. Where a school's rules stand: the current period, where new rules would start, the rules in use now, the latest saved rules, the versions and the audit trail.
create or replace function public._grading_overview(p_school uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year text; v_sem text; v_term text;
  v_status text; v_submitted boolean := false;
  v_start jsonb := null; v_reason text;
  v_active uuid; v_latest uuid;
  v_cfg public.school_grading_configs%rowtype;
  n record;
begin
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
  v_term := public.normalize_academic_term(v_sem);
  if coalesce(btrim(v_year), '') <> '' and v_term is not null then
    select p.status into v_status from public.academic_periods p where p.school_year = v_year and p.term = v_term;
    v_submitted := exists (select 1 from public.school_period_submissions s join public.academic_periods p on p.id = s.period_id
                           where s.school_id = p_school and s.status = 'submitted' and p.school_year = v_year and p.term = v_term);
    if v_status = 'open' and not v_submitted then v_start := jsonb_build_object('schoolYear', v_year, 'term', v_term, 'reason', 'now');
    else
      select * into n from public._grading_next_period(v_year, v_term);
      v_start := jsonb_build_object('schoolYear', n.school_year, 'term', n.term, 'reason', case when v_submitted then 'period_submitted' else 'period_not_open' end);
    end if;
    select v.id into v_active from public.school_grading_versions v
      where v.school_id = p_school and public._grading_period_rank(v.effective_year, v.effective_term) <= public._grading_period_rank(v_year, v_term)
      order by public._grading_period_rank(v.effective_year, v.effective_term) desc, v.version_no desc limit 1;
  end if;
  select v.id into v_latest from public.school_grading_versions v where v.school_id = p_school order by v.version_no desc limit 1;
  select * into v_cfg from public.school_grading_configs c where c.school_id = p_school;
  return jsonb_build_object(
    'schoolId', p_school, 'schoolName', (select s.name from public.schools s where s.id = p_school),
    'currentPeriod', case when v_term is null then null else jsonb_build_object('schoolYear', v_year, 'term', v_term, 'status', v_status, 'submitted', v_submitted) end,
    'startsAt', v_start,
    'scale', case when v_cfg.school_id is null then null else jsonb_build_object('scaleMin', v_cfg.scale_min, 'scaleMax', v_cfg.scale_max, 'direction', v_cfg.direction, 'usesLetterGrades', v_cfg.uses_letter_grades,
        'passingMark', v_cfg.passing_mark, 'retentionThreshold', v_cfg.retention_threshold,
        'letters', case when v_cfg.uses_letter_grades then coalesce((select jsonb_agg(jsonb_build_object('letter', l.letter, 'numericValue', l.numeric_value) order by l.letter) from public.school_letter_grades l where l.school_id = p_school), '[]'::jsonb) else '[]'::jsonb end) end,
    'marks', coalesce((select jsonb_agg(m.mark order by m.mark) from public.school_marks m where m.school_id = p_school), '[]'::jsonb),
    'active', case when v_active is null then null else public._grading_version_json(v_active) end,
    'latest', case when v_latest is null then null else public._grading_version_json(v_latest) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'versionNo', v.version_no, 'effectiveYear', v.effective_year, 'effectiveTerm', v.effective_term, 'createdAt', v.created_at,
                          'createdByLabel', v.created_by_label, 'bandCount', (select count(*) from public.school_grade_bands b where b.version_id = v.id)) order by v.version_no desc)
                          from public.school_grading_versions v where v.school_id = p_school), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'changedAt', a.changed_at, 'changedByLabel', a.changed_by_label, 'effectiveYear', a.effective_year, 'effectiveTerm', a.effective_term,
                          'oldRules', a.old_rules, 'newRules', a.new_rules, 'impact', a.impact, 'note', a.note, 'versionNo', (select v.version_no from public.school_grading_versions v where v.id = a.version_id)) order by a.id desc)
                       from (select * from public.school_grading_audit x where x.school_id = p_school order by x.id desc limit 50) a), '[]'::jsonb));
end;
$$;
revoke all on function public._grading_overview(uuid) from public, anon, authenticated;

create or replace function public.school_grading_rules_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can see its grading rules.'; end if;
  return public._grading_overview(public.current_school_id());
end;
$$;
revoke all on function public.school_grading_rules_overview() from public, anon;
grant execute on function public.school_grading_rules_overview() to authenticated;

create or replace function public.school_grading_rules_version(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can see its grading rules.'; end if;
  if not exists (select 1 from public.school_grading_versions v where v.id = p_version_id and v.school_id = public.current_school_id()) then raise exception 'Those grading rules were not found.'; end if;
  return public._grading_version_json(p_version_id);
end;
$$;
revoke all on function public.school_grading_rules_version(uuid) from public, anon;
grant execute on function public.school_grading_rules_version(uuid) to authenticated;

-- CEDO staff: read-only, any school.
create or replace function public.staff_school_grading_rules(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholars_grades_monitoring_staff() or public.is_sead_staff() or public.can_view_renewals()) then raise exception 'Not authorized to see the schools'' grading rules.'; end if;
  if not exists (select 1 from public.schools s where s.id = p_school_id) then raise exception 'That school was not found.'; end if;
  return public._grading_overview(p_school_id);
end;
$$;
revoke all on function public.staff_school_grading_rules(uuid) from public, anon;
grant execute on function public.staff_school_grading_rules(uuid) to authenticated;

create or replace function public.staff_school_grading_rules_version(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholars_grades_monitoring_staff() or public.is_sead_staff() or public.can_view_renewals()) then raise exception 'Not authorized to see the schools'' grading rules.'; end if;
  if not exists (select 1 from public.school_grading_versions v where v.id = p_version_id) then raise exception 'Those grading rules were not found.'; end if;
  return public._grading_version_json(p_version_id);
end;
$$;
revoke all on function public.staff_school_grading_rules_version(uuid) from public, anon;
grant execute on function public.staff_school_grading_rules_version(uuid) to authenticated;

-- 6. Save a new version.
create or replace function public.school_grading_rules_save(p_rules jsonb, p_impact jsonb default '{}'::jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_ov jsonb;
  v_cfg public.school_grading_configs%rowtype;
  v_letters jsonb; v_marks text[];
  v_code text; v_msg text;
  v_start_year text; v_start_term text; v_reason text;
  v_gwa jsonb; v_bands jsonb; v_prog jsonb; v_nb integer;
  v_pass numeric;
  v_new jsonb; v_old jsonb; v_old_rules jsonb;
  v_no integer; v_id uuid; v_label text;
  b jsonb; i integer; ev jsonb;
begin
  if v_school is null or not public.is_school_account() then raise exception 'Only a school account can change its grading rules.'; end if;
  if jsonb_typeof(p_rules) is distinct from 'object' then raise exception 'The rules are not valid.'; end if;
  perform pg_advisory_xact_lock(hashtext('school_grading_rules:' || v_school::text));

  v_ov := public._grading_overview(v_school);
  if v_ov -> 'startsAt' is null or v_ov -> 'startsAt' = 'null'::jsonb then raise exception 'CEDO has not set the current grading period yet, so the rules cannot be saved.'; end if;
  v_start_year := v_ov -> 'startsAt' ->> 'schoolYear'; v_start_term := v_ov -> 'startsAt' ->> 'term'; v_reason := v_ov -> 'startsAt' ->> 'reason';

  select * into v_cfg from public.school_grading_configs c where c.school_id = v_school;
  if not found then raise exception 'Save your grading scale first (above), then the rules.'; end if;
  v_letters := coalesce(v_ov -> 'scale' -> 'letters', '[]'::jsonb);
  v_marks := array(select lower(btrim(m.mark)) from public.school_marks m where m.school_id = v_school);

  select c.code, c.message into v_code, v_msg from public._grading_rules_check(p_rules, v_cfg.scale_min, v_cfg.scale_max, v_cfg.direction, v_letters, v_marks) c limit 1;
  if v_code is not null then raise exception '%', v_msg; end if;

  -- a submitted period at or after the start would be changed: never
  if exists (select 1 from public.school_period_submissions s join public.academic_periods p on p.id = s.period_id
             where s.school_id = v_school and s.status = 'submitted' and public._grading_period_rank(p.school_year, p.term) >= public._grading_period_rank(v_start_year, v_start_term)) then
    raise exception 'A period that is already submitted comes at or after the start of these rules, so they cannot be saved now.';
  end if;

  -- the rules in their saved shape
  v_bands := coalesce(p_rules -> 'bands', '[]'::jsonb);
  v_nb := jsonb_array_length(v_bands);
  v_pass := case when v_nb > 0 then (p_rules ->> 'passingMarkPct')::numeric end;
  v_gwa := coalesce(p_rules -> 'gwa', '{}'::jsonb);
  v_prog := coalesce((select jsonb_agg(jsonb_build_object('program', btrim(e ->> 'program'), 'passingPct', (e ->> 'passingPct')::numeric) order by lower(btrim(e ->> 'program')))
                      from jsonb_array_elements(coalesce(p_rules -> 'programPassing', '[]'::jsonb)) e), '[]'::jsonb);
  if v_nb = 0 then v_prog := '[]'::jsonb; end if;
  v_new := jsonb_build_object(
    'entryMode', p_rules ->> 'entryMode', 'passingMarkPct', v_pass, 'programPassing', v_prog,
    'bands', coalesce((select jsonb_agg(jsonb_build_object('from', (e ->> 'from')::numeric, 'to', (e ->> 'to')::numeric, 'equivalentGrade', btrim(e ->> 'equivalentGrade'), 'remarks', btrim(e ->> 'remarks')) order by (e ->> 'from')::numeric desc)
                       from jsonb_array_elements(v_bands) e), '[]'::jsonb),
    'gwa', jsonb_build_object('method', v_gwa ->> 'method', 'gradeUsed', v_gwa ->> 'gradeUsed', 'decimals', (v_gwa ->> 'decimals')::integer, 'rounding', v_gwa ->> 'rounding',
                              'includeFailed', coalesce((v_gwa ->> 'includeFailed')::boolean, true),
                              'specialValues', coalesce((select jsonb_object_agg(btrim(k), (x #>> '{}')::numeric) from jsonb_each(coalesce(v_gwa -> 'specialValues', '{}'::jsonb)) as t(k, x)), '{}'::jsonb),
                              'excludedCodes', coalesce((select jsonb_agg(c order by c) from (select distinct upper(btrim(x)) as c from jsonb_array_elements_text(coalesce(v_gwa -> 'excludedCodes', '[]'::jsonb)) x) q), '[]'::jsonb),
                              'retentionThreshold', (v_gwa ->> 'retentionThreshold')::numeric));

  -- nothing to save when it is the same as the latest rules
  v_old := v_ov -> 'latest';
  v_old_rules := case when v_old is null or v_old = 'null'::jsonb then null else v_old -> 'rules' end;
  if v_old_rules is not null then
    if (v_old_rules - 'bands') = (v_new - 'bands')
       and coalesce((select jsonb_agg(jsonb_build_object('from', (e ->> 'from')::numeric, 'to', (e ->> 'to')::numeric, 'equivalentGrade', e ->> 'equivalentGrade', 'remarks', e ->> 'remarks') order by ord)
                     from jsonb_array_elements(v_old_rules -> 'bands') with ordinality as t(e, ord)), '[]'::jsonb) = (v_new -> 'bands') then
      raise exception 'Nothing has changed since the rules you saved last.';
    end if;
  end if;

  select coalesce(a.username, s.name) into v_label from public.school_accounts a join public.schools s on s.id = a.school_id where a.id = auth.uid();
  select coalesce(max(v.version_no), 0) + 1 into v_no from public.school_grading_versions v where v.school_id = v_school;
  insert into public.school_grading_versions (
    school_id, version_no, effective_year, effective_term, entry_mode, passing_mark_pct, program_passing_marks,
    gwa_method, gwa_grade_used, gwa_decimals, gwa_rounding, gwa_include_failed, gwa_special_values, gwa_excluded_codes, retention_threshold, note, created_by, created_by_label)
  values (
    v_school, v_no, v_start_year, v_start_term, v_new ->> 'entryMode', v_pass, v_prog,
    v_gwa ->> 'method', v_gwa ->> 'gradeUsed', (v_gwa ->> 'decimals')::integer, v_gwa ->> 'rounding', coalesce((v_gwa ->> 'includeFailed')::boolean, true),
    v_new -> 'gwa' -> 'specialValues', coalesce(array(select jsonb_array_elements_text(v_new -> 'gwa' -> 'excludedCodes')), '{}'::text[]), (v_gwa ->> 'retentionThreshold')::numeric,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_label)
  returning id into v_id;

  i := 0;
  for b in select e from jsonb_array_elements(v_new -> 'bands') e loop
    i := i + 1;
    ev := public._grading_equivalent_value(b ->> 'equivalentGrade', v_cfg.scale_min, v_cfg.scale_max, v_letters);
    insert into public.school_grade_bands (version_id, sort_no, pct_from, pct_to, equivalent_grade, equivalent_value, remarks, result)
    values (v_id, i, (b ->> 'from')::numeric, (b ->> 'to')::numeric, b ->> 'equivalentGrade', (ev ->> 'value')::numeric, b ->> 'remarks', case when (b ->> 'from')::numeric >= v_pass then 'passed' else 'failed' end);
  end loop;

  insert into public.school_grading_audit (school_id, version_id, changed_by, changed_by_label, effective_year, effective_term, old_rules, new_rules, impact, note)
  values (v_school, v_id, auth.uid(), v_label, v_start_year, v_start_term, v_old_rules, public._grading_version_json(v_id) -> 'rules', coalesce(p_impact, '{}'::jsonb), nullif(btrim(coalesce(p_note, '')), ''));

  return jsonb_build_object('versionId', v_id, 'versionNo', v_no, 'startsYear', v_start_year, 'startsTerm', v_start_term, 'reason', v_reason);
end;
$$;
revoke all on function public.school_grading_rules_save(jsonb, jsonb, text) from public, anon;
grant execute on function public.school_grading_rules_save(jsonb, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
