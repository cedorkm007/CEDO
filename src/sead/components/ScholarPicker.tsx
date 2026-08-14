import { useEffect, useRef, useState } from "react";
import { Search, X, UserCircle2 } from "lucide-react";
import { searchScholars, type ScholarSearchResult, type ScholarSearchFilter } from "../formationApi";

interface ScholarPickerProps {
  currentScholarIdNumber: string | null;
  currentName?: string; // pre-resolved display name for the current holder, if known
  onAssign: (scholarIdNumber: string) => void;
  onClear: () => void;
  placeholder?: string;
  /** Restricts search results to scholars in this school/cluster/barangay — e.g. appointing a
   *  School President should never surface a scholar from a different school. */
  filter?: ScholarSearchFilter;
}

/** Inline "vacant / assign someone" control — type a name or Scholar ID, pick from the dropdown. */
export function ScholarPicker({ currentScholarIdNumber, currentName, onAssign, onClear, placeholder, filter }: ScholarPickerProps) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScholarSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(async () => {
      setSearching(true);
      setResults(await searchScholars(query, filter));
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, editing]);

  if (editing) {
    return (
      <div ref={wrapRef} className="relative">
        <div className="flex items-center gap-1.5 border border-[#0088cc]/40 rounded-lg px-2.5 py-1.5 bg-white">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder={placeholder ?? "Search by name or Scholar ID…"}
            className="w-full text-[12.5px] outline-none" />
          <button onClick={() => setEditing(false)} className="text-slate-300 hover:text-slate-500 shrink-0"><X size={13} /></button>
        </div>
        {query.trim() && (
          <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-[#e6ecf5] rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {searching ? (
              <p className="text-[12px] text-slate-400 px-3 py-2">Searching…</p>
            ) : results.length === 0 ? (
              <p className="text-[12px] text-slate-400 px-3 py-2">No matches.</p>
            ) : (
              results.map(r => (
                <button key={r.scholarIdNumber} onClick={() => { onAssign(r.scholarIdNumber); setEditing(false); setQuery(""); }}
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

  if (currentScholarIdNumber) {
    return (
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <UserCircle2 size={14} className="text-[#0088cc] shrink-0" />
        <span className="font-semibold text-[#062444]">{currentName ?? currentScholarIdNumber}</span>
        <button onClick={() => setEditing(true)} className="text-[#0088cc] font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity">Change</button>
        <button onClick={onClear} className="text-red-400 hover:text-red-600 font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity">Clear</button>
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="text-[12.5px] text-slate-400 italic cursor-pointer hover:text-[#0088cc] hover:not-italic hover:opacity-80 transition-all">
      Vacant — click to assign
    </button>
  );
}
