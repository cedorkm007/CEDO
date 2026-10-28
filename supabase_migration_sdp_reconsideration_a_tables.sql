-- ─────────────────────────────────────────────────────────────
-- SDP RECONSIDERATION, FILE A of 3: the two tables.   Safe to run twice.   Undo: undo_sdp_reconsideration_a.sql
-- Run this FIRST, on its own, then _b_sdp_rules.sql, then _c_renewal.sql.
--
-- A scholar who lacks SDP credits can ask, together with the renewal application, for an SDP RECONSIDERATION. An approver (it.admin1 or a person it.admin1 appoints)
-- approves or denies it. An approved request makes the scholar count as complied with the SDP for the semester the renewal looks at, and the credits that were lacking
-- are added to the requirement of the NEXT semester.
--   sdp_reconsideration_requests  one request per application (scholar + renewal term): what was lacking, who decided, when, and the decision note.
--   sdp_reconsideration_debts     the credits owed for a later semester because of an approved request, per category (the "added to next semester's requirement" part).
-- Both tables are locked: only the database functions of files B and C read or write them (a scholar may read only their own requests).
-- Creates two new tables; changes no existing table; deletes nothing.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sdp_reconsideration_requests (
  id                 uuid primary key default gen_random_uuid(),
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  school_year        text not null,                 -- the renewal term the scholar applied for
  term               text not null,
  record_id          uuid references public.renewal_records(id) on delete cascade,
  basis_school_year  text not null,                 -- the semester whose SDP the renewal looks at (the one that was lacking)
  basis_term         text not null,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'not_needed')),
  lacking            jsonb not null default '{}'::jsonb,   -- credits lacking per category when the request was made: {"community_service": 1, ...}
  requested_at       timestamptz not null default now(),
  decided_by         uuid references public.users(id) on delete set null,
  decided_by_label   text,
  decided_at         timestamptz,
  decision_note      text not null default '',
  unique (scholar_id_number, school_year, term)
);
create index if not exists sdp_reconsideration_requests_status_idx on public.sdp_reconsideration_requests (status, requested_at);
create index if not exists sdp_reconsideration_requests_basis_idx on public.sdp_reconsideration_requests (basis_school_year, basis_term) where status = 'approved';
alter table public.sdp_reconsideration_requests enable row level security;
revoke all on public.sdp_reconsideration_requests from public, anon, authenticated;
grant select on public.sdp_reconsideration_requests to authenticated;
drop policy if exists "scholars read their own sdp reconsideration requests" on public.sdp_reconsideration_requests;
create policy "scholars read their own sdp reconsideration requests" on public.sdp_reconsideration_requests for select to authenticated
  using (scholar_id_number = (select public.current_scholar_id_number()));

create table if not exists public.sdp_reconsideration_debts (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.sdp_reconsideration_requests(id) on delete cascade,
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  category           text not null check (category in ('community_service', 'community_volunteerism', 'formation_program')),
  amount             integer not null check (amount > 0),
  apply_school_year  text not null,                 -- the semester whose requirement grows by this amount (the one after the semester that was lacking)
  apply_semester     text not null,
  created_at         timestamptz not null default now(),
  unique (request_id, category)
);
create index if not exists sdp_reconsideration_debts_semester_idx on public.sdp_reconsideration_debts (apply_school_year, apply_semester, scholar_id_number);
alter table public.sdp_reconsideration_debts enable row level security;
revoke all on public.sdp_reconsideration_debts from public, anon, authenticated;     -- no policy: only the functions read it

notify pgrst, 'reload schema';
