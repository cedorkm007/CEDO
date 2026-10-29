-- UNDO for supabase_migration_final_decision_b_functions.sql: the Division Head's approval changes the scholar's status at once again, as before.
-- It stops (changing nothing) while a case is waiting for a final decision: have the consulting staff make those final decisions first.
do $$ declare n integer; begin
  select count(*) into n from public.scholar_counseling_referrals where status = 'division_head_approved';
  if n > 0 then raise exception 'STOPPED, nothing changed: % case(s) are waiting for the consulting staff''s final decision. Let them press "Proceed with the final decision" first, then run this undo.', n; end if;
end $$;

drop function if exists public.consult_finalize_decision(uuid);
drop function if exists public.consult_final_decisions();

create or replace function public.approve_referral(p_referral_id uuid, p_signature_path text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar_id_number text;
  v_endorsed_for text;
  v_new_status text;
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to approve referrals.';
  end if;
  if exists (select 1 from public.scholar_counseling_referrals where id = p_referral_id and renewal_record_id is not null) then
    raise exception 'This referral belongs to a scholar renewal. Decide it from the renewal case (Approve Probationary, Reconsidered or Removed) so the scholar''s status and renewal stay in step.';
  end if;

  select scholar_id_number, endorsed_for into v_scholar_id_number, v_endorsed_for
  from public.scholar_counseling_referrals
  where id = p_referral_id and status = 'forwarded_to_division_head';
  if v_scholar_id_number is null then
    raise exception 'This referral is not awaiting approval.';
  end if;
  if p_signature_path is null or trim(p_signature_path) = '' then
    raise exception 'A signature is required to approve.';
  end if;

  v_new_status := case v_endorsed_for
    when 'On Probation Status' then 'Probationary'
    when 'Removal' then 'Removed'
    when 'Renewal' then 'Regular'
  end;

  update public.scholars set status = v_new_status where scholar_id_number = v_scholar_id_number;

  update public.scholar_counseling_referrals
  set status = 'approved', signature_path = p_signature_path, approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_referral_id;
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
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
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

  update public.scholar_counseling_referrals set status = 'approved', signature_path = p_signature_path, signatory_name = v_name,
    approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = v_ref.id;

  if p_decision = 'approve_probationary' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', false, 'Division Head approved Probationary for the renewal of ' || v_label || '.');
    update public.renewal_records set stage = 'division_head_approved', temp_probation = false, temp_previous_status = null,
      division_head_decision = 'approved_probationary', division_head_decided_at = now(), division_head_decided_by = auth.uid(), division_head_note = v_note, updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, 'division_head_approved', 'Division Head approved Probationary: the scholar''s status is Probationary; the evaluator confirms the renewal.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'The Division Head approved your Probationary status',
      'Your status is now Probationary. The evaluator will confirm your renewal for ' || v_label || '.', v_rec.id);
  elsif p_decision = 'reconsidered' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Reconsidered', false, 'Division Head reconsidered the case (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'reconsidered', temp_probation = false, temp_previous_status = null,
      division_head_decision = 'reconsidered', division_head_decided_at = now(), division_head_decided_by = auth.uid(), division_head_note = v_note, updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, 'reconsidered', 'Division Head reconsidered the case: the scholar''s status is Reconsidered; the evaluator confirms the renewal.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'The Division Head reconsidered your case',
      'Your status is now Reconsidered. The evaluator will confirm your renewal for ' || v_label || '.', v_rec.id);
  else
    perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Division Head decided Removed (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null,
      division_head_decision = 'removed', division_head_decided_at = now(), division_head_decided_by = auth.uid(), division_head_note = v_note, updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, 'removed', 'Division Head decided Removed: the scholar''s login was switched off.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship was ended',
      'The Division Head decided that your scholarship ends with this renewal (' || v_label || '). Please contact the CEDO office if you have questions.', v_rec.id);
  end if;
end;
$$;
revoke all on function public.renewal_division_head_decide(uuid, text, text, text, text) from public, anon;
grant execute on function public.renewal_division_head_decide(uuid, text, text, text, text) to authenticated;

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
        'state', case when r.division_head_decision is not null then 'decided' when f.status = 'reconsideration_requested' then 'sent_back' else 'waiting' end,
        'decision', r.division_head_decision, 'decided_at', r.division_head_decided_at,
        'failed_count', jsonb_array_length(coalesce(r.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb)),
        'consultation_done_at', r.consultation_done_at, 'no_show_count', r.no_show_count,
        'sent_at', f.updated_at, 'sort_at', coalesce(r.division_head_decided_at, f.updated_at)) as item
      from public.scholar_counseling_referrals f
      join public.renewal_records r on r.id = f.renewal_record_id
      join public.scholars s on s.scholar_id_number = r.scholar_id_number
      where (f.status = 'forwarded_to_division_head' and r.stage in ('endorsed_division_head', 'needs_consultation_division_head'))
         or (f.status = 'reconsideration_requested' and r.stage in ('ready_to_endorse', 'needs_consultation_division_head'))
         or (r.division_head_decided_at is not null and r.division_head_decided_at > now() - interval '60 days')
    ) q), '[]'::jsonb);
end;
$$;
revoke all on function public.renewal_division_head_queue() from public, anon;
grant execute on function public.renewal_division_head_queue() to authenticated;

notify pgrst, 'reload schema';
