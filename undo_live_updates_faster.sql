-- undo_live_updates_faster.sql: puts back the staff live-update function as it was (every page works the answer out itself).

create or replace function public.staff_live_stamp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s text;
begin
  if not (public.can_view_renewals() or public._live_can('can_view_renewal_reports') or public._live_can('can_decide_sdp_reconsideration') or public._live_can('can_approve_scholar_grades') or public._live_can('can_approve_renewal_documents')) then
    raise exception 'Not authorized to follow renewal changes.';
  end if;
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
revoke all on function public.staff_live_stamp() from public, anon;
grant execute on function public.staff_live_stamp() to authenticated;

drop function if exists public._staff_live_stamp_compute();
drop table if exists public.live_stamp_cache;

notify pgrst, 'reload schema';
