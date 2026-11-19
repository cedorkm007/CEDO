import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, ClipboardPlus, FileSpreadsheet, Download, Eye, Loader2 } from "lucide-react";
import {
  DAILY_RECORDS_PAGE_SIZE, fetchAllDailyRecordsForExport, fetchDailyRecordConsultants, fetchDailyRecordsPage, VISIT_TYPES,
  type DailyRecord, type DailyRecordFilters,
} from "../scholarCounselingApi";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { SCHOLARSHIP_STATUSES } from "../types";
import { AddDailyRecordModal } from "../components/AddDailyRecordModal";
import { BulkDailyRecordsModal } from "../components/BulkDailyRecordsModal";
import { DailyRecordDetailModal } from "../components/DailyRecordDetailModal";
import { ScholarProfilePreviewModal } from "../components/ScholarProfilePreviewModal";
import { MultiSelect } from "../renewal/RenewalScholarListTab";
import { ServerPagination } from "@/app/components/ServerPagination";
import { SortableTh, useSortState } from "@/app/components/SortableTable";
import { buildXlsx } from "@/lib/xlsxLite";
import { supabase } from "@/lib/supabase";
import { manilaToday } from "@/lib/renewal";
import {
  EMPTY_DAILY_FILTERS, EXPORT_HEADERS, exportFileName, exportRow, filtersActive, pageCount, QUICK_RANGES, quickRange, readRemembered, REMEMBER_KEY, type QuickRange,
} from "@/lib/dailyRecordsView";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const formatDay = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const TH = "px-3 py-2.5 text-left text-[13px] font-medium text-slate-600 whitespace-nowrap";
const FIELD = "rounded-lg border border-[#062444]/25 bg-white px-2.5 py-2 text-[14px] text-slate-900";

function readStored(): ReturnType<typeof readRemembered> {
  try { return readRemembered(window.sessionStorage.getItem(REMEMBER_KEY)); } catch { return null; }
}

/**
 * "Daily Records" — the Consultation Tool's log of consultation visits. The list is read PAGE BY PAGE from the database (50 a page, with the true total: nothing is cut off however many records there are);
 * the search, the filters (dates, visit type, status, consultant) and the sort (date visited, name) all run in the database. The table keeps to the columns that fit a laptop screen; everything else about a
 * visit is in the record's detail window (the eye button). "Export" downloads ALL the records that match the filters and the search. The page, the filters and the search are remembered.
 */
export function ScholarCounselingTab() {
  const stored = useMemo(readStored, []);
  const [filters, setFilters] = useState<DailyRecordFilters>(stored?.filters ?? EMPTY_DAILY_FILTERS);
  const [typed, setTyped] = useState(stored?.filters.search ?? "");
  const { sortState, toggleSort } = useSortState({ key: stored?.sortKey ?? "date", direction: stored?.sortDir ?? "desc" });
  const sort = useMemo(() => ({ key: (sortState.key === "name" ? "name" : "date") as "date" | "name", dir: sortState.direction }), [sortState]);
  const [page, setPage] = useState(stored?.page ?? 1);
  const [rows, setRows] = useState<DailyRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [semesterStart, setSemesterStart] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [viewing, setViewing] = useState<DailyRecord | null>(null);
  const [profile, setProfile] = useState<ScholarInformationRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const request = useRef(0);

  // remember the page, the filters, the search and the sort (also after another tool or a reload)
  useEffect(() => {
    try { window.sessionStorage.setItem(REMEMBER_KEY, JSON.stringify({ filters, sortKey: sort.key, sortDir: sort.dir, page })); } catch { /* private window: it just is not remembered */ }
  }, [filters, sort, page]);

  // a new sort starts again from page 1 (not on the first run, so a remembered page is kept)
  const firstSort = useRef(true);
  useEffect(() => { if (firstSort.current) { firstSort.current = false; return; } setPage(1); }, [sort.key, sort.dir]);

  // the search waits until the person stops typing (300 ms), then starts again from page 1
  useEffect(() => {
    if (typed === filters.search) return;
    const t = window.setTimeout(() => { setFilters(f => ({ ...f, search: typed })); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, filters.search]);

  const load = useCallback(async () => {
    const mine = ++request.current;
    setLoading(true);
    const r = await fetchDailyRecordsPage(filters, sort, page);
    if (mine !== request.current) return;          // a newer question was asked meanwhile
    setLoading(false);
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); setRows([]); return; }
    setError(""); setMissing(false);
    const last = pageCount(r.total, DAILY_RECORDS_PAGE_SIZE);
    if (r.total > 0 && page > last) { setPage(last); return; }      // fewer pages now (a filter or a clean-up): go to the last one
    setRows(r.rows); setTotal(r.total);
  }, [filters, sort, page]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void fetchDailyRecordConsultants().then(setConsultants);
    // "This semester" = since the day the current school year and semester were set
    void Promise.resolve(supabase.from("grading_period_settings").select("updated_at").eq("id", true).maybeSingle()).then(({ data }) => {
      const at = (data as { updated_at?: string } | null)?.updated_at;
      if (at && !Number.isNaN(Date.parse(at))) setSemesterStart(new Date(Date.parse(at) + 8 * 3600e3).toISOString().slice(0, 10));      // the Philippine day it was set
    }).catch(() => undefined);
  }, []);

  const change = (patch: Partial<DailyRecordFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const clear = () => { setTyped(""); setFilters(EMPTY_DAILY_FILTERS); setPage(1); };
  const today = manilaToday();
  const activeQuick = QUICK_RANGES.find(q => { const r = quickRange(q.key, today, semesterStart); return !!r && r.from === filters.from && r.to === filters.to; })?.key ?? "";
  const pickQuick = (key: string) => {
    if (!key) return;
    const r = quickRange(key as QuickRange, today, semesterStart);
    if (r) change({ from: r.from, to: r.to });
  };

  async function openProfile(scholarIdNumber: string) {
    setProfileLoading(true);
    const info = await fetchScholarInformationByIdNumber(scholarIdNumber);
    setProfileLoading(false);
    if (info) setProfile(info);
  }

  async function exportAll() {
    setExportMsg(""); setExporting({ done: 0, total });
    const r = await fetchAllDailyRecordsForExport({ ...filters, search: filters.search.trim() }, sort, (done, all) => setExporting({ done, total: all }));
    if (!r.ok) { setExporting(null); setExportMsg(r.missing ? "Exporting needs the latest database update. Please ask the IT admin to run it." : r.error); return; }
    const bytes = await buildXlsx({
      name: "Daily Records",
      rows: [EXPORT_HEADERS.map(h => ({ value: h, style: "header" as const })), ...r.rows.map(x => exportRow(x))],
      widths: [20, 28, 26, 12, 34, 14, 14, 14, 24, 28, 50, 50, 14],
    });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
    const a = document.createElement("a");
    a.href = url; a.download = exportFileName(filters, today);
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setExporting(null);
    setExportMsg(`Downloaded ${r.rows.length.toLocaleString("en-US")} record${r.rows.length === 1 ? "" : "s"}. This export was recorded in the export log.`);
  }

  const anyFilter = filtersActive(filters) || typed.trim() !== "";
  const skeleton = loading && (rows === null || rows.length === 0);      // the first load, or a load after a list with nothing in it; a page change keeps the old rows (dimmed) until the new ones arrive

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search by name or Scholar ID"
            className="w-full rounded-lg border border-[#e6ecf5] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#062444]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void exportAll()} disabled={!!exporting || total === 0 || missing}
            className="flex items-center gap-2 rounded-lg border border-[#062444]/25 bg-white px-4 py-2.5 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-50">
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Export{total > 0 && !exporting ? ` (${total.toLocaleString("en-US")})` : ""}
          </button>
          <button onClick={() => setShowBulk(true)} className="flex items-center gap-2 rounded-lg border border-[#062444]/25 bg-white px-4 py-2.5 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
            <FileSpreadsheet size={15} aria-hidden="true" /> Bulk Add Records
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-4 py-2.5 text-[13px] font-semibold text-white">
            <ClipboardPlus size={15} className="text-[#F3BC00]" aria-hidden="true" /> Add Daily Record
          </button>
        </div>
      </div>

      {/* the filters, on one line */}
      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2" role="group" aria-label="Filters">
        <label className="text-[13px] font-semibold text-slate-700">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={e => change({ from: e.target.value })} className={`${FIELD} mt-0.5 block w-[9.5rem] font-normal`} /></label>
        <label className="text-[13px] font-semibold text-slate-700">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => change({ to: e.target.value })} className={`${FIELD} mt-0.5 block w-[9.5rem] font-normal`} /></label>
        <label className="text-[13px] font-semibold text-slate-700">Quick pick
          <select value={activeQuick} onChange={e => pickQuick(e.target.value)} className={`${FIELD} mt-0.5 block w-32 font-normal`} aria-label="Quick date range">
            <option value="">—</option>
            {QUICK_RANGES.filter(q => q.key !== "semester" || semesterStart).map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
          </select>
        </label>
        <div className="w-36"><MultiSelect label="Visit type" options={VISIT_TYPES.map(v => ({ value: v, label: v }))} selected={filters.visitTypes} onChange={visitTypes => change({ visitTypes })} /></div>
        <div className="w-36"><MultiSelect label="Status" options={SCHOLARSHIP_STATUSES.map(s => ({ value: s, label: s }))} selected={filters.statuses} onChange={statuses => change({ statuses })} /></div>
        <div className="w-40"><MultiSelect label="Consultant" options={consultants.map(c => ({ value: c.id, label: c.name }))} selected={filters.consultantIds} onChange={consultantIds => change({ consultantIds })} /></div>
        {anyFilter && <button type="button" onClick={clear} className="pb-2 text-[13.5px] font-semibold text-[#00709f] hover:underline">Clear filters</button>}
      </div>

      {missing && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Daily Records list needs the latest database update (supabase_migration_consultation_daily_records_paging.sql). Ask the IT admin to run it.</p>}
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">Couldn't load the records: {error}</p>}
      {exporting && (
        <div className="mb-3" role="status">
          <p className="mb-1 text-[13.5px] text-slate-800">Preparing the export… {exporting.done.toLocaleString("en-US")} of {exporting.total.toLocaleString("en-US")} records</p>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-[#e6ecf5]"><div className="h-full rounded-full bg-[#00709f] transition-all" style={{ width: `${exporting.total ? Math.round((exporting.done / exporting.total) * 100) : 0}%` }} /></div>
        </div>
      )}
      {exportMsg && <p role="status" className="mb-3 text-[13.5px] text-slate-800">{exportMsg}</p>}

      <div className="overflow-hidden rounded-2xl border border-[#e6ecf5] bg-white">
        <table className="w-full table-fixed border-collapse text-[14px]" aria-busy={loading}>
          <caption className="sr-only">Daily records of consultation visits</caption>
          <colgroup>
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr className="bg-[#f8fafd]">
              <SortableTh label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} className={TH} />
              <th scope="col" className={TH}>Course</th>
              <th scope="col" className={TH}>Year</th>
              <th scope="col" className={TH}>School</th>
              <SortableTh label="Date visited" sortKey="date" sortState={sortState} onSort={toggleSort} className={TH} />
              <th scope="col" className={TH}>Visit type</th>
              <th scope="col" className={TH}>Consultant</th>
              <th scope="col" className={`${TH} text-center`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {skeleton ? (
              Array.from({ length: 8 }, (_, i) => <tr key={i} className="border-t border-[#f0f3f8]" aria-hidden="true">{Array.from({ length: 8 }, (_, j) => <td key={j} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${50 + ((i * 7 + j * 11) % 40)}%` }} /></td>)}</tr>)
            ) : (rows ?? []).length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-700">{error ? "" : anyFilter ? <>No daily record matches these filters. <button type="button" onClick={clear} className="font-semibold text-[#00709f] hover:underline">Clear filters</button></> : "No daily records yet."}</td></tr>
            ) : (
              (rows ?? []).map(r => (
                <tr key={r.id} className={`border-t border-[#f0f3f8] hover:bg-[#f8fafd] ${loading ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2.5 font-medium text-[#062444]"><span className="block truncate" title={r.name}>{r.name}</span></td>
                  <td className="px-3 py-2.5 text-slate-700"><span className="block truncate" title={r.course || undefined}>{r.course || "—"}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.yearLevel || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-700"><span className="block truncate" title={r.school || undefined}>{r.school || "—"}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{formatDay(r.dateVisited)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.visitType}</td>
                  <td className="px-3 py-2.5 text-slate-700"><span className="block truncate" title={r.consultedByName || undefined}>{r.consultedByName || "—"}</span></td>
                  <td className="px-3 py-2.5 text-center">
                    <button type="button" onClick={() => setViewing(r)} title="View record" aria-label={`View record of ${r.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#0077b6] hover:bg-[#e8f3fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0077b6]"><Eye size={17} aria-hidden="true" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ServerPagination page={page} pageSize={DAILY_RECORDS_PAGE_SIZE} total={total} onPageChange={p => setPage(Math.max(1, p))} disabled={loading} />

      {showAdd && <AddDailyRecordModal onClose={() => setShowAdd(false)} onCreated={() => void load()} />}
      {showBulk && <BulkDailyRecordsModal onClose={() => setShowBulk(false)} onDone={() => void load()} />}
      {viewing && <DailyRecordDetailModal record={viewing} onClose={() => setViewing(null)} profileLoading={profileLoading} onViewProfile={() => void openProfile(viewing.scholarIdNumber)} />}
      {profile && <ScholarProfilePreviewModal scholar={profile} onClose={() => setProfile(null)} />}
    </div>
  );
}
