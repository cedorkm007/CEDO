-- ─────────────────────────────────────────────────────────────
-- SCHOOL LOGO: a school can upload its own logo in the School Portal.   Safe to run twice.   Undo: undo_school_logo.sql
--
-- The logo is the school's profile picture in the School Portal, and it is printed in the header of the pre-filled clearances (next to the CEDO logo).
-- This file ONLY ADDS one new table (one small picture per school) and three functions. No existing table, grade or account is touched. Nothing is deleted.
-- The table cannot be reached from the website at all (no access rule, no grant). Only the three functions read and write it, and they check who is asking:
-- a school account can see, change and remove ITS OWN logo and nobody else's. The picture is saved as a small PNG (the website shrinks it before sending).
-- ─────────────────────────────────────────────────────────────

create table if not exists public.school_logos (
  school_id    uuid primary key references public.schools(id) on delete cascade,
  image_base64 text not null check (length(image_base64) between 100 and 700000),
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
alter table public.school_logos enable row level security;
revoke all on public.school_logos from public, anon, authenticated;

-- The school's own logo (the PNG as text), or nothing when it has not uploaded one.
create or replace function public.school_get_logo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account has a logo.'; end if;
  return (select l.image_base64 from public.school_logos l where l.school_id = public.current_school_id());
end;
$$;
revoke all on function public.school_get_logo() from public, anon;
grant execute on function public.school_get_logo() to authenticated;

-- Saves (or replaces) the school's logo. It must be a PNG, as text, no bigger than about 500 KB.
create or replace function public.school_set_logo(p_image_base64 text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_at timestamptz := now();
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can set its logo.'; end if;
  if p_image_base64 is null or length(p_image_base64) < 100 then raise exception 'The logo is empty.'; end if;
  if length(p_image_base64) > 700000 then raise exception 'The logo is too big. Use a smaller picture.'; end if;
  if p_image_base64 !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'The logo is not a valid picture.'; end if;
  if left(p_image_base64, 11) <> 'iVBORw0KGgo' then raise exception 'The logo must be a PNG picture (the website converts it for you).'; end if;
  insert into public.school_logos (school_id, image_base64, updated_at, updated_by)
  values (public.current_school_id(), p_image_base64, v_at, auth.uid())
  on conflict (school_id) do update set image_base64 = excluded.image_base64, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return v_at;
end;
$$;
revoke all on function public.school_set_logo(text) from public, anon;
grant execute on function public.school_set_logo(text) to authenticated;

-- Removes the school's logo (the clearances then print without a school logo).
create or replace function public.school_remove_logo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can remove its logo.'; end if;
  delete from public.school_logos where school_id = public.current_school_id();
end;
$$;
revoke all on function public.school_remove_logo() from public, anon;
grant execute on function public.school_remove_logo() to authenticated;

notify pgrst, 'reload schema';
