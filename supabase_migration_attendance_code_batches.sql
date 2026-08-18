-- Groups printable QR/code tickets into immutable batches for SDP and Formation attendance.
alter table public.attendance_codes add column if not exists batch_number integer not null default 1;
alter table public.attendance_codes drop constraint if exists attendance_codes_batch_number_positive;
alter table public.attendance_codes add constraint attendance_codes_batch_number_positive check (batch_number > 0);
create index if not exists idx_attendance_codes_session_batch on public.attendance_codes (session_id, batch_number);
