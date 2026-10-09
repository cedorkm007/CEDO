import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Info } from "lucide-react";
import { fetchGradingConfig, fetchLetterGrades, saveGradingConfig, saveLetterGrades } from "../schoolApi";
import { fieldClass, focusRing } from "./portalParts";
import type { GradingConfig, LetterGrade } from "../types";

const DEFAULT_CONFIG: GradingConfig = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false };

/**
 * Editable anytime — scale bounds + direction, plus an optional letter-grade -> numeric conversion table for schools that grade with letters.
 * Until it has been saved once, schools cannot enter grades (the Scholars tab says so); `onSaved` tells the rest of the portal to re-read it.
 * Phase 5: every field has a real label, text is 14px+, and a failed save is reported instead of showing "Saved.".
 */
export function GradingConfigPanel({ schoolId, onSaved }: { schoolId: string; onSaved?: () => void }) {
  const [config, setConfig] = useState<GradingConfig>(DEFAULT_CONFIG);
  const [letters, setLetters] = useState<LetterGrade[]>([]);
  const [alreadySaved, setAlreadySaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchGradingConfig(), fetchLetterGrades(schoolId)]).then(([c, l]) => {
      if (c) setConfig(c);
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

  async function handleSave() {
    setError("");
    setSaved(false);
    if (!(config.scaleMax > config.scaleMin)) { setError("The scale maximum must be higher than the minimum."); return; }
    setSaving(true);
    const result = await saveGradingConfig(config);
    if (!result.ok) { setSaving(false); setError(result.error || "Couldn't save the grading system."); return; }
    if (config.usesLetterGrades) {
      const letterResult = await saveLetterGrades(letters.filter(l => l.letter.trim()));
      if (!letterResult.ok) { setSaving(false); setError(letterResult.error || "Couldn't save the letter grades."); return; }
    }
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
