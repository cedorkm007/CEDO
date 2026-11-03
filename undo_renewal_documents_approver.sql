-- UNDO for supabase_migration_renewal_documents_approver.sql: the Scholar Renewal Evaluator approves and returns the three documents again; the Documents tab functions, the notice trigger and the tag check are removed.
-- Accounts that hold the tag keep it (it does nothing without the file). Nothing is deleted from a table.

drop trigger if exists renewal_docs_notify_approvers on public.renewal_documents;
drop function if exists public._renewal_docs_notify_approvers();
drop function if exists public.renewal_documents_counts();
drop function if exists public.renewal_documents_queue(text, text, integer, integer);

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
  perform public._renewal_require_evaluator();
  select * into d from public.renewal_documents where id = p_document_id for update;
  if not found then raise exception 'That document was not found.'; end if;
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
  if not (public.can_view_renewals() or public._live_can('can_view_renewal_reports') or public._live_can('can_decide_sdp_reconsideration') or public._live_can('can_approve_scholar_grades')) then
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

drop policy if exists "scholar or staff reads renewal documents" on storage.objects;
create policy "scholar or staff reads renewal documents" on storage.objects for select
  using (bucket_id = 'renewal-documents' and ((storage.foldername(name))[1] = public.current_scholar_id_number() or public.can_view_renewals() or public.can_approve_scholar_grades()));

create or replace function public.can_view_renewal_list()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_renewals() or public.can_approve_scholar_grades() or public.can_decide_sdp_reconsideration();
$$;
revoke all on function public.can_view_renewal_list() from public, anon;
grant execute on function public.can_view_renewal_list() to authenticated;

drop function if exists public.can_approve_renewal_documents();

notify pgrst, 'reload schema';
