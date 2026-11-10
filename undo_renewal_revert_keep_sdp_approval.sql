-- ─────────────────────────────────────────────────────────────
-- undo_renewal_revert_keep_sdp_approval.sql
-- Puts the revert back as it was: an application with an approved SDP reconsideration cannot be reverted. Requests already kept stay as they are.
-- ─────────────────────────────────────────────────────────────

begin;

drop trigger if exists renewal_relink_sdp_request on public.renewal_records;
drop function if exists public._renewal_relink_sdp_request();

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
  if exists (select 1 from public.sdp_reconsideration_requests q where q.record_id = v_rec.id and q.status = 'approved') then
    raise exception 'An SDP reconsideration was approved for this renewal (it added credits to the next semester). That cannot be reverted here.';
  end if;

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
  delete from public.renewal_records where id = v_rec.id;      -- its history, documents, entered grades, SDP reconsideration request ... go with it

  if p_notify then
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal was reset',
      'Your renewal application for ' || v_label || ' was reset by the evaluator. Please apply again from your Renewal tile.', null);
  end if;
  return jsonb_build_object('scholar_id_number', v_rec.scholar_id_number, 'term', v_label, 'previous_stage', v_rec.stage, 'slots_freed', v_slots, 'referrals_removed', v_refs, 'certificates_removed', v_csr);
end;
$$;
revoke all on function public._renewal_revert_record(uuid, text, uuid, text, boolean) from public, anon, authenticated;

commit;
