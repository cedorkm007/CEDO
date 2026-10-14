-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p4_tracker.sql
-- Scholar Renewal System, Phase 4: the scholar's Consultation tile.
-- Run AFTER supabase_migration_renewal_p3_appointments.sql. Additive and safe to run twice (one new read-only function).
--
-- The Renewal tile, its progress tracker and the "what to do next" wording need nothing new in the database: they show what the rules
-- function (_renewal_evaluate) already answers. The Consultation tile lists the scholar's own appointments (upcoming and past), and
-- booking / rescheduling / cancelling reuse the Phase 3 functions.
-- ─────────────────────────────────────────────────────────────

-- The signed-in scholar's own appointments, soonest upcoming first, then the most recent past ones.
create or replace function public.consultation_my_appointments()
returns table(slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text, state text, record_id uuid, term_label text, can_change boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  return query
  select x.id, x.starts_at, x.ends_at, public._staff_display_name(x.staff_id), x.state, x.record_id,
         case when r.id is null then null else r.term || ' ' || r.school_year end,
         (x.state = 'booked' and x.starts_at >= now() + interval '12 hours')
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.scholar_id_number = v_id and x.state <> 'open'
  order by (x.state = 'booked' and x.starts_at >= now()) desc,
           case when x.state = 'booked' and x.starts_at >= now() then x.starts_at end asc,
           x.starts_at desc
  limit 50;
end;
$$;
revoke all on function public.consultation_my_appointments() from public, anon;
grant execute on function public.consultation_my_appointments() to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select count(*) as appointments_so_far from public.counseling_slots where state <> 'open';
