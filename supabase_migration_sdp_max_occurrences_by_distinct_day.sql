-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_max_occurrences_by_distinct_day.sql
--
-- BUG FIX: a recurring activity's allowed scan count was computed as
-- "1 + count(recurring_dates)", assuming recurring_dates only ever
-- holds dates ADDITIONAL to the activity's own date_time. That
-- assumption is false in practice — the Occurrence Dates editor lets
-- staff add any date, including re-entering the activity's own start
-- date (confirmed live on "BULAWANONG BAHANDI 2026": date_time is
-- 2026-09-17, and recurring_dates is [2026-09-17, 2026-09-18] — the
-- first entry duplicates date_time instead of being a third distinct
-- day). The old formula counted this as 1 + 2 = 3 allowed scans for
-- what is actually a 2-day event.
--
-- Fixed to count DISTINCT CALENDAR DATES across date_time and every
-- recurring_dates entry, rather than adding counts blindly — for
-- BULAWANONG this now correctly computes 2 (2026-09-17 appears twice
-- but counts once, plus 2026-09-18), not 3.
--
-- redeem_attendance_code() and _finalize_survey_gated_attendance()
-- (which reads voucher_redemption_count off an already-locked row
-- rather than recomputing v_max_occurrences, so it needs no change)
-- are otherwise byte-for-byte unchanged from
-- supabase_migration_sdp_category_cap_and_hours_fix.sql — only the
-- v_max_occurrences calculation changes.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

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
  v_sdp_date_time timestamptz;
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
    select activity_type, recurring_dates, date_time into v_sdp_activity_type, v_sdp_recurring_dates, v_sdp_date_time
      from public.sdp_activities where id = v_session.sdp_activity_id;
    if v_sdp_activity_type = 'recurring' then
      -- Distinct calendar days across date_time and every recorded
      -- occurrence date — not a blind "1 + count", since an occurrence
      -- date can duplicate date_time's own day (see migration header).
      select count(distinct occurrence_day) into v_max_occurrences
      from (
        select v_sdp_date_time::date as occurrence_day
        union
        select (elem->>'date')::timestamptz::date as occurrence_day
        from jsonb_array_elements(coalesce(v_sdp_recurring_dates, '[]'::jsonb)) as elem
      ) all_days;
      v_max_occurrences := greatest(coalesce(v_max_occurrences, 1), 1);
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
