// Show / hide the results (charts and answers) of a survey, section by section. Used by Survey Results (activity surveys) and My Surveys results.
// The questions stay on screen; only their results are hidden. The choice is remembered in this browser, per survey.
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { readHiddenSections, writeHiddenSections } from "@/lib/surveyResults";

const BUTTON = "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#062444]/20 bg-white px-3 py-1.5 text-[12px] font-semibold text-[#062444] hover:bg-[#f7f9fc]";

export function useHiddenSections(surveyId: string) {
  const [state, setState] = useState(() => ({ surveyId, hidden: readHiddenSections(surveyId) }));
  const hidden = state.surveyId === surveyId ? state.hidden : readHiddenSections(surveyId);
  const change = (next: string[]) => { setState({ surveyId, hidden: next }); writeHiddenSections(surveyId, next); };
  return [hidden, change] as const;
}

/** "Show all results" / "Hide all results", only when there is more than one section. */
export function ShowHideAll({ keys, onChange }: { keys: string[]; onChange: (hidden: string[]) => void }) {
  if (keys.length < 2) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => onChange([])} className={BUTTON}><Eye size={13} aria-hidden="true" /> Show all results</button>
      <button type="button" onClick={() => onChange(keys)} className={BUTTON}><EyeOff size={13} aria-hidden="true" /> Hide all results</button>
    </div>
  );
}

export function SectionHeading({ sectionKey, title, description, hidden, onChange }: {
  sectionKey: string; title: string; description?: string; hidden: string[]; onChange: (hidden: string[]) => void;
}) {
  const isHidden = hidden.includes(sectionKey);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-bold text-[#062444]">{title}</h2>
        {description && <p className="text-[12px] text-slate-500">{description}</p>}
      </div>
      <button type="button" onClick={() => onChange(isHidden ? hidden.filter(k => k !== sectionKey) : [...hidden, sectionKey])} aria-expanded={!isHidden} className={BUTTON}>
        {isHidden ? <><Eye size={13} aria-hidden="true" /> Show results</> : <><EyeOff size={13} aria-hidden="true" /> Hide results</>}
      </button>
    </div>
  );
}
