import { useEffect, useId, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { schoolKey } from "@/lib/schoolNames";

let cache: string[] | null = null;

/** The official school names (public.schools), alphabetical. Cached for the session — the list changes rarely. */
async function loadSchoolNames(): Promise<string[]> {
  if (cache) return cache;
  const { data, error } = await supabase.from("schools").select("name").order("name");
  if (error || !data) return [];
  cache = data.map(r => String(r.name));
  return cache;
}

/**
 * Pick a scholar's school from the list of schools instead of typing it. The value stays the school's NAME (that is what the
 * scholar record stores and what the other screens filter on); the database links the school behind the scenes and writes the
 * official spelling. A name already on the record that is not in the list is kept and flagged, so nothing is lost silently.
 */
export function SchoolSelect({ value, onChange, label = "School", className = "" }: {
  value: string; onChange: (name: string) => void; label?: string; className?: string;
}) {
  const id = useId();
  const [names, setNames] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { loadSchoolNames().then(n => { setNames(n); setLoaded(true); }); }, []);

  // Select the official spelling that matches what is on the record (so "Pilgrim  Christian College" shows as the official name).
  const matched = useMemo(() => names.find(n => schoolKey(n) === schoolKey(value)) ?? "", [names, value]);
  const unknown = loaded && value.trim() !== "" && matched === "";

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select id={id} value={matched || (unknown ? value : "")} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
        <option value="">{loaded ? "Select a school…" : "Loading schools…"}</option>
        {unknown && <option value={value}>{value} (not in the list)</option>}
        {names.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      {unknown && <p className="text-[12px] text-amber-700 mt-1">This name is not in the list of schools. Choose the right school, or ask CEDO to add or merge it.</p>}
    </div>
  );
}
