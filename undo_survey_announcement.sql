-- undo_survey_announcement.sql: removes the "Announce" option.
-- Invitations that were not opened are removed. Answers already given by announced scholars STAY, and so does the record of who announced when.
-- Bell notifications already sent stay in the scholars' lists.
begin;

drop function if exists public.survey_announce(uuid);
drop function if exists public.survey_announcement_status(uuid);
drop function if exists public.survey_announcement_waits();
drop function if exists public._survey_announce_targets(uuid);

delete from public.research_survey_asks where activity_type = 'announcement';
alter table public.research_survey_asks drop constraint if exists research_survey_asks_activity_type_check;
alter table public.research_survey_asks add constraint research_survey_asks_activity_type_check check (activity_type in ('sdp', 'formation', 'reconsideration'));
alter table public.research_survey_asks drop constraint if exists research_survey_asks_ask_trigger_check;
alter table public.research_survey_asks add constraint research_survey_asks_ask_trigger_check check (ask_trigger in ('manual', 'picture', 'reconsideration'));

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
             coalesce(r.held_trigger, 'qr') as ask_trigger, true as holds, false as recon, coalesce(r.held_at, r.updated_at) as made_at
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_sid and r.status = 'pending_survey' and r.pending_survey_id is not null
    ),
    asked as (
      select k.survey_id, k.activity_id, k.activity_name, k.ask_trigger, false as holds, k.activity_type = 'reconsideration' as recon, k.created_at as made_at
      from public.research_survey_asks k join public.research_surveys s on s.id = k.survey_id and s.is_active
      where k.scholar_id_number = v_sid and k.closed_at is null
        and not exists (select 1 from public.research_survey_responses r where r.survey_id = k.survey_id and r.scholar_id_number = v_sid and r.activity_id = k.activity_id and r.status in ('completed', 'declined'))
        and (k.activity_type = 'reconsideration' or not public._survey_responded(k.survey_id, v_sid))
        and not exists (select 1 from held h where h.survey_id = k.survey_id and h.activity_id = k.activity_id)
    ),
    everything as (select * from held union all select * from asked),
    lines as (
      -- every activity waiting for the same survey is one thing to answer
      select e.survey_id, (array_agg(e.activity_id order by e.holds desc, e.made_at desc))[1] as activity_id,
             string_agg(distinct e.activity_name, ', ') as activity_name, bool_or(e.holds) as holds,
             (array_agg(e.ask_trigger order by e.holds desc, e.made_at desc))[1] as ask_trigger
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
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = k.scholar_id_number and r.activity_id = k.activity_id)
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
