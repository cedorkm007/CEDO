// ─────────────────────────────────────────────────────────────
// src/lib/sdpChecklistNote.ts
// SDP Checklist: when to write "Reconsideration approved" under a Complied chip. Plain helper (no React / Supabase) so tests can run it alone.
// The rule of Complied itself is decided by the database; this only says when the reason is worth showing.
// ─────────────────────────────────────────────────────────────

/** Credits needed in each category before anything owed on top of it. */
export const SDP_BASE_REQUIRED = 3;

export interface ChecklistNoteRow { scholarIdNumber: string; applicable: boolean; complied: boolean | null; communityService: number; communityVolunteerism: number; formationProgram: number }
export type OwedMap = ReadonlyMap<string, { communityService: number; communityVolunteerism: number; formationProgram: number }>;

/**
 * A scholar whose SDP reconsideration for the semester was approved counts as Complied even with fewer than 3 credits in a category. The note is shown only for such a row:
 * Complied (not Summer), a category below its requirement (3, plus what the scholar owes), and an approved reconsideration. A scholar who really has the credits gets no note.
 */
export function compliedByReconsideration(s: ChecklistNoteRow, approved: ReadonlySet<string>, owed: OwedMap): boolean {
  if (!s.applicable || s.complied !== true || !approved.has(s.scholarIdNumber)) return false;
  const o = owed.get(s.scholarIdNumber);
  return s.communityService < SDP_BASE_REQUIRED + (o?.communityService ?? 0)
    || s.communityVolunteerism < SDP_BASE_REQUIRED + (o?.communityVolunteerism ?? 0)
    || s.formationProgram < SDP_BASE_REQUIRED + (o?.formationProgram ?? 0);
}

export const RECONSIDERED_NOTE = "Reconsideration approved";
export const RECONSIDERED_HINT = "This scholar's SDP reconsideration for this semester was approved, so the scholar counts as Complied even though the credits are short. The credits that were lacking are added to the next semester's requirement.";
