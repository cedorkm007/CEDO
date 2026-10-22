-- UNDO for supabase_migration_sdp_scan_one_per_batch.sql: puts the scan function back as the Phase 4 file left it (one code per DAY, no one-per-batch rule).
-- Scans already recorded are not touched.
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_code public.attendance_codes%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype;
  v_updated uuid;
  v_result jsonb;
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

  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  if v_code.day_date is not null and exists (
    select 1 from public.attendance_codes c
    where c.session_id = v_code.session_id and c.kind = v_code.kind and c.day_date = v_code.day_date
      and c.redeemed_by_scholar_id = v_scholar.scholar_id_number and c.id <> v_code.id
  ) then
    raise exception 'You already scanned a code for this day%.', coalesce(' (' || nullif(public._sdp_day_sub_name(v_session.sdp_activity_id, v_code.day_date), '') || ')', '');
  end if;

  v_result := public._apply_attendance(v_session.id, v_scholar.scholar_id_number, v_code.kind, v_code.day_date);
  if (v_result ->> 'alreadyScanned')::boolean then
    if (v_result ->> 'maxAttempts')::integer > 1 then
      raise exception 'You already completed this attendance requirement (% of % allowed attendances used).', v_result ->> 'attemptsUsed', v_result ->> 'maxAttempts';
    else
      raise exception 'You already completed this attendance requirement.';
    end if;
  end if;

  return v_result;
end;
$function$;
revoke all on function public.redeem_attendance_code(text) from public, anon;
grant execute on function public.redeem_attendance_code(text) to authenticated;

notify pgrst, 'reload schema';
