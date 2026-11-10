-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_revert_keep_sdp_approval.sql
-- "Revert application" used to be REFUSED when an SDP reconsideration was approved for the application, because the approval added the lacking credits to the scholar's NEXT semester requirement and removing the
-- application would have removed the approval and those credits with it. Now the revert is allowed and the approval STAYS: the approved request (and the credits it added) is kept, only detached from the removed
-- application. When the scholar applies again the request is attached to the new application and the SDP counts as approved, so the scholar does not ask again.
-- Still refused (unchanged): a scholar removed by the renewal, a renewal that changed the scholarship status, a case the Division Head decided. Needs supabase_migration_renewal_revert_application.sql. Safe to run twice.
-- ─────────────────────────────────────────────────────────────

begin;

create or replace function public._renewal_revert_record(p_record_id uuid, p_reason text, p_actor_id uuid, p_actor_name text, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_status text;
  v_slots integer := 0;
  v_refs integer := 0;
  v_csr integer := 0;
  v_label text;
  v_kept integer := 0;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal application was not found (it may already have been reverted).'; end if;
  select s.status into v_status from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  if v_rec.stage = 'removed' or v_status = 'Removed' then
    raise exception 'This scholar was removed from the scholarship by this renewal. That cannot be reverted here: it needs a person to restore the scholar.';
  end if;
  if exists (select 1 from public.scholar_status_history h where h.scholar_id_number = v_rec.scholar_id_number and h.source = 'renewal' and h.school_year = v_rec.school_year and h.term = v_rec.term) then
    raise exception 'This renewal changed the scholar''s scholarship status (for example to Probationary). That cannot be reverted here, because the status would stay changed. It needs a person to decide.';
  end if;
  if v_rec.division_head_decision is not null or v_rec.stage in ('reconsidered', 'division_head_approved') then
    raise exception 'The Division Head has already decided this case. That cannot be reverted here.';
  end if;
  -- an APPROVED SDP reconsideration no longer blocks the revert: it stays approved (and the credits it added to the next semester stay), see below

  -- what belongs to this application only
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null where record_id = v_rec.id and state = 'booked';
  get diagnostics v_slots = row_count;
  delete from public.scholar_counseling_referrals where renewal_record_id = v_rec.id;
  get diagnostics v_refs = row_count;
  delete from public.csr_issued where record_id = v_rec.id;
  get diagnostics v_csr = row_count;
  delete from public.scholar_notifications where record_id = v_rec.id;
  delete from public.renewal_notice_log where scholar_id_number = v_rec.scholar_id_number and ref = v_rec.id::text;
  insert into public.renewal_reverts (by_id, by_name, scholar_id_number, school_year, term, previous_stage, previous_result, reason, slots_freed, referrals_removed, certificates_removed)
  values (p_actor_id, coalesce(p_actor_name, ''), v_rec.scholar_id_number, v_rec.school_year, v_rec.term, v_rec.stage, v_rec.result, btrim(p_reason), v_slots, v_refs, v_csr);
  -- an approved SDP reconsideration request is KEPT as it is: it is only detached from the application that is removed (the credits it added to the next semester stay). When the scholar applies again it is
  -- attached to the new application (trigger renewal_relink_sdp_request) and the SDP still counts as approved, so the scholar does not ask again. A waiting or denied request is removed with the application, as before.
  update public.sdp_reconsideration_requests set record_id = null where record_id = v_rec.id and status = 'approved';
  get diagnostics v_kept = row_count;
  delete from public.renewal_records where id = v_rec.id;      -- its history, documents, entered grades, SDP reconsideration request ... go with it

  if p_notify then
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal was reset',
      'Your renewal application for ' || v_label || ' was reset by the evaluator. Please apply again from your Renewal tile.' || case when v_kept > 0 then ' Your approved SDP reconsideration stays approved: you do not need to ask for it again.' else '' end, null);
  end if;
  return jsonb_build_object('scholar_id_number', v_rec.scholar_id_number, 'term', v_label, 'previous_stage', v_rec.stage, 'slots_freed', v_slots, 'referrals_removed', v_refs, 'certificates_removed', v_csr, 'sdp_approval_kept', v_kept > 0);
end;
$$;
revoke all on function public._renewal_revert_record(uuid, text, uuid, text, boolean) from public, anon, authenticated;

-- A new application takes over the approved SDP reconsideration request that was kept when an earlier application of the same term was reverted.
create or replace function public._renewal_relink_sdp_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sdp_reconsideration_requests set record_id = new.id
  where scholar_id_number = new.scholar_id_number and school_year = new.school_year and term = new.term and record_id is null;
  return null;
end;
$$;
revoke all on function public._renewal_relink_sdp_request() from public, anon, authenticated;
drop trigger if exists renewal_relink_sdp_request on public.renewal_records;
create trigger renewal_relink_sdp_request after insert on public.renewal_records for each row execute function public._renewal_relink_sdp_request();

commit;
