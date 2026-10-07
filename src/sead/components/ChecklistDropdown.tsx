import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface ChecklistOption {
  value: string;
  label: string;
  /** Small grey line under the label -- e.g. which barangays a cluster covers. */
  hint?: string;
}

/**
 * A collapsed-by-default dropdown that expands into a scrollable checklist,
 * so a long list (80 barangays) doesn't flood the form it sits in. The
 * closed button summarizes the selection; an empty selection means "no
 * restriction" and shows `emptyLabel`.
 *
 * The panel renders in the normal flow rather than as a floating popover on
 * purpose: these forms live inside scrolling modals, where an absolutely
 * positioned panel gets clipped at the modal's edge.
 */
export function ChecklistDropdown({ options, selected, onChange, emptyLabel, itemNoun, searchable = false, searchPlaceholder }: {
  options: ChecklistOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  /** Singular noun for the "3 barangays selected" summary. */
  itemNoun: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const labelOf = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  }
  function selectVisible() {
    onChange([...new Set([...selected, ...visible.map(o => o.value)])]);
  }

  const summary = selected.length === 0
    ? emptyLabel
    : selected.length <= 2
      ? selected.map(v => labelOf.get(v) ?? v).join(", ")
      : `${selected.length} ${itemNoun}s selected`;

  return (
    <div className="rounded-lg border border-[#062444]/15">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-[#f8fafd]">
        <span className={selected.length === 0 ? "text-slate-400" : "font-semibold text-[#062444]"}>{summary}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-[#f0f3f8] p-2">
          {searchable && (
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={searchPlaceholder ?? "Search…"}
                className="w-full rounded-md border border-[#e6ecf5] py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-[#0088cc]" />
            </div>
          )}
          <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold">
            <button type="button" onClick={selectVisible} className="text-[#0088cc] hover:underline">
              {query.trim() ? "Select all shown" : "Select all"}
            </button>
            <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}
              className="text-slate-400 hover:text-[#062444] disabled:opacity-40">Clear</button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {visible.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-slate-400">No matches.</p>}
            {visible.map(o => (
              <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12px] text-slate-600 hover:bg-[#f8fafd]">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#062444]" />
                <span>
                  {o.label}
                  {o.hint && <span className="block text-[10.5px] leading-snug text-slate-400">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
