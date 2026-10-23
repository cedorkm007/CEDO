-- UNDO for supabase_migration_consultation_types_a_slots_columns.sql. Run it AFTER undo_consultation_types_b.sql.
-- Puts back the rule "one row per staff member per start time" and the required link to an availability range, but only when that is possible without losing
-- anything: if bookings made with the new system share a start (or have no availability range), those two rules are skipped and a notice says so
-- (the two optional columns stay; they are harmless). Nothing is deleted.
set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from public.counseling_slots group by staff_id, starts_at having count(*) > 1) then
    alter table public.counseling_slots drop constraint if exists counseling_slots_staff_id_starts_at_key;
    alter table public.counseling_slots add constraint counseling_slots_staff_id_starts_at_key unique (staff_id, starts_at);
  else
    raise notice 'Some bookings share a staff member and start time, so "one row per start time" was NOT put back.';
  end if;
  if not exists (select 1 from public.counseling_slots where availability_id is null) then
    alter table public.counseling_slots drop constraint if exists counseling_slots_availability_id_fkey;
    alter table public.counseling_slots add constraint counseling_slots_availability_id_fkey foreign key (availability_id) references public.counseling_availability(id) on delete cascade;
    alter table public.counseling_slots alter column availability_id set not null;
  else
    raise notice 'Some bookings have no availability range, so the required link was NOT put back.';
  end if;
end $$;

drop index if exists public.counseling_slots_staff_start_idx;
notify pgrst, 'reload schema';
