import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { searchScholars, type ScholarSearchResult } from "../formationApi";

export type { ScholarSearchResult };

/**
 * Type-a-name-or-ID search box — shows matching scholars as you type
 * (name, Scholar ID, school). Once one is picked it collapses into a
 * chip (name + ID) with an X to clear and search again; typing a raw ID
 * and never picking a suggestion still works, since callers fall back to
 * whatever text was typed when nothing was selected.
 *
 * Shared by SDP Monitoring's "Credited Scholars" manual-credit form and
 * the Scholar Counseling Tool's "Add Daily Record" form — extracted here
 * so both use one implementation instead of duplicating it.
 */
export function ScholarSearchField({
  query, setQuery, selected, onSelect, onClear,
}: {
  query: string; setQuery: (v: string) => void;
  selected: ScholarSearchResult | null;
  onSelect: (r: ScholarSearchResult) => void;
  onClear: () => void;
}) {
  const [results, setResults] = useState<ScholarSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    if (selected || !query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      setResults(await searchScholars(query));
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  if (selected) {
    return (
      <div className="flex items-center gap-1.5 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 bg-[#f8fafd] w-56">
        <span className="text-[12.5px] font-semibold text-[#062444] truncate">{selected.name}</span>
        <span className="text-[11px] text-slate-400 shrink-0">({selected.scholarIdNumber})</span>
        <button type="button" onClick={onClear} className="ml-auto shrink-0 text-slate-400 hover:text-red-600"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Name or Scholar ID…"
        className="w-56 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
      {open && query.trim() && (
        <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-[#e6ecf5] rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {searching ? (
            <p className="text-[12px] text-slate-400 px-3 py-2">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-[12px] text-slate-400 px-3 py-2">No matches — will be used as a Scholar ID.</p>
          ) : (
            results.map(r => (
              <button key={r.scholarIdNumber} type="button" onClick={() => { onSelect(r); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-[#f8fafd] border-b border-[#f0f3f8] last:border-0">
                <p className="text-[12.5px] font-semibold text-[#062444]">{r.name}</p>
                <p className="text-[11px] text-slate-400">{r.scholarIdNumber}{r.school ? ` · ${r.school}` : ""}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
