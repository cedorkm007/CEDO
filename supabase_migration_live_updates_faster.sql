-- ─────────────────────────────────────────────────────────────
-- supabase_migration_live_updates_faster.sql
-- LIVE UPDATES FOR STAFF: ONE SHARED ANSWER EVERY 5 SECONDS (instead of every open staff page asking the whole database every 10 seconds).   Safe to run twice.   Undo: undo_live_updates_faster.sql
-- Run AFTER supabase_migration_renewal_documents_approver.sql.
--
-- WHY IT WAS SLOW: every open staff screen asks "has anything changed?" every ~10 seconds, and each question counts and scans about 14 tables (applications, history, documents, grades, scholars ...).
-- During the renewal, with many staff screens open and hundreds of scholars sending things, that is a heavy load that is repeated by every staff page at the same time, and it slows the lists and the uploads.
-- WHAT CHANGES: the answer is worked out by ONE page at a time and kept for 5 seconds; every other staff page in those 5 seconds gets the kept answer. A change still shows within about 5 + 10 seconds.
-- The consultation staff (Scholar Consultation Tool tag) may follow changes too (their new Renewal Cases tab updates by itself). One small table is added (live_stamp_cache). Nothing else changes. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.staff_live_stamp()') is null or to_regprocedure('public.is_scholar_counseling_staff()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_live_updates.sql, supabase_migration_renewal_documents_approver.sql and supabase_migration_scholar_counseling.sql first.';
  end if;
end $$;

create table if not exists public.live_stamp_cache (
  name        text primary key,
  stamp       text not null,
  computed_at timestamptz not null default now()
);
alter table public.live_stamp_cache enable row level security;
revoke all on table public.live_stamp_cache from public, anon, authenticated;

create or replace function public._staff_live_stamp_compute()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s text;
begin
  v_s := concat_ws('|',
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_records'),
    public._live_part('select count(*) || '':'' || coalesce(max(at)::text, '''') from public.renewal_history'),
    public._live_part('select count(*) || '':'' || coalesce(max(uploaded_at)::text, '''') || '':'' || coalesce(max(reviewed_at)::text, '''') from public.renewal_documents'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_inc_items'),
    public._live_part('select count(*) || '':'' || coalesce(max(booked_at)::text, '''') || '':'' || coalesce(max(marked_at)::text, '''') from public.counseling_slots where state <> ''open'''),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.scholar_counseling_referrals'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.renewal_windows'),
    public._live_part('select count(*) || '':'' || coalesce(max(created_at)::text, '''') from public.csr_issued'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, requested_at))::text, '''') from public.sdp_reconsideration_requests'),
    public._live_part('select count(*) || '':'' || coalesce(max(coalesce(decided_at, submitted_at))::text, '''') || '':'' || coalesce(max(official_checked_at)::text, '''') from public.renewal_self_grade_submissions'),
    public._live_part('select count(*) || '':'' || coalesce(max(updated_at)::text, '''') from public.school_period_submissions'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholar_subjects_grades'),
    public._live_part('select coalesce(max(updated_at)::text, '''') from public.scholars'),
    public._live_part('select coalesce(updated_at::text, '''') from public.grading_period_settings where id = true'));
  return md5(v_s);
end;
$$;
revoke all on function public._staff_live_stamp_compute() from public, anon, authenticated;

create or replace function public.staff_live_stamp()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_stamp text;
  v_at timestamptz;
  v_new text;
begin
  if not (public.can_view_renewals() or public._live_can('can_view_renewal_reports') or public._live_can('can_decide_sdp_reconsideration') or public._live_can('can_approve_scholar_grades') or public._live_can('can_approve_renewal_documents') or public.is_scholar_counseling_staff()) then
    raise exception 'Not authorized to follow renewal changes.';
  end if;
  select c.stamp, c.computed_at into v_stamp, v_at from public.live_stamp_cache c where c.name = 'staff';
  if v_stamp is not null and v_at > now() - interval '5 seconds' then return v_stamp; end if;
  -- only one page works the answer out at a time; the others take the kept one (or wait for nothing)
  if pg_try_advisory_xact_lock(hashtext('staff_live_stamp')) then
    v_new := public._staff_live_stamp_compute();
    insert into public.live_stamp_cache (name, stamp, computed_at) values ('staff', v_new, now())
    on conflict (name) do update set stamp = excluded.stamp, computed_at = excluded.computed_at;
    return v_new;
  end if;
  return coalesce(v_stamp, public._staff_live_stamp_compute());
end;
$$;
revoke all on function public.staff_live_stamp() from public, anon;
grant execute on function public.staff_live_stamp() to authenticated;

notify pgrst, 'reload schema';
