import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ClipboardList, Plus, Search, CheckCircle2, XCircle, UserCheck, Trash2, QrCode, Download, ImagePlus, Image as ImageIcon } from "lucide-react";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import {
  fetchAllSDPActivities, updateSDPActivity, deleteSDPActivity, createApprovedActivity,
  fetchAttendanceForActivity, fetchCreditHistory, fetchAttendedWithoutCredit, creditAttendedScholars, creditAttendance, creditScholarForDay, removeAttendance, moveCreditSemester, type CreditPeriod, type AttendedWithoutCredit, type CreditHistoryEntry,
  fetchAllScholarsSDPChecklist, fetchScholarsSdpCompliance, fetchSdpChecklistPage, fetchSdpChecklistSummary, fetchSdpOwed,
  fetchAttendanceSession, enableAttendanceForActivity, addAttendanceVouchers, fetchAttendanceRoster,
  isSubCategorySupported, isDayLabelsSupported, type ChecklistSummary, type ChecklistSortKey, type SDPActivity, type SDPCategory, type SDPSubCategory, type SDPActivityType, type AttendanceEntry, type ScholarSdpCompliance,
  type AttendanceType, type AttendanceSession, type AttendanceCode, type AttendanceRosterEntry,
} from "../sdpMonitorApi";
import { SDP_CATEGORIES, SDP_SUBCATEGORIES, subCategoryLabel, scheduleDays, daySubName, creditDay, manilaDay } from "@/scholar/sdpApi";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { uploadPubmat, pubmatUrl } from "../pubmatApi";
import { ScholarSearchField, type ScholarSearchResult } from "../components/ScholarSearchField";
import { SDPHistoryModal } from "../components/SDPHistoryModal";
import { ListPagination } from "@/app/components/PaginatedList";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { fetchAcademicPeriods } from "@/lib/academicPeriodsApi";
import { fetchCurrentGradingPeriod, type GradingPeriod } from "../scholarsGradesMonitoringApi";
import { normalizeTerm, periodKey, periodOptions, termLabel, type AcademicPeriod } from "@/lib/academicPeriods";
import { useUrlState } from "@/app/useUrlState";
import { useSort, SortableTh } from "@/app/components/SortableTable";
import { ExportButton } from "@/app/components/ExportButtons";
import { useRealtimeRefresh } from "@/app/useRealtimeRefresh";
import { MonitorsSection } from "../components/MonitorsSection";
import { BarangayClusterPicker } from "../components/BarangayClusterPicker";
import { SubCategorySelect } from "../components/SubCategorySelect";

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x));
}

/** "Oct 21" for a Philippine calendar day ("2026-10-21"). */
function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}
/** A day as shown next to a code or credit: "Oct 21 – Day 2 – Bonbon Shoreline", or just "Oct 21" when the day has no sub-name. */
function dayText(activity: SDPActivity, day: string | null | undefined): string {
  if (!day) return "";
  const sub = daySubName(activity, day);
  return sub ? `${shortDay(day)} – ${sub}` : shortDay(day);
}
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The semesters on record plus the current grading period, as dropdown options (newest first, the current one marked). */
function useSdpPeriods() {
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [current, setCurrent] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  useEffect(() => {
    void Promise.all([fetchAcademicPeriods(), fetchCurrentGradingPeriod()]).then(([p, cur]) => {
      if (p.ok) setPeriods(p.periods);
      setCurrent(cur);
    });
  }, []);
  const all = useMemo(() => {
    const list = [...periods];
    const term = normalizeTerm(current.semester);
    if (current.schoolYear && term && !list.some(x => periodKey(x.schoolYear, x.term) === periodKey(current.schoolYear, term))) {
      list.push({ id: periodKey(current.schoolYear, term), schoolYear: current.schoolYear, term, status: "open", deadline: null });
    }
    return list;
  }, [periods, current]);
  const options = useMemo(() => periodOptions(all, current), [all, current]);
  const currentKey = current.schoolYear ? periodKey(current.schoolYear, current.semester) : "";
  const toPeriod = (key: string): CreditPeriod | null => { const p = all.find(x => periodKey(x.schoolYear, x.term) === key); return p ? { schoolYear: p.schoolYear, semester: p.term } : null; };
  return { options, currentKey, toPeriod };
}

function categoryLabel(category: SDPCategory | null): string {
  return SDP_CATEGORIES.find(c => c.key === category)?.label ?? "No category set";
}

const HISTORY_SOURCE_LABELS: Record<string, string> = {
  scholar_scan: "the scholar scanned the QR code",
  monitor_scan: "a monitor scanned the scholar's ID card",
  manual: "added by hand",
  credit_attended: "“Credit these scholars”",
  removed: "removed by staff",
  category_edit: "category edited",
  semester_move: "semester changed",
  system: "by the system",
};

function historyLine(e: CreditHistoryEntry, activity: SDPActivity): string {
  const who = e.scholarName ? `${e.scholarName} (${e.scholarIdNumber})` : e.scholarIdNumber ?? "";
  const when = [e.schoolYear, e.semester].filter(Boolean).join(" · ");
  const savedDay = (e.details as { activity_day?: string } | null)?.activity_day ?? null;
  const day = savedDay ? `, ${dayText(activity, savedDay)}` : e.occurrenceNumber && e.occurrenceNumber > 1 ? `, day ${e.occurrenceNumber}` : "";
  if (e.eventType === "category_changed") {
    const d = (e.details ?? {}) as { field?: string; from?: string | null; to?: string | null };
    if (d.field === "sub_category") return `Sub-category changed: ${subCategoryLabel((d.from ?? null) as SDPSubCategory | null)} → ${subCategoryLabel((d.to ?? null) as SDPSubCategory | null)}`;
    return `Category changed: ${categoryLabel((d.from ?? null) as SDPCategory | null)} → ${categoryLabel((d.to ?? null) as SDPCategory | null)}`;
  }
  if (e.eventType === "credit_changed") {
    const d = (e.details ?? {}) as { from?: { semester?: string | null; school_year?: string | null }; to?: { semester?: string | null; school_year?: string | null } };
    return `Credit moved for ${who}: ${[d.from?.school_year, d.from?.semester].filter(Boolean).join(" · ") || "no semester"} → ${[d.to?.school_year, d.to?.semester].filter(Boolean).join(" · ") || "no semester"}`;
  }
  return `${e.eventType === "credit_added" ? "Credit added" : "Credit removed"} for ${who}${day}${when ? ` (${when})` : ""}`;
}

/** The activity's append-only record of credits and category changes. Hidden when the database update has not been run yet. */
function CreditHistorySection({ activity, refreshKey }: { activity: SDPActivity; refreshKey: number }) {
  const activityId = activity.id;
  const [entries, setEntries] = useState<CreditHistoryEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchCreditHistory(activityId).then(r => { if (!cancelled) setEntries(r); });
    return () => { cancelled = true; };
  }, [activityId, refreshKey]);
  if (entries === null) return null;
  return (
    <div className="mt-5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="text-[12px] font-bold uppercase text-slate-700 hover:text-[#062444] underline-offset-2 hover:underline">
        {open ? "Hide" : "Show"} history ({entries.length})
      </button>
      {open && (
        entries.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-slate-500 italic">Nothing recorded yet. Every credit added or removed and every category change from now on is listed here, and cannot be edited.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {entries.map(e => (
              <li key={e.id} className="rounded-lg bg-[#f8fafd] px-3 py-2 text-[12.5px] text-[#062444]">
                <p className="font-medium">{historyLine(e, activity)}</p>
                <p className="text-slate-600">
                  {new Date(e.occurredAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}
                  {e.actorName ? ` · by ${e.actorName}` : ""}
                  {HISTORY_SOURCE_LABELS[e.source] ? ` · ${HISTORY_SOURCE_LABELS[e.source]}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function localDatePart(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function localTimePart(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
  const [subCategory, setSubCategory] = useState<SDPSubCategory | null>(null);
  const subSupported = isSubCategorySupported();
  const [subName, setSubName] = useState("");
  const [organization, setOrganization] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venue, setVenue] = useState("");
  const [activityType, setActivityType] = useState<SDPActivityType>("one_time");
  const [credits, setCredits] = useState("1");
  const [yearLevels, setYearLevels] = useState<string[]>([]);
  const [allYearLevels, setAllYearLevels] = useState(true);
  const [targetBarangays, setTargetBarangays] = useState<string[]>([]);
  const [targetClusters, setTargetClusters] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleYearLevel(level: string) {
    setYearLevels(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
  }

  const [attendanceEnabled, setAttendanceEnabled] = useState(false);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("time_in_time_out");
  const [attendanceCount, setAttendanceCount] = useState("");
  const [voucherHours, setVoucherHours] = useState(1);
  const [pubmatFile, setPubmatFile] = useState<File | null>(null);
  const [createdWithoutPubmat, setCreatedWithoutPubmat] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { setError("Enter an activity name."); return; }
    if (!category) { setError("Choose which SDP category this activity counts toward."); return; }
    if (subSupported && !subCategory) { setError("Choose a sub-category: School-based, Community-based or CEDO Projects."); return; }
    const creditsValue = Number(credits);
    if (!credits.trim() || creditsValue < 1) { setError("Enter how many credits scholars earn per attendance."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError("Select at least one eligible year level, or choose all year levels."); return; }
    const count = Number(attendanceCount);
    if (attendanceEnabled && (!attendanceCount.trim() || count < 1)) {
      setError("Enter the expected number of participants.");
      return;
    }
    if ((date || startTime || endTime) && (!date || !startTime || !endTime)) {
      setError("Enter the date, From time, and To time together, or leave all three blank.");
      return;
    }
    const dateTime = date && startTime ? `${date}T${startTime}` : "";
    const activityEndTime = date && endTime ? `${date}T${endTime}` : "";
    if (dateTime && activityEndTime && new Date(activityEndTime).getTime() <= new Date(dateTime).getTime()) {
      setError("The To time must be later than the From time.");
      return;
    }
    setBusy(true);
    const result = await createApprovedActivity({ name: name.trim(), category, subCategory, subName: activityType === "recurring" ? subName : "", organization: organization.trim(), dateTime, endTime: activityEndTime, venue: venue.trim(), nature: [], activityType, credits: creditsValue, yearLevels, allYearLevels, targetBarangays, targetClusters });
    if (!result.ok || !result.id) { setBusy(false); setError(result.error || "Failed to create."); return; }

    if (attendanceEnabled) {
      const attResult = await enableAttendanceForActivity(result.id, attendanceType, count, voucherHours);
      if (!attResult.ok) { setBusy(false); setError(`Activity created, but attendance setup failed: ${attResult.error}`); return; }
    }
    if (pubmatFile) {
      const pubmatResult = await uploadPubmat("sdp", result.id, pubmatFile, null);
      if (!pubmatResult.ok) {
        // The activity exists now: show it in the list, and do not let a second press of Create make a duplicate.
        setBusy(false); setCreatedWithoutPubmat(true); onCreated();
        setError(`The activity was created, but the pubmat could not be uploaded: ${pubmatResult.error} You can add the pubmat later by opening the activity.`);
        return;
      }
    }
    setBusy(false);
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
          <p className="text-[12.5px] text-slate-500 mb-1">Visible to scholars immediately once created, limited by the year level, barangay, and cluster choices below.</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Activity name"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">SDP Category</label>
            <CategorySelect value={category} onChange={setCategory} />
          </div>
          {subSupported && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">SDP Sub-category</label>
              <SubCategorySelect value={subCategory} onChange={setSubCategory} hasCategory={!!category} />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Type of Activity</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setActivityType("one_time")}
                className={`flex-1 px-3 py-2 rounded-lg border text-[12px] font-bold ${activityType === "one_time" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                One-time
              </button>
              <button type="button" onClick={() => setActivityType("recurring")}
                className={`flex-1 px-3 py-2 rounded-lg border text-[12px] font-bold ${activityType === "recurring" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
                Recurring
              </button>
            </div>
            {activityType === "recurring" && (
              <p className="mt-1.5 text-[11px] text-slate-400">Additional occurrence dates can be added later from the activity's details.</p>
            )}
            {activityType === "recurring" && isDayLabelsSupported() && (
              <div className="mt-2">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Sub-name of this first day (optional)</label>
                <input value={subName} onChange={e => setSubName(e.target.value)} placeholder="e.g. Day 1 – Macabalan Beach"
                  className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
                <p className="mt-1 text-[11px] text-slate-500">A label only. It is shown as “{name.trim() || "Activity name"} – {subName.trim() || "Sub-name"}” and never changes how days or credits are counted.</p>
              </div>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Credits per Attendance</label>
            <input type="number" min={1} value={credits} onChange={e => setCredits(e.target.value)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
            <p className="mt-1.5 text-[11px] text-slate-400">Scholars need 3 credits total in a category to complete it — a bigger activity can be worth more than one credit.</p>
          </div>
          <fieldset className="border-t border-[#f0f3f8] pt-3">
            <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity for scholars with year level</legend>
            <div className="grid grid-cols-2 gap-2">
              {FORMATION_YEAR_LEVELS.map(level => <label key={level} className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={yearLevels.includes(level)} disabled={allYearLevels} onChange={() => toggleYearLevel(level)} className="h-4 w-4 accent-[#062444]" />{level}</label>)}
              <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold text-[#062444]"><input type="checkbox" checked={allYearLevels} onChange={e => setAllYearLevels(e.target.checked)} className="h-4 w-4 accent-[#062444]" />All year levels</label>
            </div>
          </fieldset>
          <BarangayClusterPicker barangays={targetBarangays} clusters={targetClusters} onBarangaysChange={setTargetBarangays} onClustersChange={setTargetClusters} />
          <input value={organization} onChange={e => setOrganization(e.target.value)} placeholder="Organization"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Activity date"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-semibold text-[#062444]">From
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} aria-label="From time"
                className="mt-1 w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm font-normal outline-none focus:border-[#0088cc]" />
            </label>
            <label className="text-[12px] font-semibold text-[#062444]">To
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} aria-label="To time"
                className="mt-1 w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm font-normal outline-none focus:border-[#0088cc]" />
            </label>
          </div>
          <input value={venue} onChange={e => setVenue(e.target.value)} placeholder="Venue"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/15 px-3 py-2 text-[12px] font-semibold text-[#062444] hover:bg-[#f8fafd]">
            <ImagePlus size={13} /> {pubmatFile ? pubmatFile.name : "Upload Pubmat (optional)"}
            <input type="file" accept="image/*" className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) setPubmatFile(file); }} />
          </label>

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
          <button onClick={createdWithoutPubmat ? onClose : handleCreate} disabled={busy}
            className="w-full bg-[#062444] text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-50">
            {busy ? "Creating…" : createdWithoutPubmat ? "Close" : "Create Activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttendanceSection({ activity }: { activity: SDPActivity }) {
  const [attendees, setAttendees] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ScholarSearchResult | null>(null);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [notCredited, setNotCredited] = useState<AttendedWithoutCredit[]>([]);
  const [crediting, setCrediting] = useState(false);
  const [creditMessage, setCreditMessage] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  // The semester new credits count in (the current grading period unless another is chosen), and the credit whose semester is being changed.
  const sdpPeriods = useSdpPeriods();
  const [creditKey, setCreditKey] = useState<string | null>(null);
  const effectiveCreditKey = creditKey && sdpPeriods.options.some(o => o.key === creditKey) ? creditKey : sdpPeriods.currentKey;
  const creditPeriodLabel = sdpPeriods.options.find(o => o.key === effectiveCreditKey)?.label.replace(" (current)", "") ?? "the current semester";
  const [moving, setMoving] = useState<{ id: string; key: string } | null>(null);
  // The current semester is the default, so it is sent as "no choice": that way crediting works exactly as before even if the database update for the semester choice has not been run.
  const chosenPeriod = (): CreditPeriod | null => (effectiveCreditKey === sdpPeriods.currentKey ? null : sdpPeriods.toPeriod(effectiveCreditKey));

  async function load() {
    setLoading(true);
    setHistoryKey(k => k + 1);
    const credited = await fetchAttendanceForActivity(activity.id);
    setAttendees(credited);
    setNotCredited(await fetchAttendedWithoutCredit(activity.id, activity.category, credited));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activity.id]);

  // A recurring activity can credit a scholar once for EACH of its days: the day being credited is chosen, and days the scholar already has are not offered.
  const isRecurring = activity.activityType === "recurring";
  const days = useMemo(() => { const seen = new Set<string>(); return scheduleDays(activity).filter(d => d.day && !seen.has(d.day) && seen.add(d.day)); }, [activity]);
  const typedId = (selected?.scholarIdNumber ?? query).trim().toLowerCase();
  const scholarCredits = typedId ? attendees.filter(a => a.scholarIdNumber.toLowerCase() === typedId) : [];
  const creditedDays = new Set(scholarCredits.map(a => creditDay(activity, a.activityDay, a.attendedDate)).filter((d): d is string => !!d));
  const [dayChoice, setDayChoice] = useState("");
  const today = manilaDay(new Date().toISOString());
  const defaultDay = days.find(d => d.day === today && !creditedDays.has(d.day)) ?? days.find(d => !creditedDays.has(d.day));
  const effectiveDay = dayChoice && days.some(d => d.day === dayChoice) && !creditedDays.has(dayChoice) ? dayChoice : defaultDay?.day ?? "";
  const useDayChoice = isRecurring && days.length > 0;

  async function handleAdd() {
    setError("");
    const scholarIdNumber = selected?.scholarIdNumber ?? query.trim();
    if (!scholarIdNumber) { setError("Enter or pick a scholar."); return; }
    if (useDayChoice && !effectiveDay) { setError(`This scholar already has a credit for every day of this activity (${days.length} of ${days.length}).`); return; }
    setBusy(true);
    const result = useDayChoice
      ? await creditScholarForDay(activity.id, scholarIdNumber, effectiveDay, chosenPeriod())
      : await creditAttendance(activity.id, scholarIdNumber, newDate, chosenPeriod());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to credit — check the Scholar ID exists."); return; }
    setQuery("");
    setSelected(null);
    load();
  }

  async function handleCreditAttended() {
    const n = notCredited.filter(x => x.canCredit).length;
    if (!window.confirm(`Credit ${n} scholar${n === 1 ? "" : "s"} who attended “${activity.name}” but have no credit? Their credit is counted in ${creditPeriodLabel}.`)) return;
    setCrediting(true); setError(""); setCreditMessage("");
    const r = await creditAttendedScholars(activity.id, chosenPeriod());
    setCrediting(false);
    if (!r.ok) { setError(r.error); return; }
    setCreditMessage(`${r.count} scholar${r.count === 1 ? " was" : "s were"} credited.`);
    load();
  }

  async function handleRemove(id: string) {
    await removeAttendance(id);
    load();
  }

  async function handleMove(entry: AttendanceEntry) {
    if (!moving) return;
    const target = sdpPeriods.toPeriod(moving.key);
    const targetLabel = sdpPeriods.options.find(o => o.key === moving.key)?.label.replace(" (current)", "") ?? "";
    const fromLabel = entry.schoolYear && entry.semester ? `${entry.schoolYear} · ${termLabel(entry.semester)}` : "no semester";
    if (!target) { setError("Choose a semester."); return; }
    if (!window.confirm(`Move ${entry.scholarName}'s credit for “${activity.name}” from ${fromLabel} to ${targetLabel}? It then counts in ${targetLabel} instead. Nothing is added or removed, and the change is written to the history.`)) return;
    setError("");
    const r = await moveCreditSemester(entry.id, target);
    if (!r.ok) { setError(r.error || "Could not move the credit."); return; }
    setMoving(null);
    load();
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5"><UserCheck size={13} /> Credited Scholars</p>
      {activity.category ? (
        <p className="text-[11px] text-slate-400 mb-3">Crediting a scholar here marks "{categoryLabel(activity.category)}" complete for them.</p>
      ) : (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          This activity has <strong>no SDP category</strong>. Scans and credits are recorded here, but they are not counted in any category of the SDP Checklist. Choose a category in “Activity Details” if they should count.
        </p>
      )}

      <div className="flex items-end gap-2 flex-wrap mb-4">
        <div>
          <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Scholar</label>
          <ScholarSearchField query={query} setQuery={setQuery} selected={selected}
            onSelect={setSelected} onClear={() => setSelected(null)} />
        </div>
        {useDayChoice ? (
          <div>
            <label htmlFor="credit-day" className="block text-[10.5px] font-semibold text-slate-400 mb-1">Day being credited</label>
            <select id="credit-day" value={effectiveDay} onChange={e => setDayChoice(e.target.value)}
              className="border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc] max-w-[260px]">
              {days.map(d => <option key={d.day} value={d.day} disabled={creditedDays.has(d.day)}>{dayText(activity, d.day)}{creditedDays.has(d.day) ? " (already credited)" : ""}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Date</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
              className="border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
          </div>
        )}
        <PeriodSelect label="Counts in" options={sdpPeriods.options} value={effectiveCreditKey} onChange={setCreditKey} />
        <button onClick={handleAdd} disabled={busy}
          className="bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">
          {busy ? "…" : "Credit"}
        </button>
      </div>
      {useDayChoice && (
        <p className="text-[11px] text-slate-400 -mt-2 mb-3">
          A scholar can be credited once for each day of this recurring activity ({days.length} day{days.length === 1 ? "" : "s"}).
          {scholarCredits.length > 0 && <> This scholar has <strong>{scholarCredits.length} of {days.length}</strong>.</>}
        </p>
      )}
      {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-[12.5px] text-slate-400">Loading…</p>
      ) : attendees.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 italic">No scholars credited yet.</p>
      ) : (
        <div className="space-y-1.5">
          {attendees.map(a => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-y-1 bg-[#f8fafd] rounded-lg px-3 py-2 text-[12.5px]">
              <span className="text-[#062444] font-medium">{a.scholarName} <span className="text-slate-400">({a.scholarIdNumber})</span></span>
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {activity.activityType === "recurring" && (() => { const sub = daySubName(activity, creditDay(activity, a.activityDay, a.attendedDate)); return sub ? <span className="text-[12px] font-semibold text-[#0077b6]">{activity.name} – {sub}</span> : null; })()}
                <span className="text-slate-600">{a.attendedDate ? new Date(a.attendedDate).toLocaleDateString() : "—"}</span>
                <span className="rounded-full bg-white border border-[#e6ecf5] px-2 py-0.5 text-[11.5px] font-semibold text-[#062444]">{a.schoolYear && a.semester ? `${a.schoolYear} · ${termLabel(a.semester)}` : "No semester"}</span>
                <button type="button" onClick={() => setMoving(m => (m?.id === a.id ? null : { id: a.id, key: effectiveCreditKey }))} className="text-[12px] font-semibold text-[#0077b6] hover:underline">Change semester</button>
                <button onClick={() => handleRemove(a.id)} aria-label={`Remove ${a.scholarName}'s credit`} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
              </span>
              {moving?.id === a.id && (
                <div className="basis-full mt-2 flex flex-wrap items-center gap-2 border-t border-[#e6ecf5] pt-2">
                  <PeriodSelect label="Move to" options={sdpPeriods.options} value={moving.key} onChange={key => setMoving({ id: a.id, key })} />
                  <button type="button" onClick={() => void handleMove(a)} className="rounded-lg bg-[#062444] px-3 py-1.5 text-[12px] font-bold text-white">Move</button>
                  <button type="button" onClick={() => setMoving(null)} className="text-[12px] font-semibold text-slate-600">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {creditMessage && <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-[13px] text-green-900">{creditMessage}</p>}
      {!loading && notCredited.length > 0 && (
        <div className="mt-5">
          <p className="text-[12px] font-bold uppercase text-slate-700 mb-1">Scanned the QR code but not credited ({notCredited.length})</p>
          <p className="text-[12.5px] text-slate-700 mb-2">These scholars attended, but no credit was added to this activity. The reason is shown for each one.</p>
          {notCredited.some(x => x.canCredit) && (
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <PeriodSelect label="Count them in" options={sdpPeriods.options} value={effectiveCreditKey} onChange={setCreditKey} />
            </div>
          )}
          {notCredited.some(x => x.canCredit) && (
            <button onClick={() => void handleCreditAttended()} disabled={crediting} className="mb-2 rounded-lg bg-[#062444] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-60">{crediting ? "Crediting…" : `Credit these scholars (${notCredited.filter(x => x.canCredit).length})`}</button>
          )}
          <div className="space-y-1.5">
            {notCredited.map(n => (
              <div key={n.scholarIdNumber} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px]">
                <p className="font-medium text-[#062444]">{n.scholarName} <span className="text-slate-700">({n.scholarIdNumber})</span></p>
                <p className="text-amber-950">{n.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <CreditHistorySection activity={activity} refreshKey={historyKey} />
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
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [credits, setCredits] = useState<AttendanceEntry[]>([]);
  // Recurring activities: codes are made for ONE day, so each printed code says which day it is for.
  const dayOptions = useMemo(() => {
    const seen = new Set<string>();
    return scheduleDays(activity).filter(d => d.day && !seen.has(d.day) && seen.add(d.day));
  }, [activity]);
  const showDays = activity.activityType === "recurring" && isDayLabelsSupported() && dayOptions.length > 0;
  const todayDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const [dayChoice, setDayChoice] = useState(() => (dayOptions.find(d => d.day === todayDay) ?? dayOptions[0])?.day ?? "");
  const dayChooser = (id: string) => (
    <div>
      <label htmlFor={id} className="block text-[10.5px] font-semibold text-slate-500 mb-1">Codes for which day</label>
      <select id={id} value={dayChoice} onChange={e => setDayChoice(e.target.value)} className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
        {dayOptions.map(d => <option key={d.day} value={d.day}>{dayText(activity, d.day)}</option>)}
      </select>
      <p className="mt-1 text-[11px] text-slate-500">Each code is printed with this day, and a scholar can use only one code of the same day.</p>
    </div>
  );

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const result = await fetchAttendanceSession(activity.id);
    if (result) {
      setSession(result.session);
      setCodes(result.codes);
      setRoster(await fetchAttendanceRoster(result.session.id));
      if (activity.activityType === "recurring") setCredits(await fetchAttendanceForActivity(activity.id));
    }
    if (!silent) setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activity.id]);

  // Live-refresh the present count when a QR scan writes a new
  // attendance_records row anywhere — this section used to only reflect
  // attendance as of whenever it mounted, so a scan made while staff had it
  // open needed a manual reload to show up.
  useRealtimeRefresh("attendance_records", () => void load(true));

  async function handleEnable() {
    const n = Number(count);
    if (!count.trim() || n < 1) { setError("Enter the expected number of participants."); return; }
    setBusy(true);
    const result = await enableAttendanceForActivity(activity.id, type, n, voucherHours, showDays ? dayChoice : null);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to enable attendance."); return; }
    setEnabling(false);
    load();
  }

  async function handleAddVouchers() {
    const n = Number(extraVoucherCount);
    if (!extraVoucherCount.trim() || n < 1 || !session) { setError("Enter how many additional vouchers to generate."); return; }
    setBusy(true);
    const result = await addAttendanceVouchers(session.id, n, showDays ? dayChoice : null);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to generate additional vouchers."); return; }
    setExtraVoucherCount("");
    load();
  }

  function downloadCodesCSV() {
    // The third column says which day a code is for ("Oct 21 – Day 2 – Bonbon Shoreline"), so printed codes of different days are easy to tell apart.
    const lines = ["kind,code,day"];
    for (const c of codes) lines.push(`${c.kind},${c.code},${csvCell(dayText(activity, c.dayDate))}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${activity.name.replace(/[^a-z0-9]+/gi, "_")}_attendance_codes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadCodesPDF(batchNumber: number, batchCodes: AttendanceCode[]) {
    if (!batchCodes.length || exportingPdf) return;
    setExportingPdf(true);
    try {
      const margin = 8;
      const columns = 4;
      const rows = 5;
      const gap = 2;
      const cellWidth = (210 - margin * 2 - gap * (columns - 1)) / columns;
      const cellHeight = (297 - margin * 2 - gap * (rows - 1)) / rows;

      const codesPerFile = 200;
      const fileCount = Math.ceil(batchCodes.length / codesPerFile);
      for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const fileCodes = batchCodes.slice(fileIndex * codesPerFile, (fileIndex + 1) * codesPerFile);
        for (let index = 0; index < fileCodes.length; index++) {
          if (index > 0 && index % (columns * rows) === 0) pdf.addPage();
          const position = index % (columns * rows);
          const column = position % columns;
          const row = Math.floor(position / columns);
          const x = margin + column * (cellWidth + gap);
          const y = margin + row * (cellHeight + gap);
          const code = fileCodes[index];
          const qrDataUrl = await QRCode.toDataURL(code.code, { errorCorrectionLevel: "M", margin: 1, width: 240 });

          pdf.setDrawColor(148, 163, 184);
          pdf.rect(x, y, cellWidth, cellHeight);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7);
          pdf.setTextColor(6, 36, 68);
          const activityLines = pdf.splitTextToSize(activity.name, cellWidth - 5).slice(0, 2);
          pdf.text(activityLines, x + cellWidth / 2, y + 4, { align: "center", baseline: "top" });
          const dayLine = dayText(activity, code.dayDate);
          if (dayLine) {
            pdf.setFontSize(6);
            pdf.setTextColor(0, 112, 159);
            pdf.text(pdf.splitTextToSize(dayLine, cellWidth - 5).slice(0, 1), x + cellWidth / 2, y + 10.2, { align: "center", baseline: "top" });
            pdf.setFontSize(7);
            pdf.setTextColor(6, 36, 68);
          }
          const qrSize = 31;
          pdf.addImage(qrDataUrl, "PNG", x + (cellWidth - qrSize) / 2, y + 13, qrSize, qrSize);
          pdf.setFont("courier", "bold");
          pdf.setFontSize(9);
          pdf.text(code.code, x + cellWidth / 2, y + 47, { align: "center" });
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6.5);
          pdf.setTextColor(100, 116, 139);
          pdf.text(code.kind.replace("_", " ").toUpperCase(), x + cellWidth / 2, y + 51, { align: "center" });
          if (index % 10 === 9) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        }
        const name = batchNumber === 0 ? "unclaimed_qr_codes" : `attendance_qr_codes_batch_${batchNumber}`;
        const partSuffix = fileCount === 1 ? "" : `_part_${fileIndex + 1}_of_${fileCount}`;
        pdf.save(`${activity.name.replace(/[^a-z0-9]+/gi, "_")}_${name}${partSuffix}.pdf`);
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
    } catch {
      setError("Could not create the QR code PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) return <div><p className="text-[12.5px] text-slate-400">Loading attendance…</p></div>;

  if (!session) {
    return (
      <div>
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
            {showDays && dayChooser("codes-day-first")}
            {activity.activityType === "recurring" && (
              <p className="text-[12px] text-slate-700">This is a recurring activity: a scholar can scan once per day, and each scan uses its own code. Make codes for the participants of one day now; you can add more codes for the next days afterwards.</p>
            )}
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
  const batches = Array.from(new Set(codes.map(code => code.batchNumber))).sort((a, b) => a - b).map(number => ({ number, codes: codes.filter(code => code.batchNumber === number) }));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-slate-500 uppercase flex items-center gap-1.5"><QrCode size={13} /> QR / Code Attendance</p>
        <span className="text-[11px] text-slate-400">
          {session.type === "time_in_time_out" ? `${session.expectedAttendees} expected` : `${session.expectedAttendees} vouchers - ${session.voucherHours}h each`}
        </span>
      </div>

      <p className="text-[12.5px] text-[#062444] font-semibold mb-2">{presentCount} of {roster.length || "0"} scholars present</p>

      {activity.activityType === "recurring" && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[12.5px] text-sky-950">
          This is a recurring activity: each scholar can scan once for every day of the activity, and every scan needs its own code. A scholar can scan only ONE code from each batch, so make a new batch (below) for each day, with that day chosen.
          {session.type === "time_in_time_out" ? " Each scholar needs one time-in and one time-out code per day; a day counts when both were scanned." : ""}
        </p>
      )}

      <div className="mb-3 rounded-lg bg-[#f8fafd] p-3">
        <p className="text-[11px] font-semibold text-slate-500 mb-2">{activity.activityType === "recurring" ? "Need more codes (more participants, or the next day)?" : "More participants than expected?"}</p>
        {showDays && <div className="mb-2 max-w-sm">{dayChooser("codes-day-more")}</div>}
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={extraVoucherCount} onChange={e => setExtraVoucherCount(e.target.value)} placeholder="Additional participants" className="w-44 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
          <button onClick={handleAddVouchers} disabled={busy} className="bg-[#062444] text-white text-[12px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">{session.type === "voucher" ? "Add vouchers" : "Add time-in / time-out codes"}</button>
        </div>
      </div>

      {roster.length > 0 && (
        <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
          {roster.map(r => (
            <div key={r.scholarIdNumber} className="flex items-center justify-between bg-[#f8fafd] rounded-lg px-3 py-1.5 text-[12px]">
              <span className="text-[#062444] font-medium">{r.scholarName} <span className="text-slate-400">({r.scholarIdNumber})</span>
                {activity.activityType === "recurring" && (() => {
                  const labels = credits.filter(c => c.scholarIdNumber === r.scholarIdNumber).map(c => dayText(activity, creditDay(activity, c.activityDay, c.attendedDate))).filter(Boolean).sort();
                  return labels.length > 0 ? <span className="block text-[11px] font-normal text-slate-600">{labels.join(" · ")}</span> : null;
                })()}
              </span>
              {session.type === "time_in_time_out" ? (
                <span className={r.status === "present" ? "text-green-600 font-semibold" : "text-orange-500 font-semibold"}>
                  {r.status === "present" ? `Present${(r.completedDays ?? 0) > 1 ? ` · ${r.completedDays} days` : ""}`
                    : r.status === "pending_survey" ? "Waiting for survey" : r.timeInAt ? "Timed in only" : "Incomplete"}
                </span>
              ) : (
                <span className="text-[#062444] font-semibold">{r.hoursEarned}h{r.status === "pending_survey" ? " · waiting for survey" : ""}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => setShowCodes(s => !s)} className="text-[12.5px] font-semibold text-[#0088cc] hover:underline">
          {showCodes ? "Hide codes" : `View codes (${codes.length})`}
        </button>
        <ExportButton format="csv" onClick={downloadCodesCSV} label="Export CSV" />
        <div className="relative"><button onClick={() => setShowPdfMenu(value => !value)} disabled={exportingPdf} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50"><Download size={13} /> {exportingPdf ? "Creating PDF..." : "Download QR PDF"}</button>{showPdfMenu && <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-[#e6ecf5] bg-white p-1 shadow-lg">{batches.map(batch => <button key={batch.number} onClick={() => { setShowPdfMenu(false); void downloadCodesPDF(batch.number, batch.codes); }} className="block w-full rounded px-3 py-2 text-left text-[12px] hover:bg-[#f8fafd]">Batch {batch.number} QR PDF</button>)}<button onClick={() => { setShowPdfMenu(false); void downloadCodesPDF(0, codes.filter(code => !code.redeemedByScholarId)); }} className="block w-full rounded px-3 py-2 text-left text-[12px] font-semibold text-[#0088cc] hover:bg-[#f8fafd]">Unclaimed QR codes PDF</button></div>}</div>
      </div>

      {showCodes && (
        <div className="mt-3 max-h-72 space-y-4 overflow-y-auto p-1">
          {batches.map(batch => <div key={batch.number}><p className="mb-2 text-[11px] font-bold uppercase text-slate-500">Batch {batch.number}{batch.codes[0]?.dayDate ? ` · ${dayText(activity, batch.codes[0].dayDate)}` : ""}</p><div className="grid grid-cols-3 gap-2">{batch.codes.map(c => (
            <div key={c.id} className={`border rounded-lg p-2 text-center ${c.redeemedByScholarId ? "border-green-300 bg-green-50" : "border-[#e6ecf5]"}`}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(c.code)}`} alt={c.code} className="mx-auto mb-1" width={80} height={80} />
              <p className="text-[11px] font-mono font-bold text-[#062444]">{c.code}</p>
              <p className="text-[9.5px] text-slate-400 uppercase">{c.kind.replace("_", " ")}</p>
              {c.dayDate && <p className="text-[9.5px] font-semibold text-[#0077b6]">{dayText(activity, c.dayDate)}</p>}
              {c.redeemedByScholarId && <p className="text-[9px] text-green-600 font-semibold mt-0.5">Redeemed</p>}
            </div>
          ))}</div></div>)}
        </div>
      )}
    </div>
  );
}

interface OccurrenceRow { date: string; startTime: string; endTime: string; venue: string; subName: string; }

function DetailModal({ activity, onClose, onChanged }: { activity: SDPActivity; onClose: () => void; onChanged: () => void }) {
  const isRecurring = activity.activityType === "recurring";
  const [tab, setTab] = useState<"details" | "credited" | "qr">("details");
  const [name, setName] = useState(activity.name);
  const [organization, setOrganization] = useState(activity.organization);
  // One-time activities only — recurring activities use `occurrences` below instead.
  const [date, setDate] = useState(activity.dateTime ? localDatePart(activity.dateTime) : "");
  const [startTime, setStartTime] = useState(activity.dateTime ? localTimePart(activity.dateTime) : "");
  const [endTime, setEndTime] = useState(activity.endTime ? localTimePart(activity.endTime) : "");
  const [venue, setVenue] = useState(activity.venue);
  const [projectHead, setProjectHead] = useState(activity.projectHead);
  const [headCluster, setHeadCluster] = useState(activity.headCluster);
  const [category, setCategory] = useState<SDPCategory | null>(activity.category);
  const [subCategory, setSubCategory] = useState<SDPSubCategory | null>(activity.subCategory);
  const subSupported = isSubCategorySupported();
  const [yearLevels, setYearLevels] = useState<string[]>(activity.yearLevels);
  const [allYearLevels, setAllYearLevels] = useState(activity.allYearLevels);
  const [targetBarangays, setTargetBarangays] = useState<string[]>(activity.targetBarangays);
  const [targetClusters, setTargetClusters] = useState<string[]>(activity.targetClusters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pubmatPath, setPubmatPath] = useState(activity.pubmatPath);
  const [pubmatBusy, setPubmatBusy] = useState(false);
  // Recurring activities only — the first row IS the activity's own dateTime/endTime/venue
  // (there's no separate "base occurrence"), every later row is one of activity.recurringDates.
  // Splitting/merging happens only at load (here) and save (handleSave) time.
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>(() => {
    if (!isRecurring) return [];
    const base: OccurrenceRow = {
      date: activity.dateTime ? localDatePart(activity.dateTime) : "",
      startTime: activity.dateTime ? localTimePart(activity.dateTime) : "",
      endTime: activity.endTime ? localTimePart(activity.endTime) : "",
      venue: activity.venue,
      subName: activity.subName,
    };
    const extra: OccurrenceRow[] = activity.recurringDates.map(occ => ({
      date: localDatePart(occ.date),
      startTime: localTimePart(occ.date),
      endTime: occ.endTime ? localTimePart(occ.endTime) : "",
      venue: occ.venue,
      subName: occ.subName ?? "",
    }));
    return [base, ...extra];
  });
  const [credits, setCredits] = useState(String(activity.credits));

  async function handlePubmatFile(file: File) {
    setPubmatBusy(true);
    const result = await uploadPubmat("sdp", activity.id, file, pubmatPath);
    setPubmatBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setPubmatPath(result.path);
    onChanged();
  }

  function toggleYearLevel(level: string) {
    setYearLevels(levels => levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]);
  }

  function addOccurrenceRow() {
    setOccurrences(rows => [...rows, { date: "", startTime: "", endTime: "", venue: rows[rows.length - 1]?.venue ?? "", subName: "" }]);
  }
  function removeOccurrenceRow(index: number) {
    setOccurrences(rows => rows.filter((_, i) => i !== index));
  }
  function updateOccurrenceRow(index: number, patch: Partial<OccurrenceRow>) {
    setOccurrences(rows => rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Enter an activity name."); return; }
    if (!category) { setError("Choose which SDP category this activity counts toward."); return; }
    if (subSupported && !subCategory) { setError("Choose a sub-category: School-based, Community-based or CEDO Projects."); return; }
    const creditsValue = Number(credits);
    if (!credits.trim() || creditsValue < 1) { setError("Enter how many credits scholars earn per attendance."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError("Select at least one eligible year level, or choose all year levels."); return; }

    let dateTimeIso = "";
    let endTimeIso = "";
    let venueToSave = venue.trim();
    let recurringDatesToSave = activity.recurringDates;
    let firstSubName = activity.subName;

    if (isRecurring) {
      const rows = occurrences.filter(o => o.date || o.startTime || o.endTime || o.venue.trim());
      if (rows.length === 0) { setError("Add at least one date, time, and venue."); return; }
      for (const row of rows) {
        if (!row.date || !row.startTime || !row.endTime || !row.venue.trim()) {
          setError("Every row needs a date, From time, To time, and venue.");
          return;
        }
        if (new Date(`${row.date}T${row.endTime}`).getTime() <= new Date(`${row.date}T${row.startTime}`).getTime()) {
          setError("Each row's To time must be later than its From time.");
          return;
        }
      }
      const [first, ...rest] = rows;
      dateTimeIso = new Date(`${first.date}T${first.startTime}`).toISOString();
      endTimeIso = new Date(`${first.date}T${first.endTime}`).toISOString();
      venueToSave = first.venue.trim();
      firstSubName = first.subName.trim();
      recurringDatesToSave = rest.map(r => ({
        date: new Date(`${r.date}T${r.startTime}`).toISOString(),
        endTime: new Date(`${r.date}T${r.endTime}`).toISOString(),
        venue: r.venue.trim(),
        ...(r.subName.trim() ? { subName: r.subName.trim() } : {}),
      }));
    } else {
      if ((date || startTime || endTime) && (!date || !startTime || !endTime)) {
        setError("Enter the date, From time, and To time together, or leave all three blank.");
        return;
      }
      dateTimeIso = date && startTime ? new Date(`${date}T${startTime}`).toISOString() : "";
      endTimeIso = date && endTime ? new Date(`${date}T${endTime}`).toISOString() : "";
      if (dateTimeIso && endTimeIso && new Date(endTimeIso).getTime() <= new Date(dateTimeIso).getTime()) {
        setError("The To time must be later than the From time.");
        return;
      }
      recurringDatesToSave = [];
    }

    setBusy(true);
    const result = await updateSDPActivity(activity.id, {
      projectHead, headCluster, category, ...(subSupported ? { subCategory } : {}), ...(isRecurring && isDayLabelsSupported() ? { subName: firstSubName } : {}), recurringDates: recurringDatesToSave, credits: creditsValue,
      name: name.trim(), organization: organization.trim(), venue: venueToSave,
      dateTime: dateTimeIso || null,
      endTime: endTimeIso || null,
      yearLevels, allYearLevels,
      // Only when changed, so saving an unrelated edit never touches these columns.
      ...(!sameSet(targetBarangays, activity.targetBarangays) ? { targetBarangays } : {}),
      ...(!sameSet(targetClusters, activity.targetClusters) ? { targetClusters } : {}),
    });
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
      <div className="w-full max-w-[64rem] bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-5 rounded-t-2xl">
          <div>
            <p className="text-[#F3BC00] text-[11px] font-bold uppercase tracking-wide mb-1">SDP Activity</p>
            <h3 className="text-white font-bold text-lg leading-tight">{name}</h3>
            <p className="text-white/80 text-[12px] mt-1">
              {activity.category ? categoryLabel(activity.category) : "No category"}
              {subSupported ? ` · ${activity.category ? subCategoryLabel(activity.subCategory) : "No sub-category"}` : ""}
            </p>
            <p className="text-white/50 text-[11px] mt-1">
              {activity.submittedByScholarId ? `Submitted by Scholar ID ${activity.submittedByScholarId}` : "Staff-created (open to all)"}
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white shrink-0"><X size={18} /></button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex gap-1 border-b border-[#e6ecf5]">
            <button type="button" onClick={() => setTab("details")} className={`px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "details" ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-400 hover:text-slate-600"}`}>Activity Details</button>
            <button type="button" onClick={() => setTab("credited")} className={`px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "credited" ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-400 hover:text-slate-600"}`}>Credited Scholars</button>
            <button type="button" onClick={() => setTab("qr")} className={`px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "qr" ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-400 hover:text-slate-600"}`}>QR Attendance</button>
          </div>
        </div>

        <div className="p-6 space-y-4 h-[70vh] overflow-y-auto">
          {tab === "details" && <>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Activity Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
            </div>

            {isRecurring ? (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Organization</label>
                  <input value={organization} onChange={e => setOrganization(e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Dates and Venues</label>
                  <div className={`grid ${isDayLabelsSupported() ? "grid-cols-[1fr_92px_92px_1.2fr_1.2fr_24px]" : "grid-cols-[1fr_100px_100px_1.4fr_24px]"} gap-x-3 gap-y-2 items-center`}>
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Date</span>
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">From</span>
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">To</span>
                    <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Venue</span>
                    {isDayLabelsSupported() && <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Sub-name (optional)</span>}
                    <span />
                    {occurrences.map((occ, i) => (
                      <div key={i} className="contents">
                        <input type="date" value={occ.date} onChange={e => updateOccurrenceRow(i, { date: e.target.value })} aria-label="Occurrence date"
                          className="w-full border-0 border-b border-[#e6ecf5] bg-transparent px-1 py-1.5 text-[13px] outline-none focus:border-[#0088cc]" />
                        <input type="time" value={occ.startTime} onChange={e => updateOccurrenceRow(i, { startTime: e.target.value })} aria-label="From time"
                          className="w-full border-0 border-b border-[#e6ecf5] bg-transparent px-1 py-1.5 text-[13px] outline-none focus:border-[#0088cc]" />
                        <input type="time" value={occ.endTime} onChange={e => updateOccurrenceRow(i, { endTime: e.target.value })} aria-label="To time"
                          className="w-full border-0 border-b border-[#e6ecf5] bg-transparent px-1 py-1.5 text-[13px] outline-none focus:border-[#0088cc]" />
                        <input value={occ.venue} onChange={e => updateOccurrenceRow(i, { venue: e.target.value })} placeholder="Venue"
                          className="w-full border-0 border-b border-[#e6ecf5] bg-transparent px-1 py-1.5 text-[13px] outline-none focus:border-[#0088cc]" />
                        {isDayLabelsSupported() && (
                          <input value={occ.subName} onChange={e => updateOccurrenceRow(i, { subName: e.target.value })} placeholder="e.g. Day 2 – Bonbon Shoreline" aria-label="Sub-name of this day"
                            className="w-full border-0 border-b border-[#e6ecf5] bg-transparent px-1 py-1.5 text-[13px] outline-none focus:border-[#0088cc]" />
                        )}
                        <button type="button" onClick={() => removeOccurrenceRow(i)} className="shrink-0 text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                  {occurrences.length === 0 && <p className="mt-2 text-[12px] text-slate-400 italic">No dates added yet.</p>}
                  <button type="button" onClick={addOccurrenceRow} className="mt-2 rounded-lg bg-[#eef7fc] px-3 py-2 text-[12px] font-bold text-[#0088cc] hover:bg-[#e0f0fa]">
                    <Plus size={13} className="mr-1 inline" />Add Date
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Organization</label>
                  <input value={organization} onChange={e => setOrganization(e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Activity date"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">From</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} aria-label="From time"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">To</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} aria-label="To time"
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase mb-1">Venue</label>
                  <input value={venue} onChange={e => setVenue(e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
                </div>
              </div>
            )}
          </div>

          <Field label="Type of Activity" value={isRecurring ? "Recurring" : "One-time"} />

          <fieldset className="border-t border-[#f0f3f8] pt-3">
            <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity for scholars with year level</legend>
            <div className="grid grid-cols-2 gap-2">
              {FORMATION_YEAR_LEVELS.map(level => <label key={level} className="flex items-center gap-2 text-[12px] text-slate-600"><input type="checkbox" checked={yearLevels.includes(level)} disabled={allYearLevels} onChange={() => toggleYearLevel(level)} className="h-4 w-4 accent-[#062444]" />{level}</label>)}
              <label className="col-span-2 flex items-center gap-2 text-[12px] font-bold text-[#062444]"><input type="checkbox" checked={allYearLevels} onChange={e => setAllYearLevels(e.target.checked)} className="h-4 w-4 accent-[#062444]" />All year levels</label>
            </div>
          </fieldset>

          <BarangayClusterPicker barangays={targetBarangays} clusters={targetClusters} onBarangaysChange={setTargetBarangays} onClustersChange={setTargetClusters} />

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
            {subSupported && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">SDP Sub-category</label>
                <SubCategorySelect value={subCategory} onChange={setSubCategory} hasCategory={!!category} />
                {activity.subCategory === null && <p className="mt-1 text-[11px] text-slate-500">No sub-category yet: choose one and save.</p>}
                <p className="mt-1 text-[11px] text-slate-500">Changing the category or sub-category never adds or removes credits. It is written to the history.</p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Credits per Attendance</label>
              <input type="number" min={1} value={credits} onChange={e => setCredits(e.target.value)}
                className="w-32 border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0088cc]" />
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
            <div className="flex items-center gap-3">
              {pubmatPath && <img src={pubmatUrl(pubmatPath) ?? ""} alt="Pubmat" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/15 px-3 py-2 text-[12px] font-semibold text-[#062444] hover:bg-[#f8fafd]">
                <ImagePlus size={13} /> {pubmatBusy ? "Uploading…" : pubmatPath ? "Replace Pubmat" : "Upload Pubmat"}
                <input type="file" accept="image/*" className="hidden" disabled={pubmatBusy}
                  onChange={e => { const file = e.target.files?.[0]; if (file) void handlePubmatFile(file); }} />
              </label>
            </div>
          </div>

          <MonitorsSection activityType="sdp" activityId={activity.id} />

          {error && <p className="text-[13px] text-red-600">{error}</p>}
          </>}
          {tab === "credited" && <AttendanceSection activity={activity} />}
          {tab === "qr" && <QRAttendanceSection activity={activity} />}
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

/** One activity row — pubmat thumbnail (or a placeholder icon), name, org/submitter. */
function ActivityRow({ activity, onSelect }: { activity: SDPActivity; onSelect: (a: SDPActivity) => void }) {
  const pubmat = pubmatUrl(activity.pubmatPath);
  return (
    <button onClick={() => onSelect(activity)}
      className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[#f8fafd] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        {pubmat ? (
          <img src={pubmat} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
        ) : (
          <span className="w-11 h-11 rounded-lg bg-[#eef3fb] flex items-center justify-center shrink-0 text-[#0088cc]">
            <ImageIcon size={18} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#062444] truncate">{activity.name}</p>
          <p className="text-[12px] text-slate-400 truncate">
            {activity.organization || "—"} {activity.submittedByScholarId ? `· Scholar ID ${activity.submittedByScholarId}` : "· Staff-created"}
          </p>
        </div>
      </div>
      {activity.activityType === "recurring" && (
        <span className="shrink-0 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0088cc]">Recurring</span>
      )}
    </button>
  );
}

/** One column of a category card: a sub-category's heading and its activities, or "No activities". */
function SubCategoryColumn({ label, activities, onSelect }: { label: string; activities: SDPActivity[]; onSelect: (a: SDPActivity) => void }) {
  return (
    <section aria-label={label} className="min-w-0">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#f8fafd] border-y border-[#e6ecf5]">
        <h4 className="text-[12px] font-bold text-[#062444]">{label}</h4>
        <span className="text-[11px] font-semibold text-slate-600">{activities.length}</span>
      </div>
      {activities.length === 0 ? (
        <p className="text-center text-slate-600 py-6 text-[12.5px]">No activities</p>
      ) : (
        <div className="divide-y divide-[#f0f3f8]">
          {activities.map(a => <ActivityRow key={a.id} activity={a} onSelect={onSelect} />)}
        </div>
      )}
    </section>
  );
}

/**
 * One SDP-category card: header (label + count), then one column per sub-category (School-based, Community-based, CEDO Projects), side by side on a wide
 * screen and stacked on a phone. A fourth "No sub-category" column appears only while some activity here has none. `columns` false = the old single list
 * (the database update for sub-categories has not been run yet, and the "Uncategorized" card).
 */
function CategoryGroup({ label, activities, onSelect, columns }: { label: string; activities: SDPActivity[]; onSelect: (a: SDPActivity) => void; columns: boolean }) {
  const withoutSub = columns ? activities.filter(a => !a.subCategory) : [];
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-[#f8fafd] border-b border-[#e6ecf5]">
        <p className="text-[12.5px] font-bold text-[#062444]">{label}</p>
        <span className="text-[11px] font-semibold text-slate-600">{activities.length} activit{activities.length === 1 ? "y" : "ies"}</span>
      </div>
      {!columns ? (
        activities.length === 0 ? (
          <p className="text-center text-slate-600 py-8 text-[13px]">No activities in this category yet.</p>
        ) : (
          <div className="divide-y divide-[#f0f3f8]">
            {activities.map(a => <ActivityRow key={a.id} activity={a} onSelect={onSelect} />)}
          </div>
        )
      ) : (
        <div className={`grid grid-cols-1 ${withoutSub.length > 0 ? "md:grid-cols-4" : "md:grid-cols-3"} md:divide-x md:divide-[#e6ecf5]`}>
          {SDP_SUBCATEGORIES.map(sc => <SubCategoryColumn key={sc.key} label={sc.label} activities={activities.filter(a => a.subCategory === sc.key)} onSelect={onSelect} />)}
          {withoutSub.length > 0 && <SubCategoryColumn label="No sub-category" activities={withoutSub} onSelect={onSelect} />}
        </div>
      )}
    </div>
  );
}

function ActivitiesSection() {
  const [activities, setActivities] = useState<SDPActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SDPActivity | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [subFilter, setSubFilter] = useState<"all" | SDPSubCategory>("all");

  async function load() {
    setLoading(true);
    setActivities(await fetchAllSDPActivities());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const subSupported = isSubCategorySupported();
  const filtered = activities.filter(a => {
    if (subSupported && subFilter !== "all" && a.subCategory !== subFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return a.name.toLowerCase().includes(q) || a.organization.toLowerCase().includes(q);
  });

  const uncategorized = filtered.filter(a => !a.category);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-muted-foreground">Manage staff-created SDP activities.</p>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5 shrink-0 ml-4">
          <Plus size={15} /> New Approved Activity
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 my-4">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 w-full max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or organization…" aria-label="Search activities by name or organization"
            className="w-full text-sm outline-none" />
        </div>
        {subSupported && (
          <div role="group" aria-label="Filter by sub-category" className="flex items-center gap-1 bg-[#f8fafd] border border-[#e6ecf5] rounded-lg p-1 w-fit max-w-full flex-wrap">
            {([["all", "All"], ...SDP_SUBCATEGORIES.map(sc => [sc.key, sc.label] as const)] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setSubFilter(value as "all" | SDPSubCategory)} aria-pressed={subFilter === value}
                className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md ${subFilter === value ? "bg-[#062444] text-white" : "text-slate-600 hover:bg-white"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-10 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 text-slate-400 bg-white rounded-2xl border border-[#e6ecf5]">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No activities match your search.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {SDP_CATEGORIES.map(c => (
            <CategoryGroup key={c.key} label={c.label} activities={filtered.filter(a => a.category === c.key)} onSelect={setSelected} columns={subSupported} />
          ))}
          {uncategorized.length > 0 && (
            <CategoryGroup label="Uncategorized" activities={uncategorized} onSelect={setSelected} columns={false} />
          )}
        </div>
      )}

      {selected && <DetailModal activity={selected} onClose={() => setSelected(null)} onChanged={load} />}
      {showNew && <NewActivityModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}

/** SDP category completion requires 3 credits (see redeem_attendance_code's category-cap check and recompute_sdp_category_status()) — shown alongside the actual count so staff see both the number and whether it's met. */
const SDP_CATEGORY_CREDIT_GOAL = 3;

/** Credit above the requirement is not capped or banked — it shows as the real total (6 / 3, 4 / 3). See supabase_migration_sdp_show_total_credits_over_required.sql. */
function CreditCell({ credits, owed = 0 }: { credits: number; owed?: number }) {
  // owed = extra credits this scholar owes for the semester (an approved SDP reconsideration of the semester before): the requirement is 3 + owed
  const goal = SDP_CATEGORY_CREDIT_GOAL + owed;
  const complete = credits >= goal;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap ${complete ? "text-green-700" : "text-slate-600"}`}>
      {complete ? <CheckCircle2 size={13} /> : null}
      {credits} / {goal}
    </span>
  );
}

type ComplianceFilter = "all" | "complied" | "not_complied";

/** Complied / Not complied for the chosen semester. Words and an icon, never colour alone; Summer has no requirement. */
function ComplianceBadge({ row }: { row: ScholarSdpCompliance }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11.5px] font-bold";
  if (!row.applicable) return <span className="text-[11.5px] font-semibold text-slate-700">Not required (Summer)</span>;
  if (row.complied) return <span className={`${base} border-green-300 bg-green-50 text-green-800`}><CheckCircle2 size={13} aria-hidden="true" /> Complied</span>;
  return <span className={`${base} border-red-300 bg-red-50 text-red-800`}><XCircle size={13} aria-hidden="true" /> Not complied</span>;
}

const CHECKLIST_PAGE_SIZE = 50;
const EMPTY_ROWS: ScholarSdpCompliance[] = [];

function ChecklistSection() {
  // With the database update (supabase_migration_sdp_update_p2_checklist_paging.sql) the database searches, filters, sorts and cuts ONE page, and `rows`
  // is just that page. Without it the screen falls back to the earlier way: load everyone, then search, filter, sort and page here.
  const [rows, setRows] = useState<ScholarSdpCompliance[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ChecklistSummary | null>(null);
  const [serverPaging, setServerPaging] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ComplianceFilter>("all");
  const [viewingScholar, setViewingScholar] = useState<{ scholarIdNumber: string; name: string } | null>(null);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [current, setCurrent] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const requestId = useRef(0);

  useEffect(() => {
    void Promise.all([fetchAcademicPeriods(), fetchCurrentGradingPeriod()]).then(([p, cur]) => {
      if (p.ok) setPeriods(p.periods);
      setCurrent(cur);
    });
  }, []);

  // Wait a moment after typing before asking the database.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // The semesters on record, plus the Current Grading Period if it is not listed yet. Summer is a normal option (no SDP requirement).
  const allPeriods = useMemo(() => {
    const list = [...periods];
    const term = normalizeTerm(current.semester);
    if (current.schoolYear && term && !list.some(x => periodKey(x.schoolYear, x.term) === periodKey(current.schoolYear, term))) {
      list.push({ id: periodKey(current.schoolYear, term), schoolYear: current.schoolYear, term, status: "open", deadline: null });
    }
    return list;
  }, [periods, current]);
  const options = useMemo(() => periodOptions(allPeriods, current), [allPeriods, current]);
  const currentKey = current.schoolYear ? periodKey(current.schoolYear, current.semester) : "";
  const effectiveKey = viewKey && options.some(o => o.key === viewKey) ? viewKey : currentKey;
  const chosen = allPeriods.find(x => periodKey(x.schoolYear, x.term) === effectiveKey) ?? null;

  // Sorting: the header arrows. In the earlier way the rows are sorted here; with the database update the choice is sent to the database.
  const [fallbackRows, setFallbackRows] = useState<ScholarSdpCompliance[]>([]);
  const clientFiltered = useMemo(() => fallbackRows.filter(s => {
    if (filter === "complied" && s.complied !== true) return false;
    if (filter === "not_complied" && s.complied !== false) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.scholarIdNumber.toLowerCase().includes(q);
  }), [fallbackRows, filter, search]);
  const { sorted: clientSorted, sortState, toggleSort } = useSort<ScholarSdpCompliance>(serverPaging ? EMPTY_ROWS : clientFiltered, {
    scholarIdNumber: s => s.scholarIdNumber,
    name: s => s.name,
    communityService: s => s.communityService,
    communityVolunteerism: s => s.communityVolunteerism,
    formationProgram: s => s.formationProgram,
    result: s => (s.complied === null ? 2 : s.complied ? 1 : 0),
  });

  // With the database update: one page.
  const loadPage = useCallback(async () => {
    if (!chosen) { if (current.schoolYear === "") return; setRows([]); setTotal(0); setLoading(false); return; }
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    const result = await fetchSdpChecklistPage({
      schoolYear: chosen.schoolYear, semester: chosen.term, search, filter, sortKey: sortState.key as ChecklistSortKey | null, sortDir: sortState.direction, page, pageSize: CHECKLIST_PAGE_SIZE,
    });
    if (id !== requestId.current) return;   // a newer question was asked meanwhile
    if (result.ok) { setLegacy(false); setRows(result.rows); setTotal(result.total); setLoading(false); return; }
    if (result.missing) { setServerPaging(false); return; }   // the database update has not been run yet: use the earlier way
    setError(result.error); setRows([]); setTotal(0); setLoading(false);
  }, [chosen, current.schoolYear, search, filter, sortState.key, sortState.direction, page]);
  useEffect(() => { if (serverPaging) void loadPage(); }, [serverPaging, loadPage]);

  // Who owes extra credits for the chosen semester (usually nobody, or a few): the credit columns then show "3 / 5".
  const [owed, setOwed] = useState<Awaited<ReturnType<typeof fetchSdpOwed>>>(() => new Map());
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    void fetchSdpOwed(chosen.schoolYear, chosen.term).then(m => { if (!cancelled) setOwed(m); });
    return () => { cancelled = true; };
  }, [chosen]);

  // The three counts load separately, so the page does not wait for them.
  useEffect(() => {
    if (!serverPaging || !chosen) return;
    let cancelled = false;
    setSummary(null);
    void fetchSdpChecklistSummary({ schoolYear: chosen.schoolYear, semester: chosen.term }).then(r => { if (!cancelled && r.ok) setSummary(r.summary); });
    return () => { cancelled = true; };
  }, [serverPaging, chosen]);

  // The earlier way (before the database update): everyone at once.
  const loadAll = useCallback(async () => {
    if (!chosen) { if (current.schoolYear === "") return; setFallbackRows([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    const result = await fetchScholarsSdpCompliance({ schoolYear: chosen.schoolYear, semester: chosen.term });
    if (result.ok) {
      setLegacy(false);
      setFallbackRows(result.rows);
    } else {
      // The compliance function comes with a database update. Until it is applied, still show the credits (current period only), without the result.
      setLegacy(true);
      setError(result.error);
      const old = await fetchAllScholarsSDPChecklist();
      setFallbackRows(old.map(o => ({ scholarIdNumber: o.scholarIdNumber, name: o.name, communityService: o.communityService, communityVolunteerism: o.communityVolunteerism, formationProgram: o.formationProgram, applicable: true, complied: null, missing: "" })));
    }
    setLoading(false);
  }, [chosen, current.schoolYear]);
  useEffect(() => { if (!serverPaging) void loadAll(); }, [serverPaging, loadAll]);

  const counts = useMemo(() => serverPaging
    ? { all: summary?.total ?? null, complied: summary?.complied ?? null, notComplied: summary?.notComplied ?? null }
    : { all: fallbackRows.length, complied: fallbackRows.filter(r => r.applicable && r.complied === true).length, notComplied: fallbackRows.filter(r => r.applicable && r.complied === false).length },
  [serverPaging, summary, fallbackRows]);
  const shown = (n: number | null) => (n === null ? "…" : n.toLocaleString());
  const summer = serverPaging ? /summer/i.test(chosen?.term ?? "") : fallbackRows.length > 0 && fallbackRows.every(r => !r.applicable);

  const matchCount = serverPaging ? total : clientFiltered.length;
  const totalPages = Math.max(1, Math.ceil(matchCount / CHECKLIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = serverPaging ? rows : clientSorted.slice((safePage - 1) * CHECKLIST_PAGE_SIZE, safePage * CHECKLIST_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, filter, effectiveKey, sortState.key, sortState.direction]);

  return (
    <div>
      <p className="text-sm text-slate-600 mb-4">Each scholar's SDP credits and whether they <strong>complied</strong> in the chosen semester: at least 3 credits in each of the 3 categories, counting credit carried over from earlier semesters. Summer has no SDP requirement.</p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-4">
        <PeriodSelect label="Semester" options={options} value={effectiveKey} onChange={setViewKey} />
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 w-full max-w-sm">
          <Search size={15} className="text-slate-500" aria-hidden="true" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search by name or Scholar ID"
            className="w-full text-sm outline-none" />
        </div>
      </div>

      {chosen && currentKey && effectiveKey !== currentKey && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-950">
          You are viewing <strong>{termLabel(chosen.term)} {chosen.schoolYear}</strong>. The current period is <strong>{termLabel(current.semester)} {current.schoolYear}</strong>.{" "}
          <button type="button" onClick={() => setViewKey(currentKey)} className="font-bold underline underline-offset-2">Show the current period</button>
        </p>
      )}

      {!summer && !legacy && (
        <div role="group" aria-label="Filter by SDP result" className="flex items-center gap-1 bg-[#f8fafd] border border-[#e6ecf5] rounded-lg p-1 mb-4 w-fit max-w-full flex-wrap">
          {([
            ["all", `All (${shown(counts.all)})`],
            ["complied", `Complied (${shown(counts.complied)})`],
            ["not_complied", `Not complied (${shown(counts.notComplied)})`],
          ] as const).map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}
              className={`text-[13px] font-semibold px-3 py-1.5 rounded-md ${filter === value ? "bg-[#062444] text-white" : "text-slate-600 hover:bg-white"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {legacy && (
        <p role="status" className="text-[13.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Showing credits only, for the current period. The Complied / Not complied result needs the latest database update{error ? ` (${error})` : ""}.
        </p>
      )}

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-[12px]" aria-busy={loading}>
          <caption className="sr-only">Scholars' SDP credits and result for the chosen semester</caption>
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[10px] uppercase tracking-wide text-[#00709f]">
              <SortableTh label="Scholar ID" sortKey="scholarIdNumber" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5" />
              <SortableTh label="Scholar Name" sortKey="name" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5" />
              <SortableTh label={<>Institutional<br />Volunteerism</>} sortKey="communityService" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5 text-center" />
              <SortableTh label={<>Community<br />Volunteerism</>} sortKey="communityVolunteerism" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5 text-center" />
              <SortableTh label={<>Formation<br />Program</>} sortKey="formationProgram" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5 text-center" />
              {!legacy && <SortableTh label="SDP Result" sortKey="result" sortState={sortState} onSort={toggleSort} className="px-2.5 py-2.5" />}
              <th className="px-2.5 py-2.5 text-center">SDP History</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-t border-[#f0f3f8]" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, j) => <td key={j} className="px-2.5 py-2.5"><div className="h-4 rounded bg-slate-200 animate-pulse" style={{ width: j === 1 ? "9rem" : "4rem" }} /></td>)}
                </tr>
              ))
            ) : error && serverPaging ? (
              <tr><td colSpan={7} role="alert" className="px-3 py-10 text-center text-red-700">Could not load the checklist: {error}</td></tr>
            ) : matchCount === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-600">No scholars found.</td></tr>
            ) : (
              paged.map(s => (
                <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-2.5 py-2.5 text-slate-600 whitespace-nowrap">{s.scholarIdNumber}</td>
                  <td className="px-2.5 py-2.5 font-medium text-[#062444] break-words">{s.name}</td>
                  <td className="px-2.5 py-2.5 text-center"><CreditCell credits={s.communityService} owed={owed.get(s.scholarIdNumber)?.communityService} /></td>
                  <td className="px-2.5 py-2.5 text-center"><CreditCell credits={s.communityVolunteerism} owed={owed.get(s.scholarIdNumber)?.communityVolunteerism} /></td>
                  <td className="px-2.5 py-2.5 text-center"><CreditCell credits={s.formationProgram} owed={owed.get(s.scholarIdNumber)?.formationProgram} /></td>
                  {!legacy && (
                    <td className="px-2.5 py-2.5">
                      <ComplianceBadge row={s} />
                    </td>
                  )}
                  <td className="px-2.5 py-2.5 text-center">
                    <button onClick={() => setViewingScholar({ scholarIdNumber: s.scholarIdNumber, name: s.name })} className="text-[12px] font-semibold text-[#0077b6] hover:underline">View</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ListPagination page={safePage} totalPages={totalPages} onPageChange={setPage} filteredCount={matchCount} pageSize={CHECKLIST_PAGE_SIZE} />

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
  const [section, setSection] = useUrlState<"activities" | "checklist">("sdpView", "activities", ["activities", "checklist"]);

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">SDP Monitoring</h1>
      <p className="text-sm text-muted-foreground mb-5">Track SDP activities and credit scholars' attendance and compliance.</p>
      <div className="flex w-full gap-1 border-b border-border mb-5">
        {([
          { key: "activities" as const, label: "SDP Activities" },
          { key: "checklist" as const, label: "SDP Checklist" },
        ]).map(t => (
          <button key={t.key} onClick={() => setSection(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              section === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
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
