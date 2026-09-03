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
    description: "Question bank, scholar accounts, quest scores, and account history.",
  },
  {
    key: "sdp_monitoring",
    label: "SDP Monitoring",
    description: "Review and approve scholars' SDP activity proposals — needed for scholarship renewal tracking.",
  },
  {
    key: "scholars_formation",
    label: "Scholars' Formation Tools",
    description: "Tag scholars with leadership positions across School-based, Community-based, and VIP organizations.",
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
    key: "scholarship_program_info",
    label: "Scholarship Program Information",
    description: "Birds-eye statistics on the scholarship program — counts by status, barangay, school, year level, and course, with per-scholar profile exports.",
  },
];
