-- UNDO for supabase_migration_sdp_update_p5_semester.sql
-- Puts the one-argument "Credit these scholars" back exactly as it was, and removes the three-argument form, the move function and the helper.
-- Credits are not touched. This locks no table.
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
  v_days date[];
begin
  if not (public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)) then
    raise exception 'You are not allowed to credit scholars for this activity.';
  end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then credit the scholars.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  perform set_config('app.sdp_source', 'credit_attended', true);
  for v_rec in
    select s.id as session_id, r.scholar_id_number, r.updated_at, greatest(coalesce(r.voucher_redemption_count, 0), least(coalesce(r.time_in_count, 0), coalesce(r.time_out_count, 0)), 1) as units
    from public.attendance_sessions s
    join public.attendance_records r on r.session_id = s.id
    join public.scholars sc on sc.scholar_id_number = r.scholar_id_number and sc.status <> 'Removed'
    where s.sdp_activity_id = p_activity_id and r.status = 'present'
      and not exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = r.scholar_id_number)
  loop
    v_days := public._sdp_redeemed_days(v_rec.session_id, v_rec.scholar_id_number);
    for v_occurrence in 1..v_rec.units loop
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
      values (p_activity_id, v_rec.scholar_id_number, (v_rec.updated_at at time zone 'Asia/Manila')::date, auth.uid(), v_occurrence, v_school_year, v_semester, v_days[v_occurrence])
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
    end loop;
    v_scholars := v_scholars + 1;
  end loop;
  perform set_config('app.sdp_source', '', true);
  return v_scholars;
end;
$$;
revoke all on function public.credit_attended_scholars(uuid) from public, anon;
grant execute on function public.credit_attended_scholars(uuid) to authenticated;
drop function if exists public.credit_attended_scholars(uuid, text, text);
drop function if exists public.move_sdp_credit_semester(uuid, text, text);
drop function if exists public._sdp_period_is_known(text, text);
notify pgrst, 'reload schema';
