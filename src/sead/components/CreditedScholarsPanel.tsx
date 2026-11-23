import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Download, Filter, MoreVertical, Search, Upload, UserCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ScholarSearchField, type ScholarSearchResult } from "./ScholarSearchField";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { ServerPagination } from "@/app/components/ServerPagination";
import { pageCount } from "@/lib/dailyRecordsView";
import { creditAttendance, creditScholarForDay, creditAttendedScholars, moveCreditSemester, removeAttendance, type SDPActivity } from "../sdpMonitorApi";
import {
  SDP_CREDITED_SQL, creditSelectedScholars, fetchCreditedPage, fetchCreditedSummary, fetchEligiblePage, fetchEligibleSummary, fetchNotCreditedPage, moveCreditsSemester, removeCredits, searchScholarsForCredit,
  type CreditedRow, type CreditedSummary, type EligibleRow, type EligibleSummary, type NotCreditedRow,
} from "../sdpCreditedApi";
import { useSdpPeriods } from "../useSdpPeriods";
import { fetchFilteredCredits, fetchFilteredNotCredited, fetchFilteredSummary, probeFiltersUpdate, type FilteredSummary } from "../sdpCreditedFiltersApi";
import { exportList } from "../creditedExport";
import { CreditedFiltersPanel } from "./CreditedFiltersPanel";
import { CreditedImportModal } from "./CreditedImportModal";
import { FILTERS_SQL, clearDim, filterChips, filterCount, howText, listKind, toFilterParam, type CreditedFilters, type ExportFormat } from "@/lib/sdpCreditedFilters";
import { subCategoryLabel } from "@/scholar/sdpApi";
import { scheduleDays, creditSession, sessionKey, manilaDay, type ScheduleDay } from "@/scholar/sdpApi";
import {
  allOnPageSelected, confirmCreditText, creditSemesterLabel, creditingNote, DEFAULT_PAGE_SIZE, formatCreditDate, fullName, PAGE_SIZE_CHOICES, pickPageSize, reasonText, semesterChip,
  semesterFilterOptions, semesterFilterParams, SORT_CHOICES, toggleAllOnPage, ELIGIBLE_NOT_APPLICABLE, ELIGIBLE_NOTE, ELIGIBLE_SQL, eligibleStatusText, placeText, type CreditedSide, type CreditedSort, type NotCreditedFilter,
} from "@/lib/sdpCreditedView";

const FIELD = "rounded-lg border border-[#062444]/15 bg-white px-2.5 py-1.5 text-[13px] text-[#062444] outline-none focus:border-[#0088cc]";
const TH = "px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-slate-600 whitespace-nowrap bg-[#f8fafd] sticky top-0 z-[1]";

/** A date shown in the ONE format of the pop-up ("Nov 23, 2026"); pressing it opens the browser's own date picker. */
function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => { const el = ref.current; if (!el) return; try { if (typeof el.showPicker === "function") { el.showPicker(); return; } } catch { /* some browsers refuse: fall through */ } el.focus(); el.click(); };
  return (
    <span className="relative inline-block">
      <button type="button" onClick={open} aria-label={`${label}: ${formatCreditDate(value)}. Press to change.`} className={`${FIELD} inline-flex w-[9.5rem] items-center justify-between gap-2 text-left`}>
        <span>{formatCreditDate(value)}</span><CalendarDays size={14} className="text-slate-500" aria-hidden="true" />
      </button>
      <input ref={ref} type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
    </span>
  );
}

interface Props {
  activity: SDPActivity;
  side: CreditedSide;
  onSideChange: (s: CreditedSide) => void;
  /** Inside "Not credited": which list was last open (kept while the pop-up is open). */
  notFilter: NotCreditedFilter;
  onNotFilterChange: (f: NotCreditedFilter) => void;
  /** The bar at the bottom of the pop-up: the paging controls are shown there. */
  footerSlot: HTMLElement | null;
  /** The filters that can be combined (kept while the pop-up is open, so they stay when the tab or the side is changed). */
  filters: CreditedFilters;
  onFiltersChange: (f: CreditedFilters) => void;
  categoryLabelText: string;
  sessionLabelOf: (d: ScheduleDay) => string;
  /** The activity's credit history (kept where it was); reads again when `refreshKey` changes. */
  renderHistory: (refreshKey: number) => ReactNode;
}

/**
 * "Credited Scholars" tab of an activity's pop-up. Two sides, with their numbers on the buttons: Credited (the credits of this activity) and Not credited (scholars who scanned the QR code or were marked present
 * but have no credit, with the reason). The list is read ONE PAGE at a time (25 or 50) with the true total; the search (after 300 ms), the sort and the semester filter are done by the database. After crediting,
 * removing or changing a semester the page stays where it is and only the affected rows and the numbers change. The tab is only read when it is opened.
 * Who may credit or remove, how credits are counted and the credit history are the database's and are not changed here.
 */
export function CreditedScholarsPanel({ activity, side, onSideChange, notFilter, onNotFilterChange, footerSlot, filters, onFiltersChange, categoryLabelText, sessionLabelOf, renderHistory }: Props) {
  const periods = useSdpPeriods();
  const [creditKey, setCreditKey] = useState<string | null>(null);
  const effectiveCreditKey = creditKey && periods.options.some(o => o.key === creditKey) ? creditKey : periods.currentKey;
  const creditPeriodLabel = periods.options.find(o => o.key === effectiveCreditKey)?.label.replace(" (current)", "") ?? "the current semester";
  // The current semester is the default, so it is sent as "no choice": crediting works exactly as before even before the semester database update.
  const chosenPeriod = () => (effectiveCreditKey === periods.currentKey ? null : periods.toPeriod(effectiveCreditKey));

  // ── the numbers on the two buttons, and the semesters of the credits ──
  const [summary, setSummary] = useState<CreditedSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [eligibleSummary, setEligibleSummary] = useState<EligibleSummary | null>(null);
  const [eligibleMissing, setEligibleMissing] = useState(false);      // the "Eligible, did not attend" database update has not been run: the rest of the tab still works
  const loadSummary = useCallback(async () => {
    const [r, e] = await Promise.all([fetchCreditedSummary(activity.id), fetchEligibleSummary(activity.id)]);
    if (!r.ok) { if (r.missing) setMissing(true); return; }
    setSummary(r.summary);
    if (e.ok) { setEligibleSummary(e.summary); setEligibleMissing(false); } else if (e.missing) setEligibleMissing(true);
  }, [activity.id]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  // the filters / export / import database update: when it is not there the tab works as before and says so
  const [filtersMissing, setFiltersMissing] = useState(false);
  useEffect(() => { let live = true; void probeFiltersUpdate(activity.id).then(ok => { if (live) setFiltersMissing(!ok); }); return () => { live = false; }; }, [activity.id]);

  // ── the list: search, sort, semester filter, page, rows per page ──
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CreditedSort>("date_desc");
  const [semChoice, setSemChoice] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [credited, setCredited] = useState<CreditedRow[] | null>(null);
  const [notCredited, setNotCredited] = useState<NotCreditedRow[] | null>(null);
  const [eligible, setEligible] = useState<EligibleRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const request = useRef(0);
  const [historyKey, setHistoryKey] = useState(0);
  const isRecurring = activity.activityType === "recurring";
  const kind = listKind(side, notFilter);
  const filterParam = useMemo(() => toFilterParam(filters, kind, isRecurring), [filters, kind, isRecurring]);
  const filterKey = JSON.stringify(filterParam);
  const filtered = !filtersMissing && Object.keys(filterParam).length > 0;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [fsummary, setFsummary] = useState<FilteredSummary | null>(null);

  useEffect(() => {      // the search waits until the person stops typing (300 ms)
    if (typed === search) return;
    const t = window.setTimeout(() => { setSearch(typed); setPage(1); setSelected(new Set()); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, search]);

  const loadPage = useCallback(async () => {
    const mine = ++request.current;
    setLoading(true);
    if (filtered) {      // the filters that combine: the database matches, counts and pages
      const p = JSON.parse(filterKey) as Record<string, unknown>;
      if (side === "credited") {
        const r = await fetchFilteredCredits(activity.id, p, search, sort, page, pageSize);
        if (mine !== request.current) return;
        setLoading(false);
        if (!r.ok) { if (r.missing) setFiltersMissing(true); else setListError(r.error); setCredited([]); return; }
        setListError("");
        if (r.total > 0 && r.rows.length === 0 && page > 1) { setPage(pageCount(r.total, pageSize)); return; }
        setCredited(r.rows); setTotal(r.total);
      } else {
        const r = await fetchFilteredNotCredited(activity.id, notFilter, p, search, page, pageSize);
        if (mine !== request.current) return;
        setLoading(false);
        if (!r.ok) { if (r.missing) setFiltersMissing(true); else setListError(r.error); if (notFilter === "eligible") setEligible([]); else setNotCredited([]); setTotal(0); return; }
        setListError("");
        if (r.total > 0 && r.rows.length === 0 && page > 1) { setPage(pageCount(r.total, pageSize)); return; }
        if (notFilter === "eligible") setEligible(r.rows); else setNotCredited(r.rows);
        setTotal(r.total);
      }
      return;
    }
    if (side === "credited") {
      const f = semesterFilterParams(semChoice);
      const r = await fetchCreditedPage({ activityId: activity.id, search, sort, schoolYear: f.schoolYear, semester: f.semester, noSemester: f.noSemester, page, pageSize });
      if (mine !== request.current) return;      // a newer question was asked meanwhile
      setLoading(false);
      if (!r.ok) { if (r.missing) setMissing(true); else setListError(r.error); setCredited([]); return; }
      setListError("");
      if (r.total > 0 && r.rows.length === 0 && page > 1) { setPage(pageCount(r.total, pageSize)); return; }      // fewer pages now: go to the last one
      setCredited(r.rows); setTotal(r.total);
    } else if (notFilter === "eligible") {
      const r = await fetchEligiblePage(activity.id, search, page, pageSize);
      if (mine !== request.current) return;
      setLoading(false);
      if (!r.ok) { if (r.missing) setEligibleMissing(true); else setListError(r.error); setEligible([]); setTotal(0); return; }
      setListError("");
      if (r.total > 0 && r.rows.length === 0 && page > 1) { setPage(pageCount(r.total, pageSize)); return; }
      setEligible(r.rows); setTotal(r.total);
    } else {
      const r = await fetchNotCreditedPage(activity.id, search, page, pageSize);
      if (mine !== request.current) return;
      setLoading(false);
      if (!r.ok) { if (r.missing) setMissing(true); else setListError(r.error); setNotCredited([]); return; }
      setListError("");
      if (r.total > 0 && r.rows.length === 0 && page > 1) { setPage(pageCount(r.total, pageSize)); return; }
      setNotCredited(r.rows); setTotal(r.total);
    }
  }, [activity.id, side, notFilter, search, sort, semChoice, page, pageSize, filtered, filterKey]);
  useEffect(() => { void loadPage(); }, [loadPage]);

  // the numbers on the buttons follow the filters and the search (the database counts them)
  const [summaryKey, setSummaryKey] = useState(0);
  useEffect(() => {
    if (!filtered) { setFsummary(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await fetchFilteredSummary(activity.id, JSON.parse(filterKey) as Record<string, unknown>, search);
      if (live && r.ok) setFsummary(r.summary);
    }, 150);
    return () => { live = false; window.clearTimeout(t); };
  }, [activity.id, filtered, filterKey, search, summaryKey]);
  const applyFilters = (f: CreditedFilters) => { onFiltersChange(f); setPage(1); setSelected(new Set()); setMoving(null); setMenu(null); setBulkMove(null); };

  const resetView = (patch?: { side?: CreditedSide }) => { setPage(1); setSelected(new Set()); setMoving(null); setMenu(null); setBulkMove(null); if (patch?.side) onSideChange(patch.side); };

  // ── the credit-by-hand form ──
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ScholarSearchResult | null>(null);
  const [newDate, setNewDate] = useState(manilaDay(new Date().toISOString()));
  const [dayChoice, setDayChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const days = useMemo(() => scheduleDays(activity).filter(d => d.day), [activity]);
  const useDayChoice = isRecurring && days.length > 0;
  const typedId = (picked?.scholarIdNumber ?? query).trim();
  // the credits this scholar already has for this activity (a recurring activity is credited once per session): read when a scholar is chosen, a few rows at most
  const [scholarCredits, setScholarCredits] = useState<{ activityDay: string | null; activitySid: string | null; attendedDate: string }[]>([]);
  const loadScholarCredits = useCallback(async () => {
    if (!useDayChoice || !typedId) { setScholarCredits([]); return; }
    const { data } = await supabase.from("sdp_attendance").select("attended_date, activity_day, activity_sid").eq("activity_id", activity.id).eq("scholar_id_number", typedId);
    setScholarCredits(((data ?? []) as { attended_date: string; activity_day?: string | null; activity_sid?: string | null }[]).map(r => ({ activityDay: r.activity_day ?? null, activitySid: r.activity_sid ?? null, attendedDate: r.attended_date })));
  }, [activity.id, typedId, useDayChoice]);
  useEffect(() => { const t = window.setTimeout(() => { void loadScholarCredits(); }, picked ? 0 : 300); return () => window.clearTimeout(t); }, [loadScholarCredits, picked]);
  const creditedDays = new Set(scholarCredits.map(a => creditSession(activity, a.activityDay, a.activitySid, a.attendedDate)).filter((d): d is ScheduleDay => !!d).map(sessionKey));
  const today = manilaDay(new Date().toISOString());
  const defaultDay = days.find(d => d.day === today && !creditedDays.has(sessionKey(d))) ?? days.find(d => !creditedDays.has(sessionKey(d)));
  const effectiveDay = dayChoice && days.some(d => sessionKey(d) === dayChoice) && !creditedDays.has(dayChoice) ? dayChoice : defaultDay ? sessionKey(defaultDay) : "";
  const chosenSession = days.find(d => sessionKey(d) === effectiveDay);

  const afterChange = () => { setHistoryKey(k => k + 1); setSummaryKey(k => k + 1); void loadSummary(); };

  async function handleAdd() {
    setError(""); setMessage("");
    const scholarIdNumber = picked?.scholarIdNumber ?? query.trim();
    if (!scholarIdNumber) { setError("Enter or pick a scholar."); return; }
    if (useDayChoice && !effectiveDay) { setError(`This scholar already has a credit for every session of this activity (${days.length} of ${days.length}).`); return; }
    setBusy(true);
    const result = useDayChoice
      ? await creditScholarForDay(activity.id, scholarIdNumber, chosenSession?.day ?? effectiveDay, chosenPeriod(), chosenSession?.sid || null)
      : await creditAttendance(activity.id, scholarIdNumber, newDate, chosenPeriod());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to credit — check the Scholar ID exists."); return; }
    setQuery(""); setPicked(null); setMessage("Credit added.");
    afterChange(); void loadPage(); void loadScholarCredits();      // this page is read again (one page), and the numbers
  }

  // ── actions on a credit (the same functions and rules as before) ──
  const [menu, setMenu] = useState<{ id: string; top: number; left: number; up: boolean } | null>(null);
  const [moving, setMoving] = useState<{ id: string; key: string } | null>(null);
  const [bulkMove, setBulkMove] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("resize", close); document.addEventListener("keydown", esc); document.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); document.removeEventListener("keydown", esc); document.removeEventListener("scroll", close, true); };
  }, [menu]);

  const creditedRows = credited ?? [];
  const rowName = (r: CreditedRow) => fullName(r.firstName, r.lastName) || r.scholarIdNumber;
  const dropRows = (ids: Set<string>) => {      // the affected rows leave this page; the total and the numbers follow
    setCredited(rows => (rows ?? []).filter(r => !ids.has(r.id)));
    setTotal(t => Math.max(0, t - ids.size));
    setSelected(new Set());
    if (creditedRows.every(r => ids.has(r.id)) && page > 1) setPage(p => p - 1);
  };

  async function removeOne(r: CreditedRow) {
    setMenu(null);
    if (!window.confirm(`Remove ${rowName(r)}'s credit for “${activity.name}”? The removal is written to the history.`)) return;
    setError(""); setMessage("");
    const res = await removeAttendance(r.id);
    if (!res.ok) { setError(res.error || "Could not remove the credit."); return; }
    dropRows(new Set([r.id])); afterChange();
  }
  async function moveOne(r: CreditedRow) {
    if (!moving) return;
    const target = periods.toPeriod(moving.key);
    const targetLabel = periods.options.find(o => o.key === moving.key)?.label.replace(" (current)", "") ?? "";
    if (!target) { setError("Choose a semester."); return; }
    if (!window.confirm(`Move ${rowName(r)}'s credit for “${activity.name}” from ${creditSemesterLabel(r.schoolYear, r.semester).toLowerCase() === "no semester" ? "no semester" : creditSemesterLabel(r.schoolYear, r.semester)} to ${targetLabel}? It then counts in ${targetLabel} instead. Nothing is added or removed, and the change is written to the history.`)) return;
    setError(""); setMessage("");
    const res = await moveCreditSemester(r.id, target);
    if (!res.ok) { setError(res.error || "Could not move the credit."); return; }
    setMoving(null);
    const f = semesterFilterParams(semChoice);
    const stillShown = semChoice === "" || (!f.noSemester && f.schoolYear === target.schoolYear && f.semester === target.semester);
    if (stillShown) setCredited(rows => (rows ?? []).map(x => (x.id === r.id ? { ...x, schoolYear: target.schoolYear, semester: target.semester } : x)));
    else dropRows(new Set([r.id]));      // it no longer belongs to the semester being looked at
    afterChange();
  }
  async function removeSelected() {
    const ids = creditedRows.filter(r => selected.has(r.id));
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${ids.length} credit${ids.length === 1 ? "" : "s"} for “${activity.name}”? Each removal is written to the history.`)) return;
    setError(""); setMessage("");
    const res = await removeCredits(ids.map(r => r.id));
    if (!res.ok) { setError(res.error || "Could not remove the credits."); return; }
    setMessage(`${ids.length} credit${ids.length === 1 ? " was" : "s were"} removed.`);
    dropRows(new Set(ids.map(r => r.id))); afterChange();
  }
  async function moveSelected() {
    if (!bulkMove) return;
    const ids = creditedRows.filter(r => selected.has(r.id));
    const target = periods.toPeriod(bulkMove.key);
    const targetLabel = periods.options.find(o => o.key === bulkMove.key)?.label.replace(" (current)", "") ?? "";
    if (!target || ids.length === 0) { setError("Choose a semester."); return; }
    if (!window.confirm(`Move ${ids.length} credit${ids.length === 1 ? "" : "s"} for “${activity.name}” to ${targetLabel}? Nothing is added or removed, and each change is written to the history.`)) return;
    setError(""); setMessage("");
    const res = await moveCreditsSemester(ids.map(r => r.id), target);
    if (!res.ok) { setError(res.error); return; }
    setMessage(`${res.count} credit${res.count === 1 ? " was" : "s were"} moved to ${targetLabel}.`);
    setBulkMove(null); setSelected(new Set());
    const f = semesterFilterParams(semChoice);
    const stillShown = semChoice === "" || (!f.noSemester && f.schoolYear === target.schoolYear && f.semester === target.semester);
    if (stillShown) setCredited(rows => (rows ?? []).map(x => (ids.some(i => i.id === x.id) ? { ...x, schoolYear: target.schoolYear, semester: target.semester } : x)));
    else dropRows(new Set(ids.map(r => r.id)));
    afterChange();
  }

  // ── crediting scholars who attended but have no credit ──
  const [crediting, setCrediting] = useState(false);
  const notCreditedRows = notCredited ?? [];
  const creditableOnPage = notCreditedRows.filter(n => n.canCredit).map(n => n.scholarIdNumber);
  async function creditTicked() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(confirmCreditText(ids.length, activity.name, creditPeriodLabel))) return;
    setCrediting(true); setError(""); setMessage("");
    const r = await creditSelectedScholars(activity.id, ids, chosenPeriod());
    setCrediting(false);
    if (!r.ok) { setError(r.missing ? `This needs the latest database update (${SDP_CREDITED_SQL}). Please ask the IT admin to run it.` : r.error); return; }
    setMessage(`${r.count} scholar${r.count === 1 ? " was" : "s were"} credited.`);
    setSelected(new Set()); afterChange(); void loadPage();
  }
  async function creditEveryone() {
    const n = summary?.creditable ?? 0;
    if (n === 0) return;
    if (!window.confirm(confirmCreditText(n, activity.name, creditPeriodLabel))) return;
    setCrediting(true); setError(""); setMessage("");
    const r = await creditAttendedScholars(activity.id, chosenPeriod());
    setCrediting(false);
    if (!r.ok) { setError(r.error); return; }
    setMessage(`${r.count} scholar${r.count === 1 ? " was" : "s were"} credited.`);
    setSelected(new Set()); afterChange(); void loadPage();
  }

  const eligibleRows = eligible ?? [];
  const onEligible = side === "not_credited" && notFilter === "eligible";
  const filterAnyActive = search.trim() !== "" || semChoice !== "" || filtered;
  const skeleton = loading && (side === "credited" ? credited === null || credited.length === 0 : onEligible ? eligible === null || eligible.length === 0 : notCredited === null || notCredited.length === 0);
  const rowsOnPage = side === "credited" ? creditedRows.length : onEligible ? eligibleRows.length : notCreditedRows.length;
  const pageIds = side === "credited" ? creditedRows.map(r => r.id) : onEligible ? [] : creditableOnPage;
  const semesterOptions = semesterFilterOptions(summary?.semesters ?? []);
  const countText = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString("en-US"));

  const counts = filtered && fsummary
    ? { credited: fsummary.credited, notCredited: fsummary.notCredited, eligible: fsummary.eligibleApplicable ? fsummary.eligible : 0, creditable: fsummary.creditable }
    : { credited: summary?.credited, notCredited: summary?.notCredited, eligible: eligibleSummary?.applicable === false ? 0 : eligibleSummary?.count, creditable: summary?.creditable ?? 0 };

  // ── Export: every row that matches the list, the filters and the search (not only this page) ──
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const cancelExport = useRef(false);
  async function runExport(format: ExportFormat) {
    setExportMenu(false); setError(""); setMessage("");
    cancelExport.current = false; setExporting({ done: 0, total: total });
    const r = await exportList({
      activityId: activity.id, kind, filters: JSON.parse(filterKey) as Record<string, unknown>, search, sort, format,
      activity: { name: activity.name, categoryLabel: categoryLabelText, subCategoryLabel: activity.subCategory ? subCategoryLabel(activity.subCategory) : "", credits: activity.credits },
      sessionNameOf: (day, sid, date) => (isRecurring ? creditSession(activity, day, sid, date)?.subName ?? "" : ""),
      onProgress: (done, tot) => setExporting({ done, total: tot }), isCancelled: () => cancelExport.current,
    });
    setExporting(null);
    if (r.ok) setMessage(`Exported ${r.rows.toLocaleString("en-US")} row${r.rows === 1 ? "" : "s"} to ${r.fileName}.`);
    else if (!r.cancelled) setError(r.error);
  }
  const dayLabelOf = (v: string) => { const [d, sid] = v.split("|"); const hit = days.find(x => x.day === d && (x.sid || "") === (sid || "")) ?? days.find(x => x.day === d); return hit ? sessionLabelOf(hit) : formatCreditDate(d); };
  const chips = filterChips(filters, kind, isRecurring, dayLabelOf, formatCreditDate);

  if (missing) {
    return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This tab needs the latest database update ({SDP_CREDITED_SQL}). Ask the IT admin to run it.</p>;
  }

  const pager = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0 max-sm:text-[13px]">
      <ServerPagination page={page} pageSize={pageSize} total={total} onPageChange={p => { setPage(Math.max(1, p)); setSelected(new Set()); setMoving(null); }} noun={side === "credited" ? "credits" : "scholars"} disabled={loading} compactOnPhone />
      <label className="flex items-center gap-2 text-[13px] text-slate-700">Rows per page
        <select value={pageSize} onChange={e => { setPageSize(pickPageSize(e.target.value)); resetView(); }} aria-label="Rows per page" className={`${FIELD} py-1`}>
          {PAGE_SIZE_CHOICES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      {/* the top part stays in place on a computer; the list below it scrolls */}
      <div className="shrink-0 space-y-2.5">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-600"><UserCheck size={14} aria-hidden="true" /> Credited Scholars</p>
        {activity.category ? (
          <p className="text-[13px] text-slate-600">{creditingNote(categoryLabelText, activity.credits)}</p>
        ) : (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
            This activity has <strong>no SDP category</strong>. Scans and credits are recorded here, but they are not counted in any category of the SDP Checklist. Choose a category in “Activity Details” if they should count.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end md:flex-nowrap">
          <div className="min-w-0">
            <label className="mb-1 block text-[12px] font-semibold text-slate-600">Scholar</label>
            <ScholarSearchField query={query} setQuery={setQuery} selected={picked} onSelect={setPicked} onClear={() => setPicked(null)} fetcher={q => searchScholarsForCredit(q, activity.id)} />
          </div>
          {useDayChoice ? (
            <div className="min-w-0">
              <label htmlFor="credit-day" className="mb-1 block text-[12px] font-semibold text-slate-600">Session being credited</label>
              <select id="credit-day" value={effectiveDay} onChange={e => setDayChoice(e.target.value)} className={`${FIELD} max-w-full sm:max-w-[260px]`}>
                {days.map(d => <option key={sessionKey(d)} value={sessionKey(d)} disabled={creditedDays.has(sessionKey(d))}>{sessionLabelOf(d)}{creditedDays.has(sessionKey(d)) ? " (already credited)" : ""}</option>)}
              </select>
            </div>
          ) : (
            <div><label className="mb-1 block text-[12px] font-semibold text-slate-600">Date</label><DateField value={newDate} onChange={setNewDate} label="Date" /></div>
          )}
          <PeriodSelect label="Counts in" options={periods.options} value={effectiveCreditKey} onChange={setCreditKey} className="sm:pb-0.5" />
          <button onClick={() => void handleAdd()} disabled={busy} className="rounded-lg bg-[#062444] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "…" : "Credit"}</button>
        </div>
        {useDayChoice && (
          <p className="text-[12.5px] text-slate-600">
            A scholar can be credited once for each session of this recurring activity ({days.length} session{days.length === 1 ? "" : "s"}; several sessions can be on the same day).
            {scholarCredits.length > 0 && <> This scholar has <strong>{creditedDays.size} of {days.length}</strong>.</>}
          </p>
        )}
        {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-[13px] text-green-900">{message}</p>}

        {/* Credited / Not credited, with the numbers */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <div role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-lg border border-[#062444]/25">
            {([["credited", "Credited", counts.credited], ["not_credited", "Not credited", counts.notCredited]] as const).map(([key, label, n]) => (
              <button key={key} type="button" onClick={() => { if (side !== key) { resetView({ side: key }); setSearch(""); setTyped(""); } }} aria-pressed={side === key}
                className={`px-3.5 py-2 text-[13.5px] font-bold ${side === key ? "bg-[#062444] text-white" : "bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                {label} <span className={side === key ? "text-[#F3BC00]" : "text-[#006aa3]"}>({countText(n)})</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name or Scholar ID…" aria-label="Search this list" className={`${FIELD} w-full py-2 pl-8`} />
          </div>
          {!filtersMissing && (
            <button type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3 py-2 text-[13px] font-bold text-[#062444] hover:bg-[#f7f9fc]">
              <Filter size={14} aria-hidden="true" /> Filters{filterCount(filters, kind, isRecurring) > 0 && <span className="rounded-full bg-[#062444] px-1.5 text-[11.5px] text-white">{filterCount(filters, kind, isRecurring)}</span>}
            </button>
          )}
          {!filtersMissing && (
            <span className="relative">
              <button type="button" onClick={() => setExportMenu(m => !m)} disabled={!!exporting || total === 0} aria-haspopup="menu" aria-expanded={exportMenu} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3 py-2 text-[13px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40"><Download size={14} aria-hidden="true" /> Export</button>
              {exportMenu && (
                <div role="menu" aria-label="Export format" className="absolute left-0 top-full z-[120] mt-1 w-56 overflow-hidden rounded-lg border border-[#e6ecf5] bg-white py-1 text-[13.5px] shadow-lg">
                  <p className="px-3 py-1.5 text-[12px] text-slate-600">All {total.toLocaleString("en-US")} {side === "credited" ? "credit" : "scholar"}{total === 1 ? "" : "s"} that match, not just this page.</p>
                  <button role="menuitem" type="button" onClick={() => void runExport("xlsx")} className="block w-full px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">Excel (.xlsx)</button>
                  <button role="menuitem" type="button" onClick={() => void runExport("csv")} className="block w-full px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">CSV (.csv)</button>
                </div>
              )}
            </span>
          )}
          {!filtersMissing && (
            <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3 py-2 text-[13px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><Upload size={14} aria-hidden="true" /> Import</button>
          )}
          {side === "credited" && (
            <>
              <label className="flex items-center gap-2 text-[13px] text-slate-700">Sort
                <select value={sort} onChange={e => { setSort(e.target.value as CreditedSort); resetView(); }} aria-label="Sort" className={FIELD}>{SORT_CHOICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              </label>
              {filtersMissing && <label className="flex items-center gap-2 text-[13px] text-slate-700">Semester
                <select value={semChoice} onChange={e => { setSemChoice(e.target.value); resetView(); }} aria-label="Semester filter" className={`${FIELD} max-w-[15rem]`}>
                  <option value="">All semesters</option>{semesterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>}
            </>
          )}
          {(search.trim() !== "" || semChoice !== "" || typed !== "") && <button type="button" onClick={() => { setTyped(""); setSearch(""); setSemChoice(""); resetView(); }} className="text-[13px] font-semibold text-[#00709f] hover:underline">Clear search</button>}
        </div>

        {chips.length > 0 && !filtersMissing && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {chips.map(c => (
              <li key={c.key}>
                <button type="button" onClick={() => applyFilters(clearDim(filters, c.dim))} aria-label={`Remove filter ${c.text}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#0088cc]/40 bg-[#eef6fc] px-2.5 py-1 text-[12.5px] font-semibold text-[#06456b] hover:bg-[#dff0fb]">
                  <span className="truncate">{c.text}</span><X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
            <li><button type="button" onClick={() => applyFilters({})} className="px-1 text-[12.5px] font-semibold text-[#00709f] hover:underline">Clear all filters</button></li>
          </ul>
        )}
        {filtersMissing && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">Filters, Export and Import need the latest database update ({FILTERS_SQL}). Ask the IT admin to run it; the rest of the tab works as before.</p>
        )}
        {exporting && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f7f9fc] px-3 py-2 text-[13px] text-slate-800">
            Exporting {exporting.done.toLocaleString("en-US")} of {exporting.total.toLocaleString("en-US")}…
            <span className="h-2 w-40 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><span className="block h-full bg-[#0088cc]" style={{ width: `${exporting.total ? Math.min(100, Math.round((exporting.done / exporting.total) * 100)) : 0}%` }} /></span>
            <button type="button" onClick={() => { cancelExport.current = true; }} className="font-semibold text-[#00709f] hover:underline">Cancel</button>
          </p>
        )}

        {side === "not_credited" && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label="Which scholars">
            {([["attended", "Attended, not credited", summary?.notCredited], ["eligible", "Eligible, did not attend", counts.eligible]] as const).map(([key, label, n]) => (
              <button key={key} type="button" aria-pressed={notFilter === key} disabled={key === "eligible" && eligibleSummary?.applicable === false}
                onClick={() => { if (notFilter !== key) { onNotFilterChange(key); onFiltersChange({ ...filters, reason: [] }); resetView(); setSearch(""); setTyped(""); } }}
                className={`rounded-full border px-3.5 py-1.5 font-semibold disabled:opacity-50 ${notFilter === key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                {label} <span className={notFilter === key ? "text-[#F3BC00]" : "text-[#006aa3]"}>({countText(n)})</span>
              </button>
            ))}
            {onEligible && <span className="min-w-0 flex-1 text-slate-600">{eligibleSummary?.applicable === false ? ELIGIBLE_NOT_APPLICABLE : ELIGIBLE_NOTE}</span>}
          </div>
        )}
        {onEligible && eligibleMissing && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-950">This list needs the latest database update ({ELIGIBLE_SQL}). Ask the IT admin to run it.</p>
        )}

        {/* what can be done with the ticked rows */}
        {side === "credited" && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#062444]/20 bg-[#f7f9fc] px-3 py-2 text-[13px]">
            <strong className="text-[#062444]">{selected.size} selected</strong>
            {bulkMove ? (
              <>
                <PeriodSelect label="Move to" options={periods.options} value={bulkMove.key} onChange={key => setBulkMove({ key })} />
                <button type="button" onClick={() => void moveSelected()} className="rounded-lg bg-[#062444] px-3 py-1.5 font-bold text-white">Move</button>
                <button type="button" onClick={() => setBulkMove(null)} className="font-semibold text-slate-600">Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setBulkMove({ key: effectiveCreditKey })} className="rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">Change semester</button>
                <button type="button" onClick={() => void removeSelected()} className="rounded-lg border border-red-700 bg-white px-3 py-1.5 font-semibold text-red-800 hover:bg-red-50">Remove credits</button>
                <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-slate-600">Clear selection</button>
              </>
            )}
          </div>
        )}
        {side === "not_credited" && !onEligible && (summary?.creditable ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" onClick={() => void creditTicked()} disabled={crediting || selected.size === 0} className="rounded-lg bg-[#062444] px-3.5 py-2 font-bold text-white disabled:opacity-50">{crediting ? "Crediting…" : `Credit selected (${selected.size})`}</button>
            {!filtered && <button type="button" onClick={() => void creditEveryone()} disabled={crediting} className="rounded-lg border border-[#062444]/40 bg-white px-3.5 py-2 font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-50">{`Credit these scholars (${summary?.creditable ?? 0})`}</button>}
            <span className="text-slate-600">Counted in {creditPeriodLabel} (change it at “Counts in”).</span>
          </div>
        )}
      </div>

      {/* the list: the only part that scrolls (on a computer) */}
      <div className="mt-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {listError && <p role="alert" className="mb-2 text-[13px] text-red-700">Couldn't load the list: {listError}</p>}
        <div className="overflow-hidden rounded-xl border border-[#e6ecf5] bg-white">
          <table className="w-full table-fixed border-collapse text-[13px]" aria-busy={loading}>
            <caption className="sr-only">{side === "credited" ? "Scholars credited for this activity" : "Scholars who attended this activity but have no credit"}</caption>
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              <col className="hidden sm:table-column" style={{ width: 130 }} />
              {side === "credited" ? <><col className="hidden md:table-column" style={{ width: 130 }} /><col className="hidden md:table-column" style={{ width: 235 }} /><col style={{ width: 48 }} /></> : onEligible ? <><col className="hidden md:table-column" style={{ width: 150 }} /><col className="hidden lg:table-column" style={{ width: 190 }} /></> : <col className="hidden md:table-column" style={{ width: 160 }} />}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  <input type="checkbox" aria-label="Select all on this page" disabled={pageIds.length === 0} className={onEligible ? "invisible" : undefined} checked={allOnPageSelected(selected, pageIds)} onChange={e => setSelected(s => toggleAllOnPage(s, pageIds, e.target.checked))} />
                </th>
                <th scope="col" className={TH}>Scholar</th>
                <th scope="col" className={`${TH} hidden sm:table-cell`}>Scholar ID</th>
                {side === "credited" ? (
                  <>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Date credited</th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Semester</th>
                    <th scope="col" className={`${TH} text-center`}><span className="sr-only">Actions</span></th>
                  </>
                ) : onEligible ? (
                  <>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>Year level</th>
                    <th scope="col" className={`${TH} hidden lg:table-cell`}>Barangay</th>
                  </>
                ) : <th scope="col" className={`${TH} hidden md:table-cell`}>Attendance</th>}
              </tr>
            </thead>
            <tbody>
              {skeleton ? (
                Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-t border-[#f0f3f8]" aria-hidden="true">{Array.from({ length: side === "credited" ? 6 : onEligible ? 5 : 4 }, (_, j) => <td key={j} className={`px-3 py-3 ${j === 2 ? "hidden sm:table-cell" : j === 3 || (j === 4 && side === "credited") ? "hidden md:table-cell" : ""}`}><div className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${45 + ((i * 9 + j * 13) % 45)}%` }} /></td>)}</tr>)
              ) : rowsOnPage === 0 ? (
                <tr><td colSpan={side === "credited" ? 6 : onEligible ? 5 : 4} className="px-4 py-10 text-center text-slate-700">
                  {side === "credited"
                    ? (filterAnyActive ? "No credit matches this search or filter." : "No scholars credited yet.")
                    : onEligible ? (filterAnyActive ? "No eligible scholar matches this search." : "Every eligible scholar attended or has a credit.")
                    : (filterAnyActive ? "No scholar matches this search." : "Everyone who attended has been credited.")}
                </td></tr>
              ) : side === "credited" ? creditedRows.map(r => {
                const chip = semesterChip(r.schoolYear, r.semester, effectiveCreditKey);
                const sub = isRecurring ? creditSession(activity, r.activityDay, r.activitySid, r.attendedDate)?.subName : null;
                const name = rowName(r);
                return (
                  <FragmentRow key={r.id}>
                    <tr className={`border-t border-[#f0f3f8] align-top hover:bg-[#f8fafd] ${loading ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${name}`} checked={selected.has(r.id)} onChange={e => setSelected(s => toggleAllOnPage(s, [r.id], e.target.checked))} /></td>
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-medium text-[#062444]" title={name}>{name}</span>
                        {/* on a narrow screen the other details sit under the name */}
                        <span className="mt-0.5 block text-[12.5px] text-slate-600 sm:hidden">{r.scholarIdNumber} · {formatCreditDate(r.attendedDate)}{chip.show && <span className="ml-1.5 inline-block rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11.5px] font-bold text-amber-900">{chip.label}</span>}</span>
                      </td>
                      <td className="hidden px-3 py-2.5 tabular-nums text-slate-800 sm:table-cell">{r.scholarIdNumber}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell"><span className="whitespace-nowrap text-slate-800">{formatCreditDate(r.attendedDate)}</span>{sub && <span className="block truncate text-[12px] font-semibold text-[#0077b6]" title={`${activity.name} – ${sub}`}>{sub}</span>}{r.how && <span className="block truncate text-[12px] text-slate-500" title={r.creditedBy ? `${howText(r.how)} · ${r.creditedBy}` : howText(r.how)}>{howText(r.how)}</span>}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {chip.show
                          ? <span className="inline-block max-w-full truncate rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[12px] font-bold text-amber-900" title={`Counts in ${chip.label}, not in ${creditPeriodLabel}`}>{chip.label}</span>
                          : <span className="text-slate-300" aria-label="Same semester">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={menu?.id === r.id}
                          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); const up = window.innerHeight - b.bottom < 120; setMenu(m => (m?.id === r.id ? null : { id: r.id, top: up ? b.top : b.bottom, left: Math.max(8, b.right - 176), up })); }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-[#eef3fa]"><MoreVertical size={16} aria-hidden="true" /></button>
                      </td>
                    </tr>
                    {moving?.id === r.id && (
                      <tr className="bg-[#f7f9fc]"><td />
                        <td colSpan={5} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <PeriodSelect label="Move to" options={periods.options} value={moving.key} onChange={key => setMoving({ id: r.id, key })} />
                            <button type="button" onClick={() => void moveOne(r)} className="rounded-lg bg-[#062444] px-3 py-1.5 text-[12.5px] font-bold text-white">Move</button>
                            <button type="button" onClick={() => setMoving(null)} className="text-[12.5px] font-semibold text-slate-600">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              }) : onEligible ? eligibleRows.map(e => {
                const name = fullName(e.firstName, e.lastName) || e.scholarIdNumber;
                return (
                  <tr key={e.scholarIdNumber} className={`border-t border-[#f0f3f8] align-top hover:bg-[#f8fafd] ${loading ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5">
                      <span className="block truncate font-medium text-[#062444]" title={name}>{name}</span>
                      <span className={`block text-[12.5px] ${e.attendanceStatus === "incomplete" ? "text-amber-950" : "text-slate-600"}`}>{eligibleStatusText(e.attendanceStatus)}</span>
                      <span className="mt-0.5 block text-[12.5px] text-slate-600 sm:hidden">{e.scholarIdNumber} · {placeText(e.yearLevel, e.barangay)}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 tabular-nums text-slate-800 sm:table-cell">{e.scholarIdNumber}</td>
                    <td className="hidden px-3 py-2.5 text-slate-800 md:table-cell">{e.yearLevel || "—"}</td>
                    <td className="hidden px-3 py-2.5 text-slate-800 lg:table-cell"><span className="block truncate" title={e.barangay || undefined}>{e.barangay || "—"}</span></td>
                  </tr>
                );
              }) : notCreditedRows.map(n => {
                const name = fullName(n.firstName, n.lastName) || n.scholarIdNumber;
                return (
                  <tr key={n.scholarIdNumber} className={`border-t border-[#f0f3f8] align-top hover:bg-[#fffaf0] ${loading ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${name}`} disabled={!n.canCredit} checked={selected.has(n.scholarIdNumber)} onChange={e => setSelected(s => toggleAllOnPage(s, [n.scholarIdNumber], e.target.checked))} /></td>
                    <td className="px-3 py-2.5">
                      <span className="block truncate font-medium text-[#062444]" title={name}>{name}</span>
                      <span className="block text-[12.5px] text-amber-950">{reasonText(n.reasonCode)}</span>
                      <span className="mt-0.5 block text-[12.5px] text-slate-600 sm:hidden">{n.scholarIdNumber}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 tabular-nums text-slate-800 sm:table-cell">{n.scholarIdNumber}</td>
                    <td className="hidden px-3 py-2.5 text-slate-800 md:table-cell">{n.attendanceStatus === "pending_survey" ? "Waiting for the survey" : "Present"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4">{renderHistory(historyKey)}</div>
      </div>

      {/* the actions of a credit: opens under (or above) its ⋮ button */}
      {menu && (() => {
        const r = creditedRows.find(x => x.id === menu.id);
        if (!r) return null;
        return (
          <div role="menu" aria-label="Credit actions" style={{ position: "fixed", left: menu.left, top: menu.up ? undefined : menu.top + 4, bottom: menu.up ? window.innerHeight - menu.top + 4 : undefined, width: 176 }}
            className="z-[120] overflow-hidden rounded-lg border border-[#e6ecf5] bg-white py-1 text-[13.5px] shadow-lg">
            <button role="menuitem" type="button" onClick={() => { setMoving({ id: r.id, key: effectiveCreditKey }); setMenu(null); }} className="block w-full px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">Change semester</button>
            <button role="menuitem" type="button" onClick={() => void removeOne(r)} className="block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50">Remove credit</button>
          </div>
        );
      })()}

      {filtersOpen && (
        <CreditedFiltersPanel activityId={activity.id} kind={kind} recurring={isRecurring} search={search} filters={filters} onApply={applyFilters} onClose={() => setFiltersOpen(false)} dayLabel={dayLabelOf} />
      )}
      {importOpen && (
        <CreditedImportModal activity={activity} period={chosenPeriod()} defaultSchoolYear={periods.toPeriod(effectiveCreditKey)?.schoolYear ?? null} periodLabel={creditPeriodLabel} onClose={() => setImportOpen(false)} onDone={() => { afterChange(); void loadPage(); }} />
      )}
      {footerSlot && createPortal(pager, footerSlot)}
    </div>
  );
}

/** A row and the row of its editor, under one key. */
function FragmentRow({ children }: { children: ReactNode }) { return <>{children}</>; }
