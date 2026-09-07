import { useEffect, useState } from "react";
import { ListChecks, SlidersHorizontal } from "lucide-react";
import { fetchSurveys, fetchSurveyQuestions, fetchSurveyQuestionResults } from "../../seadApi";
import { SurveyResultsChart } from "../../components/SurveyResultsChart";
import type { Survey, SurveyQuestion, SurveyChoiceResult, SurveyLikertResult } from "../../types";

export function SurveyResultsSubtab() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [selectedSurveyId, setSelectedSurveyId] = useState("");

  useEffect(() => {
    (async () => {
      setLoadingSurveys(true);
      setSurveys(await fetchSurveys());
      setLoadingSurveys(false);
    })();
  }, []);

  const selectedSurvey = surveys.find(s => s.id === selectedSurveyId) ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Survey</label>
        <select value={selectedSurveyId} onChange={e => setSelectedSurveyId(e.target.value)} disabled={loadingSurveys}
          className="w-full max-w-md border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
          <option value="">{loadingSurveys ? "Loading surveys…" : "Select a survey…"}</option>
          {surveys.map(s => (
            <option key={s.id} value={s.id}>{s.title} — {s.activityName}</option>
          ))}
        </select>
      </div>

      {selectedSurvey && <SurveyResultsView survey={selectedSurvey} />}
    </div>
  );
}

function SurveyResultsView({ survey }: { survey: Survey }) {
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setQuestions(await fetchSurveyQuestions(survey.id));
      setLoading(false);
    })();
  }, [survey.id]);

  if (loading) return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading questions…</div>;
  if (questions.length === 0) return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">This survey has no questions yet.</div>;

  return (
    <div className="space-y-4">
      {questions.map(q => <QuestionResultCard key={q.id} question={q} />)}
    </div>
  );
}

function QuestionResultCard({ question }: { question: SurveyQuestion }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choiceResults, setChoiceResults] = useState<SurveyChoiceResult[] | null>(null);
  const [likertResult, setLikertResult] = useState<SurveyLikertResult | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      const result = await fetchSurveyQuestionResults(question.id, question.questionType);
      if (!result.ok) {
        setError(result.error || "Failed to load results.");
      } else {
        setChoiceResults(result.choiceResults ?? null);
        setLikertResult(result.likertResult ?? null);
      }
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [question.id]);

  const n = question.questionType === "multiple_choice"
    ? (choiceResults ?? []).reduce((sum, c) => sum + c.count, 0)
    : likertResult?.n ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[14.5px] font-semibold text-[#062444] leading-relaxed">{question.questionText}</p>
        <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2.5 py-1">
          {question.questionType === "likert" ? <><SlidersHorizontal size={11} /> Likert</> : <><ListChecks size={11} /> Multiple Choice</>}
        </span>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading results…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : n === 0 ? (
        <p className="text-[13px] text-slate-400">No responses yet.</p>
      ) : question.questionType === "multiple_choice" ? (
        <SurveyResultsChart bars={(choiceResults ?? []).map(c => ({ label: c.choiceText, count: c.count }))} />
      ) : likertResult ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <StatTile label="n" value={String(likertResult.n)} />
            <StatTile label="Mean" value={likertResult.mean !== null ? likertResult.mean.toFixed(2) : "—"} />
            <StatTile label="Median" value={likertResult.median !== null ? likertResult.median.toFixed(2) : "—"} />
            <StatTile label="Std Dev" value={likertResult.stddev !== null ? likertResult.stddev.toFixed(2) : "—"} />
          </div>
          <p className="text-[11px] text-slate-400">
            Scale {question.likertScaleMin}–{question.likertScaleMax}: "{question.likertMinLabel}" to "{question.likertMaxLabel}"
          </p>
          <SurveyResultsChart bars={likertResult.distribution.map(d => ({ label: `${d.value} (${d.percentage}%)`, count: d.count }))} />
        </div>
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f8fafd] rounded-xl p-3 text-center">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p className="text-lg font-extrabold text-[#062444]">{value}</p>
    </div>
  );
}
