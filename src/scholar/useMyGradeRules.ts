import { useEffect, useState } from "react";
import type { GradeRules } from "@/lib/gradeCheck";
import { fetchMyGradingConfig, fetchMyLetterGrades, fetchMySchoolMarks } from "./scholarApi";

/** The scholar's own school's grading setup (scale, letters, other marks), loaded once and kept; null until it is known (or when the school has none yet: then only the symbol rule is checked). */
let cached: GradeRules | null | undefined;
let pending: Promise<GradeRules | null> | null = null;
export function loadMyGradeRules(): Promise<GradeRules | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  pending ??= (async () => {
    try {
      const [cfg, letters, marks] = await Promise.all([fetchMyGradingConfig(), fetchMyLetterGrades(), fetchMySchoolMarks()]);
      cached = cfg ? { scaleMin: cfg.scaleMin, scaleMax: cfg.scaleMax, usesLetterGrades: cfg.usesLetterGrades, letters: letters.map(l => l.letter), marks: marks.map(m => m.letter) } : null;
    } catch { cached = null; }
    return cached ?? null;
  })();
  return pending;
}

export function useMyGradeRules(): GradeRules | null {
  const [rules, setRules] = useState<GradeRules | null>(cached ?? null);
  useEffect(() => { let live = true; void loadMyGradeRules().then(r => { if (live) setRules(r); }); return () => { live = false; }; }, []);
  return rules;
}
