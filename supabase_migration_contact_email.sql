-- ─────────────────────────────────────────────────────────────
-- supabase_migration_contact_email.sql
--
-- Adds a real, reachable email address to Mainstream Scholars and
-- Financial Assistance applicants — the first step toward a future
-- bulk-email feature. Named "contact_email" (not "email") on
-- `scholars` specifically because that table already has an `email`
-- column, and it is NOT a real mailbox — it's a synthetic
-- "{scholar_id_number}@scholars.cedo.local" placeholder that exists
-- only so Supabase Auth has an email-shaped field to key a scholar's
-- login on (confirmed live: every one of the 7,135 existing rows has
-- this placeholder form). Reusing that column for real mail would
-- either break login or silently never deliver anything. financial_
-- assistance_applicants has no existing "email" column at all, but
-- contact_email is used there too for naming parity across both
-- tables, since a future bulk-email feature will want to treat both
-- audiences uniformly.
--
-- Optional/free-text — no format constraint at the DB level, matching
-- how contact_no (phone) already has none; the UI applies a light
-- type="email" input hint only.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholars
  add column if not exists contact_email text;

alter table public.financial_assistance_applicants
  add column if not exists contact_email text;

-- ── create_financial_assistance_applicant: gains p_contact_email ──
-- Argument count changed (14 -> 15), so the old overload must be
-- dropped explicitly rather than relying on `create or replace`
-- (which only replaces a function with an IDENTICAL signature) — same
-- reasoning as supabase_migration_parent_names.sql's own version of
-- this same function.
drop function if exists public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text);

create or replace function public.create_financial_assistance_applicant(
  p_period_id uuid, p_name text, p_barangay text, p_school text, p_program text, p_year_level text,
  p_vulnerable_sector text, p_mode_of_application text,
  p_father_first_name text, p_father_middle_initial text, p_father_last_name text,
  p_mother_first_name text, p_mother_middle_initial text, p_mother_last_name text,
  p_contact_email text
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
  -- visible through the whole function body, colliding with the table's
  -- own id column — must always qualify it.
  if not exists (select 1 from public.financial_assistance_periods p where p.id = p_period_id) then
    raise exception 'Period not found.';
  end if;

  v_reference := public.generate_financial_assistance_reference();

  insert into public.financial_assistance_applicants (
    period_id, reference_number, name, barangay, school, program, year_level,
    vulnerable_sector, mode_of_application,
    father_first_name, father_middle_initial, father_last_name,
    mother_first_name, mother_middle_initial, mother_last_name,
    contact_email, created_by
  ) values (
    p_period_id, v_reference, trim(p_name), p_barangay, p_school, p_program, p_year_level,
    p_vulnerable_sector, p_mode_of_application,
    p_father_first_name, p_father_middle_initial, p_father_last_name,
    p_mother_first_name, p_mother_middle_initial, p_mother_last_name,
    p_contact_email, auth.uid()
  ) returning financial_assistance_applicants.id into v_id;

  return query select v_id, v_reference;
end;
$$;
revoke all on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
