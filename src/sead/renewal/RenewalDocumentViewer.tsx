import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Download, Loader2, RotateCcw } from "lucide-react";
import { DOC_LABEL, formatDateTime } from "@/lib/renewal";
import { getStaffRenewalDocumentUrl } from "../renewalApi";
import type { ConsultCaseDocument } from "../consultRenewalApi";
import { ModalShell } from "../components/SeadUiShell";
import { ReasonDialog } from "./ReasonDialog";

type Kind = "pdf" | "image" | "other";
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** What the file is, from its name: a PDF and a picture can be shown in the pop-up; a Word file can only be downloaded. */
export function previewKind(fileName: string): { kind: Kind; mime: string | null } {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1].toLowerCase() ?? "";
  if (ext === "pdf") return { kind: "pdf", mime: MIME.pdf };
  if (ext in MIME) return { kind: "image", mime: MIME[ext] };
  return { kind: "other", mime: null };
}

/**
 * A scholar's renewal document (study plan, letter from the dean, clearance) opened in a POP-UP: the file is shown inside it, with the staff's buttons under it, like the entered grades approval.
 * Waiting for approval: Approve / Reject (Reject asks for what the scholar should fix; the scholar uploads a new file). Approved: "Allow resubmission". The database decides who may do each one;
 * these buttons only ask. The buttons return an error text to show, or null when it worked (the pop-up then closes and the case is read again by the caller).
 */
export function RenewalDocumentViewer({ doc, scholarName, onClose, onApprove, onReject, onAllowResubmission }: {
  doc: ConsultCaseDocument; scholarName: string; onClose: () => void;
  onApprove: () => Promise<string | null>; onReject: (reason: string) => Promise<string | null>; onAllowResubmission: () => Promise<string | null>;
}) {
  const { kind, mime } = previewKind(doc.fileName);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const label = DOC_LABEL[doc.kind];

  // The file is read once and shown from this page's own memory (a stored file's address would not show a PDF inside a pop-up).
  useEffect(() => {
    let alive = true; let made: string | null = null;
    (async () => {
      const signed = await getStaffRenewalDocumentUrl(doc.storagePath);
      if (!alive) return;
      if (!signed.ok) { setLoadError(signed.error); return; }
      try {
        const res = await fetch(signed.url);
        if (!res.ok) throw new Error("The file could not be read.");
        const blob = await res.blob();
        made = URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
        if (alive) setUrl(made); else URL.revokeObjectURL(made);
      } catch (e) { if (alive) setLoadError(e instanceof Error ? e.message : "The file could not be opened."); }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [doc.storagePath, mime]);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError("");
    const e = await fn();
    setBusy(false);
    if (e) setError(e);
  }

  return (
    <>
      <ModalShell title={`${label} — ${scholarName}`} onClose={onClose} extraWide>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-slate-700">
          <span className="font-semibold text-slate-900">{doc.fileName}</span>
          <span>sent {formatDateTime(doc.uploadedAt)}</span>
          {doc.status === "accepted" && <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 font-bold text-green-900"><CheckCircle2 size={13} aria-hidden="true" /> Approved</span>}
          {doc.status === "returned" && <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-bold text-red-900"><RotateCcw size={13} aria-hidden="true" /> Returned</span>}
          {doc.status === "submitted" && <span className="inline-flex items-center gap-1 rounded-full border border-sky-400 bg-sky-50 px-2 py-0.5 font-bold text-sky-900"><Clock size={13} aria-hidden="true" /> Waiting for you</span>}
          {url && <a href={url} download={doc.fileName} className="ml-auto inline-flex items-center gap-1 font-semibold text-[#00709f] hover:underline"><Download size={14} aria-hidden="true" /> Download</a>}
        </div>
        {doc.status === "returned" && doc.comment && <p className="text-[13.5px] text-slate-800">“{doc.comment}”</p>}

        <div className="min-h-[40vh] flex-1 overflow-auto rounded-xl border border-[#e6ecf5] bg-[#f8fafd]">
          {loadError ? <p role="alert" className="p-4 text-[14px] text-red-700">{loadError}</p>
            : !url ? <p role="status" className="flex items-center gap-2 p-4 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Opening the file…</p>
            : kind === "pdf" ? <iframe title={`${label} of ${scholarName}`} src={url} className="h-[62vh] w-full bg-white" />
            : kind === "image" ? <img src={url} alt={`${label} of ${scholarName}`} className="mx-auto max-h-[62vh] max-w-full object-contain" />
            : <p className="p-4 text-[14px] text-slate-800">This kind of file (a Word document) cannot be shown here. Use <strong>Download</strong> to open it on your computer, then come back to approve or reject it.</p>}
        </div>

        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {doc.status === "submitted" && (
            <>
              <button type="button" onClick={() => setRejecting(true)} disabled={busy} className="rounded-lg border border-red-700 bg-white px-4 py-2 text-[14px] font-bold text-red-800 hover:bg-red-50 disabled:opacity-50">Reject</button>
              <button type="button" onClick={() => void run(onApprove)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900 disabled:opacity-50">
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Approve
              </button>
            </>
          )}
          {doc.status === "accepted" && (
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Allow the scholar to send a new ${label.toLowerCase()}? This approved document will count as NOT approved until the new one is approved. When the scholar uploads the new file, the old one is deleted.`)) void run(onAllowResubmission); }}
              className="rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-50">Allow resubmission</button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Close</button>
        </div>
      </ModalShell>
      {rejecting && (
        <ReasonDialog title={`Reject the ${label.toLowerCase()}`} intro={<>Tell the scholar what to fix. The scholar uploads a new one; the consultation is not affected.</>} label="What should the scholar fix?" confirmLabel="Reject it" minLength={5} danger
          onCancel={() => setRejecting(false)}
          onConfirm={async reason => { const e = await onReject(reason); if (e) return e; setRejecting(false); return null; }} />
      )}
    </>
  );
}
