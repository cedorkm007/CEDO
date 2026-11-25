-- ─────────────────────────────────────────────────────────────
-- supabase_migration_grading_program_marks_renewal_link.sql
-- GRADING SETUP, A PASSING MARK FOR A PROGRAM — PART 2: THE RENEWAL DECISIONS USE THE PROGRAM.   Safe to run twice.   Undo: undo_grading_program_marks_renewal_link.sql
--   * The renewal decisions (which subjects a scholar failed) judge every grade with the SEMESTER'S rules and the scholar's PROGRAM: supabase_migration_grading_program_marks.sql gives that rule the program's own
--     passing mark, and this file makes the three renewal functions ask it (_renewal_evaluate, _renewal_recheck, _school_renewal_rows).
--   * The same three links were made by the grading rules update (supabase_migration_school_grading_rules_d_functions.sql, step 5). Later renewal updates re-created two of these functions from their older text and
--     took the links out again, so this file puts them back. For a school WITHOUT a conversion table and WITHOUT program marks nothing changes: the answer is the same as before.
--     For a school with a conversion table (set up in the School Portal) the grades are again judged by its table, as that update intended.
--   * Each change is an exact find-and-replace inside the LIVE function. If a live function is not the version this file was written for, the WHOLE file stops and nothing changes (it says which one).
--     Running it twice does nothing the second time. No table and no grade is changed.
-- Needs supabase_migration_grading_program_marks.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._grade_outcome(uuid,text,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_grading_program_marks.sql first.';
  end if;
end $$;

do $patch$
declare
  e record; v_def text; n int;
begin
  for e in select * from (values
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id$o$,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id, r.percentage$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid$o$,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid, null::numeric$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$v_outcome := public._grade_outcome(v_school, g.grade);$o$,
      $o$v_outcome := public._grade_outcome_at(v_school, g.grade, g.percentage, v_b_year, v_b_term, v_scholar.course);$o$),
    ('public._renewal_recheck(uuid)'::regprocedure,
      $o$select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome$o$,
      $o$select public._grade_outcome_at(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade, g.percentage, g.school_year, g.semester, v_scholar.course) into v_outcome$o$),
    ('public._school_renewal_rows(text,text)'::regprocedure,
      $o$select public._grade_outcome(s.school_id, g.grade) as o from public.scholar_subjects_grades g$o$,
      $o$select public._grade_outcome_at(s.school_id, g.grade, g.percentage, v_by, v_bt, s.course) as o from public.scholar_subjects_grades g$o$)
  ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(e.fn);
    if position(e.new_text in v_def) > 0 then continue; end if;
    n := (length(v_def) - length(replace(v_def, e.old_text, ''))) / length(e.old_text);
    if n <> 1 then
      raise exception 'STOPPED, nothing changed: the live function % is not the version this file was written for (found % matches). Tell CEDO''s developer.', e.fn, n;
    end if;
    execute replace(v_def, e.old_text, e.new_text);
  end loop;
end
$patch$;

notify pgrst, 'reload schema';
commit;
