import { useEffect, useState } from "react";
import { MapPin, School as SchoolIcon, BarChart3 } from "lucide-react";
import { fetchScholarshipStatusCounts, type ScholarshipStatusCounts } from "../seadApi";

type InfoSubtab = "barangay" | "school";

/**
 * Birds-eye view of the scholarship program — Phase 1 of a larger
 * feature (see the approved plan). This phase: the 4 top-line
 * Scholarship Status counts and the Barangay/School subtab shell.
 * Barangay and School drill-downs land in later phases.
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

      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-8 text-center text-[13px] text-slate-400">
        {subtab === "barangay" ? "Barangay breakdown coming soon." : "School breakdown coming soon."}
      </div>
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
