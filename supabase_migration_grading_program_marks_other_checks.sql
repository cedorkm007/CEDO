-- ─────────────────────────────────────────────────────────────
-- supabase_migration_grading_program_marks_other_checks.sql
-- GRADING SETUP, A PASSING MARK FOR A PROGRAM — PART 3: THE OTHER RENEWAL CHECKS USE THE PROGRAM TOO.   Safe to run twice.   Undo: undo_grading_program_marks_other_checks.sql
--   Three places still judged a grade with the school's passing mark only. They now use the scholar's program, like the renewal decision itself (parts 1 and 2):
--   * TEMPORARY PROBATION FOLLOW-UP (_renewal_tag_followup): when the school later gives the grade of an INC or missing subject, it counts as passed or failed by the program's mark.
--   * TAGGING AS TEMPORARY PROBATIONARY (renewal_tag_temp_probation): a scholar with a subject that fails the program's mark can no longer be tagged.
--   * THE APPLICATION CHECK (renewal_apply): the typed grades are read with the program's mark.
--   For a school without program marks and without a conversion table nothing changes. (A school with a conversion table is judged by its table in the first two, as the renewal decision already is.)
--   Each change is an exact find-and-replace inside the LIVE function. If a live function is not the version this file was written for, the WHOLE file stops and nothing changes (it says which one).
--   No table, no grade and no scholar's status is changed by running it.
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
    ('public._renewal_tag_followup(uuid)'::regprocedure,
      $o$select public._grade_outcome(coalesce(g.recorded_by_school_id, v_school), g.grade) into v_out$o$,
      $o$select public._grade_outcome_at(coalesce(g.recorded_by_school_id, v_school), g.grade, g.percentage, g.school_year, g.semester, (select sc.course from public.scholars sc where sc.scholar_id_number = r.scholar_id_number)) into v_out$o$,
      1),
    ('public.renewal_tag_temp_probation(uuid,text,integer)'::regprocedure,
      $o$case public._grade_outcome(s.school_id, l.grade)$o$,
      $o$case public._grade_outcome_at(s.school_id, l.grade, null::numeric, r.basis_school_year, r.basis_term, s.course)$o$,
      1),
    ('public.renewal_apply(uuid,text,text,text,text,boolean,jsonb,jsonb,boolean,jsonb)'::regprocedure,
      $o$public._grade_outcome(v_scholar.school_id, l ->> 'grade')$o$,
      $o$public._grade_outcome(v_scholar.school_id, l ->> 'grade', v_scholar.course)$o$,
      2)
  ) as t(fn, old_text, new_text, times)
  loop
    v_def := pg_get_functiondef(e.fn);
    if position(e.new_text in v_def) > 0 then continue; end if;
    n := (length(v_def) - length(replace(v_def, e.old_text, ''))) / length(e.old_text);
    if n <> e.times then
      raise exception 'STOPPED, nothing changed: the live function % is not the version this file was written for (found % matches, expected %). Tell CEDO''s developer.', e.fn, n, e.times;
    end if;
    execute replace(v_def, e.old_text, e.new_text);
  end loop;
end
$patch$;

notify pgrst, 'reload schema';
commit;
