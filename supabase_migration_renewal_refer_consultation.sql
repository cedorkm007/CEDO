-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_refer_consultation.sql
-- "REFER FOR CONSULTATION" in Scholar Renewal > Applications (for scholars with an INC, a DRP or a failed subject).
-- The renewal evaluator chooses the consultation type, the day (morning or afternoon) and the consultation staff member, the same way a scholar does in the scholar portal, and the consultation is BOOKED for the
-- scholar: the scholar is told and does not have to book their own. The booking is the ordinary renewal consultation (it shows in the scholar's Renewal tile and in the consultation calendar; the counselor marks it
-- Attended / No-show as always; the scholar can still change or cancel it up to 12 hours before). The documents (letter from the dean, study plan, clearance) are NOT needed first for this booking.
-- Adds four functions; changes no table and no existing function. Needs the consultation files (types a and b, open_and_choose_staff). Safe to run twice.
-- ─────────────────────────────────────────────────────────────

begin;

-- Is this application one that can be referred? An INC, a DRP or a failed subject, and not finished.
create or replace function public._renewal_can_refer(r public.renewal_records)
returns boolean
language sql
stable
as $$
  select r.stage not in ('renewed', 'removed', 'late_declined', 'returned')
     and (coalesce((r.evaluation ->> 'failed_effective')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'drp')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0
          or coalesce((r.evaluation ->> 'open_inc')::integer, 0) > 0);
$$;
revoke all on function public._renewal_can_refer(public.renewal_records) from public, anon, authenticated;

-- The consultation types (with their minutes); the one that fits the case is marked "suggested".
create or replace function public.renewal_refer_types(p_record_id uuid)
returns table(key text, label text, minutes integer, suggested boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_failed integer;
  v_inc integer;
  v_pick text;
begin
  perform public._renewal_require_evaluator();
  select * into r from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That application was not found.'; end if;
  v_failed := coalesce((r.evaluation ->> 'failed_effective')::integer, (r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0);
  v_inc := coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0);
  v_pick := case when v_inc > 0 then 'inc' when v_failed >= 2 then 'two_plus_failed' when v_failed = 1 then 'one_failed' else null end;
  return query select t.key, t.label, t.minutes, (t.key = v_pick) from public.consultation_types t where t.active order by t.sort;
end;
$$;
revoke all on function public.renewal_refer_types(uuid) from public, anon;
grant execute on function public.renewal_refer_types(uuid) to authenticated;

-- The mornings and afternoons that still have room for the type (at least 12 hours from now, up to 60 days ahead), the same as the scholar sees.
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
  where b.window_start >= now() + interval '12 hours' and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.renewal_refer_open_blocks(uuid, text) from public, anon;
grant execute on function public.renewal_refer_open_blocks(uuid, text) to authenticated;

-- Who is available in the chosen morning / afternoon (the one with most minutes left first).
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
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_min and b.window_start >= now() + interval '12 hours'
  order by (b.capacity - b.booked) desc, 2;
end;
$$;
revoke all on function public.renewal_refer_block_staff(text, date, text) from public, anon;
grant execute on function public.renewal_refer_block_staff(text, date, text) to authenticated;

-- The referral: books the consultation for the scholar (staff member chosen, or nobody chosen = the one with most minutes left) and tells the scholar.
create or replace function public.renewal_refer_book(p_record_id uuid, p_type text, p_day date, p_half text, p_staff uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_label text;
  v_who text;
  v_slot public.counseling_slots%rowtype;
begin
  perform public._renewal_require_evaluator();
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  if not public._renewal_can_refer(r) then raise exception 'Only an application with an INC, a DRP or a failed subject can be referred for a consultation.'; end if;
  if exists (select 1 from public.counseling_slots x where x.record_id = r.id and x.state = 'booked') then
    raise exception 'This scholar already has a consultation booked for this renewal. It can be changed from the Consultations tab or by the scholar.';
  end if;
  perform public._consult_place(r.id, r.scholar_id_number, p_type, p_day, p_half, 'booked', null, p_staff);
  select * into v_slot from public.counseling_slots where record_id = r.id and state = 'booked' order by booked_at desc limit 1;
  v_label := public._renewal_term_label(r.school_year, r.term);
  v_who := public._actor_name();
  perform public._renewal_log(r.id, r.stage, r.stage, 'Referred for consultation by ' || v_who || ': booked for ' || public._manila_slot_text(v_slot.starts_at) || ' with ' || public._staff_display_name(v_slot.staff_id) || '.', v_who);
  perform public._notify_scholar(r.scholar_id_number, 'progress', 'You were referred for a consultation',
    'For your renewal (' || v_label || '), the evaluator referred you for a consultation and booked it for you: ' || public._manila_slot_text(v_slot.starts_at) || ' with ' || public._staff_display_name(v_slot.staff_id)
    || '. You do not need to book your own. If you cannot come, change or cancel it in your Renewal tile at least 12 hours before.', r.id);
end;
$$;
revoke all on function public.renewal_refer_book(uuid, text, date, text, uuid) from public, anon;
grant execute on function public.renewal_refer_book(uuid, text, date, text, uuid) to authenticated;

commit;
