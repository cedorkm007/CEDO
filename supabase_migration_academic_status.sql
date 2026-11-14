-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_status.sql
-- ACADEMIC STATUS OF A PROGRAM, THE PASSING GWA, AND THE CONSULTATION IN THE RENEWAL.   Safe to run twice.   Undo: undo_academic_status.sql
--   * Every program is Academic or Non-academic (set by the staff in Scholar Management Tools > Scholars > "Grades and Academic Management"). A scholar's academic status comes from the program.
--   * The tab sets the passing GWA of Academic and of Non-academic (the standard scale: 1.00 best to 5.00) and, for SPECIAL programs, a passing GWA of their own (higher or lower).
--   * Renewal: a scholar whose GWA (the semester the renewal looks at) is WORSE than the passing GWA of their program group needs a consultation, also with no failed subject; after the
--     consultation the evaluator confirms the renewal. The rule of the failed subjects, INC and DRP stays as it is. A program not placed yet counts as Academic; no passing GWA set = the rule is off.
--   * Only a school on the standard scale (1.0 to 5.0, lower is better) can be compared; the other schools are listed in the tab.
--   * A GWA below the passing GWA does NOT change the scholar's status by itself (only the consultation).
-- Needs the failures-no-letter, temporary probation and refer files. Adds three tables and a new stage ("Needs a consultation (GWA below the passing GWA)"). Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_evaluate(text,text,text)') is null or position('temp_tag' in pg_get_functiondef(to_regprocedure('public._renewal_evaluate(text,text,text)'))) = 0
     or to_regprocedure('public._grading_equivalent_value(text,numeric,numeric,jsonb)') is null or to_regprocedure('public.renewal_tag_followup_all()') is null then
    raise exception 'STOPPED, nothing changed: run the earlier renewal and school grading SQL files first (temporary probation, failures without the letter, school grading rules).';
  end if;
end $$;

alter table public.renewal_records drop constraint if exists renewal_records_stage_check;
alter table public.renewal_records add constraint renewal_records_stage_check check (stage in (
    'submitted', 'late_pending', 'late_declined', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation',
    'ready_to_endorse', 'endorsed_division_head', 'needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements',
    'returned', 'renewed', 'removed', 'reconsidered', 'division_head_approved', 'not_required', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_gwa_consultation'));

-- 1. The programs and their academic status, the passing GWAs, and a record of every change.
create table if not exists public.academic_programs (
  program_key        text primary key,
  program            text not null,
  academic_status    text not null check (academic_status in ('academic', 'non_academic')),
  -- a SPECIAL program: its own passing GWA (1.0 to 5.0, lower is better) instead of the group's
  special_passing_gwa numeric check (special_passing_gwa is null or (special_passing_gwa >= 1 and special_passing_gwa <= 5)),
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
create table if not exists public.academic_gwa_settings (
  id                      boolean primary key default true check (id),
  academic_passing_gwa    numeric check (academic_passing_gwa is null or (academic_passing_gwa >= 1 and academic_passing_gwa <= 5)),
  non_academic_passing_gwa numeric check (non_academic_passing_gwa is null or (non_academic_passing_gwa >= 1 and non_academic_passing_gwa <= 5)),
  version                 integer not null default 1,
  updated_by              uuid,
  updated_at              timestamptz not null default now()
);
insert into public.academic_gwa_settings (id) values (true) on conflict (id) do nothing;
create table if not exists public.academic_settings_audit (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  by_label text not null default '',
  what     text not null
);
alter table public.academic_programs enable row level security;
alter table public.academic_gwa_settings enable row level security;
alter table public.academic_settings_audit enable row level security;
revoke all on table public.academic_programs, public.academic_gwa_settings, public.academic_settings_audit from public, anon, authenticated;

-- A program written in different ways ("BS Nursing", " bs  nursing ") is one program.
create or replace function public._program_key(p text)
returns text
language sql
immutable
as $$ select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')); $$;

-- 2. The academic status and the passing GWA of a scholar. A program that is not placed yet counts as ACADEMIC (and is flagged in the tab). null = no passing GWA is set.
create or replace function public._scholar_academic(p_scholar text)
returns table(academic_status text, is_set boolean, passing_gwa numeric, special boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(ap.academic_status, 'academic'), ap.program_key is not null,
         coalesce(ap.special_passing_gwa, case coalesce(ap.academic_status, 'academic') when 'non_academic' then g.non_academic_passing_gwa else g.academic_passing_gwa end),
         ap.special_passing_gwa is not null
  from public.scholars s
  cross join public.academic_gwa_settings g
  left join public.academic_programs ap on ap.program_key = public._program_key(s.course)
  where s.scholar_id_number = p_scholar;
$$;
revoke all on function public._scholar_academic(text) from public, anon, authenticated;

create or replace function public._scholar_passing_gwa(p_scholar text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$ select a.passing_gwa from public._scholar_academic(p_scholar) a; $$;
revoke all on function public._scholar_passing_gwa(text) from public, anon, authenticated;

-- 3. The GWA of the semester a renewal looks at, on the STANDARD scale (1.0 best to 5.0, lower is better): weighted by units, the subjects excluded from the GWA left out, a subject with no units counts as 1.
--    Only a school whose own scale IS the standard one can be compared (a school on another scale gives null here: the tab lists those schools). p_self_id: the entered grades the scholar's renewal uses (null = the school's grades).
create or replace function public._scholar_gwa_standard(p_scholar text, p_year text, p_term text, p_self_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid;
  c public.school_grading_configs%rowtype;
  v_letters jsonb;
  v_gwa numeric;
begin
  select s.school_id into v_school from public.scholars s where s.scholar_id_number = p_scholar;
  if v_school is null then return null; end if;
  select * into c from public.school_grading_configs where school_id = v_school;
  if not found or c.scale_min <> 1 or c.scale_max <> 5 or c.direction <> 'lower_is_better' then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('letter', l.letter, 'numericValue', l.numeric_value)), '[]'::jsonb) into v_letters from public.school_letter_grades l where l.school_id = v_school;
  select round(sum(x.v * x.u) / nullif(sum(x.u), 0), 2) into v_gwa
  from (
    select (public._grading_equivalent_value(g.grade, c.scale_min, c.scale_max, v_letters) ->> 'value')::numeric as v, coalesce(nullif(g.units, 0), 1) as u
    from public.scholar_subjects_grades g
    where p_self_id is null and g.scholar_id_number = p_scholar and g.school_year = p_year and g.semester = p_term and not coalesce(g.exclude_from_gwa, false)
    union all
    select (public._grading_equivalent_value(l.grade, c.scale_min, c.scale_max, v_letters) ->> 'value')::numeric, coalesce(nullif(l.units, 0), 1)
    from public.renewal_self_grade_lines l
    where p_self_id is not null and l.submission_id = p_self_id
  ) x
  where x.v is not null;
  return v_gwa;
end;
$$;
revoke all on function public._scholar_gwa_standard(text, text, text, uuid) from public, anon, authenticated;


-- 4. The tab "Grades and Academic Management" (Scholar Management Tools > Scholars): who may use it = the accounts with the Scholar Management tag.
create or replace function public._academic_require_manager()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('scholar_management') or public.is_sead_staff()) then raise exception 'Only Scholar Management staff can use this.'; end if;
end;
$$;
revoke all on function public._academic_require_manager() from public, anon, authenticated;

create or replace function public.academic_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.academic_gwa_settings%rowtype;
begin
  perform public._academic_require_manager();
  select * into g from public.academic_gwa_settings where id;
  return jsonb_build_object(
    'academic_passing_gwa', g.academic_passing_gwa, 'non_academic_passing_gwa', g.non_academic_passing_gwa, 'updated_at', g.updated_at,
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.k, 'program', p.name, 'scholars', p.n, 'academic_status', ap.academic_status, 'special_passing_gwa', ap.special_passing_gwa, 'is_set', ap.program_key is not null) order by p.name)
      from (
        select public._program_key(s.course) as k, (array_agg(btrim(s.course) order by length(btrim(s.course)) desc))[1] as name, count(*)::int as n
        from public.scholars s where nullif(btrim(coalesce(s.course, '')), '') is not null and s.status not in ('Removed')
        group by public._program_key(s.course)
      ) p
      left join public.academic_programs ap on ap.program_key = p.k), '[]'::jsonb),
    'schools_not_standard', coalesce((
      select jsonb_agg(jsonb_build_object('school', sc.name, 'scholars', n.c, 'scale', coalesce(cf.scale_min::text || ' to ' || cf.scale_max::text || ', ' || replace(cf.direction, '_', ' '), 'no grading setup')) order by sc.name)
      from public.schools sc
      left join public.school_grading_configs cf on cf.school_id = sc.id
      join lateral (select count(*)::int as c from public.scholars s where s.school_id = sc.id and s.status not in ('Removed')) n on n.c > 0
      where cf.school_id is null or cf.scale_min <> 1 or cf.scale_max <> 5 or cf.direction <> 'lower_is_better'), '[]'::jsonb));
end;
$$;
revoke all on function public.academic_settings_get() from public, anon;
grant execute on function public.academic_settings_get() to authenticated;

create or replace function public.academic_settings_save(p_academic numeric, p_non_academic numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  if (p_academic is not null and (p_academic < 1 or p_academic > 5)) or (p_non_academic is not null and (p_non_academic < 1 or p_non_academic > 5)) then
    raise exception 'A passing GWA is a number from 1.00 to 5.00 (1.00 is the best).';
  end if;
  update public.academic_gwa_settings set academic_passing_gwa = p_academic, non_academic_passing_gwa = p_non_academic, version = version + 1, updated_by = auth.uid(), updated_at = now() where id;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Passing GWA: Academic ' || coalesce(to_char(p_academic, 'FM0.00'), 'not set') || ', Non-academic ' || coalesce(to_char(p_non_academic, 'FM0.00'), 'not set'));
end;
$$;
revoke all on function public.academic_settings_save(numeric, numeric) from public, anon;
grant execute on function public.academic_settings_save(numeric, numeric) to authenticated;

-- p_status: 'academic' | 'non_academic' | null (take the program out: it is "not set" again). p_special: the program's own passing GWA, or null.
create or replace function public.academic_program_save(p_program text, p_status text, p_special numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public._program_key(p_program);
begin
  perform public._academic_require_manager();
  if v_key = '' then raise exception 'Choose a program.'; end if;
  if p_status is not null and p_status not in ('academic', 'non_academic') then raise exception 'The academic status is Academic or Non-academic.'; end if;
  if p_special is not null and (p_special < 1 or p_special > 5) then raise exception 'A passing GWA is a number from 1.00 to 5.00 (1.00 is the best).'; end if;
  if p_status is null then
    delete from public.academic_programs where program_key = v_key;
  else
    insert into public.academic_programs (program_key, program, academic_status, special_passing_gwa, updated_by, updated_at)
    values (v_key, btrim(p_program), p_status, p_special, auth.uid(), now())
    on conflict (program_key) do update set program = excluded.program, academic_status = excluded.academic_status, special_passing_gwa = excluded.special_passing_gwa, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Program ' || btrim(p_program) || ': ' || coalesce(case p_status when 'academic' then 'Academic' else 'Non-academic' end, 'not set') || coalesce(', own passing GWA ' || to_char(p_special, 'FM0.00'), ''));
end;
$$;
revoke all on function public.academic_program_save(text, text, numeric) from public, anon;
grant execute on function public.academic_program_save(text, text, numeric) to authenticated;

-- The academic status of every program, for the Information list of the scholars (any staff who reads the scholars).
create or replace function public.academic_status_map()
returns table(program_key text, academic_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_cedo_staff() then raise exception 'Not authorized.'; end if;
  return query select ap.program_key, ap.academic_status from public.academic_programs ap;
end;
$$;
revoke all on function public.academic_status_map() from public, anon;
grant execute on function public.academic_status_map() to authenticated;

-- When the passing GWAs or the programs change, the open renewals are checked again, a few at a time (by the 5-minute job that already exists), not all at once.
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


create or replace function public._renewal_is_active_stage(p_stage text)
returns boolean
language sql
immutable
as $$
  select p_stage in ('submitted', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation', 'ready_to_endorse', 'ready_for_endorsement',
    'needs_study_plan_consultation', 'needs_gwa_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements');
$$;
revoke all on function public._renewal_is_active_stage(text) from public, anon, authenticated;
create or replace function public._renewal_stage_title(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'submitted' then 'Application submitted'
    when 'late_pending' then 'Late — needs evaluator acceptance'
    when 'late_declined' then 'Late application declined'
    when 'sdp_on_hold' then 'On hold — SDP not complied'
    when 'waiting_grades' then 'Waiting for grades'
    when 'review_needed' then 'Needs evaluator review'
    when 'ready_for_confirmation' then 'Ready for evaluator confirmation'
    when 'ready_to_endorse' then 'Ready to endorse to the Division Head'
    when 'needs_gwa_consultation' then 'Needs a consultation (GWA below the passing GWA)'
    when 'ready_for_endorsement' then 'Ready for the consultation staff to endorse'
    when 'endorsed_for_approval' then 'Endorsed — waiting for the evaluator''s approval'
    when 'endorsed_division_head' then 'Endorsed — waiting for the Division Head'
    when 'needs_study_plan_consultation' then 'Needs study plan and consultation'
    when 'needs_consultation_division_head' then 'Needs consultation and Division Head decision'
    when 'needs_inc_letter_consultation' then 'Needs INC letter and consultation'
    when 'inc_waiting_compliance' then 'Temporary probation — waiting for INC compliance'
    when 'inc_deadline_passed' then 'INC deadline passed — decision needed'
    when 'summer_requirements' then 'Summer: prospectus and consultation needed'
    when 'returned' then 'Returned with comments'
    when 'renewed' then 'Renewed'
    when 'removed' then 'Removed'
    when 'reconsidered' then 'Reconsidered'
    when 'division_head_approved' then 'Approved by the Division Head'
    when 'not_required' then 'Not required this term'
    else p_stage end;
$$;
revoke all on function public._renewal_stage_title(text) from public, anon, authenticated;
create or replace function public._renewal_consult_state(p_record_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  select * into r from public.renewal_records where id = p_record_id;
  if not found or r.consultation_done_at is not null
     or r.stage not in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements', 'needs_gwa_consultation') then
    return 'not_needed';
  end if;
  -- the consultation is booked FIRST: the documents are approved by the consultation staff afterwards (they are needed before the endorsement, not before the booking)
  return 'ok';
end;
$$;
revoke all on function public._renewal_consult_state(uuid) from public, anon, authenticated;
create or replace function public._renewal_can_refer(r public.renewal_records)
returns boolean
language sql
stable
as $$
  select r.consultation_done_at is null
     and r.stage not in ('renewed', 'removed', 'late_declined', 'returned', 'ready_for_endorsement', 'endorsed_for_approval')
     and (coalesce((r.evaluation ->> 'failed_effective')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'drp')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0
          or coalesce((r.evaluation ->> 'open_inc')::integer, 0) > 0
          or r.stage = 'needs_gwa_consultation');
$$;
revoke all on function public._renewal_can_refer(public.renewal_records) from public, anon, authenticated;

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
  -- the academic status of the program sets a passing GWA (1.0 to 5.0, lower is better); a GWA worse than it needs a consultation (also with no failed subject)
  if v_state = 'ready' and not v_summer then
    v_pass := public._scholar_passing_gwa(p_scholar_id_number);
    v_gwa := public._scholar_gwa_standard(p_scholar_id_number, v_b_year, v_b_term, case when v_use_self then v_self.id else null end);
    v_low_gwa := v_pass is not null and v_gwa is not null and v_gwa > v_pass;
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
create or replace function public._renewal_recheck(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_old_stage text;
  v_new_stage text;
  v_term_label text;
  v_item jsonb;
  v_state text;
  v_outcome text;
  v_old_docs text[];
  v_new_docs text[];
  v_doc text;
  v_labels text;
  v_inc_open integer;
  v_scholar public.scholars%rowtype;
  v_auto boolean := false;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or not public._renewal_is_active_stage(v_rec.stage) then return; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_rec.scholar_id_number;

  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' then return; end if;
  v_old_stage := v_rec.stage;
  v_new_stage := v_ev ->> 'stage';
  -- a scholar the IT admin's team tagged for automatic renewal (this term, not Summer) who reaches "ready for confirmation" is renewed by the system: see below
  v_auto := v_new_stage = 'ready_for_confirmation' and v_rec.term <> 'Summer'
    and v_rec.temp_tag_at is null
    and exists (select 1 from public.renewal_tagged_scholars t where t.scholar_id_number = v_rec.scholar_id_number and t.school_year = v_rec.school_year and t.term = v_rec.term);
  v_term_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- INC items: one per INC subject; settled when the school enters the completed grade.
  for v_item in select * from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') loop
    insert into public.renewal_inc_items (record_id, scholar_id_number, subject_code, subject, kind)
    values (v_rec.id, v_rec.scholar_id_number, v_item ->> 'code', v_item ->> 'subject', coalesce(v_item ->> 'kind', 'inc'))
    on conflict (record_id, subject_code) do nothing;
  end loop;
  for v_item in
    select jsonb_build_object('id', i.id, 'code', i.subject_code) from public.renewal_inc_items i
    where i.record_id = v_rec.id and i.state = 'open'
      and not exists (select 1 from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') s where s ->> 'code' = i.subject_code)
  loop
    select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome
    from public.scholar_subjects_grades g
    where g.scholar_id_number = v_rec.scholar_id_number and g.school_year = v_ev ->> 'basis_school_year'
      and g.semester = v_ev ->> 'basis_term' and g.subject_code = v_item ->> 'code'
    order by g.updated_at desc limit 1;
    v_state := case v_outcome when 'passed' then 'resolved_passed' when 'failed' then 'resolved_failed' when 'drp' then 'resolved_failed' else null end;
    if v_state is not null then
      update public.renewal_inc_items set state = v_state, updated_at = now() where id = (v_item ->> 'id')::uuid;
      perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage,
        'INC in ' || (v_item ->> 'code') || ' resolved with a ' || case when v_state = 'resolved_passed' then 'passing' else 'failing' end || ' grade.', 'System');
    end if;
  end loop;

  -- Temporary probation while an INC is open; lifted when none is left open.
  select count(*) into v_inc_open from public.renewal_inc_items i where i.record_id = v_rec.id and i.state = 'open';
  -- (a scholar tagged by the Grades Approver is put on temporary probation when the renewal is CONFIRMED, not now)
  if v_inc_open > 0 and not v_rec.temp_probation and v_rec.temp_tag_at is null and v_scholar.status in ('Regular', 'Reconsidered') and v_new_stage <> 'sdp_on_hold' and v_new_stage <> 'waiting_grades' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', true, 'Temporary probation while an INC is open (renewal ' || v_term_label || ').');
    update public.renewal_records set temp_probation = true, temp_previous_status = v_scholar.status where id = v_rec.id;
    v_rec.temp_probation := true; v_rec.temp_previous_status := v_scholar.status;
  elsif v_inc_open = 0 and v_rec.temp_probation then
    if exists (select 1 from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number and s.status = 'Probationary') then
      perform public._renewal_set_status(v_rec.scholar_id_number, coalesce(v_rec.temp_previous_status, 'Regular'), false, 'Temporary INC probation lifted (renewal ' || v_term_label || ').');
    end if;
    update public.renewal_records set temp_probation = false where id = v_rec.id;
    v_rec.temp_probation := false;
  end if;

  update public.renewal_records set
    stage = v_new_stage, evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text',
    basis_school_year = v_ev ->> 'basis_school_year', basis_term = v_ev ->> 'basis_term',
    consultation_required = coalesce((v_ev ->> 'consultation_required')::boolean, false), updated_at = now()
  where id = v_rec.id;

  if v_new_stage is distinct from v_old_stage then
    perform public._renewal_log(v_rec.id, v_old_stage, v_new_stage,
      case v_new_stage
        when 'sdp_on_hold' then 'On hold: ' || coalesce(v_ev ->> 'reason', '')
        when 'waiting_grades' then v_ev ->> 'reason'
        when 'review_needed' then v_ev ->> 'reason'
        else coalesce(v_ev ->> 'rule_text', '') end, 'System');
    if v_new_stage = 'sdp_on_hold' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Your renewal is on hold',
        'Your SDP credits for ' || public._renewal_term_label(v_ev ->> 'basis_school_year', v_ev ->> 'basis_term') || ' are not complete yet: ' || coalesce(v_ev ->> 'reason', '') || '. We will check again automatically when new credits are recorded.', v_rec.id);
    elsif v_new_stage = 'waiting_grades' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Waiting for your grades',
        coalesce(v_ev ->> 'reason', '') || ' We will check again automatically when they are submitted.', v_rec.id);
    elsif v_new_stage in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements', 'needs_gwa_consultation') then
      perform public._notify_scholar(v_rec.scholar_id_number, 'consultation_needed', 'A consultation is needed for your renewal',
        'Please see what is needed in your Renewal tile. ' || coalesce(v_ev ->> 'rule_text', ''), v_rec.id);
    elsif v_new_stage = 'ready_for_endorsement' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your consultation and documents are complete',
        'The consultation staff will now endorse your new scholarship status, and the evaluator will approve it. We will tell you the result.', v_rec.id);
      perform public._notify_consultation_staff('Ready to endorse', coalesce((select btrim(s.first_name || ' ' || s.last_name) from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number), 'A scholar') || ' attended the consultation and the three documents are approved. Open the Consultation Tool, Renewal Cases tab, to endorse the new scholarship status.', v_rec.id, v_rec.scholar_id_number);
    elsif v_new_stage = 'ready_to_endorse' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will review your case and send it to the Division Head for approval.', v_rec.id);
    elsif v_new_stage = 'ready_for_confirmation' and v_old_stage <> 'submitted' and not v_auto then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will confirm your renewal for ' || v_term_label || '.', v_rec.id);
    elsif v_new_stage = 'inc_deadline_passed' then
      null;
    end if;
  end if;

  -- A new document became necessary after the scholar had already applied.
  if v_rec.evaluation <> '{}'::jsonb then
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_old_docs from jsonb_array_elements(v_rec.evaluation -> 'required_documents') d;
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_new_docs from jsonb_array_elements(v_ev -> 'required_documents') d;
    v_labels := null;
    foreach v_doc in array v_new_docs loop
      if not (v_doc = any (v_old_docs)) then
        v_labels := concat_ws(', ', v_labels, (select d ->> 'label' from jsonb_array_elements(v_ev -> 'required_documents') d where d ->> 'kind' = v_doc limit 1));
      end if;
    end loop;
    if v_labels is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'A new document is needed', 'Please upload: ' || v_labels || '.', v_rec.id);
    end if;
  end if;

  if v_auto then
    perform public._renewal_auto_confirm(v_rec.id);
  end if;
end;
$$;
revoke all on function public._renewal_recheck(uuid) from public, anon, authenticated;
create or replace function public.renewal_run_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._academic_recheck_batch(60);      -- the academic settings changed: the open renewals are checked again, 60 at a time
  perform public.renewal_tag_followup_all();      -- temporary probation: grades that arrived, days that ran out
  return public.renewal_scheduled_jobs() || public.renewal_notification_jobs();
end;
$$;
revoke all on function public.renewal_run_scheduled_jobs() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
