// ─────────────────────────────────────────────────────────────
// src/lib/bookingInfo.ts
// Consultation Tool > Appointments: how the extra lines of the booking pop-up are WORDED (course, year level, barangay, school, GWA). Plain helpers (no React / Supabase) so tests can run them alone.
// The values themselves come from the database (supabase_migration_consultation_booking_details.sql).
// ─────────────────────────────────────────────────────────────
import { describeScale, type GwaScale } from "./academicStatus";

export const NOT_SAVED = "Not saved";

/** A line that may be empty: the text, or "Not saved" when the scholar's record has nothing. */
export const infoText = (v: string | null | undefined): string => (v && v.trim() ? v.trim() : NOT_SAVED);

/**
 * The GWA line: the number (two decimals) with a small note saying which semester it is of and what scale it is on ("1.00 to 5.00 (1.00 is the best)"),
 * because 2.50 means different things on different schools' scales. With no GWA the note says why there is none.
 */
export function gwaLine(gwa: number | null, scale: GwaScale | null, year: string | null, term: string | null): { value: string; note: string } {
  const period = [term, year].filter(Boolean).join(" ");
  if (gwa === null || !Number.isFinite(gwa)) {
    return { value: "Not available", note: !period ? "No grades are recorded for this scholar yet." : scale ? `No grades are recorded for ${period} yet.` : "The school has no grading setup yet, or no grades are recorded." };
  }
  const parts = [period ? `of ${period}` : "", scale ? `scale ${describeScale(scale)}` : ""].filter(Boolean);
  return { value: gwa.toFixed(2), note: parts.join(" · ") };
}
