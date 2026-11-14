-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_per_school.sql
-- THE PASSING GWA AND THE ACADEMIC STATUS OF THE PROGRAMS ARE SET PER SCHOOL.   Safe to run twice.   Undo: undo_academic_per_school.sql
--   * In "Grades and Academic Management" the staff choose a SCHOOL; its passing GWA for Academic and for Non-academic programs is set there, on the SCHOOL'S OWN SCALE (1.0 to 5.0 lower is better,
--     or percent, or any other: the tab shows the scale), and the list of programs shows only the programs of that school's scholars, each placed under Academic or Non-academic (a special
--     program may have its own passing GWA). Every school can be compared, so the "not on the standard scale" limit of the first version is gone.
--   * The renewal rule is the same (a GWA worse than the passing GWA of the school's group needs a consultation); a program not placed yet counts as Academic; no passing GWA set = the rule is off for that school.
--   * What the first version had saved is copied to the schools, so nothing changes until the staff change it.
-- Needs supabase_migration_academic_status.sql. Adds two tables. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._scholar_gwa_standard(text,text,text,uuid)') is null or to_regclass('public.academic_programs') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_status.sql first.';
  end if;
end $$;

-- 1. The passing GWA of a SCHOOL (on that school's own scale), and the academic status of each program OF THAT SCHOOL (with an optional passing GWA of its own for a special program).
create table if not exists public.academic_school_settings (
  school_id                uuid primary key references public.schools(id) on delete cascade,
  academic_passing_gwa     numeric,
  non_academic_passing_gwa numeric,
  updated_by               uuid,
  updated_at               timestamptz not null default now()
);
create table if not exists public.academic_school_programs (
  school_id           uuid not null references public.schools(id) on delete cascade,
  program_key         text not null,
  program             text not null,
  academic_status     text not null check (academic_status in ('academic', 'non_academic')),
  special_passing_gwa numeric,
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  primary key (school_id, program_key)
);
alter table public.academic_school_settings enable row level security;
alter table public.academic_school_programs enable row level security;
revoke all on table public.academic_school_settings, public.academic_school_programs from public, anon, authenticated;

-- 2. The scale the GWA of a school is on: the percent (0 to 100, higher is better) when the school's rules say the GWA uses percentages, else the school's own scale. No row = the school has no grading setup yet.
create or replace function public._academic_school_scale(p_school uuid)
returns table(kind text, scale_min numeric, scale_max numeric, direction text)
language sql
stable
security definer
set search_path = public
as $$
  select case when lv.gwa_grade_used = 'percentage' then 'percent' else 'scale' end,
         case when lv.gwa_grade_used = 'percentage' then 0::numeric else c.scale_min end,
         case when lv.gwa_grade_used = 'percentage' then 100::numeric else c.scale_max end,
         case when lv.gwa_grade_used = 'percentage' then 'higher_is_better' else c.direction end
  from public.schools s
  left join public.school_grading_configs c on c.school_id = s.id
  left join lateral (select v.gwa_grade_used from public.school_grading_versions v where v.school_id = s.id
                     order by public._grading_period_rank(v.effective_year, v.effective_term) desc, v.version_no desc limit 1) lv on true
  where s.id = p_school and (c.school_id is not null or lv.gwa_grade_used = 'percentage');
$$;
revoke all on function public._academic_school_scale(uuid) from public, anon, authenticated;

-- 3. The academic status and the passing GWA of a scholar: the program of THEIR SCHOOL decides the group (a program not placed yet counts as Academic), the school's own number is the passing GWA, a special program has its own.
create or replace function public._scholar_academic(p_scholar text)
returns table(academic_status text, is_set boolean, passing_gwa numeric, special boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sp.academic_status, 'academic'), sp.program_key is not null,
         coalesce(sp.special_passing_gwa, case coalesce(sp.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end),
         sp.special_passing_gwa is not null
  from public.scholars s
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
  where s.scholar_id_number = p_scholar;
$$;
revoke all on function public._scholar_academic(text) from public, anon, authenticated;

-- 4. The GWA of the semester a renewal looks at, on the school's own scale (weighted by units, or simple as the school's rules say; the subjects excluded from the GWA left out; a subject with no units counts as 1),
--    its passing GWA, and whether it is WORSE than the passing GWA (a bigger number where lower is better, a smaller one where higher is better). p_self_id: the entered grades the renewal uses (null = the school's grades).
create or replace function public._scholar_gwa_check(p_scholar text, p_year text, p_term text, p_self_id uuid)
returns table(gwa numeric, passing_gwa numeric, low boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_pass numeric;
  sc record;
  v_letters jsonb;
  v_method text := 'weighted';
  v_gwa numeric;
begin
  select s.school_id into v_school from public.scholars s where s.scholar_id_number = p_scholar;
  select a.passing_gwa into v_pass from public._scholar_academic(p_scholar) a;
  if v_school is null or v_pass is null then return query select null::numeric, v_pass, false; return; end if;
  select * into sc from public._academic_school_scale(v_school);
  if not found then return query select null::numeric, v_pass, false; return; end if;
  select v.gwa_method into v_method from public.school_grading_versions v where v.school_id = v_school
    order by public._grading_period_rank(v.effective_year, v.effective_term) desc, v.version_no desc limit 1;
  v_method := coalesce(v_method, 'weighted');
  select coalesce(jsonb_agg(jsonb_build_object('letter', l.letter, 'numericValue', l.numeric_value)), '[]'::jsonb) into v_letters from public.school_letter_grades l where l.school_id = v_school;
  select round(case when v_method = 'simple' then avg(x.v) else sum(x.v * x.u) / nullif(sum(x.u), 0) end, 2) into v_gwa
  from (
    select case when sc.kind = 'percent' then g.percentage
                else (public._grading_equivalent_value(g.grade, sc.scale_min, sc.scale_max, v_letters) ->> 'value')::numeric end as v,
           coalesce(nullif(g.units, 0), 1) as u
    from public.scholar_subjects_grades g
    where p_self_id is null and g.scholar_id_number = p_scholar and g.school_year = p_year and g.semester = p_term and not coalesce(g.exclude_from_gwa, false)
    union all
    select case when sc.kind = 'percent' then (case when btrim(l.grade) ~ '^\d+(\.\d+)?$' and btrim(l.grade)::numeric <= 100 then btrim(l.grade)::numeric end)
                else (public._grading_equivalent_value(l.grade, sc.scale_min, sc.scale_max, v_letters) ->> 'value')::numeric end,
           coalesce(nullif(l.units, 0), 1)
    from public.renewal_self_grade_lines l
    where p_self_id is not null and l.submission_id = p_self_id
  ) x
  where x.v is not null;
  return query select v_gwa, v_pass, case when v_gwa is null then false when sc.direction = 'higher_is_better' then v_gwa < v_pass else v_gwa > v_pass end;
end;
$$;
revoke all on function public._scholar_gwa_check(text, text, text, uuid) from public, anon, authenticated;

-- 5. The existing numbers of the first version of this feature (one passing GWA for everybody, programs without a school) are copied to every school that has them, so nothing changes until the staff change it:
--    the passing GWAs to the schools on the standard scale (the only ones the first version compared), the programs to every school that has scholars in that program.
do $$ begin
  if to_regclass('public.academic_gwa_settings') is not null and to_regclass('public.academic_programs') is not null then
    insert into public.academic_school_settings (school_id, academic_passing_gwa, non_academic_passing_gwa)
    select c.school_id, g.academic_passing_gwa, g.non_academic_passing_gwa
    from public.school_grading_configs c cross join public.academic_gwa_settings g
    where c.scale_min = 1 and c.scale_max = 5 and c.direction = 'lower_is_better' and (g.academic_passing_gwa is not null or g.non_academic_passing_gwa is not null)
    on conflict (school_id) do nothing;
    insert into public.academic_school_programs (school_id, program_key, program, academic_status, special_passing_gwa)
    select distinct s.school_id, ap.program_key, ap.program, ap.academic_status, ap.special_passing_gwa
    from public.academic_programs ap join public.scholars s on public._program_key(s.course) = ap.program_key and s.school_id is not null
    on conflict (school_id, program_key) do nothing;
  end if;
end $$;


-- 6. The tab: the schools (with their scale and numbers), and the programs of the chosen school.
drop function if exists public.academic_settings_get();
create or replace function public.academic_settings_get(p_school uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := p_school;
  v_schools jsonb;
begin
  perform public._academic_require_manager();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'scholars', x.n, 'not_set', x.not_set,
      'has_setup', sc.kind is not null, 'kind', sc.kind, 'scale_min', sc.scale_min, 'scale_max', sc.scale_max, 'direction', sc.direction,
      'academic_passing_gwa', ss.academic_passing_gwa, 'non_academic_passing_gwa', ss.non_academic_passing_gwa) order by x.name), '[]'::jsonb) into v_schools
  from (
    select s.id, s.name, count(*)::int as n,
           count(*) filter (where nullif(btrim(coalesce(sc2.course, '')), '') is not null and not exists (select 1 from public.academic_school_programs ap where ap.school_id = s.id and ap.program_key = public._program_key(sc2.course)))::int as not_set
    from public.schools s join public.scholars sc2 on sc2.school_id = s.id and sc2.status not in ('Removed')
    group by s.id, s.name
  ) x
  left join lateral public._academic_school_scale(x.id) sc on true
  left join public.academic_school_settings ss on ss.school_id = x.id;
  if v_school is null then v_school := nullif(v_schools -> 0 ->> 'id', '')::uuid; end if;
  return jsonb_build_object(
    'schools', v_schools, 'school', v_school,
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.k, 'program', p.name, 'scholars', p.n, 'academic_status', ap.academic_status, 'special_passing_gwa', ap.special_passing_gwa, 'is_set', ap.program_key is not null) order by p.name)
      from (
        select public._program_key(s.course) as k, (array_agg(btrim(s.course) order by length(btrim(s.course)) desc))[1] as name, count(*)::int as n
        from public.scholars s where s.school_id = v_school and nullif(btrim(coalesce(s.course, '')), '') is not null and s.status not in ('Removed')
        group by public._program_key(s.course)
      ) p
      left join public.academic_school_programs ap on ap.school_id = v_school and ap.program_key = p.k), '[]'::jsonb));
end;
$$;
revoke all on function public.academic_settings_get(uuid) from public, anon;
grant execute on function public.academic_settings_get(uuid) to authenticated;

-- The numbers are checked against the school's own scale.
create or replace function public._academic_check_gwa(p_school uuid, p_value numeric)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sc record;
begin
  if p_value is null then return; end if;
  select * into sc from public._academic_school_scale(p_school);
  if not found then raise exception 'This school has no grading setup yet (its scale), so a passing GWA cannot be set. Set the school''s grading in Scholars'' Grades Monitoring first.'; end if;
  if p_value < sc.scale_min or p_value > sc.scale_max then
    raise exception 'The passing GWA of this school is a number from % to % (its own scale; % is the best).', to_char(sc.scale_min, 'FM990.00'), to_char(sc.scale_max, 'FM990.00'), case when sc.direction = 'higher_is_better' then to_char(sc.scale_max, 'FM990.00') else to_char(sc.scale_min, 'FM990.00') end;
  end if;
end;
$$;
revoke all on function public._academic_check_gwa(uuid, numeric) from public, anon, authenticated;

drop function if exists public.academic_settings_save(numeric, numeric);
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

drop function if exists public.academic_program_save(text, text, numeric);
create or replace function public.academic_program_save(p_school uuid, p_program text, p_status text, p_special numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public._program_key(p_program);
  v_name text;
begin
  perform public._academic_require_manager();
  select name into v_name from public.schools where id = p_school;
  if v_name is null then raise exception 'Choose a school.'; end if;
  if v_key = '' then raise exception 'Choose a program.'; end if;
  if p_status is not null and p_status not in ('academic', 'non_academic') then raise exception 'The academic status is Academic or Non-academic.'; end if;
  perform public._academic_check_gwa(p_school, p_special);
  if p_status is null then
    delete from public.academic_school_programs where school_id = p_school and program_key = v_key;
  else
    insert into public.academic_school_programs (school_id, program_key, program, academic_status, special_passing_gwa, updated_by, updated_at)
    values (p_school, v_key, btrim(p_program), p_status, p_special, auth.uid(), now())
    on conflict (school_id, program_key) do update set program = excluded.program, academic_status = excluded.academic_status, special_passing_gwa = excluded.special_passing_gwa, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), v_name || ' / program ' || btrim(p_program) || ': ' || coalesce(case p_status when 'academic' then 'Academic' else 'Non-academic' end, 'not set') || coalesce(', own passing GWA ' || to_char(p_special, 'FM990.00'), ''));
end;
$$;
revoke all on function public.academic_program_save(uuid, text, text, numeric) from public, anon;
grant execute on function public.academic_program_save(uuid, text, text, numeric) to authenticated;

-- The academic status of every program of every school, for the Information list.
drop function if exists public.academic_status_map();
create or replace function public.academic_status_map()
returns table(school_name text, program_key text, academic_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_cedo_staff() then raise exception 'Not authorized.'; end if;
  return query select s.name, ap.program_key, ap.academic_status from public.academic_school_programs ap join public.schools s on s.id = ap.school_id;
end;
$$;
revoke all on function public.academic_status_map() from public, anon;
grant execute on function public.academic_status_map() to authenticated;


create or replace function public._renewal_evaluate(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scholar public.scholars%rowtype;
  v_rec public.renewal_records%rowtype;
  v_b_year text;
  v_b_term text;
  v_summer boolean := (p_term = 'Summer');
  v_sdp record;
  v_rc public.sdp_reconsideration_requests%rowtype;
  v_req jsonb;
  v_next record;
  v_self public.renewal_self_grade_submissions%rowtype;
  v_use_self boolean := false;
  v_sdp_json jsonb := jsonb_build_object('applicable', not v_summer, 'complied', null, 'missing', null);
  v_sdp_ok boolean := true;
  v_period_id uuid;
  v_submitted boolean := false;
  v_school_sub boolean := false;
  v_state text := 'ready';
  v_reason text := '';
  v_total integer := 0;  v_passed integer := 0;  v_failed integer := 0;  v_drp integer := 0;  v_inc integer := 0;
  v_review integer := 0; v_ungraded integer := 0; v_nopm integer := 0;
  v_failed_list jsonb := '[]'::jsonb;  v_inc_list jsonb := '[]'::jsonb;  v_review_list jsonb := '[]'::jsonb;
  g record;
  v_outcome text;
  v_school uuid;
  v_item public.renewal_inc_items%rowtype;
  v_counted_failed integer := 0;
  v_inc_open integer := 0;
  v_inc_open_without_deadline integer := 0;
  v_inc_overdue integer := 0;
  v_prev boolean;
  v_failed_eff integer;
  v_c boolean;
  v_b boolean;
  v_docs jsonb := '[]'::jsonb;
  v_need_study boolean := false;
  v_need_inc boolean := false;
  v_docs_complete boolean := true;
  v_need_clear boolean := false;  v_clear_have integer := 0;  v_clear_approved integer := 0;
  v_study_have integer := 0;  v_inc_have integer := 0;  v_prosp_have integer := 0;  v_study_approved integer := 0;  v_inc_approved integer := 0;
  v_consult_done boolean := false;
  v_hard_copy boolean := false;
  v_consult_required boolean := false;
  v_stage text;
  v_code text;
  v_text text;
  v_legacy boolean := false;
  v_tag boolean := false;
  v_gwa numeric;
  v_pass numeric;
  v_low_gwa boolean := false;
begin
  select * into v_scholar from public.scholars where scholar_id_number = p_scholar_id_number;
  if not found then return jsonb_build_object('error', 'Scholar not found.'); end if;
  select * into v_rec from public.renewal_records where scholar_id_number = p_scholar_id_number and school_year = p_school_year and term = p_term;
  -- the Grades Approver tagged this scholar as temporary probationary (an INC or one missing grade): see renewal_tag_temp_probation()
  v_tag := v_rec.id is not null and v_rec.temp_tag_at is not null;

  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_prev := public.scholar_had_regular_probation(p_scholar_id_number);

  -- SDP (1st and 2nd Semester only), checked for the basis semester.
  if not v_summer then
    select * into v_sdp from public._sdp_compliance(v_b_year, v_b_term, p_scholar_id_number) limit 1;
    if found then
      v_sdp_ok := coalesce(v_sdp.complied, false);
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', v_sdp.complied, 'missing', v_sdp.missing,
        'community_service', v_sdp.community_service, 'community_volunteerism', v_sdp.community_volunteerism, 'formation_program', v_sdp.formation_program);
    else
      v_sdp_ok := false;
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', false, 'missing', 'No SDP record found');
    end if;
    -- what each category needs (3, plus what the scholar owes for this semester), what is lacking, and the semester after (where a reconsideration's lacking credits are added)
    v_req := public._sdp_required_map(p_scholar_id_number, v_b_year, v_b_term);
    select n.school_year, n.semester into v_next from public._sdp_next_semester(v_b_year, v_b_term) n;
    v_sdp_json := v_sdp_json || jsonb_build_object('required', v_req,
      'lacking', jsonb_build_object(
        'community_service', greatest(0, (v_req ->> 'community_service')::integer - coalesce((v_sdp_json ->> 'community_service')::integer, 0)),
        'community_volunteerism', greatest(0, (v_req ->> 'community_volunteerism')::integer - coalesce((v_sdp_json ->> 'community_volunteerism')::integer, 0)),
        'formation_program', greatest(0, (v_req ->> 'formation_program')::integer - coalesce((v_sdp_json ->> 'formation_program')::integer, 0))),
      'next_school_year', v_next.school_year, 'next_semester', v_next.semester);
  end if;
  -- the scholar's SDP reconsideration request for this term, if there is one (an approved one already made the check above say "complied")
  select * into v_rc from public.sdp_reconsideration_requests r where r.scholar_id_number = p_scholar_id_number and r.school_year = p_school_year and r.term = p_term;
  if found then
    v_sdp_json := v_sdp_json || jsonb_build_object('reconsideration', jsonb_build_object('id', v_rc.id, 'status', v_rc.status, 'requested_at', v_rc.requested_at,
      'decided_at', v_rc.decided_at, 'note', v_rc.decision_note, 'lacking', v_rc.lacking));
    if v_rc.status = 'approved' then v_sdp_json := v_sdp_json || jsonb_build_object('by_reconsideration', true); end if;
  end if;

  -- Grades for the basis semester: has the school submitted it?
  select p.id into v_period_id from public.academic_periods p where p.school_year = v_b_year and p.term = v_b_term;
  if v_scholar.school_id is null then
    v_state := 'review'; v_reason := 'The scholar is not linked to a school.';
  else
    select exists (
      select 1 from public.school_period_submissions s
      where s.school_id = v_scholar.school_id and s.period_id = v_period_id and s.status = 'submitted'
    ) into v_school_sub;
    -- the school's grades count for THIS scholar only when the school submitted the semester AND recorded at least one graded subject for the scholar
    -- (a school can submit a semester without a single grade for this scholar: then the scholar must enter their own, like when the school has not submitted)
    v_submitted := v_school_sub and exists (
      select 1 from public.scholar_subjects_grades r
      where r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term and nullif(btrim(coalesce(r.grade, '')), '') is not null);
    -- the grades the scholar entered in the portal for this semester (the newest try that is waiting or approved)
    select * into v_self from public.renewal_self_grade_submissions e where e.scholar_id_number = p_scholar_id_number and e.basis_school_year = v_b_year and e.basis_term = v_b_term
      and e.status in ('pending', 'approved') order by e.version desc limit 1;
    if not v_submitted then
      if v_self.status = 'approved' then
        v_use_self := true;     -- the school has not uploaded yet: the entered grades the Grades Approver approved count as the scholar's grades
      elsif v_self.status = 'pending' then
        v_state := 'waiting';
        v_reason := 'The grades you entered for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are waiting for the Grades Approver.';
      else
        v_state := 'waiting';
        v_reason := case when v_school_sub then 'Your school has submitted its grades but has none recorded for you for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.'
                         else 'Your school has not submitted its grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.' end;
      end if;
    end if;
  end if;

  if v_state = 'ready' or v_state = 'waiting' then
    for g in
      select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id
      from public.scholar_subjects_grades r
      where not v_use_self and r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term
      union all
      select l.id, l.subject_code, l.subject, l.grade, null::uuid
      from public.renewal_self_grade_lines l
      where v_use_self and l.submission_id = v_self.id
      order by 2, 3
    loop
      v_school := coalesce(g.recorded_by_school_id, v_scholar.school_id);
      v_outcome := public._grade_outcome(v_school, g.grade);
      v_total := v_total + 1;
      if v_outcome = 'passed' then v_passed := v_passed + 1;
      elsif v_outcome = 'failed' or v_outcome = 'drp' then
        v_failed := v_failed + 1; if v_outcome = 'drp' then v_drp := v_drp + 1; end if;
        v_failed_list := v_failed_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      elsif v_outcome = 'inc' or (v_outcome = 'ungraded' and v_tag) then      -- a missing grade of a tagged scholar is tracked like an INC (with its own deadline)
        v_inc := v_inc + 1;
        v_item := null;
        if v_rec.id is not null then
          select * into v_item from public.renewal_inc_items i where i.record_id = v_rec.id and i.subject_code = g.subject_code;
        end if;
        v_inc_list := v_inc_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade,
          'state', coalesce(v_item.state, 'open'), 'deadline', v_item.deadline, 'item_id', v_item.id,
          'kind', case when v_outcome = 'ungraded' then 'lacking' else 'inc' end));
        if coalesce(v_item.state, 'open') = 'counted_failed' then v_counted_failed := v_counted_failed + 1;
        elsif coalesce(v_item.state, 'open') = 'open' then
          v_inc_open := v_inc_open + 1;
          if v_item.deadline is null then v_inc_open_without_deadline := v_inc_open_without_deadline + 1;
          elsif v_item.deadline < (now() at time zone 'Asia/Manila')::date then v_inc_overdue := v_inc_overdue + 1; end if;
        end if;
      elsif v_outcome = 'ungraded' then v_ungraded := v_ungraded + 1;
      else
        v_review := v_review + 1; if v_outcome = 'no_passing_mark' then v_nopm := v_nopm + 1; end if;
        v_review_list := v_review_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      end if;
    end loop;

    if v_state = 'ready' then
      if v_total = 0 then
        v_state := 'no_grades'; v_reason := 'No grades are recorded for ' || public._renewal_term_label(v_b_year, v_b_term) || '.';
      elsif v_ungraded > 0 then
        v_state := 'waiting'; v_reason := 'Some grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are still blank.';
      elsif v_nopm > 0 then
        v_state := 'review'; v_reason := 'The school has not set its passing mark, so the grades cannot be judged yet.';
      elsif v_review > 0 then
        v_state := 'review'; v_reason := 'Some marks cannot be read as passed or failed and need the evaluator''s review.';
      end if;
    end if;
  end if;

  v_failed_eff := v_failed + v_counted_failed;
  -- the academic status of the program and the passing GWA of the SCHOOL (on the school's own scale): a GWA worse than it needs a consultation (also with no failed subject)
  if v_state = 'ready' and not v_summer then
    select c.gwa, c.passing_gwa, coalesce(c.low, false) into v_gwa, v_pass, v_low_gwa from public._scholar_gwa_check(p_scholar_id_number, v_b_year, v_b_term, case when v_use_self then v_self.id else null end) c;
  end if;
  v_c := (v_failed_eff >= 2) or (v_failed_eff = 1 and v_prev);
  v_b := (v_failed_eff = 1 and not v_prev);
  v_consult_done := v_rec.consultation_done_at is not null;
  v_hard_copy := v_rec.hard_copy_received_at is not null;
  -- a case the Division Head already has (or had) keeps the old route; every other case with a failed subject / DRP follows the consultation staff's endorsement
  v_legacy := v_rec.id is not null and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id);

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    -- a scholar with a failed subject (one or two or more) or an INC sends the three documents: the letter from the dean, the study plan and the clearance
    -- (a tagged scholar with only an INC / one missing grade sends no documents and has no consultation: the evaluator renews them as temporary probationary)
    v_need_study := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
    -- the letter from the dean is NOT needed for failed subjects (one, two or more): the study plan and the clearance only. An INC still needs it.
    v_need_inc := v_inc_open > 0 and not v_tag;
    v_need_clear := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
  end if;
  if v_rec.id is not null then
    select count(*) filter (where d.kind = 'study_plan'), count(*) filter (where d.kind = 'inc_letter'), count(*) filter (where d.kind = 'prospectus'),
           count(*) filter (where d.kind = 'study_plan' and d.status = 'accepted'), count(*) filter (where d.kind = 'inc_letter' and d.status = 'accepted'),
           count(*) filter (where d.kind = 'clearance'), count(*) filter (where d.kind = 'clearance' and d.status = 'accepted')
      into v_study_have, v_inc_have, v_prosp_have, v_study_approved, v_inc_approved, v_clear_have, v_clear_approved
    from public.renewal_documents d where d.record_id = v_rec.id and d.status <> 'returned';
  end if;
  if v_need_study then
    -- "satisfied" = uploaded; "approved" = the evaluator accepted it (the scholar cannot book a consultation, and the case cannot be endorsed, before that).
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'study_plan', 'label', 'Study plan', 'satisfied', v_study_have > 0, 'approved', v_study_approved > 0));
    if v_study_have = 0 or v_study_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_inc then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'inc_letter', 'label', 'Letter from your dean', 'satisfied', v_inc_have > 0, 'approved', v_inc_approved > 0));
    if v_inc_have = 0 or v_inc_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_clear then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'clearance', 'label', 'Clearance (from your school Guidance office or School coordinator)', 'satisfied', v_clear_have > 0, 'approved', v_clear_approved > 0));
    if v_clear_have = 0 or v_clear_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_summer then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'prospectus', 'label', 'Prospectus (bring the hard copy to your consultation)', 'satisfied', v_prosp_have > 0));
    if v_prosp_have = 0 then v_docs_complete := false; end if;
  end if;

  v_consult_required := (v_state = 'ready') and (v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag) or v_summer or v_low_gwa);

  -- Rule code and plain-language text.
  if v_state = 'ready' then
    if v_c then v_code := case when v_failed_eff >= 2 then 'C2' else 'C1P' end;
      v_text := case when v_failed_eff >= 2
        then 'Two or more failed subjects: the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).'
        else 'One failed subject and the scholar was on probation before: treated like two or more failed subjects — the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).' end;
    elsif v_b then v_code := 'B';
      v_text := 'One failed subject and no previous probation: the letter from your dean, the study plan and the clearance, then a consultation, then the evaluator endorses the scholar for Probationary to the Division Head, who approves (Renewed as Probationary if approved).';
    elsif v_tag and v_inc_open > 0 then v_code := 'T';
      v_text := 'Tagged as temporary probationary (an INC or one missing grade): no documents and no consultation. The evaluator renews the scholar as Probationary (temporary); the scholar has the days the Grades Approver gave to comply, then returns to Regular if the grade is passed, or stays Probationary.';
    elsif v_inc_open > 0 then v_code := 'D';
      v_text := 'Has an INC subject: INC letter from the dean, study plan and clearance, temporary probation and a consultation where staff set the deadline to comply. Decided after the INC is resolved.';
    else v_code := case when v_low_gwa then 'G' else 'A' end;
      v_text := case when v_low_gwa then 'All subjects passed, but the GWA (' || to_char(v_gwa, 'FM0.00') || ') is below the passing GWA of the scholar''s program group (' || to_char(v_pass, 'FM0.00') || '): the scholar books a consultation, then the evaluator confirms the renewal.'
                     else 'All subjects passed: no documents needed. The evaluator confirms the renewal.' end;
    end if;
    if not v_legacy and (v_c or v_b) then
      v_text := 'A failed subject (or a DRP): book your consultation, send ' || case when v_inc_open = 0 then 'the study plan and the clearance' else 'the letter from your dean, the study plan and the clearance' end || ' (the consultation staff approve them), then the consultation staff endorse your new scholarship status and the evaluator approves it.';
    end if;
    if v_inc_open > 0 and v_failed_eff >= 1 then
      v_code := v_code || '+D';
      v_text := v_text || ' The INC stays on temporary probation until it is resolved, then the case is re-checked.';
    end if;
    if v_summer then
      v_code := v_code || '+S';
      v_text := v_text || ' Summer: no SDP requirement; the prospectus and a face-to-face consultation (hard copy received) are always required before the evaluator confirms.';
    end if;
  end if;

  -- The stage.
  if not v_sdp_ok then
    v_stage := 'sdp_on_hold'; v_reason := coalesce(v_sdp_json ->> 'missing', 'SDP not complied');
    v_code := 'SDP_HOLD';
    v_text := case when v_rc.status = 'pending' then 'SDP is not complied: an SDP reconsideration was requested and is waiting for a decision. It is re-checked automatically.'
                   when v_rc.status = 'denied' then 'SDP is not complied: the SDP reconsideration request was denied, so the application is on hold until the missing credits are recorded. It is re-checked automatically.'
                   else 'SDP is not complied: the application is on hold until the missing credits are recorded. It is re-checked automatically.' end;
  elsif v_state = 'waiting' then
    v_stage := 'waiting_grades'; v_code := 'WAITING'; v_text := 'Waiting for grades: re-checked automatically when the school submits.';
  elsif v_state in ('no_grades', 'review') then
    v_stage := 'review_needed'; v_code := 'REVIEW'; v_text := 'Needs the evaluator''s manual review: ' || v_reason;
  elsif (v_c or v_b) and not v_legacy then
    v_stage := case when v_docs_complete and v_consult_done then 'ready_for_endorsement' else 'needs_study_plan_consultation' end;
  elsif v_c then v_stage := 'needs_consultation_division_head';
  elsif v_b then
    v_stage := case when v_docs_complete and v_consult_done and v_inc_open = 0 then 'ready_to_endorse' else 'needs_study_plan_consultation' end;
  elsif v_tag and v_inc_open > 0 and not v_summer then
    v_stage := 'ready_for_confirmation';
  elsif v_inc_open > 0 then
    v_stage := case when v_inc_open_without_deadline > 0 then 'needs_inc_letter_consultation'
                    when v_inc_overdue > 0 then 'inc_deadline_passed'
                    else 'inc_waiting_compliance' end;
  elsif v_summer then
    v_stage := case when v_docs_complete and v_consult_done and v_hard_copy then 'ready_for_confirmation' else 'summer_requirements' end;
  elsif v_low_gwa then
    v_stage := case when v_consult_done then 'ready_for_confirmation' else 'needs_gwa_consultation' end;
  else
    v_stage := 'ready_for_confirmation';
  end if;

  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'sdp', v_sdp_json,
    'grades', jsonb_build_object(
      'state', v_state, 'school_submitted', v_submitted, 'reason', v_reason,
      'self_reported', v_use_self, 'self_status', v_self.status, 'self_submission_id', v_self.id,
      'counts', jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_failed, 'drp', v_drp, 'inc', v_inc, 'review', v_review, 'ungraded', v_ungraded),
      'failed_subjects', v_failed_list, 'inc_subjects', v_inc_list, 'review_subjects', v_review_list),
    'temp_tag', v_tag, 'gwa', v_gwa, 'passing_gwa', v_pass, 'low_gwa', v_low_gwa, 'academic_version', (select ags.version from public.academic_gwa_settings ags where ags.id), 'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consult_route', ((v_c or v_b) and not v_legacy), 'consultation_required', v_consult_required, 'consultation_done', v_consult_done);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
