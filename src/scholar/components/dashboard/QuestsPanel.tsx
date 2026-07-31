import { useEffect, useState } from "react";
import { Trophy, Info, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Circle, Lock } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { fetchQuizSubjects, fetchQuizTopics, startQuizAttempt, submitQuizAttempt } from "../../quizApi";
import type { QuestScore, QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult } from "../../types";

type Step =
  | { view: "browse" }
  | { view: "topics"; subject: QuizSubject }
  | { view: "quiz"; subject: QuizSubject; topic: QuizTopic; questions: QuizQuestion[] }
  | { view: "results"; subject: QuizSubject; topic: QuizTopic; result: QuizSubmitResult };

interface QuestsPanelProps {
  scores: QuestScore[];
  scholarIdNumber: string;
  onScoreSubmitted: () => void; // lets the parent refresh "Your Quest History"
}

export function QuestsPanel({ scores, scholarIdNumber, onScoreSubmitted }: QuestsPanelProps) {
  const [step, setStep] = useState<Step>({ view: "browse" });
  const [subjects, setSubjects] = useState<QuizSubject[]>([]);
  const [topics, setTopics] = useState<QuizTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({}); // questionId -> choiceId
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadSubjects(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function loadSubjects() {
    setLoading(true);
    setSubjects(await fetchQuizSubjects(scholarIdNumber));
    setLoading(false);
  }

  async function openSubject(subject: QuizSubject) {
    setError("");
    setLoading(true);
    setTopics(await fetchQuizTopics(subject.id));
    setLoading(false);
    setStep({ view: "topics", subject });
  }

  async function beginQuiz(subject: QuizSubject, topic: QuizTopic) {
    setError("");
    setLoading(true);
    const result = await startQuizAttempt(topic.id);
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setAnswers({});
    setStep({ view: "quiz", subject, topic, questions: result.questions });
  }

  async function submitQuiz() {
    if (step.view !== "quiz") return;
    setSubmitting(true);
    const answerList = step.questions.map(q => ({ questionId: q.id, choiceId: answers[q.id] ?? null }));
    const result = await submitQuizAttempt(step.topic.id, answerList);
    setSubmitting(false);
    if (!result.ok) { setError(result.error); return; }
    setStep({ view: "results", subject: step.subject, topic: step.topic, result: result.result });
    onScoreSubmitted();
    loadSubjects(); // refresh attempts-used-today counts
  }

  return (
    <SectionCard icon={<Trophy size={14} />} title="Academic Quests">
      {step.view === "browse" && (
        <>
          {scores.length > 0 && (
            <div className="mb-7">
              <p className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#0088cc] mb-3">Your Quest History</p>
              <div className="space-y-2">
                {scores.map(s => (
                  <div key={s.id} className="flex items-center justify-between bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-[#062444]">{s.questName}</p>
                      <p className="text-xs text-slate-400">{s.dateTaken ?? "—"}</p>
                    </div>
                    <span className="text-sm font-bold text-[#062444]">{s.score ?? "—"}{s.maxScore ? ` / ${s.maxScore}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 className="text-[15px] font-extrabold text-[#062444] mb-1">Choose a subject</h4>
          <p className="text-sm text-slate-400 mb-5">Test your academic knowledge and track your progress.</p>

          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : subjects.length === 0 ? (
            <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5">
              <Info size={13} /> No quest subjects have been set up yet — check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {subjects.map(s => {
                const exhausted = s.attemptsUsedToday >= s.maxAttemptsPerDay;
                return (
                  <button
                    key={s.id}
                    onClick={() => openSubject(s)}
                    className="flex flex-col items-center justify-center gap-2 aspect-[1/0.85] rounded-2xl border border-[#e6ecf5] bg-white hover:border-[#0088cc]/40 hover:shadow-[0_4px_14px_rgba(6,36,68,0.08)] px-3 text-center transition-all"
                  >
                    <span className="w-12 h-12 rounded-xl bg-[#eef3fb] flex items-center justify-center text-[#062444]">
                      <Trophy size={20} />
                    </span>
                    <span className="text-[13px] font-bold text-[#062444]">{s.name}</span>
                    <span className={`text-[11px] font-medium ${exhausted ? "text-red-500" : "text-slate-400"}`}>
                      {s.attemptsUsedToday}/{s.maxAttemptsPerDay} attempts today
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {step.view === "topics" && (
        <div>
          <BackButton label="Back to subjects" onClick={() => setStep({ view: "browse" })} />
          <h4 className="text-[15px] font-extrabold text-[#062444] mb-1">{step.subject.name}</h4>
          <p className="text-sm text-slate-400 mb-2">
            {step.subject.attemptsUsedToday}/{step.subject.maxAttemptsPerDay} attempts used today across this subject.
          </p>
          {error && <ErrorBox message={error} />}
          {loading ? (
            <p className="text-sm text-slate-400 mt-3">Loading…</p>
          ) : topics.length === 0 ? (
            <p className="text-sm text-slate-400 mt-3">No topics available yet for this subject.</p>
          ) : (
            <div className="space-y-2 mt-3">
              {topics.map(t => {
                const exhausted = step.subject.attemptsUsedToday >= step.subject.maxAttemptsPerDay;
                return (
                  <button
                    key={t.id}
                    onClick={() => !exhausted && beginQuiz(step.subject, t)}
                    disabled={exhausted}
                    className="w-full flex items-center justify-between bg-[#f8fafd] hover:bg-[#eef3fb] disabled:opacity-50 disabled:cursor-not-allowed border border-[#e8edf2] rounded-lg px-4 py-3.5 text-left transition-colors"
                  >
                    <span className="text-sm font-semibold text-[#062444]">{t.name}</span>
                    {exhausted ? <Lock size={15} className="text-slate-300" /> : <ChevronRight size={15} className="text-[#0088cc]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step.view === "quiz" && (
        <div>
          <BackButton label="Cancel" onClick={() => setStep({ view: "topics", subject: step.subject })} />
          <h4 className="text-[15px] font-extrabold text-[#062444] mb-1">{step.topic.name}</h4>
          <p className="text-sm text-slate-400 mb-5">Answer every question, then submit — choices are shuffled just for you.</p>

          {error && <ErrorBox message={error} />}

          <div className="space-y-6">
            {step.questions.map((q, qi) => (
              <div key={q.id}>
                <p className="text-sm font-semibold text-[#062444] mb-3">{qi + 1}. {q.questionText} <span className="text-[11px] font-normal text-slate-400">({q.points} pt{q.points === 1 ? "" : "s"})</span></p>
                <div className="space-y-2">
                  {q.choices.map(c => {
                    const selected = answers[q.id] === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setAnswers(a => ({ ...a, [q.id]: c.id }))}
                        className={`w-full flex items-center gap-2.5 text-left px-4 py-2.5 rounded-lg border transition-colors ${
                          selected ? "border-[#0088cc] bg-[#0088cc]/5" : "border-[#e6ecf5] hover:bg-[#f8fafd]"
                        }`}
                      >
                        {selected ? <CheckCircle2 size={16} className="text-[#0088cc] shrink-0" /> : <Circle size={16} className="text-slate-300 shrink-0" />}
                        <span className="text-sm text-[#062444]">{c.choiceText}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={submitQuiz}
            disabled={submitting || Object.keys(answers).length < step.questions.length}
            className="w-full mt-7 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white font-semibold text-sm rounded-xl py-3"
          >
            {submitting ? "Submitting…" : Object.keys(answers).length < step.questions.length
              ? `Answer all questions to submit (${Object.keys(answers).length}/${step.questions.length})`
              : "Submit Quiz"}
          </button>
        </div>
      )}

      {step.view === "results" && (
        <div>
          <div className="text-center py-4 mb-6">
            <p className="text-[13px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{step.topic.name}</p>
            <p className="text-4xl font-extrabold text-[#062444]">{step.result.score} <span className="text-lg text-slate-400 font-semibold">/ {step.result.maxScore}</span></p>
            <p className="text-sm text-slate-400 mt-1">{step.result.attemptsUsedToday}/{step.result.maxAttemptsPerDay} attempts used today for {step.subject.name}</p>
          </div>

          <p className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#0088cc] mb-3">Review</p>
          <div className="space-y-2 mb-6">
            {step.result.results.map((r, i) => (
              <div key={r.questionId} className={`flex items-start gap-2.5 rounded-lg px-4 py-3 border ${r.isCorrect ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
                {r.isCorrect ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" /> : <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />}
                <div>
                  <p className="text-sm text-[#062444]">Question {i + 1}</p>
                  {!r.isCorrect && <p className="text-xs text-slate-500 mt-0.5">Correct answer: {r.correctChoiceText}</p>}
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setStep({ view: "browse" })}
            className="w-full bg-[#062444] text-white font-semibold text-sm rounded-xl py-3">
            Back to Quests
          </button>
        </div>
      )}
    </SectionCard>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-400 hover:text-[#062444] mb-4">
      <ChevronLeft size={14} /> {label}
    </button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] rounded-lg px-4 py-2.5 mb-4">{message}</div>;
}
