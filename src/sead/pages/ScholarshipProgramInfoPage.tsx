import { useEffect, useState } from "react";
import { MapPin, School as SchoolIcon, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  fetchScholarshipStatusCounts, fetchScholarsByBarangay, fetchAllScholarsInformationForExport,
  type ScholarshipStatusCounts, type BarangayCount, type ScholarInformationRow,
} from "../seadApi";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";
import { ScholarListPanel } from "../components/ScholarListPanel";

type InfoSubtab = "barangay" | "school";

/**
 * Birds-eye view of the scholarship program (see the approved plan for
 * the full 5-phase design). This page covers Phase 1 (status counts +
 * subtab shell) and Phase 2 (Barangay breakdown). School/Year
 * Level/Course drill-down and per-scholar profile export land in later
 * phases.
 */
export function ScholarshipProgramInfoPage() {
  const [counts, setCounts] = useState<ScholarshipStatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subtab, setSubtab] = useState<InfoSubtab>("barangay");

  useEffect(() => {
    (async () => {
      const result = await fetchScholarshipStatusCounts();
      if (result.ok && result.counts) {
        setCounts(result.counts);
      } else {
        setError(result.error || "Failed to load Scholarship Status counts.");
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={20} className="text-[#062444]" />
        <h2 className="text-lg font-bold text-[#062444]">Scholarship Program Information</h2>
      </div>
      <p className="text-[12.5px] text-slate-500 mb-5">A birds-eye view of the scholarship program.</p>

      {error && <p className="mb-4 text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Regular" value={counts?.regular} loading={loading} colorClasses="bg-green-100 text-green-700" />
        <StatCard label="Probationary" value={counts?.probationary} loading={loading} colorClasses="bg-red-100 text-red-600" />
        <StatCard label="On leave" value={counts?.onLeave} loading={loading} colorClasses="bg-amber-100 text-amber-700" />
        <StatCard label="Reconsidered" value={counts?.reconsidered} loading={loading} colorClasses="bg-blue-100 text-blue-700" />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setSubtab("barangay")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "barangay" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <MapPin size={14} /> Barangay
        </button>
        <button onClick={() => setSubtab("school")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "school" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <SchoolIcon size={14} /> School
        </button>
      </div>

      {subtab === "barangay" ? (
        <BarangaySubtab />
      ) : (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-8 text-center text-[13px] text-slate-400">
          School breakdown coming soon.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, loading, colorClasses }: { label: string; value: number | undefined; loading: boolean; colorClasses: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>
      {loading ? (
        <p className="text-2xl font-extrabold text-slate-300">—</p>
      ) : (
        <span className={`inline-block text-2xl font-extrabold rounded-lg px-2.5 py-0.5 ${colorClasses}`}>{value?.toLocaleString() ?? 0}</span>
      )}
    </div>
  );
}

/**
 * All 80 CDO barangays, real counts merged in (zero for any barangay
 * with no scholars — ALL_BARANGAYS is the canonical list, not derived
 * from who actually has scholars), sorted by count so both the chart and
 * table read most-to-least at a glance.
 */
function BarangaySubtab() {
  const [counts, setCounts] = useState<BarangayCount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [scholarRows, setScholarRows] = useState<ScholarInformationRow[] | null>(null);
  const [loadingScholars, setLoadingScholars] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await fetchScholarsByBarangay();
      if (result.ok && result.counts) {
        const byBarangay = new Map(result.counts.map(c => [c.barangay, c.count]));
        const merged = ALL_BARANGAYS.map(b => ({ barangay: b, count: byBarangay.get(b) ?? 0 }))
          .sort((a, b) => b.count - a.count);
        setCounts(merged);
      } else {
        setError(result.error || "Failed to load barangay counts.");
      }
      setLoading(false);
    })();
  }, []);

  async function handleSelect(barangay: string) {
    setSelected(barangay);
    setLoadingScholars(true);
    const rows = await fetchAllScholarsInformationForExport({ barangay });
    setScholarRows(rows);
    setLoadingScholars(false);
  }

  if (loading) return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-8 text-center text-[13px] text-slate-400">Loading…</div>;
  if (error) return <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>;
  if (!counts) return null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-3">Scholars per Barangay</p>
        <div className="max-h-[520px] overflow-y-auto">
          <ResponsiveContainer width="100%" height={counts.length * 18}>
            <BarChart data={counts} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis type="category" dataKey="barangay" width={140} tick={{ fontSize: 10, fill: "#334155" }} interval={0} />
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
              <th className="px-4 py-3">Barangay</th>
              <th className="px-4 py-3 text-right">Scholars</th>
            </tr>
          </thead>
          <tbody>
            {counts.map(c => (
              <tr key={c.barangay} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                <td className="px-4 py-2.5">{c.barangay}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => handleSelect(c.barangay)}
                    disabled={c.count === 0}
                    className="font-bold text-[#0088cc] hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-default">
                    {c.count.toLocaleString()}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        loadingScholars ? (
          <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading scholars in {selected}…</div>
        ) : (
          <ScholarListPanel
            title={`Scholars in ${selected}`}
            rows={scholarRows ?? []}
            filtersSummary={`Filters: Barangay = ${selected}`}
            filenamePrefix={`scholars-barangay-${selected.toLowerCase().replace(/\s+/g, "-")}`}
            defaultExpanded
          />
        )
      )}
    </div>
  );
}
