import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { fetchMonitors, addMonitor, removeMonitor, fetchAllStaff, type ActivityType, type ActivityMonitor } from "../activityMonitorsApi";

/**
 * "Monitors" — staff explicitly assigned (beyond the activity's own
 * creator, who is always an implicit monitor via is_activity_monitor())
 * to edit this specific activity and scan its attendance. Shown inside
 * the full SDPMonitoringTab/FormationActivitiesTab edit views, which only
 * a tag-holder or the creator can already reach — matches the "creator OR
 * tag-holder manages the monitor list" RLS in
 * supabase_migration_activity_monitor_helpers_and_policies.sql.
 */
export function MonitorsSection({ activityType, activityId }: { activityType: ActivityType; activityId: string }) {
  const [monitors, setMonitors] = useState<ActivityMonitor[]>([]);
  const [staffOptions, setStaffOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const [m, staff] = await Promise.all([fetchMonitors(activityType, activityId), fetchAllStaff()]);
    setMonitors(m);
    setStaffOptions(staff);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activityType, activityId]);

  async function handleAdd() {
    if (!selectedStaffId) return;
    setError("");
    setBusy(true);
    const result = await addMonitor(activityType, activityId, selectedStaffId);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to add monitor."); return; }
    setSelectedStaffId("");
    void load();
  }

  async function handleRemove(monitorId: string) {
    setBusy(true);
    const result = await removeMonitor(monitorId);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to remove monitor."); return; }
    void load();
  }

  const availableStaff = staffOptions.filter(s => !monitors.some(m => m.staffId === s.id));

  return (
    <div className="border-t border-[#f0f3f8] pt-3">
      <p className="mb-1.5 text-[11px] font-semibold text-slate-400 uppercase">Monitors</p>
      <p className="mb-2 text-[11.5px] text-slate-400">Staff who can edit this activity and scan its attendance, beyond its creator.</p>
      {loading ? (
        <p className="text-[12px] text-slate-400">Loading…</p>
      ) : (
        <div className="mb-2 space-y-1.5">
          {monitors.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No additional monitors assigned yet.</p>
          ) : (
            monitors.map(m => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-[#f8fafd] px-3 py-1.5">
                <span className="text-[12.5px] font-semibold text-[#062444]">{m.staffName || m.staffId}</span>
                <button type="button" onClick={() => void handleRemove(m.id)} disabled={busy} className="text-slate-400 hover:text-red-600 disabled:opacity-50"><X size={14} /></button>
              </div>
            ))
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)}
          className="flex-1 rounded-lg border border-[#062444]/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
          <option value="">Add a staff member…</option>
          {availableStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" onClick={() => void handleAdd()} disabled={busy || !selectedStaffId}
          className="flex items-center gap-1 rounded-lg bg-[#062444] px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
          <UserPlus size={13} /> Add
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
