-- ─────────────────────────────────────────────────────────────
-- supabase_migration_formation_attendance_bulk_rpc.sql
--
-- Makes Formation Activities attendance safe at production scale (2,600
-- expected attendees / 5,200 time-in+time-out QR codes for a single
-- activity). Three problems this fixes, all previously handled entirely
-- in the browser:
--   1. QR code generation was a long sequence of client-side inserts with
--      client-generated codes and no transaction — a mid-batch failure
--      (network drop, browser tab closed) could leave a session with a
--      partial, silently-broken set of codes. Now: one atomic RPC call
--      per creation/addition, generating and inserting codes inside a
--      single Postgres function (implicitly transactional — if anything
--      inside raises, everything in the call rolls back, full stop).
--   2. Client-generated 7-character codes had no defense against a
--      collision with an existing code beyond "hope it doesn't happen" —
--      at 5,200+ codes across many activities over time this stops being
--      negligible. Now: codes are generated and inserted server-side with
--      ON CONFLICT DO NOTHING + a shortfall-and-retry loop, so a
--      collision just quietly gets a replacement code instead of a
--      surfaced error.
--   3. Staff monitoring pulled every QR code row (up to thousands) just
--      to compute counts or show a roster page. Now: two new lightweight
--      aggregate RPCs return only counts (attendance_session_counts,
--      attendance_code_batch_summary) — actual roster/code ROWS are
--      fetched separately, paginated, directly from the TypeScript layer
--      via the existing RLS-permitted SELECT on attendance_records /
--      attendance_codes (no new RPC needed for that part — the existing
--      "cedo monitors ..." policies from supabase_migration_
--      formation_attendance.sql already permit staff SELECT directly;
--      this migration doesn't touch or repeat those policies).
--
-- Deliberately NOT touched by this migration, per the task's own
-- constraints — preserved exactly as-is:
--   - public.redeem_attendance_code() (scholar-side redemption, its
--     single-use guarantee, and its year-level eligibility check) — last
--     defined in supabase_migration_attendance_eligibility_and_status.sql.
--   - public.my_completed_activity_attendance().
--   - SDP Monitoring's own attendance flow (enableAttendanceForActivity /
--     addAttendanceVouchers in src/scholar/sdpMonitorApi.ts client code) —
--     this migration adds NEW functions for Formation's bulk-scale needs
--     rather than changing the ones SDP already uses. SDP activities are
--     nowhere near this scale today; if they ever need the same atomic
--     treatment, that's a separate, deliberate decision, not a side
--     effect of this one.
--
-- Run this AFTER supabase_migration_attendance_eligibility_and_status.sql.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── E.1 Required indexes ────────────────────────────────────
-- attendance_codes_code_unique (supabase_migration_attendance_system.sql)
-- already covers attendance_codes(code) — listed here again only as an
-- explicit "if not exists" for clarity/safety, not a behavior change.
create unique index if not exists attendance_codes_code_unique on public.attendance_codes(code);
create index if not exists idx_attendance_codes_session_batch_kind on public.attendance_codes(session_id, batch_number, kind);
create index if not exists idx_attendance_records_session_updated on public.attendance_records(session_id, updated_at);
create index if not exists idx_attendance_records_session_status on public.attendance_records(session_id, status);

-- ── A. Atomic QR code generation ────────────────────────────

-- Private helper — NOT granted to `authenticated` (see note below).
-- Generates exactly p_count unique codes of one kind/batch for a session,
-- retrying collisions via ON CONFLICT DO NOTHING + a shortfall check
-- rather than row-by-row error handling. p_max_rounds is a generous
-- ceiling so a pathological run (e.g. alphabet exhausted, which at
-- 32^7 possible codes is not a real risk at this scale) can't loop
-- forever — it raises instead, which rolls back the whole calling RPC.
create or replace function public.generate_attendance_codes(
  p_session_id uuid, p_kind text, p_count integer, p_batch_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_have integer;
  v_remaining integer;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- excludes 0/O, 1/I/L — matches the existing client-side alphabet
  v_max_rounds integer := 50;
  v_round integer := 0;
begin
  select count(*) into v_have from public.attendance_codes
    where session_id = p_session_id and kind = p_kind and batch_number = p_batch_number;
  v_remaining := p_count - v_have;

  while v_remaining > 0 and v_round < v_max_rounds loop
    v_round := v_round + 1;
    -- Each candidate row must get its OWN independently-random code. An
    -- uncorrelated scalar subquery here (e.g. `(select string_agg(...)
    -- from generate_series(1,7))` with no reference back to the outer
    -- row) risks PostgreSQL evaluating it once and reusing the same
    -- cached result for every row in this INSERT ... SELECT — silently
    -- generating one code repeated v_remaining times instead of
    -- v_remaining distinct codes. ON CONFLICT DO NOTHING would then
    -- insert only the first of those (all others collide with it),
    -- making large batches fail the shortfall-retry loop entirely.
    -- Grouping by the candidate row's own number and aggregating a
    -- per-row generate_series(1,7) of individually-random characters
    -- forces one independent 7-character code per candidate row.
    insert into public.attendance_codes (session_id, code, kind, batch_number)
    select
      p_session_id,
      string_agg(
        substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1),
        '' order by character_position.n
      ),
      p_kind,
      p_batch_number
    from generate_series(1, v_remaining) as candidate(n)
    cross join generate_series(1, 7) as character_position(n)
    group by candidate.n
    on conflict (code) do nothing;

    select count(*) into v_have from public.attendance_codes
      where session_id = p_session_id and kind = p_kind and batch_number = p_batch_number;
    v_remaining := p_count - v_have;
  end loop;

  if v_remaining > 0 then
    raise exception 'Could not generate % unique attendance codes for session %, kind % after % attempts — please try again.',
      p_count, p_session_id, p_kind, v_max_rounds;
  end if;
end;
$$;
-- PostgreSQL grants EXECUTE to PUBLIC on every newly created function by
-- default — simply never issuing `grant ... to authenticated` does NOT
-- prevent an authenticated (or even anon) caller from invoking this
-- directly, since PUBLIC already covers them. The revoke below is what
-- actually enforces "only the two wrapper RPCs can call this" — the
-- comment that used to be here relying on the grant's absence alone was
-- not sufficient on its own.
revoke all on function public.generate_attendance_codes(uuid, text, integer, integer) from public;

-- Creates a Formation attendance session AND all of its QR codes in one
-- atomic call. Returns the new session id.
create or replace function public.create_formation_attendance_session_with_codes(
  p_activity_id uuid,
  p_type text,
  p_participant_count integer,
  p_voucher_hours integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  -- Same authorization the existing "cedo monitors manage attendance
  -- sessions/codes" policies already enforce for direct table access
  -- (supabase_migration_formation_attendance.sql) — replicated here
  -- because SECURITY DEFINER functions bypass RLS, so this check is the
  -- only thing standing between this RPC and an unauthorized caller.
  if not (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring')) then
    raise exception 'Not authorized to manage Formation attendance.';
  end if;

  if p_type not in ('time_in_time_out', 'voucher') then
    raise exception 'Invalid attendance type.';
  end if;
  if p_participant_count is null or p_participant_count < 1 then
    raise exception 'Enter a number greater than 0.';
  end if;
  if p_type = 'voucher' and p_voucher_hours is not null and p_voucher_hours not in (1, 2, 4, 8) then
    raise exception 'Choose a valid voucher hour equivalent.';
  end if;
  if not exists (select 1 from public.formation_activities where id = p_activity_id) then
    raise exception 'Formation activity not found.';
  end if;

  insert into public.attendance_sessions (formation_activity_id, type, expected_attendees, duration_hours, created_by)
  values (p_activity_id, p_type, p_participant_count, case when p_type = 'voucher' then coalesce(p_voucher_hours, 1) else null end, auth.uid())
  returning id into v_session_id;

  -- time_in_time_out: one time_in code + one time_out code per expected
  -- scholar (2 × p_participant_count total). voucher: one code per
  -- scholar. Same split the client used to do — preserved exactly.
  if p_type = 'time_in_time_out' then
    perform public.generate_attendance_codes(v_session_id, 'time_in', p_participant_count, 1);
    perform public.generate_attendance_codes(v_session_id, 'time_out', p_participant_count, 1);
  else
    perform public.generate_attendance_codes(v_session_id, 'voucher', p_participant_count, 1);
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.create_formation_attendance_session_with_codes(uuid, text, integer, integer) from public;
grant execute on function public.create_formation_attendance_session_with_codes(uuid, text, integer, integer) to authenticated;

-- Adds a new batch of codes to an EXISTING Formation attendance session —
-- e.g. more scholars showed up than originally estimated. Preserves the
-- existing "next batch = max(batch_number) + 1" behavior and the existing
-- "expected_attendees increases by the scholar count, once, regardless of
-- type" behavior (a time_in_time_out addition still only adds
-- p_participant_count to expected_attendees, not 2×, matching what the
-- old client code did). Returns the new batch number.
create or replace function public.add_formation_attendance_codes(
  p_session_id uuid, p_type text, p_participant_count integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_number integer;
begin
  if not (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring')) then
    raise exception 'Not authorized to manage Formation attendance.';
  end if;
  if p_type not in ('time_in_time_out', 'voucher') then
    raise exception 'Invalid attendance type.';
  end if;
  if p_participant_count is null or p_participant_count < 1 then
    raise exception 'Enter a number greater than 0.';
  end if;
  if not exists (select 1 from public.attendance_sessions where id = p_session_id and formation_activity_id is not null) then
    raise exception 'Formation attendance session not found.';
  end if;

  -- Transaction-scoped advisory lock, released automatically when this
  -- function's transaction ends (commit or rollback) — no explicit
  -- unlock needed. Without this, two staff adding scholars to the same
  -- session at nearly the same moment could both read the same
  -- max(batch_number) before either one's insert commits, and both
  -- would then generate codes under the SAME "next" batch number
  -- instead of two distinct ones.
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));

  select coalesce(max(batch_number), 0) + 1 into v_batch_number
    from public.attendance_codes where session_id = p_session_id;

  if p_type = 'time_in_time_out' then
    perform public.generate_attendance_codes(p_session_id, 'time_in', p_participant_count, v_batch_number);
    perform public.generate_attendance_codes(p_session_id, 'time_out', p_participant_count, v_batch_number);
  else
    perform public.generate_attendance_codes(p_session_id, 'voucher', p_participant_count, v_batch_number);
  end if;

  update public.attendance_sessions
    set expected_attendees = coalesce(expected_attendees, 0) + p_participant_count
    where id = p_session_id;

  return v_batch_number;
end;
$$;

revoke all on function public.add_formation_attendance_codes(uuid, text, integer) from public;
grant execute on function public.add_formation_attendance_codes(uuid, text, integer) to authenticated;

-- ── B. Lightweight aggregate reads (no code/roster rows) ────

-- Present/Incomplete counts for the Expected/Present/Incomplete summary
-- cards — computed entirely in Postgres via count(*) filter, never
-- downloading a single attendance_records row for this purpose. Expected
-- itself needs no query at all — it's already on the session row the
-- client already has (attendance_sessions.expected_attendees).
create or replace function public.attendance_session_counts(p_session_id uuid)
returns table (present_count bigint, incomplete_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select
    count(*) filter (where status = 'present') as present_count,
    count(*) filter (where status = 'incomplete') as incomplete_count
  from public.attendance_records
  where session_id = p_session_id
    and (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
$$;

grant execute on function public.attendance_session_counts(uuid) to authenticated;
revoke all on function public.attendance_session_counts(uuid) from public;

-- Per batch/kind totals and claimed counts — this is what lets the QR
-- viewer and Download QR PDF menu present "Batch 2, Time-in: 340 codes,
-- 210 claimed" without ever fetching the codes themselves. Grouping is
-- done server-side; unauthorized callers simply get zero rows (same
-- shape RLS itself would produce for a SELECT), rather than an
-- exception, since this is a read — kept consistent with how a denied
-- SELECT normally behaves rather than surfacing as an error.
create or replace function public.attendance_code_batch_summary(p_session_id uuid)
returns table (batch_number integer, kind text, total bigint, claimed bigint)
language sql
security definer
stable
set search_path = public
as $$
  select c.batch_number, c.kind, count(*) as total, count(*) filter (where c.redeemed_by_scholar_id is not null) as claimed
  from public.attendance_codes c
  where c.session_id = p_session_id
    and (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
  group by c.batch_number, c.kind
  order by c.batch_number, c.kind;
$$;

grant execute on function public.attendance_code_batch_summary(uuid) to authenticated;
revoke all on function public.attendance_code_batch_summary(uuid) from public;
