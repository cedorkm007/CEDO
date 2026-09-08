-- ─────────────────────────────────────────────────────────────
-- supabase_migration_activity_pubmats.sql
--
-- Lets staff attach a picture/pubmat (promotional material image) to
-- Formation activities, Submission activities, SDP activities, and
-- Quest subjects, so scholars can visually recognize the activity in
-- the scholar portal. One shared public bucket (images are non-
-- sensitive, unlike the private subject-certificates bucket), gated
-- for writes the same way subject-certificates already is —
-- public.is_sead_staff(), see supabase_migration_subject_passing_rate.sql.
--
-- Stores the storage object PATH on each row (pubmat_path), not the
-- full URL — the public URL is computed at read time via
-- getPublicUrl(), same convention as kauban-media.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('activity-pubmats', 'activity-pubmats', true)
on conflict (id) do nothing;

drop policy if exists "activity pubmats are publicly readable" on storage.objects;
create policy "activity pubmats are publicly readable" on storage.objects
  for select using (bucket_id = 'activity-pubmats');

drop policy if exists "sead staff manage activity pubmats" on storage.objects;
create policy "sead staff manage activity pubmats" on storage.objects
  for all using (bucket_id = 'activity-pubmats' and public.is_sead_staff())
  with check (bucket_id = 'activity-pubmats' and public.is_sead_staff());

alter table public.formation_activities add column if not exists pubmat_path text;
alter table public.submission_activities add column if not exists pubmat_path text;
alter table public.sdp_activities add column if not exists pubmat_path text;
alter table public.quest_subjects add column if not exists pubmat_path text;

-- get_my_submission_activities() is called by scholars via RPC, not a
-- plain select("*") — re-created here byte-for-byte identical to the
-- version in supabase_migration_submission_upload_field_categories_rpc.sql
-- plus a.pubmat_path, so the new column actually reaches scholars.
drop function if exists public.get_my_submission_activities();
create or replace function public.get_my_submission_activities()
returns table (id uuid, name text, description text, pubmat_path text, is_unlocked boolean, unmet_requirements jsonb, upload_fields jsonb)
language sql security definer stable set search_path = public as $$
  select a.id, a.name, a.description, a.pubmat_path, public.is_submission_activity_unlocked(a.id),
    coalesce((select jsonb_agg(jsonb_build_object('type', c.condition_type, 'label', case
      when c.condition_type = 'quest_subject' then coalesce(q.name, 'Quest subject') || ' (passing rate: ' || q.passing_rate_min::text || '%–' || q.passing_rate_max::text || '% required)'
      when c.condition_type = 'formation_activity' then coalesce(f.name, 'Formation activity')
      when c.condition_type = 'sdp_activity' then coalesce(s.name, 'SDP activity')
      when c.condition_type = 'course' then coalesce(c.course, 'Course')
      else case when c.all_year_levels then 'Any year level' else array_to_string(c.target_year_levels, ', ') end end
    ) order by c.created_at) from public.submission_activity_conditions c
      left join public.quest_subjects q on q.id=c.subject_id left join public.formation_activities f on f.id=c.formation_activity_id left join public.sdp_activities s on s.id=c.sdp_activity_id
      where c.activity_id=a.id and not public.is_submission_activity_condition_met(c.id)), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'isRequired', u.is_required, 'maxFiles', u.max_files, 'allowedCategories', u.allowed_categories) order by u.sort_order) from public.submission_upload_fields u where u.activity_id=a.id), '[]'::jsonb)
  from public.submission_activities a join public.scholars me on me.id=auth.uid()
  where a.all_year_levels or me.year_level = any(a.target_year_levels)
  order by a.created_at desc;
$$;
revoke all on function public.get_my_submission_activities() from public;
grant execute on function public.get_my_submission_activities() to authenticated;
