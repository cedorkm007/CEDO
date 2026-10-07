-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_unlock_perf.sql
--
-- Fixes "canceling statement due to statement timeout" on Submission
-- Activities -- staff Submission Monitoring failing to load AND scholars
-- failing to upload, at the same time.
--
-- ROOT CAUSE (measured against production, idle database):
--   * is_submission_activity_unlocked_for_scholar() -- the check the
--     upload Edge Function runs on every single file -- took ~1,000ms for
--     ONE scholar. Its quest_subject branch joins the scholar_subject_
--     progress view on `p.scholar_id_number = s.scholar_id_number`, a
--     join (not a constant), so Postgres can't push that filter down into
--     the view, and the view cross-joins EVERY quest topic with EVERY
--     scholar (7,000+) with a correlated lookup into scholar_quest_scores
--     (~69,000 rows) for each pair. The same lookup with a literal
--     scholar id runs in ~100ms -- the whole difference is that the
--     entire organization's progress was being recomputed to answer a
--     question about one person.
--   * is_submission_activity_condition_met() (behind scholars'
--     get_my_submission_activities() and the upload RLS policy) has the
--     identical shape.
--   * That cost multiplies: many scholars uploading at once means many
--     of these full recomputations in parallel, which also starves the
--     staff roster query, hence both screens failing together.
--
-- FIX: compute ONE scholar's subject percentage directly
-- (_scholar_subject_pct, same definition as the view: average over the
-- subject's topics of the scholar's best score %, an unattempted topic
-- counting as 0%) and use it in both functions' quest_subject branches.
-- Every other branch and every line of both functions is unchanged. Also
-- adds a composite index for that lookup, and a single-call JSON variant
-- of the roster RPC (see the client change in submissionActivitiesApi.ts:
-- the old paging approach re-ran the whole roster query up to 20 times
-- per screen load).
--
-- Safe to re-run -- create-or-replace / if-not-exists throughout.
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_sqs_topic_scholar
  on public.scholar_quest_scores (topic_id, scholar_id_number);

-- One scholar's percentage for one subject. Same semantics as
-- scholar_subject_progress.subject_percentage; returns NULL (which fails
-- any passing-rate comparison, matching the view having no row) when the
-- subject has no topics.
create or replace function public._scholar_subject_pct(p_scholar_id_number text, p_subject_id uuid)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select avg(coalesce(best.best_pct, 0))
  from public.quest_topics t
  left join lateral (
    select max(sqs.score::numeric / nullif(sqs.max_score, 0)) * 100 as best_pct
    from public.scholar_quest_scores sqs
    where sqs.topic_id = t.id and sqs.scholar_id_number = p_scholar_id_number
  ) best on true
  where t.subject_id = p_subject_id;
$$;
revoke all on function public._scholar_subject_pct(text, uuid) from public;

create or replace function public.is_submission_activity_condition_met(p_condition_id uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare v_scholar public.scholars%rowtype; v_cond public.submission_activity_conditions%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then return false; end if;
  select * into v_cond from public.submission_activity_conditions where id = p_condition_id;
  if not found then return true; end if;
  return case v_cond.condition_type
    when 'quest_subject' then coalesce((
      select p.pct >= qs.passing_rate_min and p.pct <= qs.passing_rate_max
      from public.quest_subjects qs
      cross join lateral (select public._scholar_subject_pct(v_scholar.scholar_id_number, v_cond.subject_id) as pct) p
      where qs.id = v_cond.subject_id
    ), false)
    when 'formation_activity' then exists (select 1 from public.my_completed_activity_attendance() a where a.formation_activity_id = v_cond.formation_activity_id)
    when 'sdp_activity' then exists (select 1 from public.my_completed_activity_attendance() a where a.sdp_activity_id = v_cond.sdp_activity_id)
    when 'course' then lower(trim(coalesce(v_scholar.course, ''))) = lower(trim(v_cond.course))
    when 'year_level' then v_cond.all_year_levels or v_scholar.year_level = any(v_cond.target_year_levels)
    else false
  end;
end; $$;
revoke all on function public.is_submission_activity_condition_met(uuid) from public;

create or replace function public.is_submission_activity_unlocked_for_scholar(p_activity_id uuid, p_scholar_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.submission_activities a join public.scholars s on s.id = p_scholar_id
    where a.id = p_activity_id and (a.all_year_levels or s.year_level = any(a.target_year_levels))
  ) and not exists (
    select 1 from public.submission_activity_conditions c
    where c.activity_id = p_activity_id and not (
      case c.condition_type
        when 'quest_subject' then coalesce((
          select p.pct >= qs.passing_rate_min and p.pct <= qs.passing_rate_max
          from public.quest_subjects qs
          join public.scholars sc on sc.id = p_scholar_id
          cross join lateral (select public._scholar_subject_pct(sc.scholar_id_number, c.subject_id) as pct) p
          where qs.id = c.subject_id
        ), false)
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

-- Single-call roster: one execution of get_submission_roster_status()
-- returned as one JSON array, instead of the client paging through it
-- with 20 parallel .range() calls that each re-ran the whole query.
-- Authorization is get_submission_roster_status()'s own check (it raises
-- for anyone who isn't allowed), so this wrapper doesn't repeat it.
create or replace function public.get_submission_roster_status_json(p_activity_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from public.get_submission_roster_status(p_activity_id) r;
$$;
revoke all on function public.get_submission_roster_status_json(uuid) from public;
grant execute on function public.get_submission_roster_status_json(uuid) to authenticated;
