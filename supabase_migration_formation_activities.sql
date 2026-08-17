-- Formation activities shown to eligible scholars in Calendar and Activities.
create table if not exists public.formation_activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_description text not null default '',
  date_time timestamptz not null,
  venue text not null default '',
  target_year_levels text[] not null default '{}',
  all_year_levels boolean not null default false,
  attendance_enabled boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (all_year_levels or cardinality(target_year_levels) > 0)
);
create index if not exists idx_formation_activities_date on public.formation_activities (date_time);

alter table public.formation_activities enable row level security;

drop policy if exists "staff manage formation activities" on public.formation_activities;
create policy "staff manage formation activities" on public.formation_activities for all
  using (public.is_sead_staff()) with check (public.is_sead_staff());

drop policy if exists "scholars read eligible formation activities" on public.formation_activities;
create policy "scholars read eligible formation activities" on public.formation_activities for select
  using (
    all_year_levels or exists (
      select 1 from public.scholars
      where scholars.id = auth.uid() and scholars.year_level = any(formation_activities.target_year_levels)
    )
  );
