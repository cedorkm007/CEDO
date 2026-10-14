-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p8b_test_windows.sql
--
-- Scholar Renewal System, Phase 8b: a "TESTERS ONLY" renewal window, so the whole system can be tried on the real project with a few
-- test accounts while every other scholar sees and receives nothing. Run AFTER supabase_migration_renewal_p8_csr.sql. Additive and safe to run twice.
--
--   1. renewal_windows.testers: empty = a normal window for everyone. A list of scholar IDs = ONLY those scholars can see the window on their
--      Renewal tile, get its alerts ("Renewal is now open", "closes in 3 days"), apply, or be counted in the lists, the dashboard and the Excel file.
--      The table's reading rule is tightened the same way, so a scholar cannot read a testers-only window even by asking the database directly.
--   2. renewal_window_save() takes the list (p_testers). On a new window: empty = everyone. On an edit: nothing sent = leave the list as it is;
--      an EMPTY list ('{}') = open the window to everyone.
--   3. renewal_window_clear_test_data(): after the test, removes the testers' renewals of that window (and their consultation bookings, referrals,
--      notices and certificate records) so the same term can then be opened for everybody with clean numbers.
--   4. Five older functions get ONE extra condition each (their full text is repeated below): renewal_my_overview (Phase 3), renewal_not_applied (2),
--      renewal_notification_jobs (6), renewal_dashboard and renewal_export_data (7).
-- NEVER run the Phase 2, 3, 6 or 7 file again AFTER this one (they would put the old versions back); run p2 > p8b in order if you ever do.
-- ─────────────────────────────────────────────────────────────

-- ── 1. The list, the reading rule, the helper and the guard ──
alter table public.renewal_windows add column if not exists testers text[];

create or replace function public._renewal_window_includes(p_school_year text, p_term text, p_scholar text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select w.testers is null or p_scholar = any (w.testers) from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term), true);
$$;
revoke all on function public._renewal_window_includes(text, text, text) from public, anon, authenticated;

drop policy if exists "signed in users read renewal windows" on public.renewal_windows;
drop policy if exists "windows are read by who they are for" on public.renewal_windows;
create policy "windows are read by who they are for" on public.renewal_windows for select
  using (auth.uid() is not null and (testers is null or public.can_view_renewal_reports() or coalesce(public.current_scholar_id_number() = any (testers), false)));

-- A scholar who is not on the list cannot be given a renewal in a testers-only window, whatever screen or call tries it.
create or replace function public._renewal_trg_testers_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.window_id is not null and exists (select 1 from public.renewal_windows w where w.id = new.window_id and w.testers is not null and not (new.scholar_id_number = any (w.testers))) then
    raise exception 'This renewal window is not open for you.';
  end if;
  return new;
end;
$$;
revoke all on function public._renewal_trg_testers_only() from public, anon, authenticated;
drop trigger if exists renewal_testers_only on public.renewal_records;
create trigger renewal_testers_only before insert on public.renewal_records for each row execute function public._renewal_trg_testers_only();

-- ── 2. Saving a window, with the list ──
drop function if exists public.renewal_window_save(uuid, text, text, date, date, boolean, text);
create or replace function public.renewal_window_save(p_id uuid, p_school_year text, p_term text, p_opens_on date, p_closes_on date, p_late_allowed boolean, p_note text default '', p_testers text[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_list text[];
  v_missing text[];
begin
  perform public._renewal_require_evaluator();
  if p_school_year !~ '^\d{4}-\d{4}$' then raise exception 'The school year must look like 2026-2027.'; end if;
  if p_term not in ('1st Semester', '2nd Semester', 'Summer') then raise exception 'Choose 1st Semester, 2nd Semester or Summer.'; end if;
  if p_opens_on is null or p_closes_on is null or p_closes_on < p_opens_on then raise exception 'The closing date cannot be before the opening date.'; end if;
  -- the list: trimmed, no repeats; empty means "everyone"; every ID must be a real scholar
  if p_testers is not null then
    select array_agg(distinct btrim(t)) into v_list from unnest(p_testers) t where btrim(t) <> '';
    if v_list is not null then
      if cardinality(v_list) > 100 then raise exception 'A testers-only window can list at most 100 scholars.'; end if;
      select coalesce(array_agg(t order by t), '{}') into v_missing from unnest(v_list) t where not exists (select 1 from public.scholars s where s.scholar_id_number = t);
      if cardinality(v_missing) > 0 then raise exception 'These scholar IDs were not found: %.', array_to_string(v_missing, ', '); end if;
    end if;
  end if;
  if p_id is null then
    if exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term) then
      raise exception 'There is already a renewal window for % — edit that one instead.', public._renewal_term_label(p_school_year, p_term);
    end if;
    insert into public.renewal_windows (school_year, term, opens_on, closes_on, late_allowed, note, created_by, testers)
    values (p_school_year, p_term, p_opens_on, p_closes_on, coalesce(p_late_allowed, true), left(btrim(coalesce(p_note, '')), 500), auth.uid(), v_list)
    returning id into v_id;
  else
    update public.renewal_windows set opens_on = p_opens_on, closes_on = p_closes_on, late_allowed = coalesce(p_late_allowed, true),
      note = left(btrim(coalesce(p_note, '')), 500), updated_at = now(),
      testers = case when p_testers is null then testers else v_list end
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That renewal window was not found.'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) to authenticated;

-- ── 3. The five older functions, each with ONE extra condition ──
-- (copies of the Phase 2 / 3 / 6 / 7 versions; the added line is the one that mentions renewal_windows.testers or _renewal_window_includes)

create or replace function public.renewal_not_applied(p_school_year text, p_term text)
returns table(scholar_id_number text, name text, school text, program text, year_level text, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status
  from public.scholars s
  where s.status not in ('Removed', 'On leave')
    and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term)
  order by s.last_name, s.first_name;
end;
$$;
revoke all on function public.renewal_not_applied(text, text) from public, anon;
grant execute on function public.renewal_not_applied(text, text) to authenticated;

create or replace function public.renewal_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_out jsonb := '[]'::jsonb;
  w record;
  v_rec public.renewal_records%rowtype;
  v_state text;
  v_slot public.counseling_slots%rowtype;
  v_booking jsonb;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  for w in
    select * from public.renewal_windows
    where (opens_on <= v_today + 14 or exists (select 1 from public.renewal_records r where r.window_id = renewal_windows.id and r.scholar_id_number = v_id))
      and (renewal_windows.testers is null or v_id = any (renewal_windows.testers))
    order by opens_on desc limit 6
  loop
    select * into v_rec from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term;
    v_state := case when v_today < w.opens_on then 'upcoming' when v_today <= w.closes_on then 'open'
                    when w.late_allowed then 'late' else 'closed' end;
    v_booking := null;
    if v_rec.id is not null then
      select * into v_slot from public.counseling_slots x where x.record_id = v_rec.id and x.state = 'booked';
      if found then
        v_booking := jsonb_build_object('slot_id', v_slot.id, 'starts_at', v_slot.starts_at, 'ends_at', v_slot.ends_at, 'staff_name', public._staff_display_name(v_slot.staff_id),
          'can_change', v_slot.starts_at >= now() + interval '12 hours');
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'window', to_jsonb(w), 'state', v_state,
      'record', case when v_rec.id is null then null else to_jsonb(v_rec) end,
      'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
      'inc_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.subject) from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
      'booking', v_booking,
      'consult_needed', v_rec.id is not null and public._renewal_consult_eligible(v_rec.id),
      'consult_state', case when v_rec.id is null then null else public._renewal_consult_state(v_rec.id) end));
  end loop;
  return jsonb_build_object(
    'scholar', jsonb_build_object('scholar_id_number', v_scholar.scholar_id_number, 'school', v_scholar.school, 'program', v_scholar.course, 'year_level', v_scholar.year_level, 'status', v_scholar.status),
    'windows', v_out);
end;
$$;
revoke all on function public.renewal_my_overview() from public, anon;
grant execute on function public.renewal_my_overview() to authenticated;

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
      where sc.status not in ('Removed', 'On leave') and public._renewal_window_includes(w.school_year, w.term, sc.scholar_id_number)
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
      where sc.status not in ('Removed', 'On leave') and public._renewal_window_includes(w.school_year, w.term, sc.scholar_id_number) and (rr.id is null or rr.stage = 'returned')
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

create or replace function public.renewal_dashboard(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_win public.renewal_windows%rowtype;
  v_res jsonb;
begin
  if not public.can_view_renewal_reports() then raise exception 'Not authorized to view renewal reports.'; end if;
  select * into v_win from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term;

  with rec as (
    select r.*, s.school as school_name, s.status as scholar_status
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.school_year = p_school_year and r.term = p_term
  ),
  eligible as (
    select s.scholar_id_number, s.school as school_name
    from public.scholars s
    where s.status not in ('Removed', 'On leave')
      and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
      and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term)
  ),
  by_school as (
    select coalesce(x.school_name, '(no school)') as school,
           sum(x.applied) as applied, sum(x.renewed) as renewed, sum(x.removed) as removed, sum(x.pending) as pending, sum(x.not_applied) as not_applied
    from (
      select r.school_name, 1 as applied, (r.stage = 'renewed')::int as renewed, (r.stage = 'removed')::int as removed,
             (r.stage not in ('renewed', 'removed', 'late_declined', 'not_required'))::int as pending, 0 as not_applied
      from rec r where r.stage <> 'not_required'
      union all
      select e.school_name, 0, 0, 0, 0, 1 from eligible e
    ) x group by coalesce(x.school_name, '(no school)')
  )
  select jsonb_build_object(
    'school_year', p_school_year, 'term', p_term, 'term_label', public._renewal_term_label(p_school_year, p_term),
    'window', case when v_win.id is null then null else jsonb_build_object('opens_on', v_win.opens_on, 'closes_on', v_win.closes_on, 'late_allowed', v_win.late_allowed,
        'days_left', greatest(v_win.closes_on - v_today, 0), 'is_open', v_today between v_win.opens_on and v_win.closes_on) end,
    'generated_at', now(),
    'filter_options', jsonb_build_object(
      'schools', coalesce((select jsonb_agg(distinct x.school_name order by x.school_name) from (select school_name from rec union all select school_name from eligible) x where x.school_name is not null), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(distinct y order by y) from (select coalesce(r.confirmed_year_level, s.year_level) as y from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number where r.school_year = p_school_year and r.term = p_term
          union all select s.year_level from public.scholars s where s.status not in ('Removed', 'On leave')) q where y is not null and y <> ''), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(distinct p order by p) from (select coalesce(r.confirmed_program, s.course) as p from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number where r.school_year = p_school_year and r.term = p_term
          union all select s.course from public.scholars s where s.status not in ('Removed', 'On leave')) q where p is not null and p <> ''), '[]'::jsonb)),
    'totals', jsonb_build_object(
      'can_renew', (select count(*) from rec where stage <> 'not_required') + (select count(*) from eligible),
      'applied', (select count(*) from rec where stage <> 'not_required'),
      'not_applied', (select count(*) from eligible),
      'not_required', (select count(*) from rec where stage = 'not_required'),
      'late', (select count(*) from rec where is_late),
      'late_waiting', (select count(*) from rec where stage = 'late_pending'),
      'late_declined', (select count(*) from rec where stage = 'late_declined'),
      'renewed', (select count(*) from rec where stage = 'renewed'),
      'renewed_regular', (select count(*) from rec where stage = 'renewed' and result = 'renewed'),
      'renewed_probationary', (select count(*) from rec where stage = 'renewed' and result = 'renewed_probationary'),
      'renewed_reconsidered', (select count(*) from rec where stage = 'renewed' and result = 'reconsidered'),
      'removed', (select count(*) from rec where stage = 'removed'),
      'returned', (select count(*) from rec where stage = 'returned'),
      'avg_days_to_renew', (select round(avg(extract(epoch from (confirmed_at - applied_at)) / 86400.0)::numeric, 1) from rec where stage = 'renewed' and confirmed_at is not null and applied_at is not null)),
    'by_stage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from rec group by stage) q), '{}'::jsonb),
    'by_rule', coalesce((select jsonb_object_agg(rule_code, n) from (select rule_code, count(*) as n from rec where rule_code is not null and stage <> 'not_required' group by rule_code) q), '{}'::jsonb),
    'by_school', coalesce((select jsonb_agg(jsonb_build_object('school', school, 'applied', applied, 'renewed', renewed, 'removed', removed, 'pending', pending, 'not_applied', not_applied) order by school) from by_school), '[]'::jsonb),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'applied', a, 'renewed', n) order by d) from (
        select coalesce(x.d, y.d) as d, coalesce(x.a, 0) as a, coalesce(y.n, 0) as n from
          (select (applied_at at time zone 'Asia/Manila')::date as d, count(*) as a from rec where applied_at is not null group by 1) x
          full join (select (confirmed_at at time zone 'Asia/Manila')::date as d, count(*) as n from rec where stage = 'renewed' and confirmed_at is not null group by 1) y on y.d = x.d) q), '[]'::jsonb),
    'sdp_and_grades', jsonb_build_object(
      'sdp_on_hold', (select count(*) from rec where stage = 'sdp_on_hold'),
      'waiting_grades', (select count(*) from rec where stage = 'waiting_grades'),
      'review_needed', (select count(*) from rec where stage = 'review_needed'),
      'with_failed', (select count(*) from rec where coalesce((evaluation ->> 'failed_effective')::int, 0) > 0 and stage <> 'not_required'),
      'with_inc', (select count(*) from rec where coalesce((evaluation ->> 'open_inc')::int, 0) > 0 and stage <> 'not_required')),
    'inc', jsonb_build_object(
      'open', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open'),
      'no_deadline', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline is null),
      'due_in_7_days', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline between v_today and v_today + 7),
      'overdue', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'open' and i.deadline < v_today),
      'resolved_passed', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state = 'resolved_passed'),
      'failed_or_counted', (select count(*) from public.renewal_inc_items i join rec on rec.id = i.record_id where i.state in ('resolved_failed', 'counted_failed'))),
    'consultations', jsonb_build_object(
      'required', (select count(*) from rec where consultation_required and stage not in ('not_required', 'late_declined')),
      'done', (select count(*) from rec where consultation_done_at is not null),
      'booked_upcoming', (select count(*) from public.counseling_slots x join rec on rec.id = x.record_id where x.state = 'booked' and x.starts_at > now()),
      'attended', (select count(*) from public.counseling_slots x join rec on rec.id = x.record_id where x.state = 'attended'),
      'no_shows', (select coalesce(sum(no_show_count), 0) from rec),
      'need_booking', (select count(*) from rec where consultation_required and consultation_done_at is null and stage not in ('not_required', 'late_declined', 'returned', 'renewed', 'removed')
          and not exists (select 1 from public.counseling_slots x where x.record_id = rec.id and x.state = 'booked'))),
    'documents', jsonb_build_object(
      'waiting_review', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'submitted' and d.kind in ('study_plan', 'inc_letter')),
      'approved', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'accepted'),
      'returned', (select count(*) from public.renewal_documents d join rec on rec.id = d.record_id where d.status = 'returned')),
    'division_head', jsonb_build_object(
      'waiting', (select count(*) from rec where stage in ('endorsed_division_head', 'needs_consultation_division_head')
          and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = rec.id and f.status = 'forwarded_to_division_head')),
      'sent_back', (select count(*) from public.scholar_counseling_referrals f join rec on rec.id = f.renewal_record_id where f.status = 'reconsideration_requested'),
      'approved_probationary', (select count(*) from rec where division_head_decision = 'approved_probationary'),
      'reconsidered', (select count(*) from rec where division_head_decision = 'reconsidered'),
      'removed', (select count(*) from rec where division_head_decision = 'removed'))
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.renewal_dashboard(text, text) from public, anon;
grant execute on function public.renewal_dashboard(text, text) to authenticated;

create or replace function public.renewal_export_data(p_school_year text, p_term text, p_schools text[] default null, p_year_levels text[] default null, p_programs text[] default null, p_stages text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apps jsonb;
  v_not jsonb;
  v_inc jsonb;
  v_cons jsonb;
  v_n integer;
  v_filter text;
begin
  if not public.can_view_renewal_reports() then raise exception 'Not authorized to export renewal reports.'; end if;
  p_schools := nullif(p_schools, '{}'); p_year_levels := nullif(p_year_levels, '{}'); p_programs := nullif(p_programs, '{}'); p_stages := nullif(p_stages, '{}');
  v_filter := concat_ws(' · ', case when p_schools is not null then 'School: ' || array_to_string(p_schools, ', ') end,
    case when p_year_levels is not null then 'Year level: ' || array_to_string(p_year_levels, ', ') end,
    case when p_programs is not null then 'Program: ' || array_to_string(p_programs, ', ') end,
    case when p_stages is not null then 'Status: ' || array_to_string(p_stages, ', ') end);

  select coalesce(jsonb_agg(jsonb_build_object(
      'scholar_id_number', s.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
      'school', s.school, 'program', coalesce(r.confirmed_program, s.course), 'year_level', coalesce(r.confirmed_year_level, s.year_level), 'scholar_status', s.status,
      'stage', r.stage, 'rule_code', r.rule_code, 'basis', public._renewal_term_label(r.basis_school_year, r.basis_term),
      'failed_count', coalesce((r.evaluation ->> 'failed_effective')::int, 0), 'inc_open', coalesce((r.evaluation ->> 'open_inc')::int, 0),
      'previous_probation', coalesce((r.evaluation ->> 'previous_probation')::boolean, false),
      'sdp_applicable', coalesce((r.evaluation -> 'sdp' ->> 'applicable')::boolean, false), 'sdp_complied', (r.evaluation -> 'sdp' ->> 'complied')::boolean, 'sdp_missing', r.evaluation -> 'sdp' ->> 'missing',
      'study_plan', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'study_plan' order by d.uploaded_at desc limit 1),
      'inc_letter', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'inc_letter' order by d.uploaded_at desc limit 1),
      'prospectus', (select d.status from public.renewal_documents d where d.record_id = r.id and d.kind = 'prospectus' order by d.uploaded_at desc limit 1),
      'consultation_required', r.consultation_required, 'consultation_done_at', r.consultation_done_at,
      'next_consultation', (select x.starts_at from public.counseling_slots x where x.record_id = r.id and x.state = 'booked' and x.starts_at > now() order by x.starts_at limit 1),
      'no_shows', r.no_show_count, 'late', r.is_late, 'late_decision', r.late_decision, 'division_head_decision', r.division_head_decision,
      'division_head_decided_at', r.division_head_decided_at, 'result', r.result, 'applied_at', r.applied_at, 'confirmed_at', r.confirmed_at,
      'evaluator_note', r.evaluator_comment, 'scholar_note', r.scholar_note, 'not_required_reason', r.not_required_reason)
    order by s.last_name, s.first_name), '[]'::jsonb)
  into v_apps
  from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term
    and (p_schools is null or s.school = any (p_schools)) and (p_year_levels is null or coalesce(r.confirmed_year_level, s.year_level) = any (p_year_levels))
    and (p_programs is null or coalesce(r.confirmed_program, s.course) = any (p_programs)) and (p_stages is null or r.stage = any (p_stages));

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', s.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
      'school', s.school, 'program', s.course, 'year_level', s.year_level, 'scholar_status', s.status) order by s.last_name, s.first_name), '[]'::jsonb)
  into v_not
  from public.scholars s
  where s.status not in ('Removed', 'On leave')
    and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (p_schools is null or s.school = any (p_schools)) and (p_year_levels is null or s.year_level = any (p_year_levels)) and (p_programs is null or s.course = any (p_programs))
    and (p_stages is null or 'not_applied' = any (p_stages))
    and not exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term);

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', i.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name), 'school', s.school,
      'subject_code', i.subject_code, 'subject', i.subject, 'state', i.state, 'consultation_date', i.consultation_date, 'days_given', i.days_given, 'deadline', i.deadline,
      'days_left', case when i.state = 'open' and i.deadline is not null then i.deadline - (now() at time zone 'Asia/Manila')::date end,
      'decision', i.decision, 'decision_reason', i.decision_reason) order by i.deadline nulls last, s.last_name), '[]'::jsonb)
  into v_inc
  from public.renewal_inc_items i join public.renewal_records r on r.id = i.record_id join public.scholars s on s.scholar_id_number = i.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term
    and (p_schools is null or s.school = any (p_schools)) and (p_year_levels is null or coalesce(r.confirmed_year_level, s.year_level) = any (p_year_levels))
    and (p_programs is null or coalesce(r.confirmed_program, s.course) = any (p_programs)) and (p_stages is null or r.stage = any (p_stages));

  select coalesce(jsonb_agg(jsonb_build_object('scholar_id_number', x.scholar_id_number, 'name', btrim(s.last_name || ', ' || s.first_name), 'starts_at', x.starts_at, 'state', x.state,
      'staff', public._staff_display_name(x.staff_id)) order by x.starts_at), '[]'::jsonb)
  into v_cons
  from public.counseling_slots x join public.renewal_records r on r.id = x.record_id join public.scholars s on s.scholar_id_number = x.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term and x.state in ('booked', 'attended', 'no_show')
    and (p_schools is null or s.school = any (p_schools)) and (p_year_levels is null or coalesce(r.confirmed_year_level, s.year_level) = any (p_year_levels))
    and (p_programs is null or coalesce(r.confirmed_program, s.course) = any (p_programs)) and (p_stages is null or r.stage = any (p_stages));

  v_n := jsonb_array_length(v_apps) + jsonb_array_length(v_not);
  insert into public.renewal_export_log (exported_by, by_label, school_year, term, row_count, filter_text)
  values ((select u.id from public.users u where u.id = auth.uid()), public._actor_name(), p_school_year, p_term, v_n, coalesce(v_filter, ''));

  return jsonb_build_object('applications', v_apps, 'not_applied', v_not, 'inc', v_inc, 'consultations', v_cons, 'exported_at', now(), 'filter', coalesce(v_filter, ''));
end;
$$;
revoke all on function public.renewal_export_data(text, text, text[], text[], text[], text[]) from public, anon;
grant execute on function public.renewal_export_data(text, text, text[], text[], text[], text[]) to authenticated;

-- ── 4. After the test: clear the testers' test data ──
-- Only for a testers-only window. Removes, for the listed scholars and that term only: their renewal records (with history, documents, INC items), the
-- renewal referrals, their notices about it, the "already told" marks (so alerts can be tried again), certificate records and booked-but-not-held
-- consultation slots (they become open again). It does NOT undo a scholar's status (for example Probationary or Removed): set those by hand in the
-- Scholars tool. Files already uploaded stay in the private folders (renewal-documents, csr-issued) until deleted in the Supabase dashboard; the
-- answer lists how many database rows of each kind were removed and which files are left.
create or replace function public.renewal_window_clear_test_data(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.renewal_windows%rowtype;
  v_ids uuid[];
  v_records integer;
  v_slots integer := 0;
  v_refs integer := 0;
  v_csr integer := 0;
  v_files jsonb;
begin
  perform public._renewal_require_evaluator();
  select * into w from public.renewal_windows where id = p_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if w.testers is null then raise exception 'Only a testers-only window can be cleared. This window is open to everyone.'; end if;
  select coalesce(array_agg(r.id), '{}') into v_ids from public.renewal_records r where r.school_year = w.school_year and r.term = w.term and r.scholar_id_number = any (w.testers);
  v_records := cardinality(v_ids);
  v_files := coalesce((select jsonb_agg(f) from (
      select 'renewal-documents/' || d.storage_path as f from public.renewal_documents d where d.record_id = any (v_ids)
      union all select 'csr-issued/' || c.storage_path from public.csr_issued c where c.record_id = any (v_ids) and c.storage_path is not null) x), '[]'::jsonb);
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null where record_id = any (v_ids) and state = 'booked';
  get diagnostics v_slots = row_count;
  delete from public.scholar_counseling_referrals where renewal_record_id = any (v_ids);
  get diagnostics v_refs = row_count;
  delete from public.csr_issued where record_id = any (v_ids);
  get diagnostics v_csr = row_count;
  delete from public.scholar_notifications where record_id = any (v_ids);
  delete from public.scholar_notifications where scholar_id_number = any (w.testers) and kind in ('window_open', 'window_closing') and created_at >= w.created_at;
  delete from public.renewal_notice_log n where n.scholar_id_number = any (w.testers) and (n.ref = w.id::text or n.ref = any (select x::text from unnest(v_ids) x));
  delete from public.renewal_records where id = any (v_ids);
  return jsonb_build_object('records', v_records, 'slots_released', v_slots, 'referrals', v_refs, 'certificates', v_csr, 'files_left', v_files);
end;
$$;
revoke all on function public.renewal_window_clear_test_data(uuid) from public, anon;
grant execute on function public.renewal_window_clear_test_data(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.renewal_windows where testers is not null) as testers_only_windows, (select count(*) from public.renewal_windows) as windows;
