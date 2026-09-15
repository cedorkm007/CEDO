import { useEffect, useState } from "react";
import { MapPin, School as SchoolIcon, Clock, CheckCircle2 } from "lucide-react";
import {
  fetchFinancialAssistancePeriods, fetchFinancialAssistanceStatusCounts,
  fetchFinancialAssistanceByBarangay, fetchFinancialAssistanceBySchool,
  fetchFinancialAssistanceApplicants, formatPeriodLabel,
  type FinancialAssistancePeriod, type FinancialAssistanceStatusCounts, type FinancialAssistanceApplicant,
} from "../financialAssistanceApi";
import { GroupCountBreakdown, type GroupCountRow } from "../components/GroupCountBreakdown";
import { Modal } from "../components/Modal";

type Dimension = "barangay" | "school";

const STATUS_META: Record<string, { label: string; className: string; Icon: typeof Clock }> = {
  processing: { label: "Still Processing", className: "bg-amber-50 text-amber-700", Icon: Clock },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
};

/**
 * Read-only birds-eye summary of Financial Assistance for Scholarship
 * Program Information — deliberately mirrors MainstreamScholarsTab's own
 * stat-card + Barangay/School breakdown shape in this same directory, but
 * scoped to a Period (the one dimension Mainstream doesn't have, since its
 * scholar list doesn't reset every semester the way Financial Assistance
 * does). No add/edit/delete/import actions here — those live in the
 * separate Financial Assistance Tools page (financial_assistance tag);
 * this tab only needs scholarship_program_info, matching the RPCs behind
 * it (financial_assistance_status_counts / _by_barangay / _by_school, all
 * gated by is_scholarship_program_staff()).
 */
export function FinancialAssistanceSummaryTab() {
  const [periods, setPeriods] = useState<FinancialAssistancePeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [loadingPeriods, setLoadingPeriods] = useState(true);

  const [counts, setCounts] = useState<FinancialAssistanceStatusCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [dimension, setDimension] = useState<Dimension>("barangay");
  const [groupCounts, setGroupCounts] = useState<GroupCountRow[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [applicantRows, setApplicantRows] = useState<FinancialAssistanceApplicant[] | null>(null);
  const [loadingApplicants, setLoadingApplicants] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingPeriods(true);
      const rows = await fetchFinancialAssistancePeriods();
      setPeriods(rows);
      const active = rows.find(p => p.isActive) ?? rows[0];
      setSelectedPeriodId(active?.id ?? "");
      setLoadingPeriods(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedPeriodId) return;
    setSelectedGroup(null);
    setApplicantRows(null);
    setLoadingCounts(true);
    setLoadingGroups(true);
    fetchFinancialAssistanceStatusCounts(selectedPeriodId).then(c => { setCounts(c); setLoadingCounts(false); });
    (dimension === "barangay" ? fetchFinancialAssistanceByBarangay(selectedPeriodId) : fetchFinancialAssistanceBySchool(selectedPeriodId))
      .then(rows => { setGroupCounts(rows); setLoadingGroups(false); });
  }, [selectedPeriodId, dimension]);

  async function handleSelectGroup(value: string) {
    setSelectedGroup(value);
    setLoadingApplicants(true);
    const all = await fetchFinancialAssistanceApplicants(selectedPeriodId);
    const matches = all.filter(a => {
      const groupValue = dimension === "barangay" ? (a.barangay.trim() || "No Barangay Set") : (a.school.trim() || "No School Set");
      return groupValue === value;
    });
    setApplicantRows(matches);
    setLoadingApplicants(false);
  }

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId) ?? null;

  if (loadingPeriods) return <LoadingPanel label="Loading…" />;
  if (periods.length === 0) {
    return <EmptyPanel label="No Financial Assistance periods yet — add one from Financial Assistance Tools." />;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Period</label>
        <select value={selectedPeriodId} onChange={e => setSelectedPeriodId(e.target.value)}
          className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] font-semibold text-[#062444] outline-none focus:border-[#0088cc] bg-white min-w-[220px]">
          {periods.map(p => <option key={p.id} value={p.id}>{formatPeriodLabel(p)}{p.isActive ? " (active)" : ""}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Applicants" value={counts?.total} loading={loadingCounts} colorClasses="bg-blue-100 text-blue-700" />
        <StatCard label="Still Processing" value={counts?.processing} loading={loadingCounts} colorClasses="bg-amber-100 text-amber-700" />
        <StatCard label="Approved" value={counts?.approved} loading={loadingCounts} colorClasses="bg-green-100 text-green-700" />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setDimension("barangay")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${dimension === "barangay" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <MapPin size={14} /> Barangay
        </button>
        <button onClick={() => setDimension("school")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${dimension === "school" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <SchoolIcon size={14} /> School
        </button>
      </div>

      {loadingGroups ? (
        <LoadingPanel label="Loading…" />
      ) : (groupCounts ?? []).length === 0 ? (
        <EmptyPanel label={`No applicants yet for ${selectedPeriod ? formatPeriodLabel(selectedPeriod) : "this period"}.`} />
      ) : (
        <GroupCountBreakdown
          title={`Financial Assistance Applicants per ${dimension === "barangay" ? "Barangay" : "School"}`}
          columnLabel={dimension === "barangay" ? "Barangay" : "School"}
          rows={groupCounts ?? []}
          onSelect={handleSelectGroup}
        />
      )}

      {selectedGroup && (
        <Modal title={`Financial Assistance — ${selectedGroup}`} onClose={() => { setSelectedGroup(null); setApplicantRows(null); }}>
          {loadingApplicants ? <LoadingPanel label="Loading applicants…" /> : (applicantRows ?? []).length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-6">No applicants here.</p>
          ) : (
            <ul className="space-y-2">
              {(applicantRows ?? []).map(a => {
                const meta = STATUS_META[a.status] ?? STATUS_META.processing;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#e6ecf5] px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-[#062444]">{a.name}</p>
                      <p className="text-[11px] text-slate-400">{a.referenceNumber} • {dimension === "barangay" ? a.school : a.barangay}</p>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${meta.className}`}>
                      <meta.Icon size={11} /> {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">{label}</div>;
}

function EmptyPanel({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">{label}</p>;
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
