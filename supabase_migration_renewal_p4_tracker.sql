-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p4_tracker.sql
-- Scholar Renewal System, Phase 4: the scholar's Consultation tile.
-- Run AFTER supabase_migration_renewal_p3_appointments.sql. Additive and safe to run twice (one new read-only function).
--
-- The Renewal tile, its progress tracker and the "what to do next" wording need nothing new in the database: they show what the rules
-- function (_renewal_evaluate) already answers. The Consultation tile lists the scholar's own appointments (upcoming and past), and
-- booking / rescheduling / cancelling reuse the Phase 3 functions.
-- ─────────────────────────────────────────────────────────────

-- The signed-in scholar's own appointments, soonest upcoming first, then the most recent past ones.
create or replace function public.consultation_my_appointments()
returns table(slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text, state text, record_id uuid, term_label text, can_change boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  return query
  select x.id, x.starts_at, x.ends_at, public._staff_display_name(x.staff_id), x.state, x.record_id,
         case when r.id is null then null else r.term || ' ' || r.school_year end,
         (x.state = 'booked' and x.starts_at >= now() + interval '12 hours')
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.scholar_id_number = v_id and x.state <> 'open'
  order by (x.state = 'booked' and x.starts_at >= now()) desc,
           case when x.state = 'booked' and x.starts_at >= now() then x.starts_at end asc,
           x.starts_at desc
  limit 50;
end;
$$;
revoke all on function public.consultation_my_appointments() from public, anon;
grant execute on function public.consultation_my_appointments() to authenticated;

-- ── The study plan form is different for each school ────────
-- Each school has its own blank study plan template. The CEDO office uploads it on that school's row in Forms Management > "Renewal study plans"
-- (PDF or Word, up to 10 MB); a row with no school is the DEFAULT for schools that have none of their own. The file goes into its own private
-- folder and the system names the download itself ("Study Plan Form - <school>.pdf"), so every scholar gets a tidy, recognisable file name.

-- An earlier draft of this feature picked a form from Materials instead; that shape is replaced (nothing in the real project used it).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'renewal_study_plan_forms' and column_name = 'material_id') then
    drop policy if exists "scholar downloads renewal study plan form" on storage.objects;
    drop function if exists public.renewal_is_my_study_plan_form(text);
    drop function if exists public.renewal_study_plan_form_set(uuid, uuid);
    drop table public.renewal_study_plan_forms;
  end if;
end $$;
drop function if exists public.renewal_my_study_plan_form();

create table if not exists public.renewal_study_plan_forms (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools(id) on delete cascade,      -- null = the default for schools without their own
  storage_path text not null,                                             -- <school id or 'default'>/<uuid>.<ext> in the folder renewal-study-plan-forms
  file_name    text not null,                                             -- the file's name as the office uploaded it (shown to staff only)
  set_by       uuid references public.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create unique index if not exists renewal_study_plan_forms_school_uq on public.renewal_study_plan_forms (school_id) where school_id is not null;
create unique index if not exists renewal_study_plan_forms_default_uq on public.renewal_study_plan_forms ((true)) where school_id is null;
alter table public.renewal_study_plan_forms enable row level security;
drop policy if exists "forms staff read study plan forms" on public.renewal_study_plan_forms;
create policy "forms staff read study plan forms" on public.renewal_study_plan_forms for select using (public.has_staff_tag('forms_management'));
-- No write policy: the templates are saved through renewal_study_plan_form_save() / _remove().

-- Private folder for the templates. Staff with the Forms Management tag manage it; a scholar can read only the template that is theirs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renewal-study-plan-forms', 'renewal-study-plan-forms', false, 10485760,
        array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Scholars cannot read the table of templates directly, so the storage rule asks this small function: "is this file THE template of my school?"
-- It never raises (it runs for staff and anonymous reads of storage too): anyone who is not a scholar simply gets false.
create or replace function public.renewal_is_my_study_plan_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.scholars sc
    join public.renewal_study_plan_forms f on f.storage_path = p_path
      and (f.school_id = sc.school_id
           or (f.school_id is null and not exists (select 1 from public.renewal_study_plan_forms own where own.school_id = sc.school_id)))
    where sc.id = auth.uid()
  );
$$;
revoke all on function public.renewal_is_my_study_plan_path(text) from public, anon;
grant execute on function public.renewal_is_my_study_plan_path(text) to authenticated;

drop policy if exists "forms staff manage study plan templates" on storage.objects;
create policy "forms staff manage study plan templates" on storage.objects for all
  using (bucket_id = 'renewal-study-plan-forms' and public.has_staff_tag('forms_management'))
  with check (bucket_id = 'renewal-study-plan-forms' and public.has_staff_tag('forms_management'));
drop policy if exists "scholar reads own study plan template" on storage.objects;
create policy "scholar reads own study plan template" on storage.objects for select
  using (bucket_id = 'renewal-study-plan-forms' and public.renewal_is_my_study_plan_path(storage.objects.name));

-- Staff (Forms Management tag): the schools and which template each has.
create or replace function public.renewal_study_plan_form_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('forms_management') then raise exception 'Only Forms Management staff can set the study plan forms.'; end if;
  return jsonb_build_object(
    'schools', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'scholars', (select count(*) from public.scholars sc where sc.school_id = s.id and sc.status <> 'Removed')) order by s.name) from public.schools s), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('school_id', f.school_id, 'storage_path', f.storage_path, 'file_name', f.file_name, 'updated_at', f.updated_at)) from public.renewal_study_plan_forms f), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_study_plan_form_setup() from public, anon;
grant execute on function public.renewal_study_plan_form_setup() to authenticated;

-- Save the template of one school (p_school_id null = the default) after the website has uploaded the file. Returns the path of the file it
-- replaced (or null), so the website can delete that old file.
create or replace function public.renewal_study_plan_form_save(p_school_id uuid, p_storage_path text, p_file_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.has_staff_tag('forms_management') then raise exception 'Only Forms Management staff can set the study plan forms.'; end if;
  if p_school_id is not null and not exists (select 1 from public.schools s where s.id = p_school_id) then raise exception 'That school was not found.'; end if;
  if coalesce(btrim(p_file_name), '') = '' then raise exception 'The file has no name.'; end if;
  if p_storage_path is null or left(p_storage_path, length(coalesce(p_school_id::text, 'default')) + 1) <> coalesce(p_school_id::text, 'default') || '/' then
    raise exception 'That file is not in this school''s folder.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'renewal-study-plan-forms' and o.name = p_storage_path) then
    raise exception 'The file was not uploaded. Please try again.';
  end if;
  select f.storage_path into v_old from public.renewal_study_plan_forms f where f.school_id is not distinct from p_school_id;
  if found then
    update public.renewal_study_plan_forms
       set storage_path = p_storage_path, file_name = left(btrim(p_file_name), 200), set_by = (select u.id from public.users u where u.id = auth.uid()), updated_at = now()
     where school_id is not distinct from p_school_id;
  else
    insert into public.renewal_study_plan_forms (school_id, storage_path, file_name, set_by)
    values (p_school_id, p_storage_path, left(btrim(p_file_name), 200), (select u.id from public.users u where u.id = auth.uid()));
  end if;
  return case when v_old is distinct from p_storage_path then v_old end;
end;
$$;
revoke all on function public.renewal_study_plan_form_save(uuid, text, text) from public, anon;
grant execute on function public.renewal_study_plan_form_save(uuid, text, text) to authenticated;

-- Remove the template of one school (its scholars then use the default). Returns the path of the removed file so the website can delete it.
create or replace function public.renewal_study_plan_form_remove(p_school_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.has_staff_tag('forms_management') then raise exception 'Only Forms Management staff can set the study plan forms.'; end if;
  delete from public.renewal_study_plan_forms where school_id is not distinct from p_school_id returning storage_path into v_old;
  return v_old;
end;
$$;
revoke all on function public.renewal_study_plan_form_remove(uuid) from public, anon;
grant execute on function public.renewal_study_plan_form_remove(uuid) to authenticated;

-- The scholar's own study plan template: their school's, else the default; nothing when none was uploaded. download_name is the tidy file name
-- the scholar's download gets, e.g. "Study Plan Form - Example University.pdf".
create or replace function public.renewal_my_study_plan_form()
returns table(storage_path text, download_name text, title text, is_default boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_name text;
begin
  if public.current_scholar_id_number() is null then raise exception 'Not signed in as a scholar.'; end if;
  select s.school_id into v_school from public.scholars s where s.id = auth.uid();
  select sc.name into v_name from public.schools sc where sc.id = v_school;
  return query
  select f.storage_path,
         'Study Plan Form' || case when f.school_id is null or v_name is null then '' else ' - ' || btrim(regexp_replace(v_name, '[\\/:*?"<>|]+', ' ', 'g')) end
           || coalesce(substring(f.storage_path from '\.[A-Za-z0-9]+$'), ''),
         'Study plan form' || case when f.school_id is null or v_name is null then '' else ' – ' || v_name end,
         f.school_id is null
  from public.renewal_study_plan_forms f
  where f.school_id = v_school or f.school_id is null
  order by (f.school_id is null)
  limit 1;
end;
$$;
revoke all on function public.renewal_my_study_plan_form() from public, anon;
grant execute on function public.renewal_my_study_plan_form() to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.counseling_slots where state <> 'open') as appointments_so_far,
       (select count(*) from public.renewal_study_plan_forms) as study_plan_forms_chosen;
