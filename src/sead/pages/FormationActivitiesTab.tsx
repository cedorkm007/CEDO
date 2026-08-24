import { useEffect, useState } from "react";
import { CalendarDays, Check, ClipboardList, Download, MapPin, Pencil, Plus, QrCode, RefreshCw, Trash2, Users, X } from "lucide-react";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import JSZip from "jszip";
import { FORMATION_YEAR_LEVELS, type FormationActivity } from "@/scholar/formationActivitiesApi";
import {
  addFormationAttendanceCodes, createFormationActivity, deleteFormationActivity, enableFormationAttendance, fetchFormationActivities, updateFormationActivity,
  fetchFormationAttendanceSummary, fetchFormationAttendanceRosterPage, fetchFormationAttendanceCodeBatchSummary, fetchFormationAttendanceCodesPage, fetchFormationAttendanceCodesForExport,
  type FormationCodeBatchSummary,
} from "../formationActivitiesApi";
import type { AttendanceCode, AttendanceRosterEntry, AttendanceSession, AttendanceType } from "../sdpMonitorApi";

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

function useDebouncedQrDataUrls(codes: AttendanceCode[]): Map<string, string> {
  const [dataUrls, setDataUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(codes.map(async code => {
        const url = await QRCode.toDataURL(code.code, { errorCorrectionLevel: "M", margin: 1, width: 160 });
        return [code.id, url] as const;
      }));
      if (!cancelled) setDataUrls(new Map(entries));
    })();
    return () => { cancelled = true; };
  }, [codes]);
  return dataUrls;
}

type PdfTarget = { batchNumber: number } | { unclaimed: true };

function FormationAttendanceMonitoring({ activities }: { activities: FormationActivity[] }) {
  const monitoredActivities = activities.filter(activity => activity.attendanceEnabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [presentCount, setPresentCount] = useState(0);
  const [incompleteCount, setIncompleteCount] = useState(0);
  const [batchSummary, setBatchSummary] = useState<FormationCodeBatchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const selected = monitoredActivities.find(activity => activity.id === selectedId) ?? null;

  // ── Roster: server-side paginated, 50/page ──────────────────
  const [rosterPage, setRosterPage] = useState(1);
  const [rosterStatusFilter, setRosterStatusFilter] = useState<"" | "present" | "incomplete">("");
  const [rosterEntries, setRosterEntries] = useState<AttendanceRosterEntry[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const ROSTER_PAGE_SIZE = 50;

  // ── Add more scholars ────────────────────────────────────────
  const [additionalCount, setAdditionalCount] = useState("");
  const [addingCodes, setAddingCodes] = useState(false);
  const [codeError, setCodeError] = useState("");

  // ── QR viewing: batch + type + paginated, 50/page ───────────
  const [showCodes, setShowCodes] = useState(false);
  const [viewBatch, setViewBatch] = useState<number | null>(null);
  const [viewKind, setViewKind] = useState<"time_in" | "time_out" | "voucher">("time_in");
  const [codesPage, setCodesPage] = useState(1);
  const [codesForView, setCodesForView] = useState<AttendanceCode[]>([]);
  const [codesViewTotal, setCodesViewTotal] = useState(0);
  const [codesLoading, setCodesLoading] = useState(false);
  const CODES_PAGE_SIZE = 50;
  const qrDataUrls = useDebouncedQrDataUrls(codesForView);

  // ── Download QR PDF ──────────────────────────────────────────
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ part: number; totalParts: number; zipping?: boolean } | null>(null);

  async function loadSummary(activityId: string) {
    setLoading(true);
    const summary = await fetchFormationAttendanceSummary(activityId);
    if (!summary) {
      setSession(null);
      setPresentCount(0);
      setIncompleteCount(0);
      setBatchSummary([]);
      setLoading(false);
      return;
    }
    setSession(summary.session);
    setPresentCount(summary.presentCount);
    setIncompleteCount(summary.incompleteCount);
    // Batch/kind counts are cheap (aggregated server-side, no code rows) and
    // needed to populate both the QR viewer's Batch/Type pickers and the
    // Download QR PDF menu — loading them alongside the summary keeps both
    // ready without a second click-triggered round trip, and does NOT
    // download any actual QR code data.
    setBatchSummary(await fetchFormationAttendanceCodeBatchSummary(summary.session.id));
    setLoading(false);
    setRosterPage(1);
    void loadRosterPage(summary.session.id, 1);
  }

  async function loadRosterPage(sessionId: string, page: number) {
    setRosterLoading(true);
    const { entries, totalCount } = await fetchFormationAttendanceRosterPage(sessionId, page, ROSTER_PAGE_SIZE, rosterStatusFilter || undefined);
    setRosterEntries(entries);
    setRosterTotal(totalCount);
    setRosterLoading(false);
  }

  async function loadCodesPage(sessionId: string, batchNumber: number, kind: AttendanceCode["kind"], page: number) {
    setCodesLoading(true);
    const { codes, totalCount } = await fetchFormationAttendanceCodesPage(sessionId, batchNumber, kind, page, CODES_PAGE_SIZE);
    setCodesForView(codes);
    setCodesViewTotal(totalCount);
    setCodesLoading(false);
  }

  async function addCodes() {
    if (!session || !selected) return;
    const count = Number(additionalCount);
    if (!additionalCount.trim() || count < 1) {
      setCodeError("Enter the number of additional scholars.");
      return;
    }
    setAddingCodes(true);
    setCodeError("");
    const result = await addFormationAttendanceCodes(session.id, session.type, count);
    setAddingCodes(false);
    if (!result.ok) {
      setCodeError(result.error || "Could not generate additional codes.");
      return;
    }
    setAdditionalCount("");
    void loadSummary(selected.id);
  }

  function downloadRosterPageCSV() {
    if (!selected) return;
    const lines = ["scholar_id_number,scholar_name,status,time_in_at,time_out_at,hours_earned"];
    for (const entry of rosterEntries) {
      lines.push(`${entry.scholarIdNumber},"${entry.scholarName}",${entry.status},${entry.timeInAt ?? ""},${entry.timeOutAt ?? ""},${entry.hoursEarned}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.name.replace(/[^a-z0-9]+/gi, "_")}_roster_page_${rosterPage}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function pdfTargetLabel(target: PdfTarget, kind: "time_in" | "time_out" | "voucher"): string {
    const kindLabel = kind === "time_in" ? "Time-in" : kind === "time_out" ? "Time-out" : "Voucher";
    return "unclaimed" in target ? `Unclaimed ${kindLabel} QR PDF` : `Batch ${target.batchNumber} — ${kindLabel} QR PDF`;
  }

  /** Fetches exactly the requested batch+kind (or unclaimed+kind) — never
   * an unrelated batch or the other type — then builds one or more PDFs,
   * 200 codes per file, with visible part-by-part progress. A single
   * click never triggers more than ONE browser download: if the export
   * fits in one PDF, that PDF downloads directly; if it needs multiple
   * parts, they're bundled into a single .zip instead of firing off
   * several pdf.save() calls back to back (which browsers commonly
   * throttle or block as look-alike-spam after the first few). */
  async function downloadQrPdf(target: PdfTarget, kind: "time_in" | "time_out" | "voucher") {
    if (!selected || !session || exportingPdf) return;
    setExportingPdf(true);
    setPdfProgress(null);
    try {
      const scope = "unclaimed" in target ? { unclaimed: true as const } : { batchNumber: target.batchNumber };
      const batchCodes = await fetchFormationAttendanceCodesForExport(session.id, scope, kind);
      if (!batchCodes.length) {
        const kindWord = kind === "time_in" ? "time-in" : kind === "time_out" ? "time-out" : "voucher";
        window.alert("unclaimed" in target ? `There are no unclaimed ${kindWord} QR codes.` : "This batch has no QR codes of that type.");
        return;
      }
      const margin = 8, columns = 4, rows = 5, gap = 2;
      const cellWidth = (210 - margin * 2 - gap * (columns - 1)) / columns;
      const cellHeight = (297 - margin * 2 - gap * (rows - 1)) / rows;
      const suffix = "unclaimed" in target ? `unclaimed_${kind}` : `batch_${target.batchNumber}_${kind}`;
      const baseName = selected.name.replace(/[^a-z0-9]+/gi, "_");
      // Large batches can contain thousands of QR images. Keeping each PDF
      // to 200 codes (10 pages) prevents jsPDF from holding a huge document
      // in memory and lets the browser stay responsive while printing.
      const codesPerFile = 200;
      const fileCount = Math.ceil(batchCodes.length / codesPerFile);
      // Shown before any generation starts, so staff know up front what a
      // multi-part export will produce (a single .zip), not just a moving
      // "part X of Y" counter with no context for what happens at the end.
      setPdfProgress({ part: 0, totalParts: fileCount });

      const zip = fileCount > 1 ? new JSZip() : null;

      for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
        setPdfProgress({ part: fileIndex + 1, totalParts: fileCount });
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const fileCodes = batchCodes.slice(fileIndex * codesPerFile, (fileIndex + 1) * codesPerFile);
        for (let index = 0; index < fileCodes.length; index++) {
          if (index > 0 && index % (columns * rows) === 0) pdf.addPage();
          const position = index % (columns * rows);
          const x = margin + (position % columns) * (cellWidth + gap);
          const y = margin + Math.floor(position / columns) * (cellHeight + gap);
          const code = fileCodes[index];
          const qrDataUrl = await QRCode.toDataURL(code.code, { errorCorrectionLevel: "M", margin: 1, width: 240 });
          pdf.setDrawColor(148, 163, 184);
          pdf.rect(x, y, cellWidth, cellHeight);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7);
          pdf.setTextColor(6, 36, 68);
          pdf.text(pdf.splitTextToSize(selected.name, cellWidth - 5).slice(0, 2), x + cellWidth / 2, y + 4, { align: "center", baseline: "top" });
          pdf.addImage(qrDataUrl, "PNG", x + (cellWidth - 31) / 2, y + 13, 31, 31);
          pdf.setFont("courier", "bold");
          pdf.setFontSize(9);
          pdf.text(code.code, x + cellWidth / 2, y + 47, { align: "center" });
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6.5);
          pdf.setTextColor(100, 116, 139);
          const batchLabel = "unclaimed" in target ? `Batch ${code.batchNumber}` : `Batch ${target.batchNumber}`;
          const kindLabel = kind === "time_in" ? "TIME-IN" : kind === "time_out" ? "TIME-OUT" : "VOUCHER";
          pdf.text(`${batchLabel} · ${kindLabel}`, x + cellWidth / 2, y + 51, { align: "center" });
          if (index % 10 === 9) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        }

        if (zip) {
          const partSuffix = `_part_${fileIndex + 1}_of_${fileCount}`;
          zip.file(`${baseName}_${suffix}${partSuffix}_qr_codes.pdf`, pdf.output("arraybuffer"));
          await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        } else {
          pdf.save(`${baseName}_${suffix}_qr_codes.pdf`);
        }
      }

      if (zip) {
        setPdfProgress({ part: fileCount, totalParts: fileCount, zipping: true });
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${baseName}_${suffix}_qr_codes_${fileCount}_parts.zip`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      window.alert("Could not create the QR code PDF. Please try again.");
    } finally {
      setExportingPdf(false);
      setPdfProgress(null);
    }
  }

  useEffect(() => {
    if (!selectedId && monitoredActivities[0]) setSelectedId(monitoredActivities[0].id);
  }, [monitoredActivities, selectedId]);

  useEffect(() => {
    if (selectedId) void loadSummary(selectedId);
    setShowCodes(false);
    setViewBatch(null);
    setRosterStatusFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (session) void loadRosterPage(session.id, rosterPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterPage]);

  // Filter change resets to page 1 — same pattern used everywhere else in this
  // project (the roster's page 1 "means something different" once the filter
  // changes, since it's now a page of a different, smaller result set).
  useEffect(() => {
    if (session) {
      if (rosterPage === 1) void loadRosterPage(session.id, 1);
      else setRosterPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterStatusFilter]);

  useEffect(() => {
    if (session && showCodes && viewBatch !== null) {
      setCodesPage(1);
      void loadCodesPage(session.id, viewBatch, viewKind, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCodes, viewBatch, viewKind]);

  useEffect(() => {
    if (session && showCodes && viewBatch !== null) void loadCodesPage(session.id, viewBatch, viewKind, codesPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesPage]);

  if (monitoredActivities.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">
        No formation activities have attendance monitoring enabled.
      </p>
    );
  }

  const batchNumbers = Array.from(new Set(batchSummary.map(b => b.batchNumber))).sort((a, b) => a - b);
  const kindsInBatch = (batch: number) => batchSummary.filter(b => b.batchNumber === batch).map(b => b.kind);
  const currentBatchKindSummary = batchSummary.find(b => b.batchNumber === viewBatch && b.kind === viewKind);
  const unclaimedByKind = (kind: "time_in" | "time_out" | "voucher") =>
    batchSummary.filter(b => b.kind === kind).reduce((sum, b) => sum + (b.total - b.claimed), 0);
  const rosterTotalPages = Math.max(1, Math.ceil(rosterTotal / ROSTER_PAGE_SIZE));
  const codesTotalPages = Math.max(1, Math.ceil(codesViewTotal / CODES_PAGE_SIZE));

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        {monitoredActivities.map(activity => (
          <button
            key={activity.id}
            onClick={() => { setShowCodes(false); setShowPdfMenu(false); setSelectedId(activity.id); }}
            className={`w-full rounded-xl border p-3 text-left ${selectedId === activity.id ? "border-[#0088cc] bg-[#eef7fc]" : "border-[#e6ecf5] bg-white hover:bg-[#f8fafd]"}`}
          >
            <p className="text-[13px] font-bold text-[#062444]">{activity.name}</p>
            <p className="mt-1 text-[11px] text-slate-400">{formatActivitySchedule(activity.dateTime, activity.endTime)}</p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[#e6ecf5] bg-white p-4">
        {!selected ? null : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-bold text-[#062444]">{selected.name}</h3>
                <p className="mt-1 text-[12px] text-slate-500">Use Refresh to retrieve the latest attendance data.</p>
              </div>
              <button
                onClick={() => void loadSummary(selected.id)}
                disabled={loading}
                className="rounded-lg p-2 text-[#0088cc] hover:bg-[#eef7fc] disabled:opacity-50"
                aria-label="Refresh attendance"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            {loading ? (
              <p className="py-8 text-[13px] text-slate-400">Loading attendance…</p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-[#f8fafd] p-3">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Expected</p>
                    <p className="mt-1 text-lg font-extrabold text-[#062444]">{session?.expectedAttendees ?? "—"}</p>
                  </div>
                  <button onClick={() => setRosterStatusFilter(f => f === "present" ? "" : "present")}
                    className={`rounded-lg p-3 text-left transition-colors ${rosterStatusFilter === "present" ? "bg-green-600 ring-2 ring-green-700" : "bg-green-50 hover:bg-green-100"}`}>
                    <p className={`text-[10px] font-bold uppercase ${rosterStatusFilter === "present" ? "text-green-100" : "text-green-600"}`}>Present</p>
                    <p className={`mt-1 text-lg font-extrabold ${rosterStatusFilter === "present" ? "text-white" : "text-green-700"}`}>{presentCount}</p>
                  </button>
                  <button onClick={() => setRosterStatusFilter(f => f === "incomplete" ? "" : "incomplete")}
                    className={`rounded-lg p-3 text-left transition-colors ${rosterStatusFilter === "incomplete" ? "bg-orange-600 ring-2 ring-orange-700" : "bg-orange-50 hover:bg-orange-100"}`}>
                    <p className={`text-[10px] font-bold uppercase ${rosterStatusFilter === "incomplete" ? "text-orange-100" : "text-orange-600"}`}>Incomplete</p>
                    <p className={`mt-1 text-lg font-extrabold ${rosterStatusFilter === "incomplete" ? "text-white" : "text-orange-700"}`}>{incompleteCount}</p>
                  </button>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-[11px] font-bold uppercase text-slate-400">Roster</h4>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg border border-[#e6ecf5] bg-white p-0.5">
                        {(["", "present", "incomplete"] as const).map(v => (
                          <button key={v || "all"} onClick={() => setRosterStatusFilter(v)}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${
                              rosterStatusFilter === v ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f8fafd]"
                            }`}>
                            {v === "" ? "All" : v === "present" ? "Present" : "Incomplete"}
                          </button>
                        ))}
                      </div>
                      {rosterTotal > 0 && (
                        <button onClick={downloadRosterPageCSV} className="flex items-center gap-1 text-[11.5px] font-semibold text-[#0088cc] hover:underline">
                          <Download size={12} /> Export this page (CSV)
                        </button>
                      )}
                    </div>
                  </div>
                  {rosterLoading ? (
                    <p className="text-[12.5px] text-slate-400">Loading roster…</p>
                  ) : rosterEntries.length === 0 ? (
                    <p className="text-[12.5px] text-slate-400">
                      {rosterStatusFilter ? `No ${rosterStatusFilter} scholars on this roster.` : "No attendance has been recorded yet."}
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        {rosterEntries.map(entry => (
                          <div key={entry.scholarIdNumber} className="flex items-center justify-between rounded-lg bg-[#f8fafd] px-3 py-2 text-[12px]">
                            <span className="font-semibold text-[#062444]">{entry.scholarName}</span>
                            <span className={entry.status === "present" ? "font-bold text-green-600" : "font-bold text-orange-600"}>
                              {entry.status === "present" ? "Present" : "Incomplete"}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[11.5px] text-slate-500">
                          Showing {(rosterPage - 1) * ROSTER_PAGE_SIZE + 1}–{Math.min(rosterPage * ROSTER_PAGE_SIZE, rosterTotal)} of {rosterTotal}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setRosterPage(p => Math.max(1, p - 1))} disabled={rosterPage <= 1} className="rounded-lg border border-[#e6ecf5] px-2.5 py-1 text-[11.5px] font-semibold text-[#062444] disabled:opacity-40">Previous</button>
                          <span className="text-[11.5px] text-slate-500">Page {rosterPage} of {rosterTotalPages}</span>
                          <button onClick={() => setRosterPage(p => Math.min(rosterTotalPages, p + 1))} disabled={rosterPage >= rosterTotalPages} className="rounded-lg border border-[#e6ecf5] px-2.5 py-1 text-[11.5px] font-semibold text-[#062444] disabled:opacity-40">Next</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-5 rounded-lg bg-[#f8fafd] p-3">
                  <p className="mb-2 text-[11px] font-semibold text-slate-500">More scholars than expected?</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={additionalCount}
                      onChange={event => setAdditionalCount(event.target.value)}
                      placeholder="Additional scholars"
                      className="w-48 rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]"
                    />
                    <button
                      onClick={() => void addCodes()}
                      disabled={addingCodes}
                      className="rounded-lg bg-[#062444] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      {addingCodes ? "Generating…" : session?.type === "time_in_time_out" ? "Add code pairs" : "Add QR codes"}
                    </button>
                  </div>
                  {session?.type === "time_in_time_out" && (
                    <p className="mt-2 text-[10.5px] text-slate-400">Each additional scholar receives one time-in and one time-out code.</p>
                  )}
                  {codeError && <p className="mt-2 text-[11px] text-red-600">{codeError}</p>}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => { const next = !showCodes; setShowCodes(next); if (next && viewBatch === null && batchNumbers[0] !== undefined) setViewBatch(batchNumbers[0]); }}
                    className="text-[12.5px] font-semibold text-[#0088cc] hover:underline"
                  >
                    {showCodes ? "Hide QR codes" : "View QR codes"}
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setShowPdfMenu(value => !value)}
                      disabled={exportingPdf}
                      className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50"
                    >
                      <Download size={13} /> {exportingPdf ? (
                        pdfProgress?.zipping ? "Bundling into ZIP…"
                        : pdfProgress && pdfProgress.part === 0 ? `Preparing ${pdfProgress.totalParts} PDF part${pdfProgress.totalParts === 1 ? "" : "s"}…`
                        : pdfProgress ? `Creating PDF (part ${pdfProgress.part} of ${pdfProgress.totalParts})…`
                        : "Creating PDF…"
                      ) : "Download QR PDF"}
                    </button>
                    {showPdfMenu && (
                      <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-[#e6ecf5] bg-white p-1 shadow-lg">
                        {session?.type === "time_in_time_out" ? (
                          <>
                            {batchNumbers.map(batchNumber => (
                              <div key={batchNumber}>
                                {(["time_in", "time_out"] as const).filter(k => kindsInBatch(batchNumber).includes(k)).map(kind => (
                                  <button
                                    key={`${batchNumber}-${kind}`}
                                    onClick={() => { setShowPdfMenu(false); void downloadQrPdf({ batchNumber }, kind); }}
                                    className="block w-full rounded px-3 py-2 text-left text-[12px] hover:bg-[#f8fafd]"
                                  >
                                    {pdfTargetLabel({ batchNumber }, kind)}
                                  </button>
                                ))}
                              </div>
                            ))}
                            <div className="my-1 border-t border-[#f0f3f8]" />
                            <button onClick={() => { setShowPdfMenu(false); void downloadQrPdf({ unclaimed: true }, "time_in"); }} className="block w-full rounded px-3 py-2 text-left text-[12px] font-semibold text-[#0088cc] hover:bg-[#f8fafd]">
                              Unclaimed Time-in QR PDF ({unclaimedByKind("time_in")})
                            </button>
                            <button onClick={() => { setShowPdfMenu(false); void downloadQrPdf({ unclaimed: true }, "time_out"); }} className="block w-full rounded px-3 py-2 text-left text-[12px] font-semibold text-[#0088cc] hover:bg-[#f8fafd]">
                              Unclaimed Time-out QR PDF ({unclaimedByKind("time_out")})
                            </button>
                          </>
                        ) : (
                          <>
                            {batchNumbers.map(batchNumber => (
                              <button
                                key={batchNumber}
                                onClick={() => { setShowPdfMenu(false); void downloadQrPdf({ batchNumber }, "voucher"); }}
                                className="block w-full rounded px-3 py-2 text-left text-[12px] hover:bg-[#f8fafd]"
                              >
                                Batch {batchNumber} — Voucher QR PDF
                              </button>
                            ))}
                            <div className="my-1 border-t border-[#f0f3f8]" />
                            <button onClick={() => { setShowPdfMenu(false); void downloadQrPdf({ unclaimed: true }, "voucher"); }} className="block w-full rounded px-3 py-2 text-left text-[12px] font-semibold text-[#0088cc] hover:bg-[#f8fafd]">
                              Unclaimed Voucher QR PDF ({unclaimedByKind("voucher")})
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {showCodes && (
                  <div className="mt-3 rounded-lg border border-[#e6ecf5] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[11px] font-bold uppercase text-slate-400">Batch</label>
                      <select value={viewBatch ?? ""} onChange={event => setViewBatch(Number(event.target.value))} className="rounded-lg border border-[#062444]/15 px-2 py-1 text-[12px] outline-none">
                        {batchNumbers.map(n => <option key={n} value={n}>Batch {n}</option>)}
                      </select>
                      {session?.type === "time_in_time_out" ? (
                        <>
                          <label className="ml-2 text-[11px] font-bold uppercase text-slate-400">Type</label>
                          <div className="flex gap-1">
                            <button onClick={() => setViewKind("time_in")} className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold ${viewKind === "time_in" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>Time-in</button>
                            <button onClick={() => setViewKind("time_out")} className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-bold ${viewKind === "time_out" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>Time-out</button>
                          </div>
                        </>
                      ) : (
                        <input type="hidden" />
                      )}
                      {currentBatchKindSummary && (
                        <span className="ml-auto text-[11px] text-slate-400">{currentBatchKindSummary.claimed} / {currentBatchKindSummary.total} claimed</span>
                      )}
                    </div>

                    <div className="mt-3 max-h-96 overflow-y-auto">
                      {codesLoading ? (
                        <p className="py-6 text-center text-[12.5px] text-slate-400">Loading QR codes…</p>
                      ) : codesForView.length === 0 ? (
                        <p className="py-6 text-center text-[12.5px] text-slate-400">No QR codes for this batch/type.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {codesForView.map(code => (
                            <div key={code.id} className={`rounded-lg border p-2 text-center ${code.redeemedByScholarId ? "border-green-300 bg-green-50" : "border-[#e6ecf5]"}`}>
                              {qrDataUrls.get(code.id) ? (
                                <img src={qrDataUrls.get(code.id)} alt={`QR code ${code.code}`} className="mx-auto mb-1" width={80} height={80} />
                              ) : (
                                <div className="mx-auto mb-1 h-20 w-20 animate-pulse rounded bg-slate-100" />
                              )}
                              <p className="text-[11px] font-mono font-bold text-[#062444]">{code.code}</p>
                              <p className="text-[9.5px] uppercase text-slate-400">{code.kind.replace("_", " ")}</p>
                              {code.redeemedByScholarId ? <p className="mt-0.5 text-[9px] font-semibold text-green-600">Redeemed</p> : <p className="mt-0.5 text-[9px] font-semibold text-slate-400">Unclaimed</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {codesViewTotal > 0 && (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-[11.5px] text-slate-500">
                          Showing {(codesPage - 1) * CODES_PAGE_SIZE + 1}–{Math.min(codesPage * CODES_PAGE_SIZE, codesViewTotal)} of {codesViewTotal}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCodesPage(p => Math.max(1, p - 1))} disabled={codesPage <= 1} className="rounded-lg border border-[#e6ecf5] px-2.5 py-1 text-[11.5px] font-semibold text-[#062444] disabled:opacity-40">Previous</button>
                          <span className="text-[11.5px] text-slate-500">Page {codesPage} of {codesTotalPages}</span>
                          <button onClick={() => setCodesPage(p => Math.min(codesTotalPages, p + 1))} disabled={codesPage >= codesTotalPages} className="rounded-lg border border-[#e6ecf5] px-2.5 py-1 text-[11.5px] font-semibold text-[#062444] disabled:opacity-40">Next</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
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
