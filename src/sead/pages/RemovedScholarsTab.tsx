import { useEffect, useState } from "react";
import { Search, UserPlus, UploadCloud, Undo2, Trash2 } from "lucide-react";
import { fetchScholarsInformationPage, restoreScholarAccount, deleteScholarAccount, SCHOLARS_PAGE_SIZE, type ScholarInformationRow } from "../seadApi";
import { AddScholarModal } from "../components/AddScholarModal";
import { BulkScholarUploadModal } from "../components/BulkScholarUploadModal";
import { PaginationControls, formatScholarName, formatInfoColumnValue } from "./ScholarsTab";

/**
 * Silo for scholars whose scholarship status is "Removed" — kept out of
 * the main Scholars tab entirely (fetchScholarsInformationPage excludes
 * "Removed" by default; this is the one place that asks for it
 * explicitly). Read-only aside from Restore (undo the removal, reactivate
 * the login) and Delete Permanently (hard-delete, for cleaning up a
 * mistaken entry) — no inline editing, consistent with the rest of the
 * app treating "Removed" as a deliberate, dedicated-action-only state.
 */
export function RemovedScholarsTab() {
  const [rows, setRows] = useState<ScholarInformationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / SCHOLARS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * SCHOLARS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * SCHOLARS_PAGE_SIZE, total);

  async function load(pageToLoad: number) {
    setLoading(true);
    const result = await fetchScholarsInformationPage(pageToLoad, { name: search.trim() || undefined, status: "Removed" });
    setRows(result.items);
    setTotal(result.total);
    setLoading(false);
  }

  useEffect(() => { load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleRestore(row: ScholarInformationRow) {
    setRestoreBusyId(row.id);
    const result = await restoreScholarAccount(row.id);
    setRestoreBusyId(null);
    setConfirmRestoreId(null);
    showToast(result.ok ? `Restored to ${result.status}.` : (result.error || "Failed to restore scholar."));
    if (result.ok) load(page);
  }

  async function handleDelete(row: ScholarInformationRow) {
    setDeleteBusyId(row.id);
    const result = await deleteScholarAccount(row.id);
    setDeleteBusyId(null);
    setConfirmDeleteId(null);
    showToast(result.ok ? `Deleted ${result.name}'s record.` : (result.error || "Failed to delete."));
    if (result.ok) load(page);
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Scholars marked Removed — their login is deactivated and they're excluded from the active roster, rankings, and monitoring pages. Restore to reactivate, or delete permanently to clean up a mistaken entry.
      </p>

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-2 bg-white border border-[#062444]/15 text-[#062444] text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
            <UploadCloud size={15} className="text-[#0088cc]" /> Bulk Import
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
            <UserPlus size={15} className="text-[#F3BC00]" /> Add Removed Scholar
          </button>
        </div>
      </div>

      {toast && <div className="mb-4 bg-[#062444] text-white text-[13.5px] rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[12.5px] text-slate-500">
          {loading ? "Loading…" : total === 0 ? "No removed scholars." : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
        </p>
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3 whitespace-nowrap">Scholar ID</th>
              <th className="px-4 py-3 whitespace-nowrap">Name</th>
              <th className="px-4 py-3 whitespace-nowrap">School</th>
              <th className="px-4 py-3 whitespace-nowrap">Year Level</th>
              <th className="px-4 py-3 whitespace-nowrap">Barangay</th>
              <th className="px-4 py-3 whitespace-nowrap">Restores To</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No removed scholars.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444] whitespace-nowrap">{r.scholarIdNumber}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatScholarName(r)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatInfoColumnValue(r, "school", "—")}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatInfoColumnValue(r, "yearLevel", "—")}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatInfoColumnValue(r, "barangay", "—")}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{r.statusBeforeRemoval ?? "Regular (default)"}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmDeleteId === r.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Delete this record permanently?</span>
                        <button onClick={() => handleDelete(r)} disabled={deleteBusyId === r.id}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {deleteBusyId === r.id ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : confirmRestoreId === r.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Restore &amp; reactivate login?</span>
                        <button onClick={() => handleRestore(r)} disabled={restoreBusyId === r.id}
                          className="text-[12px] font-bold text-green-700 hover:underline">
                          {restoreBusyId === r.id ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmRestoreId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button onClick={() => setConfirmRestoreId(r.id)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-green-700 hover:underline">
                          <Undo2 size={13} /> Restore
                        </button>
                        <button onClick={() => setConfirmDeleteId(r.id)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-red-500 hover:underline">
                          <Trash2 size={13} /> Delete Permanently
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

      {showAdd && <AddScholarModal asRemoved onClose={() => setShowAdd(false)} onCreated={() => load(page)} />}
      {showBulkImport && <BulkScholarUploadModal asRemoved onClose={() => setShowBulkImport(false)} onDone={() => load(page)} />}
    </div>
  );
}
