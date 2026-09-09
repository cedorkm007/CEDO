import { useState } from "react";
import { X, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { saveQuestion } from "../seadApi";
import type { QuestQuestion, QuestChoiceDraft, QuestAnswerDestination } from "../types";

export function QuestionEditorModal({
  topicId, mode, existing, onClose, onSaved,
}: { topicId: string; mode: QuestAnswerDestination; existing: QuestQuestion | null; onClose: () => void; onSaved: () => void }) {
  const isSurvey = mode === "survey_results";
  const [questionText, setQuestionText] = useState(existing?.questionText ?? "");
  const [points, setPoints] = useState(existing?.points ?? 1);
  const [explanation, setExplanation] = useState(existing?.explanation ?? "");
  const [choices, setChoices] = useState<QuestChoiceDraft[]>(
    existing?.choices ?? (isSurvey
      ? [{ choiceText: "", isCorrect: false }, { choiceText: "", isCorrect: false }]
      : [{ choiceText: "", isCorrect: true }, { choiceText: "", isCorrect: false }])
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateChoice(i: number, text: string) {
    setChoices(cs => cs.map((c, idx) => idx === i ? { ...c, choiceText: text } : c));
  }
  function setCorrect(i: number) {
    setChoices(cs => cs.map((c, idx) => ({ ...c, isCorrect: idx === i })));
  }
  function toggleOther(i: number) {
    setChoices(cs => cs.map((c, idx) => ({ ...c, isOther: idx === i ? !c.isOther : false })));
  }
  function addChoice() {
    if (!isSurvey && choices.length >= 6) return;
    setChoices(cs => [...cs, { choiceText: "", isCorrect: false }]);
  }
  function removeChoice(i: number) {
    if (choices.length <= 2) return;
    setChoices(cs => {
      const next = cs.filter((_, idx) => idx !== i);
      if (!isSurvey && !next.some(c => c.isCorrect)) next[0].isCorrect = true;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!questionText.trim()) { setError("Enter the question text."); return; }
    if (choices.some(c => !c.choiceText.trim())) { setError("Fill in every choice, or remove empty ones."); return; }

    setBusy(true);
    const result = await saveQuestion({
      id: existing?.id, topicId, questionText: questionText.trim(),
      points, explanation: explanation.trim(), choices, mode,
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
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Question</label>
          <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-4" />

          {!isSurvey && (
            <>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Points</label>
              <input type="number" min={0} step="0.5" value={points} onChange={e => setPoints(Number(e.target.value))}
                className="w-28 border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-5" />
            </>
          )}

          <div className="flex items-center justify-between mb-2">
            <p className="text-[12.5px] font-semibold text-slate-500">
              {isSurvey ? "Choices — no correct answer; flag one as \"Other\" for a write-in" : "Choices — click the circle to mark the correct one"}
            </p>
            {(isSurvey || choices.length < 6) && (
              <button type="button" onClick={addChoice} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] cursor-pointer hover:opacity-80 transition-opacity">
                <Plus size={13} /> Add choice
              </button>
            )}
          </div>
          <div className="space-y-2 mb-2">
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                {!isSurvey && (
                  <button type="button" onClick={() => setCorrect(i)} className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity">
                    {c.isCorrect ? <CheckCircle2 size={20} className="text-green-600" /> : <Circle size={20} className="text-slate-300" />}
                  </button>
                )}
                <input value={c.choiceText} onChange={e => updateChoice(i, e.target.value)} placeholder={`Choice ${i + 1}`}
                  className="flex-1 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                {isSurvey && (
                  <button type="button" onClick={() => toggleOther(i)}
                    className={`shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1.5 cursor-pointer transition-colors ${c.isOther ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}>
                    Other
                  </button>
                )}
                {choices.length > 2 && (
                  <button type="button" onClick={() => removeChoice(i)} className="shrink-0 text-slate-300 hover:text-red-500 cursor-pointer hover:opacity-80 transition-opacity">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[12px] text-slate-400 mb-5">
            {isSurvey ? "The \"Other\" choice lets a scholar type their own answer instead of picking one of the choices above." : "Choice order is randomized automatically for each scholar — no need to shuffle them here."}
          </p>

          {!isSurvey && (
            <>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Explanation (optional)</label>
              <textarea value={explanation} onChange={e => setExplanation(e.target.value)} rows={2} placeholder="Shown to the scholar after they finish the quiz, next to this question."
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-5" />
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
