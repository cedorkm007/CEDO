-- ─────────────────────────────────────────────────────────────
-- CONSULTATION TYPES AND AM / PM BOOKING, FILE A of 2: the booking table (counseling_slots).   Safe to run twice.   Undo: undo_consultation_types_a.sql
-- Run this FIRST, on its own, then supabase_migration_consultation_types_b_booking.sql.
--
-- A booking used to be one of many pre-made 10-minute slots. A booking is now "this scholar, this type of consultation (its own minutes), this day, morning or
-- afternoon", so the table needs to remember the type and its minutes, and several bookings can now share the same start. This file only:
--   • adds two optional columns (consult_type, minutes); every existing row keeps working as it is (no type = a plain 10-minute booking);
--   • removes the rule "one row per staff member per start time" (several bookings can share a morning or afternoon);
--   • lets a booking exist without a pre-made availability row (the link to the availability range becomes optional).
-- Changes ONE table; nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.counseling_slots add column if not exists consult_type text;
alter table public.counseling_slots add column if not exists minutes integer;
alter table public.counseling_slots drop constraint if exists counseling_slots_minutes_positive;
alter table public.counseling_slots add constraint counseling_slots_minutes_positive check (minutes is null or minutes > 0);

alter table public.counseling_slots drop constraint if exists counseling_slots_staff_id_starts_at_key;

alter table public.counseling_slots alter column availability_id drop not null;
alter table public.counseling_slots drop constraint if exists counseling_slots_availability_id_fkey;
alter table public.counseling_slots add constraint counseling_slots_availability_id_fkey
  foreign key (availability_id) references public.counseling_availability(id) on delete set null;

create index if not exists counseling_slots_staff_start_idx on public.counseling_slots (staff_id, starts_at);

notify pgrst, 'reload schema';
