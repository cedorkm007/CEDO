// ─────────────────────────────────────────────────────────────
// src/lib/standing.ts
// Scholarship standing from a scholar's GWA and their school's retention requirement. Pure (no Supabase, no React), shared by
// the School Portal and the staff Scholars' Grades Monitoring tool so both show the same status.
//
// A school saves its requirement on its own grading scale (school_grading_configs.retention_threshold):
//   lower is better  e.g. "GWA 2.50 or better"  -> a GWA of 2.50 or lower keeps the scholarship
//   higher is better e.g. "85 or better"        -> a GWA of 85 or higher keeps the scholarship
//
// Good standing      comfortably on the right side of the requirement
// At risk            passing, but within the margin of the requirement (0.25 on a small scale such as 1-5,
//                    3 points on a larger one such as 60-100) — the margin itself counts as "at risk"
// Below requirement  on the wrong side of the requirement
// ─────────────────────────────────────────────────────────────

export type Standing = "good" | "at_risk" | "below";
/** What a screen shows: a real standing, or why there is none. */
export type StandingResult = Standing | "no_gwa" | "no_requirement";

export const STANDING_LABEL: Record<StandingResult, string> = {
  good: "Good standing",
  at_risk: "At risk",
  below: "Below requirement",
  no_gwa: "No GWA yet",
  no_requirement: "No requirement set",
};

export interface StandingConfig {
  scaleMin: number;
  scaleMax: number;
  direction: "lower_is_better" | "higher_is_better";
  retentionThreshold?: number | null;
}

/** 0.25 for a small scale (range up to 10, such as 1.0-5.0), 3 points for a larger one (such as 60-100). */
export function standingMargin(config: Pick<StandingConfig, "scaleMin" | "scaleMax">): number {
  return config.scaleMax - config.scaleMin <= 10 ? 0.25 : 3;
}

const EPS = 1e-9;

export function scholarStanding(gwa: number | null, config: StandingConfig | null | undefined): StandingResult {
  if (!config || config.retentionThreshold == null) return "no_requirement";
  if (gwa === null) return "no_gwa";
  const t = config.retentionThreshold;
  const margin = standingMargin(config);
  if (config.direction === "lower_is_better") {
    if (gwa > t + EPS) return "below";
    return gwa >= t - margin - EPS ? "at_risk" : "good";
  }
  if (gwa < t - EPS) return "below";
  return gwa <= t + margin + EPS ? "at_risk" : "good";
}

export function isRealStanding(s: StandingResult): s is Standing {
  return s === "good" || s === "at_risk" || s === "below";
}

export interface StandingCounts { good: number; atRisk: number; below: number; noGwa: number; noRequirement: number }

export function countStandings(results: StandingResult[]): StandingCounts {
  const c: StandingCounts = { good: 0, atRisk: 0, below: 0, noGwa: 0, noRequirement: 0 };
  for (const r of results) {
    if (r === "good") c.good++; else if (r === "at_risk") c.atRisk++; else if (r === "below") c.below++;
    else if (r === "no_gwa") c.noGwa++; else c.noRequirement++;
  }
  return c;
}

/** "Scholars keep their scholarship with a GWA of 2.50 or better" — read back to the school as it types the number. */
export function retentionSentence(config: Pick<StandingConfig, "direction">, threshold: number | null): string {
  if (threshold === null) return "No retention requirement saved. Standing will not be shown.";
  return `Scholars keep their scholarship with a GWA of ${threshold} or ${config.direction === "lower_is_better" ? "lower (better)" : "higher (better)"}.`;
}

/** What "At risk" means on this scale, in words. */
export function atRiskExplanation(config: StandingConfig): string {
  const margin = standingMargin(config);
  const t = config.retentionThreshold;
  if (t == null) return "";
  const edge = config.direction === "lower_is_better" ? t - margin : t + margin;
  return `At risk means passing but within ${margin} of the requirement (${config.direction === "lower_is_better" ? `a GWA from ${edge} up to ${t}` : `a GWA from ${t} up to ${edge}`}).`;
}
