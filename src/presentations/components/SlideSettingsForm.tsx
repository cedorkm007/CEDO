import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";
import type {
  PresentationSlide, SlideSettings, TitleSlideSettings, WordCloudSettings, MultipleChoiceSettings, RankingSettings,
} from "../slidesApi";

const MAX_LIST_ITEMS = 8;
const MIN_LIST_ITEMS = 2;

const inputClass = "w-full border border-[#e6ecf5] rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#0088cc]";
const labelClass = "block text-[11px] font-semibold text-slate-500 mb-1.5";

/** Reorderable/removable text-list editor shared by Multiple Choice's options and Ranking's items. */
function EditableList({ items, onChange, itemLabel }: { items: string[]; onChange: (next: string[]) => void; itemLabel: string }) {
  function updateAt(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  function removeAt(index: number) {
    if (items.length <= MIN_LIST_ITEMS) return;
    onChange(items.filter((_, i) => i !== index));
  }
  function add() {
    if (items.length >= MAX_LIST_ITEMS) return;
    onChange([...items, `${itemLabel} ${items.length + 1}`]);
  }

  return (
    <div>
      <label className={labelClass}>{itemLabel}s ({items.length}/{MAX_LIST_ITEMS})</label>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={item} onChange={e => updateAt(i, e.target.value)} className={`${inputClass} flex-1`} />
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded text-slate-400 hover:text-[#062444] disabled:opacity-30" aria-label={`Move ${itemLabel} up`}>
              <ChevronUp size={13} />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 rounded text-slate-400 hover:text-[#062444] disabled:opacity-30" aria-label={`Move ${itemLabel} down`}>
              <ChevronDown size={13} />
            </button>
            <button onClick={() => removeAt(i)} disabled={items.length <= MIN_LIST_ITEMS} className="p-1 rounded text-slate-400 hover:text-red-600 disabled:opacity-30" aria-label={`Remove ${itemLabel}`}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} disabled={items.length >= MAX_LIST_ITEMS} className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] disabled:opacity-30 disabled:cursor-not-allowed">
        <Plus size={13} /> Add {itemLabel.toLowerCase()}
      </button>
    </div>
  );
}

export function SlideSettingsForm({ slide, onChange }: { slide: PresentationSlide; onChange: (settings: SlideSettings) => void }) {
  if (slide.type === "title") {
    const s = slide.settings as TitleSlideSettings;
    return (
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Heading</label>
          <input value={s.heading} onChange={e => onChange({ ...s, heading: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Subheading (optional)</label>
          <textarea value={s.subheading} onChange={e => onChange({ ...s, subheading: e.target.value })} rows={3} className={`${inputClass} resize-none`} />
        </div>
      </div>
    );
  }

  if (slide.type === "word_cloud") {
    const s = slide.settings as WordCloudSettings;
    return (
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Question</label>
          <textarea value={s.question} onChange={e => onChange({ ...s, question: e.target.value })} rows={2} placeholder="e.g. What word describes CEDO to you?" className={`${inputClass} resize-none`} />
        </div>
        <div>
          <label className={labelClass}>Max words per person</label>
          <select value={s.maxWordsPerPerson} onChange={e => onChange({ ...s, maxWordsPerPerson: Number(e.target.value) })} className={inputClass}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Max characters per word</label>
          <input
            type="number" min={5} max={100} value={s.maxCharsPerWord}
            onChange={e => onChange({ ...s, maxCharsPerWord: Math.max(5, Math.min(100, Number(e.target.value) || 5)) })}
            className={inputClass}
          />
        </div>
      </div>
    );
  }

  if (slide.type === "multiple_choice") {
    const s = slide.settings as MultipleChoiceSettings;
    function toggleCorrect(index: number) {
      const has = s.correctIndexes.includes(index);
      onChange({ ...s, correctIndexes: has ? s.correctIndexes.filter(i => i !== index) : [...s.correctIndexes, index] });
    }
    return (
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Question</label>
          <textarea value={s.question} onChange={e => onChange({ ...s, question: e.target.value })} rows={2} placeholder="e.g. Which SDP category interests you most?" className={`${inputClass} resize-none`} />
        </div>
        <div>
          <label className={labelClass}>Options ({s.options.length}/{MAX_LIST_ITEMS})</label>
          <div className="space-y-1.5">
            {s.options.map((option, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="checkbox" checked={s.correctIndexes.includes(i)} onChange={() => toggleCorrect(i)}
                  title="Mark as a correct answer" className="shrink-0"
                />
                <input
                  value={option}
                  onChange={e => onChange({ ...s, options: s.options.map((o, j) => j === i ? e.target.value : o) })}
                  className={`${inputClass} flex-1`}
                />
                <button onClick={() => {
                  if (i === 0) return;
                  const next = [...s.options]; [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange({ ...s, options: next });
                }} disabled={i === 0} className="p-1 rounded text-slate-400 hover:text-[#062444] disabled:opacity-30" aria-label="Move option up">
                  <ChevronUp size={13} />
                </button>
                <button onClick={() => {
                  if (i === s.options.length - 1) return;
                  const next = [...s.options]; [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  onChange({ ...s, options: next });
                }} disabled={i === s.options.length - 1} className="p-1 rounded text-slate-400 hover:text-[#062444] disabled:opacity-30" aria-label="Move option down">
                  <ChevronDown size={13} />
                </button>
                <button
                  onClick={() => onChange({
                    ...s,
                    options: s.options.filter((_, j) => j !== i),
                    correctIndexes: s.correctIndexes.filter(j => j !== i).map(j => j > i ? j - 1 : j),
                  })}
                  disabled={s.options.length <= MIN_LIST_ITEMS}
                  className="p-1 rounded text-slate-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove option"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => onChange({ ...s, options: [...s.options, `Option ${s.options.length + 1}`] })}
            disabled={s.options.length >= MAX_LIST_ITEMS}
            className="mt-2 flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={13} /> Add option
          </button>
          <p className="text-[10.5px] text-slate-400 mt-1">Check a box to mark that option as correct (optional).</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#062444]">
          <input type="checkbox" checked={s.allowMultiple} onChange={e => onChange({ ...s, allowMultiple: e.target.checked })} />
          Allow multiple selections
        </label>
      </div>
    );
  }

  // ranking
  const s = slide.settings as RankingSettings;
  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>Question</label>
        <textarea value={s.question} onChange={e => onChange({ ...s, question: e.target.value })} rows={2} placeholder="e.g. Rank these in order of importance to you" className={`${inputClass} resize-none`} />
      </div>
      <EditableList items={s.items} onChange={items => onChange({ ...s, items })} itemLabel="Item" />
    </div>
  );
}
