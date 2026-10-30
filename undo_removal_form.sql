-- UNDO for supabase_migration_removal_form.sql: the termination form can no longer be opened and the scholar is no longer told when a removal is approved. Nothing else changes.
drop function if exists public.consult_removal_forms();
drop function if exists public.removal_forms_mine();
drop function if exists public.removal_form_data(uuid);

create or replace function public.approve_referral(p_referral_id uuid, p_signature_path text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar_id_number text;
  v_to uuid;
  v_name text;
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to approve referrals.';
  end if;
  if exists (select 1 from public.scholar_counseling_referrals where id = p_referral_id and renewal_record_id is not null) then
    raise exception 'This referral belongs to a scholar renewal. Decide it from the renewal case (Approve Probationary, Reconsidered or Removed) so the scholar''s status and renewal stay in step.';
  end if;

  select scholar_id_number, referred_to into v_scholar_id_number, v_to
  from public.scholar_counseling_referrals
  where id = p_referral_id and status = 'forwarded_to_division_head';
  if v_scholar_id_number is null then
    raise exception 'This referral is not awaiting approval.';
  end if;
  if p_signature_path is null or trim(p_signature_path) = '' then
    raise exception 'A signature is required to approve.';
  end if;

  -- The Division Head approves and signs; the scholar's status does NOT change yet. The consulting staff member who consulted the scholar makes the final decision
  -- (consult_finalize_decision) and only then does the status change.
  update public.scholar_counseling_referrals
  set status = 'division_head_approved', signature_path = p_signature_path, approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_referral_id;

  select btrim(s.first_name || ' ' || s.last_name) into v_name from public.scholars s where s.scholar_id_number = v_scholar_id_number;
  if v_to is not null then
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (gen_random_uuid(), 'referral_final', v_to, coalesce(v_name, 'a scholar'), 'Referral approved: your final decision is needed',
      'The Division Head approved and signed the referral of ' || coalesce(v_name, 'a scholar') || '. Open the Consultation tool and proceed with the final decision to change the scholarship status.', now(), false, p_referral_id::text);
  end if;
end;
$function$;

create or replace function public.renewal_division_head_decide(p_record_id uuid, p_decision text, p_signature_path text, p_signatory_name text default '', p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ref public.scholar_counseling_referrals%rowtype;
  v_label text;
  v_name text;
  v_scholar text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_text text;
begin
  if not public.has_staff_tag('sead_division_head') then raise exception 'Only the Division Head can decide this.'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage not in ('endorsed_division_head', 'needs_consultation_division_head') then
    raise exception 'This case is not waiting for the Division Head (it is "%").', public._renewal_stage_title(v_rec.stage);
  end if;
  select * into v_ref from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id and f.status = 'forwarded_to_division_head' for update;
  if not found then raise exception 'This case has not been sent to the Division Head, or it was sent back to the evaluator.'; end if;
  if v_rec.stage = 'endorsed_division_head' and p_decision <> 'approve_probationary' then raise exception 'An endorsed case can only be approved for Probationary or sent back.'; end if;
  if v_rec.stage = 'needs_consultation_division_head' and p_decision not in ('removed', 'reconsidered') then raise exception 'Choose Removed or Reconsidered (or send the case back).'; end if;
  if p_signature_path is null or btrim(p_signature_path) = '' then raise exception 'A signature is required.'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_signatory_name, '')), ''), public._staff_display_name(auth.uid()));
  if char_length(v_name) > 120 then raise exception 'The printed name is too long.'; end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- The Division Head approves and signs; NOTHING changes for the scholar yet. The consulting staff member (who consulted the scholar) makes the final decision with
  -- consult_finalize_decision(), and only then do the scholar's status, the renewal and the scholar's notice change.
  update public.scholar_counseling_referrals set status = 'division_head_approved', signature_path = p_signature_path, signatory_name = v_name,
    approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = v_ref.id;
  update public.renewal_records set division_head_decision = case p_decision when 'approve_probationary' then 'approved_probationary' else p_decision end,
    division_head_decided_at = now(), division_head_decided_by = auth.uid(), division_head_note = v_note, updated_at = now() where id = v_rec.id;
  v_text := case p_decision when 'approve_probationary' then 'Probationary' when 'reconsidered' then 'Reconsidered' else 'Removed' end;
  perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Division Head approved and signed (' || v_text || '). ' || coalesce(public._staff_display_name(v_ref.referred_to), 'The consulting staff member')
    || ' makes the final decision; the scholar''s status has not changed yet.' || coalesce(' ' || v_note, ''));
  select btrim(s.first_name || ' ' || s.last_name) into v_scholar from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  if v_ref.referred_to is not null then
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (gen_random_uuid(), 'referral_final', v_ref.referred_to, coalesce(v_scholar, 'a scholar'), 'Renewal case approved: your final decision is needed',
      'The Division Head approved and signed the renewal case of ' || coalesce(v_scholar, 'a scholar') || ' (' || v_label || ': ' || v_text || '). Open the Consultation tool and proceed with the final decision to change the scholarship status.', now(), false, v_ref.id::text);
  end if;
end;
$$;
revoke all on function public.renewal_division_head_decide(uuid, text, text, text, text) from public, anon;
grant execute on function public.renewal_division_head_decide(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
