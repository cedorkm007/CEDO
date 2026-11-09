-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_reconsideration_auto_close.sql
-- A waiting SDP reconsideration request is CLOSED AUTOMATICALLY (status "not needed") as soon as the scholar's SDP credits for the semester it looks at are complete.
-- It happens in the same automatic re-check that already runs whenever SDP credits are added, changed or removed (so nobody has to press Approve / Deny just to close it).
-- What it does for each such request: marks it "not needed" (decided by "System", with a note), tells the scholar (the same message the Approve / Deny button sent in this case),
-- writes a line in the renewal's history, re-checks the application (so an application on hold for SDP moves on) and refreshes the staff list's saved check.
-- A request whose scholar still lacks credits is untouched. Requests that are ALREADY waiting while the credits are complete are closed once, when this file is run.
-- Needs supabase_migration_sdp_reconsideration_live_lacking.sql (the helper _sdp_live_lacking). Safe to run twice.
-- ─────────────────────────────────────────────────────────────
begin;

create or replace function public._sdp_close_unneeded_requests(p_scholar_id_number text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sdp_reconsideration_requests%rowtype;
  v_lack jsonb;
  v_stage text;
  v_closed integer := 0;
begin
  for r in select * from public.sdp_reconsideration_requests q where q.scholar_id_number = p_scholar_id_number and q.status = 'pending' for update loop
    v_lack := public._sdp_live_lacking(r.scholar_id_number, r.basis_school_year, r.basis_term);
    continue when coalesce((v_lack ->> 'community_service')::integer, 0) + coalesce((v_lack ->> 'community_volunteerism')::integer, 0) + coalesce((v_lack ->> 'formation_program')::integer, 0) > 0;
    update public.sdp_reconsideration_requests set status = 'not_needed', decided_by = null, decided_by_label = 'System', decided_at = now(),
      decision_note = 'The SDP credits became complete before the request was decided, so it was closed automatically: no reconsideration was needed.' where id = r.id;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_closed', 'No SDP reconsideration needed',
      'Your SDP credits for ' || public._renewal_term_label(r.basis_school_year, r.basis_term) || ' are now complete, so your reconsideration request is closed and nothing is added to your next SDP requirement.', r.record_id);
    if r.record_id is not null then
      select stage into v_stage from public.renewal_records where id = r.record_id;
      perform public._renewal_log(r.record_id, v_stage, v_stage, 'SDP reconsideration closed automatically: the SDP credits are now complete.', 'System');
    end if;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;
revoke all on function public._sdp_close_unneeded_requests(text) from public, anon, authenticated;

-- The automatic re-check of a scholar's applications (runs when credits, grades or documents change): first close the requests that are not needed any more, then re-check as before.
create or replace function public._renewal_recheck_scholar(p_scholar_id_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_closed integer;
begin
  v_closed := public._sdp_close_unneeded_requests(p_scholar_id_number);
  for r in select id from public.renewal_records where scholar_id_number = p_scholar_id_number loop
    perform public._renewal_recheck(r.id);
  end loop;
  if v_closed > 0 then
    perform public._renewal_scholar_list_refresh_one(p_scholar_id_number, q.school_year, q.term) from public.sdp_reconsideration_requests q
      where q.scholar_id_number = p_scholar_id_number and q.status = 'not_needed' and q.decided_by_label = 'System' and q.decided_at > now() - interval '1 minute';
  end if;
end;
$$;
revoke all on function public._renewal_recheck_scholar(text) from public, anon, authenticated;

-- Requests that are already waiting while the credits are complete: close them once now.
select public._renewal_recheck_scholar(x.scholar_id_number)
from (select distinct scholar_id_number from public.sdp_reconsideration_requests where status = 'pending') x;

commit;
