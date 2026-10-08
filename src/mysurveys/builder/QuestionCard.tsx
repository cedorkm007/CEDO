import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  QUESTION_TYPES, QUESTION_TYPE_LABELS, isChoiceType, newId,
  type QuestionItem, type QuestionType,
} from "../surveyTypes";
import { TYPE_ICONS } from "./typeIcons";
import { questionProblems } from "./questionProblems";
import { CardActions, DragHandle, fieldClass, type DragProps } from "./cardParts";

function withType(q: QuestionItem, type: QuestionType): QuestionItem {
  const next: QuestionItem = { ...q, type };
  next.options = isChoiceType(type) ? (q.options.length > 0 ? q.options : [{ id: newId(), label: "Option 1" }]) : [];
  if (type === "linear_scale") { next.scaleMin = q.type === "linear_scale" ? q.scaleMin ?? 1 : 1; next.scaleMax = q.type === "linear_scale" ? q.scaleMax ?? 5 : 5; }
  else if (type === "rating") { next.scaleMin = 1; next.scaleMax = q.type === "rating" ? q.scaleMax ?? 5 : 5; }
  else { next.scaleMin = null; next.scaleMax = null; }
  if (type !== "linear_scale") { next.scaleMinLabel = ""; next.scaleMaxLabel = ""; }
  return next;
}

export function QuestionCard({
  question: q, number, readOnly, active, autoFocus, dragging, drag,
  canMoveUp, canMoveDown, onActivate, onChange, onMove, onDuplicate, onDelete,
}: {
  question: QuestionItem;
  number: number;
  readOnly: boolean;
  active: boolean;
  autoFocus: boolean;
  dragging: boolean;
  drag: DragProps;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onActivate: () => void;
  onChange: (next: QuestionItem) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const TypeIcon = TYPE_ICONS[q.type];
  const problems = questionProblems(q);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [focusOption, setFocusOption] = useState<string | null>(null);

  useEffect(() => { if (active && autoFocus) textRef.current?.focus(); }, [active, autoFocus]);
  useEffect(() => {
    if (!focusOption) return;
    document.getElementById(`opt-${focusOption}`)?.focus();
    setFocusOption(null);
  }, [focusOption]);

  const set = (patch: Partial<QuestionItem>) => onChange({ ...q, ...patch });

  function updateOption(id: string, label: string) { set({ options: q.options.map(o => o.id === id ? { ...o, label } : o) }); }
  function addOptionAfter(afterId: string | null) {
    const option = { id: newId(), label: "" };
    const at = afterId ? q.options.findIndex(o => o.id === afterId) + 1 : q.options.length;
    const options = [...q.options];
    options.splice(at, 0, option);
    set({ options });
    setFocusOption(option.id);
  }
  function moveOption(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= q.options.length) return;
    const options = [...q.options];
    [options[index], options[j]] = [options[j], options[index]];
    set({ options });
  }

  if (!active) {
    return (
      <div
        onClick={onActivate}
        className={`group flex items-start gap-2 bg-white rounded-2xl border border-[#e6ecf5] px-4 py-3 cursor-pointer hover:border-[#0088cc]/40 ${dragging ? "opacity-40" : ""}`}
      >
        {!readOnly && <DragHandle drag={drag} />}
        <button type="button" onClick={onActivate} className="flex-1 min-w-0 text-left" aria-label={`Edit question ${number}`}>
          <p className="text-[13.5px] font-semibold text-[#062444] break-words">
            <span className="text-slate-400 mr-1.5">{number}.</span>
            {q.text.trim() || <span className="italic font-normal text-slate-400">Untitled question</span>}
            {q.required && <span className="text-red-500 ml-1" aria-label="required">*</span>}
          </p>
          <p className="mt-1 flex items-center gap-2 flex-wrap text-[11.5px] text-slate-400">
            <span className="inline-flex items-center gap-1"><TypeIcon size={12} /> {QUESTION_TYPE_LABELS[q.type]}</span>
            {q.version > 1 && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">v{q.version}</span>}
            {q.hasResponses && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">has responses</span>}
            {problems.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Needs attention</span>}
          </p>
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border-2 border-[#0088cc] shadow-sm p-4 ${dragging ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#0088cc]">
          {!readOnly && <DragHandle drag={drag} />} Question {number}
          {q.version > 1 && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold normal-case tracking-normal text-slate-500">v{q.version}</span>}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <textarea
          ref={textRef} rows={2} value={q.text} readOnly={readOnly} maxLength={2000}
          onChange={e => set({ text: e.target.value })}
          placeholder="Question" aria-label="Question text"
          className={`${fieldClass} flex-1 resize-y font-semibold text-[14px]`}
        />
        <div className="sm:w-48 shrink-0">
          <label className="sr-only" htmlFor={`type-${q.id}`}>Question type</label>
          <select
            id={`type-${q.id}`} value={q.type} disabled={readOnly}
            onChange={e => onChange(withType(q, e.target.value as QuestionType))}
            className={fieldClass}
          >
            {QUESTION_TYPES.map(t => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      </div>

      <input
        value={q.helpText} readOnly={readOnly} maxLength={1000}
        onChange={e => set({ helpText: e.target.value })}
        placeholder="Help text (optional)" aria-label="Help text"
        className={`${fieldClass} mt-2 text-[12.5px]`}
      />

      <div className="mt-3">
        {(q.type === "short_answer" || q.type === "paragraph" || q.type === "date" || q.type === "time") && (
          <p className="rounded-lg border border-dashed border-[#d5dfec] bg-[#f9fbfe] px-3 py-2.5 text-[12.5px] text-slate-400">
            {q.type === "short_answer" ? "Respondents type a short answer" : q.type === "paragraph" ? "Respondents type a longer answer" : q.type === "date" ? "Respondents pick a date" : "Respondents pick a time"}
          </p>
        )}

        {isChoiceType(q.type) && (
          <div className="space-y-2">
            {q.options.map((o, i) => (
              <div key={o.id} className="flex items-center gap-1.5">
                <span className="w-6 shrink-0 text-center text-[11.5px] font-semibold text-slate-400" aria-hidden="true">
                  {q.type === "dropdown" ? `${i + 1}.` : q.type === "checkboxes" ? "☐" : "○"}
                </span>
                <input
                  id={`opt-${o.id}`} value={o.label} readOnly={readOnly} maxLength={500}
                  onChange={e => updateOption(o.id, e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !readOnly) { e.preventDefault(); addOptionAfter(o.id); } }}
                  placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`}
                  className={fieldClass}
                />
                {!readOnly && (
                  <>
                    <button type="button" onClick={() => moveOption(i, -1)} disabled={i === 0} aria-label={`Move option ${i + 1} up`} className="p-1.5 rounded-md text-slate-400 hover:bg-[#f0f3f8] disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" onClick={() => moveOption(i, 1)} disabled={i === q.options.length - 1} aria-label={`Move option ${i + 1} down`} className="p-1.5 rounded-md text-slate-400 hover:bg-[#f0f3f8] disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => set({ options: q.options.filter(x => x.id !== o.id) })} aria-label={`Remove option ${i + 1}`} className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={14} /></button>
                  </>
                )}
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={() => addOptionAfter(null)} className="ml-7 flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline">
                <Plus size={13} /> Add option
              </button>
            )}
          </div>
        )}

        {q.type === "linear_scale" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-[12.5px] text-slate-600">
              <label htmlFor={`smin-${q.id}`} className="sr-only">Scale starts at</label>
              <select id={`smin-${q.id}`} value={q.scaleMin ?? 1} disabled={readOnly} onChange={e => set({ scaleMin: Number(e.target.value) })} className={`${fieldClass} !w-auto`}>
                <option value={0}>0</option><option value={1}>1</option>
              </select>
              <span>to</span>
              <label htmlFor={`smax-${q.id}`} className="sr-only">Scale ends at</label>
              <select id={`smax-${q.id}`} value={q.scaleMax ?? 5} disabled={readOnly} onChange={e => set({ scaleMax: Number(e.target.value) })} className={`${fieldClass} !w-auto`}>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={q.scaleMinLabel} readOnly={readOnly} maxLength={100} onChange={e => set({ scaleMinLabel: e.target.value })} placeholder={`Label for ${q.scaleMin ?? 1} (optional)`} aria-label="Low-end label" className={fieldClass} />
              <input value={q.scaleMaxLabel} readOnly={readOnly} maxLength={100} onChange={e => set({ scaleMaxLabel: e.target.value })} placeholder={`Label for ${q.scaleMax ?? 5} (optional)`} aria-label="High-end label" className={fieldClass} />
            </div>
          </div>
        )}

        {q.type === "rating" && (
          <div className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <label htmlFor={`rmax-${q.id}`}>Number of stars</label>
            <select id={`rmax-${q.id}`} value={q.scaleMax ?? 5} disabled={readOnly} onChange={e => set({ scaleMax: Number(e.target.value) })} className={`${fieldClass} !w-auto`}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
      </div>

      {q.hasResponses && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
          This question already has responses. Changing its wording, type, scale, or answer options saves it as a new version (v{q.version + 1}); earlier responses stay linked to the version they answered. Changing only “Required” or the help text doesn't.
        </p>
      )}
      {problems.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[12px] font-medium text-amber-700">
          {problems.map(p => <li key={p}>• {p}</li>)}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#f0f3f8] pt-3">
        <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#062444] cursor-pointer min-h-[36px]">
          <button
            type="button" role="switch" aria-checked={q.required} disabled={readOnly}
            onClick={() => set({ required: !q.required })}
            className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${q.required ? "bg-[#0088cc]" : "bg-slate-300"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${q.required ? "left-[18px]" : "left-0.5"}`} />
          </button>
          Required
        </label>
        {!readOnly && (
          <CardActions
            canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMove={onMove}
            onDuplicate={onDuplicate} onDelete={onDelete} deleteLabel="Delete question"
          />
        )}
      </div>
    </div>
  );
}
