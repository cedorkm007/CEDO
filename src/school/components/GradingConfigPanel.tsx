import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Info } from "lucide-react";
import { fetchGradingConfig, fetchLetterGrades, fetchSchoolMarks, saveGradingConfig, saveLetterGrades, saveSchoolMarks } from "../schoolApi";
import { fieldClass, focusRing } from "./portalParts";
import { atRiskExplanation, retentionSentence } from "@/lib/standing";
import { MARK_OUTCOME_LABEL, markAsLetter, type GradingConfig, type LetterGrade, type MarkOutcome, type SchoolMark } from "../types";
import { MarksGuide } from "@/app/components/MarksGuide";

const DEFAULT_CONFIG: GradingConfig = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, retentionThreshold: null, passingMark: null };

/** "3.0 or lower passes; higher than 3.0 is failed." — read back to the school as it types its passing mark. */
function passingSentence(direction: GradingConfig["direction"], mark: number): string {
  return direction === "lower_is_better"
    ? `A grade of ${mark} or lower passes; a grade higher than ${mark} is failed.`
    : `A grade of ${mark} or higher passes; a grade lower than ${mark} is failed.`;
}

/** The number typed in the retention / passing-mark box: null when blank, NaN when it is not a number. */
function parseThreshold(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  return /^[0-9]+([.][0-9]+)?$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * Editable anytime — scale bounds + direction, plus an optional letter-grade -> numeric conversion table for schools that grade with letters.
 * Until it has been saved once, schools cannot enter grades (the Scholars tab says so); `onSaved` tells the rest of the portal to re-read it.
 * Phase 5: every field has a real label, text is 14px+, and a failed save is reported instead of showing "Saved.".
 */
export function GradingConfigPanel({ schoolId, onSaved }: { schoolId: string; onSaved?: () => void }) {
  const [config, setConfig] = useState<GradingConfig>(DEFAULT_CONFIG);
  const [letters, setLetters] = useState<LetterGrade[]>([]);
  const [marks, setMarks] = useState<SchoolMark[]>([]);
  const [savedMarkCount, setSavedMarkCount] = useState(0);   // marks stored today: when there are none and none are added, nothing is sent (so saving still works before the database update has been run)
  const [alreadySaved, setAlreadySaved] = useState(true);
  const [retentionText, setRetentionText] = useState("");
  const [passingText, setPassingText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchGradingConfig(), fetchLetterGrades(schoolId), fetchSchoolMarks(schoolId)]).then(([c, l, m]) => {
      setMarks(m);
      setSavedMarkCount(m.length);
      if (c) {
        setConfig(c);
        setRetentionText(c.retentionThreshold == null ? "" : String(c.retentionThreshold));
        setPassingText(c.passingMark == null ? "" : String(c.passingMark));
      }
      setAlreadySaved(c !== null);
      setLetters(l.length > 0 ? l : [{ letter: "", numericValue: null }]);
      setLoading(false);
    });
  }, [schoolId]);

  function updateLetter(index: number, field: "letter" | "numericValue", value: string) {
    setLetters(prev => prev.map((l, i) => i === index
      ? { ...l, [field]: field === "numericValue" ? (value === "" ? null : Number(value)) : value }
      : l));
  }

  function updateMark(index: number, patch: Partial<SchoolMark>) {
    setMarks(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  async function handleSave() {
    setError("");
    setSaved(false);
    // The school's own other marks: a row needs all three parts, and a mark is not a number, INC or DRP, and not listed twice.
    const filled = marks.filter(m => m.mark.trim() || m.meaning.trim());
    for (const m of filled) {
      if (!m.mark.trim()) { setError("Every other mark needs the mark itself (for example F)."); return; }
      if (/^\d+([.,]\d+)?$/.test(m.mark.trim())) { setError(`"${m.mark.trim()}" is a number. Numbers are graded on your scale; add only letters or codes here.`); return; }
      if (["INC", "DRP"].includes(m.mark.trim().toUpperCase())) { setError("INC and DRP are built in for every school; they do not need to be added."); return; }
      if (!m.meaning.trim()) { setError(`Say what "${m.mark.trim()}" stands for.`); return; }
    }
    const keys = filled.map(m => m.mark.trim().toLowerCase());
    if (new Set(keys).size !== keys.length) { setError("A mark is listed twice in the other marks."); return; }
    if (!(config.scaleMax > config.scaleMin)) { setError("The scale maximum must be higher than the minimum."); return; }
    const threshold = parseThreshold(retentionText);
    if (threshold !== null && (Number.isNaN(threshold) || threshold < config.scaleMin || threshold > config.scaleMax)) {
      setError(`The retention requirement must be a number on your grading scale (${config.scaleMin} to ${config.scaleMax}), or left blank.`);
      return;
    }
    const passing = parseThreshold(passingText);
    if (passing !== null && (Number.isNaN(passing) || passing < config.scaleMin || passing > config.scaleMax)) {
      setError(`The passing mark must be a number on your grading scale (${config.scaleMin} to ${config.scaleMax}), or left blank.`);
      return;
    }
    setSaving(true);
    const result = await saveGradingConfig({ ...config, retentionThreshold: threshold, passingMark: passing });
    if (!result.ok) { setSaving(false); setError(result.error || "Couldn't save the grading system."); return; }
    if (config.usesLetterGrades) {
      const letterResult = await saveLetterGrades(letters.filter(l => l.letter.trim()));
      if (!letterResult.ok) { setSaving(false); setError(letterResult.error || "Couldn't save the letter grades."); return; }
    }
    if (filled.length > 0 || savedMarkCount > 0) {
      const markResult = await saveSchoolMarks(filled.map(m => ({ mark: m.mark.trim(), meaning: m.meaning.trim(), outcome: m.outcome })));
      if (!markResult.ok) { setSaving(false); setError(markResult.error || "Couldn't save the other marks."); return; }
      setSavedMarkCount(filled.length);
    }
    setMarks(filled.map(m => ({ ...m, mark: m.mark.trim(), meaning: m.meaning.trim() })));
    setSaving(false);
    setSaved(true);
    setAlreadySaved(true);
    onSaved?.();
  }

  if (loading) return <p className="text-[14.5px] text-slate-700 text-center py-8">Loading…</p>;

  return (
    <div className="bg-white border border-[#e6ecf5] rounded-xl p-5 max-w-xl">
      <h2 className="text-[18px] font-bold text-[#062444] mb-1">Grading System</h2>
      <p className="text-[14.5px] text-slate-700 mb-4">Set how your school grades scholars. You can change this anytime.</p>

      {!alreadySaved && (
        <p className="flex items-start gap-2 text-[14.5px] text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-2.5 mb-4">
          <Info size={16} className="shrink-0 mt-1" aria-hidden="true" />
          <span>You haven't saved your grading scale yet. Grades can't be entered or uploaded until you save it here.</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label htmlFor="scale-min" className="block text-[14px] font-semibold text-[#062444] mb-1">Scale minimum</label>
          <input id="scale-min" type="number" step="0.01" value={config.scaleMin}
            onChange={e => setConfig(c => ({ ...c, scaleMin: Number(e.target.value) }))} className={`${fieldClass} w-full`} />
        </div>
        <div>
          <label htmlFor="scale-max" className="block text-[14px] font-semibold text-[#062444] mb-1">Scale maximum</label>
          <input id="scale-max" type="number" step="0.01" value={config.scaleMax}
            onChange={e => setConfig(c => ({ ...c, scaleMax: Number(e.target.value) }))} className={`${fieldClass} w-full`} />
        </div>
      </div>

      <fieldset className="mb-5">
        <legend className="block text-[14px] font-semibold text-[#062444] mb-1.5">Which end is better?</legend>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-5">
          <label className="flex items-center gap-2 text-[14.5px] text-[#062444]">
            <input type="radio" name="direction" className="h-4 w-4 accent-[#062444]" checked={config.direction === "lower_is_better"} onChange={() => setConfig(c => ({ ...c, direction: "lower_is_better" }))} />
            Lower is better (e.g. 1.00 = highest)
          </label>
          <label className="flex items-center gap-2 text-[14.5px] text-[#062444]">
            <input type="radio" name="direction" className="h-4 w-4 accent-[#062444]" checked={config.direction === "higher_is_better"} onChange={() => setConfig(c => ({ ...c, direction: "higher_is_better" }))} />
            Higher is better (e.g. 100 = highest)
          </label>
        </div>
      </fieldset>

      <div className="mb-5">
        <label htmlFor="passing-mark" className="block text-[14px] font-semibold text-[#062444] mb-1">Passing mark</label>
        <input id="passing-mark" inputMode="decimal" value={passingText} onChange={e => setPassingText(e.target.value)} aria-describedby="passing-help"
          placeholder={config.direction === "lower_is_better" ? "e.g. 3.00" : "e.g. 75"} className={`${fieldClass} w-32`} />
        <div id="passing-help" className="text-[14px] text-slate-700 mt-1.5 space-y-0.5">
          <p>The lowest grade that still counts as passed, on your own scale. A grade worse than it is a failed subject. CEDO uses this for scholarship renewal.</p>
          {(() => {
            const p = parseThreshold(passingText);
            if (p === null || Number.isNaN(p)) {
              return <p className="font-semibold text-amber-900">Not set yet — until you set it, failed subjects cannot be shown.</p>;
            }
            return <p className="font-semibold text-[#062444]">{passingSentence(config.direction, p)}</p>;
          })()}
          <p>DRP counts as a failed subject. INC (incomplete) is not failed — it is tracked separately. Both can always be entered, and subjects excluded from the GWA still count here. If you use letter grades, each letter's number is compared with this mark.</p>
        </div>
      </div>

      <div className="mb-5">
        <label htmlFor="retention" className="block text-[14px] font-semibold text-[#062444] mb-1">Retention requirement (optional)</label>
        <input id="retention" inputMode="decimal" value={retentionText} onChange={e => setRetentionText(e.target.value)} aria-describedby="retention-help"
          placeholder={config.direction === "lower_is_better" ? "e.g. 2.50" : "e.g. 85"} className={`${fieldClass} w-32`} />
        <div id="retention-help" className="text-[14px] text-slate-700 mt-1.5 space-y-0.5">
          <p>The GWA a scholar must keep on your scale to keep the scholarship. CEDO uses it to show who is in good standing, at risk, or below the requirement.</p>
          {(() => {
            const t = parseThreshold(retentionText);
            if (t === null || Number.isNaN(t)) return <p>{retentionSentence(config, null)}</p>;
            return (<><p className="font-semibold text-[#062444]">{retentionSentence(config, t)}</p><p>{atRiskExplanation({ ...config, retentionThreshold: t })}</p></>);
          })()}
        </div>
      </div>

      <label className="flex items-start gap-2 text-[14.5px] font-semibold text-[#062444] mb-4 cursor-pointer">
        <input type="checkbox" className="h-4 w-4 mt-1 accent-[#062444]" checked={config.usesLetterGrades} onChange={e => setConfig(c => ({ ...c, usesLetterGrades: e.target.checked }))} />
        We use letter grades (A, B, C…) in addition to or instead of numbers
      </label>

      {config.usesLetterGrades && (
        <div className="mb-5 bg-[#f7f9fc] rounded-lg p-3.5">
          <p className="text-[14px] font-semibold text-[#062444] mb-2">Letter → numeric value</p>
          {letters.map((l, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <input value={l.letter} onChange={e => updateLetter(i, "letter", e.target.value)} placeholder="e.g. A" aria-label={`Letter ${i + 1}`}
                className={`${fieldClass} w-24`} />
              <input type="number" step="0.01" value={l.numericValue ?? ""} onChange={e => updateLetter(i, "numericValue", e.target.value)}
                placeholder="e.g. 1.00 (blank for INC/DRP)" aria-label={`Numeric value for letter ${i + 1}`}
                className={`${fieldClass} flex-1 min-w-0`} />
              <button onClick={() => setLetters(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove letter ${i + 1}`} className={`text-slate-700 hover:text-red-700 p-1 ${focusRing} rounded`}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button onClick={() => setLetters(prev => [...prev, { letter: "", numericValue: null }])}
            className={`flex items-center gap-1 text-[14.5px] font-semibold text-[#0077b6] hover:underline ${focusRing} rounded`}>
            <Plus size={14} aria-hidden="true" /> Add letter
          </button>
        </div>
      )}

      <div className="mb-5 bg-[#f7f9fc] rounded-lg p-3.5">
        <p className="text-[14px] font-semibold text-[#062444] mb-1">Other marks (not numbers)</p>
        <p className="text-[14px] text-slate-700 mb-3">Add the marks your school uses that are not numbers, for example F or D/F, say what each stands for, and what it means for renewal. INC and DRP are already built in. These marks are never part of the GWA.</p>
        {marks.map((m, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[6rem_minmax(0,1fr)_11rem_auto] items-center gap-2 mb-2">
            <input value={m.mark} onChange={e => updateMark(i, { mark: e.target.value })} placeholder="e.g. F" maxLength={12} aria-label={`Other mark ${i + 1}`} className={fieldClass} />
            <input value={m.meaning} onChange={e => updateMark(i, { meaning: e.target.value })} placeholder="Stands for, e.g. Failed" maxLength={120} aria-label={`What other mark ${i + 1} stands for`} className={fieldClass} />
            <select value={m.outcome} onChange={e => updateMark(i, { outcome: e.target.value as MarkOutcome })} aria-label={`What other mark ${i + 1} means for renewal`} className={fieldClass}>
              {(Object.keys(MARK_OUTCOME_LABEL) as MarkOutcome[]).map(o => <option key={o} value={o}>{MARK_OUTCOME_LABEL[o]}</option>)}
            </select>
            <button onClick={() => setMarks(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove other mark ${i + 1}`} className={`text-slate-700 hover:text-red-700 p-1 ${focusRing} rounded justify-self-start`}><Trash2 size={16} /></button>
          </div>
        ))}
        <button onClick={() => setMarks(prev => [...prev, { mark: "", meaning: "", outcome: "failed" }])}
          className={`flex items-center gap-1 text-[14.5px] font-semibold text-[#0077b6] hover:underline ${focusRing} rounded`}>
          <Plus size={14} aria-hidden="true" /> Add mark
        </button>
        <MarksGuide marks={[...letters.filter(l => config.usesLetterGrades && l.letter.trim()), ...marks.filter(m => m.mark.trim()).map(markAsLetter)]} className="mt-3" />
      </div>

      {error && <p role="alert" className="text-[14.5px] text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className={`flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>
          <Save size={15} aria-hidden="true" /> {saving ? "Saving…" : "Save grading system"}
        </button>
        {saved && <span role="status" className="text-[14.5px] font-semibold text-green-800">Saved.</span>}
      </div>
    </div>
  );
}
