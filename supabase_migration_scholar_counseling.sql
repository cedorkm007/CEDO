-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_counseling.sql
--
-- New "Scholar Counseling Tool" (gated by the scholar_counseling tag,
-- assigned via it.admin1's Staff Accounts page — see
-- src/app/staffToolTags.ts). First subtab: "Daily Records", a log of
-- scholar counseling visits.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / DROP+ADD.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.scholar_counseling_records (
  id uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  -- Snapshot of the scholar's scholarship status AT THIS VISIT, not a live
  -- link to scholars.status — deliberately excludes 'Removed', same as
  -- every other freely-settable status surface in the app.
  status text not null check (status = any (array['Regular'::text, 'Probationary'::text, 'On leave'::text, 'Reconsidered'::text])),
  -- Always the signed-in staff member who created the record — set via
  -- the create_scholar_counseling_record() RPC below from auth.uid(),
  -- never accepted as a client-supplied value. The column default also
  -- covers a direct insert (defense in depth alongside the RLS check).
  consulted_by uuid not null references public.users(id) default auth.uid(),
  date_visited date not null default current_date,
  failed_subjects text not null default '',
  findings text not null default '',
  staff_recommendations text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists scholar_counseling_records_scholar_id_idx on public.scholar_counseling_records(scholar_id_number);
create index if not exists scholar_counseling_records_date_visited_idx on public.scholar_counseling_records(date_visited desc);

alter table public.scholar_counseling_records enable row level security;

drop policy if exists "counseling staff can read" on public.scholar_counseling_records;
drop policy if exists "counseling staff can insert their own" on public.scholar_counseling_records;

create or replace function public.is_scholar_counseling_staff()
 returns boolean
 language sql
 stable security definer
as $function$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key = 'scholar_counseling'
  );
$function$;

create policy "counseling staff can read" on public.scholar_counseling_records
  for select using (public.is_scholar_counseling_staff());

create policy "counseling staff can insert their own" on public.scholar_counseling_records
  for insert with check (public.is_scholar_counseling_staff() and consulted_by = auth.uid());

drop function if exists public.scholar_counseling_daily_records(text);

create or replace function public.scholar_counseling_daily_records(p_search text default ''::text)
 returns table(
   id uuid, scholar_id_number text, name text, course text, year_level text, school text,
   status text, date_visited date, consulted_by_name text,
   failed_subjects text, findings text, staff_recommendations text, created_at timestamptz
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    r.id, r.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    s.course, s.year_level, s.school,
    r.status, r.date_visited,
    trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as consulted_by_name,
    r.failed_subjects, r.findings, r.staff_recommendations, r.created_at
  from public.scholar_counseling_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users u on u.id = r.consulted_by
  where public.is_scholar_counseling_staff()
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
    )
  order by r.date_visited desc, r.created_at desc;
$function$;

create or replace function public.create_scholar_counseling_record(
  p_scholar_id_number text, p_status text, p_date_visited date,
  p_failed_subjects text, p_findings text, p_staff_recommendations text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_scholar_counseling_staff() then
    raise exception 'Not authorized to use the Scholar Counseling Tool.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then
    raise exception 'Scholar not found.';
  end if;

  insert into public.scholar_counseling_records
    (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations)
  values
    (p_scholar_id_number, p_status, auth.uid(), coalesce(p_date_visited, current_date),
     coalesce(p_failed_subjects, ''), coalesce(p_findings, ''), coalesce(p_staff_recommendations, ''))
  returning id into v_id;

  return v_id;
end;
$function$;
