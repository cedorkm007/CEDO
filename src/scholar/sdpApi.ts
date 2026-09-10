import { supabase } from "@/lib/supabase";

export type SDPCategory = "community_service" | "community_volunteerism" | "formation_program";
export type SDPActivityType = "one_time" | "recurring";
export interface RecurringOccurrence { date: string; venue: string; }

export const SDP_CATEGORIES: { key: SDPCategory; label: string }[] = [
  { key: "community_service", label: "Institutional Volunteerism" },
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
  pubmatPath: string | null;
  activityType: SDPActivityType;
  recurringDates: RecurringOccurrence[];
  credits: number;
  createdAt: string;
}

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
    pubmatPath: (r.pubmat_path as string | null) ?? null,
    activityType: (r.activity_type as SDPActivityType | null) ?? "one_time",
    recurringDates: (r.recurring_dates as RecurringOccurrence[] | null) ?? [],
    credits: Number(r.credits ?? 1),
    createdAt: String(r.created_at ?? ""),
  };
}

/** Staff-created activities, open to every scholar immediately. */
export async function fetchApprovedSDPActivities(): Promise<SDPActivity[]> {
  const { data, error } = await supabase.from("sdp_activities")
    .select("*")
    .is("submitted_by_scholar_id", null)
    .order("date_time", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToActivity);
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

export type SDPCreditCounts = Record<SDPCategory, number>;

/** This scholar's accumulated credits per SDP category (3 needed to complete one) — sums each credited activity's `credits`, not just a count of attendances. */
export async function fetchScholarSDPCreditCounts(scholarIdNumber: string): Promise<SDPCreditCounts> {
  const fallback: SDPCreditCounts = { community_service: 0, community_volunteerism: 0, formation_program: 0 };
  const { data, error } = await supabase.from("sdp_attendance")
    .select("sdp_activities(category, credits)").eq("scholar_id_number", scholarIdNumber);
  if (error || !data) return fallback;
  const totals = { ...fallback };
  for (const row of data as unknown as { sdp_activities: { category: SDPCategory | null; credits: number | null } | null }[]) {
    const activity = row.sdp_activities;
    if (activity?.category) totals[activity.category] += Number(activity.credits ?? 1);
  }
  return totals;
}

