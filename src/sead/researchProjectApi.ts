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
  "monitoring", "dissemination", "utilization", "preservation", "institutional_learning", "completed",
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
  completed: "Completed",
};

// The stages from Implementation onward — each is a single ("main"-keyed)
// submission, like Concept, rather than Proposal Development's 6
// independently-gated forms. Reaching "completed" (the terminal stage) has
// no form of its own — it's simply where Institutional Learning advances to.
export const POST_APPROVAL_STAGE_KEYS = [
  "implementation", "monitoring", "dissemination", "utilization", "preservation", "institutional_learning",
] as const;
export type PostApprovalStageKey = (typeof POST_APPROVAL_STAGE_KEYS)[number];

export type SubmissionStatus = "under_review" | "returned" | "approved";

/** Fixed, non-editable text per status — separate from the evaluator's own free-text comment. */
export const STATUS_REMARKS: Record<SubmissionStatus, string> = {
  under_review: "Evaluation ongoing",
  returned: "Proposal Revision",
  approved: "Move to next stage",
};

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  under_review: "Under Review",
  returned: "Returned",
  approved: "Approved",
};
export const STATUS_BADGE_CLASSES: Record<SubmissionStatus, string> = {
  under_review: "text-amber-700 bg-amber-100",
  returned: "text-red-700 bg-red-100",
  approved: "text-green-700 bg-green-100",
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
  // "main" for every stage with a single combined form (Concept, and any
  // later stage that never gets split); one of PROPOSAL_DEV_FORM_KEYS for
  // proposal_development, where each key is its own independently
  // submitted/reviewed form.
  formKey: string;
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
    formKey: (r.form_key as string | null) ?? "main",
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

// ── Methodology / Research Design (part of stage='proposal_development') ──

export const RESEARCH_APPROACHES = ["Qualitative", "Quantitative", "Mixed Methods", "Action/Applied"] as const;
export type ResearchApproach = (typeof RESEARCH_APPROACHES)[number];

export const DESIGN_OPTIONS_BY_APPROACH: Record<ResearchApproach, string[]> = {
  "Qualitative": ["Phenomenological", "Grounded Theory", "Ethnographic", "Case Study", "Narrative Research", "Historical"],
  "Quantitative": [
    "Experimental (True Experimental)", "Quasi-Experimental", "Pre-Experimental", "Correlational",
    "Descriptive / Survey", "Causal-Comparative (Ex Post Facto)", "Longitudinal", "Cross-Sectional",
  ],
  "Mixed Methods": ["Convergent Parallel", "Explanatory Sequential", "Exploratory Sequential", "Embedded / Nested", "Transformative", "Multiphase"],
  "Action/Applied": ["Participatory Action Research (PAR)", "Practical Action Research", "Design-Based Research (DBR)", "Evaluation Research"],
};

export interface OptionCategory { label: string; options: string[] }

export const SAMPLING_CATEGORIES: OptionCategory[] = [
  { label: "Probability Sampling (Random)", options: ["Simple Random", "Stratified Random", "Systematic", "Cluster", "Multi-Stage"] },
  { label: "Non-Probability Sampling (Non-Random)", options: ["Purposive / Judgmental", "Convenience", "Snowball / Chain-Referral", "Quota", "Voluntary Response", "Theoretical"] },
  { label: "Specialized & Mixed Sampling", options: ["Sequential", "Maximum Variation", "Critical Case", "Typical Case"] },
];

export const DATA_SOURCE_CATEGORIES: OptionCategory[] = [
  { label: "Human & Participant Sources", options: ["Research Participants / Respondents", "Key Informants / Subject Matter Experts", "Focus Group Participants", "Students / Learners", "Teachers / Educators", "Administrators / Stakeholders"] },
  { label: "Documentary & Textual Sources", options: ["Academic Journals & Literature", "Institutional / School Records", "Curriculum Standards & Syllabi", "Policy Documents & Legislation", "Historical Records & Archives", "Reports & Whitepapers"] },
  { label: "Digital & System Sources", options: ["Learning Management System (LMS) Logs", "Application / Web Analytics & User Logs", "Database / API Repositories", "Social Media & Online Forums", "Open Data Portals / Public Repositories"] },
  { label: "Observational & Physical Sources", options: ["Field Notes & Observation Checklists", "Audio / Video Recordings", "Physical Artifacts & Instructional Materials", "Sensor & Hardware Data"] },
];

export const DATA_COLLECTION_CATEGORIES: OptionCategory[] = [
  { label: "Primary Data Collection Methods", options: ["Surveys / Questionnaires", "Structured Interviews", "Semi-Structured Interviews", "Unstructured / In-Depth Interviews", "Focus Group Discussions (FGD)", "Direct Observation (Participant / Non-Participant)", "Field Notes & Observation Checklists", "Standardized / Diagnostic Tests", "Experiments / Laboratory Measurements"] },
  { label: "Secondary & Digital Data Collection", options: ["Document / Archival Review", "Content / Textual Analysis", "Log Files / User Activity Tracking", "API / Data Scraping", "Audio / Video Recordings"] },
  { label: "Interactive & Continuous Methods", options: ["Daily Logs / Self-Reporting Journals", "Game-Based / Gamified Metrics", "Sensor / Wearable Data Retrieval", "Interactive Task Logs"] },
];

export const DATA_ANALYSIS_CATEGORIES: OptionCategory[] = [
  { label: "Quantitative / Statistical", options: [
    "Descriptive Statistics (Mean, SD, Frequencies)", "Correlation Analysis (Pearson, Spearman)", "Independent Samples t-Test",
    "Paired Samples t-Test", "One-Way / Two-Way ANOVA", "Linear / Multiple Regression Analysis", "Logistic Regression Analysis",
    "Factor Analysis (EFA / CFA)", "Structural Equation Modeling (SEM)", "Non-Parametric Tests (Mann-Whitney, Wilcoxon, Chi-Square)",
  ] },
  { label: "Qualitative / Textual", options: [
    "Thematic Analysis", "Content Analysis", "Discourse Analysis", "Narrative Analysis", "Interpretative Phenomenological Analysis (IPA)",
  ] },
  { label: "Mixed Methods & Advanced/Computational", options: [
    "Constant Comparative Method (Grounded Theory)", "Sequential Exploratory / Explanatory Integration", "Joint Display Matrix Analysis",
    "Machine Learning / Predictive Analytics", "Sentiment Analysis", "User Interaction & Analytics Mining", "Network / Graph Analysis",
  ] },
];

export interface MethodologyFormData {
  approach: ResearchApproach | "";
  design: string;
  population: string;
  sampling: string;
  dataSources: string[];
  dataCollectionMethods: string[];
  dataAnalysis: string[];
}

/** form_data shape for stage='proposal_development'. */
export interface ProposalDevelopmentFormData {
  statementOfProblem: string;
  mainObjective: string;
  objectives: ObjectiveItem[];
  methodology: MethodologyFormData;
  workPlanStart: string;
  workPlanEnd: string;
  workPlanActivities: WorkPlanActivity[];
  budgetTotal: string;
  budgetItems: BudgetLineItem[];
  expectedOutputs: OutputItem[];
  expectedOutcomes: OutcomeItem[];
}

// Proposal Development is split into these 6 independently
// submitted/reviewed forms — the researcher accomplishes them one at a
// time, in this order; a form only unlocks once the one before it is
// approved (see proposalDevFormStatus in ProposalDevelopmentWizard.tsx).
export const PROPOSAL_DEV_FORM_KEYS = ["statement", "objectives", "methodology", "workPlan", "budget", "outputs"] as const;
export type ProposalDevFormKey = (typeof PROPOSAL_DEV_FORM_KEYS)[number];
export const PROPOSAL_DEV_FORM_LABELS: Record<ProposalDevFormKey, string> = {
  statement: "Statement of the Problem",
  objectives: "Objectives",
  methodology: "Methodology",
  workPlan: "Work Plan and Timeline",
  budget: "Budget Requirement",
  outputs: "Expected Outputs and Outcomes",
};

// What one of the 6 forms' own row (if any) means for whether it's open for
// input right now — "editable" is either the very first form with no
// submission yet, or one that came back "returned" for revision. A form is
// only reachable once every form before it is "approved"; anything after
// the first non-approved one is "locked".
export type StepGateStatus = "editable" | "under_review" | "returned" | "approved" | "locked";

/** Per-form gate status for every one of PROPOSAL_DEV_FORM_KEYS, given whichever of that project's proposal_development submissions exist so far. Shared between the researcher's wizard (which form is open for input) and the proposals list (progress at a glance). */
export function computeProposalDevFormStatuses(existingSubmissions: StageSubmission[]): Record<ProposalDevFormKey, StepGateStatus> {
  const byKey = new Map(existingSubmissions.map(s => [s.formKey, s]));
  const result = {} as Record<ProposalDevFormKey, StepGateStatus>;
  let previousApproved = true; // the first form has nothing before it to wait on
  for (const key of PROPOSAL_DEV_FORM_KEYS) {
    const submission = byKey.get(key);
    if (submission?.status === "approved") result[key] = "approved";
    else if (submission?.status === "under_review") result[key] = "under_review";
    else if (submission?.status === "returned") result[key] = "returned";
    else result[key] = previousApproved ? "editable" : "locked";
    previousApproved = result[key] === "approved";
  }
  return result;
}

/** Creates (first save) or updates (resubmission after "returned") ONE Proposal Development form's submission, resetting it to under_review. Each of the 6 forms (see PROPOSAL_DEV_FORM_KEYS) is its own row, reviewed independently. */
export async function saveProposalDevelopmentFormStep(
  projectId: string, formKey: ProposalDevFormKey, existingSubmissionId: string | null, data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (existingSubmissionId) {
    const { error } = await supabase.from("research_project_stage_submissions").update({
      form_data: data,
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
    form_key: formKey,
    form_data: data,
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

// ── Post-approval stages (Implementation onward) ──

export interface EvidenceFile { id: string; fileName: string; filePath: string; fileType: string }

// Implementation: one evidence file + description per specific objective
// (never the main objective) — rows track the approved Proposal
// Development objectives list, so they aren't independently added/removed.
export interface ObjectiveEvidenceItem { objectiveText: string; description: string; file: EvidenceFile | null }
export interface ImplementationFormData { evidence: ObjectiveEvidenceItem[] }

// Monitoring: results + insights per specific objective, plus one overall
// conclusion for the whole project.
export interface ObjectiveResultItem { objectiveText: string; results: string; insights: string }
export interface MonitoringFormData { results: ObjectiveResultItem[]; overallConclusion: string }

// Dissemination/Utilization: a free-form (add/remove) list of evidence
// items, since these aren't tied to specific objectives.
export interface EvidenceListItem { id: string; description: string; file: EvidenceFile | null }
export interface DisseminationFormData { evidence: EvidenceListItem[] }
export interface UtilizationFormData { certificates: EvidenceListItem[] }

export interface PreservationFormData { file: EvidenceFile | null }
export interface InstitutionalLearningFormData { wayForward: string }

export const MAX_DISSEMINATION_EVIDENCE = 6;
export const MAX_UTILIZATION_CERTIFICATES = 6;

/** Creates (first save) or updates (resubmission after "returned") the single "main" submission for one post-approval stage — mirrors updateConceptSubmission's submission-row half. */
export async function submitPostApprovalStageForm(
  projectId: string, stage: PostApprovalStageKey, existingSubmissionId: string | null, data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (existingSubmissionId) {
    const { error } = await supabase.from("research_project_stage_submissions").update({
      form_data: data,
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
    stage,
    form_key: "main",
    form_data: data,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Evaluator review (Research Project Monitoring → Monitoring subtab) ──

/** Every research project visible to the caller — for a researcher this is just their own (per RLS); for an evaluator (is_research_monitoring_staff) RLS additionally grants every project, which is what this is meant to be called with. */
export async function fetchAllResearchProjectsForEvaluator(): Promise<ResearchProject[]> {
  const { data, error } = await supabase.from("research_projects").select("*").order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProject);
}

/** The stage a project moves to once its current stage's submission is approved. Stages without a form yet (review/approval) are skipped — approving Proposal Development moves a project straight to Implementation. Implementation onward follows the fixed pipeline through to "completed". */
const NEXT_STAGE_ON_APPROVAL: Partial<Record<ProjectStage, ProjectStage>> = {
  concept: "proposal_development",
  proposal_development: "implementation",
  implementation: "monitoring",
  monitoring: "dissemination",
  dissemination: "utilization",
  utilization: "preservation",
  preservation: "institutional_learning",
  institutional_learning: "completed",
};

async function advanceProjectStage(projectId: string, nextStage: ProjectStage): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("advance_project_stage", { p_project_id: projectId, p_next_stage: nextStage });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** True once every one of the 6 Proposal Development forms (PROPOSAL_DEV_FORM_KEYS) has its own approved row — the gate for advancing the project to Implementation. */
async function isProposalDevelopmentFullyApproved(projectId: string): Promise<boolean> {
  const { data, error } = await supabase.from("research_project_stage_submissions")
    .select("form_key, status").eq("project_id", projectId).eq("stage", "proposal_development");
  if (error || !data) return false;
  return PROPOSAL_DEV_FORM_KEYS.every(key => data.some(row => row.form_key === key && row.status === "approved"));
}

/**
 * Evaluator decision on one stage/form submission. Approving Concept
 * (the only form on that stage) advances the project straight to
 * Proposal Development. Approving one of Proposal Development's 6 forms
 * only advances the project to Implementation once ALL 6 are approved —
 * otherwise the project just stays put while the researcher works
 * through the remaining forms. Returning always leaves the stage as-is
 * so the researcher can revise and resubmit just that one form.
 */
export async function reviewStageSubmission(
  submissionId: string, projectId: string, currentStage: ProjectStage, outcome: "approved" | "returned", comment: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("research_project_stage_submissions").update({
    status: outcome,
    evaluator_comment: comment,
    reviewed_by: auth.user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", submissionId);
  if (error) return { ok: false, error: error.message };

  if (outcome === "approved") {
    const next = NEXT_STAGE_ON_APPROVAL[currentStage];
    if (next) {
      if (currentStage === "proposal_development" && !(await isProposalDevelopmentFullyApproved(projectId))) {
        return { ok: true };
      }
      return advanceProjectStage(projectId, next);
    }
  }
  return { ok: true };
}
