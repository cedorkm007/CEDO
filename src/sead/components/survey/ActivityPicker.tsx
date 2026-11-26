import { useState } from "react";
import { ListSearchBox } from "@/app/components/PaginatedList";
import { filterActivities, takenBy, NO_ACTIVITY_FILTERS, type ActivityFilters, type SurveyActivityOption } from "@/lib/surveyBuilder";
import { SDP_CATEGORIES, SDP_SUBCATEGORIES, subCategoryLabel, type SDPSubCategory } from "@/scholar/sdpApi";

const SHOWN = 100;
const field = "rounded-lg border border-[#062444]/15 bg-white px-2 py-1.5 text-[12.5px] text-[#062444] outline-none focus:border-[#0088cc]";
const dayLabel = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }) : "No date";
const categoryLabel = (key: string | null) => SDP_CATEGORIES.find(c => c.key === key)?.label ?? "No category";

/** Tick the activities a survey is for. An activity that already has another survey is greyed out with that survey's name. */
export function ActivityPicker({ options, surveyId, selected, onChange }: {
  options: SurveyActivityOption[]; surveyId: string | null; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const [filters, setFilters] = useState<ActivityFilters>(NO_ACTIVITY_FILTERS);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const set = (patch: Partial<ActivityFilters>) => setFilters(f => ({ ...f, ...patch }));
  const chosen = new Set(selected);
  const matching = filterActivities(options, filters).filter(o => !onlyChosen || chosen.has(o.id));
  const free = matching.filter(o => !takenBy(o, surveyId));
  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div className="space-y-2">
      <ListSearchBox value={filters.search} onChange={v => set({ search: v })} placeholder="Search activities by name…" />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Type" value={filters.type} onChange={e => set({ type: e.target.value as ActivityFilters["type"], category: "", subCategory: "" })} className={field}>
          <option value="">SDP and Formation</option>
          <option value="sdp">SDP only</option>
          <option value="formation">Formation only</option>
        </select>
        <select aria-label="Category" value={filters.category} disabled={filters.type === "formation"} onChange={e => set({ category: e.target.value })} className={field}>
          <option value="">All categories</option>
          {SDP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select aria-label="Sub-category" value={filters.subCategory} disabled={filters.type === "formation"} onChange={e => set({ subCategory: e.target.value })} className={field}>
          <option value="">All sub-categories</option>
          {SDP_SUBCATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[12px] text-slate-600">From <input type="date" value={filters.from} onChange={e => set({ from: e.target.value })} className={field} /></label>
        <label className="flex items-center gap-1 text-[12px] text-slate-600">To <input type="date" value={filters.to} onChange={e => set({ to: e.target.value })} className={field} /></label>
        <button type="button" onClick={() => { setFilters(NO_ACTIVITY_FILTERS); setOnlyChosen(false); }} className="text-[12px] font-semibold text-[#0088cc] hover:underline">Clear</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <label className="flex items-center gap-1.5 font-semibold text-[#062444]">
          <input type="checkbox" checked={onlyChosen} onChange={e => setOnlyChosen(e.target.checked)} className="h-3.5 w-3.5 accent-[#062444]" />
          {selected.length} chosen — show only these
        </label>
        <span className="flex gap-3">
          <button type="button" disabled={free.length === 0 || free.length > SHOWN} onClick={() => onChange([...new Set([...selected, ...free.map(o => o.id)])])} className="font-semibold text-[#0088cc] hover:underline disabled:text-slate-300">Tick all shown</button>
          <button type="button" disabled={selected.length === 0} onClick={() => onChange([])} className="font-semibold text-[#0088cc] hover:underline disabled:text-slate-300">Untick all</button>
        </span>
      </div>

      <ul className="max-h-60 overflow-y-auto rounded-lg border border-[#e6ecf5] divide-y divide-[#f0f3f8]">
        {matching.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-slate-400">No activities match.</li>}
        {matching.slice(0, SHOWN).map(o => {
          const other = takenBy(o, surveyId);
          return (
            <li key={o.id}>
              <label className={`flex items-start gap-2.5 px-3 py-2 ${other ? "cursor-not-allowed bg-slate-50" : "cursor-pointer hover:bg-[#f8fafd]"}`}>
                <input type="checkbox" checked={chosen.has(o.id)} disabled={!!other} onChange={() => toggle(o.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#062444]" />
                <span className="min-w-0">
                  <span className={`block break-words text-[13px] font-medium ${other ? "text-slate-400" : "text-[#062444]"}`}>{o.name}</span>
                  <span className="block text-[11.5px] text-slate-500">
                    {o.type === "sdp" ? `SDP · ${categoryLabel(o.category)}${o.subCategory ? ` · ${subCategoryLabel(o.subCategory as SDPSubCategory)}` : ""}` : "Formation"} · {dayLabel(o.date)}
                  </span>
                  {other && <span className="block text-[11.5px] font-semibold text-amber-800">Already has the survey "{other}"</span>}
                </span>
              </label>
            </li>
          );
        })}
        {matching.length > SHOWN && <li className="px-3 py-2 text-center text-[12px] text-slate-500">Showing {SHOWN} of {matching.length}. Search or filter to find the others.</li>}
      </ul>
    </div>
  );
}
