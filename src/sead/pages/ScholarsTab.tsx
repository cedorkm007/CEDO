import { useEffect, useState } from "react";
import { Search, UserPlus, KeyRound } from "lucide-react";
import { fetchScholars, resetScholarPassword } from "../seadApi";
import { AddScholarModal } from "../components/AddScholarModal";
import type { ScholarListItem } from "../types";

export function ScholarsTab() {
  const [scholars, setScholars] = useState<ScholarListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setScholars(await fetchScholars(search));
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleResetPassword(scholarIdNumber: string) {
    setResetBusyId(scholarIdNumber);
    const result = await resetScholarPassword(scholarIdNumber);
    setResetBusyId(null);
    setConfirmResetId(null);
    setToast(result.ok ? `Password reset to 123456 for ${result.name}.` : (result.error || "Failed to reset password."));
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
          <UserPlus size={15} className="text-[#F3BC00]" /> Add Scholar
        </button>
      </div>

      {toast && <div className="mb-4 bg-[#062444] text-white text-[13.5px] rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3">Scholar ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">School</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : scholars.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No scholars found.</td></tr>
            ) : (
              scholars.map(s => (
                <tr key={s.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444]">{s.scholarIdNumber}</td>
                  <td className="px-4 py-3">{s.lastName}, {s.firstName} {s.middleName}</td>
                  <td className="px-4 py-3 text-slate-500">{s.school || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${
                      s.status === "probation" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmResetId === s.scholarIdNumber ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Reset to 123456?</span>
                        <button onClick={() => handleResetPassword(s.scholarIdNumber)} disabled={resetBusyId === s.scholarIdNumber}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {resetBusyId === s.scholarIdNumber ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmResetId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmResetId(s.scholarIdNumber)}
                        className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:underline ml-auto">
                        <KeyRound size={13} /> Reset Password
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddScholarModal onClose={() => setShowAdd(false)} onCreated={load} />}
    </div>
  );
}
