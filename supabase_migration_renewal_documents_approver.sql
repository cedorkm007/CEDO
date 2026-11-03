-- ─────────────────────────────────────────────────────────────
-- RENEWAL DOCUMENTS APPROVER: a staff tag for the people who approve or return the scholars' INC letter, clearance and study plan.   Safe to run twice.   Undo: undo_renewal_documents_approver.sql
-- Run AFTER supabase_migration_inc_docs_b_functions.sql (and the files of the Grades Approver, the Scholar List actions and the live updates).
--
-- Until now the Scholar Renewal Evaluator approved these three documents. (The prospectus, which gates nothing, stays with the evaluator.) From now on ONLY the accounts it.admin1 gives the tag  renewal_documents_approver  can approve or return them
-- (like the Grades Approver for entered grades). The evaluator, the consultation staff and the Division Head can still SEE the documents and who approved them, but cannot approve or return.
--   * can_approve_renewal_documents(): who holds the tag.
--   * renewal_review_document(): approve or return, now for the tagged approvers only.
--   * renewal_documents_queue(...) and renewal_documents_counts(): the list for the approver's Documents tab (and the read-only view for the evaluator).
--   * The approver can open the files (storage rule) and see the renewal lists (can_view_renewal_list) and follow live changes.
--   * Every tagged approver gets a bell notice when a scholar sends a document to approve (one notice per application until it is read).
-- Replaces functions and one storage rule; adds functions and one trigger. No table is changed. Nothing is deleted.
-- IMPORTANT: until at least one account has the tag, NOBODY can approve these documents, and scholars with an INC or a study plan to approve cannot book a consultation.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.renewal_review_document(uuid,boolean,text)') is null or to_regprocedure('public.can_view_renewal_list()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_inc_docs_b_functions.sql and supabase_migration_renewal_actions_needed.sql first.';
  end if;
end $$;

-- 1. Who holds the tag.
create or replace function public.can_approve_renewal_documents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'renewal_documents_approver');
$$;
revoke all on function public.can_approve_renewal_documents() from public, anon;
grant execute on function public.can_approve_renewal_documents() to authenticated;

-- 2. The approver sees the renewal lists (where documents wait), can open the files, and follows live changes.
create or replace function public.can_view_renewal_list()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_renewals() or public.can_approve_scholar_grades() or public.can_decide_sdp_reconsideration() or public.can_approve_renewal_documents();
$$;
revoke all on function public.can_view_renewal_list() from public, anon;
grant execute on function public.can_view_renewal_list() to authenticated;

drop policy if exists "scholar or staff reads renewal documents" on storage.objects;
create policy "scholar or staff reads renewal documents" on storage.objects for select
  using (bucket_id = 'renewal-documents' and ((storage.foldername(name))[1] = public.current_scholar_id_number() or public.can_view_renewals() or public.can_approve_scholar_grades() or public.can_approve_renewal_documents()));

create or replace function public.staff_live_stamp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s text;
begin
  if not (public.can_view_renewals() or public._live_can('can_view_renewal_reports') or public._live_can('can_decide_sdp_reconsideration') or public._live_can('can_approve_scholar_grades') or public._live_can('can_approve_renewal_documents')) then
    raise exception 'Not authorized to follow renewal changes.';
  end if;
  v_s := concat_ws('|',
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_records'),
    public._live_part('select count(*) || '':'' || coalesce(max(at)::text, '''') from public.renewal_history'),
    public._live_part('select count(*) || '':'' || coalesce(max(uploaded_at)::text, '''') || '':'' || coalesce(max(reviewed_at)::text, '''') from public.renewal_documents'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_inc_items'),
    public._live_part('select count(*) || '':'' || coalesce(max(booked_at)::text, '''') || '':'' || coalesce(max(marked_at)::text, '''') from public.counseling_slots where state <> ''open'''),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_counseling_referrals'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_windows'),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.csr_issued'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, requested_at))::text, '''') from public.sdp_reconsideration_requests'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, submitted_at))::text, '''') || '':'' || coalesce(max(official_checked_at)::text, '''') from public.renewal_self_grade_submissions'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.school_period_submissions'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholar_subjects_grades'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholars'),
    public._live_part('select coalesce(updated_at::text, '''') from public.grading_period_settings where id = true'));
  return md5(v_s);
end;
$$;
revoke all on function public.staff_live_stamp() from public, anon;
grant execute on function public.staff_live_stamp() to authenticated;

-- 3. Approve or return a document: the tagged approvers only.
create or replace function public.renewal_review_document(p_document_id uuid, p_approve boolean, p_comment text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.renewal_documents%rowtype;
  r public.renewal_records%rowtype;
  v_label text;
  v_slot public.counseling_slots%rowtype;
  v_cancelled boolean := false;
begin
  if not (public.can_approve_renewal_documents() or public.is_renewal_evaluator()) then raise exception 'Only the Renewal Documents Approver can approve or return these documents.'; end if;
  select * into d from public.renewal_documents where id = p_document_id for update;
  if not found then raise exception 'That document was not found.'; end if;
  -- the study plan, the INC letter and the clearance: the Renewal Documents Approver only; the prospectus (it gates nothing) stays with the evaluator
  if d.kind in ('study_plan', 'inc_letter', 'clearance') then
    if not public.can_approve_renewal_documents() then raise exception 'Only the Renewal Documents Approver can approve or return this document.'; end if;
  elsif not public.is_renewal_evaluator() then
    raise exception 'Only the Scholar Renewal Evaluator can do this.';
  end if;
  select * into r from public.renewal_records where id = d.record_id for update;
  if not (public._renewal_is_active_stage(r.stage) or r.stage = 'returned') then raise exception 'This application is closed, so its documents can no longer be reviewed.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_comment, ''))) < 5 then raise exception 'Please tell the scholar what to fix (at least 5 characters).'; end if;
  v_label := case d.kind when 'study_plan' then 'study plan' when 'inc_letter' then 'INC letter' when 'clearance' then 'clearance' else 'prospectus' end;
  update public.renewal_documents set status = case when p_approve then 'accepted' else 'returned' end,
    reviewer_comment = nullif(btrim(coalesce(p_comment, '')), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = d.id;
  perform public._renewal_log(r.id, r.stage, r.stage, case when p_approve then 'Approved the ' else 'Returned the ' end || v_label || ' (' || d.file_name || ')'
    || case when btrim(coalesce(p_comment, '')) <> '' then ': ' || btrim(p_comment) else '.' end);
  if p_approve then
    perform public._notify_scholar(d.scholar_id_number, case when d.kind = 'study_plan' then 'study_plan_approved' when d.kind = 'inc_letter' then 'inc_letter_approved' else 'document_approved' end,
      'Your ' || v_label || ' was approved',
      case when d.kind in ('study_plan', 'inc_letter', 'clearance') and public._renewal_consult_state(r.id) = 'ok' then 'You can now book your consultation from your Renewal tile.' else 'Thank you.' end, r.id);
  else
    -- A returned study plan / INC letter takes back the booking: the scholar books again once the new one is approved.
    if d.kind in ('study_plan', 'inc_letter', 'clearance') then
      select * into v_slot from public.counseling_slots x where x.record_id = r.id and x.state = 'booked' and x.starts_at > now() for update;
      if found then
        update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, reminded_day_at = null, reminded_hour_at = null where id = v_slot.id;
        perform public._booking_log(r.id, d.scholar_id_number, v_slot.starts_at, v_slot.staff_id, 'removed_by_staff', 'The ' || v_label || ' was returned by the evaluator.');
        perform public._renewal_log(r.id, r.stage, r.stage, 'The consultation on ' || public._manila_slot_text(v_slot.starts_at) || ' was cancelled because the ' || v_label || ' was returned.');
        v_cancelled := true;
      end if;
    end if;
    perform public._notify_scholar(d.scholar_id_number, case when d.kind = 'study_plan' then 'study_plan_returned' else 'document_returned' end,
      'Your ' || v_label || ' was returned', 'The evaluator wrote: ' || btrim(p_comment) || ' Please upload a new one.'
        || case when v_cancelled then ' Your consultation on ' || public._manila_slot_text(v_slot.starts_at) || ' was cancelled; you can book a new time after the new ' || v_label || ' is approved.' else '' end, r.id);
  end if;
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.renewal_review_document(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_review_document(uuid, boolean, text) to authenticated;

-- 4. The list for the Documents tab: the three documents that need approval, oldest waiting first. Read-only for everybody who may see renewals; the approver acts on them with renewal_review_document().
create or replace function public.renewal_documents_queue(p_status text default 'pending', p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  document_id uuid, kind text, file_name text, mime_type text, size_bytes bigint, uploaded_at timestamptz, status text, reviewer_comment text, reviewed_at timestamptz, storage_path text,
  record_id uuid, stage text, school_year text, term text, scholar_id_number text, scholar_name text, school text, program text, year_level text, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not (public.can_approve_renewal_documents() or public.can_view_renewals()) then raise exception 'Not authorized to view the renewal documents.'; end if;
  if coalesce(p_status, 'pending') not in ('pending', 'returned', 'accepted', 'all') then raise exception 'Unknown filter.'; end if;
  return query
  select d.id, d.kind, d.file_name, d.mime_type, d.size_bytes::bigint, d.uploaded_at, d.status, d.reviewer_comment, d.reviewed_at, d.storage_path,
         r.id, r.stage, r.school_year, r.term, s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level,
         count(*) over ()
  from public.renewal_documents d
  join public.renewal_records r on r.id = d.record_id
  join public.scholars s on s.scholar_id_number = d.scholar_id_number
  where d.kind in ('study_plan', 'inc_letter', 'clearance')
    and case coalesce(p_status, 'pending')
          when 'pending' then d.status = 'submitted' and (public._renewal_is_active_stage(r.stage) or r.stage = 'returned')
          when 'returned' then d.status = 'returned'
          when 'accepted' then d.status = 'accepted'
          else true end
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by case when d.status = 'submitted' then 0 else 1 end, case when d.status = 'submitted' then d.uploaded_at end asc, coalesce(d.reviewed_at, d.uploaded_at) desc, d.id
  limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_documents_queue(text, text, integer, integer) from public, anon;
grant execute on function public.renewal_documents_queue(text, text, integer, integer) to authenticated;

create or replace function public.renewal_documents_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_approve_renewal_documents() or public.can_view_renewals()) then raise exception 'Not authorized to view the renewal documents.'; end if;
  return (
    select jsonb_build_object(
      'pending', count(*) filter (where d.status = 'submitted' and (public._renewal_is_active_stage(r.stage) or r.stage = 'returned')),
      'returned', count(*) filter (where d.status = 'returned'),
      'accepted', count(*) filter (where d.status = 'accepted'),
      'all', count(*))
    from public.renewal_documents d join public.renewal_records r on r.id = d.record_id
    where d.kind in ('study_plan', 'inc_letter', 'clearance'));
end;
$$;
revoke all on function public.renewal_documents_counts() from public, anon;
grant execute on function public.renewal_documents_counts() to authenticated;

-- 5. A bell notice for every tagged approver when a scholar sends a document to approve: one per application until the approver has read it (the three documents sent with the application give one notice).
create or replace function public._renewal_docs_notify_approvers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_name text;
  v_label text;
begin
  if new.kind not in ('study_plan', 'inc_letter', 'clearance') or new.status <> 'submitted' then return new; end if;
  select btrim(s.first_name || ' ' || s.last_name) into v_name from public.scholars s where s.scholar_id_number = new.scholar_id_number;
  v_label := case new.kind when 'study_plan' then 'study plan' when 'inc_letter' then 'INC letter' else 'clearance' end;
  for a in select distinct t.staff_id as uid from public.staff_account_tags t where t.tag_key = 'renewal_documents_approver' loop
    if not exists (select 1 from public.notifications n where n.user_id = a.uid and n.reference_id = new.record_id::text and n.title = 'Renewal documents to approve' and not n.read) then
      perform public._notify_staff_member(a.uid, 'Renewal documents to approve', coalesce(v_name, 'A scholar') || ' sent a ' || v_label || ' to approve. Open Scholar Renewal, Documents tab.', new.record_id, coalesce(v_name, ''));
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._renewal_docs_notify_approvers() from public, anon, authenticated;
drop trigger if exists renewal_docs_notify_approvers on public.renewal_documents;
create trigger renewal_docs_notify_approvers after insert on public.renewal_documents for each row execute function public._renewal_docs_notify_approvers();

notify pgrst, 'reload schema';
