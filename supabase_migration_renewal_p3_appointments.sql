-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p3_appointments.sql
-- Scholar Renewal System, Phase 3: the appointment system for face-to-face consultations, and its link to the Consultation Tool.
-- Run AFTER supabase_migration_renewal_p2_application.sql. Additive and safe to run twice.
--
--   1. counseling_availability      the time ranges a consultation staff member is available (e.g. Mon Oct 20, 9:00-11:00).
--      counseling_slots             each range is split into 10-MINUTE slots, ONE scholar per slot.
--      counseling_booking_history   every booking / reschedule / cancel / no-show / attended, with who and when.
--   2. Scholar functions: see the open slots of ALL counseling staff, book, reschedule and cancel (up to 12 hours before; one
--      upcoming booking per renewal at a time).
--   3. Staff functions: set / edit / remove availability (booked scholars are warned and notified), the calendar, mark Attended or
--      No-show, and the Daily Record of the consultation (prefilled; INC "days given to comply" sets the deadline; Summer "prospectus
--      hard copy received").
--   4. The scheduler: renewal_scheduled_jobs() sends the 1-day and 1-hour reminders and notices INC deadlines that have passed.
--      It is scheduled every 5 minutes with pg_cron when that extension is switched on; otherwise call it from any scheduler.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Tables ───────────────────────────────────────────────
create table if not exists public.counseling_availability (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.users(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at),
  check (mod(extract(epoch from (ends_at - starts_at))::bigint, 600) = 0)       -- whole 10-minute slots only
);
create index if not exists counseling_availability_staff_idx on public.counseling_availability (staff_id, starts_at);

create table if not exists public.counseling_slots (
  id                 uuid primary key default gen_random_uuid(),
  availability_id    uuid not null references public.counseling_availability(id) on delete cascade,
  staff_id           uuid not null references public.users(id) on delete cascade,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  state              text not null default 'open' check (state in ('open', 'booked', 'attended', 'no_show')),
  record_id          uuid references public.renewal_records(id) on delete set null,
  scholar_id_number  text references public.scholars(scholar_id_number) on delete set null,
  booked_at          timestamptz,
  marked_by          uuid references public.users(id) on delete set null,
  marked_at          timestamptz,
  reminded_day_at    timestamptz,
  reminded_hour_at   timestamptz,
  daily_record_id    uuid references public.scholar_counseling_records(id) on delete set null,
  unique (staff_id, starts_at)
);
create index if not exists counseling_slots_open_idx on public.counseling_slots (starts_at) where state = 'open';
create index if not exists counseling_slots_scholar_idx on public.counseling_slots (scholar_id_number);
-- A renewal can hold only ONE upcoming booked slot at a time (the database enforces it, even for two quick clicks).
create unique index if not exists counseling_slots_one_booking_per_record on public.counseling_slots (record_id) where state = 'booked';

create table if not exists public.counseling_booking_history (
  id                 uuid primary key default gen_random_uuid(),
  record_id          uuid references public.renewal_records(id) on delete cascade,
  scholar_id_number  text not null,
  slot_starts_at     timestamptz,
  staff_id           uuid references public.users(id) on delete set null,
  action             text not null check (action in ('booked', 'rescheduled', 'cancelled', 'no_show', 'attended', 'removed_by_staff')),
  actor_label        text not null default '',
  note               text not null default '',
  at                 timestamptz not null default now()
);
create index if not exists counseling_booking_history_record_idx on public.counseling_booking_history (record_id, at);

alter table public.renewal_records add column if not exists no_show_count integer not null default 0;
alter table public.scholar_counseling_records add column if not exists slot_id uuid;
alter table public.scholar_counseling_records add column if not exists renewal_record_id uuid;
alter table public.scholar_counseling_records add column if not exists days_given integer;
alter table public.scholar_counseling_records add column if not exists prospectus_hard_copy boolean;

alter table public.counseling_availability enable row level security;
alter table public.counseling_slots enable row level security;
alter table public.counseling_booking_history enable row level security;
drop policy if exists "staff read own availability" on public.counseling_availability;
create policy "staff read own availability" on public.counseling_availability for select
  using (staff_id = auth.uid() and public.has_staff_tag('scholar_counseling'));
drop policy if exists "staff read own slots" on public.counseling_slots;
create policy "staff read own slots" on public.counseling_slots for select
  using ((staff_id = auth.uid() and public.has_staff_tag('scholar_counseling')) or public.is_renewal_evaluator());
drop policy if exists "staff read booking history" on public.counseling_booking_history;
create policy "staff read booking history" on public.counseling_booking_history for select using (public.can_view_renewals());
drop policy if exists "scholar reads own booking history" on public.counseling_booking_history;
create policy "scholar reads own booking history" on public.counseling_booking_history for select
  using (scholar_id_number = public.current_scholar_id_number());
-- No insert / update / delete policy anywhere: everything goes through the functions below.

-- ── 2. Small helpers ────────────────────────────────────────
create or replace function public._require_counseling_staff()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('scholar_counseling') then raise exception 'Only consultation staff can do this.'; end if;
end;
$$;
revoke all on function public._require_counseling_staff() from public, anon, authenticated;

create or replace function public._staff_display_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Consultation staff') from public.users u where u.id = p_id;
$$;
revoke all on function public._staff_display_name(uuid) from public, anon, authenticated;

-- "Mon, Oct 20 at 9:10 AM" in Philippine time, for messages.
create or replace function public._manila_slot_text(p_at timestamptz)
returns text
language sql
stable
as $$ select to_char(p_at at time zone 'Asia/Manila', 'FMDy, FMMon FMDD "at" FMHH12:MI AM'); $$;
revoke all on function public._manila_slot_text(timestamptz) from public, anon, authenticated;

-- A scholar may book only while the renewal still needs a consultation that has not happened.
create or replace function public._renewal_consult_eligible(p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.renewal_records r
    where r.id = p_record_id and r.consultation_done_at is null
      and r.stage in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements')
  );
$$;
revoke all on function public._renewal_consult_eligible(uuid) from public, anon, authenticated;

create or replace function public._booking_log(p_record_id uuid, p_scholar text, p_slot_starts timestamptz, p_staff uuid, p_action text, p_note text default '')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.counseling_booking_history (record_id, scholar_id_number, slot_starts_at, staff_id, action, actor_label, note)
  values (p_record_id, p_scholar, p_slot_starts, p_staff,
          p_action, case when public.current_scholar_id_number() is not null then 'Scholar' when auth.uid() is null then 'System' else public._actor_name() end, coalesce(p_note, ''));
$$;
revoke all on function public._booking_log(uuid, text, timestamptz, uuid, text, text) from public, anon, authenticated;

create or replace function public._counseling_generate_slots(p_availability_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.counseling_slots (availability_id, staff_id, starts_at, ends_at)
  select a.id, a.staff_id, g, g + interval '10 minutes'
  from public.counseling_availability a, generate_series(a.starts_at, a.ends_at - interval '10 minutes', interval '10 minutes') g
  where a.id = p_availability_id
  on conflict (staff_id, starts_at) do nothing;
$$;
revoke all on function public._counseling_generate_slots(uuid) from public, anon, authenticated;

-- Cancels one booked slot because staff removed it: tells the scholar and records it, then deletes the slot.
create or replace function public._counseling_remove_slot(p_slot_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
begin
  select * into s from public.counseling_slots where id = p_slot_id for update;
  if not found then return; end if;
  if s.state = 'booked' then
    perform public._booking_log(s.record_id, s.scholar_id_number, s.starts_at, s.staff_id, 'removed_by_staff', p_reason);
    perform public._notify_scholar(s.scholar_id_number, 'slot_removed', 'Your consultation time was removed',
      'The consultation staff removed your slot on ' || public._manila_slot_text(s.starts_at) || '. Please book a new time from your Renewal tile.', s.record_id);
  end if;
  delete from public.counseling_slots where id = p_slot_id;
end;
$$;
revoke all on function public._counseling_remove_slot(uuid, text) from public, anon, authenticated;

-- ── 3. Staff: availability ──────────────────────────────────
-- Create (p_id null) or edit a range. If the change would remove slots that scholars have booked, nothing happens until the staff
-- member confirms (p_confirm = true): the answer then lists who is affected; with confirmation those scholars are notified.
create or replace function public.counseling_availability_save(p_id uuid, p_starts timestamptz, p_ends timestamptz, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.counseling_availability%rowtype;
  v_id uuid;
  v_affected jsonb;
  s record;
begin
  perform public._require_counseling_staff();
  if p_starts is null or p_ends is null then raise exception 'Please choose the start and end time.'; end if;
  if p_ends <= p_starts then raise exception 'The end time must be after the start time.'; end if;
  if mod(extract(epoch from (p_ends - p_starts))::bigint, 600) <> 0 then raise exception 'The range must be a whole number of 10-minute slots (for example 9:00 to 11:00).'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception 'A single range can be at most 12 hours.'; end if;
  if p_starts < now() then raise exception 'Availability must start in the future.'; end if;
  if exists (select 1 from public.counseling_availability a where a.staff_id = auth.uid() and a.id is distinct from p_id and a.starts_at < p_ends and a.ends_at > p_starts) then
    raise exception 'This overlaps another range of yours. Edit that one instead.';
  end if;

  if p_id is null then
    insert into public.counseling_availability (staff_id, starts_at, ends_at) values (auth.uid(), p_starts, p_ends) returning id into v_id;
    perform public._counseling_generate_slots(v_id);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select * into v_old from public.counseling_availability where id = p_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That availability range was not found.'; end if;
  if v_old.starts_at <= now() then raise exception 'This range has already started, so it can no longer be changed.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('slot_id', x.id, 'starts_at', x.starts_at, 'scholar_id_number', x.scholar_id_number,
           'name', (select btrim(sc.first_name || ' ' || sc.last_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number)) order by x.starts_at), '[]'::jsonb)
    into v_affected
  from public.counseling_slots x
  where x.availability_id = p_id and x.state = 'booked' and (x.starts_at < p_starts or x.ends_at > p_ends);
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;

  for s in select x.id from public.counseling_slots x where x.availability_id = p_id and (x.starts_at < p_starts or x.ends_at > p_ends) loop
    perform public._counseling_remove_slot(s.id, 'The availability range was changed.');
  end loop;
  update public.counseling_availability set starts_at = p_starts, ends_at = p_ends, updated_at = now() where id = p_id;
  perform public._counseling_generate_slots(p_id);
  return jsonb_build_object('ok', true, 'id', p_id, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) to authenticated;

create or replace function public.counseling_availability_delete(p_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.counseling_availability%rowtype;
  v_affected jsonb;
  s record;
begin
  perform public._require_counseling_staff();
  select * into v_old from public.counseling_availability where id = p_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That availability range was not found.'; end if;
  if v_old.starts_at <= now() then raise exception 'This range has already started, so it can no longer be removed.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot_id', x.id, 'starts_at', x.starts_at, 'scholar_id_number', x.scholar_id_number,
           'name', (select btrim(sc.first_name || ' ' || sc.last_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number)) order by x.starts_at), '[]'::jsonb)
    into v_affected
  from public.counseling_slots x where x.availability_id = p_id and x.state = 'booked';
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;
  for s in select x.id from public.counseling_slots x where x.availability_id = p_id loop
    perform public._counseling_remove_slot(s.id, 'The availability range was removed.');
  end loop;
  delete from public.counseling_availability where id = p_id;
  return jsonb_build_object('ok', true, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_delete(uuid, boolean) from public, anon;
grant execute on function public.counseling_availability_delete(uuid, boolean) to authenticated;

create or replace function public.counseling_my_availability(p_from timestamptz, p_to timestamptz)
returns table(id uuid, starts_at timestamptz, ends_at timestamptz, slot_count integer, booked_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return query
  select a.id, a.starts_at, a.ends_at,
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id),
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id and x.state <> 'open')
  from public.counseling_availability a
  where a.staff_id = auth.uid() and a.ends_at > p_from and a.starts_at < p_to
  order by a.starts_at;
end;
$$;
revoke all on function public.counseling_my_availability(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_availability(timestamptz, timestamptz) to authenticated;

-- The calendar: every slot of the staff member in the period, with who booked it and what the case is.
create or replace function public.counseling_my_slots(p_from timestamptz, p_to timestamptz)
returns table(
  slot_id uuid, availability_id uuid, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer, is_summer boolean, hard_copy boolean, daily_record_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return query
  select x.id, x.availability_id, x.starts_at, x.ends_at, x.state, x.scholar_id_number,
         (select btrim(sc.last_name || ', ' || sc.first_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number),
         x.record_id, case when r.id is null then null else r.term || ' ' || r.school_year end, r.stage,
         case when r.id is null then null else nullif(concat_ws(' · ',
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'failed') || ' failed' end,
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'inc') || ' INC' end,
           case when r.term = 'Summer' then 'Summer renewal' end), '') end,
         coalesce(r.no_show_count, 0), coalesce(r.term = 'Summer', false), r.hard_copy_received_at is not null, x.daily_record_id
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.staff_id = auth.uid() and x.starts_at >= p_from and x.starts_at < p_to
  order by x.starts_at;
end;
$$;
revoke all on function public.counseling_my_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_slots(timestamptz, timestamptz) to authenticated;

-- ── 4. Staff: Attended / No-show and the Daily Record ───────
create or replace function public._counseling_prefill(p_slot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_scholar public.scholars%rowtype;
  v_ev jsonb;
  v_failed text;
  v_inc jsonb;
begin
  select * into s from public.counseling_slots where id = p_slot_id;
  select * into r from public.renewal_records where id = s.record_id;
  select * into v_scholar from public.scholars where scholar_id_number = s.scholar_id_number;
  v_ev := public._renewal_evaluate(s.scholar_id_number, r.school_year, r.term);
  select string_agg(f ->> 'subject' || ' (' || coalesce(f ->> 'grade', '') || ')', ', ') into v_failed
  from jsonb_array_elements(coalesce(v_ev -> 'grades' -> 'failed_subjects', '[]'::jsonb) || coalesce(v_ev -> 'grades' -> 'inc_subjects', '[]'::jsonb)) f;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'subject', i.subject, 'deadline', i.deadline) order by i.subject), '[]'::jsonb) into v_inc
  from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open';
  return jsonb_build_object('slot_id', s.id, 'record_id', r.id, 'scholar_id_number', s.scholar_id_number,
    'scholar_name', btrim(v_scholar.last_name || ', ' || v_scholar.first_name), 'status', v_scholar.status, 'failed_subjects', coalesce(v_failed, ''),
    'inc_items', v_inc, 'is_summer', r.term = 'Summer', 'term_label', r.term || ' ' || r.school_year,
    'date_visited', (s.starts_at at time zone 'Asia/Manila')::date);
end;
$$;
revoke all on function public._counseling_prefill(uuid) from public, anon, authenticated;

-- Marks a booked slot. Attended: the consultation counts as done and the answer carries what the pre-filled Daily Record needs.
-- No-show: the renewal is flagged, the scholar is told to book again.
create or replace function public.counseling_mark_slot(p_slot_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_ev jsonb;
  v_scholar public.scholars%rowtype;
  v_failed text;
  v_inc jsonb;
begin
  perform public._require_counseling_staff();
  if p_outcome not in ('attended', 'no_show') then raise exception 'Choose Attended or No-show.'; end if;
  select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That appointment was not found.'; end if;
  if s.state <> 'booked' then raise exception 'This slot is not booked (it is %).', s.state; end if;
  if p_outcome = 'no_show' and s.starts_at > now() then raise exception 'A no-show can only be marked after the slot has started.'; end if;
  select * into r from public.renewal_records where id = s.record_id for update;
  select * into v_scholar from public.scholars where scholar_id_number = s.scholar_id_number;

  update public.counseling_slots set state = p_outcome, marked_by = auth.uid(), marked_at = now() where id = s.id;
  perform public._booking_log(s.record_id, s.scholar_id_number, s.starts_at, s.staff_id, p_outcome);

  if p_outcome = 'no_show' then
    update public.renewal_records set no_show_flag = true, no_show_count = no_show_count + 1, updated_at = now() where id = r.id;
    perform public._renewal_log(r.id, r.stage, r.stage, 'No-show for the consultation on ' || public._manila_slot_text(s.starts_at) || '. The scholar must book a new slot.');
    perform public._notify_scholar(s.scholar_id_number, 'no_show', 'You missed your consultation',
      'You did not come to your consultation on ' || public._manila_slot_text(s.starts_at) || '. Please book a new time from your Renewal tile.', r.id);
    return jsonb_build_object('ok', true, 'outcome', 'no_show');
  end if;

  update public.renewal_records set consultation_done_at = coalesce(consultation_done_at, now()), no_show_flag = false, updated_at = now() where id = r.id;
  perform public._renewal_log(r.id, r.stage, r.stage, 'Consultation attended on ' || public._manila_slot_text(s.starts_at) || '.');
  perform public._renewal_recheck(r.id);
  return public._counseling_prefill(s.id) || jsonb_build_object('ok', true, 'outcome', 'attended');
end;
$$;
revoke all on function public.counseling_mark_slot(uuid, text) from public, anon;
grant execute on function public.counseling_mark_slot(uuid, text) to authenticated;

-- What the pre-filled Daily Record of an attended appointment contains (also available later if the staff member closed the form).
create or replace function public.counseling_slot_prefill(p_slot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  if not exists (select 1 from public.counseling_slots x where x.id = p_slot_id and x.staff_id = auth.uid() and x.state = 'attended') then
    raise exception 'That attended appointment was not found.';
  end if;
  return public._counseling_prefill(p_slot_id);
end;
$$;
revoke all on function public.counseling_slot_prefill(uuid) from public, anon;
grant execute on function public.counseling_slot_prefill(uuid) to authenticated;

-- The INC deadline logic, shared by the Daily Record and by renewal_set_inc_deadline().
create or replace function public._renewal_apply_inc_deadline(p_item_id uuid, p_consultation_date date, p_days_given integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.renewal_inc_items%rowtype;
  v_new date;
begin
  select * into v_item from public.renewal_inc_items where id = p_item_id for update;
  if not found then raise exception 'That INC item was not found.'; end if;
  if v_item.state <> 'open' then raise exception 'This INC is already settled.'; end if;
  if p_days_given is null or p_days_given < 1 then raise exception 'The days given to comply must be at least 1.'; end if;
  if p_consultation_date is null then raise exception 'Please give the consultation date.'; end if;
  v_new := p_consultation_date + p_days_given;
  if v_item.deadline is not null and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A deadline already exists. Please give a reason for changing it.';
  end if;
  update public.renewal_inc_items set consultation_date = p_consultation_date, days_given = p_days_given, deadline = v_new, updated_at = now() where id = p_item_id;
  if v_item.deadline is not null then
    insert into public.renewal_inc_extensions (item_id, old_deadline, new_deadline, reason, changed_by, changed_by_label)
    values (p_item_id, v_item.deadline, v_new, btrim(p_reason), (select u.id from public.users u where u.id = auth.uid()), public._actor_name());
  end if;
  update public.renewal_records set consultation_done_at = coalesce(consultation_done_at, p_consultation_date::timestamptz) where id = v_item.record_id;
  perform public._renewal_log(v_item.record_id, null, (select stage from public.renewal_records where id = v_item.record_id),
    case when v_item.deadline is null then 'INC deadline set for ' else 'INC deadline changed for ' end || v_item.subject || ' to ' || to_char(v_new, 'Mon DD, YYYY') || ' (' || p_days_given || ' days).');
  perform public._notify_scholar(v_item.scholar_id_number, case when v_item.deadline is null then 'inc_deadline_set' else 'deadline_extended' end,
    case when v_item.deadline is null then 'Your INC deadline is set' else 'Your INC deadline was changed' end,
    'Complete your INC in ' || v_item.subject || ' by ' || to_char(v_new, 'FMMonth FMDD, YYYY') || '.', v_item.record_id);
  perform public._renewal_recheck(v_item.record_id);
end;
$$;
revoke all on function public._renewal_apply_inc_deadline(uuid, date, integer, text) from public, anon, authenticated;

create or replace function public.renewal_set_inc_deadline(p_item_id uuid, p_consultation_date date, p_days_given integer, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('scholar_counseling') then
    raise exception 'Only consultation staff set the INC deadline (in the Daily Record of the consultation).';
  end if;
  perform public._renewal_apply_inc_deadline(p_item_id, p_consultation_date, p_days_given, p_reason);
end;
$$;
revoke all on function public.renewal_set_inc_deadline(uuid, date, integer, text) from public, anon;
grant execute on function public.renewal_set_inc_deadline(uuid, date, integer, text) to authenticated;

-- Consultation staff can extend a deadline later, with a reason; the history of extensions is kept.
create or replace function public.renewal_extend_inc_deadline(p_item_id uuid, p_new_deadline date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.renewal_inc_items%rowtype;
begin
  perform public._require_counseling_staff();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason for extending the deadline.'; end if;
  select * into v_item from public.renewal_inc_items where id = p_item_id for update;
  if not found then raise exception 'That INC item was not found.'; end if;
  if v_item.state <> 'open' then raise exception 'This INC is already settled.'; end if;
  if v_item.deadline is null then raise exception 'No deadline has been set yet. Set it in the Daily Record of the consultation.'; end if;
  if p_new_deadline is null or p_new_deadline <= v_item.deadline then raise exception 'The new deadline must be later than the current one (%).', to_char(v_item.deadline, 'Mon DD, YYYY'); end if;
  insert into public.renewal_inc_extensions (item_id, old_deadline, new_deadline, reason, changed_by, changed_by_label)
  values (p_item_id, v_item.deadline, p_new_deadline, btrim(p_reason), auth.uid(), public._actor_name());
  update public.renewal_inc_items set deadline = p_new_deadline, updated_at = now() where id = p_item_id;
  perform public._renewal_log(v_item.record_id, null, (select stage from public.renewal_records where id = v_item.record_id),
    'INC deadline for ' || v_item.subject || ' extended to ' || to_char(p_new_deadline, 'Mon DD, YYYY') || ': ' || btrim(p_reason));
  perform public._notify_scholar(v_item.scholar_id_number, 'deadline_extended', 'Your INC deadline was extended',
    'Complete your INC in ' || v_item.subject || ' by ' || to_char(p_new_deadline, 'FMMonth FMDD, YYYY') || '.', v_item.record_id);
  perform public._renewal_recheck(v_item.record_id);
end;
$$;
revoke all on function public.renewal_extend_inc_deadline(uuid, date, text) from public, anon;
grant execute on function public.renewal_extend_inc_deadline(uuid, date, text) to authenticated;

-- The Daily Record of a renewal consultation (the form is pre-filled from the appointment). For INC the days given to comply are
-- REQUIRED and set the deadline for every INC subject that has none yet; for Summer the hard copy of the prospectus can be ticked.
create or replace function public.counseling_save_daily_record(
  p_slot_id uuid, p_scholar_id_number text, p_status text, p_date_visited date, p_failed_subjects text, p_findings text,
  p_staff_recommendations text, p_visit_type text, p_days_given integer default null, p_hard_copy boolean default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_item record;
  v_needs_days boolean := false;
begin
  perform public._require_counseling_staff();
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  if p_slot_id is not null then
    select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() for update;
    if not found then raise exception 'That appointment was not found.'; end if;
    if s.state <> 'attended' or s.scholar_id_number <> p_scholar_id_number then raise exception 'Mark the appointment as Attended first.'; end if;
    if s.daily_record_id is not null then raise exception 'A Daily Record was already saved for this appointment.'; end if;
    select * into r from public.renewal_records where id = s.record_id for update;
    select exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null) into v_needs_days;
    if v_needs_days and (p_days_given is null or p_days_given < 1) then
      raise exception 'Please enter the days given to comply for the INC subject(s).';
    end if;
  end if;

  insert into public.scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type,
      slot_id, renewal_record_id, days_given, prospectus_hard_copy)
  values (p_scholar_id_number, p_status, auth.uid(), coalesce(p_date_visited, current_date), coalesce(p_failed_subjects, ''), coalesce(p_findings, ''),
      coalesce(p_staff_recommendations, ''), coalesce(nullif(btrim(p_visit_type), ''), 'Office'), p_slot_id, r.id, p_days_given, p_hard_copy)
  returning id into v_id;

  if p_slot_id is not null then
    update public.counseling_slots set daily_record_id = v_id where id = p_slot_id;
    for v_item in select i.id from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null loop
      perform public._renewal_apply_inc_deadline(v_item.id, coalesce(p_date_visited, current_date), p_days_given, '');
    end loop;
    if r.term = 'Summer' and coalesce(p_hard_copy, false) then
      update public.renewal_records set hard_copy_received_at = coalesce(hard_copy_received_at, now()), updated_at = now() where id = r.id;
      perform public._renewal_log(r.id, r.stage, r.stage, 'Prospectus hard copy received.');
    end if;
    perform public._renewal_recheck(r.id);
  end if;
  return v_id;
end;
$$;
revoke all on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) from public, anon;
grant execute on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) to authenticated;

-- Ticking "prospectus hard copy received" later (Summer), for an appointment already attended.
create or replace function public.counseling_set_hard_copy(p_record_id uuid, p_received boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  perform public._require_counseling_staff();
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found or r.term <> 'Summer' then raise exception 'Only a Summer renewal has a prospectus hard copy.'; end if;
  update public.renewal_records set hard_copy_received_at = case when p_received then coalesce(hard_copy_received_at, now()) end, updated_at = now() where id = r.id;
  perform public._renewal_log(r.id, r.stage, r.stage, case when p_received then 'Prospectus hard copy received.' else 'Prospectus hard copy marked not received.' end);
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.counseling_set_hard_copy(uuid, boolean) from public, anon;
grant execute on function public.counseling_set_hard_copy(uuid, boolean) to authenticated;

-- Probationary Monitoring: the temporary (INC) probation, deadlines and uploaded study plans, per scholar with a renewal in progress.
create or replace function public.counseling_probation_renewal_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'scholar_id_number', r.scholar_id_number, 'record_id', r.id, 'term_label', r.term || ' ' || r.school_year, 'stage', r.stage, 'temporary_inc', r.temp_probation,
      'inc_items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'subject', i.subject, 'deadline', i.deadline,
          'days_left', case when i.deadline is null then null else i.deadline - (now() at time zone 'Asia/Manila')::date end) order by i.subject)
        from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open'), '[]'::jsonb),
      'study_plans', coalesce((select jsonb_agg(jsonb_build_object('file_name', d.file_name, 'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at) order by d.uploaded_at)
        from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan'), '[]'::jsonb)))
    from public.renewal_records r
    where r.stage not in ('not_required', 'late_declined', 'late_pending')
      and (r.temp_probation or exists (select 1 from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan')
           or exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open'))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.counseling_probation_renewal_info() from public, anon;
grant execute on function public.counseling_probation_renewal_info() to authenticated;

-- ── 5. Scholar: see open slots, book, reschedule, cancel ────
create or replace function public.renewal_open_slots(p_record_id uuid)
returns table(slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  if not exists (select 1 from public.renewal_records r where r.id = p_record_id and r.scholar_id_number = v_id) then raise exception 'That application was not found.'; end if;
  return query
  select x.id, x.starts_at, x.ends_at, public._staff_display_name(x.staff_id)
  from public.counseling_slots x
  where x.state = 'open' and x.starts_at >= now() + interval '12 hours' and x.starts_at < now() + interval '60 days'
  order by x.starts_at, x.staff_id
  limit 600;
end;
$$;
revoke all on function public.renewal_open_slots(uuid) from public, anon;
grant execute on function public.renewal_open_slots(uuid) to authenticated;

create or replace function public.renewal_book_slot(p_record_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
  s public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  if not public._renewal_consult_eligible(r.id) then raise exception 'You do not need to book a consultation right now.'; end if;
  if exists (select 1 from public.counseling_slots x where x.record_id = r.id and x.state = 'booked') then
    raise exception 'You already have a consultation booked. Reschedule it instead.';
  end if;
  select * into s from public.counseling_slots where id = p_slot_id and state = 'open' for update;
  if not found then raise exception 'That time was just taken. Please choose another.'; end if;
  if s.starts_at < now() + interval '12 hours' then raise exception 'You can only book a consultation that starts at least 12 hours from now.'; end if;
  update public.counseling_slots set state = 'booked', record_id = r.id, scholar_id_number = v_id, booked_at = now(),
    reminded_day_at = case when s.starts_at - now() < interval '24 hours' then now() end, reminded_hour_at = null where id = s.id;
  perform public._booking_log(r.id, v_id, s.starts_at, s.staff_id, 'booked');
  perform public._renewal_log(r.id, r.stage, r.stage, 'Booked a consultation for ' || public._manila_slot_text(s.starts_at) || ' with ' || public._staff_display_name(s.staff_id) || '.', 'Scholar');
  perform public._notify_scholar(v_id, 'booking_confirmed', 'Your consultation is booked',
    public._manila_slot_text(s.starts_at) || ' with ' || public._staff_display_name(s.staff_id) || ', at the CEDO office.'
      || case when r.term = 'Summer' then ' Please bring the hard copy of your prospectus.' else '' end, r.id);
end;
$$;
revoke all on function public.renewal_book_slot(uuid, uuid) from public, anon;
grant execute on function public.renewal_book_slot(uuid, uuid) to authenticated;

create or replace function public.renewal_reschedule_slot(p_record_id uuid, p_new_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
  v_old public.counseling_slots%rowtype;
  v_new public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  select * into v_old from public.counseling_slots where record_id = r.id and state = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked.'; end if;
  if v_old.starts_at < now() + interval '12 hours' then
    raise exception 'You can only change a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  select * into v_new from public.counseling_slots where id = p_new_slot_id and state = 'open' for update;
  if not found then raise exception 'That time was just taken. Please choose another.'; end if;
  if v_new.starts_at < now() + interval '12 hours' then raise exception 'You can only book a consultation that starts at least 12 hours from now.'; end if;
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, reminded_day_at = null, reminded_hour_at = null where id = v_old.id;
  update public.counseling_slots set state = 'booked', record_id = r.id, scholar_id_number = v_id, booked_at = now(),
    reminded_day_at = case when v_new.starts_at - now() < interval '24 hours' then now() end, reminded_hour_at = null where id = v_new.id;
  perform public._booking_log(r.id, v_id, v_new.starts_at, v_new.staff_id, 'rescheduled', 'From ' || public._manila_slot_text(v_old.starts_at));
  perform public._renewal_log(r.id, r.stage, r.stage, 'Rescheduled the consultation from ' || public._manila_slot_text(v_old.starts_at) || ' to ' || public._manila_slot_text(v_new.starts_at) || '.', 'Scholar');
  perform public._notify_scholar(v_id, 'booking_confirmed', 'Your consultation was rescheduled',
    'New time: ' || public._manila_slot_text(v_new.starts_at) || ' with ' || public._staff_display_name(v_new.staff_id) || '.', r.id);
end;
$$;
revoke all on function public.renewal_reschedule_slot(uuid, uuid) from public, anon;
grant execute on function public.renewal_reschedule_slot(uuid, uuid) to authenticated;

create or replace function public.renewal_cancel_booking(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
  v_old public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  select * into v_old from public.counseling_slots where record_id = r.id and state = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked.'; end if;
  if v_old.starts_at < now() + interval '12 hours' then
    raise exception 'You can only cancel a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, reminded_day_at = null, reminded_hour_at = null where id = v_old.id;
  perform public._booking_log(r.id, v_id, v_old.starts_at, v_old.staff_id, 'cancelled');
  perform public._renewal_log(r.id, r.stage, r.stage, 'Cancelled the consultation on ' || public._manila_slot_text(v_old.starts_at) || '.', 'Scholar');
  perform public._notify_scholar(v_id, 'booking_cancelled', 'Your consultation was cancelled', 'You cancelled ' || public._manila_slot_text(v_old.starts_at) || '. Please book a new time when you are ready.', r.id);
end;
$$;
revoke all on function public.renewal_cancel_booking(uuid) from public, anon;
grant execute on function public.renewal_cancel_booking(uuid) to authenticated;

-- ── 6. The scholar's overview now includes the booking ──────
create or replace function public.renewal_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_out jsonb := '[]'::jsonb;
  w record;
  v_rec public.renewal_records%rowtype;
  v_state text;
  v_slot public.counseling_slots%rowtype;
  v_booking jsonb;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  for w in
    select * from public.renewal_windows
    where opens_on <= v_today + 14 or exists (select 1 from public.renewal_records r where r.window_id = renewal_windows.id and r.scholar_id_number = v_id)
    order by opens_on desc limit 6
  loop
    select * into v_rec from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term;
    v_state := case when v_today < w.opens_on then 'upcoming' when v_today <= w.closes_on then 'open'
                    when w.late_allowed then 'late' else 'closed' end;
    v_booking := null;
    if v_rec.id is not null then
      select * into v_slot from public.counseling_slots x where x.record_id = v_rec.id and x.state = 'booked';
      if found then
        v_booking := jsonb_build_object('slot_id', v_slot.id, 'starts_at', v_slot.starts_at, 'ends_at', v_slot.ends_at, 'staff_name', public._staff_display_name(v_slot.staff_id),
          'can_change', v_slot.starts_at >= now() + interval '12 hours');
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'window', to_jsonb(w), 'state', v_state,
      'record', case when v_rec.id is null then null else to_jsonb(v_rec) end,
      'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
      'inc_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.subject) from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
      'booking', v_booking,
      'consult_needed', v_rec.id is not null and public._renewal_consult_eligible(v_rec.id)));
  end loop;
  return jsonb_build_object(
    'scholar', jsonb_build_object('scholar_id_number', v_scholar.scholar_id_number, 'school', v_scholar.school, 'program', v_scholar.course, 'year_level', v_scholar.year_level, 'status', v_scholar.status),
    'windows', v_out);
end;
$$;
revoke all on function public.renewal_my_overview() from public, anon;
grant execute on function public.renewal_my_overview() to authenticated;

-- ── 7. The evaluator's board and detail show the appointment ─
drop function if exists public.renewal_board(text, text);
create function public.renewal_board(p_school_year text, p_term text)
returns table(
  record_id uuid, scholar_id_number text, name text, school text, program text, year_level text, stage text, is_late boolean, late_decision text,
  applied_at timestamptz, rule_code text, failed_count integer, inc_count integer, sdp_complied boolean, sdp_missing text,
  consultation_required boolean, consultation_done boolean, no_show_flag boolean, scholar_note text, updated_at timestamptz, result text,
  next_consultation timestamptz, no_show_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  perform public._renewal_sweep();
  return query
  select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school,
         coalesce(r.confirmed_program, s.course), coalesce(r.confirmed_year_level, s.year_level), r.stage, r.is_late, r.late_decision, r.applied_at, r.rule_code,
         coalesce((r.evaluation -> 'failed_effective')::text::integer, 0), coalesce((r.evaluation -> 'open_inc')::text::integer, 0),
         nullif(r.evaluation -> 'sdp' ->> 'complied', '')::boolean, r.evaluation -> 'sdp' ->> 'missing',
         r.consultation_required, r.consultation_done_at is not null, r.no_show_flag, r.scholar_note, r.updated_at, r.result,
         (select x.starts_at from public.counseling_slots x where x.record_id = r.id and x.state = 'booked'), r.no_show_count
  from public.renewal_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term
  order by s.last_name, s.first_name;
end;
$$;
revoke all on function public.renewal_board(text, text) from public, anon;
grant execute on function public.renewal_board(text, text) to authenticated;

create or replace function public.renewal_record_detail(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_s public.scholars%rowtype;
  v_fresh jsonb;
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal record was not found.'; end if;
  select * into v_s from public.scholars where scholar_id_number = v_rec.scholar_id_number;
  v_fresh := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  return jsonb_build_object(
    'record', to_jsonb(v_rec),
    'scholar', jsonb_build_object('scholar_id_number', v_s.scholar_id_number, 'name', btrim(v_s.last_name || ', ' || v_s.first_name || ' ' || coalesce(v_s.middle_name, '')),
        'school', v_s.school, 'program', v_s.course, 'year_level', v_s.year_level, 'status', v_s.status, 'contact_no', v_s.contact_no),
    'evaluation', v_fresh,
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'from_stage', h.from_stage, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
    'inc_items', coalesce((select jsonb_agg(jsonb_build_object('item', to_jsonb(i),
        'extensions', coalesce((select jsonb_agg(to_jsonb(x) order by x.changed_at) from public.renewal_inc_extensions x where x.item_id = i.id), '[]'::jsonb)) order by i.subject)
      from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('starts_at', b.slot_starts_at, 'action', b.action, 'staff', public._staff_display_name(b.staff_id), 'actor', b.actor_label, 'note', b.note, 'at', b.at) order by b.at)
      from public.counseling_booking_history b where b.record_id = v_rec.id), '[]'::jsonb),
    'next_consultation', (select jsonb_build_object('starts_at', x.starts_at, 'staff', public._staff_display_name(x.staff_id)) from public.counseling_slots x where x.record_id = v_rec.id and x.state = 'booked'),
    'status_history', coalesce((select jsonb_agg(jsonb_build_object('status', h.status, 'previous_status', h.previous_status, 'is_temporary', h.is_temporary,
        'school_year', h.school_year, 'term', h.term, 'changed_at', h.changed_at, 'source', h.source, 'note', h.note) order by h.changed_at desc)
      from public.scholar_status_history h where h.scholar_id_number = v_rec.scholar_id_number), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_record_detail(uuid) from public, anon;
grant execute on function public.renewal_record_detail(uuid) to authenticated;

-- ── 8. The scheduler ────────────────────────────────────────
-- Sends the 1-day and 1-hour reminders and notices INC deadlines that have passed. Safe to run as often as you like.
create or replace function public.renewal_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_day integer := 0;
  v_hour integer := 0;
begin
  for s in
    select x.id, x.scholar_id_number, x.record_id, x.starts_at from public.counseling_slots x
    where x.state = 'booked' and x.starts_at > now() and x.starts_at <= now() + interval '24 hours' and x.reminded_day_at is null
  loop
    update public.counseling_slots set reminded_day_at = now() where id = s.id;
    perform public._notify_scholar(s.scholar_id_number, 'reminder_day', 'Your consultation is tomorrow', 'Reminder: ' || public._manila_slot_text(s.starts_at) || ' at the CEDO office.', s.record_id);
    v_day := v_day + 1;
  end loop;
  for s in
    select x.id, x.scholar_id_number, x.record_id, x.starts_at from public.counseling_slots x
    where x.state = 'booked' and x.starts_at > now() and x.starts_at <= now() + interval '1 hour' and x.reminded_hour_at is null
  loop
    update public.counseling_slots set reminded_hour_at = now() where id = s.id;
    perform public._notify_scholar(s.scholar_id_number, 'reminder_hour', 'Your consultation is in about an hour', 'Reminder: ' || public._manila_slot_text(s.starts_at) || ' at the CEDO office.', s.record_id);
    v_hour := v_hour + 1;
  end loop;
  perform public._renewal_sweep();
  return jsonb_build_object('day_reminders', v_day, 'hour_reminders', v_hour);
end;
$$;
revoke all on function public.renewal_scheduled_jobs() from public, anon, authenticated;

-- Schedule it every 5 minutes when the pg_cron extension is switched on (Supabase dashboard > Database > Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'renewal-scheduled-jobs';
    perform cron.schedule('renewal-scheduled-jobs', '*/5 * * * *', 'select public.renewal_scheduled_jobs()');
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select
  (select count(*) from public.counseling_availability) as availability_ranges,
  (select count(*) from public.counseling_slots) as slots,
  (select exists (select 1 from pg_extension where extname = 'pg_cron')) as pg_cron_switched_on;
