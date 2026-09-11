-- ─────────────────────────────────────────────────────────────
-- supabase_migration_research_project_post_approval_stages.sql
--
-- Wires up the research project pipeline from Implementation onward.
-- Implementation, Monitoring, Dissemination, Utilization, Preservation,
-- and Institutional Learning were already valid `stage` values (see
-- supabase_migration_research_project_proposals.sql) but had no form and
-- nowhere further to advance to. This adds the missing terminal stage,
-- 'completed', and a private storage bucket for the evidence documents
-- researchers submit at each of those stages (PDF/DOC/DOCX/JPG/PNG).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── Add 'completed' to research_projects.current_stage ──

alter table public.research_projects drop constraint if exists research_projects_current_stage_check;
alter table public.research_projects add constraint research_projects_current_stage_check
  check (current_stage in (
    'concept', 'proposal_development', 'review', 'approval', 'implementation',
    'monitoring', 'dissemination', 'utilization', 'preservation', 'institutional_learning', 'completed'
  ));

-- ── advance_project_stage: allow 'completed' as a next stage ──

create or replace function public.advance_project_stage(p_project_id uuid, p_next_stage text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_research_monitoring_staff() then
    raise exception 'Not authorized.';
  end if;
  if p_next_stage not in (
    'concept', 'proposal_development', 'review', 'approval', 'implementation',
    'monitoring', 'dissemination', 'utilization', 'preservation', 'institutional_learning', 'completed'
  ) then
    raise exception 'Invalid stage.';
  end if;

  update public.research_projects set current_stage = p_next_stage, updated_at = now() where id = p_project_id;
  if not found then raise exception 'Project not found.'; end if;

  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.advance_project_stage(uuid, text) to authenticated;

-- ── Private storage bucket for post-approval evidence documents ──
-- Path convention: "{project_id}/{stage}/{evidence_id}.{ext}" — RLS below
-- checks the leading path segment against research_projects.created_by,
-- same convention used by the subject-certificates bucket.

insert into storage.buckets (id, name, public)
values ('research-project-evidence', 'research-project-evidence', false)
on conflict (id) do nothing;

drop policy if exists "researcher manages own evidence" on storage.objects;
create policy "researcher manages own evidence" on storage.objects
  for all using (
    bucket_id = 'research-project-evidence'
    and exists (
      select 1 from public.research_projects p
      where p.id::text = split_part(storage.objects.name, '/', 1) and p.created_by = auth.uid()
    )
  )
  with check (
    bucket_id = 'research-project-evidence'
    and exists (
      select 1 from public.research_projects p
      where p.id::text = split_part(storage.objects.name, '/', 1) and p.created_by = auth.uid()
    )
  );

drop policy if exists "evaluator reads evidence" on storage.objects;
create policy "evaluator reads evidence" on storage.objects
  for select using (bucket_id = 'research-project-evidence' and public.is_research_monitoring_staff());
