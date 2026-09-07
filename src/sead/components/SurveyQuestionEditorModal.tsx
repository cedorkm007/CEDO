import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { saveSurveyQuestion } from "../seadApi";
import type { SurveyQuestion, SurveyChoiceDraft, SurveyQuestionType } from "../types";

export function SurveyQuestionEditorModal({
  surveyId, existing, nextSortOrder, onClose, onSaved,
}: { surveyId: string; existing: SurveyQuestion | null; nextSortOrder: number; onClose: () => void; onSaved: () => void }) {
  const [questionType, setQuestionType] = useState<SurveyQuestionType>(existing?.questionType ?? "multiple_choice");
  const [questionText, setQuestionText] = useState(existing?.questionText ?? "");
  const [choices, setChoices] = useState<SurveyChoiceDraft[]>(
    existing?.choices && existing.choices.length > 0 ? existing.choices : [{ choiceText: "" }, { choiceText: "" }]
  );
  const [scaleMin, setScaleMin] = useState(existing?.likertScaleMin ?? 1);
  const [scaleMax, setScaleMax] = useState(existing?.likertScaleMax ?? 5);
  const [minLabel, setMinLabel] = useState(existing?.likertMinLabel ?? "Strongly Disagree");
  const [maxLabel, setMaxLabel] = useState(existing?.likertMaxLabel ?? "Strongly Agree");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateChoice(i: number, text: string) {
    setChoices(cs => cs.map((c, idx) => idx === i ? { ...c, choiceText: text } : c));
  }
  function addChoice() {
    setChoices(cs => [...cs, { choiceText: "" }]);
  }
  function removeChoice(i: number) {
    if (choices.length <= 2) return;
    setChoices(cs => cs.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!questionText.trim()) { setError("Enter the question text."); return; }
    if (questionType === "multiple_choice" && choices.some(c => !c.choiceText.trim())) {
      setError("Fill in every choice, or remove empty ones.");
      return;
    }
    if (questionType === "likert" && scaleMin >= scaleMax) {
      setError("The scale max must be greater than the min.");
      return;
    }

    setBusy(true);
    const result = await saveSurveyQuestion({
      id: existing?.id,
      surveyId,
      questionType,
      questionText: questionText.trim(),
      sortOrder: existing?.sortOrder ?? nextSortOrder,
      likertScaleMin: questionType === "likert" ? scaleMin : undefined,
      likertScaleMax: questionType === "likert" ? scaleMax : undefined,
      likertMinLabel: questionType === "likert" ? minLabel.trim() : undefined,
      likertMaxLabel: questionType === "likert" ? maxLabel.trim() : undefined,
      choices,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save question."); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">{existing ? "Edit Question" : "Add Question"}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {!existing && (
            <>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Question type</label>
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => setQuestionType("multiple_choice")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-bold ${questionType === "multiple_choice" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
                  Multiple Choice
                </button>
                <button type="button" onClick={() => setQuestionType("likert")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-bold ${questionType === "likert" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
                  Likert Scale
                </button>
              </div>
            </>
          )}

          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Question</label>
          <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-5" />

          {questionType === "multiple_choice" ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12.5px] font-semibold text-slate-500">Choices</p>
                <button type="button" onClick={addChoice} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] cursor-pointer hover:opacity-80 transition-opacity">
                  <Plus size={13} /> Add choice
                </button>
              </div>
              <div className="space-y-2 mb-2">
                {choices.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={c.choiceText} onChange={e => updateChoice(i, e.target.value)} placeholder={`Choice ${i + 1}`}
                      className="flex-1 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                    {choices.length > 2 && (
                      <button type="button" onClick={() => removeChoice(i)} className="shrink-0 text-slate-300 hover:text-red-500 cursor-pointer hover:opacity-80 transition-opacity">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-slate-400 mb-5">No limit on the number of choices — there's no correct answer to mark.</p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Scale</p>
              <div className="flex items-center gap-2 mb-4">
                <input type="number" value={scaleMin} onChange={e => setScaleMin(Number(e.target.value))}
                  className="w-20 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                <span className="text-[13px] text-slate-400">to</span>
                <input type="number" value={scaleMax} onChange={e => setScaleMax(Number(e.target.value))}
                  className="w-20 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Label for {scaleMin}</label>
                  <input value={minLabel} onChange={e => setMinLabel(e.target.value)} placeholder="e.g. Strongly Disagree"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Label for {scaleMax}</label>
                  <input value={maxLabel} onChange={e => setMaxLabel(e.target.value)} placeholder="e.g. Strongly Agree"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                </div>
              </div>
            </>
          )}

          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={busy}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Saving…" : "Save Question"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
