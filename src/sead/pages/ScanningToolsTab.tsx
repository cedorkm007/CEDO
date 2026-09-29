import { useEffect, useState } from "react";
import { QrCode, Pencil, ClipboardList } from "lucide-react";
import { fetchMyMonitoredActivities, fetchActivityForEdit, type MonitoredActivity, type SDPActivity, type FormationActivity } from "../activityMonitorsApi";
import { pubmatUrl } from "../pubmatApi";
import { DefaultPubmat } from "@/scholar/components/dashboard/activityCardKit";
import { MonitorAttendanceScanner } from "../components/MonitorAttendanceScanner";
import { LightweightActivityEditModal } from "../components/LightweightActivityEditModal";

/** One ID-card-style tile per monitored activity — pubmat as the icon (default seal when none uploaded), tap to scan, Edit icon to open the lightweight edit modal. Mirrors the bordered tile-grid style already used for QR codes in SDPMonitoringTab.tsx, swapping the QR image for the activity's own pubmat. */
function ActivityTile({ activity, onScan, onEdit }: { activity: MonitoredActivity; onScan: () => void; onEdit: () => void }) {
  const pubmat = pubmatUrl(activity.pubmatPath);
  return (
    <div className="relative rounded-xl border border-[#e6ecf5] bg-white p-3 text-center hover:shadow-md transition-shadow">
      <button type="button" onClick={onEdit} aria-label="Edit activity"
        className="absolute top-2 right-2 rounded-lg bg-white/90 p-1.5 text-slate-400 shadow-sm hover:text-[#062444]">
        <Pencil size={13} />
      </button>
      <button type="button" onClick={onScan} className="w-full">
        <img src={pubmat ?? DefaultPubmat} alt="" className="mx-auto mb-2 h-20 w-20 rounded-lg object-cover" />
        <p className="text-[12.5px] font-bold leading-snug text-[#062444] line-clamp-2">{activity.name}</p>
        <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#0088cc]">{activity.activityType === "sdp" ? "SDP" : "Formation"}</p>
      </button>
    </div>
  );
}

export function ScanningToolsTab() {
  const [activities, setActivities] = useState<MonitoredActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<MonitoredActivity | null>(null);
  const [editing, setEditing] = useState<{ activityType: MonitoredActivity["activityType"]; activity: SDPActivity | FormationActivity } | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  async function load() {
    setLoading(true);
    setActivities(await fetchMyMonitoredActivities());
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function handleEdit(activity: MonitoredActivity) {
    setEditLoading(true);
    const full = await fetchActivityForEdit(activity.activityType, activity.id);
    setEditLoading(false);
    if (full) setEditing({ activityType: activity.activityType, activity: full });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#062444]">Scanning Tools</h1>
        <p className="text-sm text-slate-500 mt-0.5">Activities you monitor — tap one to scan attendance, or use the pencil to edit it.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
      ) : activities.length === 0 ? (
        <div className="text-center py-14 text-slate-400 bg-[#f7f9fc] rounded-2xl">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">You aren't monitoring any activities yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {activities.map(a => (
            <ActivityTile key={`${a.activityType}-${a.id}`} activity={a}
              onScan={() => setScanning(a)} onEdit={() => void handleEdit(a)} />
          ))}
        </div>
      )}

      {editLoading && (
        <div className="fixed inset-0 z-[100] bg-black/20 flex items-center justify-center">
          <QrCode className="animate-pulse text-white" size={32} />
        </div>
      )}

      {scanning && (
        <MonitorAttendanceScanner
          activityType={scanning.activityType} activityId={scanning.id} activityName={scanning.name}
          onClose={() => setScanning(null)}
        />
      )}

      {editing && (
        <LightweightActivityEditModal
          activityType={editing.activityType} activity={editing.activity}
          onClose={() => setEditing(null)} onSaved={() => void load()}
        />
      )}
    </div>
  );
}
