import { useEffect, useState } from "react";
import { saveSurvey, fetchSurveyActivityOptions } from "../seadApi";
import type { Survey, SurveyTriggers } from "../types";
import { TriggerChoices } from "./survey/TriggerChoices";
import type { SurveyActivityOption } from "@/lib/surveyBuilder";
import { ModalShell } from "./SeadUiShell";
import { ActivityPicker } from "./survey/ActivityPicker";

export function SurveyEditorModal({
  existing, reconsiderationHolder = null, onClose, onSaved,
}: { existing: Survey | null; /** the title of ANOTHER survey that is the reconsideration survey now */ reconsiderationHolder?: string | null; onClose: () => void; onSaved: () => void }) {
  const [triggers, setTriggers] = useState<SurveyTriggers>(existing?.triggers ?? { qr: true, scanner: true, manual: false, picture: false, reconsideration: false });
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const attachedBefore = existing?.activities.filter(a => !a.detached).map(a => a.id) ?? [];
  const [selected, setSelected] = useState<string[]>(attachedBefore);
  const [requiresConsent, setRequiresConsent] = useState(existing?.requiresConsent ?? false);
  const [consentText, setConsentText] = useState(existing?.consentText ?? "This survey is voluntary. Do you agree to participate?");
  const [options, setOptions] = useState<SurveyActivityOption[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const r = await fetchSurveyActivityOptions();
      if (r.ok) setOptions(r.options); else setError((r as { error: string }).error);
      setLoadingActivities(false);
    })();
  }, []);

  const detaching = attachedBefore.filter(id => !selected.includes(id)).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("Enter a survey title."); return; }
    if (!Object.values(triggers).some(Boolean)) { setError("Tick at least one time to ask this survey."); return; }
    if (selected.length === 0 && !triggers.reconsideration) { setError("Tick at least one activity."); return; }
    if (requiresConsent && !consentText.trim()) { setError("Enter the consent question text."); return; }

    setBusy(true);
    const result = await saveSurvey({
      id: existing?.id ?? null, title: title.trim(), description: description.trim(), requiresConsent, consentText: consentText.trim(), triggers,
      activities: selected.map(id => ({ id, type: options.find(o => o.id === id)?.type ?? existing?.activities.find(a => a.id === id)?.type ?? "sdp" })),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save survey."); return; }
    onSaved();
  }

  return (
    <ModalShell title={existing ? "Edit Survey" : "New Survey"} onClose={onClose} wide>
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
          <p className="text-[12.5px] font-semibold text-slate-500 mb-1">Activities that ask this survey</p>
          <p className="text-[11.5px] text-slate-500 mb-2">Scholars answer it once for each activity they attend. An activity can have only one survey.</p>
          {loadingActivities
            ? <p className="py-3 text-center text-[12.5px] text-slate-400">Loading activities…</p>
            : <ActivityPicker options={options} surveyId={existing?.id ?? null} selected={selected} onChange={setSelected} />}
          {detaching > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              Saving detaches {detaching} activit{detaching === 1 ? "y" : "ies"}. Answers already collected are kept, and anyone waiting on this survey for {detaching === 1 ? "it" : "them"} is given their credit.
            </p>
          )}
        </div>

        <TriggerChoices value={triggers} onChange={setTriggers} reconsiderationHolder={reconsiderationHolder} />

        <div className="border-t border-[#f0f3f8] pt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={requiresConsent} onChange={e => setRequiresConsent(e.target.checked)}
              className="w-4 h-4 accent-[#062444]" />
            <span className="text-[12.5px] font-semibold text-slate-600">Voluntary survey — ask for consent first</span>
          </label>
          <p className="text-[11px] text-slate-400 mt-1 ml-6">
            The scholar can decline; declining skips the survey and their attendance/voucher is still recorded normally.
          </p>
          {requiresConsent && (
            <div className="mt-2.5 ml-6">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Consent question</label>
              <textarea value={consentText} onChange={e => setConsentText(e.target.value)} rows={2}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}

        {!existing && <p className="text-[12px] text-slate-500">The survey is saved as a draft. Add its questions, then press Activate.</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={busy || loadingActivities}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            {busy ? "Saving…" : "Save Survey"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
