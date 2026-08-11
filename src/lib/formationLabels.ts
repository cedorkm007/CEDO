/**
 * Shared between the staff-side Formation Tools UI and the scholar-facing
 * profile card, so a position's display text (e.g. "Director — Advocacy
 * Programs (VIP)") is built the same way in both places.
 */

export const VIP_DEPARTMENTS: { key: string; label: string }[] = [
  { key: "events_communication", label: "Events and Communication" },
  { key: "advocacy_programs", label: "Advocacy Programs" },
  { key: "volunteer_support", label: "Volunteer Support" },
  { key: "partner_management", label: "Partner Management" },
  { key: "members", label: "Members" },
];

export type FormationOrgType = "school" | "community_cluster" | "community_barangay" | "vip_top" | "vip_department";

/** Short "where" suffix for a position, e.g. "De Oro High School" or "Cluster A" or "VIP". */
export function formatOrgContext(orgType: FormationOrgType, orgKey: string): string {
  switch (orgType) {
    case "school": return orgKey;
    case "community_cluster": return `Cluster ${orgKey}`;
    case "community_barangay": return orgKey;
    case "vip_top": return "VIP";
    case "vip_department": return `VIP – ${VIP_DEPARTMENTS.find(d => d.key === orgKey)?.label ?? orgKey}`;
    default: return orgKey;
  }
}

/** Full display string for one position, e.g. "President — De Oro High School". */
export function formatPositionLabel(roleLabel: string, orgType: FormationOrgType, orgKey: string): string {
  return `${roleLabel} — ${formatOrgContext(orgType, orgKey)}`;
}
