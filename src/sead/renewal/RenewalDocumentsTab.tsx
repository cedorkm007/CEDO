import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Paperclip, RotateCcw, Search } from "lucide-react";
import { useLiveReload } from "@/lib/liveUpdates";
import { DOC_LABEL, formatDateTime, termLabelOf } from "@/lib/renewal";
import { getStaffRenewalDocumentUrl, reviewDocument } from "../renewalApi";
import { DOCUMENTS_PAGE_SIZE, fetchDocumentsCounts, fetchDocumentsQueue, type DocumentsCounts, type DocumentsFilter, type QueueDocument } from "../renewalDocumentsApi";
import { ReasonDialog } from "./ReasonDialog";

const FILTERS: { key: DocumentsFilter; label: string }[] = [
  { key: "pending", label: "To approve" }, { key: "returned", label: "Returned" }, { key: "accepted", label: "Approved" }, { key: "all", label: "All" },
];

function StatusChip({ status }: { status: QueueDocument["status"] }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-bold";
  if (status === "accepted") return <span className={`${base} border-green-300 bg-green-50 text-green-900`}><CheckCircle2 size={13} aria-hidden="true" /> Approved</span>;
  if (status === "returned") return <span className={`${base} border-red-300 bg-red-50 text-red-900`}><RotateCcw size={13} aria-hidden="true" /> Returned</span>;
  return <span className={`${base} border-sky-400 bg-sky-50 text-sky-900`}><Clock size={13} aria-hidden="true" /> Waiting</span>;
}

/**
 * Scholar Renewal > Documents: the study plans, letters from the dean and clearances the scholars sent, oldest waiting first. The accounts with the Renewal Documents Approver tag approve or return them here;
 * the evaluator (and the other staff who read renewals) sees the same list but cannot act on it. The database checks the tag again on every approve / return.
 */
export function RenewalDocumentsTab({ canApprove, refreshKey, onChanged }: { canApprove: boolean; refreshKey: number; onChanged?: () => void }) {
  const [filter, setFilter] = useState<DocumentsFilter>("pending");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<QueueDocument[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<DocumentsCounts | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [reviewing, setReviewing] = useState<{ doc: QueueDocument; approve: boolean } | null>(null);
  const [fileError, setFileError] = useState("");

  // the search waits for a pause in typing, then starts again from page 1
  useEffect(() => { const t = setTimeout(() => { setQuery(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);

  const load = useCallback(async () => {
    const [l, c] = await Promise.all([fetchDocumentsQueue(filter, query, page), fetchDocumentsCounts()]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setError(""); setRows(l.rows); setTotal(l.total);
    if (c.ok) setCounts(c.counts);
  }, [filter, query, page]);
  useEffect(() => { if (!missing) void load(); }, [load, missing, refreshKey]);
  useLiveReload(async () => { if (!missing) await load(); });      // a new document or a decision: update in place

  async function open(d: QueueDocument) {
    setFileError("");
    const r = await getStaffRenewalDocumentUrl(d.storagePath);
    if (r.ok) window.open(r.url, "_blank", "noopener"); else setFileError(r.error);
  }

  const totalPages = Math.max(1, Math.ceil(total / DOCUMENTS_PAGE_SIZE));
  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Documents tab needs the latest database update (supabase_migration_renewal_documents_approver.sql). Until it is run, this tab cannot show the documents.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">
        {canApprove
          ? "The study plans, letters from the dean and clearances the scholars sent. Open a file, then approve it or return it with what to fix."
          : "The study plans, letters from the dean and clearances the scholars sent. The consultation staff approve or return them (Consultation Tool, Renewal Cases tab); you can see where each one stands."}
      </p>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show documents">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); setRows(null); }} aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${filter === f.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
            {f.label} <span className={`ml-1 font-bold ${filter === f.key ? "text-[#F3BC00]" : "text-[#006aa3]"}`}>{counts ? counts[f.key] : "…"}</span>
          </button>
        ))}
      </div>
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name or ID" aria-label="Search scholars"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>
      {fileError && <p role="alert" className="mb-3 text-[14px] text-red-700">{fileError}</p>}

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{query ? "No document matches this search." : filter === "pending" ? "Nothing is waiting for approval." : "No documents here."}</p>
      : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
            <table className="w-full min-w-[820px] text-left text-[14px]">
              <caption className="sr-only">Documents sent by the scholars for the renewal</caption>
              <thead className="bg-[#f7f9fc] text-[#062444]">
                <tr>
                  {["Scholar", "Document", "File", "Renewal", "Sent", "Status", "Action"].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-bold align-bottom">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.id} className="border-t border-[#eef3fb] align-top">
                    <td className="px-3 py-2.5"><span className="font-bold text-[#062444]">{d.scholarName}</span><span className="block text-slate-700">{d.scholarIdNumber}</span><span className="block text-slate-700">{[d.yearLevel, d.program].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{DOC_LABEL[d.kind]}</td>
                    <td className="px-3 py-2.5 break-words"><button onClick={() => void open(d)} className="inline-flex items-start gap-1 text-left font-semibold text-[#00709f] hover:underline"><Paperclip size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {d.fileName}</button></td>
                    <td className="px-3 py-2.5 text-slate-800">{termLabelOf(d.schoolYear, d.term)}</td>
                    <td className="px-3 py-2.5 text-slate-800 whitespace-nowrap">{formatDateTime(d.uploadedAt)}</td>
                    <td className="px-3 py-2.5"><StatusChip status={d.status} />{d.reviewerComment && <span className="mt-1 block text-[13.5px] text-slate-800">“{d.reviewerComment}”</span>}</td>
                    <td className="px-3 py-2.5">
                      {d.status !== "submitted" ? <span className="text-slate-700">—</span>
                      : canApprove ? (
                        <span className="flex flex-wrap gap-2">
                          <button onClick={() => setReviewing({ doc: d, approve: true })} className="rounded-md bg-green-800 px-2.5 py-1 text-[13px] font-bold text-white hover:bg-green-900">Approve</button>
                          <button onClick={() => setReviewing({ doc: d, approve: false })} className="rounded-md border border-red-700 px-2.5 py-1 text-[13px] font-bold text-red-800 hover:bg-red-50">Return</button>
                        </span>
                      ) : <span className="text-[13.5px] text-slate-800">Waiting for the consultation staff</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[14px] text-slate-800">
            <span>Showing {(page - 1) * DOCUMENTS_PAGE_SIZE + 1}–{Math.min(page * DOCUMENTS_PAGE_SIZE, total)} of {total} document{total === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50">Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50">Next</button>
            </span>
          </div>
        </>
      )}

      {reviewing && (
        <ReasonDialog
          title={reviewing.approve ? `Approve the ${DOC_LABEL[reviewing.doc.kind].toLowerCase()}` : `Return the ${DOC_LABEL[reviewing.doc.kind].toLowerCase()}`}
          intro={reviewing.approve
            ? <>{reviewing.doc.scholarName} will be told the {DOC_LABEL[reviewing.doc.kind].toLowerCase()} is approved. When all of the documents are approved they can book a consultation.</>
            : <>{reviewing.doc.scholarName} will see your comment and must upload a new file. A booked consultation will be cancelled until the new one is approved.</>}
          label={reviewing.approve ? "Note (optional)" : "What should the scholar fix?"} required={!reviewing.approve} minLength={5}
          confirmLabel={reviewing.approve ? "Approve" : "Return to the scholar"} danger={!reviewing.approve} onCancel={() => setReviewing(null)}
          onConfirm={async c => { const x = await reviewDocument(reviewing.doc.id, reviewing.approve, c); if (!x.ok) return x.error; setReviewing(null); await load(); onChanged?.(); return null; }} />
      )}
    </div>
  );
}
