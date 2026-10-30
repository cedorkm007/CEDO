-- ─────────────────────────────────────────────────────────────
-- SCHOLARSHIP TERMINATION FORM (the document signed when a removal is approved).   Safe to run twice.   Undo: undo_removal_form.sql
-- Run AFTER the final decision files (a and b) and the Scholar Renewal CSR file (supabase_migration_renewal_p8_csr.sql).
--
--   When the Division Head approves a scholar's REMOVAL (a consultation referral for removal, or a renewal case decided Removed) there is a "Scholarship Grant Termination
--   Acknowledgement Form" to be signed by the scholar, the parent or guardian, the Division Head and the City Education and Development Officer. The Division Head's signature
--   is the one attached at approval; the officer's is the one kept in the Certificate settings. The consulting staff member the case is assigned to and the scholar can download it.
--   The PDF itself is made by the edge function "removal-form-issue"; this file adds what it asks the database:
--     removal_form_data(referral)  who may open the form (the scholar, the consulting staff member) and everything printed on it
--     removal_forms_mine()         the scholar's own forms        consult_removal_forms()   the consulting staff member's forms
--   and the scholar gets a bell notice when the Division Head approves a removal (approve_referral and renewal_division_head_decide are replaced with that one addition).
-- Adds three functions and replaces two (the originals are in the undo file). No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.consult_finalize_decision(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_final_decision_a_referral_columns.sql and _b_functions.sql first.';
  end if;
  if to_regclass('public.csr_settings') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_p8_csr.sql first (the certificate settings hold the officer''s name and signature).';
  end if;
end $$;

-- ── 1. Who may open the form, and everything that goes on it ──
-- Only for a REMOVAL the Division Head approved and signed. The scholar the form is about, and the consulting staff member the case is assigned to, may open it.
create or replace function public.removal_form_data(p_referral_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.scholar_counseling_referrals%rowtype;
  s public.scholars%rowtype;
  c public.csr_settings%rowtype;
  v_dh_name text;
  v_failed jsonb;
begin
  select * into f from public.scholar_counseling_referrals where id = p_referral_id;
  if not found then raise exception 'That referral was not found.'; end if;
  if not ((public.current_scholar_id_number() is not null and public.current_scholar_id_number() = f.scholar_id_number)
          or (f.referred_to is not null and f.referred_to = auth.uid() and (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()))) then
    raise exception 'You cannot open this form.';
  end if;
  if f.status not in ('division_head_approved', 'approved') or f.signature_path is null then raise exception 'The Division Head has not approved this case yet.'; end if;
  if not (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end) then raise exception 'This case is not a scholarship removal, so it has no termination form.'; end if;
  select * into s from public.scholars where scholar_id_number = f.scholar_id_number;
  select * into c from public.csr_settings where id;
  select coalesce(nullif(btrim(f.signatory_name), ''), btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, ''))) into v_dh_name from public.users u where u.id = f.approved_by;
  -- the failed subjects of the case (what staff entered on the referral, or the semester reviewed for a renewal case), with the subject name when the grades have that code
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', coalesce(x ->> 'subjectCode', ''), 'semester_year', coalesce(x ->> 'semesterAcademicYear', ''), 'year_level', coalesce(x ->> 'yearLevel', ''),
           'subject', coalesce((select g.subject from public.scholar_subjects_grades g where g.scholar_id_number = f.scholar_id_number and g.subject_code is not null
                                  and upper(btrim(g.subject_code)) = upper(btrim(coalesce(x ->> 'subjectCode', ''))) order by g.school_year desc limit 1), '')
         )), '[]'::jsonb) into v_failed
  from jsonb_array_elements(coalesce(f.failed_subjects, '[]'::jsonb)) x
  where btrim(coalesce(x ->> 'subjectCode', '')) <> '';
  return jsonb_build_object(
    'referral_id', f.id, 'scholar_id_number', s.scholar_id_number, 'first_name', s.first_name, 'middle_name', coalesce(s.middle_name, ''), 'last_name', s.last_name,
    'program', coalesce(s.course, ''), 'year_level', coalesce(s.year_level, ''), 'school', coalesce(s.school, ''), 'barangay', coalesce(s.barangay, ''),
    'failed', v_failed,
    'issued_on', ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date,
    'division_head', jsonb_build_object('name', coalesce(v_dh_name, ''), 'signature_path', f.signature_path),
    'officer', jsonb_build_object('name', c.officer_name, 'title', c.officer_title, 'signature_path', c.officer_signature_path));
end;
$$;
revoke all on function public.removal_form_data(uuid) from public, anon;
grant execute on function public.removal_form_data(uuid) to authenticated;

-- ── 2. The lists: the scholar's own forms, and the consulting staff member's ──
create or replace function public.removal_forms_mine()
returns table(referral_id uuid, issued_on date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Only signed-in scholars can open their forms.'; end if;
  return query
  select f.id, ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date
  from public.scholar_counseling_referrals f
  where f.scholar_id_number = v_id and f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end)
  order by f.approved_at desc;
end;
$$;
revoke all on function public.removal_forms_mine() from public, anon;
grant execute on function public.removal_forms_mine() to authenticated;

create or replace function public.consult_removal_forms()
returns table(referral_id uuid, scholar_id_number text, name text, issued_on date, final_decision_made boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select f.id, f.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date, f.status = 'approved'
  from public.scholar_counseling_referrals f
  join public.scholars s on s.scholar_id_number = f.scholar_id_number
  where f.referred_to = auth.uid() and f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
        else coalesce((select r.division_head_decision = 'removed' from public.renewal_records r where r.id = f.renewal_record_id), false) end)
  order by f.approved_at desc;
end;
$$;
revoke all on function public.consult_removal_forms() from public, anon;
grant execute on function public.consult_removal_forms() to authenticated;

-- ── 3. The scholar is told when the Division Head approves a removal ──
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
  v_endorsed text;
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to approve referrals.';
  end if;
  if exists (select 1 from public.scholar_counseling_referrals where id = p_referral_id and renewal_record_id is not null) then
    raise exception 'This referral belongs to a scholar renewal. Decide it from the renewal case (Approve Probationary, Reconsidered or Removed) so the scholar''s status and renewal stay in step.';
  end if;

  select scholar_id_number, referred_to, endorsed_for into v_scholar_id_number, v_to, v_endorsed
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
  -- a removal comes with a form to be signed: the scholar can download it
  if v_endorsed = 'Removal' then
    perform public._notify_scholar(v_scholar_id_number, 'progress', 'Your scholarship termination form is ready',
      'The Division Head approved the termination of your scholarship. Open the Renewal tile to download the Scholarship Grant Termination Acknowledgement Form, print it, sign it together with your parent or guardian and bring it to the CEDO office.', null);
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
  -- a removal comes with a form to be signed: the scholar can download it
  if p_decision = 'removed' then
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship termination form is ready',
      'The Division Head approved the termination of your scholarship. Open the Renewal tile to download the Scholarship Grant Termination Acknowledgement Form, print it, sign it together with your parent or guardian and bring it to the CEDO office.', v_rec.id);
  end if;
end;
$$;
revoke all on function public.renewal_division_head_decide(uuid, text, text, text, text) from public, anon;
grant execute on function public.renewal_division_head_decide(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
