// ─────────────────────────────────────────────────────────────
// src/school/clearanceDownload.ts
// Downloads the pre-filled clearances (src/lib/clearanceForm.ts) for the scholars the School Portal's Renewal tab is showing who have an INC or a failed grade. It reads what the form needs
// that the Renewal tab does not carry (the scholars' contact numbers and the GWA of the semester that is judged, under the school's own rules for it) and hands it to the form.
// ─────────────────────────────────────────────────────────────
import { saveAs } from "file-saver";
import { supabase } from "@/lib/supabase";
import { termLabelOf } from "@/lib/renewal";
import { rulesAt } from "@/lib/rulesRuntime";
import { fetchRulesTimeline } from "@/lib/gradeRulesApi";
import { buildClearanceDocx, buildClearancePdf, clearanceEntryFor, type ClearanceEntry, type ClearanceLogo } from "@/lib/clearanceForm";
import { base64ToBytes } from "@/lib/logoImage";
import { fetchSchoolLogo } from "./logoApi";
import templateUrl from "@/assets/ClearanceTemplate.docx?url";
import { fetchGradingConfig, fetchGradesForScholars, fetchLetterGrades, fetchSchoolMarksAsLetters } from "./schoolApi";
import { summarizeScholarGrades, groupByScholar } from "./gradeSaveLogic";
import type { SchoolRenewalRow } from "./renewalMonitorLogic";
import type { LetterGrade } from "@/lib/gwa";

export type ClearanceFormat = "docx" | "pdf";
type Result = { ok: true; count: number } | { ok: false; error: string };

/** The sort the forms come out in: by last name, then first name, like the school's own lists. */
export const byName = (a: SchoolRenewalRow, b: SchoolRenewalRow): number => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

async function fetchContacts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("scholars").select("scholar_id_number, contact_no").in("scholar_id_number", ids.slice(i, i + 200));
    for (const r of data ?? []) out.set(String(r.scholar_id_number), r.contact_no == null ? "" : String(r.contact_no));
  }
  return out;
}

/** The details that go on each form, for these scholars, in name order. `basis` is the semester the renewal judges. */
export async function loadClearanceEntries(
  rows: SchoolRenewalRow[], opts: { schoolId: string; schoolName: string; basisSchoolYear: string; basisTerm: string },
): Promise<{ ok: true; entries: ClearanceEntry[] } | { ok: false; error: string }> {
  const sorted = [...rows].sort(byName);
  const ids = sorted.map(r => r.scholarIdNumber);
  const period = { schoolYear: opts.basisSchoolYear, semester: opts.basisTerm };
  const [grades, config, timeline, marks, contacts] = await Promise.all([
    opts.basisSchoolYear ? fetchGradesForScholars(ids, period) : Promise.resolve({ ok: true as const, rows: [] }),
    fetchGradingConfig(), fetchRulesTimeline(), fetchSchoolMarksAsLetters(opts.schoolId), fetchContacts(ids),
  ]);
  if (!grades.ok) return { ok: false, error: `Couldn't read the grades for the GWA: ${grades.error}` };
  const table: LetterGrade[] = config?.usesLetterGrades ? await fetchLetterGrades(opts.schoolId) : [];
  const letters = [...table, ...marks];
  const rules = rulesAt(timeline[opts.schoolId] ?? Object.values(timeline)[0] ?? [], opts.basisSchoolYear, opts.basisTerm);
  const byScholar = groupByScholar(grades.rows);
  const semester = opts.basisSchoolYear ? termLabelOf(opts.basisSchoolYear, opts.basisTerm) : "";
  const entries = sorted.map(r => clearanceEntryFor({
    firstName: r.firstName, middleName: r.middleName, lastName: r.lastName, contactNo: contacts.get(r.scholarIdNumber) ?? "", schoolName: opts.schoolName,
    gwaText: summarizeScholarGrades(byScholar.get(r.scholarIdNumber) ?? [], letters, rules, config, r.program).gwaText,
    program: r.program, yearLevel: r.yearLevel, semester, scholarIdNumber: r.scholarIdNumber,
  }));
  return { ok: true, entries };
}

/** The school's own logo for the letterhead, or null when it has none (or the logo update has not been run): the clearances then print without it. */
async function loadLogo(): Promise<ClearanceLogo | null> {
  const r = await fetchSchoolLogo();
  return r.ok && r.base64 ? { bytes: base64ToBytes(r.base64) } : null;
}

export const clearanceFileName = (format: ClearanceFormat, basisSchoolYear: string, basisTerm: string): string =>
  `Clearances_${[basisSchoolYear, basisTerm].filter(Boolean).join("_").replace(/\s+/g, "-")}.${format}`;

/** Builds the file and saves it. */
export async function downloadClearances(rows: SchoolRenewalRow[], format: ClearanceFormat, opts: { schoolId: string; schoolName: string; basisSchoolYear: string; basisTerm: string }): Promise<Result> {
  if (rows.length === 0) return { ok: false, error: "There is nobody to make a clearance for." };
  try {
    const loaded = await loadClearanceEntries(rows, opts);
    if (!loaded.ok) return loaded;
    const [template, logo] = await Promise.all([fetch(templateUrl).then(r => r.arrayBuffer()), loadLogo()]);
    const bytes = format === "docx" ? buildClearanceDocx(template, loaded.entries, logo) : await buildClearancePdf(template, loaded.entries, logo);
    const type = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
    saveAs(new Blob([bytes as BlobPart], { type }), clearanceFileName(format, opts.basisSchoolYear, opts.basisTerm));
    return { ok: true, count: loaded.entries.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
