-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_category_cap_and_hours_fix.sql
--
-- Two changes to redeem_attendance_code() / _finalize_survey_gated_
-- attendance(), plus a bug fix underneath them:
--
-- 1. BUG FIX: hours_earned was being written by TWO independent,
--    uncoordinated mechanisms on every voucher redemption —
--    redeem_attendance_code()'s own upsert (adds duration_hours), and
--    a trigger (trg_attendance_code_redeemed -> recompute_attendance_
--    record(), not defined in any checked-in migration — found via
--    pg_trigger while testing the recurring-multiscan feature) that
--    independently recomputes hours_earned as a raw count of claimed
--    voucher codes and overwrites the row BEFORE redeem_attendance_
--    code()'s own upsert runs (same statement — the trigger fires
--    synchronously off the "claim the code" UPDATE, which happens
--    first). The result: every voucher scan's hours_earned included
--    the trigger's write, then had duration_hours added on top again,
--    compounding with each scan (confirmed live: 3 scans at
--    duration_hours=2 produced hours_earned=5, not 6, because of how
--    the two writes interleave — not even a clean double, just wrong).
--    redeem_attendance_code() already fully owns attendance_records
--    for all three kinds (time_in/time_out/voucher), including
--    survey-gating and (as of the recurring-multiscan migration)
--    voucher_redemption_count — things this trigger has no concept of.
--    Dropping the trigger removes the redundant/conflicting writer;
--    for time_in/time_out this is a no-op (redeem_attendance_code()'s
--    own coalesce()-based upsert already produces the same values the
--    trigger did), and for voucher it's the actual fix.
--
-- 2. Once a scholar's SDP category total has already reached the
--    3-credit completion threshold, further QR scans (any activity in
--    that category, recurring or not) still succeed and still update
--    attendance_records (status/hours — genuine attendance monitoring
--    value even after the requirement is met), but no longer insert a
--    new sdp_attendance credit row. The RPC now returns a
--    categoryCompleted flag so the scholar-facing UI can show "you've
--    already completed this requirement — this scan is for attendance
--    monitoring only" instead of the normal success message. This
--    check runs against the scholar's TOTAL category credits
--    (including this same activity's own earlier occurrences), so it
--    composes correctly with the recurring-multiscan feature: a
--    recurring activity can still be scanned for every remaining
--    occurrence, but only the scans before the category hits 3 grant
--    credit — the rest are monitoring-only from that point on.
--
-- redeem_attendance_code() and _finalize_survey_gated_attendance() are
-- otherwise byte-for-byte unchanged from
-- supabase_migration_sdp_recurring_multiscan.sql.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop trigger if exists trg_attendance_code_redeemed on public.attendance_codes;
drop function if exists public.recompute_attendance_record();

create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype; v_name text; v_updated uuid;
  v_activity_id uuid; v_survey_gate_id uuid;
  v_final_status text;
  v_max_occurrences integer := 1;
  v_existing_voucher_count integer := 0;
  v_sdp_activity_type text;
  v_sdp_recurring_dates jsonb;
  v_final_voucher_count integer;
  v_occurrence integer;
  v_sdp_category text;
  v_prior_category_credits integer;
  v_category_completed boolean := false;
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

  if v_code.kind = 'voucher' and v_session.sdp_activity_id is not null then
    select activity_type, recurring_dates into v_sdp_activity_type, v_sdp_recurring_dates
      from public.sdp_activities where id = v_session.sdp_activity_id;
    if v_sdp_activity_type = 'recurring' then
      v_max_occurrences := 1 + jsonb_array_length(coalesce(v_sdp_recurring_dates, '[]'::jsonb));
    end if;
    select coalesce(r.voucher_redemption_count, 0) into v_existing_voucher_count
      from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number;
    v_existing_voucher_count := coalesce(v_existing_voucher_count, 0);
  end if;

  if exists (
    select 1 from public.attendance_records r
    where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number
      and (
        (v_code.kind = 'time_in' and r.time_in_at is not null)
        or (v_code.kind = 'time_out' and r.time_out_at is not null)
        or (v_code.kind = 'voucher' and coalesce(r.voucher_redemption_count, 0) >= v_max_occurrences)
      )
  ) then
    if v_code.kind = 'voucher' and v_max_occurrences > 1 then
      raise exception 'You already completed this attendance requirement (% of % allowed attendances used).', v_existing_voucher_count, v_max_occurrences;
    else
      raise exception 'You already completed this attendance requirement.';
    end if;
  end if;
  -- Atomic claim — unchanged. Must happen before any survey check below.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  v_survey_gate_id := null;
  if v_code.kind in ('time_out', 'voucher') then
    v_activity_id := coalesce(v_session.sdp_activity_id, v_session.formation_activity_id);
    select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = v_scholar.scholar_id_number and r.status in ('completed', 'declined')
    ) then
      v_survey_gate_id := null; -- already resolved this survey (completed or declined) — nothing to gate
    end if;
  end if;

  if v_code.kind = 'time_in' then
    insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status)
      values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete')
      on conflict(session_id,scholar_id_number) do update
        set time_out_at=coalesce(attendance_records.time_out_at,excluded.time_out_at),
            status=case
              when attendance_records.time_in_at is null then 'incomplete'
              when v_survey_gate_id is not null then 'pending_survey'
              else 'present'
            end,
            pending_survey_id=case when attendance_records.time_in_at is not null then v_survey_gate_id else null end,
            updated_at=now();
  else
    insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status,pending_survey_id,voucher_redemption_count)
      values(v_session.id,v_scholar.scholar_id_number,coalesce(v_session.duration_hours,1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id, 1)
      on conflict(session_id,scholar_id_number) do update
        set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),
            status=case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id=v_survey_gate_id,
            voucher_redemption_count=attendance_records.voucher_redemption_count+1,
            updated_at=now();
  end if;

  -- If this scholar is now (or already) 'present' for an SDP session,
  -- credit them for the activity — UNLESS their category is already at
  -- the 3-credit completion threshold, in which case this scan still
  -- counts as attendance (hours/status above are already recorded) but
  -- is monitoring-only: no new credit, and categoryCompleted is
  -- returned so the scholar sees that explicitly.
  if v_session.sdp_activity_id is not null then
    select status, voucher_redemption_count into v_final_status, v_final_voucher_count
      from public.attendance_records where session_id = v_session.id and scholar_id_number = v_scholar.scholar_id_number;
    if v_final_status = 'present' then
      select category into v_sdp_category from public.sdp_activities where id = v_session.sdp_activity_id;
      select coalesce(sum(act.credits), 0) into v_prior_category_credits
        from public.sdp_attendance a join public.sdp_activities act on act.id = a.activity_id
        where a.scholar_id_number = v_scholar.scholar_id_number and act.category = v_sdp_category;
      if v_sdp_category is not null and v_prior_category_credits >= 3 then
        v_category_completed := true;
      else
        for v_occurrence in 1..greatest(coalesce(v_final_voucher_count, 0), 1) loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number)
          values (v_session.sdp_activity_id, v_scholar.scholar_id_number, current_date, null, v_occurrence)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;
  end if;

  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id,'categoryCompleted', v_category_completed);
end; $function$;

create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_prior_category_credits integer;
begin
  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    -- Same SDP auto-credit as redeem_attendance_code()'s direct path,
    -- including the same category-completion cap.
    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      select category into v_sdp_category from public.sdp_activities where id = v_sdp_activity_id;
      select coalesce(sum(act.credits), 0) into v_prior_category_credits
        from public.sdp_attendance a join public.sdp_activities act on act.id = a.activity_id
        where a.scholar_id_number = p_scholar_id_number and act.category = v_sdp_category;
      if v_sdp_category is null or v_prior_category_credits < 3 then
        for v_occurrence in 1..greatest(coalesce(v_rec.voucher_redemption_count, 0), 1) loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number)
          values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
