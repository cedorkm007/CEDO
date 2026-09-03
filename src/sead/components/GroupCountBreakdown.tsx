import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export interface GroupCountRow {
  label: string;
  count: number;
}

/**
 * Bar chart + table for a "count of scholars grouped by X" breakdown —
 * shared by every level of the Scholarship Program Information tab's
 * drill-downs (Barangay, School, Year Level, Course). Chart height scales
 * with `rows.length` rather than any fixed number, since the actual
 * category count varies per level and can grow/shrink over time (schools
 * especially — there's no fixed canonical list the way Barangay has).
 * A zero count renders as a non-clickable count (nothing to drill into).
 */
export function GroupCountBreakdown({
  title, columnLabel, rows, onSelect,
}: {
  title: string;
  columnLabel: string;
  rows: GroupCountRow[];
  onSelect: (label: string) => void;
}) {
  const rowHeight = rows.length > 30 ? 16 : 22;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-3">{title}</p>
        <div className="max-h-[520px] overflow-y-auto">
          <ResponsiveContainer width="100%" height={Math.max(rows.length * rowHeight, 80)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 10, fill: "#334155" }} interval={0} />
              <Tooltip cursor={{ fill: "#f8fafd" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} />
              <Bar dataKey="count" fill="#0088cc" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3">{columnLabel}</th>
              <th className="px-4 py-3 text-right">Scholars</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.label} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-2.5">{r.label}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onSelect(r.label)}
                      disabled={r.count === 0}
                      className="font-bold text-[#0088cc] hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-default">
                      {r.count.toLocaleString()}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
