import { useEffect, useState } from "react";
import { ArrowLeft, Hammer } from "lucide-react";
import { fetchSurveyHeader, renameSurvey, type SurveyHeader } from "../mySurveysApi";
import { SurveyStatusBadge } from "../components/SurveyStatusBadge";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * PHASE 1 STAND-IN for the survey builder (same approach as the Phase 1
 * placeholder editor in My Presentations): proves create -> open -> edit
 * title -> go back works end to end, including the role-based permission
 * check. The real builder (sections, nine question types, drag-and-drop,
 * auto-save, preview) replaces this file's body in Phase 2.
 */
export function SurveyBuilderPage({ surveyId, onBack }: { surveyId: string; onBack: () => void }) {
  const [header, setHeader] = useState<SurveyHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [titleDraft, setTitleDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await fetchSurveyHeader(surveyId);
      if (cancelled) return;
      setHeader(h);
      setTitleDraft(h?.title ?? "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [surveyId, reloadTick]);

  const canEdit = header?.myRole === "owner" || header?.myRole === "editor";

  async function commitTitle() {
    if (!header || !canEdit) return;
    const title = titleDraft.trim();
    if (!title) { setTitleDraft(header.title); return; }
    if (title === header.title) return;
    const res = await renameSurvey(header.id, title);
    if (!res.ok) { setError(res.error ?? "Failed to save the title."); setTitleDraft(header.title); return; }
    setError(null);
    setReloadTick(t => t + 1);
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-[#062444] mb-4">
        <ArrowLeft size={15} /> Back to My Surveys
      </button>

      {loading ? (
        <p className="text-center text-slate-400 py-14">Loading…</p>
      ) : !header ? (
        <div className="text-center py-14 text-slate-400 bg-[#f7f9fc] rounded-2xl">
          <p className="text-[13.5px] font-medium">This survey doesn't exist or you no longer have access to it.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-5 max-w-3xl">
          {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">{error}</p>}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <SurveyStatusBadge status={header.status} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header.myRole}</span>
          </div>
          <label htmlFor="survey-title" className="sr-only">Survey title</label>
          <input
            id="survey-title"
            value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onBlur={() => void commitTitle()}
            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            readOnly={!canEdit} maxLength={200}
            className="w-full text-xl font-bold text-[#062444] border-b border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] outline-none py-1"
          />
          <p className="text-[12px] text-slate-400 mt-1">
            Last edited{header.lastEditedByName ? <> by <span className="font-semibold text-slate-500">{header.lastEditedByName}</span></> : null}, {formatDateTime(header.updatedAt)}
          </p>

          <div className="mt-6 rounded-xl bg-[#f7f9fc] p-5 text-center text-slate-400">
            <Hammer className="w-9 h-9 mx-auto mb-2 opacity-40" />
            <p className="text-[13.5px] font-medium">The question builder arrives in Phase 2.</p>
            <p className="text-[12.5px]">For now you can rename this survey; sections, questions, and preview come next.</p>
          </div>
        </div>
      )}
    </div>
  );
}
