-- Restricts Formation attendance to eligible year levels and exposes only the
-- signed-in scholar's completed activity attendance to the scholar portal.
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype; v_name text; v_updated uuid;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid QR code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This QR code has already been claimed.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  if v_session.formation_activity_id is not null and not exists (
    select 1 from public.formation_activities a where a.id = v_session.formation_activity_id
    and (a.all_year_levels or v_scholar.year_level = any(a.target_year_levels))
  ) then raise exception 'You are not eligible to attend this activity.'; end if;
  if exists (select 1 from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number and ((v_code.kind = 'time_in' and r.time_in_at is not null) or (v_code.kind = 'time_out' and r.time_out_at is not null) or v_code.kind = 'voucher')) then
    raise exception 'You already completed this attendance requirement.';
  end if;
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;
  if v_code.kind = 'time_in' then insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif v_code.kind = 'time_out' then insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_out_at=coalesce(attendance_records.time_out_at,excluded.time_out_at),status=case when attendance_records.time_in_at is null then 'incomplete' else 'present' end,updated_at=now();
  else insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status) values(v_session.id,v_scholar.scholar_id_number,coalesce(v_session.duration_hours,1),'present') on conflict(session_id,scholar_id_number) do update set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),status='present',updated_at=now(); end if;
  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'));
end; $$;

create or replace function public.my_completed_activity_attendance()
returns table(formation_activity_id uuid, sdp_activity_id uuid) language sql security definer set search_path=public as $$
  select s.formation_activity_id,s.sdp_activity_id from public.attendance_records r join public.attendance_sessions s on s.id=r.session_id join public.scholars me on me.id=auth.uid() where r.scholar_id_number=me.scholar_id_number and r.status='present';
$$;
grant execute on function public.my_completed_activity_attendance() to authenticated;
