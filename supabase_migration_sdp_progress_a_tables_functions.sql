-- ─────────────────────────────────────────────────────────────
-- SDP PROGRESS MONITORING — step A: the new tables, the private picture folder and the functions.   Safe to run twice.   Undo: undo_sdp_progress_a.sql
--
-- Progress monitoring is a second way of confirming attendance in an SDP activity (the first is the QR attendance). When it is attached to an activity, a scholar takes a
-- picture with the phone's camera (with the place and the date and time printed on it), and a staff member approves or rejects it. An approved picture credits the scholar:
-- the same attendance and SDP credit that a QR scan gives.
--
-- This file CREATES new tables and functions only. It does not change, move or delete anything that exists (no existing table is altered).
--   1. sdp_progress_monitoring   which activities have progress monitoring attached (one row per activity)
--   2. sdp_progress_submissions  each scholar's picture for an activity: where, when, and whether it was approved (one row per scholar and activity)
--   3. sdp-progress-photos       a private picture folder: a scholar reaches only their own pictures; SDP staff can read them to review
--   4. functions                 attach / detach, send a picture, list the pictures to review, approve (which credits the scholar), reject
-- Who may do what:
--   attach / detach     SEAD staff and staff with the SDP Monitoring tag (the same people who attach the QR attendance)
--   review a picture    those, and the monitors assigned to that activity
--   send a picture      the signed-in scholar, for their own account only
-- ─────────────────────────────────────────────────────────────

-- ── 1. Which activities have progress monitoring ────────────
create table if not exists public.sdp_progress_monitoring (
  activity_id uuid primary key references public.sdp_activities(id) on delete cascade,
  enabled_by  uuid,
  enabled_at  timestamptz not null default now()
);
alter table public.sdp_progress_monitoring enable row level security;
drop policy if exists "signed-in users read progress monitoring" on public.sdp_progress_monitoring;
create policy "signed-in users read progress monitoring" on public.sdp_progress_monitoring for select to authenticated using (true);
-- no insert / update / delete policy: the functions below are the only way to change it

-- ── 2. The pictures ─────────────────────────────────────────
create table if not exists public.sdp_progress_submissions (
  id                uuid primary key default gen_random_uuid(),
  activity_id       uuid not null references public.sdp_activities(id) on delete cascade,
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  image_path        text not null,
  captured_at       timestamptz not null,            -- the time on the scholar's phone when the picture was taken (printed on the picture)
  taken_lat         numeric not null check (taken_lat between -90 and 90),
  taken_lng         numeric not null check (taken_lng between -180 and 180),
  accuracy_m        numeric,
  place_text        text,                            -- the place name printed on the picture ("Carmen, Cagayan de Oro City, Misamis Oriental")
  submitted_at      timestamptz not null default now(),   -- the time on OUR server when the picture arrived
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  reject_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (activity_id, scholar_id_number)
);
create index if not exists sdp_progress_submissions_status_idx on public.sdp_progress_submissions (status, submitted_at);
create index if not exists sdp_progress_submissions_scholar_idx on public.sdp_progress_submissions (scholar_id_number);
alter table public.sdp_progress_submissions enable row level security;

-- ── 3. Who may review ───────────────────────────────────────
create or replace function public._sdp_progress_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_sead_staff() or public.has_staff_tag('sdp_monitoring'); $$;
revoke all on function public._sdp_progress_staff() from public, anon;
grant execute on function public._sdp_progress_staff() to authenticated;

create or replace function public._sdp_progress_can_review(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._sdp_progress_staff() or (p_activity_id is not null and public.is_activity_monitor('sdp', p_activity_id)); $$;
revoke all on function public._sdp_progress_can_review(uuid) from public, anon;
grant execute on function public._sdp_progress_can_review(uuid) to authenticated;

drop policy if exists "scholar or reviewer reads progress pictures" on public.sdp_progress_submissions;
create policy "scholar or reviewer reads progress pictures" on public.sdp_progress_submissions for select to authenticated
  using (scholar_id_number = public.current_scholar_id_number() or public._sdp_progress_can_review(activity_id));
-- no insert / update / delete policy: send, approve and reject go through the functions below

-- ── 4. The private picture folder: <scholar id number>/<activity id>/<file>.jpg ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sdp-progress-photos', 'sdp-progress-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists "scholar adds own progress picture" on storage.objects;
create policy "scholar adds own progress picture" on storage.objects for insert
  with check (bucket_id = 'sdp-progress-photos' and (storage.foldername(name))[1] = public.current_scholar_id_number());
drop policy if exists "scholar or reviewer reads progress picture" on storage.objects;
create policy "scholar or reviewer reads progress picture" on storage.objects for select
  using (bucket_id = 'sdp-progress-photos' and (
    (storage.foldername(name))[1] = public.current_scholar_id_number()
    or public._sdp_progress_staff()
    or ((storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$' and public._sdp_progress_can_review(((storage.foldername(name))[2])::uuid))));
-- a scholar may remove their own picture (this is how the old picture goes when a new one is sent), but never one that was approved
drop policy if exists "scholar removes own progress picture" on storage.objects;
create policy "scholar removes own progress picture" on storage.objects for delete
  using (bucket_id = 'sdp-progress-photos' and (storage.foldername(name))[1] = public.current_scholar_id_number()
    and not exists (select 1 from public.sdp_progress_submissions s where s.image_path = name and s.status = 'approved'));

-- ── 5. Attach / detach ──────────────────────────────────────
create or replace function public.sdp_progress_enable(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  if not public._sdp_progress_staff() then raise exception 'You are not allowed to turn on progress monitoring.'; end if;
  select a.category into v_category from public.sdp_activities a where a.id = p_activity_id;
  if not found then raise exception 'The activity was not found.'; end if;
  if v_category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then turn on progress monitoring.'; end if;
  if exists (select 1 from public.attendance_sessions s where s.sdp_activity_id = p_activity_id) then
    raise exception 'QR attendance is already attached to this activity. An activity uses one way of confirming attendance, not both.';
  end if;
  insert into public.sdp_progress_monitoring (activity_id, enabled_by) values (p_activity_id, auth.uid()) on conflict (activity_id) do nothing;
end;
$$;
revoke all on function public.sdp_progress_enable(uuid) from public, anon;
grant execute on function public.sdp_progress_enable(uuid) to authenticated;

create or replace function public.sdp_progress_disable(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._sdp_progress_staff() then raise exception 'You are not allowed to turn off progress monitoring.'; end if;
  if exists (select 1 from public.sdp_progress_submissions s where s.activity_id = p_activity_id and s.status = 'pending') then
    raise exception 'Some pictures are still waiting for approval. Approve or reject them first, then turn progress monitoring off.';
  end if;
  delete from public.sdp_progress_monitoring where activity_id = p_activity_id;
end;
$$;
revoke all on function public.sdp_progress_disable(uuid) from public, anon;
grant execute on function public.sdp_progress_disable(uuid) to authenticated;

-- ── 6. The scholar sends a picture ──────────────────────────
-- The picture itself is already in the private folder (the app uploads it first). This records it. A scholar has ONE picture per activity: sending another while the first is
-- waiting (or was rejected) replaces it, and the function says which file is the old one so the app can delete it.
create or replace function public.sdp_progress_submit(p_activity_id uuid, p_image_path text, p_captured_at timestamptz, p_lat numeric, p_lng numeric, p_accuracy numeric, p_place text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_last date;
  v_old public.sdp_progress_submissions%rowtype;
  v_new_id uuid;
begin
  if v_id is null then raise exception 'Only a signed-in scholar can send a picture.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  if v_scholar.status = 'Removed' then raise exception 'Your scholarship has ended, so a picture cannot be sent.'; end if;
  if not exists (select 1 from public.sdp_activities a where a.id = p_activity_id and a.submitted_by_scholar_id is null) then raise exception 'The activity was not found.'; end if;
  if not exists (select 1 from public.sdp_progress_monitoring m where m.activity_id = p_activity_id) then raise exception 'This activity does not use picture confirmation.'; end if;
  if p_image_path is null or p_image_path not like v_id || '/' || p_activity_id::text || '/%' then raise exception 'The picture is not in your folder.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Your location is needed. Allow the location and take the picture again.'; end if;
  if p_captured_at is null or abs(extract(epoch from (now() - p_captured_at))) > 900 then
    raise exception 'The date and time on your phone do not match the real time. Set your phone to automatic date and time, then take the picture again.';
  end if;
  -- any day until the activity's last date
  select max(d.day) into v_last from public._sdp_schedule_days(p_activity_id) d;
  if v_last is not null and v_today > v_last then raise exception 'This activity has ended (its last date was %). Pictures are no longer accepted.', to_char(v_last, 'Mon DD, YYYY'); end if;
  select * into v_old from public.sdp_progress_submissions where activity_id = p_activity_id and scholar_id_number = v_id for update;
  if found and v_old.status = 'approved' then raise exception 'Your picture for this activity was already approved.'; end if;
  if exists (select 1 from public.sdp_attendance c where c.activity_id = p_activity_id and c.scholar_id_number = v_id) then raise exception 'You are already credited for this activity.'; end if;

  if found then
    update public.sdp_progress_submissions
       set status = 'pending', image_path = p_image_path, captured_at = p_captured_at, taken_lat = p_lat, taken_lng = p_lng, accuracy_m = p_accuracy, place_text = nullif(btrim(p_place), ''),
           submitted_at = now(), reviewed_by = null, reviewed_at = null, reject_reason = null, updated_at = now()
     where id = v_old.id;
    v_new_id := v_old.id;
  else
    insert into public.sdp_progress_submissions (activity_id, scholar_id_number, image_path, captured_at, taken_lat, taken_lng, accuracy_m, place_text)
    values (p_activity_id, v_id, p_image_path, p_captured_at, p_lat, p_lng, p_accuracy, nullif(btrim(p_place), ''))
    returning id into v_new_id;
  end if;
  return jsonb_build_object('id', v_new_id, 'old_path', case when v_old.id is not null and v_old.image_path <> p_image_path then v_old.image_path else null end);
end;
$$;
revoke all on function public.sdp_progress_submit(uuid, text, timestamptz, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.sdp_progress_submit(uuid, text, timestamptz, numeric, numeric, numeric, text) to authenticated;

-- ── 7. The list for the reviewers ───────────────────────────
-- One page of pictures, with the scholar's details. SEAD / SDP staff see every activity; a monitor sees only the activities they monitor.
create or replace function public.sdp_progress_list(p_status text default 'pending', p_activity_id uuid default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, activity_id uuid, activity_name text, scholar_id_number text, scholar_name text, school text, program text, status text, image_path text, place_text text,
  taken_lat numeric, taken_lng numeric, accuracy_m numeric, captured_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz, reviewer_name text, reject_reason text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_full boolean := public._sdp_progress_staff();
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not v_full and not exists (select 1 from public.sdp_progress_monitoring m where public.is_activity_monitor('sdp', m.activity_id)) then
    raise exception 'You are not allowed to review pictures.';
  end if;
  return query
  select s.id, s.activity_id, a.name::text, s.scholar_id_number, btrim(coalesce(sc.first_name, '') || ' ' || coalesce(sc.last_name, ''))::text, sc.school::text, sc.course::text, s.status::text, s.image_path::text, s.place_text::text,
         s.taken_lat, s.taken_lng, s.accuracy_m, s.captured_at, s.submitted_at, s.reviewed_at,
         (select btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) from public.users u where u.id = s.reviewed_by)::text, s.reject_reason::text,
         count(*) over ()
  from public.sdp_progress_submissions s
  join public.sdp_activities a on a.id = s.activity_id
  join public.scholars sc on sc.scholar_id_number = s.scholar_id_number
  where (p_status is null or p_status = 'all' or s.status = p_status)
    and (p_activity_id is null or s.activity_id = p_activity_id)
    and (v_full or public.is_activity_monitor('sdp', s.activity_id))
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (coalesce(sc.first_name, '') || ' ' || coalesce(sc.last_name, '')) ilike '%' || v_q || '%'
         or (coalesce(sc.last_name, '') || ' ' || coalesce(sc.first_name, '')) ilike '%' || v_q || '%')
  order by case when s.status = 'pending' then extract(epoch from s.submitted_at) else -extract(epoch from coalesce(s.reviewed_at, s.submitted_at)) end
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.sdp_progress_list(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.sdp_progress_list(text, uuid, text, integer, integer) to authenticated;

-- How many pictures are waiting, approved and rejected (for the three buttons above the list).
create or replace function public.sdp_progress_counts(p_activity_id uuid default null)
returns table (pending bigint, approved bigint, rejected bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_full boolean := public._sdp_progress_staff();
begin
  if not v_full and not exists (select 1 from public.sdp_progress_monitoring m where public.is_activity_monitor('sdp', m.activity_id)) then
    raise exception 'You are not allowed to review pictures.';
  end if;
  return query
  select count(*) filter (where s.status = 'pending'), count(*) filter (where s.status = 'approved'), count(*) filter (where s.status = 'rejected')
  from public.sdp_progress_submissions s
  where (p_activity_id is null or s.activity_id = p_activity_id) and (v_full or public.is_activity_monitor('sdp', s.activity_id));
end;
$$;
revoke all on function public.sdp_progress_counts(uuid) from public, anon;
grant execute on function public.sdp_progress_counts(uuid) to authenticated;

-- ── 8. Approve (credits the scholar) and reject ─────────────
-- Approving gives the scholar the attendance and the SDP credit, exactly like a QR scan: one credit for the activity, in the current school year and semester. When the scholar
-- already has the 3 credits the category needs this semester, the extra credit is banked as a reserved credit (the same rule the QR attendance follows).
create or replace function public.sdp_progress_approve(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.sdp_progress_submissions%rowtype;
  v_act record;
  v_school_year text; v_semester text;
  v_prior integer;
  v_result text;
begin
  select * into v_sub from public.sdp_progress_submissions where id = p_submission_id for update;
  if not found then raise exception 'The picture was not found.'; end if;
  if not public._sdp_progress_can_review(v_sub.activity_id) then raise exception 'You are not allowed to review this picture.'; end if;
  if v_sub.status = 'approved' then return jsonb_build_object('credit', 'already_approved'); end if;
  if exists (select 1 from public.scholars s where s.scholar_id_number = v_sub.scholar_id_number and s.status = 'Removed') then raise exception 'This scholar was removed from the program, so the picture cannot be approved.'; end if;
  select a.category, a.credits, a.name into v_act from public.sdp_activities a where a.id = v_sub.activity_id;
  if v_act.category is null then raise exception 'Choose an SDP category for this activity first (Activity Details), then approve the pictures.'; end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester from public.grading_period_settings gps where gps.id = true;
  if coalesce(v_school_year, '') = '' or coalesce(v_semester, '') = '' then raise exception 'The current school year and semester are not set yet.'; end if;

  if exists (select 1 from public.sdp_attendance c where c.activity_id = v_sub.activity_id and c.scholar_id_number = v_sub.scholar_id_number) then
    v_result := 'already_credited';
  else
    v_prior := public._sdp_period_credits(v_sub.scholar_id_number, v_act.category, v_school_year, v_semester);
    if v_prior >= public.sdp_category_credit_goal() then
      insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
      values (v_sub.scholar_id_number, v_act.category, coalesce(v_act.credits, 1), v_school_year, v_semester);
      v_result := 'banked';
    else
      perform set_config('app.sdp_source', 'progress_picture', true);
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
      values (v_sub.activity_id, v_sub.scholar_id_number, (v_sub.captured_at at time zone 'Asia/Manila')::date, auth.uid(), 1, v_school_year, v_semester, null)
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
      perform set_config('app.sdp_source', '', true);
      v_result := 'credited';
    end if;
  end if;

  update public.sdp_progress_submissions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null, updated_at = now() where id = v_sub.id;
  return jsonb_build_object('credit', v_result);
end;
$$;
revoke all on function public.sdp_progress_approve(uuid) from public, anon;
grant execute on function public.sdp_progress_approve(uuid) to authenticated;

create or replace function public.sdp_progress_reject(p_submission_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.sdp_progress_submissions%rowtype;
begin
  select * into v_sub from public.sdp_progress_submissions where id = p_submission_id for update;
  if not found then raise exception 'The picture was not found.'; end if;
  if not public._sdp_progress_can_review(v_sub.activity_id) then raise exception 'You are not allowed to review this picture.'; end if;
  if v_sub.status = 'approved' then raise exception 'This picture was already approved and the scholar was credited. It cannot be rejected here.'; end if;
  update public.sdp_progress_submissions
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''), updated_at = now()
   where id = v_sub.id;
end;
$$;
revoke all on function public.sdp_progress_reject(uuid, text) from public, anon;
grant execute on function public.sdp_progress_reject(uuid, text) to authenticated;

notify pgrst, 'reload schema';
