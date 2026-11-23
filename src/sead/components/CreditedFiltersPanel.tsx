import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetchFacets } from "../sdpCreditedFiltersApi";
import {
  DIM_LABELS, clearDim, dimsFor, hasDateRange, optionLabel, optionsToShow, toFilterParam, toggleChoice, filterCount,
  type CreditedFilters, type Facets, type ListDim, type ListKind,
} from "@/lib/sdpCreditedFilters";

const FIELD = "rounded-lg border border-[#062444]/15 bg-white px-2.5 py-1.5 text-[13px] text-[#062444] outline-none focus:border-[#0088cc]";
const FEW = 8;

interface Props {
  activityId: string;
  kind: ListKind;
  recurring: boolean;
  search: string;
  filters: CreditedFilters;
  onApply: (f: CreditedFilters) => void;
  onClose: () => void;
  dayLabel: (v: string) => string;
}

/**
 * The filter panel of the Credited Scholars tab. Every filter lists its choices with how many scholars each would match GIVEN THE OTHER FILTERS (the database counts them); a choice nobody matches is greyed.
 * Within one filter the choices mean "any of these"; different filters must all match. On a computer a choice is applied at once; on a phone the choices are made on a full-screen sheet and applied with one button.
 */
export function CreditedFiltersPanel({ activityId, kind, recurring, search, filters, onApply, onClose, dayLabel }: Props) {
  const live = typeof window === "undefined" ? true : window.innerWidth >= 640;
  const [draft, setDraft] = useState<CreditedFilters>(filters);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState<Record<string, string>>({});
  const request = useRef(0);
  const sideForFacets = kind === "credited" ? "credited" : kind === "attended" ? "not_credited" : "eligible";
  const param = JSON.stringify(toFilterParam(draft, kind, recurring));

  useEffect(() => {
    const mine = ++request.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const r = await fetchFacets(activityId, sideForFacets, JSON.parse(param) as Record<string, unknown>, search);
      if (mine !== request.current) return;
      setLoading(false);
      if (!r.ok) { setError(r.error); return; }
      setError(""); setFacets(r.facets);
    }, 200);
    return () => window.clearTimeout(t);
  }, [activityId, sideForFacets, param, search]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const change = (f: CreditedFilters) => { setDraft(f); if (live) onApply(f); };
  const dims = dimsFor(kind, recurring);
  const chosenCount = filterCount(draft, kind, recurring);
  const results = facets?.total?.rows;
  const clearAll = () => change({ year: [], school: [], course: [], barangay: [], cluster: [], status: [], semester: [], how: [], day: [], reason: [], from: "", to: "" });

  return (
    <div className="fixed inset-0 z-[140] flex" role="dialog" aria-modal="true" aria-label="Filters">
      <button type="button" aria-label="Close filters" className="hidden flex-1 bg-black/30 sm:block" onClick={() => { if (!live) return; onClose(); }} />
      <div className="ml-auto flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-[24rem]">
        <div className="flex items-center justify-between border-b border-[#e6ecf5] bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-4 py-3">
          <h3 className="text-[15px] font-bold text-white">Filters{chosenCount > 0 && <span className="ml-2 rounded-full bg-[#F3BC00] px-2 py-0.5 text-[12px] text-[#062444]">{chosenCount}</span>}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-white/80 hover:text-white"><X size={18} /></button>
        </div>
        <p className="border-b border-[#f0f3f8] px-4 py-2 text-[12.5px] text-slate-600">Choices inside one filter mean “any of these”; different filters must all match. The numbers show how many scholars each choice would give with your other filters.</p>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {error && <p role="alert" className="py-2 text-[13px] text-red-700">Couldn't count the choices: {error}</p>}
          {dims.map(dim => {
            const chosen = (draft[dim] ?? []) as string[];
            const all = optionsToShow(dim, facets, chosen);
            const q = (find[dim] ?? "").trim().toLowerCase();
            const matching = q ? all.filter(o => optionLabel(dim, o.v, dayLabel).toLowerCase().includes(q)) : all;
            const showAll = open[dim] || q !== "";
            const shown = showAll ? matching : matching.slice(0, FEW);
            return (
              <fieldset key={dim} className="border-b border-[#f0f3f8] py-3 last:border-0">
                <legend className="flex w-full items-center justify-between text-[13px] font-bold text-[#062444]">
                  <span>{DIM_LABELS[dim as ListDim]}{chosen.length > 0 && <span className="ml-1.5 text-[#006aa3]">({chosen.length})</span>}</span>
                  {chosen.length > 0 && <button type="button" onClick={() => change(clearDim(draft, dim))} className="text-[12px] font-semibold text-[#00709f] hover:underline">Clear</button>}
                </legend>
                {facets === null && loading ? <p className="mt-1 text-[12.5px] text-slate-500">Counting…</p> : all.length === 0 ? <p className="mt-1 text-[12.5px] text-slate-500">No choices.</p> : (
                  <>
                    {all.length > FEW && <input value={find[dim] ?? ""} onChange={e => setFind(s => ({ ...s, [dim]: e.target.value }))} placeholder={`Find in ${DIM_LABELS[dim as ListDim].toLowerCase()}…`} aria-label={`Find in ${DIM_LABELS[dim as ListDim]}`} className={`${FIELD} mt-1.5 w-full`} />}
                    <ul className="mt-1.5 space-y-0.5">
                      {shown.map(o => {
                        const on = chosen.includes(o.v), off = o.n === 0 && !on;
                        const id = `f-${dim}-${o.v}`;
                        return (
                          <li key={o.v}>
                            <label htmlFor={id} className={`flex items-start gap-2 rounded px-1 py-1 text-[13px] ${off ? "text-slate-400" : "cursor-pointer text-[#062444] hover:bg-[#f7f9fc]"}`}>
                              <input id={id} type="checkbox" checked={on} disabled={off} onChange={() => change(toggleChoice(draft, dim, o.v))} className="mt-0.5" />
                              <span className="min-w-0 flex-1 break-words">{optionLabel(dim, o.v, dayLabel)}</span>
                              <span className={`tabular-nums ${off ? "text-slate-300" : "text-slate-600"}`}>{o.n.toLocaleString("en-US")}</span>
                            </label>
                          </li>
                        );
                      })}
                      {q !== "" && matching.length === 0 && <li className="px-1 py-1 text-[12.5px] text-slate-500">Nothing matches “{find[dim]}”.</li>}
                    </ul>
                    {!q && matching.length > FEW && <button type="button" onClick={() => setOpen(s => ({ ...s, [dim]: !s[dim] }))} className="mt-1 text-[12.5px] font-semibold text-[#00709f] hover:underline">{showAll ? "Show fewer" : `Show all ${matching.length}`}</button>}
                  </>
                )}
              </fieldset>
            );
          })}
          {hasDateRange(kind) && (
            <fieldset className="py-3">
              <legend className="flex w-full items-center justify-between text-[13px] font-bold text-[#062444]">
                <span>Date credited</span>
                {(draft.from || draft.to) && <button type="button" onClick={() => change(clearDim(draft, "dates"))} className="text-[12px] font-semibold text-[#00709f] hover:underline">Clear</button>}
              </legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <label className="text-[12px] font-semibold text-slate-600">From<input type="date" value={draft.from ?? ""} max={draft.to || undefined} onChange={e => change({ ...draft, from: e.target.value })} className={`${FIELD} mt-0.5 w-full`} /></label>
                <label className="text-[12px] font-semibold text-slate-600">To<input type="date" value={draft.to ?? ""} min={draft.from || undefined} onChange={e => change({ ...draft, to: e.target.value })} className={`${FIELD} mt-0.5 w-full`} /></label>
              </div>
            </fieldset>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[#e6ecf5] bg-white px-4 py-3">
          <button type="button" onClick={clearAll} disabled={chosenCount === 0} className="rounded-lg border border-[#062444]/30 px-3 py-2 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40">Clear all</button>
          <button type="button" onClick={() => { if (!live) onApply(draft); onClose(); }} className="flex-1 rounded-lg bg-[#062444] px-3 py-2 text-[13px] font-bold text-white">
            {live ? "Done" : "Apply"}{results !== undefined ? ` (${results.toLocaleString("en-US")} result${results === 1 ? "" : "s"})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
