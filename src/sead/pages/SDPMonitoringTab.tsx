import { useEffect, useState } from "react";
import { Lightbulb, X, ClipboardList, Plus, Search, CheckCircle2, XCircle, UserCheck, Trash2, QrCode, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import {
  fetchAllSDPActivities, updateSDPActivity, deleteSDPActivity, createApprovedActivity,
  fetchAttendanceForActivity, creditAttendance, removeAttendance,
  fetchAllScholarsSDPChecklist,
  fetchAttendanceSession, enableAttendanceForActivity, addAttendanceVouchers, fetchAttendanceRoster,
  type SDPActivity, type SDPStatus, type SDPCategory, type AttendanceEntry, type ScholarSDPChecklist,
  type AttendanceType, type AttendanceSession, type AttendanceCode, type AttendanceRosterEntry,
} from "../sdpMonitorApi";
import { SDP_CATEGORIES } from "@/scholar/sdpApi";
import { SDPHistoryModal } from "../components/SDPHistoryModal";
import { ListPagination } from "@/app/components/PaginatedList";

const STATUS_OPTIONS: SDPStatus[] = ["pending", "approved", "ongoing", "finished", "canceled", "rescheduled"];

const statusColors: Record<SDPStatus, string> = {
  finished: "bg-green-500", ongoing: "bg-blue-500", approved: "bg-[#F3BC00] text-[#062444]",
  pending: "bg-orange-400", canceled: "bg-red-500", rescheduled: "bg-purple-500",
};

function categoryLabel(category: SDPCategory | null): string {
  return SDP_CATEGORIES.find(c => c.key === category)?.label ?? "No category set";
}

function StatusBadge({ status }: { status: SDPStatus }) {
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold text-white ${statusColors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function CategorySelect({ value, onChange }: { value: SDPCategory | null; onChange: (v: SDPCategory) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SDP_CATEGORIES.map(c => (
        <button key={c.key} type="button" onClick={() => onChange(c.key)}
          className={`px-3 py-1.5 rounded-lg border text-[12px] font-bold transition-all ${
            value === c.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"
          }`}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function NewActivityModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SDPCategory | null>(null);
  const [organization, setOrganization] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [attendanceEnabled, setAttendanceEnabled] = useState(false);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("time_in_time_out");
  const [attendanceCount, setAttendanceCount] = useState("");
  const [voucherHours, setVoucherHours] = useState(1);

  async function handleCreate() {
    if (!name.trim()) { setError("Enter an activity name."); return; }
    if (!category) { setError("Choose which SDP category this activity counts toward."); return; }
    const count = Number(attendanceCount);
    if (attendanceEnabled && (!attendanceCount.trim() || count < 1)) {
      setError("Enter the expected number of participants.");
      return;
    }
    setBusy(true);
    const result = await createApprovedActivity({ name: name.trim(), category, organization: organization.trim(), dateTime, venue: venue.trim(), nature: [] });
    if (!result.ok || !result.id) { setBusy(false); setError(result.error || "Failed to create."); return; }

    if (attendanceEnabled) {
      const attResult = await enableAttendanceForActivity(result.id, attendanceType, count, voucherHours);
      setBusy(false);
      if (!attResult.ok) { setError(`Activity created, but attendance setup failed: ${attResult.error}`); return; }
    } else {
      setBusy(false);
    }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">New Approved Activity</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-[12.5px] text-slate-500 mb-1">Open to all scholars immediately, starting as "Approved" — no scholar proposal needed.</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Activity name"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">SDP Category</label>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
          <input value={organization} onChange={e => setOrganization(e.target.value)} placeholder="Organization"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input value={venue} onChange={e => setVenue(e.target.value)} placeholder="Venue"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <div className="border-t border-[#f0f3f8] pt-3">
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#062444] cursor-pointer">
              <input type="checkbox" checked={attendanceEnabled} onChange={e => setAttendanceEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#062444]" />
              <QrCode size={14} /> Include attendance monitoring
            </label>

            {attendanceEnabled && (
              <div className="mt-3 space-y-2.5 pl-1">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAttendanceType("time_in_time_out")}
                    className={`flex-1 px-2.5 py-2 rounded-lg border text-[11.5px] font-bold ${attendanceType === "time_in_time_out" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                    Time-in / Time-out
                  </button>
                  <button type="button" onClick={() => setAttendanceType("voucher")}
                    className={`flex-1 px-2.5 py-2 rounded-lg border text-[11.5px] font-bold ${attendanceType === "voucher" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                    Voucher (hourly)
                  </button>
                </div>
                <div>
                  <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">
                    Number of participants
                  </label>
                  <input type="number" min={1} value={attendanceCount} onChange={e => setAttendanceCount(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                </div>
                {attendanceType === "voucher" && (
                  <div>
                    <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Hour equivalent per voucher</label>
                    <select value={voucherHours} onChange={e => setVoucherHours(Number(e.target.value))} className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]">
                      {[1, 2, 4, 8].map(hours => <option key={hours} value={hours}>{hours} hour{hours > 1 ? "s" : ""}</option>)}
                    </select>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">
                  {attendanceType === "time_in_time_out"
                    ? "Generates a time-in code and a time-out code for each expected attendee. A scholar counts as present once they've redeemed one of each."
                    : "Generates one voucher QR/code for each participant. Each redeemed voucher credits the selected number of hours."}
                </p>
              </div>
            )}
          </div>

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
    setBusy(true);
    const result = await creditAttendance(activity.id, newScholarId.trim(), newDate);
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
      <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5"><UserCheck size={13} /> Attendance</p>
      <p className="text-[11px] text-slate-400 mb-3">Crediting a scholar here marks "{categoryLabel(activity.category)}" complete for them.</p>

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
                <span className="text-slate-400">{a.attendedDate ? new Date(a.attendedDate).toLocaleDateString() : "—"}</span>
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

function QRAttendanceSection({ activity }: { activity: SDPActivity }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [codes, setCodes] = useState<AttendanceCode[]>([]);
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [showCodes, setShowCodes] = useState(false);

  const [enabling, setEnabling] = useState(false);
  const [type, setType] = useState<AttendanceType>("time_in_time_out");
  const [count, setCount] = useState("");
  const [voucherHours, setVoucherHours] = useState(1);
  const [extraVoucherCount, setExtraVoucherCount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  async function load() {
    setLoading(true);
    const result = await fetchAttendanceSession(activity.id);
    if (result) {
      setSession(result.session);
      setCodes(result.codes);
      setRoster(await fetchAttendanceRoster(result.session.id));
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activity.id]);

  async function handleEnable() {
    const n = Number(count);
    if (!count.trim() || n < 1) { setError("Enter the expected number of participants."); return; }
    setBusy(true);
    const result = await enableAttendanceForActivity(activity.id, type, n, voucherHours);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to enable attendance."); return; }
    setEnabling(false);
    load();
  }

  async function handleAddVouchers() {
    const n = Number(extraVoucherCount);
    if (!extraVoucherCount.trim() || n < 1 || !session) { setError("Enter how many additional vouchers to generate."); return; }
    setBusy(true);
    const result = await addAttendanceVouchers(session.id, n);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to generate additional vouchers."); return; }
    setExtraVoucherCount("");
    load();
  }

  function downloadCodesCSV() {
    const lines = ["kind,code"];
    for (const c of codes) lines.push(`${c.kind},${c.code}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${activity.name.replace(/[^a-z0-9]+/gi, "_")}_attendance_codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadCodesPDF() {
    if (!codes.length || exportingPdf) return;
    setExportingPdf(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const margin = 8;
      const columns = 4;
      const rows = 5;
      const gap = 2;
      const cellWidth = (210 - margin * 2 - gap * (columns - 1)) / columns;
      const cellHeight = (297 - margin * 2 - gap * (rows - 1)) / rows;

      for (let index = 0; index < codes.length; index++) {
        if (index > 0 && index % (columns * rows) === 0) pdf.addPage();
        const position = index % (columns * rows);
        const column = position % columns;
        const row = Math.floor(position / columns);
        const x = margin + column * (cellWidth + gap);
        const y = margin + row * (cellHeight + gap);
        const code = codes[index];
        const qrDataUrl = await QRCode.toDataURL(code.code, { errorCorrectionLevel: "M", margin: 1, width: 240 });

        pdf.setDrawColor(148, 163, 184);
        pdf.rect(x, y, cellWidth, cellHeight);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(6, 36, 68);
        const activityLines = pdf.splitTextToSize(activity.name, cellWidth - 5).slice(0, 2);
        pdf.text(activityLines, x + cellWidth / 2, y + 4, { align: "center", baseline: "top" });
        const qrSize = 31;
        pdf.addImage(qrDataUrl, "PNG", x + (cellWidth - qrSize) / 2, y + 13, qrSize, qrSize);
        pdf.setFont("courier", "bold");
        pdf.setFontSize(9);
        pdf.text(code.code, x + cellWidth / 2, y + 47, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(code.kind.replace("_", " ").toUpperCase(), x + cellWidth / 2, y + 51, { align: "center" });
      }
      pdf.save(`${activity.name.replace(/[^a-z0-9]+/gi, "_")}_attendance_qr_codes.pdf`);
    } catch {
      setError("Could not create the QR code PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) return <div className="border-t border-[#f0f3f8] pt-4"><p className="text-[12.5px] text-slate-400">Loading attendance…</p></div>;

  if (!session) {
    return (
      <div className="border-t border-[#f0f3f8] pt-4">
        <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5"><QrCode size={13} /> QR / Code Attendance</p>
        {!enabling ? (
          <button onClick={() => setEnabling(true)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">
            + Enable attendance monitoring for this activity
          </button>
        ) : (
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <button type="button" onClick={() => setType("time_in_time_out")}
                className={`flex-1 px-2.5 py-2 rounded-lg border text-[11.5px] font-bold ${type === "time_in_time_out" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                Time-in / Time-out
              </button>
              <button type="button" onClick={() => setType("voucher")}
                className={`flex-1 px-2.5 py-2 rounded-lg border text-[11.5px] font-bold ${type === "voucher" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                Voucher (hourly)
              </button>
            </div>
            <input type="number" min={1} value={count} onChange={e => setCount(e.target.value)}
              placeholder="Number of participants, e.g. 50"
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            {type === "voucher" && (
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Hour equivalent per voucher</label>
                <select value={voucherHours} onChange={e => setVoucherHours(Number(e.target.value))} className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]">
                  {[1, 2, 4, 8].map(hours => <option key={hours} value={hours}>{hours} hour{hours > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            )}
            {error && <p className="text-[12px] text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleEnable} disabled={busy}
                className="bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-4 py-2 disabled:opacity-50">
                {busy ? "Generating…" : "Generate Codes"}
              </button>
              <button onClick={() => setEnabling(false)} className="text-[12.5px] font-semibold text-slate-500">Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const presentCount = roster.filter(r => r.status === "present").length;

  return (
    <div className="border-t border-[#f0f3f8] pt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-slate-500 uppercase flex items-center gap-1.5"><QrCode size={13} /> QR / Code Attendance</p>
        <span className="text-[11px] text-slate-400">
          {session.type === "time_in_time_out" ? `${session.expectedAttendees} expected` : `${session.expectedAttendees} vouchers - ${session.voucherHours}h each`}
        </span>
      </div>

      <p className="text-[12.5px] text-[#062444] font-semibold mb-2">{presentCount} of {roster.length || "0"} scholars present</p>

      {session.type === "voucher" && (
        <div className="mb-3 rounded-lg bg-[#f8fafd] p-3">
          <p className="text-[11px] font-semibold text-slate-500 mb-2">More participants than expected?</p>
          <div className="flex items-center gap-2">
            <input type="number" min={1} value={extraVoucherCount} onChange={e => setExtraVoucherCount(e.target.value)} placeholder="Additional participants" className="w-44 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
            <button onClick={handleAddVouchers} disabled={busy} className="bg-[#062444] text-white text-[12px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">Add vouchers</button>
          </div>
        </div>
      )}

      {roster.length > 0 && (
        <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
          {roster.map(r => (
            <div key={r.scholarIdNumber} className="flex items-center justify-between bg-[#f8fafd] rounded-lg px-3 py-1.5 text-[12px]">
              <span className="text-[#062444] font-medium">{r.scholarName} <span className="text-slate-400">({r.scholarIdNumber})</span></span>
              {session.type === "time_in_time_out" ? (
                <span className={r.status === "present" ? "text-green-600 font-semibold" : "text-orange-500 font-semibold"}>
                  {r.status === "present" ? "Present" : r.timeInAt ? "Timed in only" : "Incomplete"}
                </span>
              ) : (
                <span className="text-[#062444] font-semibold">{r.hoursEarned}h</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => setShowCodes(s => !s)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">
          {showCodes ? "Hide codes" : `View codes (${codes.length})`}
        </button>
        <button onClick={downloadCodesCSV} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline">
          <Download size={13} /> Export CSV
        </button>
        <button onClick={downloadCodesPDF} disabled={!codes.length || exportingPdf} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50">
          <Download size={13} /> {exportingPdf ? "Creating PDF..." : "Download QR PDF"}
        </button>
      </div>

      {showCodes && (
        <div className="mt-3 grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
          {codes.map(c => (
            <div key={c.id} className={`border rounded-lg p-2 text-center ${c.redeemedByScholarId ? "border-green-300 bg-green-50" : "border-[#e6ecf5]"}`}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(c.code)}`} alt={c.code} className="mx-auto mb-1" width={80} height={80} />
              <p className="text-[11px] font-mono font-bold text-[#062444]">{c.code}</p>
              <p className="text-[9.5px] text-slate-400 uppercase">{c.kind.replace("_", " ")}</p>
              {c.redeemedByScholarId && <p className="text-[9px] text-green-600 font-semibold mt-0.5">Redeemed</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailModal({ activity, onClose, onChanged }: { activity: SDPActivity; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"details" | "attendance">("details");
  const [status, setStatus] = useState<SDPStatus>(activity.status);
  const [projectHead, setProjectHead] = useState(activity.projectHead);
  const [headCluster, setHeadCluster] = useState(activity.headCluster);
  const [category, setCategory] = useState<SDPCategory | null>(activity.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    if (!category) { setError("Choose which SDP category this activity counts toward."); return; }
    setBusy(true);
    const result = await updateSDPActivity(activity.id, { status, projectHead, headCluster, category });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onChanged();
    onClose();
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${activity.name}" permanently? This also removes its attendance session, codes, and records. This cannot be undone.`)) return;
    setError("");
    setBusy(true);
    const result = await deleteSDPActivity(activity.id);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to delete the activity."); return; }
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

        <div className="px-6 pt-4">
          <div className="flex gap-1 border-b border-[#e6ecf5]">
            <button type="button" onClick={() => setTab("details")} className={`px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "details" ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-400 hover:text-slate-600"}`}>Activity Details</button>
            <button type="button" onClick={() => setTab("attendance")} className={`px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "attendance" ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-400 hover:text-slate-600"}`}>Attendance</button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {tab === "details" && <>
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
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">SDP Category</label>
              <CategorySelect value={category} onChange={setCategory} />
            </div>
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
          </>}
          {tab === "attendance" && <>
            <p className="text-[12.5px] text-slate-500">Review the staff-credited and QR/code attendance lists for this activity.</p>
            <AttendanceSection activity={activity} />
            <QRAttendanceSection activity={activity} />
          </>}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 pb-5">
          {tab === "details" ? <button onClick={handleDelete} disabled={busy} className="text-[13px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">Delete Activity</button> : <span />}
          <div className="flex justify-end gap-3">
          <button onClick={onClose} className="text-[13px] font-semibold text-slate-500">Cancel</button>
          {tab === "details" && <button onClick={handleSave} disabled={busy}
            className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50">
            {busy ? "Saving…" : "Save Changes"}
          </button>}
          </div>
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

  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

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
            {paged.map(a => (
              <button key={a.id} onClick={() => setSelected(a)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#f8fafd] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#062444] truncate">{a.name}</p>
                  <p className="text-[12px] text-slate-400 truncate">
                    {a.organization || "—"} {a.submittedByScholarId ? `· Scholar ID ${a.submittedByScholarId}` : "· Staff-created"} · {categoryLabel(a.category)}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </button>
            ))}
          </div>
        )}
      </div>
      <ListPagination page={safePage} totalPages={totalPages} onPageChange={setPage} filteredCount={filtered.length} pageSize={pageSize} />

      {selected && <DetailModal activity={selected} onClose={() => setSelected(null)} onChanged={load} />}
      {showNew && <NewActivityModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}

function ChecklistBadge({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-green-700"><CheckCircle2 size={13} /> Complete</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-400"><XCircle size={13} /> Incomplete</span>
  );
}

function ChecklistSection() {
  const [scholars, setScholars] = useState<ScholarSDPChecklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewingScholar, setViewingScholar] = useState<ScholarSDPChecklist | null>(null);

  async function load() {
    setLoading(true);
    setScholars(await fetchAllScholarsSDPChecklist());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = scholars.filter(s => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.scholarIdNumber.toLowerCase().includes(q);
  });

  const [page, setPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [search]);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Each scholar's completion of the 3 required SDP categories, and their attended vs. available activities.</p>

      <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 max-w-sm mb-4">
        <Search size={15} className="text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
          className="w-full text-sm outline-none" />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-5 py-3">Scholar ID</th>
              <th className="px-5 py-3">Scholar Name</th>
              <th className="px-5 py-3">Community Service</th>
              <th className="px-5 py-3">Community Volunteerism</th>
              <th className="px-5 py-3">Formation Program</th>
              <th className="px-5 py-3 text-right">SDP History</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No scholars found.</td></tr>
            ) : (
              paged.map(s => (
                <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{s.scholarIdNumber}</td>
                  <td className="px-5 py-3 font-medium text-[#062444] whitespace-nowrap">{s.name}</td>
                  <td className="px-5 py-3"><ChecklistBadge complete={s.communityService} /></td>
                  <td className="px-5 py-3"><ChecklistBadge complete={s.communityVolunteerism} /></td>
                  <td className="px-5 py-3"><ChecklistBadge complete={s.formationProgram} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setViewingScholar(s)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">View</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ListPagination page={safePage} totalPages={totalPages} onPageChange={setPage} filteredCount={filtered.length} pageSize={pageSize} />

      {viewingScholar && (
        <SDPHistoryModal scholarIdNumber={viewingScholar.scholarIdNumber} scholarName={viewingScholar.name} onClose={() => setViewingScholar(null)} />
      )}
    </div>
  );
}

/**
 * Monitoring tab for tagged CEDO staff (sdp_monitoring tag — assigned via
 * it.admin1's Staff Accounts page): SDP Activities (review/approve
 * proposals, credit attendance) and SDP Checklist (each scholar's
 * completion of the 3 required categories, and their attended/available
 * history) — SDP participation feeds into scholarship renewal, so this is
 * where that gets tracked.
 */
export function SDPMonitoringTab() {
  const [section, setSection] = useState<"activities" | "checklist">("activities");

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2"><Lightbulb size={20} className="text-[#F3BC00]" /> SDP Monitoring</h1>
      <div className="flex gap-1 border-b border-border mb-5">
        {([
          { key: "activities" as const, label: "SDP Activities" },
          { key: "checklist" as const, label: "SDP Checklist" },
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
      {section === "checklist" && <ChecklistSection />}
    </div>
  );
}
