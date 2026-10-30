-- ─────────────────────────────────────────────────────────────
-- SDP: THE SCHOLAR SEES THE CREDITS ADDED TO THEIR REQUIREMENT AS SOON AS A RECONSIDERATION IS APPROVED.   Safe to run twice.   Undo: undo_sdp_owed_for_scholar.sql
-- Run AFTER the SDP reconsideration files (a to d).
--
-- When an SDP reconsideration is approved, the credits that were lacking are added to the requirement of the NEXT semester (3 + what was lacking). That semester's requirement only
-- shows on the scholar's SDP tab once it is the current grading period, so the scholar saw nothing at first. This adds one function the SDP tab uses to list, as soon as the
-- request is approved, what is added and to which semester (this semester and the ones coming). It only reads the scholar's own rows.
-- Adds one function. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
create or replace function public.fetch_scholar_sdp_owed()
returns table(school_year text, semester text, category text, amount integer, is_current boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_year text;
  v_sem text;
  v_rank integer;
begin
  if v_id is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
  if v_year is null or v_sem is null then return; end if;
  v_rank := case when v_sem ilike '1st%' then 1 when v_sem ilike '2nd%' then 2 when v_sem ilike 'summer%' then 3 else 4 end;
  return query
  select d.apply_school_year, d.apply_semester, d.category, sum(d.amount)::integer, (d.apply_school_year = v_year and d.apply_semester = v_sem)
  from public.sdp_reconsideration_debts d
  where d.scholar_id_number = v_id
    and (d.apply_school_year > v_year
         or (d.apply_school_year = v_year and (case when d.apply_semester ilike '1st%' then 1 when d.apply_semester ilike '2nd%' then 2 when d.apply_semester ilike 'summer%' then 3 else 4 end) >= v_rank))
  group by d.apply_school_year, d.apply_semester, d.category
  order by d.apply_school_year, (case when d.apply_semester ilike '1st%' then 1 when d.apply_semester ilike '2nd%' then 2 when d.apply_semester ilike 'summer%' then 3 else 4 end), d.category;
end;
$$;
revoke all on function public.fetch_scholar_sdp_owed() from public, anon;
grant execute on function public.fetch_scholar_sdp_owed() to authenticated;

notify pgrst, 'reload schema';
