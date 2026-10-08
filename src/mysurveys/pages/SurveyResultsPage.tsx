import { ArrowLeft } from "lucide-react";
import { SurveyResultsPanel } from "../results/SurveyResultsPanel";

/**
 * My Surveys > View Responses. Full-screen like the builder. Works for anyone
 * who has access to the survey (owner, editor, viewer) -- including staff who
 * don't have the Research Project Monitoring tag -- because the server's
 * get_my_survey_results only checks the person's role on THIS survey.
 */
export function SurveyResultsPage({ surveyId, title, onBack }: { surveyId: string; title: string; onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#f7f9fc]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[#e6ecf5] bg-white px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1.5 text-slate-500 hover:bg-[#f0f3f8]" aria-label="Back to My Surveys">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-[#062444]">{title || "Untitled survey"}</p>
          <p className="text-[11.5px] text-slate-500">Responses</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-5">
          <SurveyResultsPanel surveyId={surveyId} />
        </div>
      </div>
    </div>
  );
}
