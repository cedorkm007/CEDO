-- ─────────────────────────────────────────────────────────────
-- supabase_migration_financial_assistance.sql
--
-- New "Financial Assistance" tab under Scholarship Program Information —
-- monitors a separate population of scholars who never get a portal
-- account (pure monitoring/reporting, no login). Re-populated every
-- semester (a "Period" = Academic Year + Semester); each period's
-- application is an independent record — no cross-period identity
-- linking, matching the physical walk-in/People's-Day re-application
-- process each semester.
--
-- Gated by its OWN staff tag ("financial_assistance"), separate from
-- "scholarship_program_info" — its own dedicated is_financial_assistance_
-- staff() helper checks that exact tag, deliberately NOT reusing
-- is_sead_staff() (which actually means "has the scholar_management tag"
-- — see supabase_migration_fix_tag_gate_round2.sql for the bug that
-- naming trap caused elsewhere in this app).
--
-- Reference-number/QR generation mirrors generate_attendance_codes'
-- exact shape (supabase_migration_formation_attendance_bulk_rpc.sql):
-- 7-char code from the same ambiguity-free alphabet, unique constraint +
-- ON CONFLICT DO NOTHING retry loop.
--
-- get_financial_assistance_status() is the one deliberately public
-- (anon-grantable) RPC here — an applicant never gets an account, so the
-- QR code they scan must work with no session at all. It is a narrow,
-- single-reference-number-keyed lookup (mirrors redeem_attendance_code's
-- "scoped RPC, not open table access" shape) — never a public SELECT
-- policy on the table, which would expose every applicant's full record
-- to anyone.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_financial_assistance_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key = 'financial_assistance'
  );
$$;
grant execute on function public.is_financial_assistance_staff() to authenticated;

create table if not exists public.financial_assistance_periods (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  semester text not null check (semester in ('1st Semester', '2nd Semester', 'Summer')),
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (academic_year, semester)
);

create table if not exists public.financial_assistance_applicants (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.financial_assistance_periods(id) on delete cascade,
  reference_number text not null unique,
  name text not null,
  barangay text,
  school text,
  program text,
  year_level text,
  vulnerable_sector text,
  mode_of_application text not null check (mode_of_application in ('Walk-in', 'People''s Day')),
  father_name text,
  mother_name text,
  status text not null default 'processing' check (status in ('processing', 'approved')),
  applied_at timestamptz not null default now(),
  approved_at timestamptz,
  guarantee_letter_generated_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_financial_assistance_applicants_period on public.financial_assistance_applicants(period_id);
create index if not exists idx_financial_assistance_applicants_reference on public.financial_assistance_applicants(reference_number);

create table if not exists public.financial_assistance_settings (
  id boolean primary key default true check (id),
  approved_instructions text not null default 'Please visit the CEDO office to claim your guarantee letter.'
);
insert into public.financial_assistance_settings (id) values (true) on conflict do nothing;

-- ── Row Level Security ──────────────────────────────────────

alter table public.financial_assistance_periods enable row level security;
alter table public.financial_assistance_applicants enable row level security;
alter table public.financial_assistance_settings enable row level security;

drop policy if exists "financial assistance staff read periods" on public.financial_assistance_periods;
drop policy if exists "financial assistance staff write periods" on public.financial_assistance_periods;
drop policy if exists "financial assistance staff update periods" on public.financial_assistance_periods;
drop policy if exists "financial assistance staff delete periods" on public.financial_assistance_periods;
create policy "financial assistance staff read periods" on public.financial_assistance_periods for select using (public.is_financial_assistance_staff());
create policy "financial assistance staff write periods" on public.financial_assistance_periods for insert with check (public.is_financial_assistance_staff());
create policy "financial assistance staff update periods" on public.financial_assistance_periods for update using (public.is_financial_assistance_staff()) with check (public.is_financial_assistance_staff());
create policy "financial assistance staff delete periods" on public.financial_assistance_periods for delete using (public.is_financial_assistance_staff());

drop policy if exists "financial assistance staff read applicants" on public.financial_assistance_applicants;
drop policy if exists "financial assistance staff write applicants" on public.financial_assistance_applicants;
drop policy if exists "financial assistance staff update applicants" on public.financial_assistance_applicants;
drop policy if exists "financial assistance staff delete applicants" on public.financial_assistance_applicants;
create policy "financial assistance staff read applicants" on public.financial_assistance_applicants for select using (public.is_financial_assistance_staff());
create policy "financial assistance staff write applicants" on public.financial_assistance_applicants for insert with check (public.is_financial_assistance_staff());
create policy "financial assistance staff update applicants" on public.financial_assistance_applicants for update using (public.is_financial_assistance_staff()) with check (public.is_financial_assistance_staff());
create policy "financial assistance staff delete applicants" on public.financial_assistance_applicants for delete using (public.is_financial_assistance_staff());

drop policy if exists "financial assistance staff read settings" on public.financial_assistance_settings;
drop policy if exists "financial assistance staff update settings" on public.financial_assistance_settings;
create policy "financial assistance staff read settings" on public.financial_assistance_settings for select using (public.is_financial_assistance_staff());
create policy "financial assistance staff update settings" on public.financial_assistance_settings for update using (public.is_financial_assistance_staff()) with check (public.is_financial_assistance_staff());

-- ── Period management ────────────────────────────────────────

create or replace function public.create_financial_assistance_period(p_academic_year text, p_semester text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_financial_assistance_staff() then
    raise exception 'Not authorized to manage Financial Assistance.';
  end if;
  if p_academic_year is null or trim(p_academic_year) = '' then
    raise exception 'Academic year is required.';
  end if;
  if p_semester not in ('1st Semester', '2nd Semester', 'Summer') then
    raise exception 'Invalid semester.';
  end if;

  insert into public.financial_assistance_periods (academic_year, semester, created_by)
    values (trim(p_academic_year), p_semester, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_financial_assistance_period(text, text) from public;
grant execute on function public.create_financial_assistance_period(text, text) to authenticated;

-- ── Reference number generation + applicant creation ────────

create or replace function public.generate_financial_assistance_reference()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- excludes 0/O, 1/I/L — matches attendance_codes' alphabet
  v_code text;
  v_round integer := 0;
  v_max_rounds integer := 50;
begin
  loop
    v_round := v_round + 1;
    select string_agg(substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1), '')
      into v_code
      from generate_series(1, 7);
    exit when not exists (select 1 from public.financial_assistance_applicants where reference_number = v_code);
    if v_round >= v_max_rounds then
      raise exception 'Could not generate a unique reference number after % attempts — please try again.', v_max_rounds;
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.generate_financial_assistance_reference() from public;

create or replace function public.create_financial_assistance_applicant(
  p_period_id uuid, p_name text, p_barangay text, p_school text, p_program text, p_year_level text,
  p_vulnerable_sector text, p_mode_of_application text, p_father_name text, p_mother_name text
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
    vulnerable_sector, mode_of_application, father_name, mother_name, created_by
  ) values (
    p_period_id, v_reference, trim(p_name), p_barangay, p_school, p_program, p_year_level,
    p_vulnerable_sector, p_mode_of_application, p_father_name, p_mother_name, auth.uid()
  ) returning financial_assistance_applicants.id into v_id;

  return query select v_id, v_reference;
end;
$$;
revoke all on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_financial_assistance_applicant(uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- ── Approve / status toggle ──────────────────────────────────

create or replace function public.set_financial_assistance_applicant_status(p_applicant_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_financial_assistance_staff() then
    raise exception 'Not authorized to manage Financial Assistance.';
  end if;
  if p_status not in ('processing', 'approved') then
    raise exception 'Invalid status.';
  end if;

  update public.financial_assistance_applicants
    set status = p_status,
        approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else null end,
        updated_at = now()
    where id = p_applicant_id;
end;
$$;
revoke all on function public.set_financial_assistance_applicant_status(uuid, text) from public;
grant execute on function public.set_financial_assistance_applicant_status(uuid, text) to authenticated;

-- ── Public (anon) status-check RPC ───────────────────────────

create or replace function public.get_financial_assistance_status(p_reference_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applicant public.financial_assistance_applicants%rowtype;
  v_instructions text;
begin
  select * into v_applicant from public.financial_assistance_applicants
    where reference_number = upper(trim(p_reference_number));
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select approved_instructions into v_instructions from public.financial_assistance_settings where id = true;

  return jsonb_build_object(
    'found', true,
    'name', v_applicant.name,
    'appliedAt', v_applicant.applied_at,
    'status', v_applicant.status,
    'approvedInstructions', case when v_applicant.status = 'approved' then v_instructions else null end
  );
end;
$$;
revoke all on function public.get_financial_assistance_status(text) from public;
grant execute on function public.get_financial_assistance_status(text) to anon, authenticated;

-- ── Approved-instructions settings read/write ────────────────

create or replace function public.set_financial_assistance_approved_instructions(p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_financial_assistance_staff() then
    raise exception 'Not authorized to manage Financial Assistance.';
  end if;
  if p_text is null or trim(p_text) = '' then
    raise exception 'Instructions text cannot be empty.';
  end if;
  update public.financial_assistance_settings set approved_instructions = trim(p_text) where id = true;
end;
$$;
revoke all on function public.set_financial_assistance_approved_instructions(text) from public;
grant execute on function public.set_financial_assistance_approved_instructions(text) to authenticated;
