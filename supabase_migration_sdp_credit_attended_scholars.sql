-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_credit_attended_scholars.sql
--
-- Scholars who scanned an SDP activity's QR codes and are marked PRESENT, but have no credit row for it. This happens when the activity had no SDP
-- category at the time of the scan (it was created as "not credited in SDP", or the category was chosen later): the scan is recorded, no credit is
-- written, and choosing the category afterwards did not go back and credit the people who had already attended.
--
-- credit_attended_scholars(activity): for one SDP activity that HAS a category, credits every scholar who is present but has no credit row for it
-- (one credit row per finished day / voucher), stamped with the CURRENT grading period (the real semester of the scan is not recorded), dated the day
-- of their scan, and marked as added by the staff member who pressed the button. Scholars who are waiting for a survey are left alone (they are
-- credited when they answer it). Safe to press twice: nobody is credited twice.
--
-- Who may call it: SDP-monitoring staff, SEAD staff, and the monitors / creator of that activity.
-- Run AFTER supabase_migration_sdp_recurring_attendance_fix.sql. Safe to run again.
-- ─────────────────────────────────────────────────────────────

create or replace function public.credit_attended_scholars(p_activity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_school_year text;
  v_semester text;
  v_rec record;
  v_units integer;
  v_occurrence integer;
  v_scholars integer := 0;
begin
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'You are not allowed to credit scholars for this activity.';
  end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then credit the scholars.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  for v_rec in
    select r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present'
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester)
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
    end loop;
    v_scholars := v_scholars + 1;
  end loop;
  return v_scholars;
end;
$$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;

notify pgrst, 'reload schema';
