import { useEffect, useState } from "react";
import { createSurvey, updateSurvey, fetchActivitiesWithoutSurvey, type ActivityOption } from "../seadApi";
import type { Survey, SurveyActivityType } from "../types";
import { ModalShell } from "./SeadUiShell";

export function SurveyEditorModal({
  existing, onClose, onSaved,
}: { existing: Survey | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [activityKey, setActivityKey] = useState(existing ? `${existing.activityType}:${existing.activityId}` : "");
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoadingActivities(true);
      setActivities(await fetchActivitiesWithoutSurvey(existing?.id));
      setLoadingActivities(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("Enter a survey title."); return; }
    const [activityType, activityId] = activityKey.split(":") as [SurveyActivityType, string];
    if (!activityType || !activityId) { setError("Choose which activity this survey is attached to."); return; }

    setBusy(true);
    const result = existing
      ? await updateSurvey(existing.id, { title: title.trim(), description: description.trim(), isActive: existing.isActive, activityType, activityId })
      : await createSurvey({ title: title.trim(), description: description.trim(), activityType, activityId });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save survey."); return; }
    onSaved();
  }

  return (
    <ModalShell title={existing ? "Edit Survey" : "New Survey"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Survey title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Attach to activity</label>
          <select value={activityKey} onChange={e => setActivityKey(e.target.value)} disabled={loadingActivities}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
            <option value="">{loadingActivities ? "Loading activities…" : "Select an activity…"}</option>
            {activities.map(a => (
              <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>
                {a.name} ({a.type === "sdp" ? "SDP" : "Formation"})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Only activities without an existing survey are shown — one survey per activity.</p>
        </div>

        {error && <p className="text-[13px] text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={busy}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            {busy ? "Saving…" : "Save Survey"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
