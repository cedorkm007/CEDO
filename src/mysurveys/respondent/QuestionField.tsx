import type { QuestionItem, RunnerAnswer } from "../surveyTypes";

/**
 * The answer control for one question, shared by the live respondent page and
 * the builder's Preview. Respondents are on phones, often on slow data, so this
 * file uses plain React + Tailwind classes only (no icon or chart libraries).
 *
 * Touch/accessibility rules followed throughout: every tap target is at least
 * 44px tall, text is at least 16px (also stops iOS from zooming into inputs),
 * a whole option row is tappable (not just a tiny box), and every control is a
 * real form element named by the question text via aria-labelledby.
 */

const inputClass =
  "w-full min-h-[48px] rounded-xl border-2 border-[#c9d5e6] bg-white px-4 py-2.5 text-[16px] text-[#062444] placeholder:text-slate-400 focus:border-[#0088cc] focus:outline-none focus:ring-2 focus:ring-[#0088cc]/30";

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" className={filled ? "text-[#F3BC00]" : "text-slate-300"}>
      <path
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"
        fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
    </svg>
  );
}

export function QuestionField({ question, answer, onChange, labelId }: {
  question: QuestionItem;
  answer: RunnerAnswer | undefined;
  onChange: (next: RunnerAnswer) => void;
  /** id of the element holding the question text, so the control is named by it. */
  labelId: string;
}) {
  const q = question;
  const name = `q-${q.id}`;

  switch (q.type) {
    case "short_answer":
      return (
        <input
          type="text" inputMode="text" autoComplete="off" aria-labelledby={labelId}
          value={answer?.text ?? ""} onChange={e => onChange({ text: e.target.value })}
          placeholder="Your answer" className={inputClass}
        />
      );

    case "paragraph":
      return (
        <textarea
          rows={5} aria-labelledby={labelId}
          value={answer?.text ?? ""} onChange={e => onChange({ text: e.target.value })}
          placeholder="Your answer" className={`${inputClass} resize-y leading-relaxed`}
        />
      );

    case "date":
      return <input type="date" aria-labelledby={labelId} value={answer?.text ?? ""} onChange={e => onChange({ text: e.target.value })} className={inputClass} />;

    case "time":
      return <input type="time" aria-labelledby={labelId} value={answer?.text ?? ""} onChange={e => onChange({ text: e.target.value })} className={inputClass} />;

    case "dropdown":
      return (
        <select
          aria-labelledby={labelId} value={answer?.optionIds?.[0] ?? ""}
          onChange={e => onChange({ optionIds: e.target.value ? [e.target.value] : [] })}
          className={`${inputClass} appearance-auto`}
        >
          <option value="">Choose an option</option>
          {q.options.map(o => <option key={o.id} value={o.id}>{o.label || "(blank option)"}</option>)}
        </select>
      );

    case "multiple_choice":
    case "checkboxes": {
      const multiple = q.type === "checkboxes";
      const selected = answer?.optionIds ?? [];
      return (
        <div role={multiple ? "group" : "radiogroup"} aria-labelledby={labelId} className="space-y-2.5">
          {q.options.map(o => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={`flex min-h-[52px] cursor-pointer items-center gap-3.5 rounded-xl border-2 px-4 py-3 text-[16px] transition-colors ${
                  checked ? "border-[#0088cc] bg-[#eaf5fc]" : "border-[#c9d5e6] bg-white hover:border-[#0088cc]/50"
                } focus-within:ring-2 focus-within:ring-[#0088cc]/40`}
              >
                <input
                  type={multiple ? "checkbox" : "radio"} name={name} checked={checked}
                  onChange={() => {
                    if (multiple) onChange({ optionIds: checked ? selected.filter(id => id !== o.id) : [...selected, o.id] });
                    else onChange({ optionIds: [o.id] });
                  }}
                  className="h-6 w-6 shrink-0 accent-[#062444]"
                />
                <span className="min-w-0 break-words text-[#062444]">{o.label || "(blank option)"}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "linear_scale": {
      const min = q.scaleMin ?? 1;
      const max = q.scaleMax ?? 5;
      const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div>
          <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2.5">
            {values.map(v => (
              <label key={v} className="cursor-pointer">
                <input type="radio" name={name} className="peer sr-only" checked={answer?.number === v} onChange={() => onChange({ number: v })} />
                <span className="flex h-12 min-w-[48px] items-center justify-center rounded-xl border-2 border-[#c9d5e6] bg-white px-3 text-[16px] font-semibold text-[#062444] transition-colors hover:border-[#0088cc]/60 peer-checked:border-[#062444] peer-checked:bg-[#062444] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#0088cc]/50">
                  {v}
                </span>
              </label>
            ))}
          </div>
          {(q.scaleMinLabel || q.scaleMaxLabel) && (
            <div className="mt-3 flex justify-between gap-4 text-[14px] text-slate-600">
              <span>{q.scaleMinLabel}</span>
              <span className="text-right">{q.scaleMaxLabel}</span>
            </div>
          )}
        </div>
      );
    }

    case "rating": {
      const max = q.scaleMax ?? 5;
      const value = answer?.number ?? 0;
      return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map(v => (
            <label key={v} className="cursor-pointer rounded-lg">
              <input type="radio" name={name} className="peer sr-only" checked={value === v} onChange={() => onChange({ number: v })} />
              <span className="flex h-12 w-12 items-center justify-center rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-[#0088cc]/50">
                <Star filled={v <= value} />
                <span className="sr-only">{v} of {max}</span>
              </span>
            </label>
          ))}
        </div>
      );
    }
  }
}
