// ─────────────────────────────────────────────────────────────
// src/sead/schoolGradingRulesApi.ts
// Scholars' Grades Monitoring > Grading rules: CEDO staff READ any school's grading rules (the conversion table, the passing marks, the GWA settings, the versions and the audit trail). Read-only:
// there is no call here that saves anything. `missing: true` = the database update (supabase_migration_school_grading_rules_*.sql) has not been run yet.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { parseOverview, parseVersion, type RulesOverview, type SavedVersion } from "@/lib/gradingRulesData";

type Failed = { ok: false; error: string; missing: boolean };
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export async function fetchSchoolRules(schoolId: string): Promise<{ ok: true; overview: RulesOverview } | Failed> {
  const { data, error } = await supabase.rpc("staff_school_grading_rules", { p_school_id: schoolId });
  if (error || !data) return error ? failed(error) : { ok: false, error: "Couldn't load this school's grading rules.", missing: false };
  return { ok: true, overview: parseOverview(data as Record<string, unknown>) };
}

export async function fetchSchoolRulesVersion(versionId: string): Promise<{ ok: true; version: SavedVersion } | Failed> {
  const { data, error } = await supabase.rpc("staff_school_grading_rules_version", { p_version_id: versionId });
  const v = error ? null : parseVersion(data as Record<string, unknown>);
  return v ? { ok: true, version: v } : error ? failed(error) : { ok: false, error: "Couldn't open those rules.", missing: false };
}
