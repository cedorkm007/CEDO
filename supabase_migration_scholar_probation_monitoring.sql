-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_probation_monitoring.sql
--
-- "Probationary Monitoring" — the Scholar Counseling Tool's second
-- subtab: a live roster of every currently-Probationary scholar, with
-- an editable Study Plan / Academic Contract Update note per scholar
-- (current value only, no history — Counseling History already covers
-- the visit-by-visit log via scholar_counseling_records).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.scholar_probation_notes (
  scholar_id_number text primary key references public.scholars(scholar_id_number) on delete cascade,
  study_plan text not null default '',
  academic_contract_update text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

alter table public.scholar_probation_notes enable row level security;

drop policy if exists "counseling staff can read probation notes" on public.scholar_probation_notes;
drop policy if exists "counseling staff can write probation notes" on public.scholar_probation_notes;

create policy "counseling staff can read probation notes" on public.scholar_probation_notes
  for select using (public.is_scholar_counseling_staff());

create policy "counseling staff can write probation notes" on public.scholar_probation_notes
  for all using (public.is_scholar_counseling_staff()) with check (public.is_scholar_counseling_staff());

drop function if exists public.scholar_probation_monitoring_list(text);

create or replace function public.scholar_probation_monitoring_list(p_search text default ''::text)
 returns table(
   scholar_id_number text, name text, course text, year_level text, school text,
   study_plan text, academic_contract_update text
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school,
    coalesce(n.study_plan, ''), coalesce(n.academic_contract_update, '')
  from public.scholars s
  left join public.scholar_probation_notes n on n.scholar_id_number = s.scholar_id_number
  where public.is_scholar_counseling_staff()
    and s.status = 'Probationary'
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
    )
  order by s.last_name, s.first_name;
$function$;

create or replace function public.upsert_scholar_probation_notes(
  p_scholar_id_number text, p_study_plan text, p_academic_contract_update text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholar_counseling_staff() then
    raise exception 'Not authorized to use the Scholar Counseling Tool.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;

  insert into public.scholar_probation_notes (scholar_id_number, study_plan, academic_contract_update, updated_by, updated_at)
  values (p_scholar_id_number, coalesce(p_study_plan, ''), coalesce(p_academic_contract_update, ''), auth.uid(), now())
  on conflict (scholar_id_number) do update
    set study_plan = excluded.study_plan,
        academic_contract_update = excluded.academic_contract_update,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;
end;
$function$;
