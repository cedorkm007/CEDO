import { useEffect, useState } from "react";
import { CalendarDays, Check, ClipboardList, Download, MapPin, Pencil, Plus, QrCode, RefreshCw, Trash2, Users, X } from "lucide-react";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { FORMATION_YEAR_LEVELS, type FormationActivity } from "@/scholar/formationActivitiesApi";
import { addFormationAttendanceCodes, createFormationActivity, deleteFormationActivity, enableFormationAttendance, fetchFormationActivities, fetchFormationAttendanceSession, updateFormationActivity } from "../formationActivitiesApi";
import { fetchAttendanceRoster, type AttendanceCode, type AttendanceRosterEntry, type AttendanceSession, type AttendanceType } from "../sdpMonitorApi";

function formatActivitySchedule(dateTime: string, endTime: string | null): string {
  const start = new Date(dateTime);
  if (!endTime) return start.toLocaleString();
  return `${start.toLocaleDateString()} · ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${new Date(endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function localDatePart(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimePart(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function FormationActivityModal({ activity, onClose, onCreated }: { activity: FormationActivity | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(activity?.name ?? "");
  const [shortDescription, setShortDescription] = useState(activity?.shortDescription ?? "");
  const [date, setDate] = useState(activity ? localDatePart(activity.dateTime) : "");
  const [startTime, setStartTime] = useState(activity ? localTimePart(activity.dateTime) : "");
  const [endTime, setEndTime] = useState(activity?.endTime ? localTimePart(activity.endTime) : "");
  const [venue, setVenue] = useState(activity?.venue ?? "");
  const [yearLevels, setYearLevels] = useState<string[]>(activity?.yearLevels ?? []);
  const [allYearLevels, setAllYearLevels] = useState(activity?.allYearLevels ?? false);
  const [attendanceEnabled, setAttendanceEnabled] = useState(activity?.attendanceEnabled ?? false);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("time_in_time_out");
  const [participantCount, setParticipantCount] = useState("");
  const [voucherHours, setVoucherHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleYearLevel(level: string) {
    setYearLevels(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
  }

  async function handleSubmit() {
    if (!name.trim() || !shortDescription.trim() || !date || !startTime || !endTime || !venue.trim()) { setError("Complete the activity name, description, date, From time, To time, and venue."); return; }
    const dateTime = `${date}T${startTime}`;
    const activityEndTime = `${date}T${endTime}`;
    if (new Date(activityEndTime).getTime() <= new Date(dateTime).getTime()) { setError("The To time must be later than the From time."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError("Select at least one eligible year level, or choose all year levels."); return; }
    if (!activity && attendanceEnabled && (!participantCount || Number(participantCount) < 1)) { setError("Enter the expected number of participants for attendance monitoring."); return; }
    setBusy(true);
    const input = { name: name.trim(), shortDescription: shortDescription.trim(), dateTime, endTime: activityEndTime, venue: venue.trim(), yearLevels, allYearLevels, attendanceEnabled };
    const result = activity ? await updateFormationActivity(activity.id, input) : await createFormationActivity(input);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save the activity."); return; }
    if (!activity && attendanceEnabled && "id" in result && typeof result.id === "string") {
      const attendance = await enableFormationAttendance(result.id, attendanceType, Number(participantCount), voucherHours);
      if (!attendance.ok) { setError(`Activity created, but attendance setup failed: ${attendance.error}`); return; }
    }
    onCreated(); onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="text-[15px] font-bold text-white">{activity ? "Edit Formation Activity" : "New Formation Activity"}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Name of activity" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <textarea value={shortDescription} onChange={event => setShortDescription(event.target.value)} placeholder="Short description" rows={3} className="w-full resize-none rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Activity date" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <div className="grid grid-cols-2 gap-3"><label className="text-[12px] font-semibold text-[#062444]">From<input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} aria-label="From time" className="mt-1 w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#0088cc]" /></label><label className="text-[12px] font-semibold text-[#062444]">To<input type="time" value={endTime} onChange={event => setEndTime(event.target.value)} aria-label="To time" className="mt-1 w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#0088cc]" /></label></div>
          <input value={venue} onChange={event => setVenue(event.target.value)} placeholder="Venue" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <fieldset className="border-t border-[#f0f3f8] pt-3">
            <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity for scholars with year level</legend>
            <div className="grid grid-cols-2 gap-2">
              {FORMATION_YEAR_LEVELS.map(level => <label key={level} className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={yearLevels.includes(level)} disabled={allYearLevels} onChange={() => toggleYearLevel(level)} className="h-4 w-4 accent-[#062444]" />{level}</label>)}
              <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold text-[#062444]"><input type="checkbox" checked={allYearLevels} onChange={event => setAllYearLevels(event.target.checked)} className="h-4 w-4 accent-[#062444]" />All year levels</label>
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2 border-t border-[#f0f3f8] pt-3 text-[12.5px] font-semibold text-[#062444]"><input type="checkbox" checked={attendanceEnabled} disabled={!!activity} onChange={event => setAttendanceEnabled(event.target.checked)} className="h-4 w-4 accent-[#062444]" /><QrCode size={14} /> Include attendance monitoring</label>
          {activity && <p className="text-[11px] text-slate-400">Attendance setup cannot be changed after creation.</p>}
          {attendanceEnabled && !activity && <div className="space-y-2.5 rounded-lg bg-[#f8fafd] p-3"><div className="flex gap-2"><button type="button" onClick={() => setAttendanceType("time_in_time_out")} className={`flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold ${attendanceType === "time_in_time_out" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>Time-in / Time-out</button><button type="button" onClick={() => setAttendanceType("voucher")} className={`flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold ${attendanceType === "voucher" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>Voucher</button></div><input type="number" min={1} value={participantCount} onChange={event => setParticipantCount(event.target.value)} placeholder="Expected participants" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />{attendanceType === "voucher" && <select value={voucherHours} onChange={event => setVoucherHours(Number(event.target.value))} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-sm outline-none">{[1, 2, 4, 8].map(hours => <option key={hours} value={hours}>{hours} hour{hours === 1 ? "" : "s"} per voucher</option>)}</select>}</div>}
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSubmit()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Check size={15} />{busy ? "Saving…" : activity ? "Save Changes" : "Create Activity"}</button>
        </div>
      </div>
    </div>
  );
}

function FormationAttendanceMonitoring({ activities }: { activities: FormationActivity[] }) {
  const monitoredActivities = activities.filter(activity => activity.attendanceEnabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [codes, setCodes] = useState<AttendanceCode[]>([]);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [expected, setExpected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [additionalCount, setAdditionalCount] = useState("");
  const [addingCodes, setAddingCodes] = useState(false);
  const [codeError, setCodeError] = useState("");
  const selected = monitoredActivities.find(activity => activity.id === selectedId) ?? null;

  async function loadAttendance(activityId: string) {
    setLoading(true);
    const attendance = await fetchFormationAttendanceSession(activityId);
    if (!attendance) { setSession(null); setRoster([]); setCodes([]); setExpected(null); setLoading(false); return; }
    setSession(attendance.session);
    setExpected(attendance.session.expectedAttendees);
    setCodes(attendance.codes);
    setRoster(await fetchAttendanceRoster(attendance.session.id));
    setLoading(false);
  }

  async function addCodes() {
    if (!session || !selected) return;
    const count = Number(additionalCount);
    if (!additionalCount.trim() || count < 1) { setCodeError("Enter the number of additional scholars."); return; }
    setAddingCodes(true); setCodeError("");
    const result = await addFormationAttendanceCodes(session.id, session.type, count);
    setAddingCodes(false);
    if (!result.ok) { setCodeError(result.error || "Could not generate additional codes."); return; }
    setAdditionalCount("");
    void loadAttendance(selected.id);
  }

  function downloadCodesCSV() {
    if (!selected) return;
    const lines = ["kind,code"];
    for (const code of codes) lines.push(`${code.kind},${code.code}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.name.replace(/[^a-z0-9]+/gi, "_")}_attendance_codes.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadCodesPDF(batchNumber?: number, batchCodes?: AttendanceCode[], unclaimedOnly = false) {
    if (!selected || exportingPdf) return;
    if (!batchCodes) {
      const choice = window.prompt(`Enter a batch number (1-${batches.length}) or U for all unclaimed QR codes.`);
      if (!choice) return;
      const normalized = choice.trim().toUpperCase();
      if (normalized === "U") return downloadCodesPDF(0, codes.filter(code => !code.redeemedByScholarId), true);
      const selectedBatch = batches.find(batch => batch.number === Number(normalized));
      if (!selectedBatch) { window.alert("That batch does not exist."); return; }
      return downloadCodesPDF(selectedBatch.number, selectedBatch.codes);
    }
    if (!batchCodes.length) { window.alert(unclaimedOnly ? "There are no unclaimed QR codes." : "This batch has no QR codes."); return; }
    setExportingPdf(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const margin = 8, columns = 4, rows = 5, gap = 2;
      const cellWidth = (210 - margin * 2 - gap * (columns - 1)) / columns;
      const cellHeight = (297 - margin * 2 - gap * (rows - 1)) / rows;
      for (let index = 0; index < batchCodes.length; index++) {
        if (index > 0 && index % (columns * rows) === 0) pdf.addPage();
        const position = index % (columns * rows);
        const x = margin + (position % columns) * (cellWidth + gap);
        const y = margin + Math.floor(position / columns) * (cellHeight + gap);
        const code = batchCodes[index];
        const qrDataUrl = await QRCode.toDataURL(code.code, { errorCorrectionLevel: "M", margin: 1, width: 240 });
        pdf.setDrawColor(148, 163, 184); pdf.rect(x, y, cellWidth, cellHeight);
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(6, 36, 68);
        pdf.text(pdf.splitTextToSize(selected.name, cellWidth - 5).slice(0, 2), x + cellWidth / 2, y + 4, { align: "center", baseline: "top" });
        pdf.addImage(qrDataUrl, "PNG", x + (cellWidth - 31) / 2, y + 13, 31, 31);
        pdf.setFont("courier", "bold"); pdf.setFontSize(9); pdf.text(code.code, x + cellWidth / 2, y + 47, { align: "center" });
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
        pdf.text(code.kind.replace("_", " ").toUpperCase(), x + cellWidth / 2, y + 51, { align: "center" });
      }
      pdf.save(`${selected.name.replace(/[^a-z0-9]+/gi, "_")}_${unclaimedOnly ? "unclaimed_qr_codes" : `attendance_qr_codes_batch_${batchNumber}`}.pdf`);
    } catch {
      window.alert("Could not create the QR code PDF. Please try again.");
    } finally { setExportingPdf(false); }
  }

  useEffect(() => { if (!selectedId && monitoredActivities[0]) setSelectedId(monitoredActivities[0].id); }, [monitoredActivities, selectedId]);
  useEffect(() => { if (selectedId) void loadAttendance(selectedId); }, [selectedId]);

  if (monitoredActivities.length === 0) return <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No formation activities have attendance monitoring enabled.</p>;
  const present = roster.filter(entry => entry.status === "present").length;
  const batches = Array.from(new Set(codes.map(code => code.batchNumber))).sort((a, b) => a - b).map(number => ({ number, codes: codes.filter(code => code.batchNumber === number) }));
  return <div className="grid gap-4 lg:grid-cols-[260px_1fr]"><div className="space-y-2">{monitoredActivities.map(activity => <button key={activity.id} onClick={() => { setShowCodes(false); setSelectedId(activity.id); }} className={`w-full rounded-xl border p-3 text-left ${selectedId === activity.id ? "border-[#0088cc] bg-[#eef7fc]" : "border-[#e6ecf5] bg-white hover:bg-[#f8fafd]"}`}><p className="text-[13px] font-bold text-[#062444]">{activity.name}</p><p className="mt-1 text-[11px] text-slate-400">{formatActivitySchedule(activity.dateTime, activity.endTime)}</p></button>)}</div><div className="rounded-xl border border-[#e6ecf5] bg-white p-4">{!selected ? null : <><div className="flex items-start justify-between gap-3"><div><h3 className="text-[15px] font-bold text-[#062444]">{selected.name}</h3><p className="mt-1 text-[12px] text-slate-500">Use Refresh to retrieve the latest attendance data.</p></div><button onClick={() => void loadAttendance(selected.id)} disabled={loading} className="rounded-lg p-2 text-[#0088cc] hover:bg-[#eef7fc] disabled:opacity-50" aria-label="Refresh attendance"><RefreshCw size={16} /></button></div>{loading ? <p className="py-8 text-[13px] text-slate-400">Loading attendance…</p> : <><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg bg-[#f8fafd] p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Expected</p><p className="mt-1 text-lg font-extrabold text-[#062444]">{expected ?? "—"}</p></div><div className="rounded-lg bg-green-50 p-3"><p className="text-[10px] font-bold uppercase text-green-600">Present</p><p className="mt-1 text-lg font-extrabold text-green-700">{present}</p></div><div className="rounded-lg bg-orange-50 p-3"><p className="text-[10px] font-bold uppercase text-orange-600">Incomplete</p><p className="mt-1 text-lg font-extrabold text-orange-700">{roster.length - present}</p></div></div><div className="mt-5"><h4 className="mb-2 text-[11px] font-bold uppercase text-slate-400">Live roster</h4>{roster.length === 0 ? <p className="text-[12.5px] text-slate-400">No attendance has been recorded yet.</p> : <div className="space-y-1.5">{roster.map(entry => <div key={entry.scholarIdNumber} className="flex items-center justify-between rounded-lg bg-[#f8fafd] px-3 py-2 text-[12px]"><span className="font-semibold text-[#062444]">{entry.scholarName}</span><span className={entry.status === "present" ? "font-bold text-green-600" : "font-bold text-orange-600"}>{entry.status === "present" ? "Present" : "Incomplete"}</span></div>)}</div>}</div><div className="mt-5 rounded-lg bg-[#f8fafd] p-3"><p className="mb-2 text-[11px] font-semibold text-slate-500">More scholars than expected?</p><div className="flex flex-wrap items-center gap-2"><input type="number" min={1} value={additionalCount} onChange={event => setAdditionalCount(event.target.value)} placeholder="Additional scholars" className="w-48 rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" /><button onClick={() => void addCodes()} disabled={addingCodes} className="rounded-lg bg-[#062444] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">{addingCodes ? "Generating…" : session?.type === "time_in_time_out" ? "Add code pairs" : "Add QR codes"}</button></div>{session?.type === "time_in_time_out" && <p className="mt-2 text-[10.5px] text-slate-400">Each additional scholar receives one time-in and one time-out code.</p>}{codeError && <p className="mt-2 text-[11px] text-red-600">{codeError}</p>}</div><div className="mt-5 flex flex-wrap items-center gap-3"><button onClick={() => setShowCodes(value => !value)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">{showCodes ? "Hide QR codes" : `View QR codes (${codes.length})`}</button><button onClick={downloadCodesCSV} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline"><Download size={13} /> Export CSV</button><button onClick={() => void downloadCodesPDF()} disabled={!codes.length || exportingPdf} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50"><Download size={13} /> {exportingPdf ? "Creating PDF…" : "Download QR PDF"}</button></div>{showCodes && <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">{codes.map(code => <div key={code.id} className={`rounded-lg border p-2 text-center ${code.redeemedByScholarId ? "border-green-300 bg-green-50" : "border-[#e6ecf5]"}`}><img src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(code.code)}`} alt={`QR code ${code.code}`} className="mx-auto mb-1" width={80} height={80} /><p className="text-[11px] font-mono font-bold text-[#062444]">{code.code}</p><p className="text-[9.5px] uppercase text-slate-400">{code.kind.replace("_", " ")}</p>{code.redeemedByScholarId && <p className="mt-0.5 text-[9px] font-semibold text-green-600">Redeemed</p>}</div>)}</div>}</>}</>}</div></div>;
}

export function FormationActivitiesTab() {
  const [activities, setActivities] = useState<FormationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<FormationActivity | null>(null);
  const [tab, setTab] = useState<"activities" | "attendance">("activities");
  async function load() { setLoading(true); setActivities(await fetchFormationActivities()); setLoading(false); }
  useEffect(() => { void load(); }, []);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-[15px] font-extrabold text-[#062444]">Formation Activities</h2><p className="mt-1 text-[12.5px] text-slate-500">Create activities for selected scholar year levels. Eligible scholars will see them in Calendar and Activities.</p></div>{tab === "activities" && <button onClick={() => setShowNew(true)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-2 text-[12.5px] font-bold text-[#F3BC00]"><Plus size={15} /> New Activity</button>}</div>
      <div className="mb-5 flex gap-1 border-b border-[#e6ecf5]"><button onClick={() => setTab("activities")} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-bold ${tab === "activities" ? "border-[#0088cc] text-[#062444]" : "border-transparent text-slate-400"}`}><ClipboardList size={14} /> Create Activity</button><button onClick={() => setTab("attendance")} className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-bold ${tab === "attendance" ? "border-[#0088cc] text-[#062444]" : "border-transparent text-slate-400"}`}><QrCode size={14} /> Attendance Monitoring</button></div>
      {loading ? <p className="text-[13px] text-slate-400">Loading…</p> : tab === "attendance" ? <FormationAttendanceMonitoring activities={activities} /> : activities.length === 0 ? <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No formation activities yet.</p> : <div className="space-y-2.5">{activities.map(activity => <div key={activity.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-[13.5px] font-bold text-[#062444]">{activity.name}</h3><p className="mt-1 text-[12px] text-slate-500">{activity.shortDescription}</p></div><div className="flex shrink-0 items-center gap-2">{activity.attendanceEnabled && <span className="flex items-center gap-1 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0088cc]"><QrCode size={11} /> Attendance</span>}<button onClick={() => setEditing(activity)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Edit ${activity.name}`}><Pencil size={15} /></button><button onClick={async () => { if (!window.confirm(`Delete “${activity.name}”?`)) return; const result = await deleteFormationActivity(activity.id); if (!result.ok) window.alert(result.error || "Couldn't delete the activity."); else void load(); }} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${activity.name}`}><Trash2 size={15} /></button></div></div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-500"><span className="flex items-center gap-1"><CalendarDays size={12} />{formatActivitySchedule(activity.dateTime, activity.endTime)}</span><span className="flex items-center gap-1"><MapPin size={12} />{activity.venue}</span><span className="flex items-center gap-1"><Users size={12} />{activity.allYearLevels ? "All year levels" : activity.yearLevels.join(", ")}</span></div></div>)}</div>}
      {showNew && <FormationActivityModal activity={null} onClose={() => setShowNew(false)} onCreated={() => void load()} />}
      {editing && <FormationActivityModal activity={editing} onClose={() => setEditing(null)} onCreated={() => { setEditing(null); void load(); }} />}
    </div>
  );
}
