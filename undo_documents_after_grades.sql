-- ─────────────────────────────────────────────────────────────
-- undo_documents_after_grades.sql
-- Puts the old rule back: an application with an INC or a failed subject is refused without the three documents.
-- ─────────────────────────────────────────────────────────────

begin;

create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text, p_request_sdp_reconsideration boolean,
                                                p_grade_lines jsonb, p_grade_files jsonb, p_grade_ack boolean, p_inc_documents jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  w public.renewal_windows%rowtype;
  v_scholar public.scholars%rowtype;
  v_docs jsonb := case when jsonb_typeof(coalesce(p_inc_documents, '[]'::jsonb)) = 'array' then coalesce(p_inc_documents, '[]'::jsonb) else '[]'::jsonb end;
  v_lines jsonb := case when jsonb_typeof(coalesce(p_grade_lines, '[]'::jsonb)) = 'array' then coalesce(p_grade_lines, '[]'::jsonb) else '[]'::jsonb end;
  v_inc boolean := false;
  v_failed boolean := false;
  v_ev jsonb;
  v_record uuid;
  l jsonb;
  d jsonb;
  k text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;

  -- Does this application carry an INC or a failed subject? An entered grade that is an INC, a failed grade or a DRP, or an open INC / a failed subject in the grades the school uploaded.
  for l in select * from jsonb_array_elements(v_lines) loop
    if public._grade_outcome(v_scholar.school_id, l ->> 'grade') = 'inc' then v_inc := true;
    elsif public._grade_outcome(v_scholar.school_id, l ->> 'grade') in ('failed', 'drp') then v_failed := true; end if;
  end loop;
  if not v_inc and not v_failed then
    v_ev := public._renewal_evaluate(v_id, w.school_year, w.term);
    if not (v_ev ? 'error') then
      if coalesce((v_ev ->> 'open_inc')::integer, 0) > 0 then v_inc := true;
      elsif coalesce((v_ev ->> 'failed_effective')::integer, 0) > 0 then v_failed := true; end if;
    end if;
  end if;

  -- A scholar with an INC or a failed subject cannot submit without the three documents (letter from the dean, study plan, clearance); the evaluator approves them afterwards.
  if v_inc or v_failed then
    foreach k in array array['inc_letter', 'study_plan', 'clearance'] loop
      if not exists (select 1 from jsonb_array_elements(v_docs) x where x ->> 'kind' = k) then
        raise exception '% so you cannot submit without uploading your letter from your dean, your study plan and your clearance.', case when v_inc then 'You have an INC,' else 'You have a failed subject,' end;
      end if;
    end loop;
  elsif jsonb_array_length(v_docs) > 0 then
    raise exception 'No INC or failed subject was found in your grades, so these documents are not needed. Submit without them.';
  end if;
  for d in select * from jsonb_array_elements(v_docs) loop
    if d ->> 'kind' not in ('inc_letter', 'study_plan', 'clearance') or coalesce(d ->> 'path', '') = '' or coalesce(d ->> 'name', '') = '' or coalesce(d ->> 'mime', '') = '' then
      raise exception 'One of the documents is not complete. Please upload it again.';
    end if;
  end loop;

  v_record := public.renewal_apply(p_window_id, p_school, p_program, p_year_level, p_note, p_request_sdp_reconsideration, p_grade_lines, p_grade_files, p_grade_ack);

  if jsonb_array_length(v_docs) > 0 then
    perform set_config('cedo.apply_docs_ok', 'on', true);
    for d in select * from jsonb_array_elements(v_docs) loop
      insert into public.renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
      values (v_record, v_id, d ->> 'kind', d ->> 'path', left(d ->> 'name', 200), d ->> 'mime', coalesce((d ->> 'size')::bigint, 0));
    end loop;
    perform set_config('cedo.apply_docs_ok', '', true);
    perform public._renewal_log(v_record, null, (select stage from public.renewal_records where id = v_record), 'The scholar sent the letter from the dean, the study plan and the clearance with the application.', 'Scholar');
  end if;
  return v_record;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean, jsonb) to authenticated;

commit;
