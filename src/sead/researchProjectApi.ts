import { supabase } from "@/lib/supabase";

// ── Research Agenda taxonomy (matches the DB check constraint exactly) ──

export const INTERNAL_RESEARCH_AGENDAS = [
  "CEDO strategic priorities",
  "Monitoring and evaluation findings",
  "Administrative and operational concerns",
  "Program implementation challenges",
  "Education statistics and stakeholder feedback",
  "Graduate studies and staff initiatives",
] as const;

export const EXTERNAL_RESEARCH_AGENDAS = [
  "Community needs and emerging issues",
  "National and regional education priorities",
  "Legislative and policy developments",
  "Academic and research institutions",
  "Development partners and funding organizations",
  "Industry and workforce trends",
  "Global and Sustainable Development Goals (SDG) commitments",
] as const;

export type ResearchAgenda = (typeof INTERNAL_RESEARCH_AGENDAS)[number] | (typeof EXTERNAL_RESEARCH_AGENDAS)[number];
export type AgendaType = "internal" | "external";

export function agendaTypeFor(agenda: string): AgendaType {
  return (INTERNAL_RESEARCH_AGENDAS as readonly string[]).includes(agenda) ? "internal" : "external";
}

export const PROJECT_STAGES = [
  "concept", "proposal_development", "review", "approval", "implementation",
  "monitoring", "dissemination", "utilization", "preservation", "institutional_learning",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  concept: "Concept",
  proposal_development: "Proposal Development",
  review: "Review",
  approval: "Approval",
  implementation: "Implementation",
  monitoring: "Monitoring",
  dissemination: "Dissemination",
  utilization: "Utilization",
  preservation: "Preservation",
  institutional_learning: "Institutional Learning",
};

export type SubmissionStatus = "under_review" | "returned" | "approved";

/** Fixed, non-editable text per status — separate from the evaluator's own free-text comment. */
export const STATUS_REMARKS: Record<SubmissionStatus, string> = {
  under_review: "Evaluation ongoing",
  returned: "Proposal Revision",
  approved: "Move to next stage",
};

export interface ResearchProject {
  id: string;
  title: string;
  researchAgenda: string;
  agendaType: AgendaType;
  leaderName: string;
  members: string[];
  stakeholders: string;
  rationale: string;
  significance: string;
  expectedOutcomesSummary: string;
  currentStage: ProjectStage;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StageSubmission {
  id: string;
  projectId: string;
  stage: ProjectStage;
  formData: Record<string, unknown>;
  status: SubmissionStatus;
  evaluatorComment: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

function rowToProject(r: Record<string, unknown>): ResearchProject {
  return {
    id: r.id as string,
    title: r.title as string,
    researchAgenda: r.research_agenda as string,
    agendaType: r.agenda_type as AgendaType,
    leaderName: r.leader_name as string,
    members: (r.members as string[] | null) ?? [],
    stakeholders: (r.stakeholders as string) ?? "",
    rationale: (r.rationale as string) ?? "",
    significance: (r.significance as string) ?? "",
    expectedOutcomesSummary: (r.expected_outcomes_summary as string) ?? "",
    currentStage: r.current_stage as ProjectStage,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function rowToSubmission(r: Record<string, unknown>): StageSubmission {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    stage: r.stage as ProjectStage,
    formData: (r.form_data as Record<string, unknown> | null) ?? {},
    status: r.status as SubmissionStatus,
    evaluatorComment: (r.evaluator_comment as string) ?? "",
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    submittedAt: r.submitted_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** The signed-in staff member's display name — used to default the Concept form's "Leader" field (still freely editable). */
export async function fetchCurrentStaffName(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return "";
  const { data } = await supabase.from("users").select("first_name, last_name").eq("id", auth.user.id).single();
  if (!data) return "";
  return [data.first_name, data.last_name].filter(Boolean).join(" ");
}

/** Every project the signed-in staff member created — powers My Proposals / My Approved Projects. */
export async function fetchMyProjects(): Promise<ResearchProject[]> {
  const { data, error } = await supabase.from("research_projects").select("*").order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProject);
}

/** Every stage submission for a set of projects, keyed by projectId — used to show each project's current status/remarks in the My Proposals list. */
export async function fetchStageSubmissionsForProjects(projectIds: string[]): Promise<StageSubmission[]> {
  if (projectIds.length === 0) return [];
  const { data, error } = await supabase.from("research_project_stage_submissions").select("*").in("project_id", projectIds);
  if (error || !data) return [];
  return data.map(rowToSubmission);
}

export interface ConceptFormInput {
  title: string;
  researchAgenda: string;
  leaderName: string;
  members: string[];
  stakeholders: string;
  rationale: string;
  significance: string;
  expectedOutcomesSummary: string;
}

/** Creates a new research project plus its initial Concept-stage submission, in one call. */
export async function createResearchProject(input: ConceptFormInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { data: project, error: projectError } = await supabase.from("research_projects").insert({
    title: input.title,
    research_agenda: input.researchAgenda,
    agenda_type: agendaTypeFor(input.researchAgenda),
    leader_name: input.leaderName,
    members: input.members.filter(m => m.trim()),
    stakeholders: input.stakeholders,
    rationale: input.rationale,
    significance: input.significance,
    expected_outcomes_summary: input.expectedOutcomesSummary,
    created_by: auth.user.id,
  }).select("id").single();
  if (projectError || !project) return { ok: false, error: projectError?.message ?? "Failed to create project." };

  const { error: submissionError } = await supabase.from("research_project_stage_submissions").insert({
    project_id: project.id,
    stage: "concept",
    form_data: input as unknown as Record<string, unknown>,
  });
  if (submissionError) return { ok: false, error: submissionError.message };

  return { ok: true, id: project.id };
}

// ── Proposal Development (stage 'proposal_development') ──

export const MAX_OBJECTIVES = 6;
export const MAX_WORK_PLAN_ACTIVITIES = 10;
export const MAX_EXPECTED_OUTPUTS = 6;
export const MAX_EXPECTED_OUTCOMES = 6;

export interface ObjectiveItem { text: string }
export interface WorkPlanActivity { activity: string; days: string; deliverable: string }
export interface BudgetLineItem { quantity: string; unit: string; specification: string; unitCost: string; subtotal: string }
export interface OutputItem { text: string }
export interface OutcomeItem { text: string }

/** form_data shape for stage='proposal_development'. `methodology` is added by Phase D.3 — optional until then. */
export interface ProposalDevelopmentFormData {
  statementOfProblem: string;
  mainObjective: string;
  objectives: ObjectiveItem[];
  workPlanStart: string;
  workPlanEnd: string;
  workPlanActivities: WorkPlanActivity[];
  budgetTotal: string;
  budgetItems: BudgetLineItem[];
  expectedOutputs: OutputItem[];
  expectedOutcomes: OutcomeItem[];
  methodology?: Record<string, unknown>;
}

/** Creates (first save) or updates (resubmission after "returned") the Proposal Development stage submission, resetting it to under_review. */
export async function saveProposalDevelopmentSubmission(
  projectId: string, existingSubmissionId: string | null, data: ProposalDevelopmentFormData,
): Promise<{ ok: boolean; error?: string }> {
  if (existingSubmissionId) {
    const { error } = await supabase.from("research_project_stage_submissions").update({
      form_data: data as unknown as Record<string, unknown>,
      status: "under_review",
      evaluator_comment: "",
      reviewed_by: null,
      reviewed_at: null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", existingSubmissionId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await supabase.from("research_project_stage_submissions").insert({
    project_id: projectId,
    stage: "proposal_development",
    form_data: data as unknown as Record<string, unknown>,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Re-edits the Concept submission after it was returned — updates both the project's own fields (so the list reflects the latest values) and the submission back to under_review. */
export async function updateConceptSubmission(projectId: string, submissionId: string, input: ConceptFormInput): Promise<{ ok: boolean; error?: string }> {
  const { error: projectError } = await supabase.from("research_projects").update({
    title: input.title,
    research_agenda: input.researchAgenda,
    agenda_type: agendaTypeFor(input.researchAgenda),
    leader_name: input.leaderName,
    members: input.members.filter(m => m.trim()),
    stakeholders: input.stakeholders,
    rationale: input.rationale,
    significance: input.significance,
    expected_outcomes_summary: input.expectedOutcomesSummary,
    updated_at: new Date().toISOString(),
  }).eq("id", projectId);
  if (projectError) return { ok: false, error: projectError.message };

  const { error: submissionError } = await supabase.from("research_project_stage_submissions").update({
    form_data: input as unknown as Record<string, unknown>,
    status: "under_review",
    evaluator_comment: "",
    reviewed_by: null,
    reviewed_at: null,
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", submissionId);
  return submissionError ? { ok: false, error: submissionError.message } : { ok: true };
}
