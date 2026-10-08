import { useMemo, useState } from "react";
import { PieChart as PieIcon, BarChart3 } from "lucide-react";
import { QUESTION_TYPE_LABELS } from "../surveyTypes";
import { TYPE_ICONS } from "../builder/typeIcons";
import {
  combineNumbers, combineOptions, combineTexts, combineValues, numberStats, percent,
  type QuestionGroup, type ResultQuestion,
} from "./resultsApi";
import { CountBars, CountColumns, CountPie, StatTile, TextWordCloud } from "./resultCharts";

const TEXT_PAGE = 20;

function formatDay(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What one question (or one chosen version of it) looks like, by type. */
function QuestionBody({ versions }: { versions: ResultQuestion[] }) {
  const latest = versions[versions.length - 1];
  const answered = versions.reduce((s, v) => s + v.answered, 0);
  const [pie, setPie] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [shown, setShown] = useState(TEXT_PAGE);

  const options = useMemo(() => combineOptions(versions), [versions]);
  const numbers = useMemo(() => combineNumbers(versions), [versions]);
  const values = useMemo(() => combineValues(versions), [versions]);
  const texts = useMemo(() => combineTexts(versions), [versions]);

  if (answered === 0) return <p className="text-[13px] text-slate-500">No responses to this question yet.</p>;

  switch (latest.type) {
    case "multiple_choice":
    case "dropdown":
      return (
        <div className="space-y-2">
          <div className="flex justify-end gap-1" role="group" aria-label="Chart type">
            <button onClick={() => setPie(false)} aria-pressed={!pie} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold ${!pie ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f0f3f8]"}`}><BarChart3 size={12} /> Bar</button>
            <button onClick={() => setPie(true)} aria-pressed={pie} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold ${pie ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f0f3f8]"}`}><PieIcon size={12} /> Pie</button>
          </div>
          {pie ? <CountPie items={options} base={answered} /> : <CountBars items={options} base={answered} />}
        </div>
      );

    case "checkboxes":
      return (
        <div className="space-y-2">
          <p className="text-[11.5px] text-slate-500">People could tick several options, so percentages are out of the {answered} people who answered.</p>
          <CountBars items={options} base={answered} />
        </div>
      );

    case "linear_scale":
    case "rating": {
      const stats = numberStats(numbers);
      const lo = Math.min(latest.scaleMin ?? 1, ...numbers.map(n => n.value));
      const hi = Math.max(latest.scaleMax ?? 5, ...numbers.map(n => n.value));
      const byValue = new Map(numbers.map(n => [n.value, n.count]));
      const columns = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map(v => ({ label: String(v), count: byValue.get(v) ?? 0 }));
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Answered" value={String(stats.n)} />
            <StatTile label="Mean" value={stats.mean !== null ? stats.mean.toFixed(2) : "—"} />
            <StatTile label="Median" value={stats.median !== null ? stats.median.toFixed(1).replace(/\.0$/, "") : "—"} />
          </div>
          {latest.type === "linear_scale" && (latest.scaleMinLabel || latest.scaleMaxLabel) && (
            <p className="text-[11px] text-slate-500">Scale {lo}–{hi}: “{latest.scaleMinLabel || lo}” to “{latest.scaleMaxLabel || hi}”</p>
          )}
          {latest.type === "rating" && <p className="text-[11px] text-slate-500">Star rating out of {hi}</p>}
          <CountColumns items={columns} label="Answers" everyLabel />
        </div>
      );
    }

    case "date":
      return (
        <div className="space-y-2">
          <p className="text-[11.5px] text-slate-500">How many people gave each date, in date order.</p>
          <CountColumns items={values.map(v => ({ label: formatDay(v.value), count: v.count }))} label="Answers per date" />
        </div>
      );

    case "time": {
      const byHour = new Array<number>(24).fill(0);
      for (const v of values) { const h = parseInt(v.value.slice(0, 2), 10); if (h >= 0 && h < 24) byHour[h] += v.count; }
      return (
        <div className="space-y-2">
          <p className="text-[11.5px] text-slate-500">How many people gave a time in each hour of the day.</p>
          <CountColumns items={byHour.map((count, h) => ({ label: `${String(h).padStart(2, "0")}:00`, count }))} label="Answers per hour" />
        </div>
      );
    }

    case "short_answer":
    case "paragraph": {
      const total = versions.reduce((s, v) => s + (v.textTotal ?? 0), 0);
      const showVersion = versions.length > 1;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-slate-500">
              {total > texts.length ? `Showing the latest ${texts.length} of ${total} answers` : `${total} answer${total === 1 ? "" : "s"}`}, newest first.
            </p>
            <div className="flex gap-1" role="group" aria-label="Show as">
              <button onClick={() => setCloud(false)} aria-pressed={!cloud} className={`rounded-md px-2 py-1 text-[11.5px] font-semibold ${!cloud ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f0f3f8]"}`}>List</button>
              <button onClick={() => setCloud(true)} aria-pressed={cloud} className={`rounded-md px-2 py-1 text-[11.5px] font-semibold ${cloud ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f0f3f8]"}`}>Word cloud</button>
            </div>
          </div>
          {cloud ? (
            <TextWordCloud texts={texts.map(t => t.text)} />
          ) : (
            <>
              <ul className="space-y-1.5">
                {texts.slice(0, shown).map((t, i) => (
                  <li key={i} className="rounded-lg border border-[#e6ecf5] bg-white px-3 py-1.5 text-[13px] text-[#062444]">
                    <span className="whitespace-pre-line break-words">{t.text}</span>
                    <span className="mt-0.5 block text-[10.5px] text-slate-500">
                      {new Date(t.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {showVersion && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-500">v{t.version}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {texts.length > shown && (
                <button onClick={() => setShown(s => s + 30)} className="text-[12.5px] font-semibold text-[#00709f] hover:underline">Show more ({texts.length - shown} more)</button>
              )}
            </>
          )}
        </div>
      );
    }
  }
}

/**
 * One question's results. When the question was reworded after people had
 * answered it, every version is shown with its own wording and response count;
 * the person picks "All versions" (combined, when they are the same kind of
 * question) or a single version, so it is always clear which wording an answer
 * belongs to.
 */
export function QuestionResultCard({ group, number }: { group: QuestionGroup; number: number }) {
  const [view, setView] = useState<"all" | number>("all");
  const { latest } = group;
  const TypeIcon = TYPE_ICONS[latest.type];
  const totalAnswered = group.versions.reduce((s, v) => s + v.answered, 0);
  const selected = view === "all" ? group.versions : group.versions.filter(v => v.version === view);

  return (
    <section className="rounded-2xl border border-[#e6ecf5] bg-white p-4" aria-label={`Question ${number}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-[14.5px] font-semibold leading-relaxed text-[#062444]">
            <span className="mr-1.5 text-slate-500">{number}.</span>{latest.text.trim() || "Untitled question"}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
            <span className="inline-flex items-center gap-1"><TypeIcon size={12} /> {QUESTION_TYPE_LABELS[latest.type]}</span>
            <span>{totalAnswered} answered</span>
            {group.multiVersion && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{group.versions.length} versions</span>}
            {group.removed && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Removed from the survey</span>}
          </p>
        </div>
      </div>

      {group.multiVersion && (
        <div className="mb-3 rounded-xl bg-[#f8fafd] p-3">
          <p className="mb-2 text-[11.5px] text-slate-500">
            This question was reworded after people had answered it. Each version keeps the responses it received.
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which version to show">
            <button onClick={() => setView("all")} aria-pressed={view === "all"} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${view === "all" ? "bg-[#062444] text-white" : "border border-[#e6ecf5] bg-white text-slate-600 hover:bg-[#f0f3f8]"}`}>
              All versions ({totalAnswered})
            </button>
            {group.versions.map(v => (
              <button
                key={v.version} onClick={() => setView(v.version)} aria-pressed={view === v.version}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${view === v.version ? "bg-[#062444] text-white" : "border border-[#e6ecf5] bg-white text-slate-600 hover:bg-[#f0f3f8]"}`}
              >
                Version {v.version} ({v.answered}){!v.archived ? " · current" : ""}
              </button>
            ))}
          </div>
          <ul className="mt-2 space-y-0.5 text-[11.5px] text-slate-500">
            {group.versions.map(v => (
              <li key={v.version} className="break-words"><span className="font-semibold text-slate-600">v{v.version}:</span> {v.text.trim() || "Untitled question"} <span className="text-slate-500">· {QUESTION_TYPE_LABELS[v.type]}</span></li>
            ))}
          </ul>
        </div>
      )}

      {group.sameType || !group.multiVersion ? (
        <QuestionBody versions={selected} />
      ) : (
        // The versions are different kinds of question, so their answers can't share a chart: one section each.
        <div className="space-y-5">
          {selected.map(v => (
            <div key={v.version}>
              <p className="mb-1.5 text-[12px] font-bold text-slate-600">Version {v.version} — {QUESTION_TYPE_LABELS[v.type]} · {percent(v.answered, Math.max(totalAnswered, 1))}% of answers</p>
              <QuestionBody versions={[v]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
