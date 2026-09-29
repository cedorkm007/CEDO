import { useState } from "react";
import { X, Check } from "lucide-react";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { updateSDPActivity, type SDPActivity } from "../sdpMonitorApi";
import { updateFormationActivity } from "../formationActivitiesApi";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";
import type { ActivityType } from "../activityMonitorsApi";

interface Props {
  activityType: ActivityType;
  activity: SDPActivity | FormationActivity;
  onClose: () => void;
  onSaved: () => void;
}

function localDatePart(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function localTimePart(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * A small edit surface for a monitor who doesn't hold the tool's own tag
 * (SDP Monitoring / is_sead_staff) and so can't reach the full
 * SDPMonitoringTab/FormationActivitiesTab dashboards — just the fields a
 * monitor actually needs: name, date/time, venue, year-level eligibility.
 * Everything else (pubmat, attendance setup, budget/proposal fields,
 * monitor list itself) stays exclusive to the full dashboard. Relies
 * entirely on the monitor-scoped UPDATE RLS policies added in
 * supabase_migration_activity_monitor_helpers_and_policies.sql — no
 * client-side authorization check beyond "this activity was returned by
 * fetchMyMonitoredActivities()," which RLS already guaranteed.
 */
export function LightweightActivityEditModal({ activityType, activity, onClose, onSaved }: Props) {
  const [name, setName] = useState(activity.name);
  const [date, setDate] = useState(localDatePart(activity.dateTime));
  const [startTime, setStartTime] = useState(localTimePart(activity.dateTime));
  const [endTime, setEndTime] = useState(activity.endTime ? localTimePart(activity.endTime) : "");
  const [venue, setVenue] = useState(activity.venue);
  const [yearLevels, setYearLevels] = useState<string[]>(activity.yearLevels);
  const [allYearLevels, setAllYearLevels] = useState(activity.allYearLevels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleYearLevel(level: string) {
    setYearLevels(levels => levels.includes(level) ? levels.filter(l => l !== level) : [...levels, level]);
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Enter an activity name."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError("Select at least one eligible year level, or choose all year levels."); return; }
    if ((date || startTime || endTime) && (!date || !startTime)) { setError("Enter at least the date and From time together."); return; }
    const dateTimeIso = date && startTime ? new Date(`${date}T${startTime}`).toISOString() : null;
    const endTimeIso = date && endTime ? new Date(`${date}T${endTime}`).toISOString() : null;

    setBusy(true);
    const result = activityType === "sdp"
      ? await updateSDPActivity(activity.id, { name: name.trim(), venue: venue.trim(), dateTime: dateTimeIso, endTime: endTimeIso, yearLevels, allYearLevels })
      : await updateFormationActivity(activity.id, {
          name: name.trim(), shortDescription: (activity as FormationActivity).shortDescription ?? "",
          venue: venue.trim(), dateTime: dateTimeIso ?? "", endTime: endTimeIso,
          yearLevels, allYearLevels, attendanceEnabled: (activity as FormationActivity).attendanceEnabled ?? false,
        });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">Edit Activity</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Activity Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Venue</label>
              <input value={venue} onChange={e => setVenue(e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">From</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">To</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
          </div>

          <fieldset className="border-t border-[#f0f3f8] pt-3">
            <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity for scholars with year level</legend>
            <div className="grid grid-cols-2 gap-2">
              {FORMATION_YEAR_LEVELS.map(level => <label key={level} className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={yearLevels.includes(level)} disabled={allYearLevels} onChange={() => toggleYearLevel(level)} className="h-4 w-4 accent-[#062444]" />{level}</label>)}
              <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold text-[#062444]"><input type="checkbox" checked={allYearLevels} onChange={e => setAllYearLevels(e.target.checked)} className="h-4 w-4 accent-[#062444]" />All year levels</label>
            </div>
          </fieldset>

          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSave()} disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            <Check size={15} />{busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
