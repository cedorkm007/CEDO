import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { fileLink } from "../storageToolApi";
import { effectiveMime, formatBytes, previewKind, typeLabel, type ListedFile } from "../storageToolLogic";
import { FileTypeIcon } from "./FileTypeIcon";

const dateText = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Shows a file inside the page (images, PDF, video, audio) or, for anything else, its details and a Download button. */
export function PreviewModal({ file, onClose }: { file: ListedFile; onClose: () => void }) {
  const kind = previewKind(file.mimeType, file.name);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (kind) void fileLink(file.storagePath).then(r => { if (cancelled) return; if (r.ok) setUrl(r.value); else setError(r.error); });
    return () => { cancelled = true; };
  }, [file.storagePath, kind]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function download() {
    setBusy(true); setError("");
    const r = await fileLink(file.storagePath, file.name);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const a = document.createElement("a");
    a.href = r.value; a.download = file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-3 py-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview of ${file.name}`}>
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-5 py-3 text-white">
          <div className="flex min-w-0 items-center gap-2.5"><FileTypeIcon mime={file.mimeType} name={file.name} className="shrink-0 !text-white" /><h2 className="truncate text-[15px] font-bold" title={file.name}>{file.name}</h2></div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => void download()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-[14px] font-bold hover:bg-white/25 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Download
            </button>
            <button ref={closeRef} onClick={onClose} aria-label="Close the preview" className="rounded p-1.5 hover:bg-white/15"><X size={18} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="min-h-[12rem] flex-1 overflow-auto bg-[#f7f9fc]">
          {kind && !url && !error && <p className="flex items-center justify-center gap-2 p-10 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Opening…</p>}
          {kind === "image" && url && <img src={url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full object-contain p-3" />}
          {kind === "pdf" && url && <iframe src={url} title={file.name} className="h-[70vh] w-full bg-white" />}
          {kind === "video" && url && <video src={url} controls className="mx-auto max-h-[70vh] max-w-full bg-black" />}
          {kind === "audio" && url && <div className="p-8"><audio src={url} controls className="w-full" /></div>}
          {!kind && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <FileTypeIcon mime={file.mimeType} name={file.name} size={44} />
              <p className="text-[15px] font-bold text-[#062444]">This kind of file cannot be shown here</p>
              <p className="text-[14px] text-slate-700">Press Download to open it on your computer.</p>
            </div>
          )}
          {error && <p role="alert" className="p-4 text-[14px] text-red-700">{error}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-[#e6ecf5] px-5 py-3 text-[14px] sm:grid-cols-4">
          <div><dt className="text-slate-700">Type</dt><dd className="font-semibold text-[#062444]">{typeLabel(file.mimeType, file.name)}</dd></div>
          <div><dt className="text-slate-700">Size</dt><dd className="font-semibold text-[#062444]">{formatBytes(file.sizeBytes)}</dd></div>
          <div><dt className="text-slate-700">Uploaded</dt><dd className="font-semibold text-[#062444]">{dateText(file.createdAt)}</dd></div>
          <div><dt className="text-slate-700">Format</dt><dd className="truncate font-semibold text-[#062444]" title={effectiveMime(file.mimeType, file.name)}>{effectiveMime(file.mimeType, file.name)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
