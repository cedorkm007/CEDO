import { useEffect, useState } from "react";
import { Search, UserPlus, KeyRound, ChevronLeft, ChevronRight, UploadCloud, Trash2, FilePenLine, AlertTriangle, X } from "lucide-react";
import { fetchScholars, resetScholarPassword, resetAllScholarPasswords, deleteScholarAccount, SCHOLARS_PAGE_SIZE } from "../seadApi";
import { AddScholarModal } from "../components/AddScholarModal";
import { BulkScholarUploadModal } from "../components/BulkScholarUploadModal";
import { BulkScholarUpdateModal } from "../components/BulkScholarUpdateModal";
import type { ScholarListItem } from "../types";

export function ScholarsTab() {
  const [scholars, setScholars] = useState<ScholarListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [showResetAll, setShowResetAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / SCHOLARS_PAGE_SIZE));

  async function load(pageToLoad: number) {
    setLoading(true);
    const result = await fetchScholars(search, pageToLoad);
    setScholars(result.items);
    setTotal(result.total);
    setLoading(false);
  }

  // Initial load.
  useEffect(() => { load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Search changes: debounce, and always jump back to page 1 (a stale page
  // number from a previous search could be past the end of a new, smaller
  // result set).
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function goToPage(p: number) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    load(clamped);
  }

  async function handleResetPassword(scholarIdNumber: string) {
    setResetBusyId(scholarIdNumber);
    const result = await resetScholarPassword(scholarIdNumber);
    setResetBusyId(null);
    setConfirmResetId(null);
    setToast(result.ok ? `Password reset to 123456 for ${result.name}.` : (result.error || "Failed to reset password."));
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDeleteScholar(id: string) {
    setDeleteBusyId(id);
    const result = await deleteScholarAccount(id);
    setDeleteBusyId(null);
    setConfirmDeleteId(null);
    setToast(result.ok ? `Removed ${result.name}'s account.` : (result.error || "Failed to remove account."));
    setTimeout(() => setToast(null), 4000);
    if (result.ok) load(page);
  }

  function handleAllPasswordsReset(message: string) {
    setShowResetAll(false);
    setToast(message);
    setTimeout(() => setToast(null), 6000);
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * SCHOLARS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * SCHOLARS_PAGE_SIZE, total);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkUpload(true)}
            className="flex items-center gap-2 bg-white border border-[#062444]/15 text-[#062444] text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
            <UploadCloud size={15} className="text-[#0088cc]" /> Bulk Upload
          </button>
          <button onClick={() => setShowBulkUpdate(true)}
            className="flex items-center gap-2 bg-white border border-[#062444]/15 text-[#062444] text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
            <FilePenLine size={15} className="text-[#0088cc]" /> Bulk Update
          </button>
          <button onClick={() => setShowResetAll(true)}
            className="flex items-center gap-2 bg-white border border-red-200 text-red-600 text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-red-50">
            <KeyRound size={15} /> Reset All Passwords
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
            <UserPlus size={15} className="text-[#F3BC00]" /> Add Scholar
          </button>
        </div>
      </div>

      {toast && <div className="mb-4 bg-[#062444] text-white text-[13.5px] rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[12.5px] text-slate-500">
          {loading ? "Loading…" : total === 0 ? "No scholars found." : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
        </p>
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>

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
                    {confirmDeleteId === s.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Remove this account?</span>
                        <button onClick={() => handleDeleteScholar(s.id)} disabled={deleteBusyId === s.id}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {deleteBusyId === s.id ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : confirmResetId === s.scholarIdNumber ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Reset to 123456?</span>
                        <button onClick={() => handleResetPassword(s.scholarIdNumber)} disabled={resetBusyId === s.scholarIdNumber}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {resetBusyId === s.scholarIdNumber ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmResetId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button onClick={() => setConfirmResetId(s.scholarIdNumber)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:underline">
                          <KeyRound size={13} /> Reset Password
                        </button>
                        <button onClick={() => setConfirmDeleteId(s.id)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-red-500 hover:underline">
                          <Trash2 size={13} /> Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-3">
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>

      {showAdd && <AddScholarModal onClose={() => setShowAdd(false)} onCreated={() => load(page)} />}
      {showBulkUpload && <BulkScholarUploadModal onClose={() => setShowBulkUpload(false)} onDone={() => load(page)} />}
      {showBulkUpdate && <BulkScholarUpdateModal onClose={() => setShowBulkUpdate(false)} onDone={() => load(page)} />}
      {showResetAll && <ResetAllPasswordsModal onClose={() => setShowResetAll(false)} onDone={handleAllPasswordsReset} />}
    </div>
  );
}

function ResetAllPasswordsModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const canConfirm = confirmText.trim().toUpperCase() === "RESET";

  async function handleConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError("");
    setProgress(null);
    const result = await resetAllScholarPasswords((done, total) => setProgress({ done, total }));
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to reset passwords."); return; }
    const total = result.total ?? 0;
    const succeeded = result.succeeded ?? 0;
    const failed = result.failed ?? 0;
    const message = failed === 0
      ? `Reset ${succeeded} scholar password${succeeded === 1 ? "" : "s"} to 123456.`
      : `Reset ${succeeded} of ${total} scholar passwords to 123456 — ${failed} failed. Check the account log or try again for the ones that failed.`;
    onDone(message);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <span className="flex items-center gap-2 text-white font-bold text-[15px]"><KeyRound size={17} className="text-[#F3BC00]" /> Reset All Passwords</span>
          <button onClick={onClose} disabled={busy} className="text-white/70 hover:text-white disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-lg px-3.5 py-3 mb-4">
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-red-700 leading-relaxed">
              This resets <strong>every scholar's</strong> password to <strong>123456</strong> — not just the ones on this page or matching your search. It cannot be undone, and every scholar will need to sign in with the default password again.
            </p>
          </div>

          <label className="block text-[12.5px] font-semibold text-[#062444] mb-1.5">
            Type <span className="font-mono bg-[#f8fafd] border border-[#e6ecf5] rounded px-1.5 py-0.5">RESET</span> to confirm
          </label>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            disabled={busy}
            placeholder="RESET"
            className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-red-400 mb-4"
          />

          {error && <p className="text-[12.5px] text-red-600 mb-3">{error}</p>}

          {busy && (
            <div className="mb-3">
              <p className="text-[12px] text-slate-500 mb-1.5">
                {progress && progress.total > 0
                  ? `Resetting… ${progress.done} / ${progress.total}`
                  : "Starting…"}
              </p>
              <div className="w-full h-1.5 bg-[#f0f3f8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0088cc] rounded-full transition-all"
                  style={{ width: progress && progress.total > 0 ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "10%" }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="text-[13px] font-semibold text-slate-500 hover:text-[#062444] disabled:opacity-40 px-4 py-2.5">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || busy}
              className="flex items-center gap-2 bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg px-5 py-2.5 hover:bg-red-700"
            >
              {busy ? "Resetting…" : "Reset All Passwords"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaginationControls({ page, totalPages, onGoTo, disabled }: {
  page: number; totalPages: number; onGoTo: (p: number) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onGoTo(page - 1)} disabled={disabled || page <= 1}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
        <ChevronLeft size={14} /> Prev
      </button>
      <span className="text-[12.5px] text-slate-500 min-w-[90px] text-center">Page {page} of {totalPages}</span>
      <button onClick={() => onGoTo(page + 1)} disabled={disabled || page >= totalPages}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}
