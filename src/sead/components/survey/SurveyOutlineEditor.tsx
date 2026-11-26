import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, ListChecks, MessageSquareText, Pencil, Plus, SlidersHorizontal, Trash2, UploadCloud, AlertTriangle } from "lucide-react";
import { ListSearchBox } from "@/app/components/PaginatedList";
import { flatten, groupBySection, layoutOf, moveQuestion, moveSection, skipProblem, type OutlineQuestion, type OutlineSection, type SurveyGroup } from "@/lib/surveyBuilder";
import { deleteQuestion, deleteSection, fetchSurveyOutline, reorderSurvey, type Result } from "../../surveyEditorApi";
import { SurveyQuestionEditorModal } from "../SurveyQuestionEditorModal";
import { BulkSurveyQuestionUploadModal } from "../BulkSurveyQuestionUploadModal";
import { SectionModal } from "./SectionModal";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Survey } from "../../types";

type Dragged = { kind: "question" | "section"; id: string } | null;
const answers = (n: number) => `${n} answer${n === 1 ? "" : "s"}`;
const textButton = "flex items-center gap-1 text-[12px] font-semibold hover:underline";
const iconButton = "rounded-lg p-1.5 text-slate-500 hover:bg-[#f0f3f8] hover:text-[#062444] disabled:opacity-30";

/** The questions of one survey: sections, drag to reorder, add / edit / delete, with warnings for skips that no longer work. */
export function SurveyOutlineEditor({ survey, onChanged }: { survey: Survey; onChanged: () => void }) {
  const [groups, setGroups] = useState<SurveyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ question: OutlineQuestion | null; sectionId: string | null } | null>(null);
  const [sectionModal, setSectionModal] = useState<{ section: OutlineSection | null } | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [removing, setRemoving] = useState<{ question?: OutlineQuestion; section?: OutlineSection } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const dragged = useRef<Dragged>(null);

  const load = useCallback(async () => {
    const r = await fetchSurveyOutline(survey.id);
    if (r.ok) { setGroups(groupBySection(r.outline.sections, r.outline.questions)); setError(""); }
    else { setGroups([]); setError(r.error); }
    setLoading(false);
  }, [survey.id]);
  useEffect(() => { setLoading(true); setSearch(""); void load(); }, [load]);

  const changed = () => { void load(); onChanged(); };
  const questions = flatten(groups);
  const sections = groups.filter(g => g.section).map(g => g.section!);
  const problems = questions.reduce((n, q) => n + q.choices.filter(c => skipProblem(groups, q, c)).length, 0);
  const term = search.trim().toLowerCase();

  async function applyOrder(next: SurveyGroup[]) {
    setGroups(next);                                   // shown at once; the database answers a moment later
    const r = await reorderSurvey(survey.id, layoutOf(next));
    await load();
    if (r.ok === false) setError(r.error);
  }

  /** Up/down buttons: also walks into the neighbouring section (touch screens cannot drag). */
  function step(question: OutlineQuestion, dir: -1 | 1) {
    const g = groups.findIndex(x => x.questions.some(q => q.id === question.id));
    const list = groups[g].questions;
    const i = list.findIndex(q => q.id === question.id);
    const sectionId = groups[g].section?.id ?? null;
    if (dir === -1 && i > 0) return void applyOrder(moveQuestion(groups, question.id, sectionId, list[i - 1].id));
    if (dir === 1 && i < list.length - 1) return void applyOrder(moveQuestion(groups, question.id, sectionId, list[i + 2]?.id ?? null));
    const target = groups[g + dir];
    if (target) void applyOrder(moveQuestion(groups, question.id, target.section?.id ?? null, dir === -1 ? null : target.questions[0]?.id ?? null));
  }

  function drop(e: React.DragEvent, sectionId: string | null, beforeId: string | null) {
    e.preventDefault();
    e.stopPropagation();
    const item = dragged.current;
    dragged.current = null;
    if (!item) return;
    if (item.kind === "question") { void applyOrder(moveQuestion(groups, item.id, sectionId, beforeId)); return; }
    if (sectionId) void applyOrder(moveSection(groups, item.id, sections.findIndex(s => s.id === sectionId)));
  }

  const dragProps = (item: NonNullable<Dragged>) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); dragged.current = item; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id); },
    onDragEnd: () => { dragged.current = null; },
  });
  const allowDrop = (e: React.DragEvent) => { if (dragged.current) e.preventDefault(); };

  async function runRemove(run: () => Promise<Result>) {
    setRemoveBusy(true);
    setRemoveError("");
    const r = await run();
    setRemoveBusy(false);
    if (r.ok === false) { setRemoveError(r.error); return; }
    setRemoving(null);
    changed();
  }

  const skipText = (q: OutlineQuestion, c: OutlineQuestion["choices"][number]) => {
    if (skipProblem(groups, q, c)) return null;
    if (c.endsSurvey) return "ends the survey";
    if (c.skipToQuestionId) return `skips to question ${questions.findIndex(x => x.id === c.skipToQuestionId) + 1}`;
    if (c.skipToSectionId) return `skips to "${sections.find(s => s.id === c.skipToSectionId)?.title}"`;
    return null;
  };

  function questionCard(q: OutlineQuestion, sectionId: string | null) {
    const number = questions.findIndex(x => x.id === q.id) + 1;
    return (
      <li key={q.id} onDragOver={allowDrop} onDrop={e => drop(e, sectionId, q.id)} className="border-b border-[#f0f3f8] bg-white px-3 py-3">
        <div className="flex items-start gap-2">
          {!term && <span {...dragProps({ kind: "question", id: q.id })} title="Drag to reorder" className="mt-0.5 cursor-grab text-slate-300 hover:text-slate-500"><GripVertical size={16} aria-hidden="true" /></span>}
          <div className="min-w-0 flex-1">
            <p className="break-words text-[14px] font-medium leading-relaxed text-[#062444]">{number}. {q.questionText}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
              <span className="flex items-center gap-1 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[#0088cc]">
                {q.questionType === "likert" ? <><SlidersHorizontal size={11} /> Likert</> : q.questionType === "open_ended" ? <><MessageSquareText size={11} /> Open-Ended</> : <><ListChecks size={11} /> Multiple Choice</>}
              </span>
              {q.isOptional && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Optional</span>}
              {q.version > 1 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Version {q.version}</span>}
              <span className="text-slate-500">{answers(q.answerCount)}</span>
            </p>
            {q.questionType === "multiple_choice" ? (
              <ul className="mt-1.5 space-y-0.5">
                {q.choices.map((c, i) => {
                  const problem = skipProblem(groups, q, c);
                  return (
                    <li key={c.id ?? i} className="text-[12px] text-slate-600">
                      • {c.choiceText}{skipText(q, c) && <span className="text-[#0088cc]"> → {skipText(q, c)}</span>}
                      {problem && <span className="ml-1 font-semibold text-red-600">⚠ {problem} Scholars go to the next question until you fix it.</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-[12px] text-slate-600">
                {q.questionType === "open_ended" ? (q.openEndedFormat === "long" ? "Paragraph" : "Short answer") : `Scale ${q.likertScaleMin}–${q.likertScaleMax}: "${q.likertMinLabel}" to "${q.likertMaxLabel}"`}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setEditing({ question: q, sectionId })} className={`${textButton} text-[#0088cc]`}><Pencil size={12} /> Edit</button>
              <button type="button" onClick={() => { setRemoveError(""); setRemoving({ question: q }); }} className={`${textButton} text-red-500`}><Trash2 size={12} /> Delete</button>
              {sections.length > 1 && !term && (
                <select aria-label="Move to section" value={sectionId ?? ""} onChange={e => void applyOrder(moveQuestion(groups, q.id, e.target.value || null, null))}
                  className="rounded-lg border border-[#062444]/15 bg-white px-2 py-1 text-[12px] text-slate-600">
                  {sections.map((s, i) => <option key={s.id} value={s.id}>In section {i + 1}: {s.title.slice(0, 40)}</option>)}
                </select>
              )}
            </div>
          </div>
          {!term && (
            <div className="flex shrink-0 flex-col">
              <button type="button" onClick={() => step(q, -1)} disabled={groups[0].questions[0]?.id === q.id} aria-label="Move question up" className={iconButton}><ArrowUp size={14} /></button>
              <button type="button" onClick={() => step(q, 1)} disabled={groups[groups.length - 1].questions.at(-1)?.id === q.id} aria-label="Move question down" className={iconButton}><ArrowDown size={14} /></button>
            </div>
          )}
        </div>
      </li>
    );
  }

  const incoming = (q: OutlineQuestion) => questions.reduce((n, x) => n + x.choices.filter(c => c.skipToQuestionId === q.id).length, 0);
  const sectionQuestions = removing?.section ? groups.find(g => g.section?.id === removing.section!.id)?.questions ?? [] : [];

  return (
    <div className="flex min-h-[72vh] flex-col rounded-2xl border border-[#e6ecf5] bg-white xl:max-h-[720px]">
      <div className="space-y-2 border-b border-[#e6ecf5] px-4 py-3">
        <h3 className="truncate text-[12.5px] font-bold text-[#062444]">Questions — {survey.title}</h3>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => setEditing({ question: null, sectionId: sections.at(-1)?.id ?? null })} className={`${textButton} text-[#0088cc]`}><Plus size={14} /> Add question</button>
          <button type="button" onClick={() => setSectionModal({ section: null })} className={`${textButton} text-[#0088cc]`}><Plus size={14} /> Add section</button>
          <button type="button" onClick={() => setShowBulk(true)} className={`${textButton} text-[#0088cc]`}><UploadCloud size={14} /> Bulk Upload</button>
        </div>
        {questions.length > 5 && <ListSearchBox value={search} onChange={setSearch} placeholder="Search questions…" />}
        {problems > 0 && <p className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600"><AlertTriangle size={13} /> {problems} skip{problems === 1 ? "" : "s"} need attention (shown in red below).</p>}
        {error && <p role="alert" className="text-[12.5px] text-red-600">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
          : questions.length === 0 && sections.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">{error ? "" : "No questions yet."}</p>
          : groups.map(g => {
            const index = g.section ? sections.findIndex(s => s.id === g.section!.id) : -1;
            const shown = term ? g.questions.filter(q => q.questionText.toLowerCase().includes(term)) : g.questions;
            if (term && shown.length === 0) return null;
            return (
              <section key={g.section?.id ?? "none"} onDragOver={allowDrop} onDrop={e => drop(e, g.section?.id ?? null, null)}>
                {g.section && (
                  <header className="flex items-start gap-2 border-b border-t border-[#e6ecf5] bg-[#f7f9fc] px-3 py-2">
                    {!term && <span {...dragProps({ kind: "section", id: g.section.id })} title="Drag to reorder sections" className="mt-0.5 cursor-grab text-slate-300 hover:text-slate-500"><GripVertical size={16} aria-hidden="true" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13px] font-bold text-[#062444]">Section {index + 1}{g.section.title === `Section ${index + 1}` ? "" : `: ${g.section.title}`}</p>
                      {g.section.description && <p className="break-words text-[12px] text-slate-600">{g.section.description}</p>}
                      <div className="mt-1 flex flex-wrap gap-3">
                        <button type="button" onClick={() => setSectionModal({ section: g.section })} className={`${textButton} text-[#0088cc]`}><Pencil size={12} /> Rename</button>
                        <button type="button" onClick={() => setEditing({ question: null, sectionId: g.section!.id })} className={`${textButton} text-[#0088cc]`}><Plus size={12} /> Add question here</button>
                        <button type="button" onClick={() => { setRemoveError(""); setRemoving({ section: g.section! }); }} className={`${textButton} text-red-500`}><Trash2 size={12} /> Delete section</button>
                      </div>
                    </div>
                    {!term && (
                      <div className="flex shrink-0">
                        <button type="button" disabled={index === 0} onClick={() => void applyOrder(moveSection(groups, g.section!.id, index - 1))} aria-label="Move section up" className={iconButton}><ArrowUp size={14} /></button>
                        <button type="button" disabled={index === sections.length - 1} onClick={() => void applyOrder(moveSection(groups, g.section!.id, index + 1))} aria-label="Move section down" className={iconButton}><ArrowDown size={14} /></button>
                      </div>
                    )}
                  </header>
                )}
                {shown.length === 0
                  ? <p className="px-4 py-3 text-[12px] italic text-slate-400">No questions in this section. Drag one here or press "Add question here". Scholars do not see an empty section.</p>
                  : <ul>{shown.map(q => questionCard(q, g.section?.id ?? null))}</ul>}
              </section>
            );
          })}
      </div>

      {editing && (
        <SurveyQuestionEditorModal surveyId={survey.id} groups={groups} existing={editing.question} sectionId={editing.sectionId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />
      )}
      {sectionModal && (
        <SectionModal surveyId={survey.id} existing={sectionModal.section} movesExistingQuestions={!sectionModal.section && sections.length === 0 && questions.length > 0}
          onClose={() => setSectionModal(null)} onSaved={() => { setSectionModal(null); changed(); }} />
      )}
      {showBulk && (
        <BulkSurveyQuestionUploadModal surveyId={survey.id} surveyTitle={survey.title} sections={sections} onClose={() => setShowBulk(false)} onDone={changed} />
      )}
      {removing?.question && (
        <ConfirmDialog title="Delete this question?" busy={removeBusy} error={removeError} onClose={() => setRemoving(null)}
          lines={[
            `"${removing.question.questionText}"`,
            removing.question.answerCount > 0
              ? `${answers(removing.question.answerCount)} collected for it will be kept, and still show in Survey Results marked as removed.`
              : "No answers have been collected for it.",
            ...(incoming(removing.question) > 0 ? [`${incoming(removing.question)} answer choice(s) skip to it. They will go to the next question and be shown in red until you fix them.`] : []),
          ]}
          actions={[{ label: "Delete question", tone: "danger", run: () => void runRemove(() => deleteQuestion(removing.question!.id)) }]} />
      )}
      {removing?.section && (
        <ConfirmDialog title="Delete this section?" busy={removeBusy} error={removeError} onClose={() => setRemoving(null)}
          lines={[
            `"${removing.section.title}" has ${sectionQuestions.length} question${sectionQuestions.length === 1 ? "" : "s"} with ${answers(sectionQuestions.reduce((n, q) => n + q.answerCount, 0))}.`,
            sectionQuestions.length > 0
              ? "You can keep the questions (they move to the section beside it), or delete them too. Answers already collected are kept either way."
              : "It is empty.",
          ]}
          actions={sectionQuestions.length > 0
            ? [
              { label: "Delete section, keep questions", run: () => void runRemove(() => deleteSection(removing.section!.id, true)) },
              { label: "Delete section and questions", tone: "danger", run: () => void runRemove(() => deleteSection(removing.section!.id, false)) },
            ]
            : [{ label: "Delete section", tone: "danger", run: () => void runRemove(() => deleteSection(removing.section!.id, true)) }]} />
      )}
    </div>
  );
}
