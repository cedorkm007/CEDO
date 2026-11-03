import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, GripVertical, History, Info, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { fieldClass, focusRing } from "./portalParts";
import { SchoolDialog } from "./SchoolDialog";
import { GradingRulesView, SampleBox } from "@/app/components/GradingRulesView";
import { fetchOwnScholars, fetchGradesForScholars, fetchGradingConfig, fetchLetterGrades, fetchSchoolMarksAsLetters } from "../schoolApi";
import { fetchRulesOverview, fetchRulesVersion, saveRules } from "../gradingRulesApi";
import { computeImpact, impactText, NO_IMPACT, type Impact } from "@/lib/gradingImpact";
import { MARK_OUTCOME_LABEL } from "../types";
import {
  ENTRY_MODE_LABEL, PRESETS, bandResult, describeChanges, periodRank, startFor, tryPercentage, validateRules,
  type EntryMode, type GradingProblem, type RulesPreset, type RuleScale,
} from "@/lib/gradingRules";
import {
  draftFromRules, newKey, parseNum, rulesFromDraft, sameRules, sortBandDrafts,
  type AuditEntry, type BandDraft, type RulesDraft, type RulesOverview, type SavedVersion,
} from "@/lib/gradingRulesData";
import { formatDateTime } from "@/lib/renewal";
import { periodTitle } from "@/lib/academicPeriods";
import type { SchoolMark, SchoolScholarRow } from "../types";

/** Rules are saved here but the rest of the website does not use them yet (Phase 2). The notice goes away when that switches on. */
const RULES_IN_USE = false;

const card = "bg-white border border-[#e6ecf5] rounded-xl p-5";
const th = "text-left px-2.5 py-2.5 font-bold text-[13px] uppercase tracking-wide text-slate-800 whitespace-nowrap";
const when = (y: string, t: string) => periodTitle({ schoolYear: y, semester: t });
const YEAR_STARTS: Record<string, string> = {
  now: "the current period",
  period_submitted: "the next period, because the current period is already submitted and a submitted period never changes",
  period_not_open: "the next period, because the current period is not open",
};

/**
 * The Grading System tab's new part: the grade conversion table (with the passing mark, and the programs that have their own), how grades are entered, and the GWA computation.
 * The rules are saved as numbered versions that start at a period (the database decides which one); before a save that touches a period with grades, the school is shown how many grades and
 * GWAs would change and confirms. Every save goes in the audit trail. Phase 1 only saves the rules: grade entry, the GWA on every screen and renewal switch to them in Phase 2.
 */
export function GradingRulesPanel({ schoolId, formScale, formMarks, scaleDirty, scaleSaved, onApplyPreset }: {
  schoolId: string;
  /** The scale as typed in the form above (saved or not). */
  formScale: RuleScale;
  formMarks: SchoolMark[];
  /** The scale, letters or marks above were changed and not saved yet. */
  scaleDirty: boolean;
  scaleSaved: boolean;
  /** Puts a template's scale (and letters, and the old passing mark) into the form above. */
  onApplyPreset: (p: RulesPreset) => void;
}) {
  const [overview, setOverview] = useState<RulesOverview | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [scholars, setScholars] = useState<SchoolScholarRow[]>([]);
  const [touched, setTouched] = useState(false);
  const [problems, setProblems] = useState<GradingProblem[] | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetPick, setPresetPick] = useState<RulesPreset | null>(null);
  const [tryText, setTryText] = useState("");
  const [tryProgram, setTryProgram] = useState("");
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ rules: ReturnType<typeof rulesFromDraft>; impact: Impact; text: string; changes: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  const [viewing, setViewing] = useState<SavedVersion | null>(null);
  const [viewError, setViewError] = useState("");
  const dragKey = useRef<number | null>(null);
  const checksRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetchRulesOverview();
    if (!r.ok) { if (r.missing) setMissing(true); else setLoadError(r.error); return; }
    setOverview(r.overview);
    setDraft(d => d ?? draftFromRules(r.overview.latest?.rules ?? null));
  }, []);
  useEffect(() => { void load(); void fetchOwnScholars(schoolId).then(setScholars); }, [load, schoolId]);

  const marksKnown = useMemo(() => formMarks.map(m => m.mark.trim()).filter(Boolean), [formMarks]);
  const programs = useMemo(() => Array.from(new Set(scholars.map(s => s.course.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [scholars]);
  const sortedBands = useMemo(() => (draft ? sortBandDrafts(draft.bands) : []), [draft]);
  const rankOf = useCallback((key: number) => sortedBands.findIndex(b => b.key === key) + 1, [sortedBands]);
  const rules = useMemo(() => (draft ? rulesFromDraft({ ...draft, bands: sortedBands }) : null), [draft, sortedBands]);
  const liveProblems = useMemo(() => (rules ? validateRules(rules, formScale, marksKnown) : []), [rules, formScale, marksKnown]);
  const latestRules = overview?.latest?.rules ?? null;
  const unchanged = !!rules && (latestRules ? sameRules(rules, latestRules) : sameRules(rules, rulesFromDraft(draftFromRules(null))));
  const problemRows = new Set((problems ?? liveProblems).filter(p => p.row != null).map(p => p.row as number));

  function change(patch: Partial<RulesDraft>) { setDraft(d => (d ? { ...d, ...patch } : d)); setTouched(true); setProblems(null); setSaved(""); }
  const setBand = (key: number, patch: Partial<BandDraft>) => change({ bands: draft!.bands.map(b => (b.key === key ? { ...b, ...patch } : b)) });
  const resort = () => setDraft(d => (d ? { ...d, bands: sortBandDrafts(d.bands) } : d));

  function onDrop(targetKey: number) {
    const from = dragKey.current; dragKey.current = null;
    if (from == null || from === targetKey || !draft) return;
    const list = [...draft.bands], i = list.findIndex(b => b.key === from), j = list.findIndex(b => b.key === targetKey);
    const [moved] = list.splice(i, 1); list.splice(j, 0, moved);
    change({ bands: list });
  }

  // ── "Try a grade" ──
  const tryResult = useMemo(() => {
    const p = parseNum(tryText);
    if (!rules || Number.isNaN(p) || p > 100) return null;
    return tryPercentage(p, rules, tryProgram || null);
  }, [tryText, tryProgram, rules]);
  const tryProblem = tryText.trim() !== "" && (Number.isNaN(parseNum(tryText)) || parseNum(tryText) > 100) ? "Type a percentage from 0 to 100." : "";
  const tableReady = !!rules && rules.bands.length > 0 && liveProblems.filter(p => !p.code.startsWith("gwa") && !p.code.startsWith("special") && !p.code.startsWith("excluded") && !p.code.startsWith("retention")).length === 0;

  // ── Templates ──
  function useTemplate(p: RulesPreset) {
    const next = draftFromRules({ entryMode: p.rules.entryMode, passingMarkPct: p.rules.passingMarkPct, programPassing: [], bands: p.rules.bands.map(b => ({ ...b })), gwa: rulesFromDraft(draft!).gwa });
    setDraft({ ...next, programs: [], special: draft!.special });
    onApplyPreset(p);
    setPresetPick(null); setPresetOpen(false); setTouched(true); setProblems(null); setSaved("");
  }

  // ── Review and save ──
  async function review() {
    if (!draft || !overview) return;
    setSaved(""); setSaveError("");
    const sorted = sortBandDrafts(draft.bands);
    setDraft({ ...draft, bands: sorted });
    const r = rulesFromDraft({ ...draft, bands: sorted });
    const found = validateRules(r, formScale, marksKnown);
    if (found.length > 0) { setProblems(found); setTimeout(() => checksRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); return; }
    setProblems(null); setChecking(true);
    const starts = overview.startsAt!;
    let impact: Impact = { ...NO_IMPACT };
    try {
      const [config, letters, marks] = await Promise.all([fetchGradingConfig(), fetchLetterGrades(schoolId), fetchSchoolMarksAsLetters(schoolId)]);
      if (config) {
        const own = await fetchOwnScholars(schoolId);
        const g = await fetchGradesForScholars(own.map(s => s.scholarIdNumber), { schoolYear: starts.schoolYear, semester: starts.term });
        const before = overview.latest && periodRank(overview.latest.effectiveYear, overview.latest.effectiveTerm) <= periodRank(starts.schoolYear, starts.term) ? overview.latest.rules : (overview.active?.rules ?? null);
        if (g.ok) impact = computeImpact(own.map(s => ({ scholarIdNumber: s.scholarIdNumber, program: s.course })), g.rows.map(x => ({ scholarIdNumber: x.scholarIdNumber, grade: x.grade, units: x.units, excludeFromGwa: x.excludeFromGwa })), config, [...letters, ...marks], formScale, before, r);
      }
    } catch { /* the preview is a help: if it cannot be worked out the school is told so below */ }
    setChecking(false);
    setNote("");
    setPending({ rules: r, impact, text: impactText(impact), changes: describeChanges(latestRules, r) });
  }

  async function confirmSave() {
    if (!pending || !overview) return;
    setSaving(true); setSaveError("");
    const starts = overview.startsAt!;
    const res = await saveRules(pending.rules, { ...pending.impact, period: when(starts.schoolYear, starts.term) }, note);
    setSaving(false);
    if (!res.ok) { setSaveError(res.missing ? "CEDO still has to run a database update before the rules can be saved." : res.error); return; }
    setPending(null);
    setSaved(`Saved as version ${res.versionNo}. It starts with ${when(res.startsYear, res.startsTerm)}.`);
    setTouched(false);
    const o = await fetchRulesOverview();
    if (o.ok) { setOverview(o.overview); setDraft(draftFromRules(o.overview.latest?.rules ?? null)); }
  }

  async function openVersion(id: string) {
    setViewError("");
    const r = await fetchRulesVersion(id);
    if (r.ok) setViewing(r.version); else setViewError(r.error);
  }

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[14.5px] text-amber-950">The grade conversion table and the GWA settings need a database update from CEDO (supabase_migration_school_grading_rules_a_tables.sql and _c_functions.sql). Until it is done, this part cannot be used.</p>;
  if (loadError) return <p role="alert" className="text-[14.5px] text-red-800">{loadError}</p>;
  if (!overview || !draft || !rules) return <p className="text-[14.5px] text-slate-800 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  const starts = overview.startsAt;
  const passing = rules.passingMarkPct;
  const blocked = !scaleSaved ? "Save your grading scale above first." : scaleDirty ? "You changed the scale, letters or marks above. Press Save grading system above first, then save the rules." : !starts ? "CEDO has not set the current grading period yet, so the rules cannot be saved." : "";

  return (
    <div className="space-y-5 max-w-5xl">
      {!RULES_IN_USE && (
        <p className="flex items-start gap-2 text-[14.5px] text-sky-950 bg-sky-50 border border-sky-300 rounded-lg px-3.5 py-2.5" role="note">
          <Info size={16} className="shrink-0 mt-1" aria-hidden="true" />
          <span><strong>Saved for later use.</strong> You can set up and save the conversion table and the GWA settings now. Entering grades, the GWA shown on every screen and the renewal check will switch to them in the next update, so nothing changes for your scholars yet.</span>
        </p>
      )}
      {starts && (
        <p className="text-[14.5px] text-slate-900">New rules would start with <strong>{when(starts.schoolYear, starts.term)}</strong> — {YEAR_STARTS[starts.reason]}.
          {overview.active ? <> Rules in use now: version {overview.active.versionNo}.</> : <> No rules are in use yet: today's way (the passing mark on your scale) still applies.</>}</p>
      )}

      {/* 1. How grades are entered + the conversion table */}
      <section className={card} aria-labelledby="conv-title">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 id="conv-title" className="text-[17px] font-bold text-[#062444]">Grade conversion table</h3>
            <p className="text-[14.5px] text-slate-800 mt-0.5">One row per grade band: the percentage range, the equivalent grade and your own remarks. The result (Passed or Failed) comes from your passing mark.</p>
          </div>
          <div className="relative">
            <button onClick={() => setPresetOpen(o => !o)} aria-expanded={presetOpen} className={`inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc] ${focusRing}`}>
              <Sparkles size={15} aria-hidden="true" /> Start from a common template
            </button>
            {presetOpen && (
              <div role="dialog" aria-label="Templates" className="absolute right-0 z-20 mt-2 w-[min(26rem,90vw)] rounded-xl border border-[#062444]/20 bg-white p-3 shadow-xl">
                {!presetPick ? (
                  <ul className="space-y-1.5">
                    {PRESETS.map(p => (
                      <li key={p.key}><button onClick={() => setPresetPick(p)} className={`w-full rounded-lg border border-[#062444]/20 px-3 py-2 text-left hover:bg-[#f7f9fc] ${focusRing}`}><span className="block text-[14px] font-semibold text-[#062444]">{p.label}</span><span className="block text-[13.5px] text-slate-800">{p.description}</span></button></li>
                    ))}
                  </ul>
                ) : (
                  <div>
                    <p className="text-[14.5px] font-bold text-[#062444]">{presetPick.label}</p>
                    <p className="mt-1 text-[14px] text-slate-800">This fills in the table below{draft.bands.length > 0 ? " and replaces the rows you have now" : ""}, and sets the scale above to {presetPick.scale.scaleMin} to {presetPick.scale.scaleMax} ({presetPick.scale.direction === "lower_is_better" ? "lower" : "higher"} is better){presetPick.letters.length ? " with the letters A to F" : ""}. Nothing is saved until you press the Save buttons. You can edit everything afterwards.</p>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => useTemplate(presetPick)} className={`rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-semibold text-white ${focusRing}`}>Use this template</button>
                      <button onClick={() => setPresetPick(null)} className={`rounded-lg border border-[#062444]/30 px-3.5 py-2 text-[14px] font-semibold text-[#062444] ${focusRing}`}>Back</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <fieldset className="mb-4">
          <legend className="text-[14px] font-semibold text-[#062444] mb-1.5">How grades are entered</legend>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(ENTRY_MODE_LABEL) as EntryMode[]).map(m => (
              <label key={m} className="flex items-center gap-2 text-[14.5px] text-slate-900">
                <input type="radio" name="entry-mode" className="h-4 w-4 accent-[#062444]" checked={draft.entryMode === m} onChange={() => change({ entryMode: m })} /> {ENTRY_MODE_LABEL[m]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[14px] text-slate-700">Entering percentages needs the table. With the equivalent grade (as today) nothing changes in how you enter grades.</p>
        </fieldset>

        <div className="mb-4">
          <label htmlFor="passing-pct" className="block text-[14px] font-semibold text-[#062444] mb-1">Passing mark (%)</label>
          <input id="passing-pct" inputMode="decimal" value={draft.passing} onChange={e => change({ passing: e.target.value })} placeholder="e.g. 75" className={`${fieldClass} w-32`} />
          <p className="mt-1.5 text-[14px] text-slate-800">{passing != null && !Number.isNaN(passing) && passing > 0 && passing <= 100
            ? <strong className="text-[#062444]">A percentage of {passing} or higher is Passed; anything below {passing} is Failed.</strong>
            : "A percentage equal to the passing mark or higher is Passed; anything below it is Failed. Needed when you have a table."}</p>
        </div>

        <div className="mb-4">
          <p className="text-[14px] font-semibold text-[#062444] mb-1">Programs with a different passing mark</p>
          <p className="text-[14px] text-slate-800 mb-2">Only list the programs whose passing mark is not the one above. Other programs use the passing mark above.</p>
          {draft.programs.map(p => (
            <div key={p.key} className="flex flex-wrap items-center gap-2 mb-2">
              <input list="school-programs" value={p.program} onChange={e => change({ programs: draft.programs.map(x => (x.key === p.key ? { ...x, program: e.target.value } : x)) })} placeholder="Program name" aria-label="Program" className={`${fieldClass} w-72 max-w-full`} />
              <input inputMode="decimal" value={p.passing} onChange={e => change({ programs: draft.programs.map(x => (x.key === p.key ? { ...x, passing: e.target.value } : x)) })} placeholder="Passing %" aria-label={`Passing mark of ${p.program || "the program"}`} className={`${fieldClass} w-28`} />
              <button onClick={() => change({ programs: draft.programs.filter(x => x.key !== p.key) })} aria-label={`Remove ${p.program || "this program"}`} className={`p-1.5 rounded text-slate-800 hover:text-red-700 ${focusRing}`}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
          ))}
          <datalist id="school-programs">{programs.map(p => <option key={p} value={p} />)}</datalist>
          <button onClick={() => change({ programs: [...draft.programs, { key: newKey(), program: "", passing: "" }] })} className={`inline-flex items-center gap-1 text-[14.5px] font-semibold text-[#0077b6] hover:underline rounded ${focusRing}`}><Plus size={14} aria-hidden="true" /> Add a program</button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#e6ecf5]">
          <table className="w-full min-w-[780px] text-[14.5px]">
            <caption className="sr-only">Grade conversion table: percentage range, equivalent grade, remarks and result</caption>
            <thead className="bg-[#f7f9fc]"><tr>
              <th scope="col" className={th}><span className="sr-only">Move</span></th><th scope="col" className={th}>Row</th><th scope="col" className={th}>From (%)</th><th scope="col" className={th}>To (%)</th><th scope="col" className={th}>Equivalent grade</th><th scope="col" className={th}>Remarks</th><th scope="col" className={th}>Result</th><th scope="col" className={th}><span className="sr-only">Delete</span></th>
            </tr></thead>
            <tbody>
              {draft.bands.length === 0 && <tr><td colSpan={8} className="px-3 py-5 text-center text-slate-800">No rows yet. Add a row, or start from a common template.</td></tr>}
              {draft.bands.map(b => {
                const rank = rankOf(b.key);
                const f = parseNum(b.from), t = parseNum(b.to);
                const res = !Number.isNaN(f) && passing != null && !Number.isNaN(passing) ? bandResult({ from: f, to: t, equivalentGrade: "", remarks: "" }, passing) : null;
                return (
                  <tr key={b.key} draggable onDragStart={() => { dragKey.current = b.key; }} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(b.key)}
                    className={`border-t border-[#f0f3f8] align-top ${problemRows.has(rank) ? "bg-red-50" : ""}`}>
                    <td className="px-2 py-2 text-slate-700 cursor-grab" title="Drag to move this row"><GripVertical size={16} aria-hidden="true" /></td>
                    <td className="px-2.5 py-2 text-slate-800">{rank || "—"}</td>
                    <td className="px-2 py-1.5"><input inputMode="decimal" value={b.from} onChange={e => setBand(b.key, { from: e.target.value })} onBlur={resort} aria-label={`Row ${rank}: from percentage`} className={`${fieldClass} w-24`} /></td>
                    <td className="px-2 py-1.5"><input inputMode="decimal" value={b.to} onChange={e => setBand(b.key, { to: e.target.value })} onBlur={resort} aria-label={`Row ${rank}: to percentage`} className={`${fieldClass} w-24`} /></td>
                    <td className="px-2 py-1.5"><input value={b.grade} onChange={e => setBand(b.key, { grade: e.target.value })} maxLength={12} aria-label={`Row ${rank}: equivalent grade`} className={`${fieldClass} w-24`} /></td>
                    <td className="px-2 py-1.5"><input value={b.remarks} onChange={e => setBand(b.key, { remarks: e.target.value })} maxLength={40} placeholder="e.g. Excellent" aria-label={`Row ${rank}: remarks`} className={`${fieldClass} w-full min-w-[9rem]`} /></td>
                    <td className="px-2.5 py-2">{res ? <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${res === "passed" ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"}`}>{res === "passed" ? "Passed" : "Failed"}</span> : <span className="text-slate-700">—</span>}</td>
                    <td className="px-2 py-1.5"><button onClick={() => change({ bands: draft.bands.filter(x => x.key !== b.key) })} aria-label={`Delete row ${rank}`} className={`p-1.5 rounded text-slate-800 hover:text-red-700 ${focusRing}`}><Trash2 size={16} aria-hidden="true" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button onClick={() => change({ bands: [...draft.bands, { key: newKey(), from: "", to: "", grade: "", remarks: "" }] })} className={`inline-flex items-center gap-1 text-[14.5px] font-semibold text-[#0077b6] hover:underline rounded ${focusRing}`}><Plus size={14} aria-hidden="true" /> Add row</button>
          <span className="text-[14px] text-slate-800">Rows list themselves from the highest percentage to the lowest. Both ends of a row are included, with up to 2 decimals (for example 75.00 to 76.99).</span>
        </div>

        {/* Try a grade */}
        <div className="mt-4 rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3">
          <p className="text-[14px] font-bold text-[#062444] mb-1.5">Try a grade</p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="try-pct" className="text-[14px] text-slate-900">Percentage</label>
            <input id="try-pct" inputMode="decimal" value={tryText} onChange={e => setTryText(e.target.value)} placeholder="e.g. 87.5" className={`${fieldClass} w-28`} />
            {(programs.length > 0 || draft.programs.length > 0) && (
              <>
                <label htmlFor="try-program" className="text-[14px] text-slate-900">Program (optional)</label>
                <select id="try-program" value={tryProgram} onChange={e => setTryProgram(e.target.value)} className={fieldClass}>
                  <option value="">Any program</option>
                  {Array.from(new Set([...draft.programs.map(p => p.program.trim()).filter(Boolean), ...programs])).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </>
            )}
          </div>
          <p className="mt-2 text-[14.5px] text-slate-900" role="status" aria-live="polite">
            {tryProblem ? tryProblem
              : tryText.trim() === "" ? "Type a percentage to see its grade, remarks and result."
              : !tableReady ? "Finish the table (no gaps or overlaps, a passing mark) to try a grade."
              : tryResult ? <><strong className="text-[#062444]">{tryResult.grade} · {tryResult.remarks} · {tryResult.result === "passed" ? "Passed" : "Failed"}</strong></>
              : "No row covers this percentage."}
          </p>
        </div>

        <div className="mt-4 rounded-lg border border-[#e6ecf5] px-3.5 py-3">
          <p className="text-[14px] font-bold text-[#062444] mb-1">Special grades with no percentage</p>
          <p className="text-[14px] text-slate-800 mb-1.5">These stay in <em>Other marks</em> above, so you see everything in one place. They are never converted from a percentage.</p>
          <ul className="text-[14.5px] text-slate-900 space-y-0.5">
            <li><strong>INC</strong> — Incomplete. It is tracked separately and is not failed by itself.</li>
            <li><strong>DRP</strong> — Dropped. It counts as a failed subject.</li>
            {formMarks.filter(m => m.mark.trim()).map(m => <li key={m.mark}><strong>{m.mark.trim()}</strong> — {m.meaning.trim() || "…"}. {MARK_OUTCOME_LABEL[m.outcome]} for renewal.</li>)}
          </ul>
        </div>
      </section>

      {/* 2. GWA computation */}
      <section className={card} aria-labelledby="gwa-title">
        <h3 id="gwa-title" className="text-[17px] font-bold text-[#062444]">GWA computation</h3>
        <p className="text-[14.5px] text-slate-800 mt-0.5 mb-4">How your school works out a scholar's GWA. The settings below are what you have today unless you change them.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="text-[14px] font-semibold text-[#062444] mb-1.5">Method</legend>
            <label className="flex items-start gap-2 text-[14.5px] text-slate-900 mb-1"><input type="radio" name="gwa-method" className="h-4 w-4 mt-1 accent-[#062444]" checked={draft.method === "weighted"} onChange={() => change({ method: "weighted" })} /> Units-weighted average (default): sum of (grade × units) ÷ sum of units</label>
            <label className="flex items-start gap-2 text-[14.5px] text-slate-900"><input type="radio" name="gwa-method" className="h-4 w-4 mt-1 accent-[#062444]" checked={draft.method === "simple"} onChange={() => change({ method: "simple" })} /> Simple average: sum of grades ÷ number of subjects</label>
          </fieldset>
          <fieldset>
            <legend className="text-[14px] font-semibold text-[#062444] mb-1.5">Grade used</legend>
            <label className="flex items-center gap-2 text-[14.5px] text-slate-900 mb-1"><input type="radio" name="gwa-used" className="h-4 w-4 accent-[#062444]" checked={draft.gradeUsed === "equivalent"} onChange={() => change({ gradeUsed: "equivalent" })} /> The equivalent grade (default)</label>
            <label className="flex items-center gap-2 text-[14.5px] text-slate-900"><input type="radio" name="gwa-used" className="h-4 w-4 accent-[#062444]" checked={draft.gradeUsed === "percentage"} onChange={() => change({ gradeUsed: "percentage" })} /> The percentage</label>
            {draft.gradeUsed === "percentage" && <p className="mt-1 text-[14px] text-slate-800">The GWA is then a percentage, so the retention requirement below is a percentage too. It needs percentages to be entered (see above).</p>}
          </fieldset>
          <div>
            <label htmlFor="gwa-decimals" className="block text-[14px] font-semibold text-[#062444] mb-1">Decimal places shown</label>
            <select id="gwa-decimals" value={draft.decimals} onChange={e => change({ decimals: Number(e.target.value) as 2 | 3 | 4 })} className={`${fieldClass} w-28`}><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select>
          </div>
          <fieldset>
            <legend className="text-[14px] font-semibold text-[#062444] mb-1.5">Rounding</legend>
            <label className="flex items-center gap-2 text-[14.5px] text-slate-900 mb-1"><input type="radio" name="gwa-round" className="h-4 w-4 accent-[#062444]" checked={draft.rounding === "round"} onChange={() => change({ rounding: "round" })} /> Round normally (1.7483 shows 1.75)</label>
            <label className="flex items-center gap-2 text-[14.5px] text-slate-900"><input type="radio" name="gwa-round" className="h-4 w-4 accent-[#062444]" checked={draft.rounding === "cut"} onChange={() => change({ rounding: "cut" })} /> Cut off the extra decimals (1.7483 shows 1.74)</label>
          </fieldset>
        </div>
        <label className="mt-4 flex items-start gap-2 text-[14.5px] text-slate-900"><input type="checkbox" className="h-4 w-4 mt-1 accent-[#062444]" checked={draft.includeFailed} onChange={e => change({ includeFailed: e.target.checked })} /> Failed grades are included in the GWA (default). Untick to leave them out.</label>

        <div className="mt-4">
          <p className="text-[14px] font-semibold text-[#062444] mb-1">Special marks (INC, DRP …)</p>
          <p className="text-[14px] text-slate-800 mb-2">They are left out of the GWA by default. Type a number to count a mark as that number instead (for example DRP counts as 5.00).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {["INC", "DRP", ...marksKnown].map(m => (
              <div key={m} className="flex items-center gap-2"><span className="w-20 text-[14.5px] font-semibold text-slate-900">{m}</span>
                <label className="sr-only" htmlFor={`special-${m}`}>{m} counts as</label>
                <input id={`special-${m}`} inputMode="decimal" value={draft.special[m] ?? ""} onChange={e => change({ special: { ...draft.special, [m]: e.target.value } })} placeholder="Left out" className={`${fieldClass} w-28`} /></div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="gwa-excluded" className="block text-[14px] font-semibold text-[#062444] mb-1">Subject codes excluded from the GWA when first saved</label>
            <input id="gwa-excluded" value={draft.excluded} onChange={e => change({ excluded: e.target.value })} placeholder="e.g. NSTP, PE" className={`${fieldClass} w-full`} />
            <p className="mt-1 text-[14px] text-slate-800">A new subject with one of these codes starts with "Exclude from GWA" ticked. You can still change it per subject, and subjects saved before are not touched. Excluded subjects are still checked for passed or failed.</p>
          </div>
          <div>
            <label htmlFor="gwa-retention" className="block text-[14px] font-semibold text-[#062444] mb-1">Retention requirement for this GWA (optional)</label>
            <input id="gwa-retention" inputMode="decimal" value={draft.retention} onChange={e => change({ retention: e.target.value })} placeholder={draft.gradeUsed === "percentage" ? "e.g. 85 (a percentage)" : `e.g. ${formScale.direction === "lower_is_better" ? "2.50" : "85"}`} className={`${fieldClass} w-40`} />
            <p className="mt-1 text-[14px] text-slate-800">{draft.gradeUsed === "percentage" ? "A percentage, because your GWA uses percentages." : "On your grading scale."} Leave it blank to keep the requirement you already set above.</p>
          </div>
        </div>

        <div className="mt-5"><SampleBox rules={rules} scale={formScale} /></div>
      </section>

      {/* Checks + save */}
      <section className={card} aria-label="Save the rules">
        <div ref={checksRef}>
          {(problems ?? (touched ? liveProblems : [])).length > 0 && (
            <div role={problems ? "alert" : "status"} className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[14.5px] font-bold text-red-900"><AlertTriangle size={15} aria-hidden="true" /> Fix these before saving</p>
              <ul className="mt-1 list-disc pl-5 text-[14.5px] text-red-950 space-y-0.5">{(problems ?? liveProblems).map((p, i) => <li key={i}>{p.message}</li>)}</ul>
            </div>
          )}
        </div>
        {blocked && <p className="mb-3 text-[14.5px] font-semibold text-amber-950 bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-2.5">{blocked}</p>}
        {viewError && <p role="alert" className="mb-3 text-[14.5px] text-red-800">{viewError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void review()} disabled={!!blocked || checking || unchanged} className={`inline-flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>
            {checking ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />} {checking ? "Checking the grades…" : "Review and save the rules"}
          </button>
          {unchanged && !saved && <span className="text-[14.5px] text-slate-800">{latestRules ? "Nothing has changed since the rules you saved last." : "Make a change to save your first rules."}</span>}
          {saved && <span role="status" className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-green-800"><CheckCircle2 size={15} aria-hidden="true" /> {saved}</span>}
        </div>
      </section>

      {/* History */}
      <section className={card} aria-labelledby="hist-title">
        <details>
          <summary className={`flex cursor-pointer items-center gap-2 text-[17px] font-bold text-[#062444] ${focusRing} rounded`}><History size={17} aria-hidden="true" /> <span id="hist-title">History of changes</span> <span className="text-[14px] font-normal text-slate-800">({overview.versions.length} version{overview.versions.length === 1 ? "" : "s"})</span></summary>
          {overview.audit.length === 0 ? <p className="mt-3 text-[14.5px] text-slate-800">Nothing saved yet.</p> : (
            <ul className="mt-3 space-y-3">
              {overview.audit.map(a => <AuditItem key={a.id} a={a} onView={() => { const v = overview.versions.find(x => x.versionNo === a.versionNo); if (v) void openVersion(v.id); }} />)}
            </ul>
          )}
        </details>
      </section>

      {pending && overview.startsAt && (
        <SchoolDialog title="Save these rules?" onClose={() => { if (!saving) setPending(null); }}>
          <div className="space-y-3 text-[14.5px] text-slate-900">
            <p>These rules will start with <strong>{when(overview.startsAt.schoolYear, overview.startsAt.term)}</strong> — {YEAR_STARTS[overview.startsAt.reason]}. Earlier periods keep the rules they had, and a period you have already submitted can never change.</p>
            <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-2.5"><p className="font-bold text-[#062444] mb-1">What changes</p><ul className="list-disc pl-5">{pending.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
            <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-2.5"><p className="font-bold text-[#062444] mb-1">How many grades and GWAs would change</p><p>{pending.text}</p></div>
            <div><label htmlFor="rules-note" className="block font-semibold text-[#062444] mb-1">A note for the history (optional)</label><textarea id="rules-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={300} className={`${fieldClass} w-full`} /></div>
            {saveError && <p role="alert" className="text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2">{saveError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setPending(null)} disabled={saving} className={`rounded-lg border border-[#062444]/30 px-4 py-2 font-semibold text-[#062444] ${focusRing}`}>Cancel</button>
              <button onClick={() => void confirmSave()} disabled={saving} className={`inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 font-semibold text-white disabled:opacity-60 ${focusRing}`}>{saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Confirm and save</button>
            </div>
          </div>
        </SchoolDialog>
      )}
      {viewing && (
        <SchoolDialog title={`Version ${viewing.versionNo} — starts ${when(viewing.effectiveYear, viewing.effectiveTerm)}`} onClose={() => setViewing(null)} wide>
          <GradingRulesView rules={viewing.rules} scale={formScale} />
        </SchoolDialog>
      )}
    </div>
  );
}

function AuditItem({ a, onView }: { a: AuditEntry; onView: () => void }) {
  const i = a.impact;
  return (
    <li className="rounded-lg border border-[#e6ecf5] px-3.5 py-3 text-[14.5px] text-slate-900">
      <p className="font-bold text-[#062444]">Version {a.versionNo ?? "?"} · starts {when(a.effectiveYear, a.effectiveTerm)}</p>
      <p className="text-slate-800">Saved {formatDateTime(a.changedAt)}{a.changedByLabel ? ` by ${a.changedByLabel}` : ""}</p>
      <ul className="mt-1 list-disc pl-5">{describeChanges(a.oldRules, a.newRules).map((c, k) => <li key={k}>{c}</li>)}</ul>
      {i.gradesChecked != null && <p className="mt-1 text-slate-800">When it was saved: {i.gradesChanged ?? 0} grade result{(i.gradesChanged ?? 0) === 1 ? "" : "s"} and {i.gwasChanged ?? 0} GWA{(i.gwasChanged ?? 0) === 1 ? "" : "s"} would change (out of {i.gradesChecked} grade{i.gradesChecked === 1 ? "" : "s"}).</p>}
      {a.note && <p className="mt-1 text-slate-800">Note: {a.note}</p>}
      <button onClick={onView} className={`mt-1.5 text-[14.5px] font-semibold text-[#0077b6] hover:underline rounded ${focusRing}`}>View these rules</button>
    </li>
  );
}
