import { useEffect, useState } from "react";
import { X, Download, FileWarning } from "lucide-react";
import { supabase } from "@/lib/supabase";

export interface PreviewableUpload {
  storagePath: string;
  mimeType: string;
  /** Shown everywhere in this modal (title, alt text, download button label) — a scholar's own device name is often meaningless to staff (see formatSubmissionDisplayName). */
  displayFileName: string;
  /** Used ONLY as the `download` attribute's file name, so the file the staff member actually saves keeps its real original name. */
  originalFileName: string;
}

/** Every file preview in this app (private-bucket signed URLs) opened in a new tab via window.open before this — this is the first actual in-app preview. Images render inline, PDFs render via an iframe (browsers handle that natively), everything else (Word/Excel/CSV) falls back to a download link since there's no reliable way to render those formats inline. */
export function SubmissionFilePreviewModal({ upload, onClose }: { upload: PreviewableUpload; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setError("");
    void (async () => {
      const { data, error } = await supabase.storage.from("submission-uploads").createSignedUrl(upload.storagePath, 300);
      if (cancelled) return;
      if (error || !data) { setError("Couldn't load a preview link for this file."); return; }
      setSignedUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [upload.storagePath]);

  const isImage = upload.mimeType.startsWith("image/");
  const isPdf = upload.mimeType === "application/pdf";

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-8" onClick={onClose}>
      <div className="flex w-full max-w-4xl h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <p className="truncate text-[14px] font-bold text-white pr-4">{upload.displayFileName}</p>
          <button onClick={onClose} className="shrink-0 text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 bg-[#f8fafd]">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
              <FileWarning size={24} className="text-red-400" />
              <p className="text-[13px] text-red-600">{error}</p>
            </div>
          ) : !signedUrl ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[13px] text-slate-400">Loading preview…</p>
            </div>
          ) : isImage ? (
            <img src={signedUrl} alt={upload.displayFileName} className="h-full w-full object-contain" />
          ) : isPdf ? (
            <iframe src={signedUrl} title={upload.displayFileName} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
              <FileWarning size={24} className="text-slate-300" />
              <p className="text-[13px] text-slate-500">No in-app preview is available for this file type.</p>
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={upload.originalFileName}
                className="flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[12.5px] font-bold text-white"
              >
                <Download size={14} /> Download {upload.displayFileName}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
