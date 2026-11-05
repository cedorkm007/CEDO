-- ─────────────────────────────────────────────────────────────
-- REVERT A RENEWAL APPLICATION (for the Scholar Renewal Evaluator).   Safe to run twice.   Undo: undo_renewal_revert_application.sql
--
-- A new button on a scholar's renewal page: "Revert application". It takes the application back to the very start: the application is removed, so the scholar sees "Apply for
-- renewal" again and applies from nothing. Use it when an application was confirmed (or moved on) by mistake.
--   • Only the Scholar Renewal Evaluator can do it, and a reason is required (at least 5 characters).
--   • It removes the application and everything that belongs only to it: its history, uploaded documents, grades the scholar entered, the SDP reconsideration request, certificate
--     records and notices. A consultation time the scholar had booked is freed. The scholar is told. NO backup copy is kept.
--   • It does NOT touch the scholar's SDP credits, grades in the school's records, scholarship status or any other renewal term. Uploaded files stay in the storage folders.
--   • It REFUSES (and changes nothing) when reverting could leave the scholar's record wrong: the renewal changed the scholarship status (Probationary, Removed ...), the Division Head
--     decided the case, or an SDP reconsideration was APPROVED (it added credits to the next semester). The message says which. Those cases need a person to decide.
--   • A small log (renewal_reverts: who, when, which scholar and term, the stage it was in, the reason) is kept so there is always a record that it was done. It holds no copy of the application.
-- Creates one table and three functions. Changes no existing table. Deletes nothing by itself (only the button, or the one-off file, removes an application).
-- ─────────────────────────────────────────────────────────────

create table if not exists public.renewal_reverts (
  id                 uuid primary key default gen_random_uuid(),
  at                 timestamptz not null default now(),
  by_id              uuid,
  by_name            text not null default '',
  scholar_id_number  text not null,
  school_year        text not null,
  term               text not null,
  previous_stage     text,
  previous_result    text,
  reason             text not null,
  slots_freed        integer not null default 0,
  referrals_removed  integer not null default 0,
  certificates_removed integer not null default 0
);
alter table public.renewal_reverts enable row level security;
drop policy if exists "renewal staff read the revert log" on public.renewal_reverts;
create policy "renewal staff read the revert log" on public.renewal_reverts for select to authenticated using (public.can_view_renewal_reports());
-- no insert / update / delete policy: only the functions below write to it

-- The work itself (no sign-in check: used by the public function below and by the one-off SQL file the developer gives for a single scholar).
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

-- The button.
create or replace function public.renewal_revert_application(p_record_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please write why the application is reverted (at least 5 characters).'; end if;
  return public._renewal_revert_record(p_record_id, p_reason, auth.uid(), public._actor_name(), true);
end;
$$;
revoke all on function public.renewal_revert_application(uuid, text) from public, anon;
grant execute on function public.renewal_revert_application(uuid, text) to authenticated;

notify pgrst, 'reload schema';
