-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring: A SCHOLAR CAN SCAN ONLY ONE QR CODE PER BATCH.   Safe to run twice.   Undo: undo_sdp_scan_one_per_batch.sql
-- Run AFTER the Phase 4 file (supabase_migration_sdp_update_p4_day_labels.sql).
--
-- Today a scholar cannot use two codes of the same DAY, but codes printed without a date (or printed together as one batch for a recurring activity) can be
-- scanned by the same scholar more than once, each scan giving another credit. This adds the rule that matches how the codes are printed:
--   • one scholar, one batch, one kind of code (time-in, time-out, voucher): ONE scan only. A second code from the same batch is refused and is NOT used up;
--   • codes from DIFFERENT batches of the same SDP activity can each be scanned (a new batch for each day of a recurring activity), as before limited by the
--     number of days of the activity, and by the Phase 4 rule of one code per day;
--   • Formation activities, monitor ID-card scans and everything else are unchanged.
-- Creates/replaces ONE FUNCTION only (the same text as Phase 4 plus the new check). No table is changed or locked.
-- ─────────────────────────────────────────────────────────────
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_code public.attendance_codes%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype;
  v_updated uuid;
  v_result jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid QR code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This QR code has already been claimed.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  if v_session.formation_activity_id is not null and not exists (
    select 1 from public.formation_activities a where a.id = v_session.formation_activity_id
    and (a.all_year_levels or v_scholar.year_level = any(a.target_year_levels))
  ) then raise exception 'You are not eligible to attend this activity.'; end if;

  -- Atomic claim. If the scan is then refused below, the whole call is undone, so the code is NOT used up.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  -- A code made for one day of a recurring activity: one code per day (and per kind) for each scholar. The refusal undoes the claim above.
  if v_code.day_date is not null and exists (
    select 1 from public.attendance_codes c
    where c.session_id = v_code.session_id and c.kind = v_code.kind and c.day_date = v_code.day_date
      and c.redeemed_by_scholar_id = v_scholar.scholar_id_number and c.id <> v_code.id
  ) then
    raise exception 'You already scanned a code for this day%.', coalesce(' (' || nullif(public._sdp_day_sub_name(v_session.sdp_activity_id, v_code.day_date), '') || ')', '');
  end if;

  -- SDP activities that can be credited more than once: one code of each kind from the same batch for each scholar.
  -- (An activity that can be credited only once keeps its plain "already completed" message below.)
  if v_session.sdp_activity_id is not null and public._sdp_allowed_occurrences(v_session.sdp_activity_id) > 1 and exists (
    select 1 from public.attendance_codes c
    where c.session_id = v_code.session_id and c.kind = v_code.kind and coalesce(c.batch_number, 1) = coalesce(v_code.batch_number, 1)
      and c.redeemed_by_scholar_id = v_scholar.scholar_id_number and c.id <> v_code.id
  ) then
    raise exception 'You already scanned a code from this batch. Another credit needs a QR code from a different batch.';
  end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, v_code.kind, v_code.day_date);
  if (v_result ->> 'alreadyScanned')::boolean then
    if (v_result ->> 'maxAttempts')::integer > 1 then
      raise exception 'You already completed this attendance requirement (% of % allowed attendances used).', v_result ->> 'attemptsUsed', v_result ->> 'maxAttempts';
    else
      raise exception 'You already completed this attendance requirement.';
    end if;
  end if;

  return v_result;
end;
$function$;
revoke all on function public.redeem_attendance_code(text) from public, anon;
grant execute on function public.redeem_attendance_code(text) to authenticated;

notify pgrst, 'reload schema';
