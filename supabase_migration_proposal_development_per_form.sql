-- ─────────────────────────────────────────────────────────────
-- supabase_migration_proposal_development_per_form.sql
--
-- Splits the Proposal Development stage's single combined submission
-- into its 6 existing wizard steps (Statement of the Problem,
-- Objectives, Methodology, Work Plan, Budget, Expected Outputs/
-- Outcomes) as independently gated forms: the researcher submits one,
-- the evaluator approves or returns just that one, and only once it's
-- approved does the next form become available. The project only
-- advances out of Proposal Development once every one of the 6 forms
-- is approved.
--
-- Concept keeps its existing single-form behavior unchanged — it just
-- gets form_key = 'main', the only key that stage ever uses.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.research_project_stage_submissions add column if not exists form_key text not null default 'main';

alter table public.research_project_stage_submissions drop constraint if exists research_project_stage_submissions_project_id_stage_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'research_project_stage_submissions_project_id_stage_form_key') then
    alter table public.research_project_stage_submissions add constraint research_project_stage_submissions_project_id_stage_form_key
      unique (project_id, stage, form_key);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'research_project_stage_submissions_form_key_check') then
    alter table public.research_project_stage_submissions add constraint research_project_stage_submissions_form_key_check
      check (form_key in ('main', 'statement', 'objectives', 'methodology', 'workPlan', 'budget', 'outputs'));
  end if;
end $$;
