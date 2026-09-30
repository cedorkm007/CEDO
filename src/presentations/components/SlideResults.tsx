import { Eye, EyeOff } from "lucide-react";
import type { PresentationResponseRow } from "../presentationSessionApi";
import type { MultipleChoiceSettings, RankingSettings } from "../slidesApi";

const CLOUD_COLORS = ["#062444", "#0088cc", "#F3BC00", "#7C3AED", "#0E9F6E"];

export function WordCloudResults({ responses, moderatable, onToggleHidden }: {
  responses: PresentationResponseRow[];
  /** Shows the raw per-submission list below the cloud with hide/unhide controls -- the "presenter can hide inappropriate word cloud entries" requirement. Granularity is per response row (one person's whole submission), not per individual word, since that's what the `hidden` column actually gates. */
  moderatable?: boolean;
  onToggleHidden?: (responseId: string, hidden: boolean) => void;
}) {
  const visible = responses.filter(r => !r.hidden);
  const tally = new Map<string, number>();
  for (const r of visible) {
    for (const word of r.response.words ?? []) {
      const normalized = word.trim().toLowerCase();
      if (!normalized) continue;
      tally.set(normalized, (tally.get(normalized) ?? 0) + 1);
    }
  }
  const sorted = [...tally.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  const maxCount = sorted[0]?.count ?? 1;

  return (
    <div className="w-full">
      {sorted.length === 0 ? (
        <p className="text-slate-400 text-[13px] text-center">No responses yet</p>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 max-h-64 overflow-y-auto">
          {sorted.slice(0, 100).map(({ word, count }, i) => (
            <span
              key={word}
              style={{ fontSize: `${14 + (count / maxCount) * 40}px`, color: CLOUD_COLORS[i % CLOUD_COLORS.length] }}
              className="font-bold leading-tight"
              title={`${count} response${count > 1 ? "s" : ""}`}
            >
              {word}
            </span>
          ))}
        </div>
      )}

      {moderatable && responses.length > 0 && (
        <div className="mt-5 border-t border-[#f0f3f8] pt-3 text-left max-h-40 overflow-y-auto">
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-2">Individual submissions</p>
          <div className="space-y-1">
            {responses.map(r => (
              <div key={r.id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] ${r.hidden ? "bg-slate-50 text-slate-400" : "bg-[#f7f9fc] text-[#062444]"}`}>
                <span className={r.hidden ? "line-through" : ""}>{(r.response.words ?? []).join(", ") || "(empty)"}</span>
                <button
                  onClick={() => onToggleHidden?.(r.id, !r.hidden)}
                  aria-label={r.hidden ? "Unhide submission" : "Hide submission"}
                  className="shrink-0 text-slate-400 hover:text-[#062444]"
                >
                  {r.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MultipleChoiceResults({ responses, settings }: { responses: PresentationResponseRow[]; settings: MultipleChoiceSettings }) {
  const visible = responses.filter(r => !r.hidden);
  const counts = settings.options.map((_, i) => visible.filter(r => r.response.selectedIndexes?.includes(i)).length);
  const maxCount = Math.max(1, ...counts);
  const total = visible.length;
  if (total === 0) return <p className="text-slate-400 text-[13px] text-center">No responses yet</p>;
  return (
    <div className="w-full max-w-lg space-y-3">
      {settings.options.map((option, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-[13px] font-semibold text-[#062444] mb-1">
            <span className="truncate">{option}</span>
            <span className="text-slate-400 shrink-0 ml-2">{counts[i]} ({Math.round((counts[i] / total) * 100)}%)</span>
          </div>
          <div className="h-3 bg-[#f0f3f8] rounded-full overflow-hidden">
            <div className="h-full bg-[#0088cc] rounded-full transition-all" style={{ width: `${(counts[i] / maxCount) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RankingResults({ responses, settings }: { responses: PresentationResponseRow[]; settings: RankingSettings }) {
  const visible = responses.filter(r => !r.hidden);
  if (visible.length === 0) return <p className="text-slate-400 text-[13px] text-center">No responses yet</p>;
  const averages = settings.items.map((item, itemIndex) => {
    const positions = visible.map(r => (r.response.order ?? []).indexOf(itemIndex)).filter(p => p >= 0);
    const avg = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
    return { item, avg };
  }).sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));
  return (
    <div className="w-full max-w-lg space-y-2">
      {averages.map(({ item, avg }, i) => (
        <div key={item + i} className="flex items-center justify-between border border-[#e6ecf5] rounded-lg px-4 py-2.5">
          <span className="text-[13.5px] font-semibold text-[#062444]">{i + 1}. {item}</span>
          <span className="text-[12px] text-slate-400">{avg !== null ? `Avg rank ${(avg + 1).toFixed(1)}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}
