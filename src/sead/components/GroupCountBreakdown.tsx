import { useSyncExternalStore } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSort, SortableTh } from "@/app/components/SortableTable";

// Module-level (not per-component) show/hide state: every GroupCountBreakdown
// instance on the Scholarship Program Information tab shares one toggle, so
// hiding the graph on Barangay stays hidden after switching to School, or
// drilling into Year Level/Course — each of those is a fresh mount of this
// component, and per-instance useState would reset back to visible every
// time. Plain module state + useSyncExternalStore rather than React Context
// so no provider needs threading through the page's subtab components.
let sharedShowChart = true;
const chartVisibilityListeners = new Set<() => void>();

function setSharedShowChart(value: boolean): void {
  sharedShowChart = value;
  chartVisibilityListeners.forEach(listener => listener());
}

function subscribeToChartVisibility(listener: () => void): () => void {
  chartVisibilityListeners.add(listener);
  return () => chartVisibilityListeners.delete(listener);
}

function useSharedShowChart(): boolean {
  return useSyncExternalStore(subscribeToChartVisibility, () => sharedShowChart);
}

export interface GroupCountRow {
  label: string;
  count: number;
}

const AXIS_LABEL_MAX_CHARS = 22;

/**
 * Recharts wraps a category-axis tick's text onto multiple lines once it
 * exceeds the axis's declared `width` — fine for a couple of long labels,
 * but with many long school/course names (e.g. "University Of Science
 * And Technology Of Southern Philippines") every wrapped label spans
 * more vertical space than one bar's row height, so neighboring labels
 * overlap. Truncating to a single line here avoids that; the full name
 * is still available via the bar's hover tooltip (built from the raw
 * data value, not this truncated tick text) and in the table below.
 */
function truncateAxisLabel(label: string): string {
  return label.length > AXIS_LABEL_MAX_CHARS ? `${label.slice(0, AXIS_LABEL_MAX_CHARS - 1)}…` : label;
}

/**
 * Bar chart + table for a "count of scholars grouped by X" breakdown —
 * shared by every level of the Scholarship Program Information tab's
 * drill-downs (Barangay, School, Year Level, Course). Chart height scales
 * with `rows.length` rather than any fixed number, since the actual
 * category count varies per level and can grow/shrink over time (schools
 * especially — there's no fixed canonical list the way Barangay has).
 * The chart can be collapsed independently of the table (per-instance —
 * each drill-down level remembers its own show/hide state, since they're
 * separate mounted instances). The whole row (not just the count) is
 * clickable to drill in, since the row as a whole is the "barangay/school
 * card" the user is selecting — a zero-count row has nothing to drill
 * into, so it stays inert.
 */
export function GroupCountBreakdown({
  title, columnLabel, rows, onSelect,
}: {
  title: string;
  columnLabel: string;
  rows: GroupCountRow[];
  onSelect: (label: string) => void;
}) {
  const showChart = useSharedShowChart();
  const { sorted: sortedRows, sortState, toggleSort } = useSort<GroupCountRow>(rows, {
    label: r => r.label,
    count: r => r.count,
  });
  const rowHeight = rows.length > 30 ? 16 : 22;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
          <button onClick={() => setSharedShowChart(!showChart)}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2 py-1 hover:bg-[#f8fafd]">
            {showChart ? <><ChevronUp size={12} /> Hide graph</> : <><ChevronDown size={12} /> Show graph</>}
          </button>
        </div>
        {showChart && (
          <div className="max-h-[520px] overflow-y-auto">
            <ResponsiveContainer width="100%" height={Math.max(rows.length * rowHeight, 80)}>
              <BarChart data={sortedRows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 10, fill: "#334155" }} interval={0} tickFormatter={truncateAxisLabel} />
                <Tooltip cursor={{ fill: "#f8fafd" }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e6ecf5" }} />
                <Bar dataKey="count" fill="#0088cc" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <SortableTh label={columnLabel} sortKey="label" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Scholars" sortKey="count" sortState={sortState} onSort={toggleSort} className="px-4 py-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-400">No data.</td></tr>
            ) : (
              sortedRows.map(r => {
                const clickable = r.count > 0;
                return (
                  <tr key={r.label}
                    onClick={clickable ? () => onSelect(r.label) : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.label); } } : undefined}
                    className={`border-t border-[#f0f3f8] ${clickable ? "cursor-pointer hover:bg-[#f8fafd]" : ""}`}>
                    <td className="px-4 py-2.5">{r.label}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${clickable ? "text-[#0088cc]" : "text-slate-300"}`}>
                      {r.count.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
