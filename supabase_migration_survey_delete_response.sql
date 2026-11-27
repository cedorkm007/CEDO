-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_delete_response.sql
-- DELETE A RESPONSE FROM THE SURVEY RESULTS LIST.   Safe to run twice.   Undo: undo_survey_delete_response.sql
--
--   * Research staff can delete one scholar's response (for one activity) from the "Who was asked" list.
--   * Its answers leave the lists and charts. A copy is kept (who deleted, when, why) and can be restored.
--   * The scholar is NOT asked that survey again (a new reconsideration request still is).
--   * Attendance and credit already given stay. Anything still waiting on that survey for them is given.
-- It deletes nothing by itself. Needs the "ask only once" survey file.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._survey_settle(uuid,text,uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_survey_ask_once.sql first.';
  end if;
end $$;

alter table public.research_survey_responses add column if not exists deleted_at timestamptz;

-- The copy of what was deleted.
create table if not exists public.survey_deleted_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  response_id uuid not null references public.research_survey_responses(id) on delete cascade,
  scholar_id_number text not null,
  activity_name text,
  response jsonb not null,
  answers jsonb not null,
  reason text,
  deleted_by uuid,
  deleted_by_name text,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by_name text
);
create index if not exists survey_deleted_responses_survey on public.survey_deleted_responses (survey_id) where restored_at is null;
alter table public.survey_deleted_responses enable row level security;
revoke all on table public.survey_deleted_responses from anon, authenticated;       -- only through the functions below

create or replace function public._survey_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = auth.uid()), 'Staff');
$$;
revoke all on function public._survey_actor_name() from public, anon, authenticated;

create or replace function public.survey_delete_response(p_survey_id uuid, p_scholar_id_number text, p_activity_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_response public.research_survey_responses%rowtype; v_scholar uuid;
  v_type text; v_name text; v_trigger text; v_copy uuid;
begin
  perform public._survey_require_staff(p_survey_id);
  select id into v_scholar from public.scholars where scholar_id_number = p_scholar_id_number;
  select * into v_response from public.research_survey_responses r
    where r.survey_id = p_survey_id and r.scholar_id_number = p_scholar_id_number and r.activity_id is not distinct from p_activity_id
    for update;
  if v_response.deleted_at is not null then raise exception 'That response was already deleted.'; end if;

  if v_response.id is null then
    -- asked but not opened yet (waiting, or asked afterwards): record it so that it is not asked again
    select k.activity_type, k.activity_name, k.ask_trigger into v_type, v_name, v_trigger from public.research_survey_asks k
      where k.survey_id = p_survey_id and k.scholar_id_number = p_scholar_id_number and k.activity_id = p_activity_id;
    if v_type is null then
      select l.activity_type, l.activity_name, a.held_trigger into v_type, v_name, v_trigger
      from public.attendance_records a join public.attendance_sessions b on b.id = a.session_id
      join public.research_survey_activities l on l.survey_id = p_survey_id and l.activity_id = coalesce(b.sdp_activity_id, b.formation_activity_id)
      where a.scholar_id_number = p_scholar_id_number and a.pending_survey_id = p_survey_id and l.activity_id = p_activity_id limit 1;
    end if;
    if v_type is null then raise exception 'That response was not found. Reload the list and try again.'; end if;
    insert into public.research_survey_responses (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (p_survey_id, p_scholar_id_number, v_type, p_activity_id, v_name, v_trigger)
      returning * into v_response;
  end if;

  insert into public.survey_deleted_responses (survey_id, response_id, scholar_id_number, activity_name, response, answers, reason, deleted_by, deleted_by_name)
  values (p_survey_id, v_response.id, p_scholar_id_number, v_response.activity_name, to_jsonb(v_response),
          (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.research_survey_answers a where a.response_id = v_response.id),
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), public._survey_actor_name())
  returning id into v_copy;

  delete from public.research_survey_answers where response_id = v_response.id;
  -- hidden from the lists, and still counts as responded, so the survey is not asked again
  update public.research_survey_responses set deleted_at = now(), status = case when status = 'completed' then 'completed' else 'declined' end, updated_at = now()
    where id = v_response.id;
  update public.research_survey_asks set closed_at = coalesce(closed_at, now()) where survey_id = p_survey_id and scholar_id_number = p_scholar_id_number and activity_id = p_activity_id;
  if v_scholar is not null then perform public._survey_settle(v_scholar, p_scholar_id_number, p_survey_id); end if;
  return v_copy;
end; $$;

create or replace function public.survey_deleted_list(p_survey_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._survey_require_staff(p_survey_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'scholarIdNumber', d.scholar_id_number,
      'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), d.scholar_id_number),
      'activityName', coalesce(d.activity_name, 'Not recorded'), 'answerCount', jsonb_array_length(d.answers),
      'reason', d.reason, 'deletedBy', d.deleted_by_name, 'deletedAt', d.deleted_at
    ) order by d.deleted_at desc), '[]'::jsonb)
    from public.survey_deleted_responses d left join public.scholars s on s.scholar_id_number = d.scholar_id_number
    where d.survey_id = p_survey_id and d.restored_at is null
  );
end; $$;

-- Puts a deleted response back. Answers to a question or choice that was removed completely since then cannot come back (their number is returned).
create or replace function public.survey_restore_response(p_deleted_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v public.survey_deleted_responses%rowtype; v_restored integer;
begin
  select * into v from public.survey_deleted_responses where id = p_deleted_id and restored_at is null for update;
  if not found then raise exception 'That deleted response was not found. Reload the list and try again.'; end if;
  perform public._survey_require_staff(v.survey_id);

  insert into public.research_survey_answers (id, response_id, question_id, choice_id, likert_value, text_value, answered_at)
  select x.id, x.response_id, x.question_id, x.choice_id, x.likert_value, x.text_value, x.answered_at
  from jsonb_populate_recordset(null::public.research_survey_answers, v.answers) x
  where exists (select 1 from public.research_survey_questions q where q.id = x.question_id)
    and (x.choice_id is null or exists (select 1 from public.research_survey_choices c where c.id = x.choice_id))
  on conflict do nothing;
  get diagnostics v_restored = row_count;

  update public.research_survey_responses set deleted_at = null, status = v.response ->> 'status', submitted_at = (v.response ->> 'submitted_at')::timestamptz, updated_at = now()
    where id = v.response_id;
  update public.survey_deleted_responses set restored_at = now(), restored_by_name = public._survey_actor_name() where id = v.id;
  return jsonb_array_length(v.answers) - v_restored;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['survey_delete_response(uuid, text, uuid, text)', 'survey_deleted_list(uuid)', 'survey_restore_response(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- The "Who was asked" list leaves deleted responses out (otherwise as before).
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
