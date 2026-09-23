import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { removeWhiteBackground } from "@/lib/imageBackgroundRemoval";
import { fetchMySignaturePath, fetchSignatureUrl, uploadSignature } from "../referralApi";

/**
 * Lets the signed-in staff member (the Division Head, approving a
 * referral) attach a signature — reuses a previously-saved one by
 * default, or lets them upload a new photo/scan, which gets its
 * background stripped client-side (see imageBackgroundRemoval.ts) before
 * upload. `onReady` fires with the storage path to use for this approval
 * once a signature (existing or freshly uploaded) is available.
 */
export function SignatureUploadPanel({ onReady }: { onReady: (path: string | null) => void }) {
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const path = await fetchMySignaturePath();
      setExistingPath(path);
      onReady(path);
      if (path) setPreviewUrl(await fetchSignatureUrl(path));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File) {
    setError("");
    setProcessing(true);
    onReady(null);
    try {
      const transparent = await removeWhiteBackground(file);
      const localPreview = URL.createObjectURL(transparent);
      setPreviewUrl(localPreview);
      const result = await uploadSignature(transparent);
      if (!result.ok) { setError(result.error); setProcessing(false); return; }
      setExistingPath(result.path);
      onReady(result.path);
    } catch {
      setError("Couldn't process that image — try a different file.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Signature</label>
      <div className="flex items-center gap-4 bg-white border border-[#062444]/15 rounded-lg p-3">
        <div className="w-40 h-20 shrink-0 border border-dashed border-[#e6ecf5] rounded-lg flex items-center justify-center bg-[#f8fafd]">
          {previewUrl ? (
            <img src={previewUrl} alt="Signature preview" className="max-w-full max-h-full object-contain" />
          ) : (
            <PenLine size={20} className="text-slate-300" />
          )}
        </div>
        <div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/15 text-[#062444] text-[12.5px] font-semibold px-3.5 py-2 hover:bg-[#f8fafd]">
            <PenLine size={13} className="text-[#0088cc]" /> {processing ? "Processing…" : existingPath ? "Replace Signature" : "Upload Signature"}
            <input type="file" accept="image/jpeg,image/png" className="hidden" disabled={processing}
              onChange={e => { const file = e.target.files?.[0]; if (file) void handleFile(file); }} />
          </label>
          <p className="text-[11.5px] text-slate-400 mt-1">JPG or PNG — the background is made transparent automatically and saved for future approvals.</p>
          {error && <p className="text-[11.5px] text-red-600 mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
}
