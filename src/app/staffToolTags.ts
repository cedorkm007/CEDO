/**
 * Every "tool tag" a CEDO staff account can be assigned. A tag gates
 * visibility of one nav item/tab — it.admin1 assigns tags to staff
 * accounts (Staff Accounts page), and a staff member only sees a tool
 * once their account has been tagged for it.
 *
 * To add a new gated tab in the future:
 *   1. Add its tag here.
 *   2. In App.tsx, check `currentUser.tags.includes("your_new_key")`
 *      wherever that tab's nav item and page are rendered.
 * That's it — it.admin1 can then grant it to whichever accounts need it
 * from the Staff Accounts page, no other code changes required.
 */
export interface StaffToolTag {
  key: string;
  label: string;
  description: string;
}

export const STAFF_TOOL_TAGS: StaffToolTag[] = [
  {
    key: "scholar_management",
    label: "Scholar Management Tools",
    description: "Scholar accounts, formation activities, and account history.",
  },
  {
    key: "quest_management",
    label: "Quest Management Tools",
    description: "Question bank and quest score monitoring.",
  },
  {
    key: "sdp_monitoring",
    label: "SDP Monitoring",
    description: "Review and approve scholars' SDP activity proposals — needed for scholarship renewal tracking.",
  },
  {
    key: "scholars_formation",
    label: "Scholars' Formation Tools",
    description: "Tag scholars with leadership positions across School-based, Community-based, and VIP organizations, and open Formation Activities (which also needs Scholar Management Tools).",
  },
  {
    key: "forms_management",
    label: "Forms Management",
    description: "Upload and manage the PDFs/flipbooks scholars see under Forms and Services → Forms, including unlock conditions.",
  },
  {
    key: "kauban_content",
    label: "Kauban Content Management",
    description: "Add sign words and quick phrases, and upload/compress the sign-language videos for the Kauban app.",
  },
  {
    key: "sdp_reconsideration_approver",
    label: "SDP Reconsideration Approver",
    description: "Approve or deny scholars' requests for SDP reconsideration (a scholar who lacks SDP credits asks, with the renewal application, to be treated as complied; the lacking credits are added to the next semester). it.admin1 can always decide; this tag appoints someone else.",
  },
  {
    key: "scholar_grades_approver",
    label: "Grades Approver",
    description: "Approve or return the grades that scholars enter themselves during renewal (with their screenshots) while their school has not uploaded the grades yet. The renewal evaluator can only read them.",
  },
  {
    key: "scholarship_program_info",
    label: "Scholarship Program Information",
    description: "Birds-eye statistics on the scholarship program — counts by status, barangay, school, year level, and program, with per-scholar profile exports.",
  },
  {
    key: "research_project_monitoring",
    label: "Research Project Monitoring",
    description: "Monitor research projects, build surveys for SDP/Formation activities, and review survey results.",
  },
  {
    key: "financial_assistance",
    label: "Financial Assistance",
    description: "Monitor Financial Assistance applicants — separate from Mainstream Scholars, no portal account, tracked per academic period.",
  },
  {
    key: "scholar_counseling",
    label: "Scholar Consultation Tool",
    description: "Monitor scholars' scholarship status and log consultation visits (Daily Records).",
  },
  {
    key: "sead_division_head",
    label: "SEAD Division Head (Referral Approvals)",
    description: "Receives notifications to approve or reconsider Scholar Consultation referrals forwarded by consultation staff, and decides Scholar Renewal cases (Approve Probationary, Removed, Reconsidered) in the Scholar Renewal tool.",
  },
  {
    key: "scholars_grades_monitoring",
    label: "Scholars' Grades Monitoring",
    description: "Monitor scholars' grade-completion rates by school and program, and drill into individual grades and GWA.",
  },
  {
    key: "storage_tool",
    label: "Storage Tool",
    description: "A personal, private file storage (folders, upload, preview, download) with sharing for upload.",
  },
  {
    key: "scholar_renewal_evaluator",
    label: "Scholar Renewal Evaluator",
    description: "Opens renewal windows, reviews renewal applications, accepts or declines late ones, confirms every renewal, and decides INC cases after the deadline.",
  },
];
