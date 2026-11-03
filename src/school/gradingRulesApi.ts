// ─────────────────────────────────────────────────────────────
// src/school/gradingRulesApi.ts
// The School Portal's grading rules (the conversion table, the passing mark, the GWA settings): read the school's own rules and save a new version.
// The database (supabase_migration_school_grading_rules_a_tables.sql and _c_functions.sql) checks every save again and decides where it starts.
// `missing: true` = that database update has not been run yet (the tab then says so).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { parseOverview, parseVersion, type RulesOverview, type SavedVersion } from "@/lib/gradingRulesData";
import type { GradingRules } from "@/lib/gradingRules";
import type { Impact } from "@/lib/gradingImpact";

type Failed = { ok: false; error: string; missing: boolean };
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export async function fetchRulesOverview(): Promise<{ ok: true; overview: RulesOverview } | Failed> {
  const { data, error } = await supabase.rpc("school_grading_rules_overview");
  if (error || !data) return error ? failed(error) : { ok: false, error: "Couldn't load your grading rules.", missing: false };
  return { ok: true, overview: parseOverview(data as Record<string, unknown>) };
}

export async function fetchRulesVersion(versionId: string): Promise<{ ok: true; version: SavedVersion } | Failed> {
  const { data, error } = await supabase.rpc("school_grading_rules_version", { p_version_id: versionId });
  const v = error ? null : parseVersion(data as Record<string, unknown>);
  return v ? { ok: true, version: v } : error ? failed(error) : { ok: false, error: "Couldn't open those rules.", missing: false };
}

/** Saves a new version of the rules. The school sees the result: which version, and where it starts. */
export async function saveRules(rules: GradingRules, impact: Impact & { period: string }, note: string): Promise<{ ok: true; versionNo: number; startsYear: string; startsTerm: string; reason: string } | Failed> {
  const { data, error } = await supabase.rpc("school_grading_rules_save", { p_rules: rules, p_impact: impact, p_note: note.trim() || null });
  if (error || !data) return error ? failed(error) : { ok: false, error: "Couldn't save the rules.", missing: false };
  const d = data as Record<string, unknown>;
  return { ok: true, versionNo: Number(d.versionNo), startsYear: String(d.startsYear), startsTerm: String(d.startsTerm), reason: String(d.reason) };
}
