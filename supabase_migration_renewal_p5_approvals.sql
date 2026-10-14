-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p5_approvals.sql
--
-- Scholar Renewal System, Phase 5: the Division Head's decisions. Run AFTER the Phase 4 file. Additive and safe to run twice.
--
--   1. A referral can be LINKED to a renewal case. A linked referral never changes the scholar's status by itself (that was the conflict
--      found in Phase 0): the old approve / send-back / forward functions refuse it, and ONE controlled function applies the outcome.
--   2. The case goes to the Division Head automatically: a "1 failed subject" case when the evaluator endorses it; a "2 or more failed"
--      case (or 1 failed after earlier probation) as soon as the consultation is attended. The evaluator can also send it by hand
--      (for example after the scholar missed the consultation). The referral is created already forwarded, with the evaluator (or the
--      consultation staff member) as the person who referred it, and the Division Head gets the usual notification.
--   3. The Division Head's decision, signed like any referral (the signature image and the printed name):
--        endorsed 1-failed case         -> Approve Probationary (status Probationary; the renewal is Renewed as Probationary)
--                                          or Send back to the evaluator (reason)
--        2+ failed / 1 failed + earlier -> Removed (status Removed AND the login is switched off, like the Removed Scholars flow)
--        probation                         or Reconsidered (status Reconsidered; the evaluator then confirms the renewal)
--                                          or Send back to the evaluator (reason)
--   4. The evaluator confirms a Reconsidered case (renewal_confirm_reconsidered); the renewal then counts as Renewed.
--   5. The signed referral prints the name the Division Head typed (the signature itself is still the Division Head's own).
-- ─────────────────────────────────────────────────────────────

-- ── 1. Columns ──────────────────────────────────────────────
alter table public.scholar_counseling_referrals add column if not exists renewal_record_id uuid references public.renewal_records(id) on delete set null;
alter table public.scholar_counseling_referrals add column if not exists signatory_name text;
create index if not exists scholar_counseling_referrals_renewal_idx on public.scholar_counseling_referrals (renewal_record_id) where renewal_record_id is not null;
-- One open referral per renewal case at a time.
create unique index if not exists scholar_counseling_referrals_one_open_renewal_uq on public.scholar_counseling_referrals (renewal_record_id)
  where renewal_record_id is not null and status <> 'approved';

alter table public.renewal_records add column if not exists division_head_decision text;
alter table public.renewal_records drop constraint if exists renewal_records_division_head_decision_check;
alter table public.renewal_records add constraint renewal_records_division_head_decision_check
  check (division_head_decision is null or division_head_decision in ('approved_probationary', 'removed', 'reconsidered'));
alter table public.renewal_records add column if not exists division_head_decided_at timestamptz;
alter table public.renewal_records add column if not exists division_head_decided_by uuid references public.users(id) on delete set null;
alter table public.renewal_records add column if not exists division_head_note text;

-- ── 2. Helpers ──────────────────────────────────────────────
-- (public._staff_display_name(uuid) comes from the Phase 3 file.)

-- The failed / lacking subjects of a case, in the shape the Referral Form uses.
create or replace function public._renewal_referral_subjects(p_record_id uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_year_level text;
  v_when text;
begin
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then return '[]'::jsonb; end if;
  select s.year_level into v_year_level from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  v_when := coalesce(public._renewal_term_label(v_rec.basis_school_year, v_rec.basis_term), '');
  if p_kind = 'failed' then
    return coalesce((select jsonb_agg(jsonb_build_object('subjectCode', coalesce(x ->> 'code', ''), 'semesterAcademicYear', v_when, 'yearLevel', coalesce(v_year_level, '')))
                     from jsonb_array_elements(coalesce(v_rec.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb)) x), '[]'::jsonb);
  end if;
  -- "Lacking grades": subjects still INC (no final grade yet).
  return coalesce((select jsonb_agg(jsonb_build_object('subjectCode', coalesce(x ->> 'code', ''), 'semesterAcademicYear', v_when, 'yearLevel', coalesce(v_year_level, '')))
                   from jsonb_array_elements(coalesce(v_rec.evaluation -> 'grades' -> 'inc_subjects', '[]'::jsonb)) x
                   where coalesce(x ->> 'state', 'open') = 'open'), '[]'::jsonb);
end;
$$;
revoke all on function public._renewal_referral_subjects(uuid, text) from public, anon, authenticated;

-- The consultation staff member who attended this case, if any.
create or replace function public._renewal_attended_counselor(p_record_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select x.staff_id from public.counseling_slots x where x.record_id = p_record_id and x.state = 'attended' order by x.starts_at desc limit 1;
$$;
revoke all on function public._renewal_attended_counselor(uuid) from public, anon, authenticated;

-- ── 3. Sending a case to the Division Head ──────────────────
-- Creates (or re-sends) the linked referral, already forwarded, and tells every Division Head. Safe to call twice.
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

-- Automatic sending: an endorsed 1-failed case, or a 2+ failed case once its consultation is attended (or when it reaches this stage with the
-- consultation already done, e.g. an INC case the evaluator referred for removal).
create or replace function public._renewal_trg_forward_to_division_head()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._renewal_forward_to_division_head(new.id, null, false);
  return null;
end;
$$;
drop trigger if exists renewal_forward_to_division_head on public.renewal_records;
create trigger renewal_forward_to_division_head after update of stage, consultation_done_at on public.renewal_records
  for each row when (
    (new.stage = 'endorsed_division_head' and old.stage is distinct from new.stage)
    or (new.stage = 'needs_consultation_division_head' and new.consultation_done_at is not null
        and (old.stage is distinct from new.stage or old.consultation_done_at is distinct from new.consultation_done_at))
  ) execute function public._renewal_trg_forward_to_division_head();

-- The evaluator sends a 2+ failed case by hand (for example after the scholar missed the consultation), or sends it again after the
-- Division Head sent it back. Without a consultation a reason is needed.
create or replace function public.renewal_send_to_division_head(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'needs_consultation_division_head' then raise exception 'Only a case waiting for the Division Head''s decision can be sent (this one is "%").', public._renewal_stage_title(v_rec.stage); end if;
  if v_rec.consultation_done_at is null and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'The consultation has not taken place. Please say why the case is sent now (at least 5 characters).';
  end if;
  update public.renewal_records set evaluator_comment = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_record_id;
  perform public._renewal_forward_to_division_head(p_record_id, p_note, true);
end;
$$;
revoke all on function public.renewal_send_to_division_head(uuid, text) from public, anon;
grant execute on function public.renewal_send_to_division_head(uuid, text) to authenticated;

-- ── 4. The old referral functions leave renewal cases alone ──
-- (They are defined in the earlier referral migrations; these copies add one check at the top and are otherwise identical.)
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

create or replace function public.request_referral_reconsideration(p_referral_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.has_staff_tag('sead_division_head') then
    raise exception 'Not authorized to act on referrals.';
  end if;
  if exists (select 1 from public.scholar_counseling_referrals where id = p_referral_id and renewal_record_id is not null) then
    raise exception 'This referral belongs to a scholar renewal. Send it back to the evaluator from the renewal case instead.';
  end if;
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and status = 'forwarded_to_division_head'
  ) then
    raise exception 'This referral is not awaiting approval.';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to send this back for reconsideration.';
  end if;

  update public.scholar_counseling_referrals
  set status = 'reconsideration_requested', reconsideration_reason = trim(p_reason), updated_at = now()
  where id = p_referral_id;
end;
$function$;

create or replace function public.forward_referral_to_division_head(
  p_referral_id uuid, p_remarks text, p_endorsed_for text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar_name text;
  v_first_division_head_id uuid;
  v_staff record;
begin
  if exists (select 1 from public.scholar_counseling_referrals where id = p_referral_id and renewal_record_id is not null) then
    raise exception 'This referral belongs to a scholar renewal; the evaluator sends renewal cases to the Division Head.';
  end if;
  if not exists (
    select 1 from public.scholar_counseling_referrals
    where id = p_referral_id and referred_to = auth.uid() and status in ('pending', 'reconsideration_requested')
  ) then
    raise exception 'This referral is not in your queue.';
  end if;

  select staff_id into v_first_division_head_id from public.staff_account_tags where tag_key = 'sead_division_head' limit 1;
  if v_first_division_head_id is null then
    raise exception 'No SEAD Division Head is configured — ask it.admin1 to grant that tag from Staff Accounts.';
  end if;

  update public.scholar_counseling_referrals
  set remarks = coalesce(p_remarks, ''), endorsed_for = p_endorsed_for,
      status = 'forwarded_to_division_head', division_head_id = v_first_division_head_id,
      reconsideration_reason = null, updated_at = now()
  where id = p_referral_id;

  select s.first_name || ' ' || s.last_name into v_scholar_name
  from public.scholar_counseling_referrals r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.id = p_referral_id;

  for v_staff in select staff_id from public.staff_account_tags where tag_key = 'sead_division_head' loop
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (
      gen_random_uuid(), 'referral_approval', v_staff.staff_id, coalesce(v_scholar_name, 'a scholar'),
      'Counseling Referral for Approval',
      'A counseling referral for ' || coalesce(v_scholar_name, 'a scholar') || ' has been forwarded for your approval.',
      now(), false, p_referral_id::text
    );
  end loop;
end;
$function$;

-- The consultation staff queue and dashboard do not list renewal cases (the evaluator handles those).
create or replace function public.scholar_counseling_queue()
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users u on u.id = r.referred_by
  where public.is_scholar_counseling_staff()
    and r.referred_to = auth.uid()
    and r.renewal_record_id is null
    and r.status in ('pending', 'reconsideration_requested')
  order by r.created_at asc;
$function$;

create or replace function public.scholar_counseling_dashboard_summary()
 returns table(
   ksb_client_count bigint, home_visited_count bigint,
   probationary_count bigint, on_leave_count bigint, reconsidered_count bigint, removed_count bigint,
   pending_count bigint, reconsideration_count bigint,
   month_label text, clients_served_this_month bigint
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    (select count(*) from public.scholar_counseling_records where visit_type = 'KSB Client'),
    (select count(*) from public.scholar_counseling_records where visit_type = 'Home Visit'),
    (select count(*) from public.scholars where status = 'Probationary'),
    (select count(*) from public.scholars where status = 'On leave'),
    (select count(*) from public.scholars where status = 'Reconsidered'),
    (select count(*) from public.scholars where status = 'Removed'),
    (select count(*) from public.scholar_counseling_referrals where referred_to = auth.uid() and status = 'pending' and renewal_record_id is null),
    (select count(*) from public.scholar_counseling_referrals where referred_to = auth.uid() and status = 'reconsideration_requested' and renewal_record_id is null),
    to_char(current_date, 'FMMonth YYYY'),
    (select count(*) from public.scholar_counseling_records
      where consulted_by = auth.uid() and date_trunc('month', date_visited) = date_trunc('month', current_date))
  where public.is_scholar_counseling_staff();
$function$;

-- The signed form prints the name the Division Head typed (falling back to their own name).
create or replace function public.get_scholar_counseling_referral(p_referral_id uuid)
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz,
   signature_path text, approved_by_name text, approved_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at,
    r.signature_path, coalesce(nullif(btrim(r.signatory_name), ''), trim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, ''))) as approved_by_name, r.approved_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users rb on rb.id = r.referred_by
  left join public.users ab on ab.id = r.approved_by
  where r.id = p_referral_id
    and (
      public.has_staff_tag('scholar_management')
      or public.has_staff_tag('scholar_counseling')
      or public.has_staff_tag('sead_division_head')
      or (r.renewal_record_id is not null and public.can_view_renewals())
    );
$function$;

create or replace function public.scholar_counseling_approved_referrals()
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   barangay text, contact_no text, previous_semester_status text, failed_subjects jsonb,
   lacking_grades jsonb, endorsed_for text, remarks text, status text,
   referred_by_name text, referral_date date, reconsideration_reason text, created_at timestamptz,
   signature_path text, approved_by_name text, approved_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number, s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school, s.barangay, s.contact_no,
    r.previous_semester_status, r.failed_subjects, r.lacking_grades, r.endorsed_for, r.remarks, r.status,
    trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')) as referred_by_name,
    r.referral_date, r.reconsideration_reason, r.created_at,
    r.signature_path, coalesce(nullif(btrim(r.signatory_name), ''), trim(coalesce(ab.first_name, '') || ' ' || coalesce(ab.last_name, ''))) as approved_by_name, r.approved_at
  from public.scholar_counseling_referrals r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users rb on rb.id = r.referred_by
  left join public.users ab on ab.id = r.approved_by
  where public.is_scholar_counseling_staff()
    and r.referred_to = auth.uid()
    and r.status = 'approved'
  order by r.approved_at desc;
$function$;

-- ── 5. What the Division Head sees ──────────────────────────
-- Everything the Referral Form screen needs to know about the renewal behind a referral (null when the referral is not linked to one).
create or replace function public.renewal_referral_info(p_referral_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref public.scholar_counseling_referrals%rowtype;
  v_rec public.renewal_records%rowtype;
  v_counselor uuid;
begin
  if not (public.has_staff_tag('sead_division_head') or public.can_view_renewals() or public.has_staff_tag('scholar_management')) then return null; end if;
  select * into v_ref from public.scholar_counseling_referrals where id = p_referral_id;
  if not found or v_ref.renewal_record_id is null then return null; end if;
  select * into v_rec from public.renewal_records where id = v_ref.renewal_record_id;
  if not found then return null; end if;
  v_counselor := public._renewal_attended_counselor(v_rec.id);
  return jsonb_build_object(
    'record_id', v_rec.id, 'stage', v_rec.stage, 'term_label', public._renewal_term_label(v_rec.school_year, v_rec.term),
    'basis_label', public._renewal_term_label(v_rec.basis_school_year, v_rec.basis_term),
    'case_type', case when v_rec.stage = 'endorsed_division_head' or v_ref.endorsed_for = 'On Probation Status' then 'probationary_approval' else 'removal_decision' end,
    'rule_code', v_rec.rule_code, 'rule_text', v_rec.rule_text,
    'options', case v_rec.stage when 'endorsed_division_head' then jsonb_build_array('approve_probationary', 'return')
                                when 'needs_consultation_division_head' then jsonb_build_array('removed', 'reconsidered', 'return')
                                else '[]'::jsonb end,
    'decided', v_rec.division_head_decision, 'decided_at', v_rec.division_head_decided_at, 'decision_note', v_rec.division_head_note,
    'consultation_done_at', v_rec.consultation_done_at, 'counselor', case when v_counselor is null then null else public._staff_display_name(v_counselor) end,
    'no_show_count', v_rec.no_show_count, 'evaluator_note', v_rec.evaluator_comment,
    'failed_subjects', coalesce(v_rec.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb),
    'inc_subjects', coalesce(v_rec.evaluation -> 'grades' -> 'inc_subjects', '[]'::jsonb),
    'previous_probation', coalesce((v_rec.evaluation ->> 'previous_probation')::boolean, false),
    'sent_back_reason', case when v_ref.status = 'reconsideration_requested' then v_ref.reconsideration_reason else null end,
    'referral_status', v_ref.status,
    'my_name', public._staff_display_name(auth.uid()));
end;
$$;
revoke all on function public.renewal_referral_info(uuid) from public, anon;
grant execute on function public.renewal_referral_info(uuid) to authenticated;

-- The Division Head's list: cases waiting for a decision, cases sent back, and decisions made in the last 60 days.
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

-- ── 6. Applying a decision ──────────────────────────────────
-- Removing a scholar the way the Removed Scholars flow does: status Removed (remembering the one before), the login switched off, a line
-- in the scholar account log, and any future consultation booking released.
create or replace function public._renewal_remove_scholar(p_scholar_id_number text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sch public.scholars%rowtype;
  v_slot public.counseling_slots%rowtype;
begin
  select * into v_sch from public.scholars where scholar_id_number = p_scholar_id_number for update;
  if not found or v_sch.status = 'Removed' then return; end if;
  update auth.users set banned_until = now() + interval '876000 hours' where id = v_sch.id;
  perform set_config('app.status_source', 'renewal', true);
  perform set_config('app.status_temporary', 'false', true);
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update public.scholars set status = 'Removed',
    status_before_removal = case when v_sch.status in ('Regular', 'Probationary', 'On leave', 'Reconsidered') then v_sch.status else null end,
    updated_at = now()
  where scholar_id_number = p_scholar_id_number;
  perform set_config('app.status_source', '', true);
  perform set_config('app.status_temporary', '', true);
  perform set_config('app.status_note', '', true);
  insert into public.sead_scholar_account_log (action, scholar_id, scholar_id_number, scholar_name, performed_by, performed_by_name, source, description)
  values ('removed', v_sch.id, v_sch.scholar_id_number, btrim(v_sch.first_name || ' ' || v_sch.last_name), auth.uid(), public._actor_name(), 'single',
          'Marked as Removed (was ' || v_sch.status || ') by the Division Head''s renewal decision — login deactivated.');
  for v_slot in select * from public.counseling_slots x where x.scholar_id_number = p_scholar_id_number and x.state = 'booked' and x.starts_at > now() for update loop
    update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, reminded_day_at = null, reminded_hour_at = null where id = v_slot.id;
    perform public._booking_log(v_slot.record_id, p_scholar_id_number, v_slot.starts_at, v_slot.staff_id, 'removed_by_staff', 'The scholar was removed.');
  end loop;
end;
$$;
revoke all on function public._renewal_remove_scholar(text, text) from public, anon, authenticated;

-- The Division Head decides (and signs) a case.
--   p_decision: 'approve_probationary' (an endorsed 1-failed case), 'removed' or 'reconsidered' (a 2+ failed case)
--   p_signature_path: the signature image, like any referral; p_signatory_name: the name printed on the form (default: the Division Head's own)
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
    update public.renewal_records set stage = 'renewed', result = 'renewed_probationary', temp_probation = false, temp_previous_status = null,
      division_head_decision = 'approved_probationary', division_head_decided_at = now(), division_head_decided_by = auth.uid(), division_head_note = v_note,
      confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, 'renewed', 'Division Head approved Probationary: the renewal is Renewed as Probationary.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is approved — Probationary',
      'The Division Head approved your renewal for ' || v_label || ' with Probationary status. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', v_rec.id);
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

-- The Division Head sends a case back to the evaluator with a reason (for more information or a different recommendation).
create or replace function public.renewal_division_head_return(p_record_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ref public.scholar_counseling_referrals%rowtype;
begin
  if not public.has_staff_tag('sead_division_head') then raise exception 'Only the Division Head can do this.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please give the evaluator a reason (at least 5 characters).'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage not in ('endorsed_division_head', 'needs_consultation_division_head') then raise exception 'This case is not waiting for the Division Head.'; end if;
  select * into v_ref from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id and f.status = 'forwarded_to_division_head' for update;
  if not found then raise exception 'This case has not been sent to the Division Head.'; end if;
  update public.scholar_counseling_referrals set status = 'reconsideration_requested', reconsideration_reason = btrim(p_reason), updated_at = now() where id = v_ref.id;
  if v_rec.stage = 'endorsed_division_head' then
    -- Back to the evaluator, who endorses again (or returns the application).
    update public.renewal_records set stage = 'ready_to_endorse', evaluator_comment = 'Division Head: ' || btrim(p_reason), updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, 'ready_to_endorse', 'Division Head sent the case back to the evaluator: ' || btrim(p_reason));
  else
    update public.renewal_records set evaluator_comment = 'Division Head: ' || btrim(p_reason), updated_at = now() where id = v_rec.id;
    perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage, 'Division Head sent the case back to the evaluator: ' || btrim(p_reason));
  end if;
end;
$$;
revoke all on function public.renewal_division_head_return(uuid, text) from public, anon;
grant execute on function public.renewal_division_head_return(uuid, text) to authenticated;

-- The evaluator confirms a Reconsidered case; the renewal then counts as Renewed (the scholar's status stays Reconsidered).
create or replace function public.renewal_confirm_reconsidered(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'reconsidered' then raise exception 'Only a case the Division Head reconsidered can be confirmed here (this one is "%").', public._renewal_stage_title(v_rec.stage); end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  update public.renewal_records set stage = 'renewed', result = 'reconsidered', confirmed_at = now(), confirmed_by = auth.uid(),
    evaluator_comment = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, 'reconsidered', 'renewed', 'Renewal confirmed after the Division Head reconsidered the case.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end);
  perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
    'You are renewed for ' || v_label || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
end;
$$;
revoke all on function public.renewal_confirm_reconsidered(uuid, text) from public, anon;
grant execute on function public.renewal_confirm_reconsidered(uuid, text) to authenticated;

-- Where is this case with the Division Head? (the evaluator's detail page)
create or replace function public.renewal_dh_status(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_f public.scholar_counseling_referrals%rowtype;
begin
  if not public.can_view_renewals() and not public.has_staff_tag('sead_division_head') then raise exception 'Not authorized to view renewal applications.'; end if;
  select * into v_f from public.scholar_counseling_referrals f where f.renewal_record_id = p_record_id order by f.created_at desc limit 1;
  if not found then return jsonb_build_object('sent', false); end if;
  return jsonb_build_object('sent', true, 'referral_id', v_f.id, 'status', v_f.status, 'sent_back_reason', case when v_f.status = 'reconsideration_requested' then v_f.reconsideration_reason end,
    'sent_at', v_f.updated_at, 'signatory_name', v_f.signatory_name);
end;
$$;
revoke all on function public.renewal_dh_status(uuid) from public, anon;
grant execute on function public.renewal_dh_status(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.scholar_counseling_referrals where renewal_record_id is not null) as renewal_referrals,
       (select count(*) from public.renewal_records where division_head_decision is not null) as decisions_made;
