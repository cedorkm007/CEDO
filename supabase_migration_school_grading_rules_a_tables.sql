-- ─────────────────────────────────────────────────────────────
-- SCHOOL GRADING RULES, FILE A of 2 (Phase 1): the new tables.   Safe to run twice.   Undo: undo_school_grading_rules_a.sql
-- Run BEFORE supabase_migration_school_grading_rules_c_functions.sql.
--
-- A school's grading rules are saved as numbered VERSIONS. Each version starts at a school year and semester and is never changed afterwards, so changing the rules later can never
-- change a past period. A version holds: how grades are entered, the school's passing mark in percent (and the programs that have their own), the conversion table (the "bands"),
-- and the GWA settings. Every save is also written to an audit table (who, when, old and new rules, how many grades and GWAs the change affected).
--
-- This file ONLY ADDS three new tables. No existing table, grade, setting or scale is touched. Nothing is deleted.
-- The tables cannot be reached from the website at all (no access rule, no grant); only the functions of file C read and write them, and those check who is asking.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.school_grading_versions (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools(id) on delete cascade,
  version_no            integer not null check (version_no >= 1),
  -- the semester this version starts at (a period that may not exist yet, so the year and the term are kept as text)
  effective_year        text not null check (btrim(effective_year) <> ''),
  effective_term        text not null check (effective_term in ('1st Semester', '2nd Semester', 'Summer')),
  entry_mode            text not null default 'grade' check (entry_mode in ('grade', 'percentage', 'either')),
  -- the school's passing mark in PERCENT when it has a conversion table; programs with their own: [{"program": "...", "passingPct": 70}]
  passing_mark_pct      numeric(5,2) check (passing_mark_pct is null or (passing_mark_pct > 0 and passing_mark_pct <= 100)),
  program_passing_marks jsonb not null default '[]'::jsonb,
  gwa_method            text not null default 'weighted' check (gwa_method in ('weighted', 'simple')),
  gwa_grade_used        text not null default 'equivalent' check (gwa_grade_used in ('equivalent', 'percentage')),
  gwa_decimals          integer not null default 2 check (gwa_decimals in (2, 3, 4)),
  gwa_rounding          text not null default 'round' check (gwa_rounding in ('round', 'cut')),
  gwa_include_failed    boolean not null default true,
  -- special marks that count as a number in the GWA, e.g. {"DRP": 5}
  gwa_special_values    jsonb not null default '{}'::jsonb,
  -- subject codes that are excluded from the GWA when a subject is first saved, e.g. {NSTP,PE}
  gwa_excluded_codes    text[] not null default '{}',
  -- the GWA a scholar must keep, on the scale of the GWA above (percent when the GWA uses percentages); empty = use the school's existing requirement
  retention_threshold   numeric,
  note                  text,
  created_by            uuid,
  created_by_label      text,
  created_at            timestamptz not null default now(),
  unique (school_id, version_no)
);
create index if not exists school_grading_versions_start_idx on public.school_grading_versions (school_id, effective_year, effective_term);

create table if not exists public.school_grade_bands (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references public.school_grading_versions(id) on delete cascade,
  sort_no          integer not null check (sort_no >= 1),      -- 1 = the highest percentage
  pct_from         numeric(5,2) not null check (pct_from >= 0 and pct_from <= 100),
  pct_to           numeric(5,2) not null check (pct_to >= 0 and pct_to <= 100),
  equivalent_grade text not null check (btrim(equivalent_grade) <> ''),
  -- the number the equivalent grade stands for (a letter's number is copied here when the version is saved, so a later change of the letter table cannot change this version)
  equivalent_value numeric not null,
  remarks          text not null check (btrim(remarks) <> ''),
  -- what the band means against the school's passing mark when it was saved
  result           text not null check (result in ('passed', 'failed')),
  check (pct_from <= pct_to),
  unique (version_id, sort_no)
);
create index if not exists school_grade_bands_version_idx on public.school_grade_bands (version_id);

create table if not exists public.school_grading_audit (
  id               bigint generated always as identity primary key,
  school_id        uuid not null references public.schools(id) on delete cascade,
  version_id       uuid not null references public.school_grading_versions(id) on delete cascade,
  changed_at       timestamptz not null default now(),
  changed_by       uuid,
  changed_by_label text,
  effective_year   text not null,
  effective_term   text not null,
  old_rules        jsonb,                 -- the rules before (null for the first save)
  new_rules        jsonb not null,
  impact           jsonb not null default '{}'::jsonb,       -- {"gradesChanged": n, "gwasChanged": n, "scholarsAffected": n, "period": "..."} as shown to the school before it confirmed
  note             text
);
create index if not exists school_grading_audit_school_idx on public.school_grading_audit (school_id, changed_at desc);

-- Nobody reaches these tables from the website. Only the functions of file C (which check who is asking) read and write them.
alter table public.school_grading_versions enable row level security;
alter table public.school_grade_bands enable row level security;
alter table public.school_grading_audit enable row level security;
revoke all on public.school_grading_versions from public, anon, authenticated;
revoke all on public.school_grade_bands from public, anon, authenticated;
revoke all on public.school_grading_audit from public, anon, authenticated;
