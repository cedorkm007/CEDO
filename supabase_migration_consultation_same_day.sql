-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_same_day.sql
-- CONSULTATION: BOOKING ON THE SAME DAY.   Safe to run twice.   Undo: undo_consultation_same_day.sql
--
-- UNTIL NOW a morning or afternoon could only be booked when it started at least 12 hours away, so in practice only the next day. This opens TODAY: a morning or afternoon can be booked as long as
-- the staff member's availability still has room AT LEAST 1 HOUR FROM NOW (the lead time is in one place: _consult_lead()). It works for the scholar's own booking, the renewal and referral
-- consultations, and the evaluator's "Refer for Consultation" booking.
--   * The part of today's availability that is already past (or less than the lead time away) is not bookable; only what is still ahead counts as room.
--   * Bookings made earlier today that are still waiting (not attended yet) use up that room; attended and missed ones belong to the past part and do not.
--   * A booking made for later today starts at the earliest bookable time (rounded up to 10 minutes); the scholar is told to come during the morning or afternoon hours, as always.
--   * Changing or cancelling a booking still needs 12 hours before it starts (so a booking made for today cannot be changed by the scholar: the CEDO office can).
-- Replaces 10 functions and adds 2. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._consult_blocks(timestamptz,timestamptz)') is null or to_regprocedure('public.renewal_refer_open_blocks(uuid,text)') is null then
    raise exception 'STOPPED, nothing changed: run the consultation files and supabase_migration_renewal_refer_consultation.sql first.';
  end if;
end $$;

-- The least time between booking and the consultation (so a same-day booking is possible, but not at the last minute).
create or replace function public._consult_lead()
returns interval
language sql
immutable
as $$ select interval '60 minutes'; $$;

-- The earliest moment a consultation can be booked for: now + the lead, rounded up to the next 10 minutes.
create or replace function public._consult_earliest()
returns timestamptz
language sql
stable
as $$ select to_timestamp(ceil(extract(epoch from (now() + public._consult_lead())) / 600.0) * 600); $$;

create or replace function public._consult_blocks(p_from timestamptz, p_to timestamptz)
returns table(staff_id uuid, day date, half text, capacity integer, booked integer, window_start timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with halves as (
    select a.staff_id, d::date as day, h.half, a.starts_at, a.ends_at,
           ((d::date)::timestamp + h.s) at time zone 'Asia/Manila' as ws,
           ((d::date)::timestamp + h.e) at time zone 'Asia/Manila' as we
    from public.counseling_availability a
    cross join lateral generate_series((a.starts_at at time zone 'Asia/Manila')::date, (a.ends_at at time zone 'Asia/Manila')::date, interval '1 day') d
    cross join (values ('AM', interval '0 hours', interval '12 hours'), ('PM', interval '12 hours', interval '24 hours')) h(half, s, e)
    where a.ends_at > p_from and a.starts_at < p_to
  ), cap as (
    select hv.staff_id, hv.day, hv.half,
           sum(greatest(0, extract(epoch from (least(hv.ends_at, hv.we) - greatest(hv.starts_at, hv.ws, public._consult_earliest()))) / 60))::integer as capacity,
           min(greatest(hv.starts_at, hv.ws, public._consult_earliest())) as window_start
    from halves hv where hv.starts_at < hv.we and hv.ends_at > hv.ws and least(hv.ends_at, hv.we) > public._consult_earliest()      -- only the part of today that is still ahead (and at least the lead time away) can be booked
    group by hv.staff_id, hv.day, hv.half
  )
  select c.staff_id, c.day, c.half, c.capacity,
         coalesce((select sum(coalesce(x.minutes, 10)) from public.counseling_slots x
                   where x.staff_id = c.staff_id and x.state = 'booked'
                     and (x.starts_at at time zone 'Asia/Manila')::date = c.day and public._consult_half(x.starts_at) = c.half), 0)::integer,
         c.window_start
  from cap c
  where c.capacity > 0;
$$;
create or replace function public.consult_block_staff(p_type text, p_day date, p_half text)
returns table(staff_id uuid, staff_name text, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  if public.current_scholar_id_number() is null then raise exception 'Not signed in as a scholar.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  if p_day is null or p_half not in ('AM', 'PM') then raise exception 'Please choose a day and morning (AM) or afternoon (PM).'; end if;
  return query
  select b.staff_id, public._staff_display_name(b.staff_id), (b.capacity - b.booked)::integer
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_min and b.window_start >= public._consult_earliest()
  order by (b.capacity - b.booked) desc, 2;
end;
$$;
revoke all on function public.consult_block_staff(text, date, text) from public, anon;
grant execute on function public.consult_block_staff(text, date, text) to authenticated;

create or replace function public.consult_self_open_blocks(p_type text)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  if public.current_scholar_id_number() is null then raise exception 'Not signed in as a scholar.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= public._consult_earliest() and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.consult_self_open_blocks(text) from public, anon;
grant execute on function public.consult_self_open_blocks(text) to authenticated;

create or replace function public._consult_self_place(p_scholar text, p_type text, p_day date, p_half text, p_action text, p_from_text text default null, p_staff uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type public.consultation_types%rowtype;
  v_staff uuid;
  v_start timestamptz;
begin
  select * into v_type from public.consultation_types where key = p_type and active;
  if not found then raise exception 'Please choose the type of consultation.'; end if;
  if p_half not in ('AM', 'PM') then raise exception 'Please choose morning (AM) or afternoon (PM).'; end if;
  if p_day is null then raise exception 'Please choose a day.'; end if;

  perform pg_advisory_xact_lock(731001);
  if exists (select 1 from public.counseling_slots x where x.scholar_id_number = p_scholar and x.state = 'booked' and x.record_id is null and x.referral_id is null) then
    raise exception 'You already have a consultation booked. Change it instead.';
  end if;
  select b.staff_id, b.window_start into v_staff, v_start
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_type.minutes and b.window_start >= public._consult_earliest()
    and (p_staff is null or b.staff_id = p_staff)
  order by (b.capacity - b.booked) desc, b.staff_id
  limit 1;
  if v_staff is null then raise exception '%', case when p_staff is null then 'That time was just filled. Please choose another.' else 'That staff member has no room left at that time. Please choose another staff member or another time.' end; end if;

  insert into public.counseling_slots (staff_id, starts_at, ends_at, state, record_id, referral_id, scholar_id_number, booked_at, consult_type, minutes, reminded_day_at)
  values (v_staff, v_start, v_start + make_interval(mins => v_type.minutes), 'booked', null, null, p_scholar, now(), v_type.key, v_type.minutes,
          case when v_start - now() < interval '24 hours' then now() end);

  perform public._booking_log(null, p_scholar, v_start, v_staff, p_action, case when p_from_text is null then v_type.label else 'From ' || p_from_text || ' · ' || v_type.label end);
  perform public._notify_scholar(p_scholar, 'booking_confirmed', case p_action when 'rescheduled' then 'Your consultation was rescheduled' else 'Your consultation is booked' end,
    public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || ', at the CEDO office (' || v_type.label || '). Please come during the '
      || case p_half when 'AM' then 'morning' else 'afternoon' end || ' hours.', null);
end;
$$;
revoke all on function public._consult_self_place(text, text, date, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._consult_place(p_record_id uuid, p_scholar text, p_type text, p_day date, p_half text, p_action text, p_from_text text default null, p_staff uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_type public.consultation_types%rowtype;
  v_staff uuid;
  v_start timestamptz;
begin
  select * into r from public.renewal_records where id = p_record_id;
  select * into v_type from public.consultation_types where key = p_type and active;
  if not found then raise exception 'Please choose the type of consultation.'; end if;
  if p_half not in ('AM', 'PM') then raise exception 'Please choose morning (AM) or afternoon (PM).'; end if;
  if p_day is null then raise exception 'Please choose a day.'; end if;

  perform pg_advisory_xact_lock(731001);
  select b.staff_id, b.window_start into v_staff, v_start
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_type.minutes and b.window_start >= public._consult_earliest()
    and (p_staff is null or b.staff_id = p_staff)
  order by (b.capacity - b.booked) desc, b.staff_id
  limit 1;
  if v_staff is null then raise exception '%', case when p_staff is null then 'That time was just filled. Please choose another.' else 'That staff member has no room left at that time. Please choose another staff member or another time.' end; end if;

  insert into public.counseling_slots (staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at, consult_type, minutes, reminded_day_at)
  values (v_staff, v_start, v_start + make_interval(mins => v_type.minutes), 'booked', r.id, p_scholar, now(), v_type.key, v_type.minutes,
          case when v_start - now() < interval '24 hours' then now() end);

  perform public._booking_log(r.id, p_scholar, v_start, v_staff, p_action, case when p_from_text is null then v_type.label else 'From ' || p_from_text || ' · ' || v_type.label end);
  perform public._renewal_log(r.id, r.stage, r.stage,
    case p_action when 'rescheduled' then 'Changed the consultation (' || v_type.label || ') from ' || p_from_text || ' to ' else 'Booked a consultation (' || v_type.label || ') for ' end
      || public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || '.', 'Scholar');
  perform public._notify_scholar(p_scholar, 'booking_confirmed', case p_action when 'rescheduled' then 'Your consultation was rescheduled' else 'Your consultation is booked' end,
    public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || ', at the CEDO office (' || v_type.label || '). Please come during the '
      || case p_half when 'AM' then 'morning' else 'afternoon' end || ' hours.'
      || case when r.term = 'Summer' then ' Please bring the hard copy of your prospectus.' else '' end, r.id);
end;
$$;
revoke all on function public._consult_place(uuid, text, text, date, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._referral_place(p_referral_id uuid, p_scholar text, p_day date, p_half text, p_action text, p_from_text text default null, p_staff uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.scholar_counseling_referrals%rowtype;
  v_type public.consultation_types%rowtype;
  v_staff uuid;
  v_start timestamptz;
begin
  select * into f from public.scholar_counseling_referrals where id = p_referral_id;
  select * into v_type from public.consultation_types where key = f.reason and active;
  if not found then raise exception 'The reason of this referral is no longer available. Please contact the CEDO office.'; end if;
  if p_half not in ('AM', 'PM') then raise exception 'Please choose morning (AM) or afternoon (PM).'; end if;
  if p_day is null then raise exception 'Please choose a day.'; end if;

  perform pg_advisory_xact_lock(731001);
  select b.staff_id, b.window_start into v_staff, v_start
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_type.minutes and b.window_start >= public._consult_earliest()
    and (p_staff is null or b.staff_id = p_staff)
  order by (b.capacity - b.booked) desc, b.staff_id
  limit 1;
  if v_staff is null then raise exception '%', case when p_staff is null then 'That time was just filled. Please choose another.' else 'That staff member has no room left at that time. Please choose another staff member or another time.' end; end if;

  insert into public.counseling_slots (staff_id, starts_at, ends_at, state, record_id, referral_id, scholar_id_number, booked_at, consult_type, minutes, reminded_day_at)
  values (v_staff, v_start, v_start + make_interval(mins => v_type.minutes), 'booked', null, f.id, p_scholar, now(), v_type.key, v_type.minutes,
          case when v_start - now() < interval '24 hours' then now() end);
  update public.scholar_counseling_referrals set status = 'booked', referred_to = v_staff, updated_at = now() where id = f.id;

  perform public._booking_log(null, p_scholar, v_start, v_staff, p_action, case when p_from_text is null then v_type.label else 'From ' || p_from_text || ' · ' || v_type.label end);
  perform public._notify_scholar(p_scholar, 'booking_confirmed', case p_action when 'rescheduled' then 'Your consultation was rescheduled' else 'Your consultation is booked' end,
    public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || ', at the CEDO office (' || v_type.label || '). Please come during the '
      || case p_half when 'AM' then 'morning' else 'afternoon' end || ' hours.', null);
end;
$$;
revoke all on function public._referral_place(uuid, text, date, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.renewal_open_blocks(p_record_id uuid, p_type text)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_min integer;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  if not exists (select 1 from public.renewal_records r where r.id = p_record_id and r.scholar_id_number = v_id) then raise exception 'That application was not found.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  -- someone who already holds a booking may look for another time (to change it); everyone else must be allowed to book
  if not exists (select 1 from public.counseling_slots b where b.record_id = p_record_id and b.state = 'booked') then
    perform public._renewal_require_can_book(p_record_id);
  end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= public._consult_earliest() and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.renewal_open_blocks(uuid, text) from public, anon;
grant execute on function public.renewal_open_blocks(uuid, text) to authenticated;

create or replace function public.referral_open_blocks(p_referral_id uuid)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  f public.scholar_counseling_referrals%rowtype;
  v_min integer;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id and scholar_id_number = v_id and status in ('awaiting_booking', 'booked');
  if not found then raise exception 'That referral was not found.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = f.reason and t.active;
  if v_min is null then raise exception 'The reason of this referral is no longer available. Please contact the CEDO office.'; end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= public._consult_earliest() and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.referral_open_blocks(uuid) from public, anon;
grant execute on function public.referral_open_blocks(uuid) to authenticated;

create or replace function public.renewal_refer_open_blocks(p_record_id uuid, p_type text)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  perform public._renewal_require_evaluator();
  if not exists (select 1 from public.renewal_records r where r.id = p_record_id) then raise exception 'That application was not found.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= public._consult_earliest() and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.renewal_refer_open_blocks(uuid, text) from public, anon;
grant execute on function public.renewal_refer_open_blocks(uuid, text) to authenticated;

create or replace function public.renewal_refer_block_staff(p_type text, p_day date, p_half text)
returns table(staff_id uuid, staff_name text, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  perform public._renewal_require_evaluator();
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  if p_day is null or p_half not in ('AM', 'PM') then raise exception 'Please choose a day and morning (AM) or afternoon (PM).'; end if;
  return query
  select b.staff_id, public._staff_display_name(b.staff_id), (b.capacity - b.booked)::integer
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_min and b.window_start >= public._consult_earliest()
  order by (b.capacity - b.booked) desc, 2;
end;
$$;
revoke all on function public.renewal_refer_block_staff(text, date, text) from public, anon;
grant execute on function public.renewal_refer_block_staff(text, date, text) to authenticated;

revoke all on function public._consult_lead() from public, anon, authenticated;
revoke all on function public._consult_earliest() from public, anon, authenticated;
revoke all on function public._consult_blocks(timestamptz, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
