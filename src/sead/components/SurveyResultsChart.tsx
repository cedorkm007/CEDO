import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export interface SurveyResultBar {
  label: string;
  count: number;
}

/**
 * Read-only frequency bar chart for one survey question's results — same
 * recharts convention as GroupCountBreakdown.tsx (vertical BarChart,
 * category Y-axis, numeric X-axis), but without that component's
 * click-to-drill-down/show-hide affordances, which don't apply here.
 */
export function SurveyResultsChart({ bars }: { bars: SurveyResultBar[] }) {
  const rowHeight = 28;
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <ResponsiveContainer width="100%" height={Math.max(bars.length * rowHeight, 80)}>
        <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 10, fill: "#334155" }} interval={0} />
          <Tooltip cursor={{ fill: "#f8fafd" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} />
          <Bar dataKey="count" fill="#0088cc" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
