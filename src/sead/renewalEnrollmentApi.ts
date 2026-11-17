// ─────────────────────────────────────────────────────────────
// src/sead/renewalEnrollmentApi.ts
// Scholar Renewal > Renewed: the "Enrollment confirmation" tick box and the export of the confirmed enrolled.
// Who may tick and what is listed are decided by the database (supabase_migration_renewal_enrollment_confirmation.sql); these calls just ask.
// `missing: true` = that database update has not been run yet (the column then says so).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { EnrollmentExportRow } from "@/lib/renewalEnrollment";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export interface EnrollmentState { recordId: string; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null; renewedAt: string | null }

/** Where the scholars of one page of the Renewed list stand (keyed by Scholar ID). */
export async function fetchEnrollmentStatus(schoolYear: string, term: string, ids: string[]): Promise<{ ok: true; states: Record<string, EnrollmentState> } | Failed> {
  if (ids.length === 0) return { ok: true, states: {} };
  const { data, error } = await supabase.rpc("renewal_enrollment_status", { p_school_year: schoolYear, p_term: term, p_ids: ids });
  if (error) return failed(error);
  const states: Record<string, EnrollmentState> = {};
  for (const r of (data ?? []) as Row[]) states[str(r.scholar_id_number)] = { recordId: str(r.record_id), confirmed: !!r.confirmed, confirmedAt: strOrNull(r.confirmed_at), confirmedBy: strOrNull(r.confirmed_by), renewedAt: strOrNull(r.renewed_at) };
  return { ok: true, states };
}

/** Tick (true) or untick (false). The answer is how the box stands now. */
export async function setEnrollmentConfirmed(recordId: string, confirmed: boolean): Promise<{ ok: true; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_enrollment_set", { p_record_id: recordId, p_confirmed: confirmed }).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "The change was not saved." };
  const r = data as Row;
  return { ok: true, confirmed: !!r.confirmed, confirmedAt: strOrNull(r.confirmed_at), confirmedBy: strOrNull(r.confirmed_by) };
}

export interface EnrollmentSummary { renewedInRange: number; confirmedInRange: number; termRenewed: number; termConfirmed: number; firstRenewed: string | null; lastRenewed: string | null }

/** The numbers for the export window (dates are "YYYY-MM-DD", Philippine days; empty = no limit). */
export async function fetchEnrollmentSummary(schoolYear: string, term: string, from: string, to: string): Promise<{ ok: true; summary: EnrollmentSummary } | Failed> {
  const { data, error } = await supabase.rpc("renewal_enrollment_summary", { p_school_year: schoolYear, p_term: term, p_from: from || null, p_to: to || null }).maybeSingle();
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return { ok: true, summary: { renewedInRange: num(r.renewed_in_range), confirmedInRange: num(r.confirmed_in_range), termRenewed: num(r.term_renewed), termConfirmed: num(r.term_confirmed), firstRenewed: strOrNull(r.first_renewed), lastRenewed: strOrNull(r.last_renewed) } };
}

/** Every scholar who is renewed in the dates and has the box ticked, read in pages of 1,000 (the most one answer can hold). */
export async function fetchEnrollmentExportRows(schoolYear: string, term: string, from: string, to: string): Promise<{ ok: true; rows: EnrollmentExportRow[] } | Failed> {
  const rows: EnrollmentExportRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("renewal_enrollment_export", { p_school_year: schoolYear, p_term: term, p_from: from || null, p_to: to || null, p_offset: offset, p_limit: PAGE });
    if (error) return failed(error);
    const page = (data ?? []) as Row[];
    rows.push(...page.map(r => ({
      scholarIdNumber: str(r.scholar_id_number), lastName: str(r.last_name), firstName: str(r.first_name), middleName: str(r.middle_name), yearLevel: str(r.year_level),
      program: str(r.program), barangay: str(r.barangay), school: str(r.school), renewedOn: str(r.renewed_on),
    })));
    if (page.length < PAGE) break;
    if (offset > 100000) break;      // a safety stop: far more than this project can have
  }
  return { ok: true, rows };
}
