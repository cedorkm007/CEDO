-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_eligible_did_not_attend.sql
-- SDP MONITORING > an activity > CREDITED SCHOLARS > "Not credited" > "ELIGIBLE, DID NOT ATTEND".
-- Safe to run twice.   Undo: undo_sdp_eligible_did_not_attend.sql   (It adds three read-only functions; it changes and deletes no record, and it does NOT change how credits are counted.)
--
-- WHO IS ELIGIBLE: exactly the scholars the activity is OPEN to, by the rule the database already uses to show an activity to a scholar (the scholar's own list of open activities):
--     * the activity is for all year levels, or for the scholar's year level; AND
--     * the activity has no barangay / cluster limit, or the scholar's barangay is one of the chosen barangays, or belongs to one of the chosen clusters.
--   Scholars who are Removed are left out. An activity a SCHOLAR submitted is not open to other scholars, so it has no eligible list ("not applicable").
-- WHO IS "DID NOT ATTEND": an eligible scholar with NO credit for the activity and who did not scan the QR code / was not marked present (a scholar who scanned once but never finished, with no time-out, is included and marked).
--   Scholars who attended but have no credit are in the other list ("Attended, not credited"), not here.
--
--   * sdp_eligible_summary(activity): is the list applicable, and how many eligible scholars did not attend (the number on the button).
--   * sdp_eligible_did_not_attend_page(activity, search, limit, offset): ONE PAGE of them with the true total, searched by name or Scholar ID, with year level, barangay, school.
--   * _sdp_eligible_did_not_attend(activity): the one place the rule above is written (used by both).
-- Who may use them: the same people who may credit scholars for that activity. Needs supabase_migration_sdp_credited_scholars_paging.sql to be run already.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._sdp_can_manage_credits(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_sdp_credited_scholars_paging.sql first.';
  end if;
  if to_regprocedure('public.sdp_activity_visible_to_barangay(text[],text[],text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_sdp_barangay_cluster_visibility.sql first.';
  end if;
end $$;

-- 1. The rule, written once.
create or replace function public._sdp_eligible_did_not_attend(p_activity_id uuid)
returns table(scholar_id_number text, attendance_status text)
language sql
stable
security definer
set search_path = public
as $$
  select s.scholar_id_number, r.status
  from public.sdp_activities a
  join public.scholars s on s.status <> 'Removed'
  left join lateral (
    select rec.status from public.attendance_sessions ses join public.attendance_records rec on rec.session_id = ses.id
    where ses.sdp_activity_id = a.id and rec.scholar_id_number = s.scholar_id_number limit 1
  ) r on true
  where a.id = p_activity_id
    and a.submitted_by_scholar_id is null
    and (a.all_year_levels or s.year_level = any (a.target_year_levels))
    and public.sdp_activity_visible_to_barangay(a.target_barangays, a.target_clusters, s.barangay)
    and not exists (select 1 from public.sdp_attendance c where c.activity_id = a.id and c.scholar_id_number = s.scholar_id_number)
    and (r.status is null or r.status = 'incomplete');
$$;
revoke all on function public._sdp_eligible_did_not_attend(uuid) from public, anon, authenticated;

-- 2. The number on the button.
create or replace function public.sdp_eligible_summary(p_activity_id uuid)
returns table(applicable boolean, eligible_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open boolean;
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  select (a.submitted_by_scholar_id is null) into v_open from public.sdp_activities a where a.id = p_activity_id;
  if v_open is null then raise exception 'The activity was not found.'; end if;
  return query select v_open, case when v_open then (select count(*) from public._sdp_eligible_did_not_attend(p_activity_id)) else 0::bigint end;
end;
$$;
revoke all on function public.sdp_eligible_summary(uuid) from public, anon;
grant execute on function public.sdp_eligible_summary(uuid) to authenticated;

-- 3. One page of the eligible scholars who did not attend.
create or replace function public.sdp_eligible_did_not_attend_page(p_activity_id uuid, p_search text default '', p_limit integer default 25, p_offset integer default 0)
returns table(scholar_id_number text, first_name text, last_name text, year_level text, barangay text, school text, attendance_status text, total_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(lower(btrim(coalesce(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public._sdp_can_manage_credits(p_activity_id) then raise exception 'You are not allowed to see the credits of this activity.'; end if;
  return query
  with e as (
    select x.scholar_id_number as sid, x.attendance_status as st, s.first_name as fn, s.last_name as ln, s.year_level as yl, s.barangay as br, s.school as sc, count(*) over () as total
    from public._sdp_eligible_did_not_attend(p_activity_id) x join public.scholars s on s.scholar_id_number = x.scholar_id_number
    where v_q = '' or lower(s.scholar_id_number) like '%' || v_q || '%'
       or lower(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) like '%' || v_q || '%'
       or lower(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')) like '%' || v_q || '%'
  )
  select e.sid, e.fn, e.ln, e.yl, e.br, e.sc, e.st, e.total from e order by lower(e.ln), lower(e.fn), e.sid limit v_limit offset v_offset;
end;
$$;
revoke all on function public.sdp_eligible_did_not_attend_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.sdp_eligible_did_not_attend_page(uuid, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
