import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { saveQuestion } from "../surveyEditorApi";
import { skipProblem, skipTargets, flatten, type OutlineChoice, type OutlineQuestion, type SurveyGroup, type SurveyQType } from "@/lib/surveyBuilder";

const SKIP_END = "end";
const SKIP_CONTINUE = "";
type Draft = OutlineChoice & { choiceText: string };

const skipValue = (c: Draft) => c.endsSurvey ? SKIP_END : c.skipToQuestionId ? `q:${c.skipToQuestionId}` : c.skipToSectionId ? `s:${c.skipToSectionId}` : SKIP_CONTINUE;
const input = "w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]";
const toggle = (on: boolean) => `flex-1 rounded-lg border px-3 py-2 text-[13px] font-bold ${on ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`;

export function SurveyQuestionEditorModal({
  surveyId, groups, existing, sectionId, onClose, onSaved,
}: {
  surveyId: string; groups: SurveyGroup[]; existing: OutlineQuestion | null; sectionId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [questionType, setQuestionType] = useState<SurveyQType>(existing?.questionType ?? "multiple_choice");
  const [questionText, setQuestionText] = useState(existing?.questionText ?? "");
  const [section, setSection] = useState<string | null>(existing?.sectionId ?? sectionId);
  const [isOptional, setIsOptional] = useState(existing?.isOptional ?? false);
  const [choices, setChoices] = useState<Draft[]>(existing?.choices.length ? existing.choices : [{ choiceText: "" }, { choiceText: "" }]);
  const [scaleMin, setScaleMin] = useState(existing?.likertScaleMin ?? 1);
  const [scaleMax, setScaleMax] = useState(existing?.likertScaleMax ?? 5);
  const [minLabel, setMinLabel] = useState(existing?.likertMinLabel ?? "Strongly Disagree");
  const [maxLabel, setMaxLabel] = useState(existing?.likertMaxLabel ?? "Strongly Agree");
  const [openEndedFormat, setOpenEndedFormat] = useState<"short" | "long">(existing?.openEndedFormat ?? "short");
  const [askMeaning, setAskMeaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sections = groups.filter(g => g.section).map(g => g.section!);
  const targets = skipTargets(groups, existing?.id ?? null, section);
  const questions = flatten(groups);
  const answered = (existing?.answerCount ?? 0) > 0;
  const scaleChanged = !!existing && questionType === "likert" && (existing.likertScaleMin !== scaleMin || existing.likertScaleMax !== scaleMax);
  const removedAnswered = existing?.choices.filter(c => (c.answerCount ?? 0) > 0 && !choices.some(d => d.id === c.id && d.choiceText.trim())) ?? [];

  /** Was something that already has answers reworded? */
  function rewordedWithAnswers(): boolean {
    if (!existing || !answered || scaleChanged) return false;
    if (existing.questionText.trim() !== questionText.trim()) return true;
    if (questionType === "likert" && (existing.likertMinLabel !== minLabel.trim() || existing.likertMaxLabel !== maxLabel.trim())) return true;
    return questionType === "multiple_choice" && existing.choices.some(c => (c.answerCount ?? 0) > 0 && choices.some(d => d.id === c.id && d.choiceText.trim() && d.choiceText.trim() !== c.choiceText));
  }

  function setSkip(i: number, value: string) {
    setChoices(cs => cs.map((c, idx) => idx === i ? {
      ...c, endsSurvey: value === SKIP_END,
      skipToQuestionId: value.startsWith("q:") ? value.slice(2) : null,
      skipToSectionId: value.startsWith("s:") ? value.slice(2) : null,
    } : c));
  }

  async function save(newMeaning: boolean) {
    setBusy(true);
    setError("");
    const result = await saveQuestion(surveyId, {
      id: existing?.id,
      sectionId: section,
      questionType,
      questionText: questionText.trim(),
      isOptional,
      likertScaleMin: questionType === "likert" ? scaleMin : undefined,
      likertScaleMax: questionType === "likert" ? scaleMax : undefined,
      likertMinLabel: questionType === "likert" ? minLabel.trim() : undefined,
      likertMaxLabel: questionType === "likert" ? maxLabel.trim() : undefined,
      openEndedFormat: questionType === "open_ended" ? openEndedFormat : undefined,
      choices: questionType === "multiple_choice" ? choices.filter(c => c.choiceText.trim()) : [],
    }, newMeaning);
    setBusy(false);
    if (result.ok === false) { setError(result.error); setAskMeaning(false); return; }
    onSaved();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!questionText.trim()) { setError("Enter the question text."); return; }
    if (questionType === "multiple_choice" && (choices.some(c => !c.choiceText.trim()) || choices.length < 2)) { setError("Fill in at least two choices, or remove empty ones."); return; }
    if (questionType === "likert" && scaleMin >= scaleMax) { setError("The scale max must be greater than the min."); return; }
    if (rewordedWithAnswers()) { setAskMeaning(true); return; }
    void save(false);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-start justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">{existing ? "Edit Question" : "Add Question"}</h3>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {!existing && (
            <>
              <p className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Question type</p>
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => setQuestionType("multiple_choice")} className={toggle(questionType === "multiple_choice")}>Multiple Choice</button>
                <button type="button" onClick={() => setQuestionType("likert")} className={toggle(questionType === "likert")}>Likert Scale</button>
                <button type="button" onClick={() => setQuestionType("open_ended")} className={toggle(questionType === "open_ended")}>Open-Ended</button>
              </div>
            </>
          )}

          {sections.length > 0 && (
            <label className="block mb-3">
              <span className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Section</span>
              <select value={section ?? ""} onChange={e => setSection(e.target.value || null)} className={`${input} bg-white`}>
                {sections.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
              </select>
            </label>
          )}

          <label className="block">
            <span className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Question</span>
            <textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3} className={`${input} mb-2`} />
          </label>
          <label className="flex items-center gap-2 mb-5 cursor-pointer">
            <input type="checkbox" checked={isOptional} onChange={e => setIsOptional(e.target.checked)} className="w-4 h-4 accent-[#062444]" />
            <span className="text-[12.5px] font-semibold text-slate-600">Optional question (scholars may leave it blank)</span>
          </label>

          {questionType === "multiple_choice" ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12.5px] font-semibold text-slate-500">Choices</p>
                <button type="button" onClick={() => setChoices(cs => [...cs, { choiceText: "" }])} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
                  <Plus size={13} /> Add choice
                </button>
              </div>
              <div className="space-y-2 mb-2">
                {choices.map((c, i) => {
                  const value = skipValue(c);
                  const known = value === SKIP_CONTINUE || value === SKIP_END
                    || targets.questions.some(q => `q:${q.id}` === value) || targets.sections.some(s => `s:${s.id}` === value);
                  const problem = existing && !known ? skipProblem(groups, existing, c) : null;
                  return (
                    <div key={c.id ?? `new-${i}`} className="rounded-lg border border-[#062444]/15 p-2">
                      <div className="flex items-center gap-2">
                        <input value={c.choiceText} onChange={e => setChoices(cs => cs.map((x, idx) => idx === i ? { ...x, choiceText: e.target.value } : x))}
                          placeholder={`Choice ${i + 1}`} aria-label={`Choice ${i + 1}`} className={`flex-1 ${input}`} />
                        {choices.length > 2 && (
                          <button type="button" onClick={() => setChoices(cs => cs.filter((_, idx) => idx !== i))} aria-label={`Remove choice ${i + 1}`} className="shrink-0 text-slate-300 hover:text-red-500">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[11px] font-semibold text-slate-400 shrink-0">Then:</span>
                        <select value={value} onChange={e => setSkip(i, e.target.value)} aria-label={`After choice ${i + 1}`}
                          className="flex-1 min-w-0 border border-[#062444]/15 rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#0088cc] bg-white">
                          <option value={SKIP_CONTINUE}>Continue to next question</option>
                          <option value={SKIP_END}>End the survey</option>
                          {!known && <option value={value}>⚠ Skip that no longer works</option>}
                          {targets.sections.map(s => <option key={s.id} value={`s:${s.id}`}>Skip to section: {s.title.slice(0, 50)}</option>)}
                          {targets.questions.map(q => <option key={q.id} value={`q:${q.id}`}>Skip to question {questions.findIndex(x => x.id === q.id) + 1}: {q.questionText.slice(0, 50)}</option>)}
                        </select>
                      </div>
                      {problem && <p className="mt-1 text-[11.5px] font-semibold text-red-600">⚠ {problem} Pick another, or choose "Continue to next question".</p>}
                    </div>
                  );
                })}
              </div>
              <p className="text-[12px] text-slate-400 mb-4">"Then" controls what happens after this choice is picked. Skips can only go forward.</p>
            </>
          ) : questionType === "open_ended" ? (
            <>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Answer length</p>
              <div className="flex items-center gap-2 mb-5">
                <button type="button" onClick={() => setOpenEndedFormat("short")} className={toggle(openEndedFormat === "short")}>Short Answer</button>
                <button type="button" onClick={() => setOpenEndedFormat("long")} className={toggle(openEndedFormat === "long")}>Paragraph</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Scale</p>
              <div className="flex items-center gap-2 mb-4">
                <input type="number" aria-label="Lowest number" value={scaleMin} onChange={e => setScaleMin(Number(e.target.value))} className="w-20 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                <span className="text-[13px] text-slate-400">to</span>
                <input type="number" aria-label="Highest number" value={scaleMax} onChange={e => setScaleMax(Number(e.target.value))} className="w-20 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-500 mb-1">Label for {scaleMin}</span>
                  <input value={minLabel} onChange={e => setMinLabel(e.target.value)} placeholder="e.g. Strongly Disagree" className={input} />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-500 mb-1">Label for {scaleMax}</span>
                  <input value={maxLabel} onChange={e => setMaxLabel(e.target.value)} placeholder="e.g. Strongly Agree" className={input} />
                </label>
              </div>
            </>
          )}

          {answered && scaleChanged && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">Changing the scale makes a new version of this question. Answers already collected ({existing!.answerCount}) stay on the earlier version.</p>}
          {removedAnswered.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">Removed choices that have answers ({removedAnswered.map(c => `"${c.choiceText}"`).join(", ")}) are kept in Survey Results, marked as removed.</p>}
          {error && <p role="alert" className="text-[13px] text-red-600 mb-3">{error}</p>}

          {askMeaning ? (
            <div className="rounded-xl border border-[#F3BC00]/50 bg-[#F3BC00]/10 p-3">
              <p className="text-[13.5px] font-semibold text-[#062444]">This already has {existing!.answerCount} answer{existing!.answerCount === 1 ? "" : "s"}. What did you change?</p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setAskMeaning(false)} className="rounded-lg border border-[#062444]/20 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600">Go back</button>
                <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-lg bg-[#062444] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60">Just fixing the wording</button>
                <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-lg border border-[#062444] bg-white px-3 py-2 text-[13px] font-semibold text-[#062444] disabled:opacity-60">This changes the meaning</button>
              </div>
              <p className="mt-2 text-[12px] text-slate-600">Wording: the answers stay with it. Meaning: old answers stay on the earlier version, and the new one starts empty.</p>
            </div>
          ) : (
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                {busy ? "Saving…" : "Save Question"}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
