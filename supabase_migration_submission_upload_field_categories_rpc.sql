-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_field_categories_rpc.sql
--
-- get_my_submission_activities() (supabase_migration_submission_activity_unlock_conditions.sql)
-- builds each upload field's JSON without allowed_categories, so the
-- scholar-facing client has no way to know which document types a field
-- actually accepts once supabase_migration_submission_upload_field_categories.sql
-- adds that column. This re-creates the function with exactly one
-- addition (`'allowedCategories', u.allowed_categories` in the
-- jsonb_build_object call) — everything else byte-for-byte identical to
-- the version in that migration, which this doesn't edit or touch.
--
-- Run this AFTER both supabase_migration_submission_activity_unlock_conditions.sql
-- and supabase_migration_submission_upload_field_categories.sql.
--
-- Safe to re-run — create or replace.
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_my_submission_activities()
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
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'isRequired', u.is_required, 'maxFiles', u.max_files, 'allowedCategories', u.allowed_categories) order by u.sort_order) from public.submission_upload_fields u where u.activity_id=a.id), '[]'::jsonb)
  from public.submission_activities a join public.scholars me on me.id=auth.uid()
  where a.all_year_levels or me.year_level = any(a.target_year_levels)
  order by a.created_at desc;
$$;
revoke all on function public.get_my_submission_activities() from public;
grant execute on function public.get_my_submission_activities() to authenticated;
