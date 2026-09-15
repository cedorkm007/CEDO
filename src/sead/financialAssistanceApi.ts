import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────

export const FA_SEMESTERS = ["1st Semester", "2nd Semester", "Summer"] as const;
export type FaSemester = (typeof FA_SEMESTERS)[number];

export const FA_MODES_OF_APPLICATION = ["Walk-in", "People's Day"] as const;
export type FaModeOfApplication = (typeof FA_MODES_OF_APPLICATION)[number];

export type FaStatus = "processing" | "approved";

export interface FinancialAssistancePeriod {
  id: string;
  academicYear: string;
  semester: FaSemester;
  isActive: boolean;
  createdAt: string;
}

export interface FinancialAssistanceApplicant {
  id: string;
  periodId: string;
  referenceNumber: string;
  name: string;
  barangay: string;
  school: string;
  program: string;
  yearLevel: string;
  vulnerableSector: string;
  modeOfApplication: FaModeOfApplication | "";
  fatherName: string;
  motherName: string;
  status: FaStatus;
  appliedAt: string;
  approvedAt: string | null;
}

export interface NewFinancialAssistanceApplicantInput {
  periodId: string;
  name: string;
  barangay: string;
  school: string;
  program: string;
  yearLevel: string;
  vulnerableSector: string;
  modeOfApplication: string;
  fatherName: string;
  motherName: string;
}

function periodLabel(p: { academicYear: string; semester: string }): string {
  return `${p.academicYear} - ${p.semester}`;
}
export { periodLabel as formatPeriodLabel };

// ── Periods ───────────────────────────────────────────────────

export async function fetchFinancialAssistancePeriods(): Promise<FinancialAssistancePeriod[]> {
  const { data, error } = await supabase
    .from("financial_assistance_periods")
    .select("id, academic_year, semester, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, academicYear: r.academic_year, semester: r.semester as FaSemester,
    isActive: r.is_active, createdAt: r.created_at,
  }));
}

export async function createFinancialAssistancePeriod(academicYear: string, semester: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.rpc("create_financial_assistance_period", { p_academic_year: academicYear, p_semester: semester });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

// ── Applicants ────────────────────────────────────────────────

function rowToApplicant(r: Record<string, unknown>): FinancialAssistanceApplicant {
  return {
    id: String(r.id),
    periodId: String(r.period_id),
    referenceNumber: String(r.reference_number ?? ""),
    name: String(r.name ?? ""),
    barangay: String(r.barangay ?? ""),
    school: String(r.school ?? ""),
    program: String(r.program ?? ""),
    yearLevel: String(r.year_level ?? ""),
    vulnerableSector: String(r.vulnerable_sector ?? ""),
    modeOfApplication: (r.mode_of_application as FaModeOfApplication | null) ?? "",
    fatherName: String(r.father_name ?? ""),
    motherName: String(r.mother_name ?? ""),
    status: (r.status as FaStatus) ?? "processing",
    appliedAt: String(r.applied_at ?? ""),
    approvedAt: (r.approved_at as string | null) ?? null,
  };
}

const APPLICANT_COLUMNS = "id, period_id, reference_number, name, barangay, school, program, year_level, vulnerable_sector, mode_of_application, father_name, mother_name, status, applied_at, approved_at";

export async function fetchFinancialAssistanceApplicants(periodId: string): Promise<FinancialAssistanceApplicant[]> {
  const { data, error } = await supabase
    .from("financial_assistance_applicants")
    .select(APPLICANT_COLUMNS)
    .eq("period_id", periodId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(rowToApplicant);
}

export async function createFinancialAssistanceApplicant(input: NewFinancialAssistanceApplicantInput): Promise<{ ok: boolean; error?: string; id?: string; referenceNumber?: string }> {
  const { data, error } = await supabase.rpc("create_financial_assistance_applicant", {
    p_period_id: input.periodId, p_name: input.name, p_barangay: input.barangay || null,
    p_school: input.school || null, p_program: input.program || null, p_year_level: input.yearLevel || null,
    p_vulnerable_sector: input.vulnerableSector || null, p_mode_of_application: input.modeOfApplication,
    p_father_name: input.fatherName || null, p_mother_name: input.motherName || null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data as { id: string; reference_number: string }[] | null)?.[0];
  if (!row) return { ok: false, error: "Failed to create applicant." };
  return { ok: true, id: row.id, referenceNumber: row.reference_number };
}

export async function updateFinancialAssistanceApplicant(id: string, input: Omit<NewFinancialAssistanceApplicantInput, "periodId">): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("financial_assistance_applicants").update({
    name: input.name, barangay: input.barangay || null, school: input.school || null,
    program: input.program || null, year_level: input.yearLevel || null,
    vulnerable_sector: input.vulnerableSector || null, mode_of_application: input.modeOfApplication,
    father_name: input.fatherName || null, mother_name: input.motherName || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setFinancialAssistanceApplicantStatus(id: string, status: FaStatus): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_financial_assistance_applicant_status", { p_applicant_id: id, p_status: status });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteFinancialAssistanceApplicant(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("financial_assistance_applicants").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Approved-instructions settings ───────────────────────────

export async function fetchFinancialAssistanceApprovedInstructions(): Promise<string> {
  const { data, error } = await supabase.from("financial_assistance_settings").select("approved_instructions").eq("id", true).maybeSingle();
  if (error || !data) return "";
  return data.approved_instructions ?? "";
}

export async function setFinancialAssistanceApprovedInstructions(text: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_financial_assistance_approved_instructions", { p_text: text });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Scholarship Program Information summary (read-only) ─────
// Gated by is_scholarship_program_staff() server-side, not
// is_financial_assistance_staff() — this powers the read-only summary
// tab inside Scholarship Program Information, not the management tool.

export interface FinancialAssistanceStatusCounts {
  processing: number;
  approved: number;
  total: number;
}

export async function fetchFinancialAssistanceStatusCounts(periodId: string): Promise<FinancialAssistanceStatusCounts | null> {
  const { data, error } = await supabase.rpc("financial_assistance_status_counts", { p_period_id: periodId }).maybeSingle();
  if (error || !data) return null;
  const row = data as { processing_count: number; approved_count: number; total_count: number };
  return { processing: Number(row.processing_count), approved: Number(row.approved_count), total: Number(row.total_count) };
}

export interface FinancialAssistanceGroupCount { label: string; count: number }

export async function fetchFinancialAssistanceByBarangay(periodId: string): Promise<FinancialAssistanceGroupCount[]> {
  const { data, error } = await supabase.rpc("financial_assistance_by_barangay", { p_period_id: periodId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ label: String(r.barangay), count: Number(r.applicant_count) }));
}

export async function fetchFinancialAssistanceBySchool(periodId: string): Promise<FinancialAssistanceGroupCount[]> {
  const { data, error } = await supabase.rpc("financial_assistance_by_school", { p_period_id: periodId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ label: String(r.school), count: Number(r.applicant_count) }));
}
