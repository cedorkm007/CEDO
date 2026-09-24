import { useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { fetchGradingConfig, fetchLetterGrades, saveGradingConfig, saveLetterGrades } from "../schoolApi";
import type { GradingConfig, LetterGrade } from "../types";

const DEFAULT_CONFIG: GradingConfig = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false };

/** Editable anytime — scale bounds + direction, plus an optional letter-grade -> numeric conversion table for schools that grade with letters. */
export function GradingConfigPanel({ schoolId }: { schoolId: string }) {
  const [config, setConfig] = useState<GradingConfig>(DEFAULT_CONFIG);
  const [letters, setLetters] = useState<LetterGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([fetchGradingConfig(), fetchLetterGrades(schoolId)]).then(([c, l]) => {
      if (c) setConfig(c);
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
    setSaving(true);
    setSaved(false);
    await saveGradingConfig(config);
    if (config.usesLetterGrades) {
      const cleanLetters = letters.filter(l => l.letter.trim());
      await saveLetterGrades(cleanLetters);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>;

  return (
    <div className="bg-white border border-[#e6ecf5] rounded-xl p-5 max-w-xl">
      <h2 className="text-[15px] font-bold text-[#062444] mb-1">Grading System</h2>
      <p className="text-[12.5px] text-slate-400 mb-5">Set how your school grades scholars. You can change this anytime.</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-[11.5px] font-semibold text-slate-500 mb-1">Scale Minimum</label>
          <input type="number" step="0.01" value={config.scaleMin}
            onChange={e => setConfig(c => ({ ...c, scaleMin: Number(e.target.value) }))}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
        </div>
        <div>
          <label className="block text-[11.5px] font-semibold text-slate-500 mb-1">Scale Maximum</label>
          <input type="number" step="0.01" value={config.scaleMax}
            onChange={e => setConfig(c => ({ ...c, scaleMax: Number(e.target.value) }))}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
        </div>
      </div>

      <div className="mb-5">
        <label className="block text-[11.5px] font-semibold text-slate-500 mb-1.5">Which end is better?</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-[13px] text-[#062444]">
            <input type="radio" checked={config.direction === "lower_is_better"} onChange={() => setConfig(c => ({ ...c, direction: "lower_is_better" }))} />
            Lower is better (e.g. 1.00 = highest)
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-[#062444]">
            <input type="radio" checked={config.direction === "higher_is_better"} onChange={() => setConfig(c => ({ ...c, direction: "higher_is_better" }))} />
            Higher is better (e.g. 100 = highest)
          </label>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-[#062444] mb-4 cursor-pointer">
        <input type="checkbox" checked={config.usesLetterGrades} onChange={e => setConfig(c => ({ ...c, usesLetterGrades: e.target.checked }))} />
        We use letter grades (A, B, C…) in addition to or instead of numbers
      </label>

      {config.usesLetterGrades && (
        <div className="mb-5 bg-[#f7f9fc] rounded-lg p-3">
          <p className="text-[11.5px] font-semibold text-slate-500 mb-2">Letter → Numeric Value</p>
          {letters.map((l, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <input value={l.letter} onChange={e => updateLetter(i, "letter", e.target.value)} placeholder="e.g. A"
                className="w-20 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[13px] outline-none" />
              <input type="number" step="0.01" value={l.numericValue ?? ""} onChange={e => updateLetter(i, "numericValue", e.target.value)}
                placeholder="e.g. 1.00 (leave blank for INC/DRP)"
                className="flex-1 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[13px] outline-none" />
              <button onClick={() => setLetters(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => setLetters(prev => [...prev, { letter: "", numericValue: null }])}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
            <Plus size={13} /> Add letter
          </button>
        </div>
      )}

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
        <Save size={14} /> {saving ? "Saving…" : "Save Grading System"}
      </button>
      {saved && <span className="ml-3 text-[12.5px] font-semibold text-green-600">Saved.</span>}
    </div>
  );
}
