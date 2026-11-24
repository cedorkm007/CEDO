-- undo_renewal_termination_signatory.sql: a Removed endorsement no longer asks who signs the termination form, and the list of termination forms only has the Division Head removals again (as before).
-- Removes the new functions and puts back the two functions that were replaced. The four columns stay (harmless). Nothing is deleted. (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.renewal_removal_form_data(uuid);
drop function if exists public.renewal_termination_signatories();
drop function if exists public.renewal_approve_endorsement(uuid, text, text, text);
create or replace function public.renewal_approve_endorsement(p_record_id uuid, p_note text default '', p_status text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ev jsonb;
  v_docs text;
  v_one_failure boolean;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'endorsed_for_approval' or v_rec.endorsed_status is null then
    raise exception 'This case has no endorsement waiting for your approval (it is "%").', public._renewal_stage_title(v_rec.stage);
  end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  -- ONE failed subject and no earlier probation (rule B): the scholar can be renewed, but ALWAYS sends the study plan and the clearance first; the evaluator may choose Regular or Probationary
  v_one_failure := coalesce(v_rec.rule_code, '') ~ '^B(\+|$)';
  if p_status is not null and p_status is distinct from v_rec.endorsed_status then
    if not (v_one_failure and v_rec.endorsed_status in ('Regular', 'Probationary') and p_status in ('Regular', 'Probationary')) then
      raise exception 'The status can only be changed between Regular and Probationary, for a scholar with one failed subject.';
    end if;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'endorsed_for_approval', 'The evaluator chose ' || p_status || ' (the consultation staff endorsed ' || v_rec.endorsed_status || ').');
    update public.renewal_records set endorsed_status = p_status where id = p_record_id;
    v_rec.endorsed_status := p_status;
  end if;
  if v_rec.endorsed_status = 'Removed' then
    perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Removed by the endorsement of the consultation staff, approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(),
      evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'removed', 'Endorsement approved: Removed. The scholar''s login was switched off.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship was ended',
      'It was decided that your scholarship ends with this renewal (' || v_label || '). Please contact the CEDO office if you have questions.', p_record_id);
  elsif v_rec.endorsed_status in ('Probationary', 'Reconsidered') or (v_rec.endorsed_status = 'Regular' and v_one_failure) then
    -- the status is approved; the scholar now sends the documents (the study plan and the clearance, and the letter from the dean when an INC is open); the renewal is completed when they are approved
    update public.renewal_records set stage = 'awaiting_documents', evaluator_comment = v_note, endorsement_approved_at = now(), endorsement_approved_by = auth.uid(), updated_at = now() where id = p_record_id;
    v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
    if v_ev ? 'error' or (v_ev ->> 'stage') <> 'awaiting_documents' then
      raise exception 'Something changed just now, so the endorsement cannot be approved yet (the case is "%"). Please open the case again.', public._renewal_stage_title(coalesce(v_ev ->> 'stage', 'unknown'));
    end if;
    update public.renewal_records set evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text', updated_at = now() where id = p_record_id;
    select string_agg(d ->> 'label', ', ') into v_docs from jsonb_array_elements(coalesce(v_ev -> 'required_documents', '[]'::jsonb)) d where not coalesce((d ->> 'approved')::boolean, false);
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'awaiting_documents', 'Endorsement approved: ' || v_rec.endorsed_status || '. Waiting for the documents.' || coalesce(' ' || v_note, ''));
    if v_docs is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'Your new scholarship status was approved',
        'You are approved as ' || v_rec.endorsed_status || ' for ' || v_label || '. To complete your renewal, please upload: ' || v_docs || '. The consultation staff will approve them.', p_record_id);
    end if;
    perform public._renewal_finish_endorsed(p_record_id);      -- when everything needed is already approved, the scholar is renewed now
  else
    perform public._renewal_set_status(v_rec.scholar_id_number, v_rec.endorsed_status, false, 'Endorsed by the consultation staff and approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'renewed',
      result = case v_rec.endorsed_status when 'Probationary' then 'renewed_probationary' when 'Reconsidered' then 'reconsidered' else 'renewed' end,
      temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(), evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'renewed', 'Endorsement approved: renewed as ' || v_rec.endorsed_status || '.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
      'You are renewed for ' || v_label || ' with the status ' || v_rec.endorsed_status || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
  end if;
end;
$$;
revoke all on function public.renewal_approve_endorsement(uuid, text, text) from public, anon;
grant execute on function public.renewal_approve_endorsement(uuid, text, text) to authenticated;

drop function if exists public._renewal_termination_options();
drop function if exists public.consult_removal_forms();
create or replace function public.consult_removal_forms()
returns table(referral_id uuid, scholar_id_number text, name text, year_level text, school text, program text, issued_on date, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select f.id, f.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), coalesce(s.year_level, ''), coalesce(s.school, ''), coalesce(s.course, ''),
         case when f.status = 'forwarded_to_division_head' then null else ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date end,
         case f.status when 'forwarded_to_division_head' then 'waiting' when 'division_head_approved' then 'ready' else 'done' end
  from public.scholar_counseling_referrals f
  join public.scholars s on s.scholar_id_number = f.scholar_id_number
  where f.referred_to = auth.uid()
    and ((f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end))
         or (f.status = 'forwarded_to_division_head' and f.endorsed_for = 'Removal'))
  order by s.last_name, s.first_name, f.scholar_id_number;
end;
$$;
revoke all on function public.consult_removal_forms() from public, anon;
grant execute on function public.consult_removal_forms() to authenticated;

notify pgrst, 'reload schema';
commit;
