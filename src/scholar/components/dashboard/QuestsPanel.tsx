import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { motion } from "motion/react";
import { Trophy, Info, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Circle, Lock, PlayCircle, Lightbulb, List, CalendarDays, X as XIcon, Award, Download, Maximize2, RotateCw, BookOpen, FileText, File, ExternalLink, Star } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { fetchQuizSubjects, fetchQuizTopics, startQuizAttempt, submitQuizAttempt, getLectureEmbed, getSlideEmbed, getPdfEmbed, fetchOwnSubjectProgress, fetchOwnCertificateUrl } from "../../quizApi";
import type { QuestScore, QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult } from "../../types";

/** Which review-material panels are expanded inline on the quiz page. Independent per material — opening one doesn't close another. */
type OpenMaterials = { video: boolean; slides: boolean; pdf: boolean };
const CLOSED_MATERIALS: OpenMaterials = { video: false, slides: false, pdf: false };

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

type OrientationControl = {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

function getOrientationControl(): OrientationControl | undefined {
  return (screen.orientation as unknown as OrientationControl | undefined);
}

export function QuestsPanel({ scores, scholarIdNumber, onScoreSubmitted }: QuestsPanelProps) {
  const [step, setStep] = useState<Step>({ view: "browse" });
  const [subjects, setSubjects] = useState<QuizSubject[]>([]);
  const [topics, setTopics] = useState<QuizTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({}); // questionId -> choiceId
  const [submitting, setSubmitting] = useState(false);
  const [activeLecture, setActiveLecture] = useState<{ name: string; src: string } | null>(null);
  const lecturePlayerRef = useRef<HTMLDivElement>(null);
  const [openMaterials, setOpenMaterials] = useState<OpenMaterials>(CLOSED_MATERIALS);
  const [browseTab, setBrowseTab] = useState<"subject" | "history">("subject");
  const [historyDateFilter, setHistoryDateFilter] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
  const [subjectProgress, setSubjectProgress] = useState<{ percentage: number; topicCount: number } | null>(null);
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState("");

  useEffect(() => { loadSubjects(); }, []);

  async function loadSubjects() {
    setLoading(true);
    setSubjects(await fetchQuizSubjects());
    setLoading(false);
  }

  async function openSubject(subject: QuizSubject) {
    setError("");
    setLoading(true);
    setActiveLecture(null);
    setCertError("");
    const [topicsResult, progressResult] = await Promise.all([
      fetchQuizTopics(subject.id, scholarIdNumber),
      fetchOwnSubjectProgress(subject.id, scholarIdNumber),
    ]);
    setTopics(topicsResult);
    setSubjectProgress(progressResult);
    setLoading(false);
    setStep({ view: "topics", subject });
  }

  async function reloadTopics(subject: QuizSubject) {
    const [topicsResult, progressResult] = await Promise.all([
      fetchQuizTopics(subject.id, scholarIdNumber),
      fetchOwnSubjectProgress(subject.id, scholarIdNumber),
    ]);
    setTopics(topicsResult);
    setSubjectProgress(progressResult);
  }

  async function handleDownloadCertificate(subject: QuizSubject) {
    setCertBusy(true);
    setCertError("");
    const result = await fetchOwnCertificateUrl(subject.id);
    setCertBusy(false);
    if (!result.ok || !result.url) { setCertError(result.error || "Couldn't get the certificate right now."); return; }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function closeLecture() {
    if (document.fullscreenElement) void document.exitFullscreen();
    getOrientationControl()?.unlock?.();
    setActiveLecture(null);
  }

  async function useLandscapeView() {
    try {
      await lecturePlayerRef.current?.requestFullscreen();
      await getOrientationControl()?.lock?.("landscape");
    } catch {
      // Full-screen and orientation locking are controlled by the device/browser.
    }
  }

  async function beginQuiz(subject: QuizSubject, topic: QuizTopic) {
    setError("");
    setLoading(true);
    const result = await startQuizAttempt(topic.id);
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setAnswers({});
    setOpenMaterials(CLOSED_MATERIALS);
    setStep({ view: "quiz", subject, topic, questions: result.questions, index: 0 });
  }

  function selectAnswer(questionId: string, choiceId: string) {
    setAnswers(a => ({ ...a, [questionId]: choiceId }));
  }

  // Toggling a material panel open/closed is deliberately independent from
  // `step`/`answers` state — it never touches the question index, selected
  // answers, or attempt data, so opening or closing a resource can never
  // reset quiz progress.
  function toggleMaterial(key: keyof OpenMaterials) {
    setOpenMaterials(m => ({ ...m, [key]: !m[key] }));
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

          {(subjectProgress || step.subject.certificateFilename) && (() => {
            const pct = subjectProgress?.percentage ?? 0;
            const passed = pct >= step.subject.passingRateMin && pct <= step.subject.passingRateMax;
            return (
              <div className="bg-[#f8fafd] border border-[#e8edf2] rounded-xl px-4 py-3.5 mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12.5px] font-bold text-[#062444] flex items-center gap-1.5"><Award size={14} className="text-[#F3BC00]" /> Subject Progress</span>
                  <span className="text-[13px] font-extrabold text-[#062444]">{pct.toFixed(1)}%</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">Passing rate: {step.subject.passingRateMin}%–{step.subject.passingRateMax}%, averaged across every topic's best attempt.</p>
                <div className="h-1.5 bg-[#e6ecf5] rounded-full overflow-hidden mb-2">
                  <div className={`h-full rounded-full ${passed ? "bg-green-500" : "bg-[#0088cc]"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                {step.subject.certificateFilename && (
                  passed ? (
                    <button onClick={() => handleDownloadCertificate(step.subject)} disabled={certBusy}
                      className="flex items-center gap-1.5 text-[12.5px] font-bold text-green-700 hover:underline disabled:opacity-50">
                      <Download size={13} /> {certBusy ? "Preparing…" : "Download Certificate"}
                    </button>
                  ) : (
                    <p className="text-[11.5px] text-slate-400 italic">Reach the passing rate to unlock this subject's certificate.</p>
                  )
                )}
                {certError && <p className="text-[11.5px] text-red-500 mt-1">{certError}</p>}
              </div>
            );
          })()}

          {error && <ErrorBox message={error} />}
          {loading ? (
            <p className="text-sm text-slate-400 mt-3">Loading…</p>
          ) : topics.length === 0 ? (
            <p className="text-sm text-slate-400 mt-3">No topics available yet for this subject.</p>
          ) : (
            <div className="space-y-2 mt-3">
              {topics.map(t => {
                const exhausted = t.attemptsUsedToday >= t.maxAttemptsPerDay;
                return (
                  <div key={t.id} className={`border rounded-lg overflow-hidden flex relative ${t.isCompleted ? "border-green-200 bg-green-50" : "border-[#e8edf2] bg-[#f8fafd]"}`}>
                    <button
                      onClick={() => !exhausted && beginQuiz(step.subject, t)}
                      disabled={exhausted}
                      className={`min-w-0 flex-1 flex flex-col gap-1.5 hover:bg-[#eef3fb] disabled:cursor-not-allowed px-4 py-3.5 text-left transition-colors ${exhausted ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex items-center gap-1.5 flex-wrap">
                          {t.isCompleted && <CheckCircle2 size={15} className="text-green-600 shrink-0" />}
                          <span className={`text-sm font-semibold ${t.isCompleted ? "text-green-800" : "text-[#062444]"}`}>{t.name}</span>
                          {t.isPerfectScore && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wide text-[#062444] bg-[#F3BC00] rounded-full px-2 py-0.5">
                              <Star size={10} className="fill-[#062444]" /> Perfect Score
                            </span>
                          )}
                        </span>
                        {exhausted ? <Lock size={15} className="text-slate-300 shrink-0" /> : <ChevronRight size={15} className="text-[#0088cc] shrink-0" />}
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="flex items-center gap-2.5 flex-wrap">
                          {t.highestPercentage !== null && (
                            <span className={`text-[11px] font-bold ${t.isCompleted ? "text-green-700" : "text-[#062444]"}`}>
                              Highest score: {Math.round(t.highestPercentage)}%
                            </span>
                          )}
                          <span className={`text-[11px] font-medium ${exhausted ? "text-red-500" : "text-slate-400"}`}>
                            Attempts: {t.attemptsUsedToday}
                          </span>
                        </span>
                        <span className={`text-[11px] font-semibold shrink-0 ${exhausted ? "text-red-500" : "text-slate-400"}`}>
                          {t.attemptsUsedToday} / {t.maxAttemptsPerDay} allowed
                        </span>
                      </div>
                    </button>
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
        const hasMaterials = !!(step.topic.videoUrl || step.topic.slideUrl || step.topic.pdfUrl);
        return (
          <div>
            <BackButton label="Cancel" onClick={() => { setStep({ view: "topics", subject: step.subject }); reloadTopics(step.subject); }} />

            <div className="flex items-center justify-between mb-1">
              <h4 className="text-[15px] font-extrabold text-[#062444]">{step.topic.name}</h4>
              <span className="text-[12px] font-semibold text-slate-400">Question {step.index + 1} of {step.questions.length}</span>
            </div>
            <div className="flex gap-1 mb-4">
              {step.questions.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step.index ? "bg-[#0088cc]" : "bg-[#e6ecf5]"}`} />
              ))}
            </div>

            {/* Two-column at desktop widths (question card + side materials card); stacks vertically below lg. */}
            <div className={hasMaterials ? "lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-5" : ""}>
              {hasMaterials && (
                <div className="mb-5 lg:order-2 lg:mb-0 lg:max-w-[21rem]">
                  <MaterialsPanel
                    topic={step.topic}
                    open={openMaterials}
                    onToggle={toggleMaterial}
                    onExpandVideo={src => setActiveLecture({ name: step.topic.name, src })}
                  />
                </div>
              )}

              <div className="min-w-0 lg:order-1">
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
                    <button onClick={goBack} style={{ cursor: 'pointer' }} className="flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:opacity-80 transition-opacity px-4 py-3">
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

          <button onClick={() => { setStep({ view: "topics", subject: step.subject }); reloadTopics(step.subject); }}
            className="w-full bg-[#062444] text-white font-semibold text-sm rounded-xl py-3">
            Back to Topics
          </button>
        </div>
      )}

      {activeLecture && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#062444]/85 p-3 backdrop-blur-sm sm:p-6" onClick={closeLecture}>
          <div ref={lecturePlayerRef} className="flex w-full max-w-5xl max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#062444] to-[#0a3a6b] px-4 py-3 sm:px-5">
              <h3 className="min-w-0 truncate flex items-center gap-2 text-[14px] font-bold text-white"><PlayCircle size={18} className="text-[#F3BC00] shrink-0" /> {activeLecture.name} lecture</h3>
              <button onClick={closeLecture} className="p-1 text-white/75 hover:text-white" aria-label="Close lecture"><XIcon size={20} /></button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
              <div className="relative w-full max-h-[calc(100dvh-8.5rem)] aspect-video">
                <iframe src={activeLecture.src} title={`${activeLecture.name} lecture`} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 bg-white">
              <button onClick={() => void useLandscapeView()} className="sm:hidden flex items-center gap-1.5 rounded-lg bg-[#eef3fb] px-3 py-2 text-[12px] font-bold text-[#062444] hover:bg-[#dfeaf8]">
                <RotateCw size={15} /> Use landscape
              </button>
              <button onClick={() => void lecturePlayerRef.current?.requestFullscreen()} className="hidden sm:flex items-center gap-1.5 rounded-lg bg-[#eef3fb] px-3 py-2 text-[12px] font-bold text-[#062444] hover:bg-[#dfeaf8]">
                <Maximize2 size={15} /> Full screen
              </button>
            </div>
          </div>
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
          <button onClick={() => onDateFilterChange("")} style={{ cursor: 'pointer' }} className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-400 hover:text-[#062444] hover:opacity-80 transition-colors">
            <XIcon size={13} /> Show All
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

// ── Review Materials: collapsed-by-default icon buttons + inline panels ──
function MaterialsPanel({ topic, open, onToggle, onExpandVideo }: {
  topic: QuizTopic;
  open: OpenMaterials;
  onToggle: (key: keyof OpenMaterials) => void;
  onExpandVideo: (src: string) => void;
}) {
  return (
    <div className="w-full max-w-full rounded-xl border border-[#e6ecf5] bg-[#f8fafd] overflow-hidden">
      <div className="w-full flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-bold text-[#062444] bg-[#eef3fb] border-b border-[#e6ecf5]">
        <BookOpen size={14} className="text-[#0088cc]" /> Review Materials
      </div>
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {topic.videoUrl && (
            <MaterialIconButton icon={PlayCircle} label="Play Video" active={open.video} onClick={() => onToggle("video")} />
          )}
          {topic.slideUrl && (
            <MaterialIconButton icon={FileText} label="View Slides" active={open.slides} onClick={() => onToggle("slides")} />
          )}
          {topic.pdfUrl && (
            <MaterialIconButton icon={File} label="View PDF" active={open.pdf} onClick={() => onToggle("pdf")} />
          )}
        </div>

        {open.video && topic.videoUrl && <VideoMaterial topicName={topic.name} url={topic.videoUrl} onExpand={onExpandVideo} />}
        {open.slides && topic.slideUrl && <SlidesMaterial url={topic.slideUrl} />}
        {open.pdf && topic.pdfUrl && <PdfMaterial url={topic.pdfUrl} />}
      </div>
    </div>
  );
}

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** Compact icon+label toggle. Only rendered when its resource URL exists; clicking it opens the matching panel below, clicking again collapses back to icon-only. */
function MaterialIconButton({ icon: Icon, label, active, onClick }: { icon: IconComponent; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 text-[12px] font-semibold rounded-lg px-3 py-2 border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0088cc] ${
        active ? "bg-[#062444] border-[#062444] text-white" : "bg-white border-[#e6ecf5] text-[#062444] hover:border-[#0088cc]/40"
      }`}
    >
      <Icon size={14} className={active ? "text-[#F3BC00]" : "text-[#0088cc]"} />
      {label}
    </button>
  );
}

/** Bounded "open in new tab" fallback shown for every resource — used as the only affordance when a provider can't be embedded, and alongside the embed otherwise, so a blocked/broken frame never leaves the scholar stuck. */
function FallbackLink({ href, icon: Icon, label, className = "" }: { href: string; icon: IconComponent; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#062444] bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 hover:border-[#0088cc]/40 hover:bg-white/60 transition-colors ${className}`}
    >
      <Icon size={14} className="text-[#0088cc]" /> {label} <ExternalLink size={12} className="text-slate-400" />
    </a>
  );
}

function VideoMaterial({ topicName, url, onExpand }: { topicName: string; url: string; onExpand: (src: string) => void }) {
  const embed = getLectureEmbed(url);
  if (!embed) {
    return <FallbackLink href={url} icon={PlayCircle} label="Watch Video" />;
  }
  return (
    <div className="w-full max-w-full">
      {/* aspect-video keeps the player's height tied to its width instead of a
          fixed/max-height, which is what caused portrait-mobile clipping. */}
      <div className="relative w-full max-w-full aspect-video rounded-lg overflow-hidden bg-black">
        <iframe
          src={embed.src}
          title={`${topicName} lecture`}
          className="w-full h-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
        <button type="button" onClick={() => onExpand(embed.src)} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0088cc] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0088cc] rounded">
          <Maximize2 size={12} /> Expand player
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-semibold text-slate-400 hover:text-[#062444]">
          {embed.provider === "google-drive" ? "Open video in Google Drive" : "Open in new tab"} <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function SlidesMaterial({ url }: { url: string }) {
  const embed = getSlideEmbed(url);
  return (
    <div className="w-full max-w-full">
      {embed && (
        <div className="w-full max-w-full h-[60vh] max-h-[420px] min-h-[220px] rounded-lg overflow-hidden border border-[#e6ecf5] bg-white">
          <iframe src={embed.src} title="Slide deck" className="w-full h-full" allow="fullscreen" allowFullScreen />
        </div>
      )}
      <FallbackLink href={url} icon={FileText} label="Open Slides in new tab" className={embed ? "mt-2" : ""} />
    </div>
  );
}

function PdfMaterial({ url }: { url: string }) {
  const embed = getPdfEmbed(url);
  return (
    <div className="w-full max-w-full">
      {embed && (
        <div className="w-full max-w-full h-[60vh] max-h-[420px] min-h-[220px] rounded-lg overflow-hidden border border-[#e6ecf5] bg-white">
          <iframe src={embed.src} title="PDF document" className="w-full h-full" />
        </div>
      )}
      <FallbackLink href={url} icon={File} label="Open PDF in new tab" className={embed ? "mt-2" : ""} />
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
