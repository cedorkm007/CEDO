import { useEffect, useState } from "react";
import { Lightbulb, X, ClipboardList, Plus, Search } from "lucide-react";
import { fetchAllSDPActivities, updateSDPStatus, createApprovedActivity, type SDPActivity, type SDPStatus } from "../sdpMonitorApi";

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

function DetailModal({ activity, onClose, onChanged }: { activity: SDPActivity; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<SDPStatus>(activity.status);
  const [projectHead, setProjectHead] = useState(activity.projectHead);
  const [headCluster, setHeadCluster] = useState(activity.headCluster);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setBusy(true);
    const result = await updateSDPStatus(activity.id, status, { projectHead, headCluster });
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

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
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
            <div className="grid grid-cols-2 gap-3">
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
            </div>
          </div>

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

/**
 * Monitoring tab for tagged CEDO staff (sdp_monitoring tag — assigned via
 * it.admin1's Staff Accounts page) to review and approve scholars' SDP
 * activity proposals. SDP participation feeds into scholarship renewal, so
 * this is where that gets tracked.
 */
export function SDPMonitoringTab() {
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
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><Lightbulb size={20} className="text-[#F3BC00]" /> SDP Monitoring</h1>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
          <Plus size={15} /> New Approved Activity
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Review scholars' SDP activity proposals and manage staff-created activities. {pendingCount > 0 && <span className="font-semibold text-orange-500">{pendingCount} pending review.</span>}
      </p>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
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
                    {a.organization || "—"} {a.submittedByScholarId ? `· Scholar ID ${a.submittedByScholarId}` : "· Staff-created"}
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
