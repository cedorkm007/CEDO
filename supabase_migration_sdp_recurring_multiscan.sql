-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_recurring_multiscan.sql
--
-- Lets a scholar redeem a VOUCHER-type QR code multiple times for a
-- RECURRING SDP activity — once per occurrence date (1 + however many
-- extra dates are recorded in sdp_activities.recurring_dates), instead
-- of today's hard "once ever" limit. Time-in/Time-out activities are
-- explicitly UNCHANGED (still single-redemption) — pairing multiple
-- time-in/time-out cycles correctly is a materially bigger change,
-- deliberately out of scope here.
--
-- Scope, confirmed with the person before writing this:
--   - Voucher-type recurring activities only.
--   - Each additional scan adds more hours_earned (attendance_records
--     already had dead upsert code for this — it just could never run,
--     since the old "already completed" gate blocked any 2nd voucher
--     redemption outright) AND another full sdp_attendance credit
--     toward the scholar's 3-required-credits-per-category total —
--     harmless if it pushes a category past 3, since category
--     completion is already a >=3 threshold, not an exact cap.
--   - QR codes themselves are UNCHANGED — still single-use, one code
--     per redemption, drawn from the same pre-generated pool. If staff
--     run low before a later occurrence, they already have "Add
--     attendance vouchers" to top up the batch — no new mechanism
--     needed here.
--
-- Schema changes:
--   1. attendance_records gains voucher_redemption_count (int, default
--      0) — an explicit counter, since the row is still ONE row per
--      (session_id, scholar_id_number) [confirmed live: that pair is
--      literally the table's primary key], just with hours_earned and
--      this new counter both accumulating across scans instead of a
--      single boolean "has a row" fact.
--   2. sdp_attendance's unique constraint moves from
--      (activity_id, scholar_id_number) to
--      (activity_id, scholar_id_number, occurrence_number) — a new
--      occurrence_number column (default 1) lets multiple credit rows
--      exist for the same activity+scholar, one per occurrence,
--      correctly summed by the existing recompute_sdp_category_status()
--      trigger (sum(act.credits) over every sdp_attendance row — that
--      trigger needs NO changes, it already sums per row rather than
--      counting distinct activities). Existing rows default to
--      occurrence_number = 1, identical to today's one-row-per-activity
--      shape — fully backward compatible.
--
-- redeem_attendance_code() and _finalize_survey_gated_attendance() are
-- re-created here with their bodies otherwise UNCHANGED from
-- supabase_migration_sdp_qr_attendance_auto_credit.sql (confirmed via
-- pg_get_functiondef before writing this) — the diff is: (a) the
-- voucher branch of the "already completed" gate now compares a count
-- against the activity's allowed-occurrences instead of a bare
-- exists() check, (b) the voucher upsert increments
-- voucher_redemption_count, and (c) the sdp_attendance insert loops
-- occurrence_number 1..current-count with on-conflict-do-nothing
-- instead of a single (activity_id, scholar_id_number) upsert — this
-- loop is what makes the finalize path (survey-gated attendance,
-- which only fires once when the survey resolves) correctly backfill
-- credit for every occurrence scanned while gated, not just the
-- latest one.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.attendance_records
  add column if not exists voucher_redemption_count integer not null default 0;

alter table public.sdp_attendance
  add column if not exists occurrence_number integer not null default 1;

alter table public.sdp_attendance
  drop constraint if exists sdp_attendance_activity_id_scholar_id_number_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sdp_attendance_activity_scholar_occurrence_key'
  ) then
    alter table public.sdp_attendance
      add constraint sdp_attendance_activity_scholar_occurrence_key
      unique (activity_id, scholar_id_number, occurrence_number);
  end if;
end $$;

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

  -- NEW: for a voucher code tied to a RECURRING sdp_activity, allow up
  -- to (1 + number of recorded extra occurrence dates) redemptions
  -- instead of the usual one. Everything else (time_in/time_out,
  -- one_time activities, Formation sessions) keeps v_max_occurrences=1,
  -- i.e. today's exact behavior.
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
  -- credit them for the activity — same effect as staff manually
  -- crediting attendance, just triggered by their own QR scan. Loops
  -- 1..current-voucher-count (always exactly 1 for time_in/time_out,
  -- via greatest(...,1)) with on-conflict-do-nothing per occurrence, so
  -- re-running this for an already-credited occurrence is a no-op and
  -- a scholar who scanned N times gets N summed credits.
  if v_session.sdp_activity_id is not null then
    select status, voucher_redemption_count into v_final_status, v_final_voucher_count
      from public.attendance_records where session_id = v_session.id and scholar_id_number = v_scholar.scholar_id_number;
    if v_final_status = 'present' then
      for v_occurrence in 1..greatest(coalesce(v_final_voucher_count, 0), 1) loop
        insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number)
        values (v_session.sdp_activity_id, v_scholar.scholar_id_number, current_date, null, v_occurrence)
        on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
      end loop;
    end if;
  end if;

  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id);
end; $function$;

create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare v_rec record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
begin
  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    -- Same SDP auto-credit as redeem_attendance_code()'s direct path —
    -- this scholar just became 'present' for this session too, it just
    -- took resolving the gating survey first. Loops 1..voucher-count
    -- (captured on v_rec at lock time) so every occurrence scanned
    -- while the survey was still pending gets backfilled, not just the
    -- most recent one.
    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      for v_occurrence in 1..greatest(coalesce(v_rec.voucher_redemption_count, 0), 1) loop
        insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number)
        values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence)
        on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
      end loop;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
