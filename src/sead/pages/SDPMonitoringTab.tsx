import { useEffect, useState } from "react";
import { Lightbulb, X, ClipboardList, Plus, Search, Award, UserCheck, Trash2 } from "lucide-react";
import {
  fetchAllSDPActivities, updateSDPActivity, createApprovedActivity,
  fetchAttendanceForActivity, creditAttendance, removeAttendance,
  fetchAllScholarsSDPSummary,
  type SDPActivity, type SDPStatus, type AttendanceEntry, type ScholarSDPSummary,
} from "../sdpMonitorApi";
import { SDPHistoryModal } from "../components/SDPHistoryModal";

const STATUS_OPTIONS: SDPStatus[] = ["pending", "approved", "ongoing", "finished", "canceled", "rescheduled"];

const statusColors: Record<SDPStatus, string> = {
  finished: "bg-green-500", ongoing: "bg-blue-500", approved: "bg-[#F3BC00] text-[#062444]",
  pending: "bg-orange-400", canceled: "bg-red-500", rescheduled: "bg-purple-500",
};

function StatusBadge({ status }: { status: SDPStatus }) {
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold text-white ${statusColors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function NewActivityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) { setError("Enter an activity name."); return; }
    setBusy(true);
    const result = await createApprovedActivity({ name: name.trim(), organization: organization.trim(), dateTime, venue: venue.trim(), nature: [] });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to create."); return; }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">New Approved Activity</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-[12.5px] text-slate-500 mb-1">Open to all scholars immediately, starting as "Approved" — no scholar proposal needed.</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Activity name"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input value={organization} onChange={e => setOrganization(e.target.value)} placeholder="Organization"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input value={venue} onChange={e => setVenue(e.target.value)} placeholder="Venue"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={handleCreate} disabled={busy}
            className="w-full bg-[#062444] text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-50">
            {busy ? "Creating…" : "Create Activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttendanceSection({ activity }: { activity: SDPActivity }) {
  const [attendees, setAttendees] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newScholarId, setNewScholarId] = useState("");
  const [newPoints, setNewPoints] = useState(String(activity.sdpPoints || 0));
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setAttendees(await fetchAttendanceForActivity(activity.id));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activity.id]);

  async function handleAdd() {
    setError("");
    if (!newScholarId.trim()) { setError("Enter a Scholar ID."); return; }
    const points = Number(newPoints);
    if (!Number.isFinite(points) || points < 0) { setError("Points must be a non-negative number."); return; }
    setBusy(true);
    const result = await creditAttendance(activity.id, newScholarId.trim(), points, newDate);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to credit — check the Scholar ID exists."); return; }
    setNewScholarId("");
    load();
  }

  async function handleRemove(id: string) {
    await removeAttendance(id);
    load();
  }

  return (
    <div className="border-t border-[#f0f3f8] pt-4">
      <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5"><UserCheck size={13} /> Attendance & Points Credited</p>

      {loading ? (
        <p className="text-[12.5px] text-slate-400">Loading…</p>
      ) : attendees.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 italic mb-3">No scholars credited yet.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {attendees.map(a => (
            <div key={a.id} className="flex items-center justify-between bg-[#f8fafd] rounded-lg px-3 py-2 text-[12.5px]">
              <span className="text-[#062444] font-medium">{a.scholarName} <span className="text-slate-400">({a.scholarIdNumber})</span></span>
              <span className="flex items-center gap-3">
                <span className="font-bold text-[#062444]">{a.pointsCredited} pt{a.pointsCredited === 1 ? "" : "s"}</span>
                <button onClick={() => handleRemove(a.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Scholar ID</label>
          <input value={newScholarId} onChange={e => setNewScholarId(e.target.value)} placeholder="20180000"
            className="w-28 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
        </div>
        <div>
          <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Points</label>
          <input type="number" min={0} value={newPoints} onChange={e => setNewPoints(e.target.value)}
            className="w-20 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
        </div>
        <div>
          <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Date</label>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
            className="border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
        </div>
        <button onClick={handleAdd} disabled={busy}
          className="bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">
          {busy ? "…" : "Credit"}
        </button>
      </div>
      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function DetailModal({ activity, onClose, onChanged }: { activity: SDPActivity; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<SDPStatus>(activity.status);
  const [projectHead, setProjectHead] = useState(activity.projectHead);
  const [headCluster, setHeadCluster] = useState(activity.headCluster);
  const [sdpPoints, setSdpPoints] = useState(String(activity.sdpPoints || 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    const points = Number(sdpPoints);
    if (!Number.isFinite(points) || points < 0) { setError("SDP points must be a non-negative number."); return; }
    setBusy(true);
    const result = await updateSDPActivity(activity.id, { status, projectHead, headCluster, sdpPoints: points });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onChanged();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-5 rounded-t-2xl">
          <div>
            <p className="text-[#F3BC00] text-[11px] font-bold uppercase tracking-wide mb-1">SDP Activity</p>
            <h3 className="text-white font-bold text-lg leading-tight">{activity.name}</h3>
            <p className="text-white/50 text-[11px] mt-1">
              {activity.submittedByScholarId ? `Submitted by Scholar ID ${activity.submittedByScholarId}` : "Staff-created (open to all)"}
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white shrink-0"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <Field label="Organization" value={activity.organization} />
            <Field label="Nature" value={activity.nature.join(", ")} />
            <Field label="Date / Time" value={activity.dateTime ? new Date(activity.dateTime).toLocaleString() : "—"} />
            <Field label="Venue" value={activity.venue} />
            <Field label="Budget" value={activity.budgetaryRequirement ? `₱${activity.budgetaryRequirement}` : "—"} />
            <Field label="Source of Fund" value={activity.sourceOfFund.join(", ") || "—"} />
          </div>

          {activity.rationale && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Rationale</p>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{activity.rationale}</p>
            </div>
          )}

          {activity.objectives.length > 0 && activity.objectives.some(o => o.objective) && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase mb-1">Objectives</p>
              <ul className="space-y-1">
                {activity.objectives.filter(o => o.objective).map((o, i) => (
                  <li key={i} className="text-[13px] text-slate-700">• {o.objective} <span className="text-slate-400">— {o.deliverable}</span></li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-[#f0f3f8] pt-4 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map(s => (
                  <button key={s} onClick={() => setStatus(s)}
                    className={`px-3 py-1.5 rounded-lg border text-[12px] font-bold transition-all ${
                      status === s ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"
                    }`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Project Head</label>
                <input value={projectHead} onChange={e => setProjectHead(e.target.value)}
                  className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Head, Cluster</label>
                <input value={headCluster} onChange={e => setHeadCluster(e.target.value)}
                  className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">SDP Points</label>
                <input type="number" min={0} value={sdpPoints} onChange={e => setSdpPoints(e.target.value)}
                  className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 italic">Points here are what a scholar gets credited when marked as attending below.</p>
          </div>

          <AttendanceSection activity={activity} />

          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="text-[13px] font-semibold text-slate-500">Cancel</button>
          <button onClick={handleSave} disabled={busy}
            className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50">
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold text-slate-400 uppercase">{label}</p>
      <p className="text-[13px] text-[#062444] font-medium">{value || "—"}</p>
    </div>
  );
}

function ActivitiesSection() {
  const [activities, setActivities] = useState<SDPActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<SDPStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SDPActivity | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    setActivities(await fetchAllSDPActivities());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = activities.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search.trim() && !a.name.toLowerCase().includes(search.trim().toLowerCase()) && !a.organization.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const pendingCount = activities.filter(a => a.status === "pending").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-muted-foreground">
          Review scholars' SDP activity proposals and manage staff-created activities. {pendingCount > 0 && <span className="font-semibold text-orange-500">{pendingCount} pending review.</span>}
        </p>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5 shrink-0 ml-4">
          <Plus size={15} /> New Approved Activity
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 my-4 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or organization…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#e6ecf5] rounded-lg p-1 flex-wrap">
          {(["all", ...STATUS_OPTIONS] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-[12px] font-semibold px-2.5 py-1.5 rounded-md ${statusFilter === s ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f8fafd]"}`}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        {loading ? (
          <p className="text-center text-slate-400 py-10 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No activities match this filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f3f8]">
            {filtered.map(a => (
              <button key={a.id} onClick={() => setSelected(a)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#f8fafd] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#062444] truncate">{a.name}</p>
                  <p className="text-[12px] text-slate-400 truncate">
                    {a.organization || "—"} {a.submittedByScholarId ? `· Scholar ID ${a.submittedByScholarId}` : "· Staff-created"} · {a.sdpPoints} pt{a.sdpPoints === 1 ? "" : "s"}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <DetailModal activity={selected} onClose={() => setSelected(null)} onChanged={load} />}
      {showNew && <NewActivityModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}

function PointsSection() {
  const [scholars, setScholars] = useState<ScholarSDPSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewingScholar, setViewingScholar] = useState<ScholarSDPSummary | null>(null);

  async function load() {
    setLoading(true);
    setScholars(await fetchAllScholarsSDPSummary());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = scholars.filter(s => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.scholarIdNumber.toLowerCase().includes(q);
  });

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Running SDP point totals per scholar, and their attended vs. available activities.</p>

      <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 max-w-sm mb-4">
        <Search size={15} className="text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
          className="w-full text-sm outline-none" />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-5 py-3">Scholar ID</th>
              <th className="px-5 py-3">Scholar Name</th>
              <th className="px-5 py-3">SDP Points</th>
              <th className="px-5 py-3 text-right">SDP History</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No scholars found.</td></tr>
            ) : (
              filtered.map(s => (
                <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-5 py-3 text-slate-500">{s.scholarIdNumber}</td>
                  <td className="px-5 py-3 font-medium text-[#062444]">{s.name}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 font-bold text-[#062444]"><Award size={13} className="text-[#F3BC00]" /> {s.totalPoints}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setViewingScholar(s)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">View</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewingScholar && (
        <SDPHistoryModal scholarIdNumber={viewingScholar.scholarIdNumber} scholarName={viewingScholar.name} onClose={() => setViewingScholar(null)} />
      )}
    </div>
  );
}

/**
 * Monitoring tab for tagged CEDO staff (sdp_monitoring tag — assigned via
 * it.admin1's Staff Accounts page): SDP Activities (review/approve
 * proposals, credit attendance) and SDP Points (per-scholar totals and
 * attended/available history) — SDP participation feeds into scholarship
 * renewal, so this is where that gets tracked.
 */
export function SDPMonitoringTab() {
  const [section, setSection] = useState<"activities" | "points">("activities");

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2"><Lightbulb size={20} className="text-[#F3BC00]" /> SDP Monitoring</h1>
      <div className="flex gap-1 border-b border-border mb-5">
        {([
          { key: "activities" as const, label: "SDP Activities" },
          { key: "points" as const, label: "SDP Points" },
        ]).map(t => (
          <button key={t.key} onClick={() => setSection(t.key)}
            className={`px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              section === t.key ? "border-[#062444] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {section === "activities" && <ActivitiesSection />}
      {section === "points" && <PointsSection />}
    </div>
  );
}
