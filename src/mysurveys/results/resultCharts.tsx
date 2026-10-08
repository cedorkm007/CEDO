import { useMemo, type CSSProperties } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { percent } from "./resultsApi";
import {
  CANVAS_HEIGHT, CANVAS_WIDTH, WORD_CLOUD_FONT_FAMILY, WORD_CLOUD_FONT_WEIGHT,
  layoutWordCloud, tokenizeWordCloudEntry, type WordCount,
} from "@/lib/wordCloudLayout";

/**
 * The small chart building blocks for survey results. recharts is already part
 * of the staff app (SurveyResultsChart, GroupCountBreakdown); these use the same
 * colours and axis styling so they look like the rest of the Research Project
 * Monitoring tool. (This is staff-side only -- the public
 * respondent page never loads any of it.)
 */

const COLORS = ["#0088cc", "#062444", "#F3BC00", "#0f766e", "#7c3aed", "#be123c", "#15803d", "#c2410c"];
const AXIS = { fontSize: 10, fill: "#94a3b8" };

/** Horizontal bars; each bar ends with "n (x%)". `base` is what the percentage is out of. */
export function CountBars({ items, base }: { items: { label: string; count: number }[]; base: number }) {
  const data = items.map(i => ({ label: i.label, count: i.count, note: `${i.count} (${percent(i.count, base)}%)` }));
  const rowHeight = 34;
  return (
    <div className="max-h-[420px] overflow-y-auto" role="img" aria-label="Bar chart of the answers">
      <ResponsiveContainer width="100%" height={Math.max(data.length * rowHeight + 16, 90)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 72, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
          <XAxis type="number" allowDecimals={false} tick={AXIS} />
          <YAxis
            type="category" dataKey="label" width={140} interval={0} tick={{ fontSize: 11, fill: "#334155" }}
            tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)}
          />
          <Tooltip cursor={{ fill: "#f8fafd" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} formatter={(value, _name, item) => [String(item.payload.note), String(item.payload.label)]} />
          <Bar dataKey="count" fill="#0088cc" radius={[0, 3, 3, 0]} barSize={18}>
            <LabelList dataKey="note" position="right" style={{ fontSize: 11, fill: "#334155" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CountPie({ items, base }: { items: { label: string; count: number }[]; base: number }) {
  const data = items.filter(i => i.count > 0);
  if (data.length === 0) return <p className="text-[13px] text-slate-500">No answers to chart yet.</p>;
  return (
    <div className="h-[260px]" role="img" aria-label="Pie chart of the answers">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="label" outerRadius="75%" innerRadius="35%" paddingAngle={1}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value, name) => [`${value} (${percent(Number(value), base)}%)`, String(name)]} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical columns: used for scale distributions, dates, times of day and responses per day. */
export function CountColumns({ items, color = "#0088cc", height = 220, label = "Responses", everyLabel = false }: {
  items: { label: string; count: number }[];
  color?: string;
  height?: number;
  label?: string;
  /** Label every column (scales have few, fixed values); otherwise crowded labels are thinned out. */
  everyLabel?: boolean;
}) {
  if (items.length === 0) return <p className="text-[13px] text-slate-500">Nothing to chart yet.</p>;
  return (
    <div style={{ height }} role="img" aria-label={`${label} chart`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
          <XAxis dataKey="label" tick={AXIS} interval={everyLabel ? 0 : "preserveStartEnd"} minTickGap={14} />
          <YAxis allowDecimals={false} tick={AXIS} width={32} />
          <Tooltip cursor={{ fill: "#f8fafd" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} formatter={value => [String(value), label]} />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Optional word cloud for free-text answers, using the same layout as the Quest / Presentations word clouds. */
export function TextWordCloud({ texts }: { texts: string[] }) {
  const placed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of texts) for (const w of tokenizeWordCloudEntry(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
    const words: WordCount[] = [...counts].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 70);
    return layoutWordCloud(words, 14, 44);
  }, [texts]);

  if (placed.length === 0) return <p className="text-[13px] text-slate-500">No words to show yet.</p>;
  return (
    <div
      className="relative mx-auto w-full max-w-[720px] rounded-xl bg-white"
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`, containerType: "inline-size" } as CSSProperties}
      role="img" aria-label="Word cloud of the answers"
    >
      {placed.map((w, i) => (
        <span
          key={w.text} title={`${w.text} — ${w.count}`}
          style={{
            position: "absolute",
            left: `${(w.x / CANVAS_WIDTH) * 100}%`, top: `${(w.y / CANVAS_HEIGHT) * 100}%`,
            fontSize: `${(w.fontSize / CANVAS_WIDTH) * 100}cqw`,
            fontFamily: WORD_CLOUD_FONT_FAMILY, fontWeight: WORD_CLOUD_FONT_WEIGHT,
            color: COLORS[i % COLORS.length], lineHeight: 1.15, whiteSpace: "nowrap",
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafd] p-3 text-center">
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-extrabold text-[#062444]">{value}</p>
    </div>
  );
}
