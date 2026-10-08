import { useEffect } from "react";
import { X } from "lucide-react";
import { LinkAndQr } from "./LinkAndQr";
import type { SurveyStatus } from "../surveyTypes";

/** "Get Link / QR" from the survey list: just the link and QR code for a published survey. */
export function ShareLinkModal({ title, slug, status, onClose }: { title: string; slug: string; status: SurveyStatus; onClose: () => void }) {
  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="share-link-title">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="share-link-title" className="text-[15px] font-bold text-[#062444]">Survey link &amp; QR code</h3>
            <p className="truncate text-[12.5px] text-slate-500">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-[#f0f3f8]"><X size={16} /></button>
        </div>
        <LinkAndQr slug={slug} closed={status === "closed"} />
      </div>
    </div>
  );
}
