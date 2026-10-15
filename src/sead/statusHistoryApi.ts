// ─────────────────────────────────────────────────────────────
// src/sead/statusHistoryApi.ts
// A scholar's scholarship-status history (Regular, Probationary, On leave, Reconsidered, Removed): every change with when, the
// term, who changed it and how, and whether it was TEMPORARY probation (INC) — see scholar_status_history in
// supabase_migration_renewal_p1_foundations.sql. Read-only here; the database records every change by itself.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

export interface StatusHistoryEntry {
  id: string;
  status: string;
  previousStatus: string | null;
  isTemporary: boolean;
  schoolYear: string;
  term: string;
  changedByName: string;
  changedAt: string;
  source: string;
  note: string;
}

export const STATUS_SOURCE_LABEL: Record<string, string> = {
  manual: "Changed by staff",
  bulk: "Bulk update",
  referral: "Referral approval",
  removal: "Removed flow",
  renewal: "Scholar renewal",
  system: "System",
  baseline: "Status when history started (date unknown)",
  counseling_record: "From a counseling visit record",
};

export async function fetchScholarStatusHistory(scholarIdNumber: string): Promise<{ ok: true; rows: StatusHistoryEntry[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("scholar_status_history_for", { p_scholar_id_number: scholarIdNumber });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), status: String(r.status), previousStatus: r.previous_status == null ? null : String(r.previous_status),
    isTemporary: !!r.is_temporary, schoolYear: String(r.school_year ?? ""), term: String(r.term ?? ""),
    changedByName: String(r.changed_by_name ?? ""), changedAt: String(r.changed_at ?? ""), source: String(r.source ?? ""), note: String(r.note ?? ""),
  })) };
}
