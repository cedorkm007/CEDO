import { useState } from "react";
import { FileText, Image as ImageIcon, ExternalLink, Trash2, History } from "lucide-react";
import {
  actorName, describeAuditEntry, formatWhen, SOURCE_LABEL, fileSizeLabel,
  type AuditEntry, type GradeDocument,
} from "@/lib/gradeEvidence";
import { getDocumentUrl } from "@/lib/gradeEvidenceApi";

/**
 * Change history of a scholar's subjects/grades: when, who, what changed (old → new) and how (manual entry / CSV
 * upload / approved correction / CEDO staff). Read-only; shared by the School Portal and the staff tool.
 */
export function GradeHistoryList({ entries, loading, error, emptyText = "No changes recorded yet." }: {
  entries: AuditEntry[]; loading: boolean; error?: string; emptyText?: string;
}) {
  if (loading) return <p className="text-[14px] text-slate-700 py-2">Loading history…</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-800 py-2">Couldn't load the history: {error}</p>;
  if (entries.length === 0) return <p className="text-[14px] text-slate-700 py-2">{emptyText}</p>;
  return (
    <div className="relative overflow-x-auto border border-[#e6ecf5] rounded-lg">
      <table className="w-full min-w-[560px] text-[14px]">
        <caption className="sr-only">Change history</caption>
        <thead className="bg-[#f7f9fc]">
          <tr className="text-left text-slate-800">
            <th scope="col" className="px-3 py-2 font-bold">When</th>
            <th scope="col" className="px-3 py-2 font-bold">Who</th>
            <th scope="col" className="px-3 py-2 font-bold">Change</th>
            <th scope="col" className="px-3 py-2 font-bold">How</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-t border-[#f0f3f8] align-top">
              <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{formatWhen(e.changedAt)}</td>
              <td className="px-3 py-2 text-slate-800">{actorName(e)}</td>
              <td className="px-3 py-2 text-[#062444]">{describeAuditEntry(e)}</td>
              <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{SOURCE_LABEL[e.source]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Heading + icon used above the history list. */
export function HistoryHeading() {
  return <h4 className="flex items-center gap-1.5 text-[14.5px] font-bold text-[#062444] mb-2"><History size={15} aria-hidden="true" /> Change history</h4>;
}

/**
 * Supporting documents (official grade slip / certificate of grades) for one scholar and period. Anyone who can see
 * them can open one (a short-lived link, the files are private). `onDelete` is only passed where removing is allowed.
 */
export function GradeDocumentsList({ documents, loading, error, onDelete, removing }: {
  documents: GradeDocument[]; loading: boolean; error?: string;
  onDelete?: (doc: GradeDocument) => void; removing?: string | null;
}) {
  const [openError, setOpenError] = useState("");
  async function open(doc: GradeDocument) {
    setOpenError("");
    const result = await getDocumentUrl(doc.storagePath);
    if (!result.ok) { setOpenError(result.error); return; }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }
  if (loading) return <p className="text-[14px] text-slate-700 py-2">Loading documents…</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-800 py-2">Couldn't load the documents: {error}</p>;
  if (documents.length === 0) return <p className="text-[14px] text-slate-700 py-2">No documents attached yet.</p>;
  return (
    <div>
      <ul className="divide-y divide-[#f0f3f8] border border-[#e6ecf5] rounded-lg">
        {documents.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            {d.mimeType === "application/pdf"
              ? <FileText size={17} className="text-[#0077b6] shrink-0" aria-hidden="true" />
              : <ImageIcon size={17} className="text-[#0077b6] shrink-0" aria-hidden="true" />}
            <span className="flex-1 min-w-[10rem] text-[14px] text-[#062444] break-all">{d.fileName}</span>
            <span className="text-[13.5px] text-slate-700 whitespace-nowrap">{fileSizeLabel(d.sizeBytes)} · {formatWhen(d.uploadedAt)}</span>
            <button type="button" onClick={() => void open(d)} className="flex items-center gap-1 text-[14px] font-semibold text-[#0077b6] hover:underline">
              <ExternalLink size={14} aria-hidden="true" /> View<span className="sr-only"> {d.fileName}</span>
            </button>
            {onDelete && (
              <button type="button" onClick={() => onDelete(d)} disabled={removing === d.id}
                className="flex items-center gap-1 text-[14px] font-semibold text-red-800 hover:underline disabled:opacity-50">
                <Trash2 size={14} aria-hidden="true" /> {removing === d.id ? "Removing…" : "Remove"}<span className="sr-only"> {d.fileName}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {openError && <p role="alert" className="text-[14px] text-red-800 mt-2">{openError}</p>}
    </div>
  );
}
