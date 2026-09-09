-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_credits.sql
--
-- Scholars now need to accumulate 3 credits within an SDP category to
-- complete it (previously: any single credited attendance in that
-- category counted as complete). Each activity is worth a staff-set
-- number of credits per attendance, so a bigger activity can be worth
-- more than a smaller one.
--
-- NOTE: scholar_sdp_category_status is a real TABLE kept in sync by
-- the recompute_sdp_category_status() trigger on sdp_attendance
-- (created directly against the live DB at some point — no checked-in
-- migration defines it; confirmed by reading pg_trigger/pg_proc
-- directly). This migration updates that trigger function's formula
-- rather than the view supabase_migration_sdp_checklist_and_rankings.sql
-- originally created, which no longer reflects live schema.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.sdp_activities add column if not exists credits integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sdp_activities_credits_check') then
    alter table public.sdp_activities add constraint sdp_activities_credits_check check (credits > 0);
  end if;
end $$;

-- Same trigger shape as the live recompute_sdp_category_status(), with
-- the exists()-based "at least one attendance" check replaced by a
-- sum(credits) >= 3 threshold.
create or replace function public.recompute_sdp_category_status()
returns trigger
language plpgsql
security definer
as $function$
declare
  target_scholar text := coalesce(new.scholar_id_number, old.scholar_id_number);
  target_category text;
  total_credits integer;
begin
  select category into target_category from public.sdp_activities
    where id = coalesce(new.activity_id, old.activity_id);

  if target_category is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(act.credits), 0) into total_credits
    from public.sdp_attendance a
    join public.sdp_activities act on act.id = a.activity_id
    where a.scholar_id_number = target_scholar and act.category = target_category;

  insert into public.scholar_sdp_category_status (scholar_id_number, category, completed, updated_at)
  values (target_scholar, target_category, total_credits >= 3, now())
  on conflict (scholar_id_number, category)
  do update set completed = excluded.completed, updated_at = now();

  return coalesce(new, old);
end;
$function$;

-- Credits can be corrected on an activity after scholars have already
-- been credited for it — recompute every affected scholar's status for
-- that activity's category when credits changes (attendance-table
-- trigger above only fires on new/removed attendance, not on this).
create or replace function public.recompute_sdp_category_status_for_activity()
returns trigger
language plpgsql
security definer
as $function$
declare
  affected_scholar text;
  total_credits integer;
begin
  if new.credits is not distinct from old.credits then
    return new;
  end if;
  for affected_scholar in
    select distinct a.scholar_id_number from public.sdp_attendance a where a.activity_id = new.id
  loop
    select coalesce(sum(act.credits), 0) into total_credits
      from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      where a.scholar_id_number = affected_scholar and act.category = new.category;

    insert into public.scholar_sdp_category_status (scholar_id_number, category, completed, updated_at)
    values (affected_scholar, new.category, total_credits >= 3, now())
    on conflict (scholar_id_number, category)
    do update set completed = excluded.completed, updated_at = now();
  end loop;
  return new;
end;
$function$;

drop trigger if exists trg_sdp_activities_credits_status on public.sdp_activities;
create trigger trg_sdp_activities_credits_status
  after update of credits on public.sdp_activities
  for each row execute function public.recompute_sdp_category_status_for_activity();

-- One-time backfill: recompute every existing row against the new
-- 3-credit threshold (the trigger only affects future attendance
-- changes going forward).
update public.scholar_sdp_category_status st
set completed = coalesce((
  select sum(act.credits) from public.sdp_attendance a
  join public.sdp_activities act on act.id = a.activity_id
  where a.scholar_id_number = st.scholar_id_number and act.category = st.category
), 0) >= 3,
updated_at = now();
