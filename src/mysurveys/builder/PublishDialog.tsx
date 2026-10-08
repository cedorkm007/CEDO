import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Lock, Rocket, X } from "lucide-react";
import {
  getPublishInfo, saveSettings, setSurveyStatus,
  type ActionResult, type PublishInfo, type SurveySettings,
} from "../publishApi";
import { LinkAndQr } from "../components/LinkAndQr";
import { SurveyStatusBadge } from "../components/SurveyStatusBadge";
import { fieldClass } from "./cardParts";
import { questionProblems } from "./questionProblems";
import type { SurveyDoc, SurveyStatus } from "../surveyTypes";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

interface Form { thanks: string; oneDevice: boolean; closes: string; limit: string }

function formFrom(info: PublishInfo): Form {
  return {
    thanks: info.thankYouMessage,
    oneDevice: info.oneResponsePerDevice,
    closes: toLocalInput(info.closesAt),
    limit: info.responseLimit === null ? "" : String(info.responseLimit),
  };
}

type Message = { kind: "error"; text: string } | { kind: "problems"; items: string[] } | { kind: "ok"; text: string } | null;

/**
 * "Publish & share": publish / close / reopen the survey, its link and QR code,
 * and the response settings (thank-you message, one response per device,
 * closing date and time, response limit). Everything goes through the server
 * functions in supabase_migration_my_surveys_publishing.sql, which re-check
 * permissions and the survey's readiness -- this dialog only mirrors them.
 */
export function PublishDialog({ surveyId, doc, serverAction, onClose }: {
  surveyId: string;
  doc: SurveyDoc;
  serverAction: (fn: (revision: number) => Promise<ActionResult>) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const canEdit = doc.role === "owner" || doc.role === "editor";
  const [info, setInfo] = useState<PublishInfo | null>(null);
  const [form, setForm] = useState<Form>({ thanks: "", oneDevice: false, closes: "", limit: "" });
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"settings" | "publish" | "close" | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const refresh = useCallback(async () => {
    const next = await getPublishInfo(surveyId);
    if (!next) { setLoadFailed(true); return null; }
    setInfo(next);
    setForm(formFrom(next));
    return next;
  }, [surveyId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const dirty = info !== null && (
    form.thanks.trim() !== info.thankYouMessage ||
    form.oneDevice !== info.oneResponsePerDevice ||
    form.closes !== toLocalInput(info.closesAt) ||
    form.limit.trim() !== (info.responseLimit === null ? "" : String(info.responseLimit))
  );

  // What the server will also check before it lets the survey go live.
  const readiness = useMemo(() => {
    const out: string[] = [];
    let n = 0;
    for (const item of doc.items) {
      if (item.kind !== "question") continue;
      n += 1;
      for (const p of questionProblems(item)) out.push(`Question ${n}: ${p}`);
    }
    if (n === 0) out.push("Add at least one question.");
    return out;
  }, [doc.items]);

  function readSettings(): SurveySettings | string {
    const limitText = form.limit.trim();
    let limit: number | null = null;
    if (limitText !== "") {
      if (!/^\d+$/.test(limitText) || Number(limitText) < 1) return "The response limit must be a whole number, 1 or more.";
      limit = Number(limitText);
    }
    return { thankYouMessage: form.thanks.trim(), oneResponsePerDevice: form.oneDevice, closesAt: fromLocalInput(form.closes), responseLimit: limit };
  }

  /** Save the settings form if it changed. Returns false (with a message shown) if it could not be saved. */
  async function persistSettings(): Promise<boolean> {
    if (!dirty) return true;
    const settings = readSettings();
    if (typeof settings === "string") { setMessage({ kind: "error", text: settings }); return false; }
    const res = await serverAction(rev => saveSettings(surveyId, rev, settings));
    if (!res.ok) { reportFailure(res); return false; }
    await refresh();
    return true;
  }

  function reportFailure(res: ActionResult) {
    if (res.ok) return;
    if (res.conflict) { onClose(); return; } // the editor's conflict banner explains what to do
    if ("problems" in res) setMessage({ kind: "problems", items: res.problems });
    else setMessage({ kind: "error", text: res.error });
  }

  async function handleSaveSettings() {
    setBusy("settings"); setMessage(null);
    if (await persistSettings()) setMessage({ kind: "ok", text: "Settings saved." });
    setBusy(null);
  }

  async function handlePublish() {
    setBusy("publish"); setMessage(null);
    if (await persistSettings()) {
      const res = await serverAction(rev => setSurveyStatus(surveyId, rev, "open"));
      if (res.ok) { await refresh(); setMessage({ kind: "ok", text: "Your survey is live. Share the link or QR code below." }); }
      else reportFailure(res);
    }
    setBusy(null);
  }

  async function handleClose() {
    setBusy("close"); setMessage(null);
    const res = await serverAction(rev => setSurveyStatus(surveyId, rev, "closed"));
    if (res.ok) { await refresh(); setMessage({ kind: "ok", text: "Survey closed. It no longer accepts responses." }); }
    else reportFailure(res);
    setBusy(null);
  }

  const effective: SurveyStatus | null = info
    ? (info.status === "open" && (info.closesAtPassed || info.limitReached) ? "closed" : info.status)
    : null;
  const autoClosedWhy = info && info.status === "open" && effective === "closed"
    ? (info.limitReached ? "its response limit was reached" : "its closing date passed")
    : null;

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="publish-title" className="text-[15px] font-bold text-[#062444]">{canEdit ? "Publish & share" : "Survey link"}</h3>
            <p className="truncate text-[12.5px] text-slate-500">{doc.title || "Untitled survey"}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-[#f0f3f8]"><X size={16} /></button>
        </div>

        {loadFailed ? (
          <p className="py-8 text-center text-[13px] text-slate-500">Couldn't load the publishing details. Close this window and try again.</p>
        ) : !info || !effective ? (
          <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <SurveyStatusBadge status={effective} />
              <span className="text-[12.5px] text-slate-500">{info.responseCount} response{info.responseCount === 1 ? "" : "s"}</span>
              {autoClosedWhy && <span className="text-[12px] text-amber-700">Closed automatically — {autoClosedWhy}.</span>}
            </div>

            {message && (
              <div
                role={message.kind === "ok" ? "status" : "alert"}
                className={`rounded-lg px-3 py-2.5 text-[12.5px] ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
              >
                {message.kind === "problems" ? (
                  <>
                    <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> Fix these before publishing:</p>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">{message.items.map(p => <li key={p}>{p}</li>)}</ul>
                  </>
                ) : message.kind === "ok" ? <span className="flex items-center gap-1.5"><Check size={13} /> {message.text}</span> : message.text}
              </div>
            )}

            {/* Link + QR once the survey has been published */}
            {info.publicSlug && effective !== "draft" && <LinkAndQr slug={info.publicSlug} closed={effective === "closed"} />}

            {/* Publish / close / reopen */}
            {canEdit && effective === "draft" && (
              <div className="space-y-2">
                {readiness.length > 0 && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
                    <p className="font-semibold">Not ready yet:</p>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">{readiness.map(p => <li key={p}>{p}</li>)}</ul>
                  </div>
                )}
                <p className="text-[12.5px] text-slate-500">Publishing creates a private link and QR code. Anyone who has the link can answer — respondents don't need to sign in.</p>
                <button
                  onClick={() => void handlePublish()} disabled={busy !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] px-4 py-3 text-[13.5px] font-semibold text-white hover:bg-[#0a3a6b] disabled:opacity-60"
                >
                  {busy === "publish" ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} Publish survey
                </button>
              </div>
            )}
            {canEdit && effective === "open" && (
              <button
                onClick={() => void handleClose()} disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {busy === "close" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Close survey (stop accepting responses)
              </button>
            )}
            {canEdit && effective === "closed" && (
              <button
                onClick={() => void handlePublish()} disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#0a3a6b] disabled:opacity-60"
              >
                {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Reopen survey
              </button>
            )}

            {/* Settings */}
            <fieldset disabled={!canEdit} className="space-y-3 border-t border-[#f0f3f8] pt-4">
              <legend className="text-[13px] font-bold text-[#062444]">Settings</legend>

              <div>
                <label htmlFor="set-thanks" className="block text-[12px] font-semibold text-slate-600 mb-1">Message shown after submitting</label>
                <textarea
                  id="set-thanks" rows={2} maxLength={2000} value={form.thanks} onChange={e => setForm(f => ({ ...f, thanks: e.target.value }))}
                  placeholder="Thank you for your response!" className={`${fieldClass} resize-y`}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="set-closes" className="block text-[12px] font-semibold text-slate-600 mb-1">Close automatically on (optional)</label>
                  <input id="set-closes" type="datetime-local" value={form.closes} onChange={e => setForm(f => ({ ...f, closes: e.target.value }))} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="set-limit" className="block text-[12px] font-semibold text-slate-600 mb-1">Response limit (optional)</label>
                  <input
                    id="set-limit" inputMode="numeric" value={form.limit} onChange={e => setForm(f => ({ ...f, limit: e.target.value }))}
                    placeholder="No limit" className={fieldClass}
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-[12.5px] text-[#062444] cursor-pointer">
                <input
                  type="checkbox" checked={form.oneDevice} onChange={e => setForm(f => ({ ...f, oneDevice: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#062444]"
                />
                <span>
                  <span className="font-semibold">Allow only one response per device</span>
                  <span className="block text-slate-500">Based on the browser, so it discourages repeat answers but can't stop someone who uses another phone or a private window.</span>
                </span>
              </label>

              {canEdit && (
                <button
                  onClick={() => void handleSaveSettings()} disabled={!dirty || busy !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-[#e6ecf5] px-3.5 py-2 text-[12.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40"
                >
                  {busy === "settings" && <Loader2 size={13} className="animate-spin" />} Save settings
                </button>
              )}
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}
