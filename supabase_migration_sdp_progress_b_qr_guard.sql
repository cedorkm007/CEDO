-- ─────────────────────────────────────────────────────────────
-- SDP PROGRESS MONITORING — step B: one way of confirming attendance per activity.   Safe to run twice.   Undo: undo_sdp_progress_b.sql
-- Run step A first.
--
-- Adds a small guard to the QR attendance: it refuses to attach QR attendance to an activity that has progress monitoring. (Step A already refuses the other way round.)
-- This changes ONE existing table (attendance_sessions), only by adding a guard that runs when a new attendance session is created: no row is read, changed or deleted.
-- It needs a very short lock on that table, so it waits at most 5 seconds and then stops with a message instead of holding anything up: if it says it could not get the lock,
-- simply run it again a minute later.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

create or replace function public._sdp_progress_block_qr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sdp_activity_id is not null and exists (select 1 from public.sdp_progress_monitoring m where m.activity_id = new.sdp_activity_id) then
    raise exception 'Progress monitoring is attached to this activity. An activity uses one way of confirming attendance, not both.';
  end if;
  return new;
end;
$$;
revoke all on function public._sdp_progress_block_qr() from public, anon, authenticated;

drop trigger if exists sdp_progress_block_qr on public.attendance_sessions;
create trigger sdp_progress_block_qr before insert on public.attendance_sessions
  for each row execute function public._sdp_progress_block_qr();

reset lock_timeout;
