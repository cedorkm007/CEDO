import { useEffect, useState } from "react";
import { X, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOrResumeSurveyResponse, submitSurveyAnswer, submitSurveyResponse, submitSurveyConsent,
  type SurveyResponseQuestion, type SurveyResponseAnswer,
} from "../../scholarApi";

type Answer = { choiceId?: string; likertValue?: number; textValue?: string };

function isAnswered(question: SurveyResponseQuestion | undefined, answer: Answer | undefined): boolean {
  if (!question || !answer) return false;
  if (question.questionType === "multiple_choice") return !!answer.choiceId;
  if (question.questionType === "likert") return answer.likertValue !== undefined;
  return !!answer.textValue?.trim();
}

/**
 * Resolves what comes after `currentIndex`, given the answer just given for
 * it — a multiple_choice answer whose choice carries skip logic overrides
 * the default "next question in array order" (the array is already
 * sort_order-sorted, so +1 IS the default). "end" means nothing more is
 * required; the survey can be submitted from here. Pure/module-level so the
 * exact same rule drives both initial path reconstruction (on resume) and
 * live navigation (Next) — they must never disagree.
 */
function resolveNextIndex(questions: SurveyResponseQuestion[], currentIndex: number, question: SurveyResponseQuestion, answer: Answer | undefined): number | "end" {
  if (question.questionType === "multiple_choice" && answer?.choiceId) {
    const choice = question.choices.find(c => c.id === answer.choiceId);
    if (choice?.endsSurvey) return "end";
    if (choice?.skipToQuestionId) {
      const targetIndex = questions.findIndex(q => q.id === choice.skipToQuestionId);
      if (targetIndex !== -1) return targetIndex;
    }
  }
  const next = currentIndex + 1;
  return next < questions.length ? next : "end";
}

/** Replays the walk from question 0 using already-saved answers, landing on the first unanswered question on that path — or the last one reached if every question on the path is answered (mirrors the server-side required-question walk, so resuming never disagrees with what submit_survey_response will actually require). */
function buildInitialPath(questions: SurveyResponseQuestion[], answers: Record<string, Answer>): number[] {
  if (questions.length === 0) return [];
  const path = [0];
  let currentIndex = 0;
  for (;;) {
    const question = questions[currentIndex];
    const answer = answers[question.id];
    if (!isAnswered(question, answer)) break;
    const next = resolveNextIndex(questions, currentIndex, question, answer);
    if (next === "end") break;
    path.push(next);
    currentIndex = next;
  }
  return path;
}

/**
 * One question at a time, shown right after a gated time-out/voucher scan
 * (AttendanceScanner) or from the dashboard's "resume your survey" banner
 * (ScholarPortalPage) — same component either way, since
 * startOrResumeSurveyResponse is idempotent and picks up any
 * already-saved answers. Each answer is saved via its own round trip as
 * the scholar moves on, so closing the app mid-survey never loses
 * progress; only the final "Submit" call finalizes the held-open
 * attendance/voucher.
 *
 * Navigation is a `path` (question indices visited, in order) rather than
 * a flat counter, since a multiple-choice answer can route straight to a
 * later question or straight to the end (skip logic) — Back retraces the
 * actual path taken instead of blindly decrementing.
 */
export function SurveyResponseModal({
  surveyId, onClose, onFinalized,
}: { surveyId: string; onClose: () => void; onFinalized: (result: { finalizedCount: number; activityName: string }) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [responseId, setResponseId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SurveyResponseQuestion[]>([]);
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, Answer>>({});
  const [path, setPath] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalized, setFinalized] = useState<{ finalizedCount: number; activityName: string; declined: boolean } | null>(null);
  const [requiresConsent, setRequiresConsent] = useState(false);
  const [consentText, setConsentText] = useState("");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [decidingConsent, setDecidingConsent] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await startOrResumeSurveyResponse(surveyId);
      if (!result.ok || !result.responseId) {
        setError(result.error || "Couldn't load the survey.");
        setLoading(false);
        return;
      }
      setResponseId(result.responseId);
      const loadedQuestions = result.questions ?? [];
      setQuestions(loadedQuestions);
      setRequiresConsent(result.requiresConsent ?? false);
      setConsentText(result.consentText ?? "This survey is voluntary. Do you agree to participate?");
      setConsented(result.consented ?? null);
      const byQuestion: Record<string, Answer> = {};
      for (const a of (result.answers ?? []) as SurveyResponseAnswer[]) {
        byQuestion[a.questionId] = { choiceId: a.choiceId ?? undefined, likertValue: a.likertValue ?? undefined, textValue: a.textValue ?? undefined };
      }
      setAnswersByQuestion(byQuestion);
      setPath(buildInitialPath(loadedQuestions, byQuestion));
      setLoading(false);
    })();
  }, [surveyId]);

  async function handleConsent(agree: boolean) {
    if (!responseId) return;
    setDecidingConsent(true);
    setError("");
    const result = await submitSurveyConsent(responseId, agree);
    setDecidingConsent(false);
    if (!result.ok) { setError(result.error || "Couldn't save your response."); return; }
    if (result.declined) {
      setFinalized({ finalizedCount: result.finalizedCount ?? 0, activityName: result.activityName ?? "the activity", declined: true });
    } else {
      setConsented(true);
    }
  }

  const currentIndex = path[path.length - 1];
  const current = questions[currentIndex];
  const currentAnswer = current ? answersByQuestion[current.id] : undefined;
  const currentIsAnswered = isAnswered(current, currentAnswer);
  const isLast = current ? resolveNextIndex(questions, currentIndex, current, currentAnswer) === "end" : true;
  const allAnswered = path.length > 0 && path.every(i => isAnswered(questions[i], answersByQuestion[questions[i].id]));

  function setChoiceAnswer(choiceId: string) {
    if (!current) return;
    setAnswersByQuestion(prev => ({ ...prev, [current.id]: { choiceId } }));
  }
  function setLikertAnswer(value: number) {
    if (!current) return;
    setAnswersByQuestion(prev => ({ ...prev, [current.id]: { likertValue: value } }));
  }
  function setTextAnswer(value: string) {
    if (!current) return;
    setAnswersByQuestion(prev => ({ ...prev, [current.id]: { textValue: value } }));
  }

  async function saveCurrentAnswer(): Promise<boolean> {
    if (!current || !responseId || !currentIsAnswered) return false;
    setSaving(true);
    setError("");
    const result = await submitSurveyAnswer({
      responseId, questionId: current.id,
      choiceId: currentAnswer?.choiceId, likertValue: currentAnswer?.likertValue, textValue: currentAnswer?.textValue,
    });
    setSaving(false);
    if (!result.ok) { setError(result.error || "Couldn't save your answer."); return false; }
    return true;
  }

  async function handleNext() {
    if (!current) return;
    const saved = await saveCurrentAnswer();
    if (!saved) return;
    const next = resolveNextIndex(questions, currentIndex, current, currentAnswer);
    if (next === "end") return;
    setPath(p => [...p, next]);
  }

  function handleBack() {
    setPath(p => p.length > 1 ? p.slice(0, -1) : p);
  }

  async function handleSubmit() {
    const saved = await saveCurrentAnswer();
    if (!saved || !responseId) return;
    setSubmitting(true);
    setError("");
    const result = await submitSurveyResponse(responseId);
    setSubmitting(false);
    if (!result.ok) { setError(result.error || "Couldn't submit the survey."); return; }
    setFinalized({ finalizedCount: result.finalizedCount ?? 0, activityName: result.activityName ?? "the activity", declined: false });
  }

  function handleDone() {
    if (finalized) onFinalized(finalized);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">Quick Survey</h3>
          {!finalized && <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>}
        </div>

        <div className="p-6">
          {loading ? (
            <p className="text-[13px] text-slate-400 text-center py-6">Loading survey…</p>
          ) : finalized ? (
            <div className="text-center py-4">
              <CheckCircle2 size={40} className="mx-auto text-green-600 mb-3" />
              <p className="text-[14px] font-semibold text-[#062444] mb-1">
                {finalized.declined ? "Thanks for letting us know!" : "Survey complete — thank you!"}
              </p>
              <p className="text-[13px] text-slate-500 mb-5">Your attendance for "{finalized.activityName}" has been finalized.</p>
              <button onClick={handleDone} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-6 py-2.5">Done</button>
            </div>
          ) : requiresConsent && consented !== true ? (
            <div className="py-2">
              <p className="text-[15px] font-semibold text-[#062444] leading-relaxed mb-6">{consentText}</p>
              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
              <div className="flex items-center gap-3">
                <button onClick={() => handleConsent(false)} disabled={decidingConsent}
                  className="flex-1 border border-[#e6ecf5] text-slate-500 disabled:opacity-50 text-[13.5px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
                  No, thanks
                </button>
                <button onClick={() => handleConsent(true)} disabled={decidingConsent}
                  className="flex-1 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13.5px] font-semibold rounded-lg px-4 py-2.5">
                  {decidingConsent ? "Saving…" : "Yes, I agree"}
                </button>
              </div>
            </div>
          ) : !current ? (
            <p className="text-[13px] text-red-600 text-center py-6">{error || "This survey has no questions."}</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-slate-400 mb-3">Question {path.length}</p>
              <p className="text-[15px] font-semibold text-[#062444] leading-relaxed mb-5">{current.questionText}</p>

              {current.questionType === "multiple_choice" ? (
                <div className="space-y-2 mb-5">
                  {current.choices.map(c => (
                    <button key={c.id} onClick={() => setChoiceAnswer(c.id)}
                      className={`w-full text-left rounded-lg border px-4 py-2.5 text-[13.5px] font-medium transition ${
                        currentAnswer?.choiceId === c.id ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-[#062444] hover:bg-[#f8fafd]"
                      }`}>
                      {c.choiceText}
                    </button>
                  ))}
                </div>
              ) : current.questionType === "likert" ? (
                <div className="mb-5">
                  <div className="flex items-center justify-between gap-1">
                    {Array.from(
                      { length: (current.likertScaleMax ?? 5) - (current.likertScaleMin ?? 1) + 1 },
                      (_, i) => (current.likertScaleMin ?? 1) + i
                    ).map(v => (
                      <button key={v} onClick={() => setLikertAnswer(v)}
                        className={`flex-1 aspect-square rounded-lg border text-[13px] font-bold transition ${
                          currentAnswer?.likertValue === v ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-[#062444] hover:bg-[#f8fafd]"
                        }`}>
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-slate-400">
                    <span>{current.likertMinLabel}</span>
                    <span>{current.likertMaxLabel}</span>
                  </div>
                </div>
              ) : current.openEndedFormat === "long" ? (
                <textarea value={currentAnswer?.textValue ?? ""} onChange={e => setTextAnswer(e.target.value)} rows={5}
                  placeholder="Type your answer…"
                  className="w-full mb-5 border border-[#e6ecf5] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:border-[#062444] resize-none" />
              ) : (
                <input value={currentAnswer?.textValue ?? ""} onChange={e => setTextAnswer(e.target.value)}
                  placeholder="Type your answer…"
                  className="w-full mb-5 border border-[#e6ecf5] rounded-lg px-3 py-2.5 text-[13.5px] outline-none focus:border-[#062444]" />
              )}

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex items-center justify-between gap-3">
                <button onClick={handleBack} disabled={path.length <= 1 || saving || submitting}
                  className="flex items-center gap-1 text-[13px] font-semibold text-slate-400 disabled:opacity-40 hover:text-slate-600">
                  <ChevronLeft size={15} /> Back
                </button>
                {isLast ? (
                  <button onClick={handleSubmit} disabled={!allAnswered || !currentIsAnswered || saving || submitting}
                    className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                    {submitting ? "Submitting…" : "Submit Survey"}
                  </button>
                ) : (
                  <button onClick={handleNext} disabled={!currentIsAnswered || saving}
                    className="flex items-center gap-1 bg-[#062444] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                    {saving ? "Saving…" : "Next"} <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
