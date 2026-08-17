import { useEffect, useState } from "react";
import { CalendarDays, Check, MapPin, Plus, QrCode, Users, X } from "lucide-react";
import { FORMATION_YEAR_LEVELS, type FormationActivity } from "@/scholar/formationActivitiesApi";
import { createFormationActivity, fetchFormationActivities } from "../formationActivitiesApi";

function NewFormationActivityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [venue, setVenue] = useState("");
  const [yearLevels, setYearLevels] = useState<string[]>([]);
  const [allYearLevels, setAllYearLevels] = useState(false);
  const [attendanceEnabled, setAttendanceEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleYearLevel(level: string) {
    setYearLevels(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
  }

  async function handleSubmit() {
    if (!name.trim() || !shortDescription.trim() || !dateTime || !venue.trim()) { setError("Complete the activity name, description, date and time, and venue."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError("Select at least one eligible year level, or choose all year levels."); return; }
    setBusy(true);
    const result = await createFormationActivity({ name: name.trim(), shortDescription: shortDescription.trim(), dateTime, venue: venue.trim(), yearLevels, allYearLevels, attendanceEnabled });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't create the activity."); return; }
    onCreated(); onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="text-[15px] font-bold text-white">New Formation Activity</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Name of activity" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <textarea value={shortDescription} onChange={event => setShortDescription(event.target.value)} placeholder="Short description" rows={3} className="w-full resize-none rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input type="datetime-local" value={dateTime} onChange={event => setDateTime(event.target.value)} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input value={venue} onChange={event => setVenue(event.target.value)} placeholder="Venue" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <fieldset className="border-t border-[#f0f3f8] pt-3">
            <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity for scholars with year level</legend>
            <div className="grid grid-cols-2 gap-2">
              {FORMATION_YEAR_LEVELS.map(level => <label key={level} className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={yearLevels.includes(level)} disabled={allYearLevels} onChange={() => toggleYearLevel(level)} className="h-4 w-4 accent-[#062444]" />{level}</label>)}
              <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold text-[#062444]"><input type="checkbox" checked={allYearLevels} onChange={event => setAllYearLevels(event.target.checked)} className="h-4 w-4 accent-[#062444]" />All year levels</label>
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2 border-t border-[#f0f3f8] pt-3 text-[12.5px] font-semibold text-[#062444]"><input type="checkbox" checked={attendanceEnabled} onChange={event => setAttendanceEnabled(event.target.checked)} className="h-4 w-4 accent-[#062444]" /><QrCode size={14} /> Include attendance monitoring</label>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSubmit()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Check size={15} />{busy ? "Creating…" : "Create Activity"}</button>
        </div>
      </div>
    </div>
  );
}

export function FormationActivitiesTab() {
  const [activities, setActivities] = useState<FormationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  async function load() { setLoading(true); setActivities(await fetchFormationActivities()); setLoading(false); }
  useEffect(() => { void load(); }, []);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-[15px] font-extrabold text-[#062444]">Formation Activities</h2><p className="mt-1 text-[12.5px] text-slate-500">Create activities for selected scholar year levels. Eligible scholars will see them in Calendar and Activities.</p></div><button onClick={() => setShowNew(true)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-2 text-[12.5px] font-bold text-[#F3BC00]"><Plus size={15} /> New Activity</button></div>
      {loading ? <p className="text-[13px] text-slate-400">Loading…</p> : activities.length === 0 ? <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No formation activities yet.</p> : <div className="space-y-2.5">{activities.map(activity => <div key={activity.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-[13.5px] font-bold text-[#062444]">{activity.name}</h3><p className="mt-1 text-[12px] text-slate-500">{activity.shortDescription}</p></div>{activity.attendanceEnabled && <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0088cc]"><QrCode size={11} /> Attendance</span>}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-500"><span className="flex items-center gap-1"><CalendarDays size={12} />{new Date(activity.dateTime).toLocaleString()}</span><span className="flex items-center gap-1"><MapPin size={12} />{activity.venue}</span><span className="flex items-center gap-1"><Users size={12} />{activity.allYearLevels ? "All year levels" : activity.yearLevels.join(", ")}</span></div></div>)}</div>}
      {showNew && <NewFormationActivityModal onClose={() => setShowNew(false)} onCreated={() => void load()} />}
    </div>
  );
}
