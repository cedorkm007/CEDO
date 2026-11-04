// ─────────────────────────────────────────────────────────────
// src/lib/gradeRulesApi.ts
// Reads which grading rules applied to which semester (grading_rules_timeline). Used by every screen that shows a GWA, a standing or a Passed / Failed:
// the school (its own rules), a scholar (their school's), CEDO staff (any school). A failed read, or the database update not yet run, gives no rules, so the screens work the old way.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase";
import { parseTimeline, type SchoolRulesMap } from "./rulesRuntime";

export async function fetchRulesTimeline(schoolIds?: string[]): Promise<SchoolRulesMap> {
  const { data, error } = await supabase.rpc("grading_rules_timeline", schoolIds && schoolIds.length ? { p_school_ids: schoolIds } : {});
  if (error || !data) return {};
  return parseTimeline(data);
}
