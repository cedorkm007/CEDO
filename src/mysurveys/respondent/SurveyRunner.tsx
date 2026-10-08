import { useEffect, useMemo, useRef, useState } from "react";
import {
  answerSummary, isAnswered,
  type QuestionItem, type RunnerAnswer, type RunnerAnswers, type RunnerSurvey, type SectionItem,
} from "../surveyTypes";
import { QuestionField } from "./QuestionField";

/**
 * The one-question-at-a-time respondent experience. The builder's Preview and
 * the public survey page (Phase 3) both render THIS component, so "Preview"
 * shows exactly what respondents get.
 *
 * Screens: welcome (title, description, optional data-privacy consent) ->
 * [section intro ->] one question per screen -> review (tap an answer to change
 * it) -> thank-you. Next/Back buttons, left/right swipe on touch screens, and
 * Enter to advance. Progress is saved in the browser when `storageKey` is given
 * (cleared after a successful submit), so a refresh doesn't lose answers.
 *
 * Plain React only -- no icon/chart libraries -- because the public page must
 * load fast on slow mobile data.
 */

type Step =
  | { kind: "welcome" }
  | { kind: "section"; section: SectionItem }
  | { kind: "question"; question: QuestionItem; number: number }
  | { kind: "review" };

interface SavedProgress { answers: RunnerAnswers; consent: boolean; questionId: string | null }

function readProgress(key: string | undefined): SavedProgress | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedProgress) : null;
  } catch { return null; }
}
function writeProgress(key: string | undefined, value: SavedProgress) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota: progress just isn't kept */ }
}
function clearProgress(key: string | undefined) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

const STYLES = `
@keyframes svr-in-forward { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes svr-in-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
.svr-forward { animation: svr-in-forward 220ms ease-out both; }
.svr-back { animation: svr-in-back 220ms ease-out both; }
.svr-bar { transition: width 250ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .svr-forward, .svr-back { animation: none; }
  .svr-bar { transition: none; }
}`;

const primaryBtn =
  "min-h-[48px] rounded-xl bg-[#062444] px-6 text-[16px] font-semibold text-white transition-colors hover:bg-[#0a3a6b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0088cc]/40 disabled:cursor-not-allowed disabled:bg-slate-300";
const secondaryBtn =
  "min-h-[48px] rounded-xl border-2 border-[#c9d5e6] bg-white px-6 text-[16px] font-semibold text-[#062444] transition-colors hover:bg-[#f4f7fb] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0088cc]/40";

export function SurveyRunner({ survey, mode, storageKey, thankYouMessage, onSubmit, className = "", asMain = true }: {
  survey: RunnerSurvey;
  /** "preview" never saves anything and says so on the last screen. */
  mode: "preview" | "live";
  /** localStorage key for saving progress; leave undefined to save nothing. */
  storageKey?: string;
  thankYouMessage?: string;
  onSubmit?: (answers: RunnerAnswers, consentGiven: boolean) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
  /** The public page is the whole document, so the questions are its <main>. Inside the staff app (the builder's Preview) there already is one, so that passes false. */
  asMain?: boolean;
}) {
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ kind: "welcome" }];
    let pending: SectionItem | null = null;
    let n = 0;
    for (const item of survey.items) {
      if (item.kind === "section") { pending = item; continue; }
      if (pending) { out.push({ kind: "section", section: pending }); pending = null; }
      n += 1;
      out.push({ kind: "question", question: item, number: n });
    }
    out.push({ kind: "review" });
    return out;
  }, [survey.items]);

  const questionSteps = steps.filter((s): s is Extract<Step, { kind: "question" }> => s.kind === "question");
  const total = questionSteps.length;
  const reviewIndex = steps.length - 1;

  // Saved progress is read once, when the screen first opens.
  const [saved] = useState(() => readProgress(storageKey));
  const [answers, setAnswers] = useState<RunnerAnswers>(() => {
    if (!saved) return {};
    const valid = new Set(questionSteps.map(s => s.question.id));
    return Object.fromEntries(Object.entries(saved.answers ?? {}).filter(([id]) => valid.has(id)));
  });
  const [consent, setConsent] = useState(() => Boolean(saved?.consent));
  const [stepIndex, setStepIndex] = useState(() => {
    if (!saved?.questionId) return 0;
    const i = steps.findIndex(s => s.kind === "question" && s.question.id === saved.questionId);
    return i === -1 ? 0 : i;
  });
  const [restored, setRestored] = useState(() => Boolean(saved && (Object.keys(saved.answers ?? {}).length > 0 || saved.consent)));
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [returnToReview, setReturnToReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);

  // Keep the saved copy current; moving between screens moves focus to the new
  // heading so screen-reader and keyboard users land at the top of the new screen.
  useEffect(() => {
    if (done) return;
    writeProgress(storageKey, { answers, consent, questionId: step.kind === "question" ? step.question.id : null });
  }, [answers, consent, step, storageKey, done]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex, done]);

  const hasQuestions = total > 0;
  const canAdvance =
    step.kind === "welcome" ? (hasQuestions && (!survey.consentEnabled || consent))
    : step.kind === "question" ? (!step.question.required || isAnswered(step.question, answers[step.question.id]))
    : true;
  const firstMissing = questionSteps.find(s => s.question.required && !isAnswered(s.question, answers[s.question.id]));

  function goTo(index: number, dir: "forward" | "back") { setDirection(dir); setStepIndex(index); }

  function next() {
    if (!canAdvance || step.kind === "review") return;
    if (returnToReview && step.kind === "question") { setReturnToReview(false); goTo(reviewIndex, "forward"); return; }
    goTo(stepIndex + 1, "forward");
  }
  function back() {
    if (returnToReview && step.kind === "question") { setReturnToReview(false); goTo(reviewIndex, "back"); return; }
    if (stepIndex > 0) goTo(stepIndex - 1, "back");
  }
  function change(stepNo: number) { setReturnToReview(true); goTo(stepNo, "back"); }

  async function submit() {
    if (firstMissing) { setSubmitError("Please answer all required questions before submitting."); return; }
    if (!onSubmit) { setDone(true); return; }
    setSubmitting(true);
    setSubmitError("");
    const res = await onSubmit(answers, consent);
    setSubmitting(false);
    if (res.ok) { clearProgress(storageKey); setDone(true); }
    else setSubmitError(res.error ?? "Something went wrong. Please try again.");
  }

  function restart() {
    clearProgress(storageKey);
    setAnswers({}); setConsent(false); setStepIndex(0); setReturnToReview(false);
    setSubmitError(""); setRestored(false); setDirection("back"); setDone(false);
  }

  function setAnswer(id: string, a: RunnerAnswer) { setAnswers(prev => ({ ...prev, [id]: a })); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const tag = (e.target as HTMLElement).tagName;
    // Buttons already activate on Enter; a paragraph box needs Enter for new lines; a
    // <select> uses it to choose. Everywhere else Enter means "next".
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT" || tag === "A") return;
    if (step.kind === "review") return;
    e.preventDefault();
    next();
  }

  function onTouchStart(e: React.TouchEvent) {
    const target = e.target as HTMLElement;
    // Don't treat selecting text or dragging inside a field as a swipe.
    if (target.closest("input[type=text], textarea, select, input[type=date], input[type=time]")) { touch.current = null; return; }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || step.kind === "review") return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Date.now() - start.t > 900 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) next(); else back();
  }

  // ── Header / progress ──
  const answeredPosition = step.kind === "question" ? step.number : step.kind === "review" || done ? total : 0;
  const progressLabel = done ? "Finished" : step.kind === "question" ? `Question ${step.number} of ${total}` : step.kind === "review" ? "Review your answers" : step.kind === "section" ? "Next section" : "Welcome";
  const percent = total === 0 ? 0 : Math.round((answeredPosition / total) * 100);

  const nextLabel =
    step.kind === "welcome" ? "Start"
    : step.kind === "section" ? "Continue"
    : step.kind === "review" ? (submitting ? "Submitting…" : "Submit")
    : returnToReview ? "Back to review"
    : step.number === total ? "Review & submit"
    : "Next";
  const disabledHint =
    step.kind === "welcome" && !canAdvance
      ? (hasQuestions ? "Please agree to the statement above to continue." : "This survey has no questions yet.")
    : step.kind === "question" && !canAdvance ? "Please answer this question to continue."
    : "";

  const animation = direction === "forward" ? "svr-forward" : "svr-back";
  const Main = asMain ? "main" : "div";

  return (
    <div className={`@container flex min-h-full flex-col bg-[#f4f7fb] text-[#062444] ${className}`}>
      <style>{STYLES}</style>
      <div className="sr-only" aria-live="polite">{progressLabel}</div>

      <header className="sticky top-0 z-10 border-b border-[#dbe4f0] bg-white px-4 pb-3 pt-3">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 text-[14px]">
          <span className="min-w-0 truncate font-semibold">{survey.title || "Untitled survey"}</span>
          <span className="shrink-0 font-semibold text-slate-600">{progressLabel}</span>
        </div>
        <div
          role="progressbar" aria-label="Survey progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done ? total : answeredPosition}
          className="mx-auto mt-2 h-2 max-w-xl overflow-hidden rounded-full bg-[#dbe4f0]"
        >
          <div className="svr-bar h-full rounded-full bg-[#0088cc]" style={{ width: `${done ? 100 : percent}%` }} />
        </div>
      </header>

      <Main className="flex flex-1 items-start justify-center px-4 py-5 @lg:items-center @lg:py-8" onKeyDown={onKeyDown} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {done ? (
          <section key="done" className={`${animation} w-full max-w-xl rounded-2xl border border-[#dbe4f0] bg-white p-6 text-center shadow-sm @lg:p-10`}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700" aria-hidden="true">✓</div>
            <h2 ref={headingRef} tabIndex={-1} className="text-[26px] font-bold outline-none">
              {mode === "preview" ? "Thanks — that's the end of the preview" : "Response submitted"}
            </h2>
            <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-slate-700">{thankYouMessage || "Thank you for your response!"}</p>
            {mode === "preview" && (
              <>
                <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-[16px] font-medium text-amber-800">Preview only — nothing was submitted or saved.</p>
                <button onClick={restart} className={`${secondaryBtn} mt-5`}>Restart preview</button>
              </>
            )}
          </section>
        ) : (
          <section key={stepIndex} className={`${animation} w-full max-w-xl rounded-2xl border border-[#dbe4f0] bg-white p-5 shadow-sm @lg:p-8`}>
            {step.kind === "welcome" && (
              <>
                <h1 ref={headingRef} tabIndex={-1} className="break-words text-[26px] font-bold leading-snug outline-none">{survey.title || "Untitled survey"}</h1>
                {survey.description && <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-slate-700">{survey.description}</p>}
                {hasQuestions && <p className="mt-3 text-[14px] text-slate-500">{total} question{total === 1 ? "" : "s"}, one at a time.</p>}
                {restored && (
                  <p className="mt-4 rounded-lg bg-[#eaf5fc] px-4 py-3 text-[16px] text-[#062444]">
                    Welcome back — your earlier answers were restored.{" "}
                    <button onClick={restart} className="font-semibold underline">Start over</button>
                  </p>
                )}
                {survey.consentEnabled && (
                  <div className="mt-5">
                    <p className="mb-2 text-[16px] font-semibold">Data privacy consent</p>
                    <div tabIndex={0} role="region" aria-label="Data privacy consent statement" className="max-h-56 overflow-y-auto whitespace-pre-line rounded-xl border-2 border-[#dbe4f0] bg-[#f9fbfe] p-4 text-[15px] leading-relaxed text-slate-700">
                      {survey.consentText || "(No consent statement written yet.)"}
                    </div>
                    <label className={`mt-3 flex min-h-[52px] cursor-pointer items-center gap-3.5 rounded-xl border-2 px-4 py-3 text-[16px] ${consent ? "border-[#0088cc] bg-[#eaf5fc]" : "border-[#c9d5e6]"}`}>
                      <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="h-6 w-6 shrink-0 accent-[#062444]" />
                      <span className="font-medium">I have read the statement above and I agree.</span>
                    </label>
                  </div>
                )}
              </>
            )}

            {step.kind === "section" && (
              <>
                <p className="text-[14px] font-semibold uppercase tracking-wide text-[#00709f]">New section</p>
                <h2 ref={headingRef} tabIndex={-1} className="mt-1 break-words text-[26px] font-bold leading-snug outline-none">{step.section.title || "Untitled section"}</h2>
                {step.section.description && <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-slate-700">{step.section.description}</p>}
              </>
            )}

            {step.kind === "question" && (
              <fieldset className="min-w-0">
                <legend className="w-full">
                  <h2 ref={headingRef} tabIndex={-1} id={`ql-${step.question.id}`} className="break-words text-[21px] font-semibold leading-snug outline-none">
                    {step.question.text.trim() || <span className="italic text-slate-500">Untitled question</span>}
                    {step.question.required && (<><span aria-hidden="true" className="text-red-600"> *</span><span className="sr-only"> (required)</span></>)}
                  </h2>
                </legend>
                {step.question.helpText && <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{step.question.helpText}</p>}
                <div className="mt-5">
                  <QuestionField
                    question={step.question} answer={answers[step.question.id]} labelId={`ql-${step.question.id}`}
                    onChange={a => setAnswer(step.question.id, a)}
                  />
                </div>
              </fieldset>
            )}

            {step.kind === "review" && (
              <>
                <h2 ref={headingRef} tabIndex={-1} className="text-[26px] font-bold outline-none">Review your answers</h2>
                <p className="mt-1 text-[16px] text-slate-600">Tap any answer to change it.</p>
                <ul className="mt-4 space-y-2.5">
                  {questionSteps.map(s => {
                    const summary = answerSummary(s.question, answers[s.question.id]);
                    const missing = s.question.required && !summary;
                    return (
                      <li key={s.question.id}>
                        <button
                          onClick={() => change(steps.indexOf(s))}
                          className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors hover:bg-[#f4f7fb] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0088cc]/40 ${missing ? "border-red-300 bg-red-50" : "border-[#dbe4f0]"}`}
                        >
                          <span className="min-w-0">
                            <span className="block break-words text-[14px] text-slate-600">{s.number}. {s.question.text.trim() || "Untitled question"}</span>
                            <span className={`mt-0.5 block break-words text-[16px] font-semibold ${summary ? "" : "italic text-slate-500"}`}>
                              {summary || (missing ? "Required — tap to answer" : "Not answered")}
                            </span>
                          </span>
                          <span className="shrink-0 text-[16px] font-semibold text-[#00709f]">Change</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {submitError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[16px] font-medium text-red-700">{submitError}</p>}
              </>
            )}

            <div className="mt-7">
              {disabledHint && <p role="status" className="mb-3 text-[16px] font-medium text-slate-600">{disabledHint}</p>}
              <div className="flex gap-3">
                {stepIndex > 0 && step.kind !== "welcome" && (
                  <button onClick={back} className={secondaryBtn}>Back</button>
                )}
                <button
                  onClick={step.kind === "review" ? () => void submit() : next}
                  disabled={!canAdvance || submitting}
                  className={`${primaryBtn} flex-1`}
                >
                  {nextLabel}
                </button>
              </div>
            </div>
          </section>
        )}
      </Main>
    </div>
  );
}
