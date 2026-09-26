-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_reserved_credits.sql
--
-- SDP credits were a pure lifetime running total per category, capped at
-- 3, with no period concept anywhere — once a scholar hit 3 lifetime
-- credits in a category, further scans still logged general attendance
-- (attendance_records) but silently discarded the credit. This migration:
--
--   1. Makes the displayed/cap-checked credit count PERIOD-SCOPED,
--      reusing the grading_period_settings singleton already built for
--      Scholars' Grades Monitoring (supabase_migration_scholars_grades_
--      monitoring.sql) rather than inventing a second period tracker.
--   2. Banks credit that would otherwise be discarded into a new
--      sdp_reserved_credits table instead, so it can be manually applied
--      ("claimed") toward a later period's requirement.
--
-- Explicitly UNCHANGED: scholar_sdp_category_status and its live trigger
-- recompute_sdp_category_status() (not in any checked-in migration —
-- confirmed via pg_trigger/pg_proc) — the lifetime "ever completed this
-- category" flag used for scholarship-renewal-eligibility history. Only
-- the current-period display/cap logic below is period-aware.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Period-stamp sdp_attendance ──────────────────────────
alter table public.sdp_attendance add column if not exists school_year text;
alter table public.sdp_attendance add column if not exists semester text;

-- Backfill: existing credits keep counting toward whichever period is
-- current AT MIGRATION TIME, so scholars who already hit 3 don't reset
-- to 0/3 the moment this ships.
update public.sdp_attendance a
set school_year = gps.current_school_year, semester = gps.current_semester
from public.grading_period_settings gps
where gps.id = true and a.school_year is null;

-- ── 2. Single source of truth for the per-category cap ──────
create or replace function public.sdp_category_credit_goal()
returns integer
language sql
immutable
as $$ select 3; $$;

-- ── 3. Reserved (banked excess) credits ──────────────────────
create table if not exists public.sdp_reserved_credits (
  id uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  category text not null check (category in ('community_service', 'community_volunteerism', 'formation_program')),
  amount integer not null check (amount > 0),
  source_school_year text,
  source_semester text,
  claimed boolean not null default false,
  claimed_school_year text,
  claimed_semester text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists idx_sdp_reserved_credits_scholar on public.sdp_reserved_credits(scholar_id_number, category, claimed);

alter table public.sdp_reserved_credits enable row level security;

drop policy if exists "sdp staff read access" on public.sdp_reserved_credits;
create policy "sdp staff read access" on public.sdp_reserved_credits for select
  using (public.has_staff_tag('sdp_monitoring'));

-- No scholar-facing RLS policy — scholars only ever touch this table
-- through the two security-definer RPCs below, which bypass RLS.

-- ── 4. Period-scoped credit total (attendance this period + reserves
--       claimed into this period) — shared formula used by both the
--       scholar RPC and the staff checklist below. ────────────────
create or replace function public._sdp_period_credits(p_scholar_id_number text, p_category text, p_school_year text, p_semester text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(act.credits) from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      where a.scholar_id_number = p_scholar_id_number and act.category = p_category
        and a.school_year = p_school_year and a.semester = p_semester
    ), 0)
    +
    coalesce((
      select sum(rc.amount) from public.sdp_reserved_credits rc
      where rc.scholar_id_number = p_scholar_id_number and rc.category = p_category
        and rc.claimed and rc.claimed_school_year = p_school_year and rc.claimed_semester = p_semester
    ), 0);
$$;

-- ── 5. Scholar-facing RPCs ────────────────────────────────────
create or replace function public.fetch_scholar_sdp_progress()
returns table(category text, credits integer, reserved integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_scholar_id_number text;
  v_school_year text;
  v_semester text;
begin
  select s.scholar_id_number into v_scholar_id_number from public.scholars s where s.id = auth.uid();
  if v_scholar_id_number is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  return query
  select c.key,
    public._sdp_period_credits(v_scholar_id_number, c.key, v_school_year, v_semester),
    coalesce((
      select sum(rc.amount) from public.sdp_reserved_credits rc
      where rc.scholar_id_number = v_scholar_id_number and rc.category = c.key and not rc.claimed
    ), 0)::integer
  from (values ('community_service'), ('community_volunteerism'), ('formation_program')) as c(key);
end;
$function$;
grant execute on function public.fetch_scholar_sdp_progress() to authenticated;

create or replace function public.claim_sdp_reserved_credits(p_category text)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_scholar_id_number text;
  v_school_year text;
  v_semester text;
  v_total integer;
begin
  select s.scholar_id_number into v_scholar_id_number from public.scholars s where s.id = auth.uid();
  if v_scholar_id_number is null then raise exception 'Only signed-in scholars can claim SDP reserved credits.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  select coalesce(sum(amount), 0) into v_total from public.sdp_reserved_credits
    where scholar_id_number = v_scholar_id_number and category = p_category and not claimed;

  update public.sdp_reserved_credits
  set claimed = true, claimed_school_year = v_school_year, claimed_semester = v_semester, claimed_at = now()
  where scholar_id_number = v_scholar_id_number and category = p_category and not claimed;

  return v_total;
end;
$function$;
grant execute on function public.claim_sdp_reserved_credits(text) to authenticated;

-- ── 6. Staff checklist — period-scoped + reserved columns ────
drop function if exists public.scholars_sdp_checklist();

create or replace function public.scholars_sdp_checklist()
returns table(
  scholar_id_number text, name text,
  community_service integer, community_volunteerism integer, formation_program integer,
  community_service_reserved integer, community_volunteerism_reserved integer, formation_program_reserved integer
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_school_year text;
  v_semester text;
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  return query
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name,
    public._sdp_period_credits(s.scholar_id_number, 'community_service', v_school_year, v_semester),
    public._sdp_period_credits(s.scholar_id_number, 'community_volunteerism', v_school_year, v_semester),
    public._sdp_period_credits(s.scholar_id_number, 'formation_program', v_school_year, v_semester),
    coalesce((select sum(rc.amount) from public.sdp_reserved_credits rc where rc.scholar_id_number = s.scholar_id_number and rc.category = 'community_service' and not rc.claimed), 0)::integer,
    coalesce((select sum(rc.amount) from public.sdp_reserved_credits rc where rc.scholar_id_number = s.scholar_id_number and rc.category = 'community_volunteerism' and not rc.claimed), 0)::integer,
    coalesce((select sum(rc.amount) from public.sdp_reserved_credits rc where rc.scholar_id_number = s.scholar_id_number and rc.category = 'formation_program' and not rc.claimed), 0)::integer
  from public.scholars s
  where s.status <> 'Removed'
  order by s.last_name, s.first_name;
end;
$function$;

revoke all on function public.scholars_sdp_checklist() from public;
grant execute on function public.scholars_sdp_checklist() to authenticated;

-- ── 7. redeem_attendance_code() — period-scoped cap + banking ─
-- Byte-for-byte identical to supabase_migration_sdp_category_cap_and_
-- hours_fix.sql except: (a) the category-completion check is now
-- scoped to the current grading period instead of scholar lifetime,
-- (b) sdp_attendance inserts are stamped with the current period, and
-- (c) crediting that would be discarded once already at cap for this
-- period is instead banked into sdp_reserved_credits.
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
  v_school_year text;
  v_semester text;
  v_activity_credits integer;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

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
  -- the cap FOR THE CURRENT PERIOD, in which case this scan still counts
  -- as attendance (hours/status above are already recorded) but the
  -- credit is banked as reserved for a later period instead of being
  -- discarded.
  if v_session.sdp_activity_id is not null then
    select status, voucher_redemption_count into v_final_status, v_final_voucher_count
      from public.attendance_records where session_id = v_session.id and scholar_id_number = v_scholar.scholar_id_number;
    if v_final_status = 'present' then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_session.sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(v_scholar.scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        v_category_completed := true;
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (v_scholar.scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        for v_occurrence in 1..greatest(coalesce(v_final_voucher_count, 0), 1) loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (v_session.sdp_activity_id, v_scholar.scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester)
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
  v_school_year text; v_semester text; v_activity_credits integer;
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    -- Same SDP auto-credit as redeem_attendance_code()'s direct path,
    -- including the same period-scoped cap and reserved-credit banking.
    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        for v_occurrence in 1..greatest(coalesce(v_rec.voucher_redemption_count, 0), 1) loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
          values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
