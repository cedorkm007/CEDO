-- undo_grading_program_marks_other_checks.sql: the temporary-probation follow-up, the tagging and the application check judge grades with the school's passing mark only again (the way they were before part 3).
-- Same safety as the update: each change is an exact find-and-replace inside the live function; if one differs the whole file stops and nothing changes. No table, grade or scholar's status is touched.
-- (Run this BEFORE undo_grading_program_marks.sql if you are undoing everything.)
begin;

do $patch$
declare
  e record; v_def text; n int;
begin
  for e in select * from (values
    ('public._renewal_tag_followup(uuid)'::regprocedure,
      $o$select public._grade_outcome_at(coalesce(g.recorded_by_school_id, v_school), g.grade, g.percentage, g.school_year, g.semester, (select sc.course from public.scholars sc where sc.scholar_id_number = r.scholar_id_number)) into v_out$o$,
      $o$select public._grade_outcome(coalesce(g.recorded_by_school_id, v_school), g.grade) into v_out$o$,
      1),
    ('public.renewal_tag_temp_probation(uuid,text,integer)'::regprocedure,
      $o$case public._grade_outcome_at(s.school_id, l.grade, null::numeric, r.basis_school_year, r.basis_term, s.course)$o$,
      $o$case public._grade_outcome(s.school_id, l.grade)$o$,
      1),
    ('public.renewal_apply(uuid,text,text,text,text,boolean,jsonb,jsonb,boolean,jsonb)'::regprocedure,
      $o$public._grade_outcome(v_scholar.school_id, l ->> 'grade', v_scholar.course)$o$,
      $o$public._grade_outcome(v_scholar.school_id, l ->> 'grade')$o$,
      2)
  ) as t(fn, current_text, restore_text, times)
  loop
    v_def := pg_get_functiondef(e.fn);
    if position(e.current_text in v_def) = 0 then continue; end if;      -- already as before
    n := (length(v_def) - length(replace(v_def, e.current_text, ''))) / length(e.current_text);
    if n <> e.times then
      raise exception 'STOPPED, nothing changed: the live function % is not the version this file expects (found % matches, expected %). Tell CEDO''s developer.', e.fn, n, e.times;
    end if;
    execute replace(v_def, e.current_text, e.restore_text);
  end loop;
end
$patch$;

notify pgrst, 'reload schema';
commit;
