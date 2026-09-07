-- ─────────────────────────────────────────────────────────────
-- supabase_migration_research_project_proposals.sql
--
-- Phase D.1: the research proposal workflow's core schema. A staff
-- researcher submits a project starting at the Concept stage; it then
-- moves through Proposal Development, Review, Approval, Implementation,
-- Monitoring, Dissemination, Utilization, Preservation, and Institutional
-- Learning. Only Concept and Proposal Development have defined forms so
-- far — research_project_stage_submissions is deliberately generic
-- (form_data jsonb) so later stages can reuse it without a schema change
-- once their forms are specified.
--
-- Evaluator = an account tagged "research_project_monitoring" (reuses
-- is_research_monitoring_staff() from supabase_migration_research_
-- project_monitoring.sql, Phase B) — same tag that already gates the
-- Research Project Monitoring tab's Survey Tools/Results.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  research_agenda text not null check (research_agenda in (
    -- Internal
    'CEDO strategic priorities',
    'Monitoring and evaluation findings',
    'Administrative and operational concerns',
    'Program implementation challenges',
    'Education statistics and stakeholder feedback',
    'Graduate studies and staff initiatives',
    -- External
    'Community needs and emerging issues',
    'National and regional education priorities',
    'Legislative and policy developments',
    'Academic and research institutions',
    'Development partners and funding organizations',
    'Industry and workforce trends',
    'Global and Sustainable Development Goals (SDG) commitments'
  )),
  agenda_type text not null check (agenda_type in ('internal', 'external')),
  leader_name text not null,
  members jsonb not null default '[]',
  stakeholders text not null default '',
  rationale text not null default '',
  significance text not null default '',
  expected_outcomes_summary text not null default '',
  current_stage text not null default 'concept' check (current_stage in (
    'concept', 'proposal_development', 'review', 'approval', 'implementation',
    'monitoring', 'dissemination', 'utilization', 'preservation', 'institutional_learning'
  )),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_research_projects_created_by on public.research_projects(created_by);

create table if not exists public.research_project_stage_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects(id) on delete cascade,
  stage text not null check (stage in (
    'concept', 'proposal_development', 'review', 'approval', 'implementation',
    'monitoring', 'dissemination', 'utilization', 'preservation', 'institutional_learning'
  )),
  form_data jsonb not null default '{}',
  status text not null default 'under_review' check (status in ('under_review', 'returned', 'approved')),
  evaluator_comment text not null default '',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stage)
);
create index if not exists idx_research_stage_submissions_project on public.research_project_stage_submissions(project_id);

alter table public.research_projects enable row level security;
alter table public.research_project_stage_submissions enable row level security;

drop policy if exists "researcher manages own projects" on public.research_projects;
create policy "researcher manages own projects" on public.research_projects for all
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "researcher manages own submissions" on public.research_project_stage_submissions;
create policy "researcher manages own submissions" on public.research_project_stage_submissions for all
  using (exists (select 1 from public.research_projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.research_projects p where p.id = project_id and p.created_by = auth.uid()));

drop policy if exists "evaluator reads all projects" on public.research_projects;
create policy "evaluator reads all projects" on public.research_projects for select using (public.is_research_monitoring_staff());

drop policy if exists "evaluator reads all submissions" on public.research_project_stage_submissions;
create policy "evaluator reads all submissions" on public.research_project_stage_submissions for select using (public.is_research_monitoring_staff());

drop policy if exists "evaluator reviews submissions" on public.research_project_stage_submissions;
create policy "evaluator reviews submissions" on public.research_project_stage_submissions for update
  using (public.is_research_monitoring_staff()) with check (public.is_research_monitoring_staff());

-- Advances a project's stage on evaluator approval — kept as an RPC
-- (rather than a direct evaluator UPDATE policy on research_projects)
-- so a later phase can add side effects (e.g. a notification) in one
-- place without touching the review UI.
create or replace function public.advance_project_stage(p_project_id uuid, p_next_stage text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_research_monitoring_staff() then
    raise exception 'Not authorized.';
  end if;
  if p_next_stage not in (
    'concept', 'proposal_development', 'review', 'approval', 'implementation',
    'monitoring', 'dissemination', 'utilization', 'preservation', 'institutional_learning'
  ) then
    raise exception 'Invalid stage.';
  end if;

  update public.research_projects set current_stage = p_next_stage, updated_at = now() where id = p_project_id;
  if not found then raise exception 'Project not found.'; end if;

  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.advance_project_stage(uuid, text) to authenticated;
