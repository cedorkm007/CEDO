import { useEffect, useState } from "react";
import { Pencil, Trash2, Power, PowerOff } from "lucide-react";
import { fetchSurveys, deleteSurvey, setSurveyActive } from "../../seadApi";
import { fetchDeleteImpact, type DeleteImpact } from "../../surveyEditorApi";
import { SurveyEditorModal } from "../../components/SurveyEditorModal";
import { SurveyOutlineEditor } from "../../components/survey/SurveyOutlineEditor";
import { ConfirmDialog, type ConfirmAction } from "../../components/survey/ConfirmDialog";
import { ColumnHeader, EmptyColumn } from "../../components/SeadUiShell";
import type { Survey } from "../../types";

const isDraft = (s: Survey) => !s.isActive && s.activatedAt === null;
const people = (n: number) => `${n} scholar${n === 1 ? "" : "s"}`;
type Asking = { survey: Survey; kind: "delete" | "deactivate"; impact: DeleteImpact | null };

export function SurveyToolsSubtab() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingSurvey, setEditingSurvey] = useState<Survey | "new" | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadSurveys(); }, []);

  async function loadSurveys() {
    // Quest-sourced surveys (a Question Bank subject flagged "Survey
    // Results") aren't authored here — their questions live in Question
    // Bank. They only ever appear in the Survey Results subtab.
    setSurveys((await fetchSurveys()).filter(x => x.activityType !== "quest"));
  }

  const selected = surveys.find(s => s.id === selectedId) ?? null;

  const setActive = (s: Survey, isActive: boolean) => setSurveyActive(s.id, isActive);

  async function activate(s: Survey) {
    setError("");
    const r = await setActive(s, true);
    if (!r.ok) setError(r.error ?? "Couldn't activate the survey.");
    await loadSurveys();
  }

  async function ask(survey: Survey, kind: Asking["kind"]) {
    setError("");
    setAskError("");
    setAsking({ survey, kind, impact: await fetchDeleteImpact(survey.id) });
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setAskError("");
    const r = await action();
    setBusy(false);
    if (!r.ok) { setAskError(r.error ?? "That didn't work."); return; }
    setAsking(null);
    await loadSurveys();
  }

  function dialog({ survey, kind, impact }: Asking) {
    const close = () => setAsking(null);
    const waiting = impact?.waiting ?? 0;
    const hasAnswers = !!impact && (impact.answers > 0 || impact.finished > 0);
    const deactivate: ConfirmAction = { label: "Deactivate", run: () => void run(() => setActive(survey, false)) };
    const waitingLine = waiting > 0 ? [`${people(waiting)} waiting on it will be given their attendance and credit now.`] : [];

    if (kind === "deactivate") {
      return <ConfirmDialog title="Deactivate this survey?" busy={busy} error={askError} onClose={close} actions={[deactivate]}
        lines={[`"${survey.title}" will not be asked of anyone else. Answers already collected stay.`, ...waitingLine]} />;
    }
    if (hasAnswers || waiting > 0) {
      return <ConfirmDialog title="This survey cannot be deleted" busy={busy} error={askError} onClose={close}
        actions={survey.isActive ? [deactivate] : []}
        lines={[
          hasAnswers ? `"${survey.title}" has ${impact!.answers} answer${impact!.answers === 1 ? "" : "s"} from ${people(impact!.finished)} who finished or declined. Surveys with answers can only be deactivated.` : `Scholars are still waiting on "${survey.title}".`,
          survey.isActive ? "Deactivate it instead." : "It is already off, so nobody else is asked.",
          ...waitingLine,
        ]} />;
    }
    return <ConfirmDialog title="Delete this survey?" busy={busy} error={askError} onClose={close}
      actions={[{ label: "Delete survey", tone: "danger", run: () => void run(() => deleteSurvey(survey.id)) }]}
      lines={[`"${survey.title}" and its questions will be deleted.`, impact ? "No answers have been collected. This cannot be undone." : "This cannot be undone."]} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,.9fr)_minmax(480px,2fr)]">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[72vh] xl:max-h-[720px]">
        <ColumnHeader title="Surveys" onAdd={() => setEditingSurvey("new")} addLabel="New Survey" />
        {error && <p role="alert" className="px-4 py-2 text-[12.5px] text-red-600">{error}</p>}
        <div className="overflow-y-auto flex-1">
          {surveys.length === 0 ? (
            <p className="text-sm text-slate-400 px-4 py-6 text-center">No surveys yet.</p>
          ) : surveys.map(s => (
            <div key={s.id} onClick={() => setSelectedId(s.id)}
              className={`px-4 py-3 border-b border-[#f0f3f8] cursor-pointer ${selectedId === s.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-[#062444] font-medium truncate">{s.title}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {s.activityName}{s.activities.filter(a => !a.detached).length === 1 && <> <span className="text-slate-300">·</span> {s.activityType === "sdp" ? "SDP" : "Formation"}</>}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {s.requiresConsent && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 text-amber-700 bg-amber-100">Voluntary</span>}
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${s.isActive ? "text-green-700 bg-green-100" : isDraft(s) ? "text-blue-700 bg-blue-100" : "text-slate-500 bg-slate-100"}`}>
                    {s.isActive ? "Active" : isDraft(s) ? "Draft" : "Inactive"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[12px] mt-2">
                <button onClick={e => { e.stopPropagation(); setEditingSurvey(s); }} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline"><Pencil size={12} /> Edit</button>
                <button onClick={e => { e.stopPropagation(); if (s.isActive) void ask(s, "deactivate"); else void activate(s); }} className="flex items-center gap-1 text-slate-500 font-semibold hover:underline">
                  {s.isActive ? <><PowerOff size={12} /> Deactivate</> : <><Power size={12} /> Activate</>}
                </button>
                <button onClick={e => { e.stopPropagation(); void ask(s, "delete"); }} className="flex items-center gap-1 text-red-500 font-semibold hover:underline hover:text-red-600"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected
        ? <SurveyOutlineEditor key={selected.id} survey={selected} onChanged={() => { setError(""); void loadSurveys(); }} />
        : <EmptyColumn title="Questions" message="Select a survey to manage its questions." />}

      {editingSurvey && (
        <SurveyEditorModal
          existing={editingSurvey === "new" ? null : editingSurvey}
          onClose={() => setEditingSurvey(null)}
          onSaved={() => { setEditingSurvey(null); void loadSurveys(); }}
        />
      )}
      {asking && dialog(asking)}
    </div>
  );
}
