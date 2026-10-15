-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p6_notifications.sql
--
-- Scholar Renewal System, Phase 6: notifications. Run AFTER the Phase 5 file. Additive and safe to run twice.
--
--   1. STAFF NOTIFICATIONS. The evaluator (and the consultation staff member who owns a slot) get a notification in the staff bell
--      (the existing "notifications" table, type "renewal") when something needs them: a late application, a case ready to confirm
--      or endorse, marks to review, a study plan / INC letter to review, a scholar flagging a problem, an INC deadline that passed,
--      a Division Head decision or send-back, a case sent to the Division Head, a consultation booked / changed / cancelled.
--   2. WEB PUSH. Devices (phones and computers, scholars and staff) can subscribe; every new bell notification of a subscribed person
--      is also queued in push_outbox. The "push-sender" edge function (supabase/functions/push-sender) sends the queue every minute
--      (a pg_cron job calls it; push_sender_schedule() sets that up once) and reports the result back so dead devices are dropped.
--      Push is best effort: the bell always has the notification.
--   3. MORE REMINDERS (scheduler). "Renewal is now open" when a window opens, INC deadline reminders at 7 and 2 days, and "the window
--      closes soon" alerts at 3 days and 1 day for scholars who have not applied (or whose application was returned). Sent between 8:00 and 18:00 Philippine time only, each at
--      most once (renewal_notice_log). The 1-day and 1-hour consultation reminders and the INC-deadline-passed check from Phase 3 run
--      in the same job: renewal_run_scheduled_jobs().
-- ─────────────────────────────────────────────────────────────

-- ── 1. Devices that can receive push ────────────────────────
create table if not exists public.push_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  owner_kind        text not null check (owner_kind in ('scholar', 'staff')),
  scholar_id_number text references public.scholars(scholar_id_number) on delete cascade,
  staff_id          uuid references public.users(id) on delete cascade,
  endpoint          text not null unique,
  p256dh            text not null,
  auth              text not null,
  user_agent        text not null default '',
  created_at        timestamptz not null default now(),
  last_ok_at        timestamptz,
  failures          integer not null default 0,
  check ((owner_kind = 'scholar' and scholar_id_number is not null and staff_id is null)
      or (owner_kind = 'staff' and staff_id is not null and scholar_id_number is null))
);
create index if not exists push_subscriptions_scholar_idx on public.push_subscriptions (scholar_id_number) where scholar_id_number is not null;
create index if not exists push_subscriptions_staff_idx on public.push_subscriptions (staff_id) where staff_id is not null;
alter table public.push_subscriptions enable row level security;
drop policy if exists "owner reads own push devices" on public.push_subscriptions;
create policy "owner reads own push devices" on public.push_subscriptions for select
  using ((owner_kind = 'scholar' and scholar_id_number = public.current_scholar_id_number()) or (owner_kind = 'staff' and staff_id = auth.uid()));
-- No write policy: devices are added and removed through the functions below.

-- What is queued to be pushed (filled by triggers, drained by the push-sender edge function).
create table if not exists public.push_outbox (
  id                uuid primary key default gen_random_uuid(),
  owner_kind        text not null check (owner_kind in ('scholar', 'staff')),
  scholar_id_number text,
  staff_id          uuid,
  title             text not null,
  body              text not null default '',
  url               text not null default '/',
  created_at        timestamptz not null default now(),
  attempts          integer not null default 0,
  sent_at           timestamptz,
  last_error        text
);
create index if not exists push_outbox_pending_idx on public.push_outbox (created_at) where sent_at is null;
alter table public.push_outbox enable row level security;      -- no policy: only the database functions and the service role touch it

-- Messages already sent once (INC reminders, window-closing alerts), so the scheduler never repeats itself.
create table if not exists public.renewal_notice_log (
  kind              text not null,
  scholar_id_number text not null,
  ref               text not null,
  sent_at           timestamptz not null default now(),
  primary key (kind, scholar_id_number, ref)
);
alter table public.renewal_notice_log enable row level security;

-- Who is calling: a scholar or a staff member.
create or replace function public._push_caller()
returns table(owner_kind text, scholar_id_number text, staff_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select 'scholar'::text, public.current_scholar_id_number(), null::uuid where public.current_scholar_id_number() is not null
  union all
  select 'staff'::text, null::text, u.id from public.users u where u.id = auth.uid() and public.current_scholar_id_number() is null;
$$;
revoke all on function public._push_caller() from public, anon, authenticated;

-- A device turns notifications on. A device that was used by someone else before moves to the person using it now.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public._push_caller() limit 1;
  if not found then raise exception 'Please sign in to turn on notifications.'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000 then raise exception 'That device address is not valid.'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' or char_length(p_p256dh) > 300 or char_length(p_auth) > 100 then raise exception 'That device key is not valid.'; end if;
  insert into public.push_subscriptions (owner_kind, scholar_id_number, staff_id, endpoint, p256dh, auth, user_agent)
  values (c.owner_kind, c.scholar_id_number, c.staff_id, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set owner_kind = excluded.owner_kind, scholar_id_number = excluded.scholar_id_number, staff_id = excluded.staff_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0, created_at = now();
end;
$$;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public._push_caller() limit 1;
  if not found then raise exception 'Please sign in.'; end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint
    and ((c.owner_kind = 'scholar' and s.scholar_id_number = c.scholar_id_number) or (c.owner_kind = 'staff' and s.staff_id = c.staff_id));
end;
$$;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- My devices (for the settings line "Notifications are on for 2 devices").
create or replace function public.push_my_devices()
returns table(endpoint text, user_agent text, created_at timestamptz, last_ok_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.endpoint, s.user_agent, s.created_at, s.last_ok_at
  from public.push_subscriptions s, public._push_caller() c
  where (c.owner_kind = 'scholar' and s.scholar_id_number = c.scholar_id_number) or (c.owner_kind = 'staff' and s.staff_id = c.staff_id)
  order by s.created_at desc;
$$;
revoke all on function public.push_my_devices() from public, anon;
grant execute on function public.push_my_devices() to authenticated;

-- "Send me a test notification": queues one push for my own devices and reports how many devices will get it.
create or replace function public.push_send_test()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  n integer;
begin
  select * into c from public._push_caller() limit 1;
  if not found then raise exception 'Please sign in.'; end if;
  select count(*) into n from public.push_subscriptions s
    where (c.owner_kind = 'scholar' and s.scholar_id_number = c.scholar_id_number) or (c.owner_kind = 'staff' and s.staff_id = c.staff_id);
  if n = 0 then return 0; end if;
  insert into public.push_outbox (owner_kind, scholar_id_number, staff_id, title, body, url)
  values (c.owner_kind, c.scholar_id_number, c.staff_id, 'Notifications are working', 'This is a test from the CEDO portal. You will get renewal updates like this.',
          case c.owner_kind when 'scholar' then '/CEDO/portal' else '/' end);
  return n;
end;
$$;
revoke all on function public.push_send_test() from public, anon;
grant execute on function public.push_send_test() to authenticated;

-- ── 2. Queueing a push whenever a bell notification is created ──
create or replace function public._push_enqueue_scholar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.scholar_id_number = new.scholar_id_number) then
    insert into public.push_outbox (owner_kind, scholar_id_number, title, body, url)
    values ('scholar', new.scholar_id_number, new.title, new.body, '/CEDO/portal?formsTab=services&service=renewal&panel=services');
  end if;
  return null;
end;
$$;
drop trigger if exists push_enqueue_scholar on public.scholar_notifications;
create trigger push_enqueue_scholar after insert on public.scholar_notifications for each row execute function public._push_enqueue_scholar();

create or replace function public._push_enqueue_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.staff_id = new.user_id) then
    -- Generic text on purpose: a lock screen never shows a scholar's name or a task title. The full text is in the bell.
    insert into public.push_outbox (owner_kind, staff_id, title, body, url)
    values ('staff', new.user_id, case when new.type = 'renewal' then 'Scholar Renewal' else 'CEDO' end,
            case when new.type = 'renewal' then 'You have a new notification about a renewal case. Open the portal to read it.' else 'You have a new notification. Open the portal to read it.' end,
            case when new.type = 'renewal' then '/?page=scholarRenewal' else '/?page=notifications' end);
  end if;
  return null;
end;
$$;
drop trigger if exists push_enqueue_staff on public.notifications;
create trigger push_enqueue_staff after insert on public.notifications for each row execute function public._push_enqueue_staff();

-- ── 3. What the push-sender edge function calls (service role only) ──
-- Takes up to p_limit waiting messages (each tried at most 3 times, never older than 2 days) with the devices to send them to.
create or replace function public.push_claim(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.push_outbox%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_subs jsonb;
begin
  for o in
    select * from public.push_outbox x where x.sent_at is null and x.attempts < 3 and x.created_at > now() - interval '2 days'
    order by x.created_at limit greatest(1, least(coalesce(p_limit, 50), 200)) for update skip locked
  loop
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb) into v_subs
    from public.push_subscriptions s
    where (o.owner_kind = 'scholar' and s.scholar_id_number = o.scholar_id_number) or (o.owner_kind = 'staff' and s.staff_id = o.staff_id);
    if jsonb_array_length(v_subs) = 0 then
      update public.push_outbox set sent_at = now(), last_error = 'no devices' where id = o.id;      -- nobody to send to (devices were removed)
    else
      update public.push_outbox set attempts = attempts + 1 where id = o.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', o.id, 'title', o.title, 'body', o.body, 'url', o.url, 'subscriptions', v_subs));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

-- The result for one message: p_results = [{ "endpoint": "...", "status": 201 }, …]. Sent when at least one device accepted it (or all
-- were gone); a device the push service says no longer exists (404 / 410) is dropped; other failures are counted and retried.
create or replace function public.push_report(p_id uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_ok integer := 0;
  v_left integer;
  v_err text;
  v_status integer;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    v_status := coalesce((r ->> 'status')::integer, 0);
    if v_status between 200 and 299 then
      v_ok := v_ok + 1;
      update public.push_subscriptions set last_ok_at = now(), failures = 0 where endpoint = r ->> 'endpoint';
    elsif v_status in (404, 410) then
      delete from public.push_subscriptions where endpoint = r ->> 'endpoint';
    else
      v_err := 'status ' || v_status;
      update public.push_subscriptions set failures = failures + 1 where endpoint = r ->> 'endpoint';
      delete from public.push_subscriptions where endpoint = r ->> 'endpoint' and failures >= 5;
    end if;
  end loop;
  select count(*) into v_left from public.push_outbox o
    join public.push_subscriptions s on (o.owner_kind = 'scholar' and s.scholar_id_number = o.scholar_id_number) or (o.owner_kind = 'staff' and s.staff_id = o.staff_id)
    where o.id = p_id;
  update public.push_outbox set last_error = v_err,
    sent_at = case when v_ok > 0 or v_left = 0 then now() else null end
  where id = p_id;
end;
$$;
revoke all on function public.push_report(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.push_report(uuid, jsonb) to service_role;

-- One-time setup (run in the SQL editor after deploying the edge function and switching on pg_cron and pg_net):
--   select public.push_sender_schedule('https://<project>.supabase.co/functions/v1/push-sender', '<the PUSH_SENDER_SECRET you set>');
-- Calls the function every minute. Run it again to change the address or secret; run push_sender_unschedule() to stop.
create or replace function public.push_sender_schedule(p_url text, p_secret text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'Switch on the pg_cron and pg_net extensions first (Database > Extensions), then run this again.';
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'renewal-push-sender';
  perform cron.schedule('renewal-push-sender', '* * * * *',
    format('select net.http_post(url := %L, headers := jsonb_build_object(''x-push-secret'', %L, ''content-type'', ''application/json''), body := ''{}''::jsonb)', p_url, p_secret));
  return 'Scheduled: the push-sender function is called every minute.';
end;
$$;
revoke all on function public.push_sender_schedule(text, text) from public, anon, authenticated;

create or replace function public.push_sender_unschedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'renewal-push-sender';
  end if;
end;
$$;
revoke all on function public.push_sender_unschedule() from public, anon, authenticated;

-- ── 4. Staff notifications ──────────────────────────────────
create or replace function public._renewal_scholar_label(p_scholar_id_number text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select btrim(s.first_name || ' ' || s.last_name) from public.scholars s where s.scholar_id_number = p_scholar_id_number), p_scholar_id_number);
$$;
revoke all on function public._renewal_scholar_label(text) from public, anon, authenticated;

create or replace function public._notify_staff_member(p_user_id uuid, p_title text, p_message text, p_record_id uuid, p_about text default '')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
  values (gen_random_uuid(), 'renewal', p_user_id, coalesce(p_about, ''), p_title, p_message, now(), false, coalesce(p_record_id::text, ''));
$$;
revoke all on function public._notify_staff_member(uuid, text, text, uuid, text) from public, anon, authenticated;

create or replace function public._notify_renewal_evaluators(p_title text, p_message text, p_record_id uuid, p_about text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  for t in select distinct x.staff_id from public.staff_account_tags x where x.tag_key = 'scholar_renewal_evaluator' loop
    perform public._notify_staff_member(t.staff_id, p_title, p_message, p_record_id, p_about);
  end loop;
end;
$$;
revoke all on function public._notify_renewal_evaluators(text, text, uuid, text) from public, anon, authenticated;

-- The renewal history is the one place every step is written, so one trigger tells the evaluators what needs them.
create or replace function public._renewal_trg_history_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_name text;
  v_label text;
  v_title text;
  v_msg text;
begin
  select * into r from public.renewal_records where id = new.record_id;
  if not found then return null; end if;
  v_name := public._renewal_scholar_label(r.scholar_id_number);
  v_label := public._renewal_term_label(r.school_year, r.term);
  if new.note like 'Scholar flagged a problem%' then
    v_title := 'A scholar flagged a problem'; v_msg := v_name || ' (' || v_label || '): ' || regexp_replace(new.note, '^[^:]*: ', '');
  elsif new.note like 'Division Head sent the case back%' then
    v_title := 'The Division Head sent a case back'; v_msg := v_name || ' (' || v_label || '): ' || regexp_replace(new.note, '^[^:]*: ', '');
  elsif new.note like 'Sent to the Division Head%' then
    v_title := 'Case sent to the Division Head'; v_msg := v_name || ' (' || v_label || ') is now with the Division Head for a decision.';
  elsif new.to_stage is distinct from new.from_stage then
    case new.to_stage
      when 'late_pending' then v_title := 'Late application needs your decision'; v_msg := v_name || ' applied late for ' || v_label || '.';
      when 'ready_for_confirmation' then v_title := 'Ready for you to confirm'; v_msg := v_name || ' (' || v_label || ') is ready for your confirmation.';
      when 'ready_to_endorse' then v_title := 'Ready for you to endorse'; v_msg := v_name || ' (' || v_label || ') is ready to be endorsed to the Division Head.';
      when 'review_needed' then v_title := 'A case needs your review'; v_msg := v_name || ' (' || v_label || '): some marks cannot be read automatically.';
      when 'inc_deadline_passed' then v_title := 'INC deadline passed — decision needed'; v_msg := v_name || ' (' || v_label || ') did not complete the INC in time.';
      when 'division_head_approved' then v_title := 'The Division Head approved — please confirm'; v_msg := v_name || ' (' || v_label || '): Probationary approved. Please confirm the renewal.';
      when 'reconsidered' then v_title := 'The Division Head reconsidered — please confirm'; v_msg := v_name || ' (' || v_label || '): the case was reconsidered. Please confirm the renewal.';
      when 'removed' then v_title := 'The Division Head decided: Removed'; v_msg := v_name || ' (' || v_label || ') was removed.';
      else null;
    end case;
  end if;
  if v_title is not null then perform public._notify_renewal_evaluators(v_title, v_msg, r.id, v_name); end if;
  return null;
end;
$$;
drop trigger if exists renewal_history_notify on public.renewal_history;
create trigger renewal_history_notify after insert on public.renewal_history for each row execute function public._renewal_trg_history_notify();

-- A study plan or INC letter waiting for the evaluator's approval (the scholar cannot book a consultation until it is approved).
create or replace function public._renewal_trg_document_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  if new.kind not in ('study_plan', 'inc_letter') then return null; end if;
  select * into r from public.renewal_records where id = new.record_id;
  if not found then return null; end if;
  perform public._notify_renewal_evaluators('A document is waiting for your approval',
    public._renewal_scholar_label(r.scholar_id_number) || ' uploaded the ' || case new.kind when 'study_plan' then 'study plan' else 'INC letter' end || ' for ' || public._renewal_term_label(r.school_year, r.term) || '.',
    r.id, public._renewal_scholar_label(r.scholar_id_number));
  return null;
end;
$$;
drop trigger if exists renewal_document_notify on public.renewal_documents;
create trigger renewal_document_notify after insert on public.renewal_documents for each row execute function public._renewal_trg_document_notify();

-- The consultation staff member whose slot was booked, changed or cancelled.
create or replace function public._renewal_trg_booking_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.staff_id is null or new.action not in ('booked', 'rescheduled', 'cancelled') then return null; end if;
  v_name := public._renewal_scholar_label(new.scholar_id_number);
  perform public._notify_staff_member(new.staff_id,
    case new.action when 'booked' then 'A consultation was booked' when 'rescheduled' then 'A consultation was changed' else 'A consultation was cancelled' end,
    v_name || case new.action when 'cancelled' then ' cancelled the consultation on ' else ' — ' end || coalesce(public._manila_slot_text(new.slot_starts_at), 'a slot') || '.',
    new.record_id, v_name);
  return null;
end;
$$;
drop trigger if exists renewal_booking_notify on public.counseling_booking_history;
create trigger renewal_booking_notify after insert on public.counseling_booking_history for each row execute function public._renewal_trg_booking_notify();

-- ── 5. More reminders (the scheduler) ───────────────────────
-- p_now is only there so tests can pick the time; the real job always uses now(). Reminders are sent between 8:00 and 18:00 Philippine time.
create or replace function public.renewal_notification_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Manila')::date;
  v_hour integer := extract(hour from (p_now at time zone 'Asia/Manila'))::integer;
  i record;
  w record;
  s record;
  v_left integer;
  v_inc integer := 0;
  v_win integer := 0;
  v_open integer := 0;
  v_kind text;
begin
  -- tidy up: delivered pushes older than a week
  delete from public.push_outbox where created_at < p_now - interval '7 days';
  if v_hour < 8 or v_hour >= 18 then return jsonb_build_object('inc_reminders', 0, 'window_alerts', 0, 'window_open_alerts', 0, 'skipped', 'outside 8:00-18:00'); end if;

  -- INC deadline: 7 days and 2 days before
  for i in
    select it.id, it.record_id, it.scholar_id_number, it.subject, it.deadline from public.renewal_inc_items it
    join public.renewal_records rr on rr.id = it.record_id
    where it.state = 'open' and it.deadline is not null and rr.stage not in ('renewed', 'removed', 'returned', 'late_declined', 'not_required')
      and (it.deadline - v_today) in (7, 2)
  loop
    v_left := i.deadline - v_today;
    v_kind := 'inc_' || v_left;
    insert into public.renewal_notice_log (kind, scholar_id_number, ref) values (v_kind, i.scholar_id_number, i.id::text || ':' || i.deadline::text) on conflict do nothing;
    if found then
      perform public._notify_scholar(i.scholar_id_number, 'inc_reminder', 'Your INC deadline is in ' || v_left || ' days',
        'Complete your INC in ' || i.subject || ' by ' || to_char(i.deadline, 'FMMonth FMDD, YYYY') || ': ' || v_left || ' days left.', i.record_id);
      v_inc := v_inc + 1;
    end if;
  end loop;

  -- A window opened (today or yesterday; a window that has been open longer is not announced late): every scholar who can renew is told once
  for w in select * from public.renewal_windows x where x.opens_on <= v_today and x.opens_on >= v_today - 1 and x.closes_on >= v_today loop
    for s in
      select sc.scholar_id_number from public.scholars sc
      where sc.status not in ('Removed', 'On leave')
        and not exists (select 1 from public.renewal_records rr where rr.scholar_id_number = sc.scholar_id_number and rr.school_year = w.school_year and rr.term = w.term)
    loop
      insert into public.renewal_notice_log (kind, scholar_id_number, ref) values ('window_open', s.scholar_id_number, w.id::text) on conflict do nothing;
      if found then
        perform public._notify_scholar(s.scholar_id_number, 'window_open', 'Renewal for ' || public._renewal_term_label(w.school_year, w.term) || ' is now open',
          'You can apply from your Renewal tile until ' || to_char(w.closes_on, 'FMMonth FMDD, YYYY') || '.', null);
        v_open := v_open + 1;
      end if;
    end loop;
  end loop;

  -- The window closes in 3 days / 1 day: scholars who have not applied, or whose application was returned
  for w in select * from public.renewal_windows x where x.opens_on <= v_today and x.closes_on >= v_today and (x.closes_on - v_today) in (3, 1) loop
    v_left := w.closes_on - v_today;
    for s in
      select sc.scholar_id_number, rr.id as record_id from public.scholars sc
      left join public.renewal_records rr on rr.scholar_id_number = sc.scholar_id_number and rr.school_year = w.school_year and rr.term = w.term
      where sc.status not in ('Removed', 'On leave') and (rr.id is null or rr.stage = 'returned')
    loop
      insert into public.renewal_notice_log (kind, scholar_id_number, ref) values ('window_' || v_left, s.scholar_id_number, w.id::text) on conflict do nothing;
      if found then
        perform public._notify_scholar(s.scholar_id_number, 'window_closing',
          case when s.record_id is null then 'Renewal closes in ' || v_left || case when v_left = 1 then ' day' else ' days' end else 'Please submit your renewal again — it closes in ' || v_left || case when v_left = 1 then ' day' else ' days' end end,
          case when s.record_id is null then 'Renewal for ' || public._renewal_term_label(w.school_year, w.term) || ' closes on ' || to_char(w.closes_on, 'FMMonth FMDD, YYYY') || '. Apply from your Renewal tile.'
               else 'Your application for ' || public._renewal_term_label(w.school_year, w.term) || ' was returned. Fix it and submit again before ' || to_char(w.closes_on, 'FMMonth FMDD, YYYY') || '.' end,
          s.record_id);
        v_win := v_win + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('inc_reminders', v_inc, 'window_alerts', v_win, 'window_open_alerts', v_open);
end;
$$;
revoke all on function public.renewal_notification_jobs(timestamptz) from public, anon, authenticated;

-- Everything the scheduler does, in one call: the Phase 3 reminders and deadline check, then the Phase 6 reminders.
create or replace function public.renewal_run_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.renewal_scheduled_jobs() || public.renewal_notification_jobs();
end;
$$;
revoke all on function public.renewal_run_scheduled_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'renewal-scheduled-jobs';
    perform cron.schedule('renewal-scheduled-jobs', '*/5 * * * *', 'select public.renewal_run_scheduled_jobs()');
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.push_subscriptions) as devices_subscribed,
       (select count(*) from public.push_outbox where sent_at is null) as pushes_waiting,
       (select exists (select 1 from pg_extension where extname = 'pg_net')) as pg_net_switched_on;
