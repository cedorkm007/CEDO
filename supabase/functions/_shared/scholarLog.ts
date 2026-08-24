import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/** Looks up the display name of the staff member performing an action, for the audit log. */
export async function getStaffName(admin: SupabaseClient, staffId: string): Promise<string> {
  const { data } = await admin.from("users").select("first_name, last_name").eq("id", staffId).maybeSingle();
  if (!data) return "Unknown staff";
  return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Unknown staff";
}

export type ScholarLogAction = "added" | "removed" | "reset" | "updated";
export type ScholarLogSource = "single" | "bulk" | "undo";

/**
 * Records one scholar-account change. Never throws — logging failures
 * shouldn't roll back or mask the actual account change that already
 * succeeded, so errors here are swallowed after a console log.
 */
export async function logScholarChange(admin: SupabaseClient, entry: {
  action: ScholarLogAction;
  scholarId: string | null;
  scholarIdNumber: string;
  scholarName: string;
  performedBy: string;
  performedByName: string;
  batchId?: string | null;
  source: ScholarLogSource;
  description?: string;
}): Promise<void> {
  const { error } = await admin.from("sead_scholar_account_log").insert({
    action: entry.action,
    scholar_id: entry.scholarId,
    scholar_id_number: entry.scholarIdNumber,
    scholar_name: entry.scholarName,
    performed_by: entry.performedBy,
    performed_by_name: entry.performedByName,
    batch_id: entry.batchId ?? null,
    source: entry.source,
    description: entry.description ?? null,
  });
  if (error) console.error("Failed to write scholar account log entry:", error.message);
}
