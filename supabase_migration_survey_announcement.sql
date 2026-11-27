-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_announcement.sql
-- ANNOUNCE A SURVEY TO ALL SCHOLARS.   Safe to run twice.   Undo: undo_survey_announcement.sql
--
--   * Research staff press "Announce" on an ACTIVE survey. Every scholar who is not Removed and has not yet answered or declined
--     it gets a bell notification (and a phone notification, if they turned those on) and can answer it from their portal home page,
--     even without attending the activity.
--   * Once every 10 minutes per survey.
--   * Nothing about attendance or credit changes. Announcing sends nothing until a person presses the button.
-- Needs the "delete a response" survey file and the renewal notification files.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.survey_delete_response(uuid,text,uuid,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_survey_delete_response.sql first.';
  end if;
  if to_regclass('public.scholar_notifications') is null or to_regprocedure('public._push_enqueue_scholar()') is null then
    raise exception 'STOPPED, nothing changed: the renewal notification file (supabase_migration_renewal_p6_notifications.sql) is not installed.';
  end if;
end $$;

-- ── 1. A scholar may now be asked "by announcement" ──────────
alter table public.research_survey_asks drop constraint if exists research_survey_asks_activity_type_check;
alter table public.research_survey_asks add constraint research_survey_asks_activity_type_check check (activity_type in ('sdp', 'formation', 'reconsideration', 'announcement'));
alter table public.research_survey_asks drop constraint if exists research_survey_asks_ask_trigger_check;
alter table public.research_survey_asks add constraint research_survey_asks_ask_trigger_check check (ask_trigger in ('manual', 'picture', 'reconsideration', 'announcement'));

-- who announced what, and when (also what the 10 minutes are counted from)
create table if not exists public.research_survey_announcements (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  announced_at timestamptz not null default now(),
  announced_by uuid,
  announced_by_name text,
  notified_count integer not null default 0
);
create index if not exists research_survey_announcements_survey on public.research_survey_announcements (survey_id, announced_at desc);
alter table public.research_survey_announcements enable row level security;
revoke all on table public.research_survey_announcements from anon, authenticated;      -- only through the functions below

-- ── 2. Announcing ────────────────────────────────────────────
-- Who would be told: every scholar not Removed who has not answered or declined this survey (a deleted response counts as answered).
create or replace function public._survey_announce_targets(p_survey_id uuid)
returns table(scholar_id_number text) language sql stable security definer set search_path = public as $$
  select s.scholar_id_number from public.scholars s
  where s.scholar_id_number is not null and coalesce(s.status, '') <> 'Removed'
    and not exists (select 1 from public.research_survey_responses r
                    where r.survey_id = p_survey_id and r.scholar_id_number = s.scholar_id_number and r.status in ('completed', 'declined'));
$$;
revoke all on function public._survey_announce_targets(uuid) from public, anon, authenticated;

create or replace function public.survey_announcement_status(p_survey_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.research_survey_announcements%rowtype;
begin
  perform public._survey_require_staff(p_survey_id);
  select * into v from public.research_survey_announcements a where a.survey_id = p_survey_id order by a.announced_at desc limit 1;
  return jsonb_build_object(
    'toNotify', (select count(*) from public._survey_announce_targets(p_survey_id)),
    'lastAt', v.announced_at, 'lastBy', v.announced_by_name, 'lastCount', v.notified_count,
    'secondsLeft', case when v.id is null then 0 else greatest(0, ceil(extract(epoch from (v.announced_at + interval '10 minutes' - now())))::integer) end);
end; $$;
revoke all on function public.survey_announcement_status(uuid) from public, anon;
grant execute on function public.survey_announcement_status(uuid) to authenticated;

-- The surveys that cannot be announced again yet: {survey id: seconds left}
create or replace function public.survey_announcement_waits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  return (
    select coalesce(jsonb_object_agg(x.survey_id, ceil(extract(epoch from (x.last + interval '10 minutes' - now())))::integer), '{}'::jsonb)
    from (select a.survey_id, max(a.announced_at) as last from public.research_survey_announcements a group by a.survey_id) x
    where x.last + interval '10 minutes' > now()
  );
end; $$;
revoke all on function public.survey_announcement_waits() from public, anon;
grant execute on function public.survey_announcement_waits() to authenticated;

create or replace function public.survey_announce(p_survey_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v public.research_surveys%rowtype; v_last timestamptz; v_count integer;
begin
  perform public._survey_require_staff(p_survey_id);
  -- two people pressing at once: the second waits here, then sees the first announcement
  select * into v from public.research_surveys s where s.id = p_survey_id for no key update;
  if not v.is_active then raise exception 'Activate the survey first, then announce it.'; end if;
  if not exists (select 1 from public.research_survey_questions q where q.survey_id = p_survey_id and q.removed_at is null) then
    raise exception 'Add at least one question first.';
  end if;
  select max(a.announced_at) into v_last from public.research_survey_announcements a where a.survey_id = p_survey_id;
  if v_last > now() - interval '10 minutes' then
    raise exception 'This survey was just announced. You can announce it again in % minute(s).', ceil(extract(epoch from (v_last + interval '10 minutes' - now())) / 60);
  end if;

  with asked as (
    insert into public.research_survey_asks (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
    select p_survey_id, t.scholar_id_number, 'announcement', p_survey_id, 'Announcement', 'announcement' from public._survey_announce_targets(p_survey_id) t
    on conflict (survey_id, scholar_id_number, activity_id) do update set closed_at = null
    returning scholar_id_number
  )
  insert into public.scholar_notifications (scholar_id_number, kind, title, body)
  select a.scholar_id_number, 'survey', 'Please answer our survey', format('Please answer the survey "%s". Open your CEDO portal home page and press Answer.', v.title) from asked a;
  get diagnostics v_count = row_count;

  if v_count = 0 then raise exception 'Every scholar has already responded to this survey, so there is nobody to notify.'; end if;
  insert into public.research_survey_announcements (survey_id, announced_by, announced_by_name, notified_count)
  values (p_survey_id, auth.uid(), public._survey_actor_name(), v_count);
  return v_count;
end; $$;
revoke all on function public.survey_announce(uuid) from public, anon;
grant execute on function public.survey_announce(uuid) to authenticated;

-- A phone notification about a survey opens the portal home page (others still open the renewal page).
create or replace function public._push_enqueue_scholar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.scholar_id_number = new.scholar_id_number) then
    insert into public.push_outbox (owner_kind, scholar_id_number, title, body, url)
    values ('scholar', new.scholar_id_number, new.title, new.body,
            case when new.kind = 'survey' then '/CEDO/portal' else '/CEDO/portal?formsTab=services&service=renewal&panel=services' end);
  end if;
  return null;
end; $$;

-- ── 3. The scholar's banner: an activity waiting for the same survey comes before the announcement ──
create or replace function public.my_pending_surveys()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_sid text;
begin
  select scholar_id_number into v_sid from public.scholars where id = auth.uid();
  if v_sid is null then raise exception 'Only signed-in scholars have surveys.'; end if;
  return (
    with held as (
      select r.pending_survey_id as survey_id, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id,
             coalesce((select n.name from public.sdp_activities n where n.id = x.sdp_activity_id), (select f.name from public.formation_activities f where f.id = x.formation_activity_id), 'the activity') as activity_name,
             coalesce(r.held_trigger, 'qr') as ask_trigger, true as holds, false as recon, coalesce(r.held_at, r.updated_at) as made_at, false as announced
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_sid and r.status = 'pending_survey' and r.pending_survey_id is not null
    ),
    asked as (
      select k.survey_id, k.activity_id, k.activity_name, k.ask_trigger, false as holds, k.activity_type = 'reconsideration' as recon, k.created_at as made_at, k.activity_type = 'announcement' as announced
      from public.research_survey_asks k join public.research_surveys s on s.id = k.survey_id and s.is_active
      where k.scholar_id_number = v_sid and k.closed_at is null
        and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = v_sid and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
        and (k.activity_type = 'reconsideration' or not public._survey_responded(k.survey_id, v_sid))
        and not exists (select 1 from held h where h.survey_id = k.survey_id and h.activity_id = k.activity_id)
    ),
    everything as (select * from held union all select * from asked),
    lines as (
      -- every activity waiting for the same survey is one thing to answer
      select e.survey_id, (array_agg(e.activity_id order by e.announced, e.holds desc, e.made_at desc))[1] as activity_id,
             coalesce(string_agg(distinct e.activity_name, ', ') filter (where not e.announced), 'Announcement') as activity_name, bool_or(e.holds) as holds,
             (array_agg(e.ask_trigger order by e.announced, e.holds desc, e.made_at desc))[1] as ask_trigger
      from everything e where not e.recon group by e.survey_id
      union all
      select e.survey_id, e.activity_id, e.activity_name, e.holds, e.ask_trigger from everything e where e.recon
    )
    select coalesce(jsonb_agg(jsonb_build_object('surveyId', l.survey_id, 'activityId', l.activity_id, 'surveyTitle', s.title, 'activityName', l.activity_name,
                                                 'holdsCredit', l.holds, 'trigger', l.ask_trigger) order by l.holds desc, l.activity_name), '[]'::jsonb)
    from lines l join public.research_surveys s on s.id = l.survey_id
  );
end; $$;
revoke all on function public.my_pending_surveys() from public, anon;
grant execute on function public.my_pending_surveys() to authenticated;

-- ── 4. "Who was asked": announced scholars appear once they open the survey (not all of them at once) ──
create or replace function public.research_survey_gating_roster(p_survey_id uuid, p_activity_id uuid default null, p_with_released boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  with held as (
    select r.scholar_id_number, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id, max(r.updated_at) as updated_at, max(r.held_trigger) as ask_trigger,
           max(case when x.sdp_activity_id is not null then 'sdp' else 'formation' end) as activity_type
    from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
    where r.pending_survey_id = p_survey_id
    group by 1, 2
  ),
  asks as (select * from public.research_survey_asks k where k.survey_id = p_survey_id),
  everyone as (
    select r.scholar_id_number, r.activity_id, r.activity_type, r.activity_name, coalesce(r.ask_trigger, h.ask_trigger, k.ask_trigger) as ask_trigger,
           case when r.status in ('completed', 'declined') then r.status
                when h.scholar_id_number is not null or (k.id is not null and k.closed_at is null) or not p_with_released then 'in_progress'
                else 'released' end as status,
           r.updated_at
    from public.research_survey_responses r
    left join held h on h.scholar_id_number = r.scholar_id_number and h.activity_id is not distinct from r.activity_id
    left join asks k on k.scholar_id_number = r.scholar_id_number and k.activity_id is not distinct from r.activity_id
    where r.survey_id = p_survey_id and r.deleted_at is null
    union all
    select k.scholar_id_number, k.activity_id, k.activity_type, k.activity_name, k.ask_trigger,
           case when k.closed_at is null or not p_with_released then 'in_progress' else 'released' end, k.created_at
    from asks k
    where k.activity_type <> 'announcement'
      and not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id)
    union all
    select h.scholar_id_number, h.activity_id, h.activity_type, l.activity_name, h.ask_trigger, 'in_progress', h.updated_at
    from held h left join public.research_survey_activities l on l.survey_id = p_survey_id and l.activity_id = h.activity_id
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = h.scholar_id_number and r.activity_id is not distinct from h.activity_id)
      and not exists (select 1 from asks k where k.scholar_id_number = h.scholar_id_number and k.activity_id = h.activity_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', e.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), e.scholar_id_number),
    'activityId', e.activity_id, 'activityType', e.activity_type, 'activityName', coalesce(e.activity_name, 'Not recorded'),
    'trigger', e.ask_trigger, 'status', e.status, 'updatedAt', e.updated_at
  ) order by e.status, e.scholar_id_number, e.activity_name), '[]'::jsonb)
  into v_result
  from everyone e left join public.scholars s on s.scholar_id_number = e.scholar_id_number
  where p_activity_id is null or e.activity_id = p_activity_id;
  return v_result;
end; $$;
revoke all on function public.research_survey_gating_roster(uuid, uuid, boolean) from public, anon;
grant execute on function public.research_survey_gating_roster(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
