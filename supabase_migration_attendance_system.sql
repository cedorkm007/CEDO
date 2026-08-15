-- QR / number-code attendance system for SDP activities.
-- Run this in the Supabase SQL Editor after the SDP migrations. It is safe
-- to re-run and, importantly, makes every generated code single-use.

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  sdp_activity_id uuid not null unique references public.sdp_activities(id) on delete cascade,
  type text not null check (type in ('time_in_time_out', 'voucher')),
  expected_attendees integer check (expected_attendees is null or expected_attendees > 0),
  duration_hours integer check (duration_hours is null or duration_hours > 0),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_codes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  code text not null unique,
  kind text not null check (kind in ('time_in', 'time_out', 'voucher')),
  redeemed_by_scholar_id text references public.scholars(scholar_id_number),
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((redeemed_by_scholar_id is null) = (redeemed_at is null))
);
create index if not exists idx_attendance_codes_session on public.attendance_codes(session_id);
create unique index if not exists attendance_codes_code_unique on public.attendance_codes(code);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  scholar_id_number text not null references public.scholars(scholar_id_number),
  time_in_at timestamptz,
  time_out_at timestamptz,
  hours_earned integer not null default 0,
  status text not null default 'incomplete' check (status in ('incomplete', 'present')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, scholar_id_number)
);
create index if not exists idx_attendance_records_session on public.attendance_records(session_id);

-- The function locks the selected code row, then redeems it with a second
-- "still unused" condition. This blocks both accidental repeat scans and
-- simultaneous scans of the same QR/number code.
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.attendance_codes%rowtype;
  v_session public.attendance_sessions%rowtype;
  v_scholar_id text;
  v_activity_name text;
  v_updated_code uuid;
begin
  select scholar_id_number into v_scholar_id
  from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    raise exception 'Only signed-in scholars can redeem attendance codes.';
  end if;

  select * into v_code
  from public.attendance_codes
  where code = upper(trim(p_code))
  for update;
  if not found then
    raise exception 'Invalid attendance code.';
  end if;
  if v_code.redeemed_by_scholar_id is not null then
    raise exception 'This attendance code has already been used.';
  end if;

  update public.attendance_codes
  set redeemed_by_scholar_id = v_scholar_id, redeemed_at = now()
  where id = v_code.id and redeemed_by_scholar_id is null
  returning id into v_updated_code;
  if v_updated_code is null then
    raise exception 'This attendance code has already been used.';
  end if;

  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  select name into v_activity_name from public.sdp_activities where id = v_session.sdp_activity_id;

  if v_code.kind = 'time_in' then
    insert into public.attendance_records (session_id, scholar_id_number, time_in_at, status)
    values (v_session.id, v_scholar_id, now(), 'incomplete')
    on conflict (session_id, scholar_id_number) do update
      set time_in_at = coalesce(attendance_records.time_in_at, excluded.time_in_at),
          status = case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,
          updated_at = now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records (session_id, scholar_id_number, time_out_at, status)
    values (v_session.id, v_scholar_id, now(), 'incomplete')
    on conflict (session_id, scholar_id_number) do update
      set time_out_at = coalesce(attendance_records.time_out_at, excluded.time_out_at),
          status = case when attendance_records.time_in_at is null then 'incomplete' else 'present' end,
          updated_at = now();
  else
    insert into public.attendance_records (session_id, scholar_id_number, hours_earned, status)
    values (v_session.id, v_scholar_id, 1, 'present')
    on conflict (session_id, scholar_id_number) do update
      set hours_earned = attendance_records.hours_earned + 1,
          status = 'present', updated_at = now();
  end if;

  return jsonb_build_object('kind', v_code.kind, 'activityName', coalesce(v_activity_name, 'the activity'));
end;
$$;

grant execute on function public.redeem_attendance_code(text) to authenticated;

alter table public.attendance_sessions enable row level security;
alter table public.attendance_codes enable row level security;
alter table public.attendance_records enable row level security;

-- SDP-monitoring-tagged staff can create and review sessions/codes/rosters;
-- scholars access the data only through the guarded redeem RPC above.
drop policy if exists "sdp monitors manage attendance sessions" on public.attendance_sessions;
create policy "sdp monitors manage attendance sessions" on public.attendance_sessions for all
  using (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
  with check (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
drop policy if exists "sdp monitors manage attendance codes" on public.attendance_codes;
create policy "sdp monitors manage attendance codes" on public.attendance_codes for all
  using (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
  with check (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
drop policy if exists "sdp monitors read attendance records" on public.attendance_records;
create policy "sdp monitors read attendance records" on public.attendance_records for select
  using (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
