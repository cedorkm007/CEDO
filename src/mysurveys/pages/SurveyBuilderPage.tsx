import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Check, Eye, Globe, Info, Layers, Loader2, Users, X } from "lucide-react";
import { useSurveyDoc } from "../builder/useSurveyDoc";
import { QuestionCard } from "../builder/QuestionCard";
import { SectionCard } from "../builder/SectionCard";
import { AddQuestionMenu } from "../builder/AddQuestionMenu";
import { PreviewOverlay } from "../builder/PreviewOverlay";
import { PublishDialog } from "../builder/PublishDialog";
import { ConfirmModal } from "../builder/ConfirmModal";
import { ShareDialog } from "../components/ShareDialog";
import { fieldClass } from "../builder/cardParts";
import { SurveyStatusBadge } from "../components/SurveyStatusBadge";
import {
  DEFAULT_CONSENT_TEXT, itemKey, newId, newQuestion, newSection,
  type QuestionItem, type QuestionType, type SurveyItem,
} from "../surveyTypes";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Pending =
  | { kind: "delete-question"; key: string }
  | { kind: "delete-section"; key: string }
  | { kind: "leave" };

/**
 * The survey builder (full-screen, like the My Presentations editor).
 *
 * The survey is one ordered list: a section header starts a section and every
 * question after it belongs to it. Everything saves automatically through
 * useSurveyDoc (see its notes on conflicts and versioning); this component only
 * edits the in-memory document. Who may edit is decided by the database --
 * viewers get a read-only builder (and can still open the Preview).
 */
export function SurveyBuilderPage({ surveyId, onBack, onViewResponses }: { surveyId: string; onBack: () => void; onViewResponses?: (title: string) => void }) {
  const survey = useSurveyDoc(surveyId);
  const { doc, update, canEdit } = survey;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const items = useMemo(() => doc?.items ?? [], [doc]);

  // Numbering shown on the cards ("Question 3", "Section 2").
  const numbering = useMemo(() => {
    let q = 0, s = 0;
    return items.map(item => (item.kind === "question" ? ++q : ++s));
  }, [items]);

  useEffect(() => {
    if (!justAddedId) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`item-${justAddedId}`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [justAddedId]);

  function setItems(fn: (items: SurveyItem[]) => SurveyItem[]) { update(d => ({ ...d, items: fn(d.items) })); }
  function replaceItem(next: SurveyItem) { setItems(list => list.map(i => (itemKey(i) === itemKey(next) ? next : i))); }

  function insertAfterActive(item: SurveyItem) {
    setItems(list => {
      const at = activeId ? list.findIndex(i => itemKey(i) === activeId) + 1 : list.length;
      const copy = [...list];
      copy.splice(at <= 0 ? list.length : at, 0, item);
      return copy;
    });
    setActiveId(itemKey(item));
    setJustAddedId(itemKey(item));
  }

  function addQuestion(type: QuestionType) { insertAfterActive(newQuestion(type)); }
  function addSection() { insertAfterActive(newSection()); }

  function duplicateQuestion(q: QuestionItem) {
    const copy: QuestionItem = {
      ...q, id: newId(), questionKey: newId(), version: 1, hasResponses: false,
      options: q.options.map(o => ({ id: newId(), label: o.label })),
    };
    setItems(list => {
      const at = list.findIndex(i => itemKey(i) === q.questionKey) + 1;
      const next = [...list];
      next.splice(at, 0, copy);
      return next;
    });
    setActiveId(copy.questionKey);
    setJustAddedId(copy.questionKey);
  }

  function moveBy(key: string, dir: -1 | 1) {
    setItems(list => {
      const i = list.findIndex(x => itemKey(x) === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function moveTo(key: string, insertionIndex: number) {
    setItems(list => {
      const from = list.findIndex(x => itemKey(x) === key);
      if (from < 0) return list;
      const to = insertionIndex > from ? insertionIndex - 1 : insertionIndex;
      if (to === from) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function removeItem(key: string) {
    setItems(list => list.filter(i => itemKey(i) !== key));
    if (activeId === key) setActiveId(null);
  }

  function requestDeleteQuestion(q: QuestionItem) {
    if (q.hasResponses) setPending({ kind: "delete-question", key: q.questionKey });
    else removeItem(q.questionKey);
  }

  async function handleViewResponses() {
    if (!onViewResponses || !doc) return;
    const clean = await survey.flush();
    if (clean) onViewResponses(doc.title); else setPending({ kind: "leave" });
  }

  async function handleBack() {
    const clean = await survey.flush();
    if (clean) onBack(); else setPending({ kind: "leave" });
  }

  const dragProps = (key: string) => ({
    onDragStart: (e: React.DragEvent) => {
      setDragId(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      const card = (e.currentTarget as HTMLElement).closest("[data-item]");
      if (card) e.dataTransfer.setDragImage(card, 24, 24);
    },
    onDragEnd: () => { setDragId(null); setDropIndex(null); },
  });

  // ── Loading / missing ──
  if (survey.loading) {
    return <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex items-center justify-center text-slate-500">Loading…</div>;
  }
  if (survey.accessLost) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex flex-col items-center justify-center gap-4 text-slate-500 p-6 text-center">
        <p className="text-[15px] font-bold text-[#062444]">You no longer have access to this survey</p>
        <p className="max-w-sm text-[13px]">The owner removed your access (or the survey was deleted). Any changes you hadn't saved could not be kept.</p>
        <button onClick={onBack} className="flex items-center gap-1.5 border border-[#e6ecf5] bg-white text-[#062444] text-[12.5px] font-semibold rounded-lg px-3.5 py-2"><ArrowLeft size={14} /> Back to My Surveys</button>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex flex-col items-center justify-center gap-4 text-slate-500 p-6 text-center">
        <p className="text-[13.5px] font-medium">{survey.loadFailed ? "This survey doesn't exist or you no longer have access to it." : "Something went wrong."}</p>
        <button onClick={onBack} className="flex items-center gap-1.5 border border-[#e6ecf5] bg-white text-[#062444] text-[12.5px] font-semibold rounded-lg px-3.5 py-2"><ArrowLeft size={14} /> Back to My Surveys</button>
      </div>
    );
  }

  // The stored status can still say Open for a survey whose closing date passed or whose limit was
  // reached (it closes the next time someone visits it); show what respondents actually get.
  const liveStatus = survey.effectiveStatus ?? doc.status;
  const status = survey.saveState;
  const statusPill =
    status === "saving" ? <span className="flex items-center gap-1.5 text-slate-500"><Loader2 size={13} className="animate-spin" /> Saving…</span>
    : status === "dirty" ? <span className="text-slate-500">Unsaved changes…</span>
    : status === "error" ? (
        <span className="flex items-center gap-1.5 text-red-600">
          <AlertTriangle size={13} /> Couldn't save
          <button onClick={survey.retrySave} className="font-semibold underline">Retry</button>
        </span>
      )
    : status === "conflict" ? <span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle size={13} /> Not saved — conflict</span>
    : <span className="flex items-center gap-1.5 text-green-700"><Check size={13} /> All changes saved</span>;

  const pendingQuestion = pending?.kind === "delete-question" ? items.find(i => itemKey(i) === pending.key) : null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[#e6ecf5] shrink-0">
        <button onClick={() => void handleBack()} className="p-1.5 rounded-md text-slate-500 hover:bg-[#f0f3f8]" aria-label="Back to My Surveys">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-[#062444]">{doc.title || "Untitled survey"}</p>
          <p className="text-[11.5px]" role="status" aria-live="polite">{statusPill}</p>
        </div>
        <span className="hidden sm:flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <SurveyStatusBadge status={liveStatus} /> {doc.role}
        </span>
        <button
          onClick={() => setPreviewing(true)} aria-label="Preview"
          className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-2.5 sm:px-3.5 py-2 hover:bg-[#f7f9fc]"
        >
          <Eye size={14} /> <span className="hidden sm:inline">Preview</span>
        </button>
        {onViewResponses && (doc.status !== "draft" || doc.responseCount > 0) && (
          <button
            onClick={() => void handleViewResponses()} aria-label="View responses"
            className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-2.5 sm:px-3.5 py-2 hover:bg-[#f7f9fc]"
          >
            <BarChart3 size={14} /> <span className="hidden sm:inline">Responses</span>
          </button>
        )}
        {doc.role === "owner" && (
          <button
            onClick={() => setSharing(true)} aria-label="Share with colleagues"
            className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-2.5 sm:px-3.5 py-2 hover:bg-[#f7f9fc]"
          >
            <Users size={14} /> <span className="hidden sm:inline">Share</span>
          </button>
        )}
        {(canEdit || doc.status !== "draft") && (
          <button
            onClick={() => setPublishing(true)} aria-label={doc.status === "draft" ? "Publish" : "Link and QR code"}
            className="flex items-center gap-1.5 bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-2.5 sm:px-3.5 py-2 hover:bg-[#0a3a6b]"
          >
            <Globe size={14} /> <span className="hidden sm:inline">{doc.status === "draft" ? "Publish" : "Link & QR"}</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 space-y-3">
          {survey.conflict && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
              <p className="font-semibold">
                {survey.conflict.editedByName || "Someone else"} saved changes to this survey ({formatDateTime(survey.conflict.updatedAt)}) while you were editing.
              </p>
              <p className="mt-1">Your recent edits have not been saved yet. Choose which version to keep:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void survey.loadTheirVersion()} className="rounded-lg border border-amber-400 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-amber-900 hover:bg-amber-100">
                  Load their version (discard my edits)
                </button>
                <button onClick={() => void survey.keepMyVersion()} className="rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-amber-700">
                  Keep my version (overwrite theirs)
                </button>
              </div>
            </div>
          )}
          {survey.remoteNotice && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] font-medium text-sky-800">
              <span className="flex items-center gap-2"><Info size={14} /> {survey.remoteNotice}</span>
              <button onClick={survey.dismissRemoteNotice} aria-label="Dismiss" className="text-sky-500 hover:text-sky-700"><X size={15} /></button>
            </div>
          )}
          {canEdit && survey.autoClosedWhy && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
              <Info size={14} className="shrink-0" /> This survey closed automatically because {survey.autoClosedWhy}. Respondents now see “This survey is no longer accepting responses”. Open Publish to change its settings and reopen it.
            </div>
          )}
          {canEdit && liveStatus === "open" && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-[13px] text-green-800">
              <Globe size={14} className="shrink-0" /> This survey is live. Changes you make here appear for new respondents right away; questions that already have answers are saved as new versions.
            </div>
          )}
          {!canEdit && (
            <div className="flex items-center gap-2 rounded-xl border border-[#e6ecf5] bg-white px-4 py-2.5 text-[13px] text-slate-600">
              <Info size={14} className="shrink-0" /> You have view-only access to this survey. You can preview it but not change it.
            </div>
          )}

          {/* Title + description */}
          <div className="bg-white rounded-2xl border border-[#e6ecf5] border-t-4 border-t-[#062444] p-5">
            <label htmlFor="survey-title" className="sr-only">Survey title</label>
            <input
              id="survey-title" value={doc.title} readOnly={!canEdit} maxLength={200}
              onChange={e => update(d => ({ ...d, title: e.target.value }))}
              placeholder="Survey title"
              className="w-full text-xl font-bold text-[#062444] border-b border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] outline-none py-1 read-only:hover:border-transparent"
            />
            <label htmlFor="survey-description" className="sr-only">Survey description</label>
            <textarea
              id="survey-description" rows={2} value={doc.description} readOnly={!canEdit} maxLength={5000}
              onChange={e => update(d => ({ ...d, description: e.target.value }))}
              placeholder="Description (optional) — shown on the first screen"
              className={`${fieldClass} mt-3 resize-y`}
            />
            <p className="mt-3 text-[11.5px] text-slate-500">
              {doc.lastEditedByName ? <>Last edited by <span className="font-semibold text-slate-500">{doc.lastEditedByName}</span>, </> : "Last edited "}
              {formatDateTime(doc.updatedAt)} · {doc.responseCount} response{doc.responseCount === 1 ? "" : "s"}
            </p>
          </div>

          {/* Consent */}
          <div className="bg-white rounded-2xl border border-[#e6ecf5] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-bold text-[#062444]">Data privacy consent</p>
                <p className="text-[12px] text-slate-500 mt-0.5">Respondents must read and agree to this statement before they can start. Recommended for research under the Data Privacy Act of 2012.</p>
              </div>
              <button
                type="button" role="switch" aria-checked={doc.consentEnabled} aria-label="Ask for data privacy consent" disabled={!canEdit}
                onClick={() => update(d => {
                  const enabled = !d.consentEnabled;
                  return { ...d, consentEnabled: enabled, consentText: enabled && !d.consentText.trim() ? DEFAULT_CONSENT_TEXT : d.consentText };
                })}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${doc.consentEnabled ? "bg-[#0088cc]" : "bg-slate-300"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${doc.consentEnabled ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            {doc.consentEnabled && (
              <>
                <label htmlFor="consent-text" className="sr-only">Consent statement</label>
                <textarea
                  id="consent-text" rows={6} value={doc.consentText} readOnly={!canEdit} maxLength={5000}
                  onChange={e => update(d => ({ ...d, consentText: e.target.value }))}
                  className={`${fieldClass} mt-3 resize-y leading-relaxed`}
                />
                <p className="mt-1.5 text-[11.5px] text-slate-500">This is a starting template, not legal advice — edit it to match your study and have it reviewed by your data protection officer.</p>
              </>
            )}
          </div>

          {/* Items */}
          {items.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-white rounded-2xl border border-dashed border-[#d5dfec]">
              <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-[13.5px] font-medium">This survey has no questions yet.</p>
              {canEdit && <p className="text-[12.5px]">Use “Add question” below to get started.</p>}
            </div>
          ) : (
            <div onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null); }}>
              {items.map((item, i) => {
                const key = itemKey(item);
                return (
                <div
                  key={key} id={`item-${key}`} data-item
                  onDragOver={e => {
                    if (!dragId) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropIndex(i + (e.clientY > r.top + r.height / 2 ? 1 : 0));
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    if (dragId !== null && dropIndex !== null) moveTo(dragId, dropIndex);
                    setDragId(null); setDropIndex(null);
                  }}
                  className="py-1.5"
                >
                  {dragId && dropIndex === i && <div className="h-1 -mt-1 mb-1.5 rounded-full bg-[#0088cc]" />}
                  {item.kind === "section" ? (
                    <SectionCard
                      section={item} number={numbering[i]} readOnly={!canEdit} dragging={dragId === key} drag={dragProps(key)}
                      canMoveUp={i > 0} canMoveDown={i < items.length - 1}
                      onActivate={() => setActiveId(key)} onChange={replaceItem} onMove={dir => moveBy(key, dir)}
                      onDelete={() => setPending({ kind: "delete-section", key })}
                    />
                  ) : (
                    <QuestionCard
                      question={item} number={numbering[i]} readOnly={!canEdit} active={activeId === key}
                      autoFocus={justAddedId === key} dragging={dragId === key} drag={dragProps(key)}
                      canMoveUp={i > 0} canMoveDown={i < items.length - 1}
                      onActivate={() => setActiveId(key)} onChange={replaceItem} onMove={dir => moveBy(key, dir)}
                      onDuplicate={() => duplicateQuestion(item)} onDelete={() => requestDeleteQuestion(item)}
                    />
                  )}
                </div>
                );
              })}
              {dragId && dropIndex === items.length && <div className="h-1 mt-1 rounded-full bg-[#0088cc]" />}
            </div>
          )}
        </div>

        {canEdit && (
          <div className="sticky bottom-0 border-t border-[#e6ecf5] bg-white/95 backdrop-blur px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-center gap-2">
              <AddQuestionMenu onPick={addQuestion} primary />
              <button
                type="button" onClick={addSection}
                className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-3.5 py-2.5 hover:bg-[#f7f9fc]"
              >
                <Layers size={15} /> Add section
              </button>
              <span className="ml-auto hidden sm:block text-[11.5px] text-slate-500">New items are added below the one you're editing.</span>
            </div>
          </div>
        )}
      </div>

      {previewing && (
        <PreviewOverlay
          onClose={() => setPreviewing(false)}
          survey={{ title: doc.title, description: doc.description, consentEnabled: doc.consentEnabled, consentText: doc.consentText, items: doc.items }}
        />
      )}

      {sharing && doc.role === "owner" && (
        <ShareDialog surveyId={surveyId} surveyTitle={doc.title} onClose={() => setSharing(false)} />
      )}

      {publishing && (
        <PublishDialog surveyId={surveyId} doc={doc} serverAction={survey.serverAction} onClose={() => setPublishing(false)} />
      )}

      {pending?.kind === "delete-question" && pendingQuestion && (
        <ConfirmModal
          title="Delete this question?"
          message="It already has responses. They are kept (and still appear in exports and in the Research Project Monitoring tool), but respondents will no longer see this question."
          confirmLabel="Delete question"
          onCancel={() => setPending(null)}
          onConfirm={() => { removeItem(pending.key); setPending(null); }}
        />
      )}
      {pending?.kind === "delete-section" && (
        <ConfirmModal
          title="Delete this section?"
          message="Only the section heading is removed. Its questions stay and join the section above."
          confirmLabel="Delete section"
          onCancel={() => setPending(null)}
          onConfirm={() => { removeItem(pending.key); setPending(null); }}
        />
      )}
      {pending?.kind === "leave" && (
        <ConfirmModal
          title="Leave without saving?"
          message="Your latest edits could not be saved. If you leave now they will be lost."
          confirmLabel="Leave anyway"
          onCancel={() => setPending(null)}
          onConfirm={onBack}
        />
      )}
    </div>
  );
}
