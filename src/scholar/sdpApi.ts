import { supabase } from "@/lib/supabase";

export type SDPStatus = "finished" | "ongoing" | "approved" | "pending" | "canceled" | "rescheduled";
export type SDPCategory = "community_service" | "community_volunteerism" | "formation_program";

export const SDP_CATEGORIES: { key: SDPCategory; label: string }[] = [
  { key: "community_service", label: "Community Service" },
  { key: "community_volunteerism", label: "Community Volunteerism" },
  { key: "formation_program", label: "Formation Program" },
];

export interface ObjectiveRow { objective: string; deliverable: string; }
export interface WorkPlanRow { date: string; activity: string; }
export interface ProgramFlowRow { time: string; segment: string; deliverables: string; personInCharge: string; }
export interface BudgetRow { quantity: string; unit: string; specification: string; unitCost: string; subtotal: string; }

export interface SDPActivity {
  id: string;
  name: string;
  submittedByScholarId: string | null; // null = staff-created, open to all scholars
  category: SDPCategory | null;
  nature: string[];
  organization: string;
  dateTime: string; // "" if unset
  venue: string;
  projectHead: string;
  headCluster: string;
  status: SDPStatus;
  budgetaryRequirement: string;
  sourceOfFund: string[];
  sourceOfFundOther: string;
  rationale: string;
  linkWithOrg: string;
  objectives: ObjectiveRow[];
  targetPartners: string[];
  targetPartnersOther: string;
  specificRole: string[];
  workPlan: WorkPlanRow[];
  programFlow: ProgramFlowRow[];
  budgetItems: BudgetRow[];
  createdAt: string;
}

export const ORGANIZATIONS = [
  "Sangguniang Kabataan Federation",
  "Red Cross Youth",
  "Junior Philippine Institute of Accountants",
  "ROTC Alumni Association",
  "Student Government Federation",
  "Young Entrepreneurs Society",
  "Science and Technology Club",
  "Environmental Advocates Group",
  "Cultural Heritage Society",
  "Sports Development Council",
  "Health and Wellness Association",
  "Information Technology Society",
  "Mathematics Excellence Club",
  "English Language Club",
  "Reading and Literacy Group",
  "Community Service Organization",
  "Youth Leadership Forum",
  "Women Empowerment Alliance",
  "Persons with Disability Advocates",
  "Senior Citizens Support Group",
];

function rowToActivity(r: Record<string, unknown>): SDPActivity {
  return {
    id: String(r.id),
    name: String(r.name),
    submittedByScholarId: (r.submitted_by_scholar_id as string | null) ?? null,
    category: (r.category as SDPCategory | null) ?? null,
    nature: (r.nature as string[]) ?? [],
    organization: String(r.organization ?? ""),
    dateTime: (r.date_time as string | null) ?? "",
    venue: String(r.venue ?? ""),
    projectHead: String(r.project_head ?? ""),
    headCluster: String(r.head_cluster ?? ""),
    status: r.status as SDPStatus,
    budgetaryRequirement: String(r.budgetary_requirement ?? ""),
    sourceOfFund: (r.source_of_fund as string[]) ?? [],
    sourceOfFundOther: String(r.source_of_fund_other ?? ""),
    rationale: String(r.rationale ?? ""),
    linkWithOrg: String(r.link_with_org ?? ""),
    objectives: (r.objectives as ObjectiveRow[]) ?? [],
    targetPartners: (r.target_partners as string[]) ?? [],
    targetPartnersOther: String(r.target_partners_other ?? ""),
    specificRole: (r.specific_role as string[]) ?? [],
    workPlan: (r.work_plan as WorkPlanRow[]) ?? [],
    programFlow: (r.program_flow as ProgramFlowRow[]) ?? [],
    budgetItems: (r.budget_items as BudgetRow[]) ?? [],
    createdAt: String(r.created_at ?? ""),
  };
}

/** Staff-created activities open to every scholar (approved/ongoing/finished only). */
export async function fetchApprovedSDPActivities(): Promise<SDPActivity[]> {
  const { data, error } = await supabase.from("sdp_activities")
    .select("*")
    .is("submitted_by_scholar_id", null)
    .in("status", ["approved", "ongoing", "finished"])
    .order("date_time", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToActivity);
}

/** A scholar's own submitted proposals, any status. */
export async function fetchMySDPActivities(scholarIdNumber: string): Promise<SDPActivity[]> {
  const { data, error } = await supabase.from("sdp_activities")
    .select("*")
    .eq("submitted_by_scholar_id", scholarIdNumber)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToActivity);
}

export interface SDPProposalInput {
  name: string;
  category: SDPCategory;
  nature: string[];
  organization: string;
  dateTime: string;
  venue: string;
  budgetaryRequirement: string;
  sourceOfFund: string[];
  sourceOfFundOther: string;
  rationale: string;
  linkWithOrg: string;
  objectives: ObjectiveRow[];
  targetPartners: string[];
  targetPartnersOther: string;
  specificRole: string[];
  workPlan: WorkPlanRow[];
  programFlow: ProgramFlowRow[];
  budgetItems: BudgetRow[];
}

/** Whether this scholar holds any Scholars' Formation Tools position (other than a plain
 *  "member" roster entry) — only these scholars are allowed to submit an SDP proposal. */
export async function checkIsFormationOfficer(scholarIdNumber: string): Promise<boolean> {
  const { data, error } = await supabase.from("formation_positions")
    .select("id").eq("scholar_id_number", scholarIdNumber).neq("role_key", "member").limit(1);
  return !error && !!data && data.length > 0;
}

export type SDPCategoryStatus = Record<SDPCategory, boolean>;

/** This scholar's completion status for each of the 3 required SDP categories. */
export async function fetchScholarSDPCategoryStatus(scholarIdNumber: string): Promise<SDPCategoryStatus> {
  const fallback: SDPCategoryStatus = { community_service: false, community_volunteerism: false, formation_program: false };
  const { data, error } = await supabase.from("scholar_sdp_category_status")
    .select("category, completed").eq("scholar_id_number", scholarIdNumber);
  if (error || !data) return fallback;
  const status = { ...fallback };
  for (const row of data) status[row.category as SDPCategory] = !!row.completed;
  return status;
}

export async function submitSDPProposal(
  scholarIdNumber: string, input: SDPProposalInput
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("sdp_activities").insert({
    name: input.name,
    submitted_by_scholar_id: scholarIdNumber,
    category: input.category,
    nature: input.nature,
    organization: input.organization,
    date_time: input.dateTime || null,
    venue: input.venue,
    status: "pending",
    budgetary_requirement: input.budgetaryRequirement,
    source_of_fund: input.sourceOfFund,
    source_of_fund_other: input.sourceOfFundOther,
    rationale: input.rationale,
    link_with_org: input.linkWithOrg,
    objectives: input.objectives,
    target_partners: input.targetPartners,
    target_partners_other: input.targetPartnersOther,
    specific_role: input.specificRole,
    work_plan: input.workPlan,
    program_flow: input.programFlow,
    budget_items: input.budgetItems,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
