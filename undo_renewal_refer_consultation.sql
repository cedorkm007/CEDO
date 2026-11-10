-- ─────────────────────────────────────────────────────────────
-- undo_renewal_refer_consultation.sql
-- Removes the "Refer for Consultation" functions. Consultations that were already booked through it stay booked (they are ordinary renewal consultations).
-- ─────────────────────────────────────────────────────────────
begin;
drop function if exists public.renewal_refer_book(uuid, text, date, text, uuid);
drop function if exists public.renewal_refer_block_staff(text, date, text);
drop function if exists public.renewal_refer_open_blocks(uuid, text);
drop function if exists public.renewal_refer_types(uuid);
drop function if exists public._renewal_can_refer(public.renewal_records);
commit;
