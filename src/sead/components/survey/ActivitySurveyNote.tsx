import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { fetchSurveyForActivity } from "../../seadApi";

/** In the SDP activity pop-up: which survey this activity asks (nothing when it has none). */
export function ActivitySurveyNote({ activityId }: { activityId: string }) {
  const [survey, setSurvey] = useState<{ title: string; active: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSurvey(null);
    void fetchSurveyForActivity(activityId).then(s => { if (!cancelled) setSurvey(s); });
    return () => { cancelled = true; };
  }, [activityId]);
  if (!survey) return null;
  return (
    <p className="flex items-center gap-1.5 truncate text-white/90 text-[12px]" title={survey.title}>
      <ClipboardList size={12} aria-hidden="true" />
      <span className="truncate">Survey: <strong>{survey.title}</strong>{survey.active ? "" : " (not active)"}</span>
    </p>
  );
}
