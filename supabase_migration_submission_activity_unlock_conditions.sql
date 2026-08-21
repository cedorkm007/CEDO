-- Unlock rules for Submission Activities. Run after the existing submission
-- activity/upload migrations and the Forms unlock engine migration.

create table if not exists public.submission_activity_conditions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.submission_activities(id) on delete cascade,
  condition_type text not null,
  subject_id uuid references public.quest_subjects(id) on delete cascade,
  formation_activity_id uuid references public.formation_activities(id) on delete cascade,
  sdp_activity_id uuid references public.sdp_activities(id) on delete cascade,
  course text,
  target_year_levels text[] not null default '{}'::text[],
  all_year_levels boolean not null default false,
  created_at timestamptz not null default now(),
  constraint submission_activity_conditions_type_check check (condition_type in ('quest_subject', 'formation_activity', 'sdp_activity', 'course', 'year_level')),
  constraint submission_activity_conditions_shape_check check (
    (condition_type = 'quest_subject' and subject_id is not null and formation_activity_id is null and sdp_activity_id is null and course is null)
    or (condition_type = 'formation_activity' and subject_id is null and formation_activity_id is not null and sdp_activity_id is null and course is null)
    or (condition_type = 'sdp_activity' and subject_id is null and formation_activity_id is null and sdp_activity_id is not null and course is null)
    or (condition_type = 'course' and subject_id is null and formation_activity_id is null and sdp_activity_id is null and nullif(trim(course), '') is not null)
    or (condition_type = 'year_level' and subject_id is null and formation_activity_id is null and sdp_activity_id is null and course is null and (all_year_levels or cardinality(target_year_levels) > 0))
  )
);

create index if not exists idx_submission_activity_conditions_activity on public.submission_activity_conditions(activity_id);
create unique index if not exists submission_activity_conditions_subject_unique on public.submission_activity_conditions(activity_id, subject_id) where condition_type = 'quest_subject';
create unique index if not exists submission_activity_conditions_formation_unique on public.submission_activity_conditions(activity_id, formation_activity_id) where condition_type = 'formation_activity';
create unique index if not exists submission_activity_conditions_sdp_unique on public.submission_activity_conditions(activity_id, sdp_activity_id) where condition_type = 'sdp_activity';
create unique index if not exists submission_activity_conditions_course_unique on public.submission_activity_conditions(activity_id, lower(trim(course))) where condition_type = 'course';
create unique index if not exists submission_activity_conditions_year_level_unique on public.submission_activity_conditions(activity_id) where condition_type = 'year_level';

alter table public.submission_activity_conditions enable row level security;
drop policy if exists "staff read submission activity conditions" on public.submission_activity_conditions;
create policy "staff read submission activity conditions" on public.submission_activity_conditions for select using (public.is_sead_staff());
drop policy if exists "forms management writes submission activity conditions" on public.submission_activity_conditions;
create policy "forms management writes submission activity conditions" on public.submission_activity_conditions for all
  using (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management'))
  with check (exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management'));

create or replace function public.is_submission_activity_condition_met(p_condition_id uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare v_scholar public.scholars%rowtype; v_cond public.submission_activity_conditions%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then return false; end if;
  select * into v_cond from public.submission_activity_conditions where id = p_condition_id;
  if not found then return true; end if;
  return case v_cond.condition_type
    when 'quest_subject' then exists (
      select 1 from public.scholar_subject_progress p join public.quest_subjects qs on qs.id = v_cond.subject_id
      where p.subject_id = v_cond.subject_id and p.scholar_id_number = v_scholar.scholar_id_number
        and p.subject_percentage >= qs.passing_rate_min and p.subject_percentage <= qs.passing_rate_max
    )
    when 'formation_activity' then exists (select 1 from public.my_completed_activity_attendance() a where a.formation_activity_id = v_cond.formation_activity_id)
    when 'sdp_activity' then exists (select 1 from public.my_completed_activity_attendance() a where a.sdp_activity_id = v_cond.sdp_activity_id)
    when 'course' then lower(trim(coalesce(v_scholar.course, ''))) = lower(trim(v_cond.course))
    when 'year_level' then v_cond.all_year_levels or v_scholar.year_level = any(v_cond.target_year_levels)
    else false
  end;
end; $$;

create or replace function public.is_submission_activity_unlocked(p_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.submission_activities a join public.scholars s on s.id = auth.uid()
    where a.id = p_activity_id and (a.all_year_levels or s.year_level = any(a.target_year_levels))
  ) and not exists (
    select 1 from public.submission_activity_conditions c
    where c.activity_id = p_activity_id and not public.is_submission_activity_condition_met(c.id)
  );
$$;

revoke all on function public.is_submission_activity_condition_met(uuid) from public;
revoke all on function public.is_submission_activity_unlocked(uuid) from public;
grant execute on function public.is_submission_activity_unlocked(uuid) to authenticated;

-- Private service-role helper for the upload Edge Function. It deliberately
-- accepts an explicit scholar id because service-role calls do not carry the
-- scholar's auth.uid(); it is not granted to browser roles.
create or replace function public.is_submission_activity_unlocked_for_scholar(p_activity_id uuid, p_scholar_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.submission_activities a join public.scholars s on s.id = p_scholar_id
    where a.id = p_activity_id and (a.all_year_levels or s.year_level = any(a.target_year_levels))
  ) and not exists (
    select 1 from public.submission_activity_conditions c
    where c.activity_id = p_activity_id and not (
      case c.condition_type
        when 'quest_subject' then exists (
          select 1 from public.scholar_subject_progress p join public.quest_subjects qs on qs.id=c.subject_id
          join public.scholars s on s.id=p_scholar_id
          where p.subject_id=c.subject_id and p.scholar_id_number=s.scholar_id_number
            and p.subject_percentage >= qs.passing_rate_min and p.subject_percentage <= qs.passing_rate_max
        )
        when 'formation_activity' then exists (
          select 1 from public.attendance_records r join public.attendance_sessions x on x.id=r.session_id
          join public.scholars s on s.id=p_scholar_id
          where r.scholar_id_number=s.scholar_id_number and r.status='present' and x.formation_activity_id=c.formation_activity_id
        )
        when 'sdp_activity' then exists (
          select 1 from public.attendance_records r join public.attendance_sessions x on x.id=r.session_id
          join public.scholars s on s.id=p_scholar_id
          where r.scholar_id_number=s.scholar_id_number and r.status='present' and x.sdp_activity_id=c.sdp_activity_id
        )
        when 'course' then exists (select 1 from public.scholars s where s.id=p_scholar_id and lower(trim(coalesce(s.course,'')))=lower(trim(c.course)))
        when 'year_level' then exists (select 1 from public.scholars s where s.id=p_scholar_id and (c.all_year_levels or s.year_level=any(c.target_year_levels)))
        else false
      end
    )
  );
$$;
revoke all on function public.is_submission_activity_unlocked_for_scholar(uuid, uuid) from public;
grant execute on function public.is_submission_activity_unlocked_for_scholar(uuid, uuid) to service_role;

drop function if exists public.get_my_submission_activities();
create function public.get_my_submission_activities()
returns table (id uuid, name text, description text, is_unlocked boolean, unmet_requirements jsonb, upload_fields jsonb)
language sql security definer stable set search_path = public as $$
  select a.id, a.name, a.description, public.is_submission_activity_unlocked(a.id),
    coalesce((select jsonb_agg(jsonb_build_object('type', c.condition_type, 'label', case
      when c.condition_type = 'quest_subject' then coalesce(q.name, 'Quest subject') || ' (passing rate: ' || q.passing_rate_min::text || '%–' || q.passing_rate_max::text || '% required)'
      when c.condition_type = 'formation_activity' then coalesce(f.name, 'Formation activity')
      when c.condition_type = 'sdp_activity' then coalesce(s.name, 'SDP activity')
      when c.condition_type = 'course' then coalesce(c.course, 'Course')
      else case when c.all_year_levels then 'Any year level' else array_to_string(c.target_year_levels, ', ') end end
    ) order by c.created_at) from public.submission_activity_conditions c
      left join public.quest_subjects q on q.id=c.subject_id left join public.formation_activities f on f.id=c.formation_activity_id left join public.sdp_activities s on s.id=c.sdp_activity_id
      where c.activity_id=a.id and not public.is_submission_activity_condition_met(c.id)), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'isRequired', u.is_required, 'maxFiles', u.max_files) order by u.sort_order) from public.submission_upload_fields u where u.activity_id=a.id), '[]'::jsonb)
  from public.submission_activities a join public.scholars me on me.id=auth.uid()
  where a.all_year_levels or me.year_level = any(a.target_year_levels)
  order by a.created_at desc;
$$;
revoke all on function public.get_my_submission_activities() from public;
grant execute on function public.get_my_submission_activities() to authenticated;

-- Direct table access is granted only after unlocking. The scholar-facing RPC
-- above deliberately remains able to return locked activity metadata.
drop policy if exists "scholar reads own-year-level activities" on public.submission_activities;
drop policy if exists "scholar reads unlocked submission activities" on public.submission_activities;
create policy "scholar reads unlocked submission activities" on public.submission_activities for select using (public.is_submission_activity_unlocked(id));
drop policy if exists "scholar reads fields for own-year-level activities" on public.submission_upload_fields;
drop policy if exists "scholar reads fields for unlocked submission activities" on public.submission_upload_fields;
create policy "scholar reads fields for unlocked submission activities" on public.submission_upload_fields for select using (public.is_submission_activity_unlocked(activity_id));
drop policy if exists "scholar reads own submissions" on public.submission_uploads;
drop policy if exists "scholar reads unlocked own submissions" on public.submission_uploads;
create policy "scholar reads unlocked own submissions" on public.submission_uploads for select using (scholar_id = auth.uid() and public.is_submission_activity_unlocked(activity_id));
drop policy if exists "scholar creates own submissions" on public.submission_uploads;
drop policy if exists "scholar creates unlocked own submissions" on public.submission_uploads;
create policy "scholar creates unlocked own submissions" on public.submission_uploads for insert with check (scholar_id = auth.uid() and public.is_submission_activity_unlocked(activity_id));
