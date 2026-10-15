// Who can open the Scholar Renewal tool (the page itself checks again which tabs they see; the database decides what they may read).
//   - the Scholar Renewal Evaluator (tag scholar_renewal_evaluator): everything
//   - the SEAD Division Head (tag sead_division_head): the Division Head tab and the Dashboard
//   - the heads of SEAD (a SEAD division admin, or a super admin): the Dashboard and the Excel report only
//   - the IT admin (it.admin1): only the Certificate tab (the signatories of the Certificate of Scholarship Renewal)
// Mirrors can_view_renewal_reports() in supabase_migration_renewal_p7_reports.sql.
export interface RenewalAccessUser { tags: string[]; role: string; division: string; username?: string }

/** The same account the rest of the app calls IT_ADMIN_USERNAME (App.tsx); the database checks it in is_it_admin(). */
export const isItAdmin = (u: RenewalAccessUser): boolean => (u.username ?? "").toLowerCase() === "it.admin1";

export const isSeadHead = (u: RenewalAccessUser): boolean => u.role === "super_admin" || (u.role === "division_admin" && u.division === "SEAD");

export function canSeeScholarRenewal(u: RenewalAccessUser): boolean {
  return u.tags.includes("scholar_renewal_evaluator") || u.tags.includes("sead_division_head") || isSeadHead(u) || isItAdmin(u);
}
