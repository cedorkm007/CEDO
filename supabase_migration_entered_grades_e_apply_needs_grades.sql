-- ─────────────────────────────────────────────────────────────
-- SCHOLAR-ENTERED GRADES, FILE E: a scholar cannot apply for renewal (or ask for an SDP reconsideration) without their grades.   Safe to run twice.   Undo: undo_entered_grades_e.sql
-- Run AFTER supabase_migration_entered_grades_d_apply_flow.sql. It replaces two functions only (renewal_apply: the plain form and the form with the grades); no table is changed; nothing is deleted.
--
--   An application is taken only when the scholar's grades are in: uploaded by the school, or entered together with the application (subjects, screenshot and the tick).
--   Without them the database refuses with "Enter your grades first…", whichever screen asks. A returned application sent again is not affected, and a scholar who already
--   applied can still enter their grades later from the renewal page. A reconsideration still needs the grades (file D) and is still approved only when they are complete.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._eg_grades_status(text,text,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_entered_grades_d_apply_flow.sql first.';
  end if;
end $$;

-- The plain application (used by the form with the choice and by the form with the grades): refuses a NEW application while the grades are not in.
create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  w public.renewal_windows%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_rec public.renewal_records%rowtype;
  v_late boolean;
  v_record_id uuid;
  v_basis record;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  if v_scholar.status = 'Removed' then raise exception 'Your scholarship account is not active, so you cannot apply.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if v_today < w.opens_on then raise exception 'This renewal window opens on %.', to_char(w.opens_on, 'FMMonth FMDD, YYYY'); end if;
  v_late := v_today > w.closes_on;
  if v_late and not w.late_allowed then raise exception 'This renewal window has closed and is not accepting late applications.'; end if;
  if btrim(coalesce(p_school, '')) = '' or btrim(coalesce(p_program, '')) = '' or btrim(coalesce(p_year_level, '')) = '' then
    raise exception 'Please confirm your school, program and year level.';
  end if;

  select * into v_rec from public.renewal_records where scholar_id_number = v_id and school_year = w.school_year and term = w.term;
  if found then
    if v_rec.stage = 'returned' then
      return public.renewal_resubmit(v_rec.id, p_note);
    end if;
    raise exception 'You have already applied for % — see your Renewal tile for its progress.', public._renewal_term_label(w.school_year, w.term);
  end if;

  select * into v_basis from public._renewal_basis(w.school_year, w.term);
  -- Grades first: the application is only taken when the grades are in: uploaded by the school, or entered together with the application (renewal_apply with the grades sets the
  -- flag below for the length of its own transaction).
  if public._eg_grades_status(v_id, v_basis.basis_school_year, v_basis.basis_term) <> 'school' and coalesce(current_setting('cedo.apply_grades_ok', true), '') <> 'on' then
    raise exception 'Enter your grades first. You cannot apply for renewal until your grades are entered (or your school has uploaded them).';
  end if;
  insert into public.renewal_records (scholar_id_number, school_year, term, window_id, stage, basis_school_year, basis_term, applied_at, is_late, late_decision,
      confirmed_school, confirmed_program, confirmed_year_level, scholar_note, scholar_note_at)
  values (v_id, w.school_year, w.term, w.id, case when v_late then 'late_pending' else 'submitted' end, v_basis.basis_school_year, v_basis.basis_term, now(),
      v_late, case when v_late then 'pending' end, btrim(p_school), btrim(p_program), btrim(p_year_level),
      left(btrim(coalesce(p_note, '')), 1000), case when btrim(coalesce(p_note, '')) <> '' then now() end)
  returning id into v_record_id;

  perform public._renewal_log(v_record_id, null, case when v_late then 'late_pending' else 'submitted' end,
    case when v_late then 'Applied after the window closed — waiting for the evaluator to accept.' else 'Application submitted.' end, 'Scholar');
  perform public._notify_scholar(v_id, 'application_received', 'We received your renewal application',
    case when v_late then 'Your application for ' || public._renewal_term_label(w.school_year, w.term) || ' came after the window closed, so the evaluator needs to accept it first.'
         else 'We are checking your SDP and grades for ' || public._renewal_term_label(w.school_year, w.term) || '.' end, v_record_id);
  if not v_late then perform public._renewal_recheck(v_record_id); end if;
  return v_record_id;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text) to authenticated;

-- The application with the grades: when grades are entered, they are what lets the application in (the plain application above looks at a flag set for this one transaction).
create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text, p_request_sdp_reconsideration boolean,
                                                p_grade_lines jsonb, p_grade_files jsonb, p_grade_ack boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  w public.renewal_windows%rowtype;
  v_record uuid;
  v_entering boolean := jsonb_typeof(coalesce(p_grade_lines, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_grade_lines, '[]'::jsonb)) > 0;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if (v_entering or coalesce(p_request_sdp_reconsideration, false))
     and exists (select 1 from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term) then
    raise exception 'You can enter your grades or ask for an SDP reconsideration together with the application only when you first apply. After that, use your renewal page.';
  end if;
  if v_entering then perform set_config('cedo.apply_grades_ok', 'on', true); end if;      -- the grades are saved right below, in this same transaction
  v_record := public.renewal_apply(p_window_id, p_school, p_program, p_year_level, p_note);
  perform set_config('cedo.apply_grades_ok', '', true);
  if v_entering then
    perform public._eg_save(v_record, p_grade_lines, p_grade_files, p_grade_ack, v_id || '/' || p_window_id::text || '/grade-entries/');
  end if;
  if coalesce(p_request_sdp_reconsideration, false) then
    perform public._renewal_sdp_request_create(v_record);
  end if;
  perform public._renewal_recheck(v_record);
  return v_record;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
