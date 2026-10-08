import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, X } from "lucide-react";
import { SurveyRunner } from "../respondent/SurveyRunner";
import type { RunnerSurvey } from "../surveyTypes";

/**
 * "Preview": runs the real respondent screens (SurveyRunner, the same
 * component the public survey page uses) on the survey as it is right now,
 * including edits that haven't finished saving. Nothing entered here is stored.
 */
export function PreviewOverlay({ survey, onClose }: { survey: RunnerSurvey; onClose: () => void }) {
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const tab = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold ${active ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f7f9fc]"}`;

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-[#1c2733]" role="dialog" aria-modal="true" aria-label="Survey preview">
      <div className="flex shrink-0 items-center gap-3 bg-white px-4 py-2.5 border-b border-[#e6ecf5]">
        <span className="text-[13.5px] font-bold text-[#062444]">Preview</span>
        <span className="hidden sm:block text-[12px] text-slate-400">This is exactly what respondents see. Nothing you enter here is saved.</span>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-lg border border-[#e6ecf5]" role="group" aria-label="Preview size">
          <button onClick={() => setDevice("phone")} aria-pressed={device === "phone"} className={tab(device === "phone")}><Smartphone size={14} /> Phone</button>
          <button onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={tab(device === "desktop")}><Monitor size={14} /> Desktop</button>
        </div>
        <button ref={closeRef} onClick={onClose} aria-label="Close preview" className="p-1.5 rounded-md text-slate-500 hover:bg-[#f0f3f8]"><X size={18} /></button>
      </div>
      <div className="flex min-h-0 flex-1 justify-center p-3 sm:p-5">
        <div
          className={`flex min-h-0 self-stretch overflow-y-auto bg-[#f4f7fb] ${
            device === "phone" ? "w-[390px] max-w-full rounded-[28px] border-[8px] border-slate-900" : "w-full max-w-5xl rounded-xl"
          }`}
        >
          <SurveyRunner survey={survey} mode="preview" className="w-full" />
        </div>
      </div>
    </div>
  );
}
