-- ─────────────────────────────────────────────────────────────
-- FINAL DECISION BY THE CONSULTING STAFF, FILE B: the functions.   Safe to run twice.   Undo: undo_final_decision_b.sql
-- Run AFTER supabase_migration_final_decision_a_referral_columns.sql (and the Scholar Renewal, referral and consultation files).
--
--   THE PROCESS NOW (for the consultation referrals and the renewal cases)
--     1. The consulting staff member (tagged for the Consultation tool) who consulted the scholar endorses the case to the Division Head (as before).
--     2. The Division Head approves it and attaches the signature (as before), but the scholar's status does NOT change yet.
--     3. The consulting staff member is notified. They open the Consultation tool and press "Proceed with the final decision": only now does the scholarship status
--        change (and, for a renewal case, the renewal moves on: Probationary and Reconsidered wait for the evaluator's confirmation as before; Removed switches the login off).
--   Only the staff member who consulted that scholar (the one the case is assigned to) can make the final decision. If nobody consulted the scholar, the case is assigned to
--   the evaluator who sent it, who then makes the final decision.
-- Adds two functions and replaces four (the originals are in the undo file). No table is changed here. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scholar_counseling_referrals' and column_name = 'finalized_at') then
    raise exception 'STOPPED, nothing changed: run supabase_migration_final_decision_a_referral_columns.sql first.';
  end if;
  if to_regprocedure('public._renewal_forward_to_division_head(uuid,text,boolean)') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Renewal files first (supabase_migration_renewal_p5_approvals.sql).';
  end if;
end $$;

-- ── 1. The consulting staff's list: cases the Division Head approved, waiting for their final decision ──
create or replace function public.consult_final_decisions()
returns table(referral_id uuid, record_id uuid, scholar_id_number text, name text, course text, year_level text, school text, decision_label text, signed_by text, approved_at timestamptz, term_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select f.id, f.renewal_record_id, f.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), s.course, s.year_level, s.school,
         case when f.renewal_record_id is null
              then case f.endorsed_for when 'On Probation Status' then 'Probationary' when 'Removal' then 'Removed' else 'Regular' end
              else case r.division_head_decision when 'approved_probationary' then 'Probationary' when 'reconsidered' then 'Reconsidered' else 'Removed' end end,
         coalesce(nullif(btrim(f.signatory_name), ''), btrim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, ''))),
         f.approved_at,
         case when r.id is null then null else public._renewal_term_label(r.school_year, r.term) end
  from public.scholar_counseling_referrals f
  join public.scholars s on s.scholar_id_number = f.scholar_id_number
  left join public.renewal_records r on r.id = f.renewal_record_id
  left join public.users ab on ab.id = f.approved_by
  where f.status = 'division_head_approved' and f.referred_to = auth.uid()
  order by f.approved_at;
end;
$$;
revoke all on function public.consult_final_decisions() from public, anon;
grant execute on function public.consult_final_decisions() to authenticated;

-- ── 2. The final decision: only the consulting staff member who consulted the scholar can make it; only now does the scholarship status change ──
create or replace function public.consult_finalize_decision(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.scholar_counseling_referrals%rowtype;
  v_rec public.renewal_records%rowtype;
  v_new_status text;
  v_label text;
  v_note text;
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Only the consulting staff member can make the final decision.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id for update;
  if not found or f.status <> 'division_head_approved' then raise exception 'This referral is not waiting for a final decision.'; end if;
  if f.referred_to is distinct from auth.uid() then raise exception 'Only the consulting staff member who consulted this scholar can make the final decision.'; end if;

  if f.renewal_record_id is null then
    v_new_status := case f.endorsed_for when 'On Probation Status' then 'Probationary' when 'Removal' then 'Removed' when 'Renewal' then 'Regular' end;
    if v_new_status is null then raise exception 'This referral has no decision to apply.'; end if;
    update public.scholars set status = v_new_status where scholar_id_number = f.scholar_id_number;
  else
    select * into v_rec from public.renewal_records where id = f.renewal_record_id for update;
    if not found or v_rec.stage not in ('endorsed_division_head', 'needs_consultation_division_head') or v_rec.division_head_decision is null then
      raise exception 'This renewal case is no longer waiting for the final decision (it is "%").', coalesce(public._renewal_stage_title(v_rec.stage), 'missing');
    end if;
    v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
    v_note := v_rec.division_head_note;
    if v_rec.division_head_decision = 'approved_probationary' then
      perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', false, 'Division Head approved Probationary for the renewal of ' || v_label || '; final decision by the consulting staff.');
      update public.renewal_records set stage = 'division_head_approved', temp_probation = false, temp_previous_status = null, updated_at = now() where id = v_rec.id;
      perform public._renewal_log(v_rec.id, v_rec.stage, 'division_head_approved', 'Final decision made: Probationary. The scholar''s status is Probationary; the evaluator confirms the renewal.' || coalesce(' ' || v_note, ''));
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'The Division Head approved your Probationary status',
        'Your status is now Probationary. The evaluator will confirm your renewal for ' || v_label || '.', v_rec.id);
    elsif v_rec.division_head_decision = 'reconsidered' then
      perform public._renewal_set_status(v_rec.scholar_id_number, 'Reconsidered', false, 'Division Head reconsidered the case (renewal of ' || v_label || '); final decision by the consulting staff.');
      update public.renewal_records set stage = 'reconsidered', temp_probation = false, temp_previous_status = null, updated_at = now() where id = v_rec.id;
      perform public._renewal_log(v_rec.id, v_rec.stage, 'reconsidered', 'Final decision made: Reconsidered. The scholar''s status is Reconsidered; the evaluator confirms the renewal.' || coalesce(' ' || v_note, ''));
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'The Division Head reconsidered your case',
        'Your status is now Reconsidered. The evaluator will confirm your renewal for ' || v_label || '.', v_rec.id);
    else
      perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Division Head decided Removed (renewal of ' || v_label || '); final decision by the consulting staff.');
      update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null, updated_at = now() where id = v_rec.id;
      perform public._renewal_log(v_rec.id, v_rec.stage, 'removed', 'Final decision made: Removed. The scholar''s login was switched off.' || coalesce(' ' || v_note, ''));
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship was ended',
        'It was decided that your scholarship ends with this renewal (' || v_label || '). Please contact the CEDO office if you have questions.', v_rec.id);
    end if;
  end if;

  update public.scholar_counseling_referrals set status = 'approved', finalized_by = auth.uid(), finalized_at = now(), updated_at = now() where id = f.id;
end;
$$;
revoke all on function public.consult_finalize_decision(uuid) from public, anon;
grant execute on function public.consult_finalize_decision(uuid) to authenticated;

-- ── 3. The Division Head approves and signs; the scholar's status waits for the consulting staff ──
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

-- ── 4. Around it ──
-- A case the Division Head already approved is not sent again by a re-check.
create or replace function public._renewal_forward_to_division_head(p_record_id uuid, p_note text default null, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_sch public.scholars%rowtype;
  v_ref public.scholar_counseling_referrals%rowtype;
  v_by uuid;
  v_to uuid;
  v_counselor uuid;
  v_prev text;
  v_endorsed text;
  v_remarks text;
  v_dh record;
  v_label text;
  v_name text;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or v_rec.stage not in ('endorsed_division_head', 'needs_consultation_division_head') then return null; end if;
  select * into v_sch from public.scholars where scholar_id_number = v_rec.scholar_id_number;
  select * into v_ref from public.scholar_counseling_referrals r where r.renewal_record_id = v_rec.id and r.status <> 'approved';
  if found and v_ref.status = 'forwarded_to_division_head' then return v_ref.id; end if;
  -- the Division Head already approved and signed: the case waits for the consulting staff's final decision and is not sent again
  if found and v_ref.status = 'division_head_approved' then return v_ref.id; end if;
  -- After the Division Head sent a 2+ failed case back, only the evaluator sends it again (an automatic re-check must not).
  if found and v_ref.status = 'reconsideration_requested' and not p_force and v_rec.stage <> 'endorsed_division_head' then return v_ref.id; end if;

  v_counselor := public._renewal_attended_counselor(v_rec.id);
  v_by := coalesce((select u.id from public.users u where u.id = auth.uid()), v_counselor,
                   (select t.staff_id from public.staff_account_tags t where t.tag_key = 'scholar_renewal_evaluator' order by t.staff_id limit 1),
                   (select t.staff_id from public.staff_account_tags t where t.tag_key = 'sead_division_head' order by t.staff_id limit 1));
  v_to := coalesce(v_counselor, v_by);
  if v_by is null then raise exception 'No Division Head or evaluator account is set up, so the case cannot be sent. Ask it.admin1 to give the tags in Staff Accounts.'; end if;
  if not exists (select 1 from public.staff_account_tags t where t.tag_key = 'sead_division_head') then
    raise exception 'No SEAD Division Head is configured — ask it.admin1 to grant that tag from Staff Accounts.';
  end if;

  v_prev := case when v_sch.status = 'Reconsidered' then 'Special Recon'
                 when coalesce((v_rec.evaluation ->> 'previous_probation')::boolean, false) then 'On Probation' else 'Retained' end;
  v_endorsed := case when v_rec.stage = 'endorsed_division_head' then 'On Probation Status' else 'Removal' end;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  v_remarks := 'Renewal for ' || v_label || ' (rule ' || coalesce(v_rec.rule_code, '?') || '). ' || coalesce(v_rec.rule_text, '')
    || case when v_rec.consultation_done_at is not null then ' Consultation attended' || case when v_counselor is not null then ' with ' || public._staff_display_name(v_counselor) else '' end || '.' else ' The consultation has not taken place.' end
    || case when v_rec.no_show_count > 0 then ' Missed consultations: ' || v_rec.no_show_count || '.' else '' end
    || case when btrim(coalesce(p_note, v_rec.evaluator_comment, '')) <> '' then ' Evaluator: ' || btrim(coalesce(p_note, v_rec.evaluator_comment)) else '' end;

  if v_ref.id is not null then
    update public.scholar_counseling_referrals set status = 'forwarded_to_division_head', endorsed_for = v_endorsed, remarks = v_remarks,
      reconsideration_reason = null, division_head_id = (select t.staff_id from public.staff_account_tags t where t.tag_key = 'sead_division_head' order by t.staff_id limit 1),
      updated_at = now() where id = v_ref.id returning * into v_ref;
  else
    insert into public.scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, referral_date, previous_semester_status, failed_subjects, lacking_grades,
        endorsed_for, remarks, status, division_head_id, renewal_record_id)
    values (v_rec.scholar_id_number, v_by, v_to, (now() at time zone 'Asia/Manila')::date, v_prev,
        public._renewal_referral_subjects(v_rec.id, 'failed'), public._renewal_referral_subjects(v_rec.id, 'lacking'),
        v_endorsed, v_remarks, 'forwarded_to_division_head',
        (select t.staff_id from public.staff_account_tags t where t.tag_key = 'sead_division_head' order by t.staff_id limit 1), v_rec.id)
    returning * into v_ref;
  end if;

  v_name := btrim(v_sch.first_name || ' ' || v_sch.last_name);
  for v_dh in select t.staff_id from public.staff_account_tags t where t.tag_key = 'sead_division_head' loop
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (gen_random_uuid(), 'referral_approval', v_dh.staff_id, v_name,
      case when v_rec.stage = 'endorsed_division_head' then 'Renewal: Probationary approval needed' else 'Renewal: decision needed (Removed or Reconsidered)' end,
      'The renewal case of ' || v_name || ' (' || v_label || ') was sent for your decision.', now(), false, v_ref.id::text);
  end loop;
  perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Sent to the Division Head for ' || case when v_endorsed = 'Removal' then 'a decision (Removed or Reconsidered).' else 'Probationary approval.' end, 'System');
  if v_rec.stage = 'needs_consultation_division_head' then
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your case was sent to the Division Head',
      'The Division Head will decide your case for ' || v_label || '. We will tell you the result.', v_rec.id);
  end if;
  return v_ref.id;
end;
$$;
revoke all on function public._renewal_forward_to_division_head(uuid, text, boolean) from public, anon, authenticated;

-- The Division Head's list gets a state for "approved, waiting for the consulting staff's final decision".
create or replace function public.renewal_division_head_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('sead_division_head') or public.can_view_renewals()) then raise exception 'Only the Division Head and renewal staff can see this list.'; end if;
  return coalesce((
    select jsonb_agg(item order by (item ->> 'sort_at') desc)
    from (
      select jsonb_build_object(
        'record_id', r.id, 'referral_id', f.id, 'scholar_id_number', r.scholar_id_number,
        'scholar_name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
        'school', s.school, 'program', s.course, 'year_level', s.year_level, 'scholar_status', s.status,
        'term_label', public._renewal_term_label(r.school_year, r.term), 'stage', r.stage, 'rule_code', r.rule_code,
        'case_type', case when f.endorsed_for = 'On Probation Status' then 'probationary_approval' else 'removal_decision' end,
        'state', case when f.status = 'division_head_approved' then 'awaiting_final' when r.division_head_decision is not null then 'decided' when f.status = 'reconsideration_requested' then 'sent_back' else 'waiting' end,
        'decision', r.division_head_decision, 'decided_at', r.division_head_decided_at,
        'failed_count', jsonb_array_length(coalesce(r.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb)),
        'consultation_done_at', r.consultation_done_at, 'no_show_count', r.no_show_count,
        'sent_at', f.updated_at, 'sort_at', coalesce(r.division_head_decided_at, f.updated_at),
        'final_by', case when f.referred_to is null then null else public._staff_display_name(f.referred_to) end) as item
      from public.scholar_counseling_referrals f
      join public.renewal_records r on r.id = f.renewal_record_id
      join public.scholars s on s.scholar_id_number = r.scholar_id_number
      where (f.status = 'forwarded_to_division_head' and r.stage in ('endorsed_division_head', 'needs_consultation_division_head'))
         or (f.status = 'reconsideration_requested' and r.stage in ('ready_to_endorse', 'needs_consultation_division_head'))
         or (f.status = 'division_head_approved' and r.stage in ('endorsed_division_head', 'needs_consultation_division_head'))
         or (r.division_head_decided_at is not null and r.division_head_decided_at > now() - interval '60 days')
    ) q), '[]'::jsonb);
end;
$$;
revoke all on function public.renewal_division_head_queue() from public, anon;
grant execute on function public.renewal_division_head_queue() to authenticated;

notify pgrst, 'reload schema';
