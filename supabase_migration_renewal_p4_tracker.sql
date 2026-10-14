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
-- The blank forms are added in Forms Management as usual. This table says which one is the STUDY PLAN form of which school (and, with
-- school_id empty, which one is used for every school that has none of its own). The Renewal tile then shows each scholar THEIR school's form.
create table if not exists public.renewal_study_plan_forms (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references public.schools(id) on delete cascade,      -- null = the default for schools without their own
  material_id uuid not null references public.form_materials(id) on delete cascade,
  set_by      uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index if not exists renewal_study_plan_forms_school_uq on public.renewal_study_plan_forms (school_id) where school_id is not null;
create unique index if not exists renewal_study_plan_forms_default_uq on public.renewal_study_plan_forms ((true)) where school_id is null;
alter table public.renewal_study_plan_forms enable row level security;
drop policy if exists "forms staff read study plan forms" on public.renewal_study_plan_forms;
create policy "forms staff read study plan forms" on public.renewal_study_plan_forms for select using (public.has_staff_tag('forms_management'));
-- No write policy: choices are saved through renewal_study_plan_form_set().

-- Staff (Forms Management tag): the schools and what is chosen for each.
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
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('school_id', f.school_id, 'material_id', f.material_id)) from public.renewal_study_plan_forms f), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_study_plan_form_setup() from public, anon;
grant execute on function public.renewal_study_plan_form_setup() to authenticated;

-- Choose (or, with p_material_id null, clear) the study plan form of one school; p_school_id null = the default for all other schools.
create or replace function public.renewal_study_plan_form_set(p_school_id uuid, p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('forms_management') then raise exception 'Only Forms Management staff can set the study plan forms.'; end if;
  if p_school_id is not null and not exists (select 1 from public.schools s where s.id = p_school_id) then raise exception 'That school was not found.'; end if;
  if p_material_id is null then
    delete from public.renewal_study_plan_forms where school_id is not distinct from p_school_id;
    return;
  end if;
  if not exists (select 1 from public.form_materials m where m.id = p_material_id) then raise exception 'That form was not found.'; end if;
  if exists (select 1 from public.renewal_study_plan_forms f where f.school_id is not distinct from p_school_id) then
    update public.renewal_study_plan_forms set material_id = p_material_id, set_by = (select u.id from public.users u where u.id = auth.uid()), updated_at = now()
    where school_id is not distinct from p_school_id;
  else
    insert into public.renewal_study_plan_forms (school_id, material_id, set_by) values (p_school_id, p_material_id, (select u.id from public.users u where u.id = auth.uid()));
  end if;
end;
$$;
revoke all on function public.renewal_study_plan_form_set(uuid, uuid) from public, anon;
grant execute on function public.renewal_study_plan_form_set(uuid, uuid) to authenticated;

-- The scholar's own study plan form: their school's, else the default; nothing when none is chosen.
create or replace function public.renewal_my_study_plan_form()
returns table(material_id uuid, title text, kind text, url text, file_name text, is_default boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid;
begin
  if public.current_scholar_id_number() is null then raise exception 'Not signed in as a scholar.'; end if;
  select s.school_id into v_school from public.scholars s where s.id = auth.uid();
  return query
  select m.id, m.title, m.kind, m.url, m.file_name, f.school_id is null
  from public.renewal_study_plan_forms f
  join public.form_materials m on m.id = f.material_id
  where f.school_id = v_school or f.school_id is null
  order by (f.school_id is null)
  limit 1;
end;
$$;
revoke all on function public.renewal_my_study_plan_form() from public, anon;
grant execute on function public.renewal_my_study_plan_form() to authenticated;

-- The file itself: a scholar may download the study plan form chosen for their school (or the default), even when it carries no other unlock
-- condition. (Other storage rules for form materials are unchanged.)
-- Scholars cannot read the choices table directly, so the storage rule asks this small function: "is this THE study plan form of my school?"
create or replace function public.renewal_is_my_study_plan_form(p_material text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Never raises (it runs for staff and anonymous reads of storage too): a non-scholar simply gets false.
  select exists (
    select 1
    from public.scholars sc
    join public.renewal_study_plan_forms f on f.school_id = sc.school_id
      or (f.school_id is null and not exists (select 1 from public.renewal_study_plan_forms own where own.school_id = sc.school_id))
    where sc.id = auth.uid() and f.material_id::text = p_material
  );
$$;
revoke all on function public.renewal_is_my_study_plan_form(text) from public, anon;
grant execute on function public.renewal_is_my_study_plan_form(text) to authenticated;

drop policy if exists "scholar downloads renewal study plan form" on storage.objects;
create policy "scholar downloads renewal study plan form" on storage.objects for select
  using (
    bucket_id = 'form-materials'
    and public.renewal_is_my_study_plan_form(split_part(storage.objects.name, '/', 1))
  );

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.counseling_slots where state <> 'open') as appointments_so_far,
       (select count(*) from public.renewal_study_plan_forms) as study_plan_forms_chosen;
