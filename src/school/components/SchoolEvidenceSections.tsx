import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { GradeDocumentsList, GradeHistoryList } from "@/app/components/GradeEvidence";
import { fetchGradeAudit, fetchGradeDocuments } from "@/lib/gradeEvidenceApi";
import { deleteGradeDocument, uploadGradeDocument } from "../submissionApi";
import { DOCUMENT_ACCEPT, MAX_DOCUMENTS_PER_SCHOLAR_PERIOD, type AuditEntry, type GradeDocument } from "@/lib/gradeEvidence";
import { focusRing } from "./portalParts";

/**
 * Supporting documents for one scholar in one period: the official grade slip / certificate of grades as a PDF or image.
 * A school can add documents while the period is Open (even after submitting — they back the grades up), and remove
 * them only until the period is submitted. Staff see the same list next to the entered grades.
 */
export function SchoolDocumentsSection({ schoolId, periodId, scholarIdNumber, canUpload, canRemove }: {
  schoolId: string; periodId: string | null; scholarIdNumber: string; canUpload: boolean; canRemove: boolean;
}) {
  const [documents, setDocuments] = useState<GradeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!periodId) { setDocuments([]); setLoading(false); return; }
    const result = await fetchGradeDocuments(scholarIdNumber, periodId);
    if (result.ok) { setDocuments(result.rows); setError(""); } else setError(result.error);
    setLoading(false);
  }, [periodId, scholarIdNumber]);
  useEffect(() => { void load(); }, [load]);

  async function onFile(file: File | undefined) {
    if (!file || !periodId) return;
    setBusy(true); setError(""); setNote("");
    const result = await uploadGradeDocument({ file, schoolId, periodId, scholarIdNumber, existingCount: documents.length });
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!result.ok) { setError(result.error); return; }
    setNote(`Attached “${file.name}”.`);
    await load();
  }

  async function onDelete(doc: GradeDocument) {
    setRemoving(doc.id); setError(""); setNote("");
    const result = await deleteGradeDocument(doc);
    setRemoving(null);
    if (!result.ok) { setError(result.error); return; }
    setNote(`Removed “${doc.fileName}”.`);
    await load();
  }

  return (
    <section aria-label="Supporting documents" className="mt-5">
      <h4 className="flex items-center gap-1.5 text-[14.5px] font-bold text-[#062444] mb-1"><Paperclip size={15} aria-hidden="true" /> Supporting documents</h4>
      <p className="text-[14px] text-slate-700 mb-2">
        Attach the official grade slip or certificate of grades (PDF or image, up to 10 MB, at most {MAX_DOCUMENTS_PER_SCHOLAR_PERIOD} per period).
        CEDO can view it next to the grades.
      </p>
      <GradeDocumentsList documents={documents} loading={loading} onDelete={canRemove ? onDelete : undefined} removing={removing} />
      {canUpload && periodId && (
        <div className="mt-2.5">
          <input ref={inputRef} id={`doc-file-${scholarIdNumber}`} type="file" accept={DOCUMENT_ACCEPT} className="sr-only"
            onChange={e => void onFile(e.target.files?.[0])} />
          <label htmlFor={`doc-file-${scholarIdNumber}`}
            className={`inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#0077b6] border border-[#0077b6]/50 rounded-lg px-3.5 py-2 cursor-pointer hover:bg-[#f7f9fc] focus-within:ring-2 ${busy ? "opacity-60 pointer-events-none" : ""}`}>
            <Paperclip size={14} aria-hidden="true" /> {busy ? "Uploading…" : "Attach a document"}
          </label>
        </div>
      )}
      {!canRemove && documents.length > 0 && <p className="text-[13.5px] text-slate-700 mt-2">Documents can't be removed once the grades are submitted.</p>}
      {error && <p role="alert" className="text-[14px] text-red-800 mt-2">{error}</p>}
      {note && <p role="status" className="text-[14px] text-green-800 mt-2">{note}</p>}
    </section>
  );
}

/** The scholar's change history for this period (who changed what, when, and how). Loads when opened and after each save. */
export function SchoolHistorySection({ scholarIdNumber, periodId, refreshKey }: { scholarIdNumber: string; periodId: string | null; refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchGradeAudit(scholarIdNumber, periodId);
      if (cancelled) return;
      if (result.ok) { setEntries(result.rows); setError(""); } else setError(result.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, scholarIdNumber, periodId, refreshKey]);

  return (
    <section aria-label="Change history" className="mt-5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`flex items-center gap-1.5 text-[14.5px] font-bold text-[#062444] hover:underline ${focusRing} rounded`}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Change history
      </button>
      {open && (
        <div className="mt-2">
          <GradeHistoryList entries={entries} loading={loading} error={error} emptyText="No changes recorded for this period yet." />
        </div>
      )}
    </section>
  );
}
