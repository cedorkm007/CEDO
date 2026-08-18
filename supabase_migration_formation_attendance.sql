-- Extends the existing QR/code attendance system to Formation Activities.
-- Run this AFTER supabase_migration_formation_activities.sql and
-- supabase_migration_attendance_system.sql.

alter table public.attendance_sessions add column if not exists formation_activity_id uuid references public.formation_activities(id) on delete cascade;
alter table public.attendance_sessions alter column sdp_activity_id drop not null;
create unique index if not exists attendance_sessions_formation_activity_unique on public.attendance_sessions (formation_activity_id);

-- Earlier deployments used chk_attendance_session_source. Remove both
-- versions before applying the rule that supports SDP and Formation sessions.
alter table public.attendance_sessions drop constraint if exists chk_attendance_session_source;
alter table public.attendance_sessions drop constraint if exists attendance_sessions_exactly_one_activity;
alter table public.attendance_sessions add constraint attendance_sessions_exactly_one_activity
  check (num_nonnulls(sdp_activity_id, formation_activity_id) = 1);

drop policy if exists "sdp monitors manage attendance sessions" on public.attendance_sessions;
drop policy if exists "cedo monitors manage attendance sessions" on public.attendance_sessions;
create policy "cedo monitors manage attendance sessions" on public.attendance_sessions for all
  using (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
  with check (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
drop policy if exists "sdp monitors manage attendance codes" on public.attendance_codes;
drop policy if exists "cedo monitors manage attendance codes" on public.attendance_codes;
create policy "cedo monitors manage attendance codes" on public.attendance_codes for all
  using (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
  with check (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
drop policy if exists "sdp monitors read attendance records" on public.attendance_records;
drop policy if exists "cedo monitors read attendance records" on public.attendance_records;
create policy "cedo monitors read attendance records" on public.attendance_records for select
  using (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));

create or replace function public.redeem_attendance_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar_id text; v_activity_name text; v_updated_code uuid;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid attendance code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This attendance code has already been used.'; end if;
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar_id, redeemed_at = now()
    where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated_code;
  if v_updated_code is null then raise exception 'This attendance code has already been used.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  select coalesce(sdp.name, formation.name) into v_activity_name
    from public.attendance_sessions session
    left join public.sdp_activities sdp on sdp.id = session.sdp_activity_id
    left join public.formation_activities formation on formation.id = session.formation_activity_id
    where session.id = v_session.id;
  if v_code.kind = 'time_in' then
    insert into public.attendance_records (session_id, scholar_id_number, time_in_at, status) values (v_session.id, v_scholar_id, now(), 'incomplete')
    on conflict (session_id, scholar_id_number) do update set time_in_at = coalesce(attendance_records.time_in_at, excluded.time_in_at), status = case when attendance_records.time_out_at is null then 'incomplete' else 'present' end, updated_at = now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records (session_id, scholar_id_number, time_out_at, status) values (v_session.id, v_scholar_id, now(), 'incomplete')
    on conflict (session_id, scholar_id_number) do update set time_out_at = coalesce(attendance_records.time_out_at, excluded.time_out_at), status = case when attendance_records.time_in_at is null then 'incomplete' else 'present' end, updated_at = now();
  else
    insert into public.attendance_records (session_id, scholar_id_number, hours_earned, status) values (v_session.id, v_scholar_id, coalesce(v_session.duration_hours, 1), 'present')
    on conflict (session_id, scholar_id_number) do update set hours_earned = attendance_records.hours_earned + coalesce(v_session.duration_hours, 1), status = 'present', updated_at = now();
  end if;
  return jsonb_build_object('kind', v_code.kind, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;
