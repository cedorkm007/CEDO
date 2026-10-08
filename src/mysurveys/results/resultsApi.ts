import { supabase } from "@/lib/supabase";
import type { QuestionType, SurveyRole, SurveyStatus } from "../surveyTypes";

/**
 * Results for one survey, aggregated on the server by get_my_survey_results
 * (supabase_migration_my_surveys_results.sql). One row per question VERSION that
 * has answers (plus every current question), so the charts can say exactly
 * which wording each response answered.
 */

export interface ResultOption { optionId: string; label: string; count: number }

export interface ResultQuestion {
  questionId: string;
  questionKey: string;
  version: number;
  /** Replaced by a newer version, or removed from the survey. */
  archived: boolean;
  orderIndex: number;
  type: QuestionType;
  text: string;
  helpText: string;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  /** People who answered this version of the question. */
  answered: number;
  options: ResultOption[] | null;
  numbers: { value: number; count: number }[] | null;
  mean: number | null;
  median: number | null;
  values: { value: string; count: number }[] | null;
  textTotal: number | null;
  texts: { text: string; at: string }[] | null;
}

export interface SurveyResults {
  survey: {
    id: string;
    title: string;
    status: SurveyStatus;
    responseCount: number;
    firstResponseAt: string | null;
    lastResponseAt: string | null;
    role: SurveyRole;
  };
  timezone: string;
  timeline: { day: string; count: number }[];
  questions: ResultQuestion[];
}

export async function fetchSurveyResults(surveyId: string): Promise<{ ok: true; results: SurveyResults } | { ok: false; error: string }> {
  let timezone = "Asia/Manila";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch { /* keep the default */ }
  const { data, error } = await supabase.rpc("get_my_survey_results", { p_survey_id: surveyId, p_timezone: timezone });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the results." };
  return { ok: true, results: data as SurveyResults };
}

export const percent = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

// ── Grouping versions of the same question ──────────────────

export interface QuestionGroup {
  key: string;
  /** Oldest first. */
  versions: ResultQuestion[];
  /** The newest version (the current wording, or the last wording before it was removed). */
  latest: ResultQuestion;
  /** Every version is archived: the question is no longer in the survey. */
  removed: boolean;
  /** More than one version has answers. */
  multiVersion: boolean;
  /** All versions are the same kind of question, so their answers can be combined into one chart. */
  sameType: boolean;
}

export function groupQuestions(questions: ResultQuestion[]): QuestionGroup[] {
  const byKey = new Map<string, ResultQuestion[]>();
  for (const q of questions) {
    const list = byKey.get(q.questionKey) ?? [];
    list.push(q);
    byKey.set(q.questionKey, list);
  }
  const groups: QuestionGroup[] = [];
  for (const [key, list] of byKey) {
    const versions = [...list].sort((a, b) => a.version - b.version);
    const latest = versions[versions.length - 1];
    groups.push({
      key, versions, latest,
      removed: versions.every(v => v.archived),
      multiVersion: versions.length > 1,
      sameType: versions.every(v => v.type === latest.type),
    });
  }
  // The server already returns questions in survey order; keep it, by each group's newest version.
  const position = new Map(questions.map((q, i) => [q.questionId, i]));
  return groups.sort((a, b) => (position.get(a.latest.questionId) ?? 0) - (position.get(b.latest.questionId) ?? 0));
}

// ── Combining versions (only used when they are the same type) ──

export function combineOptions(versions: ResultQuestion[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  // Newest wording first so the current options keep their order; older-only options follow.
  for (const v of [...versions].reverse()) {
    for (const o of v.options ?? []) counts.set(o.label, (counts.get(o.label) ?? 0) + o.count);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

export function combineNumbers(versions: ResultQuestion[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const v of versions) for (const n of v.numbers ?? []) counts.set(n.value, (counts.get(n.value) ?? 0) + n.count);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
}

export function numberStats(dist: { value: number; count: number }[]): { n: number; mean: number | null; median: number | null } {
  const n = dist.reduce((s, d) => s + d.count, 0);
  if (n === 0) return { n: 0, mean: null, median: null };
  const mean = dist.reduce((s, d) => s + d.value * d.count, 0) / n;
  // Median of the expanded sample (middle value, or the average of the two middle ones).
  const at = (rank: number) => { let seen = 0; for (const d of dist) { seen += d.count; if (rank < seen) return d.value; } return dist[dist.length - 1].value; };
  const median = n % 2 === 1 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
  return { n, mean, median };
}

export function combineValues(versions: ResultQuestion[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of versions) for (const x of v.values ?? []) counts.set(x.value, (counts.get(x.value) ?? 0) + x.count);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
}

export function combineTexts(versions: ResultQuestion[]): { text: string; at: string; version: number }[] {
  const all = versions.flatMap(v => (v.texts ?? []).map(t => ({ ...t, version: v.version })));
  return all.sort((a, b) => b.at.localeCompare(a.at));
}
