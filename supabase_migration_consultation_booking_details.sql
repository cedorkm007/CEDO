-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_booking_details.sql
-- CONSULTATION TOOL > APPOINTMENTS: more about the scholar in the booking pop-up: course, year level, barangay, school and GWA.   Safe to run twice.   Undo: undo_consultation_booking_details.sql
--
--   * One new function, counseling_slot_scholar_info(slot), and a small helper that works out a GWA: they only READ. Only consultation staff can ask, and only about their own appointments (the ones they see on the calendar).
--   * Course, year level, barangay and school are the ones saved on the scholar's record.
--   * The GWA is the one the renewal itself uses (the GWA of the semester the renewal looks at, on the scholar's SCHOOL'S own scale, as stored in the renewal's last check). If the renewal has no GWA stored yet,
--     or the booking is a referral with no renewal, it is worked out from the grades of the latest semester that has grades. The function also says which semester it is and what scale it is on.
--   * Nothing is changed or deleted. No table is touched. (The GWA does not need a passing GWA to be set.)
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.counseling_slots') is null or to_regprocedure('public._require_counseling_staff()') is null or to_regprocedure('public._grading_equivalent_value(text,numeric,numeric,jsonb)') is null then
    raise exception 'STOPPED, nothing changed: run the consultation files and the school grading rules files first.';
  end if;
end $$;

-- The GWA of one semester from the grades the school recorded, by the school's own rules (its scale, weighted by units or simple, equivalent grades or percentages; the subjects left out of the GWA are not counted).
-- It does not need a passing GWA to be set. Null when there are no grades or the school has no grading setup.
create or replace function public._scholar_gwa_of_period(p_scholar text, p_year text, p_term text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid;
  c public.school_grading_configs%rowtype;
  v_method text;
  v_used text;
  v_letters jsonb;
  v_gwa numeric;
begin
  if p_year is null or p_term is null then return null; end if;
  select s.school_id into v_school from public.scholars s where s.scholar_id_number = p_scholar;
  if v_school is null then return null; end if;
  select * into c from public.school_grading_configs where school_id = v_school;
  select v.gwa_method, v.gwa_grade_used into v_method, v_used from public.school_grading_versions v where v.school_id = v_school
    order by public._grading_period_rank(v.effective_year, v.effective_term) desc, v.version_no desc limit 1;
  v_method := coalesce(v_method, 'weighted'); v_used := coalesce(v_used, 'equivalent');
  if c.school_id is null and v_used <> 'percentage' then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('letter', l.letter, 'numericValue', l.numeric_value)), '[]'::jsonb) into v_letters from public.school_letter_grades l where l.school_id = v_school;
  select round(case when v_method = 'simple' then avg(x.v) else sum(x.v * x.u) / nullif(sum(x.u), 0) end, 2) into v_gwa
  from (
    select case when v_used = 'percentage' then g.percentage else (public._grading_equivalent_value(g.grade, c.scale_min, c.scale_max, v_letters) ->> 'value')::numeric end as v,
           coalesce(nullif(g.units, 0), 1) as u
    from public.scholar_subjects_grades g
    where g.scholar_id_number = p_scholar and g.school_year = p_year and g.semester = p_term and not coalesce(g.exclude_from_gwa, false)
  ) x
  where x.v is not null;
  return v_gwa;
end;
$$;
revoke all on function public._scholar_gwa_of_period(text, text, text) from public, anon, authenticated;

create or replace function public.counseling_slot_scholar_info(p_slot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  sc public.scholars%rowtype;
  r public.renewal_records%rowtype;
  v_year text;
  v_term text;
  v_gwa numeric;
  v_kind text; v_min numeric; v_max numeric; v_dir text;
begin
  perform public._require_counseling_staff();
  select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() and state <> 'open';
  if not found then raise exception 'That appointment was not found.'; end if;
  select * into sc from public.scholars where scholar_id_number = s.scholar_id_number;
  if not found then raise exception 'The scholar of this appointment was not found.'; end if;

  -- the semester the GWA is of: the one the renewal looks at; with no renewal (a referral), the latest semester that has grades
  if s.record_id is not null then
    select * into r from public.renewal_records where id = s.record_id;
    if found then select b.basis_school_year, b.basis_term into v_year, v_term from public._renewal_basis(r.school_year, r.term) b; end if;
  end if;
  if v_year is null then
    select g.school_year, g.semester into v_year, v_term from public.scholar_subjects_grades g where g.scholar_id_number = sc.scholar_id_number
      order by public._grading_period_rank(g.school_year, g.semester) desc limit 1;
  end if;

  -- 1. the GWA the renewal's last check stored (on the school's own scale)
  if r.id is not null and (r.evaluation ->> 'gwa') ~ '^-?\d+(\.\d+)?$' then v_gwa := (r.evaluation ->> 'gwa')::numeric; end if;
  -- 2. otherwise worked out now from the grades of that semester
  if v_gwa is null then v_gwa := public._scholar_gwa_of_period(sc.scholar_id_number, v_year, v_term); end if;
  -- the scale it is on (for a note such as "1.00 is the best")
  if sc.school_id is not null and to_regprocedure('public._academic_school_scale(uuid)') is not null then
    execute 'select x.kind, x.scale_min, x.scale_max, x.direction from public._academic_school_scale($1) x' into v_kind, v_min, v_max, v_dir using sc.school_id;
  end if;

  return jsonb_build_object(
    'course', nullif(btrim(coalesce(sc.course, '')), ''), 'year_level', nullif(btrim(coalesce(sc.year_level, '')), ''),
    'barangay', nullif(btrim(coalesce(sc.barangay, '')), ''), 'school', nullif(btrim(coalesce(sc.school, '')), ''),
    'gwa', v_gwa, 'gwa_year', v_year, 'gwa_term', v_term,
    'scale_kind', v_kind, 'scale_min', v_min, 'scale_max', v_max, 'scale_direction', v_dir);
end;
$$;
revoke all on function public.counseling_slot_scholar_info(uuid) from public, anon;
grant execute on function public.counseling_slot_scholar_info(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
