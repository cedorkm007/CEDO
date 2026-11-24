-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_termination_signatory.sql
-- SCHOLAR RENEWAL, A REMOVAL APPROVED BY THE EVALUATOR (consultation staff endorse Removed, no Division Head): WHO SIGNS THE SCHOLARSHIP TERMINATION FORM, AND THE FORM ITSELF.   Safe to run twice.   Undo: undo_renewal_termination_signatory.sql
--   * When the evaluator approves a REMOVED endorsement they must choose who signs the termination form from a list:
--       the Division Head (by name), the City Education and Development Officer (by name, from the Certificate settings), and every staff member tagged Scholar Renewal Evaluator.
--     The choice is kept with the renewal record and written to its history.
--   * The form for such a removal can then be made: renewal_removal_form_data(record) gives everything printed on it, for the evaluator and for the consultation staff member who endorsed the removal
--     (the scholar's login is switched off at once, so the form is handed to the scholar by the staff). It uses the same Scholarship Grant Termination Acknowledgement Form and the same edge function
--     (removal-form-issue, which must be deployed again). "Noted by" carries the chosen person; when the chosen person is the City Education and Development Officer only the Officer's block is printed.
--   * The consultation staff member's list of termination forms (the button in the Consultation Tool) also lists these removals.
-- Adds four columns and four functions, and replaces two functions (the originals are in the undo file). Nothing is deleted.
-- Needs supabase_migration_renewal_one_failure_documents.sql, supabase_migration_removal_form.sql and supabase_migration_removal_form_list.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if (to_regprocedure('public.renewal_approve_endorsement(uuid,text,text)') is null and to_regprocedure('public.renewal_approve_endorsement(uuid,text,text,text)') is null) or to_regprocedure('public.consult_removal_forms()') is null or to_regprocedure('public.removal_form_data(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_one_failure_documents.sql, supabase_migration_removal_form.sql and supabase_migration_removal_form_list.sql first.';
  end if;
end $$;

alter table public.renewal_records add column if not exists termination_signatory_kind text;
alter table public.renewal_records add column if not exists termination_signatory_name text;
alter table public.renewal_records add column if not exists termination_signatory_title text;
alter table public.renewal_records add column if not exists termination_signatory_staff_id uuid references public.users(id) on delete set null;

-- 1. The people who can sign (internal), and the list the evaluator sees.
create or replace function public._renewal_termination_options()
returns table(key text, kind text, label text, name text, title text, staff_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select 'division_head:' || u.id::text, 'division_head', 'Division Head: ' || btrim(coalesce(u.last_name, '') || ', ' || coalesce(u.first_name, '')), btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')),
         'Head, Scholarships and Educational Assistance Division', u.id
  from public.staff_account_tags t join public.users u on u.id = t.staff_id where t.tag_key = 'sead_division_head'
  union all
  select 'officer', 'officer', 'City Education and Development Officer: ' || c.officer_name, c.officer_name, c.officer_title, null::uuid from public.csr_settings c where c.id
  union all
  select 'staff:' || u.id::text, 'staff', btrim(coalesce(u.last_name, '') || ', ' || coalesce(u.first_name, '')) || ' (Scholar Renewal)', btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), 'Scholar Renewal Evaluator', u.id
  from public.staff_account_tags t join public.users u on u.id = t.staff_id where t.tag_key = 'scholar_renewal_evaluator';
$$;
revoke all on function public._renewal_termination_options() from public, anon, authenticated;

create or replace function public.renewal_termination_signatories()
returns table(key text, label text, name text, title text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._renewal_require_evaluator();
  return query select o.key, o.label, o.name, o.title from public._renewal_termination_options() o
    order by case o.kind when 'division_head' then 1 when 'officer' then 2 else 3 end, o.label;
end;
$$;
revoke all on function public.renewal_termination_signatories() from public, anon;
grant execute on function public.renewal_termination_signatories() to authenticated;

-- 2. The evaluator's approval: a Removed endorsement needs the signatory.
drop function if exists public.renewal_approve_endorsement(uuid, text, text);
create or replace function public.renewal_approve_endorsement(p_record_id uuid, p_note text default '', p_status text default null, p_signatory text default null)
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
  v_sig record;
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
    -- who signs the termination form: chosen from the list (the Division Head, the City Education and Development Officer, or a staff member tagged for the Scholar Renewal)
    select * into v_sig from public._renewal_termination_options() o where o.key = btrim(coalesce(p_signatory, ''));
    if v_sig.key is null then raise exception 'Choose who signs the scholarship termination form.'; end if;
    update public.renewal_records set termination_signatory_kind = v_sig.kind, termination_signatory_name = v_sig.name, termination_signatory_title = v_sig.title, termination_signatory_staff_id = v_sig.staff_id where id = p_record_id;
    perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Removed by the endorsement of the consultation staff, approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(),
      evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'removed', 'Endorsement approved: Removed. The scholar''s login was switched off. The termination form is signed by ' || v_sig.name || '.' || coalesce(' ' || v_note, ''));
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
revoke all on function public.renewal_approve_endorsement(uuid, text, text, text) from public, anon;
grant execute on function public.renewal_approve_endorsement(uuid, text, text, text) to authenticated;

-- 3. Everything printed on the termination form of such a removal.
create or replace function public.renewal_removal_form_data(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  s public.scholars%rowtype;
  c public.csr_settings%rowtype;
  v_failed jsonb;
  v_sig_path text;
begin
  select * into r from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if not (public.is_renewal_evaluator() or (public.is_scholar_counseling_staff() and r.endorsed_by = auth.uid())) then raise exception 'You cannot open this form.'; end if;
  if r.stage <> 'removed' or r.endorsed_status is distinct from 'Removed' or r.termination_signatory_name is null then raise exception 'This renewal is not a removal with a termination form.'; end if;
  select * into s from public.scholars where scholar_id_number = r.scholar_id_number;
  select * into c from public.csr_settings where id;
  select coalesce(jsonb_agg(jsonb_build_object('code', coalesce(x ->> 'code', ''), 'semester_year', public._renewal_term_label(coalesce(r.basis_school_year, r.school_year), coalesce(r.basis_term, r.term)),
           'year_level', coalesce(s.year_level, ''), 'subject', coalesce(x ->> 'subject', ''))), '[]'::jsonb) into v_failed
  from jsonb_array_elements(coalesce(r.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb)) x;
  if r.termination_signatory_staff_id is not null then select g.storage_path into v_sig_path from public.staff_signatures g where g.staff_id = r.termination_signatory_staff_id limit 1; end if;
  return jsonb_build_object(
    'record_id', r.id, 'scholar_id_number', s.scholar_id_number, 'first_name', s.first_name, 'middle_name', coalesce(s.middle_name, ''), 'last_name', s.last_name,
    'program', coalesce(s.course, ''), 'year_level', coalesce(s.year_level, ''), 'school', coalesce(s.school, ''), 'barangay', coalesce(s.barangay, ''),
    'failed', v_failed, 'issued_on', ((coalesce(r.confirmed_at, now())) at time zone 'Asia/Manila')::date,
    'signatory_kind', r.termination_signatory_kind,
    'division_head', case when r.termination_signatory_kind = 'officer' then null
                          else jsonb_build_object('name', r.termination_signatory_name, 'title', r.termination_signatory_title, 'signature_path', v_sig_path) end,
    'officer', jsonb_build_object('name', c.officer_name, 'title', c.officer_title, 'signature_path', c.officer_signature_path));
end;
$$;
revoke all on function public.renewal_removal_form_data(uuid) from public, anon;
grant execute on function public.renewal_removal_form_data(uuid) to authenticated;

-- 4. The consultation staff's list of termination forms also lists these removals (state "done"; the form is made from the renewal record).
drop function if exists public.consult_removal_forms();
create or replace function public.consult_removal_forms()
returns table(referral_id uuid, scholar_id_number text, name text, year_level text, school text, program text, issued_on date, state text, form_kind text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_scholar_counseling_staff() or public.is_renewal_evaluator()) then raise exception 'Not authorized.'; end if;
  return query
  select x.referral_id, x.scholar_id_number, x.name, x.year_level, x.school, x.program, x.issued_on, x.state, x.form_kind from (
    select f.id as referral_id, f.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')) as name, coalesce(s.year_level, '') as year_level, coalesce(s.school, '') as school, coalesce(s.course, '') as program,
           case when f.status = 'forwarded_to_division_head' then null else ((coalesce(f.approved_at, now())) at time zone 'Asia/Manila')::date end as issued_on,
           case f.status when 'forwarded_to_division_head' then 'waiting' when 'division_head_approved' then 'ready' else 'done' end as state, 'referral'::text as form_kind,
           s.last_name as ln, s.first_name as fn
    from public.scholar_counseling_referrals f
    join public.scholars s on s.scholar_id_number = f.scholar_id_number
    where f.referred_to = auth.uid()
      and ((f.status in ('division_head_approved', 'approved') and f.signature_path is not null and (case when f.renewal_record_id is null then f.endorsed_for = 'Removal'
          else coalesce((select rr.division_head_decision = 'removed' from public.renewal_records rr where rr.id = f.renewal_record_id), false) end))
           or (f.status = 'forwarded_to_division_head' and f.endorsed_for = 'Removal'))
    union all
    select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), coalesce(s.year_level, ''), coalesce(s.school, ''), coalesce(s.course, ''),
           ((coalesce(r.confirmed_at, now())) at time zone 'Asia/Manila')::date, 'done', 'record', s.last_name, s.first_name
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.stage = 'removed' and r.endorsed_status = 'Removed' and r.termination_signatory_name is not null and (r.endorsed_by = auth.uid() or public.is_renewal_evaluator())
  ) x
  order by x.ln, x.fn, x.scholar_id_number;
end;
$$;
revoke all on function public.consult_removal_forms() from public, anon;
grant execute on function public.consult_removal_forms() to authenticated;

notify pgrst, 'reload schema';
commit;
