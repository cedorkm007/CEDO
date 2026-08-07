import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Trophy, Info, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Circle, Lock, PlayCircle, Lightbulb, List, CalendarDays, X as XIcon } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { fetchQuizSubjects, fetchQuizTopics, startQuizAttempt, submitQuizAttempt, extractYouTubeId } from "../../quizApi";
import type { QuestScore, QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult } from "../../types";

type Step =
  | { view: "browse" }
  | { view: "topics"; subject: QuizSubject }
  | { view: "quiz"; subject: QuizSubject; topic: QuizTopic; questions: QuizQuestion[]; index: number }
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
  const [expandedVideoTopicId, setExpandedVideoTopicId] = useState<string | null>(null);
  const [browseTab, setBrowseTab] = useState<"subject" | "history">("subject");
  const [historyDateFilter, setHistoryDateFilter] = useState("");

  useEffect(() => { loadSubjects(); }, []);

  async function loadSubjects() {
    setLoading(true);
    setSubjects(await fetchQuizSubjects());
    setLoading(false);
  }

  async function openSubject(subject: QuizSubject) {
    setError("");
    setLoading(true);
    setExpandedVideoTopicId(null);
    setTopics(await fetchQuizTopics(subject.id, scholarIdNumber));
    setLoading(false);
    setStep({ view: "topics", subject });
  }

  async function reloadTopics(subject: QuizSubject) {
    setTopics(await fetchQuizTopics(subject.id, scholarIdNumber));
  }

  async function beginQuiz(subject: QuizSubject, topic: QuizTopic) {
    setError("");
    setLoading(true);
    const result = await startQuizAttempt(topic.id);
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setAnswers({});
    setStep({ view: "quiz", subject, topic, questions: result.questions, index: 0 });
  }

  function selectAnswer(questionId: string, choiceId: string) {
    setAnswers(a => ({ ...a, [questionId]: choiceId }));
  }

  function goNext() {
    if (step.view !== "quiz") return;
    if (step.index < step.questions.length - 1) {
      setStep({ ...step, index: step.index + 1 });
    } else {
      submitQuiz();
    }
  }

  function goBack() {
    if (step.view !== "quiz" || step.index === 0) return;
    setStep({ ...step, index: step.index - 1 });
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
  }

  return (
    <SectionCard icon={<Trophy size={14} />} title="Academic Quests">
      {step.view === "browse" && (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-6">
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setBrowseTab("subject")}
              className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border-2 transition-all ${browseTab === "subject" ? "bg-[#062444] border-[#F3BC00]" : "bg-[#f7f9fc] border-transparent hover:border-[#e6ecf5]"}`}>
              <Trophy className={`w-6 h-6 ${browseTab === "subject" ? "text-[#F3BC00]" : "text-[#062444]"}`} />
              <span className={`font-bold text-[11px] text-center leading-tight ${browseTab === "subject" ? "text-[#F3BC00]" : "text-[#062444]"}`}>Choose a Subject</span>
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setBrowseTab("history")}
              className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border-2 transition-all ${browseTab === "history" ? "bg-[#062444] border-[#F3BC00]" : "bg-[#f7f9fc] border-transparent hover:border-[#e6ecf5]"}`}>
              <List className={`w-6 h-6 ${browseTab === "history" ? "text-[#F3BC00]" : "text-[#062444]"}`} />
              <span className={`font-bold text-[11px] text-center leading-tight ${browseTab === "history" ? "text-[#F3BC00]" : "text-[#062444]"}`}>Quest History</span>
            </motion.button>
          </div>

          {browseTab === "subject" ? (
            <>
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
                  {subjects.map(s => (
                    <button
                      key={s.id}
                      onClick={() => openSubject(s)}
                      className="flex flex-col items-center justify-center gap-2 aspect-[1/0.85] rounded-2xl border border-[#e6ecf5] bg-white hover:border-[#0088cc]/40 hover:shadow-[0_4px_14px_rgba(6,36,68,0.08)] px-3 text-center transition-all"
                    >
                      <span className="w-12 h-12 rounded-xl bg-[#eef3fb] flex items-center justify-center text-[#062444]">
                        <Trophy size={20} />
                      </span>
                      <span className="text-[13px] font-bold text-[#062444]">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <QuestHistoryTab scores={scores} dateFilter={historyDateFilter} onDateFilterChange={setHistoryDateFilter} />
          )}
        </>
      )}

      {step.view === "topics" && (
        <div>
          <BackButton label="Back to subjects" onClick={() => setStep({ view: "browse" })} />
          <h4 className="text-[15px] font-extrabold text-[#062444] mb-1">{step.subject.name}</h4>
          <p className="text-sm text-slate-400 mb-2">Each topic has its own daily attempt limit.</p>
          {error && <ErrorBox message={error} />}
          {loading ? (
            <p className="text-sm text-slate-400 mt-3">Loading…</p>
          ) : topics.length === 0 ? (
            <p className="text-sm text-slate-400 mt-3">No topics available yet for this subject.</p>
          ) : (
            <div className="space-y-2 mt-3">
              {topics.map(t => {
                const exhausted = t.attemptsUsedToday >= t.maxAttemptsPerDay;
                const videoId = t.youtubeUrl ? extractYouTubeId(t.youtubeUrl) : null;
                const videoOpen = expandedVideoTopicId === t.id;
                return (
                  <div key={t.id} className="border border-[#e8edf2] rounded-lg overflow-hidden">
                    <button
                      onClick={() => !exhausted && beginQuiz(step.subject, t)}
                      disabled={exhausted}
                      className="w-full flex items-center justify-between bg-[#f8fafd] hover:bg-[#eef3fb] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 text-left transition-colors"
                    >
                      <span>
                        <span className="text-sm font-semibold text-[#062444] block">{t.name}</span>
                        <span className={`text-[11px] font-medium ${exhausted ? "text-red-500" : "text-slate-400"}`}>
                          {t.attemptsUsedToday}/{t.maxAttemptsPerDay} attempts today
                        </span>
                      </span>
                      {exhausted ? <Lock size={15} className="text-slate-300 shrink-0" /> : <ChevronRight size={15} className="text-[#0088cc] shrink-0" />}
                    </button>

                    {videoId && (
                      <div className="border-t border-[#e8edf2]">
                        <button
                          onClick={() => setExpandedVideoTopicId(videoOpen ? null : t.id)}
                          className="w-full flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-red-500 hover:bg-red-50/50"
                        >
                          <PlayCircle size={14} /> {videoOpen ? "Hide short lecture" : "Watch short lecture"}
                        </button>
                        {videoOpen && (
                          <div className="px-4 pb-4">
                            <div className="relative w-full rounded-lg overflow-hidden bg-black" style={{ paddingTop: "56.25%" }}>
                              <iframe
                                src={`https://www.youtube.com/embed/${videoId}`}
                                title={`${t.name} lecture`}
                                className="absolute inset-0 w-full h-full"
                                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step.view === "quiz" && (() => {
        const q = step.questions[step.index];
        const selected = answers[q.id];
        const isLast = step.index === step.questions.length - 1;
        return (
          <div>
            <BackButton label="Cancel" onClick={() => { setStep({ view: "topics", subject: step.subject }); reloadTopics(step.subject); }} />

            <div className="flex items-center justify-between mb-1">
              <h4 className="text-[15px] font-extrabold text-[#062444]">{step.topic.name}</h4>
              <span className="text-[12px] font-semibold text-slate-400">Question {step.index + 1} of {step.questions.length}</span>
            </div>
            <div className="flex gap-1 mb-6">
              {step.questions.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step.index ? "bg-[#0088cc]" : "bg-[#e6ecf5]"}`} />
              ))}
            </div>

            {error && <ErrorBox message={error} />}

            <p className="text-sm font-semibold text-[#062444] mb-3">
              {q.questionText} <span className="text-[11px] font-normal text-slate-400">({q.points} pt{q.points === 1 ? "" : "s"})</span>
            </p>
            <div className="space-y-2 mb-7">
              {q.choices.map(c => {
                const isSelected = selected === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => selectAnswer(q.id, c.id)}
                    className={`w-full flex items-center gap-2.5 text-left px-4 py-2.5 rounded-lg border transition-colors ${
                      isSelected ? "border-[#0088cc] bg-[#0088cc]/5" : "border-[#e6ecf5] hover:bg-[#f8fafd]"
                    }`}
                  >
                    {isSelected ? <CheckCircle2 size={16} className="text-[#0088cc] shrink-0" /> : <Circle size={16} className="text-slate-300 shrink-0" />}
                    <span className="text-sm text-[#062444]">{c.choiceText}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              {step.index > 0 && (
                <button onClick={goBack} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500 px-4 py-3">
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              <button
                onClick={goNext}
                disabled={!selected || submitting}
                className="flex-1 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white font-semibold text-sm rounded-xl py-3"
              >
                {submitting ? "Submitting…" : !selected ? "Select an answer to continue" : isLast ? "Finish Quiz" : "Next Question"}
              </button>
            </div>
          </div>
        );
      })()}

      {step.view === "results" && (
        <div>
          <div className="text-center py-4 mb-6">
            <p className="text-[13px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{step.topic.name}</p>
            <p className="text-4xl font-extrabold text-[#062444]">{step.result.score} <span className="text-lg text-slate-400 font-semibold">/ {step.result.maxScore}</span></p>
            <p className="text-sm text-slate-400 mt-1">{step.result.attemptsUsedToday}/{step.result.maxAttemptsPerDay} attempts used today for this topic</p>
          </div>

          <p className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#0088cc] mb-3">Review</p>
          <div className="space-y-3 mb-6">
            {step.result.results.map((r, i) => (
              <div key={r.questionId} className={`rounded-lg px-4 py-3.5 border ${r.isCorrect ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
                <div className="flex items-start gap-2.5 mb-2.5">
                  {r.isCorrect ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" /> : <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />}
                  <p className="text-sm font-semibold text-[#062444]">{i + 1}. {r.questionText}</p>
                </div>
                <div className="space-y-1.5 mb-2.5 pl-[26px]">
                  {r.choices.map(c => {
                    const wasSelected = c.id === r.selectedChoiceId;
                    return (
                      <div key={c.id} className={`text-[12.5px] px-3 py-1.5 rounded-md ${
                        c.isCorrect ? "bg-green-100 text-green-800 font-semibold" :
                        wasSelected ? "bg-red-100 text-red-700 font-semibold" : "text-slate-500"
                      }`}>
                        {c.choiceText}
                        {c.isCorrect && " ✓ Correct answer"}
                        {wasSelected && !c.isCorrect && " ← Your answer"}
                      </div>
                    );
                  })}
                  {!r.selectedChoiceId && <p className="text-[12px] text-slate-400 italic">You didn't answer this question.</p>}
                </div>
                {r.explanation && (
                  <div className="flex items-start gap-1.5 pl-[26px] text-[12.5px] text-slate-600">
                    <Lightbulb size={13} className="text-[#0088cc] shrink-0 mt-0.5" />
                    <p>{r.explanation}</p>
                  </div>
                )}
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

function QuestHistoryTab({ scores, dateFilter, onDateFilterChange }: {
  scores: QuestScore[]; dateFilter: string; onDateFilterChange: (v: string) => void;
}) {
  const filtered = dateFilter ? scores.filter(s => s.dateTaken === dateFilter) : scores;
  const sorted = [...filtered].sort((a, b) => (b.dateTaken ?? "").localeCompare(a.dateTaken ?? ""));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[15px] font-extrabold text-[#062444]">Quest History</h4>
        <span className="text-slate-400 text-xs">{sorted.length} entr{sorted.length === 1 ? "y" : "ies"}</span>
      </div>
      <p className="text-sm text-slate-400 mb-4">Every quest you've completed, with your score.</p>

      <div className="flex items-center gap-2 mb-5">
        <div className="flex items-center gap-2 flex-1 border border-[#e6ecf5] rounded-lg px-3 py-2">
          <CalendarDays size={14} className="text-slate-400 shrink-0" />
          <input type="date" value={dateFilter} onChange={e => onDateFilterChange(e.target.value)}
            className="w-full text-sm outline-none text-[#062444]" />
        </div>
        {dateFilter && (
          <button onClick={() => onDateFilterChange("")} className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-400 hover:text-[#062444]">
            <XIcon size={13} /> Clear
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5">
          <Info size={13} /> {dateFilter ? "No quests were taken on this date." : "No quest history yet — take a quiz to get started."}
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map(s => (
            <div key={s.id} className="flex items-center justify-between bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#062444]">{s.questName}</p>
                <p className="text-xs text-slate-400">{s.dateTaken ?? "—"}</p>
              </div>
              <span className="text-sm font-bold text-[#062444]">{s.score ?? "—"}{s.maxScore ? ` / ${s.maxScore}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
