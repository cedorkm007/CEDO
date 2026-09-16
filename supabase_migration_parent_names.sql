-- ─────────────────────────────────────────────────────────────
-- supabase_migration_parent_names.sql
--
-- Adds Father's/Mother's Complete Name to Mainstream Scholars (new —
-- scholars never had these columns before), and reshapes Financial
-- Assistance's existing father_name/mother_name (freeform text, no
-- format ever specified) into the same three-part shape: First Name /
-- Middle Initial / Last Name, stored as separate columns on both
-- tables rather than one combined string — mirrors the existing
-- address breakdown (house_unit_no/street/barangay/...) already used
-- for scholars instead of one "Address" field.
--
-- financial_assistance_applicants currently has 0 rows (confirmed via
-- direct query before writing this migration), so father_name/
-- mother_name are dropped outright rather than kept alongside the new
-- columns — nothing to migrate.
--
-- Also adds check_financial_assistance_sibling_match(): siblings of
-- Mainstream Scholars are not eligible for Financial Assistance, so
-- this lets the Add Applicant form check a typed-in father's/mother's
-- name against every Mainstream Scholar's own parent names. A match on
-- EITHER parent (not necessarily both) flags a possible sibling —
-- matching is case-insensitive/trimmed but otherwise exact across all
-- three name parts, so a blank field never accidentally matches a
-- blank field on both sides unless a first AND last name are actually
-- present on the applicant's side.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholars
  add column if not exists father_first_name text,
  add column if not exists father_middle_initial text,
  add column if not exists father_last_name text,
  add column if not exists mother_first_name text,
  add column if not exists mother_middle_initial text,
  add column if not exists mother_last_name text;

alter table public.financial_assistance_applicants
  drop column if exists father_name,
  drop column if exists mother_name,
  add column if not exists father_first_name text,
  add column if not exists father_middle_initial text,
  add column if not exists father_last_name text,
  add column if not exists mother_first_name text,
  add column if not exists mother_middle_initial text,
  add column if not exists mother_last_name text;

-- ── create_financial_assistance_applicant: father/mother params reshaped ──
-- Argument count/shape changed (2 text params -> 6), so the old overload
-- must be dropped explicitly rather than relying on `create or replace`,
-- which only replaces a function with an IDENTICAL argument signature —
-- otherwise the old 10-arg version would keep existing unused alongside
-- the new 14-arg one.
drop function if exists public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text);

create or replace function public.create_financial_assistance_applicant(
  p_period_id uuid, p_name text, p_barangay text, p_school text, p_program text, p_year_level text,
  p_vulnerable_sector text, p_mode_of_application text,
  p_father_first_name text, p_father_middle_initial text, p_father_last_name text,
  p_mother_first_name text, p_mother_middle_initial text, p_mother_last_name text
)
returns table (id uuid, reference_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reference text;
begin
  if not public.is_financial_assistance_staff() then
    raise exception 'Not authorized to manage Financial Assistance.';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'Name is required.';
  end if;
  if p_mode_of_application not in ('Walk-in', 'People''s Day') then
    raise exception 'Invalid mode of application.';
  end if;
  -- Unqualified "id" here would be ambiguous: this function's own
  -- `returns table (id uuid, ...)` implicitly declares an "id" variable
  -- visible through the whole body, colliding with the table's own id
  -- column — must always qualify it.
  if not exists (select 1 from public.financial_assistance_periods p where p.id = p_period_id) then
    raise exception 'Period not found.';
  end if;

  v_reference := public.generate_financial_assistance_reference();

  insert into public.financial_assistance_applicants (
    period_id, reference_number, name, barangay, school, program, year_level,
    vulnerable_sector, mode_of_application,
    father_first_name, father_middle_initial, father_last_name,
    mother_first_name, mother_middle_initial, mother_last_name,
    created_by
  ) values (
    p_period_id, v_reference, trim(p_name), p_barangay, p_school, p_program, p_year_level,
    p_vulnerable_sector, p_mode_of_application,
    p_father_first_name, p_father_middle_initial, p_father_last_name,
    p_mother_first_name, p_mother_middle_initial, p_mother_last_name,
    auth.uid()
  ) returning financial_assistance_applicants.id into v_id;

  return query select v_id, v_reference;
end;
$$;
revoke all on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ── Sibling check ─────────────────────────────────────────────
-- Gated the same as every other Financial Assistance write RPC
-- (is_financial_assistance_staff()) — this is only ever called from the
-- Add/Edit Applicant form inside Financial Assistance Tools.

create or replace function public.check_financial_assistance_sibling_match(
  p_father_first_name text, p_father_middle_initial text, p_father_last_name text,
  p_mother_first_name text, p_mother_middle_initial text, p_mother_last_name text
)
returns table (scholar_id uuid, scholar_id_number text, scholar_name text, matched_parent text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_financial_assistance_staff() then
    raise exception 'Not authorized to check Financial Assistance applicants.';
  end if;

  return query
  select s.id, s.scholar_id_number, trim(s.first_name || ' ' || s.last_name), 'father'::text
  from public.scholars s
  where trim(coalesce(p_father_first_name, '')) <> '' and trim(coalesce(p_father_last_name, '')) <> ''
    and lower(trim(s.father_first_name)) = lower(trim(p_father_first_name))
    and lower(trim(coalesce(s.father_middle_initial, ''))) = lower(trim(coalesce(p_father_middle_initial, '')))
    and lower(trim(s.father_last_name)) = lower(trim(p_father_last_name))

  union all

  select s.id, s.scholar_id_number, trim(s.first_name || ' ' || s.last_name), 'mother'::text
  from public.scholars s
  where trim(coalesce(p_mother_first_name, '')) <> '' and trim(coalesce(p_mother_last_name, '')) <> ''
    and lower(trim(s.mother_first_name)) = lower(trim(p_mother_first_name))
    and lower(trim(coalesce(s.mother_middle_initial, ''))) = lower(trim(coalesce(p_mother_middle_initial, '')))
    and lower(trim(s.mother_last_name)) = lower(trim(p_mother_last_name))

  limit 10;
end;
$$;
revoke all on function public.check_financial_assistance_sibling_match(text, text, text, text, text, text) from public;
grant execute on function public.check_financial_assistance_sibling_match(text, text, text, text, text, text) to authenticated;
