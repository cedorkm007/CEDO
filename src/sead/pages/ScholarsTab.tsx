import { useEffect, useState } from "react";
import { Search, UserPlus, KeyRound, ChevronLeft, ChevronRight, UploadCloud, Trash2, FilePenLine, AlertTriangle, X, Users, Info, SlidersHorizontal, Filter, RotateCcw, Download } from "lucide-react";
import { fetchScholars, resetScholarPassword, resetAllScholarPasswords, deleteScholarAccount, SCHOLARS_PAGE_SIZE, fetchScholarsInformationPage, fetchAllScholarsInformationForExport, type ScholarInformationRow, type ScholarInformationFilters } from "../seadApi";
import { AddScholarModal } from "../components/AddScholarModal";
import { BulkScholarUploadModal } from "../components/BulkScholarUploadModal";
import { BulkScholarUpdateModal } from "../components/BulkScholarUpdateModal";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { jsPDF } from "jspdf";
import type { ScholarListItem } from "../types";

type ScholarsSubtab = "account" | "information";

export function ScholarsTab() {
  const [subtab, setSubtab] = useState<ScholarsSubtab>("account");
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setSubtab("account")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "account" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <Users size={14} /> Scholars Account
        </button>
        <button onClick={() => setSubtab("information")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "information" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <Info size={14} /> Scholars Information
        </button>
      </div>
      {subtab === "account" ? <ScholarsAccountSubtab /> : <ScholarsInformationSubtab />}
    </div>
  );
}

function ScholarsAccountSubtab() {
  const [scholars, setScholars] = useState<ScholarListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [showResetAll, setShowResetAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / SCHOLARS_PAGE_SIZE));

  async function load(pageToLoad: number) {
    setLoading(true);
    const result = await fetchScholars(search, pageToLoad);
    setScholars(result.items);
    setTotal(result.total);
    setLoading(false);
  }

  // Initial load.
  useEffect(() => { load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Search changes: debounce, and always jump back to page 1 (a stale page
  // number from a previous search could be past the end of a new, smaller
  // result set).
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function goToPage(p: number) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    load(clamped);
  }

  async function handleResetPassword(scholarIdNumber: string) {
    setResetBusyId(scholarIdNumber);
    const result = await resetScholarPassword(scholarIdNumber);
    setResetBusyId(null);
    setConfirmResetId(null);
    setToast(result.ok ? `Password reset to 123456 for ${result.name}.` : (result.error || "Failed to reset password."));
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDeleteScholar(id: string) {
    setDeleteBusyId(id);
    const result = await deleteScholarAccount(id);
    setDeleteBusyId(null);
    setConfirmDeleteId(null);
    setToast(result.ok ? `Removed ${result.name}'s account.` : (result.error || "Failed to remove account."));
    setTimeout(() => setToast(null), 4000);
    if (result.ok) load(page);
  }

  function handleAllPasswordsReset(message: string) {
    setShowResetAll(false);
    setToast(message);
    setTimeout(() => setToast(null), 6000);
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * SCHOLARS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * SCHOLARS_PAGE_SIZE, total);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkUpload(true)}
            className="flex items-center gap-2 bg-white border border-[#062444]/15 text-[#062444] text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
            <UploadCloud size={15} className="text-[#0088cc]" /> Bulk Upload
          </button>
          <button onClick={() => setShowBulkUpdate(true)}
            className="flex items-center gap-2 bg-white border border-[#062444]/15 text-[#062444] text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-[#f8fafd]">
            <FilePenLine size={15} className="text-[#0088cc]" /> Bulk Update
          </button>
          <button onClick={() => setShowResetAll(true)}
            className="flex items-center gap-2 bg-white border border-red-200 text-red-600 text-[13px] font-semibold rounded-lg px-4 py-2.5 hover:bg-red-50">
            <KeyRound size={15} /> Reset All Passwords
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
            <UserPlus size={15} className="text-[#F3BC00]" /> Add Scholar
          </button>
        </div>
      </div>

      {toast && <div className="mb-4 bg-[#062444] text-white text-[13.5px] rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[12.5px] text-slate-500">
          {loading ? "Loading…" : total === 0 ? "No scholars found." : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
        </p>
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3">Scholar ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">School</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : scholars.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No scholars found.</td></tr>
            ) : (
              scholars.map(s => (
                <tr key={s.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444]">{s.scholarIdNumber}</td>
                  <td className="px-4 py-3">{s.lastName}, {s.firstName} {s.middleName}</td>
                  <td className="px-4 py-3 text-slate-500">{s.school || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${
                      s.status === "probation" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDeleteId === s.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Remove this account?</span>
                        <button onClick={() => handleDeleteScholar(s.id)} disabled={deleteBusyId === s.id}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {deleteBusyId === s.id ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : confirmResetId === s.scholarIdNumber ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[12px] text-slate-500">Reset to 123456?</span>
                        <button onClick={() => handleResetPassword(s.scholarIdNumber)} disabled={resetBusyId === s.scholarIdNumber}
                          className="text-[12px] font-bold text-red-600 hover:underline">
                          {resetBusyId === s.scholarIdNumber ? "…" : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmResetId(null)} className="text-[12px] text-slate-400 hover:underline">Cancel</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button onClick={() => setConfirmResetId(s.scholarIdNumber)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:underline">
                          <KeyRound size={13} /> Reset Password
                        </button>
                        <button onClick={() => setConfirmDeleteId(s.id)}
                          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-red-500 hover:underline">
                          <Trash2 size={13} /> Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-3">
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>

      {showAdd && <AddScholarModal onClose={() => setShowAdd(false)} onCreated={() => load(page)} />}
      {showBulkUpload && <BulkScholarUploadModal onClose={() => setShowBulkUpload(false)} onDone={() => load(page)} />}
      {showBulkUpdate && <BulkScholarUpdateModal onClose={() => setShowBulkUpdate(false)} onDone={() => load(page)} />}
      {showResetAll && <ResetAllPasswordsModal onClose={() => setShowResetAll(false)} onDone={handleAllPasswordsReset} />}
    </div>
  );
}

const INFO_COLUMNS: { key: keyof ScholarInformationRow; label: string }[] = [
  { key: "yearLevel", label: "Year Level" },
  { key: "school", label: "School" },
  { key: "barangay", label: "Barangay" },
  { key: "course", label: "Course" },
  { key: "birthday", label: "Age" }, // displayed as a computed age, stored/fetched as birthday
  { key: "civilStatus", label: "Civil Status" },
  { key: "contactNo", label: "Contact Number" },
];
const INFO_COLUMNS_STORAGE_KEY = "cedo_scholars_information_columns";

function computeAge(birthdayIso: string): string {
  if (!birthdayIso) return "—";
  const birthDate = new Date(birthdayIso);
  if (Number.isNaN(birthDate.getTime())) return "—";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear = today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return String(age);
}

/**
 * Milestone 4a: the single place that turns a row + column key into the
 * displayed/exported string, used by the on-screen table body AND both
 * export paths below — so a CSV/PDF cell can never silently show
 * something different from what's on screen for the same column.
 * `blank` lets each caller pick its own placeholder for a missing value
 * (the on-screen table and the PDF use "—" to match the existing display
 * convention; CSV uses "" since a literal em dash in a spreadsheet cell
 * meant for further data processing is more surprising than useful).
 */
function formatInfoColumnValue(row: ScholarInformationRow, key: keyof ScholarInformationRow, blank: string): string {
  if (key === "birthday") {
    const age = computeAge(row.birthday);
    return age === "—" ? blank : age;
  }
  return row[key] || blank;
}

function formatScholarName(row: ScholarInformationRow): string {
  return `${row.lastName}, ${row.firstName} ${row.middleName}`.trim();
}

/** One human-readable line summarizing the currently applied filters, for the PDF export's header block — so a downloaded report is self-describing about what it does and doesn't include. */
function describeAppliedFilters(filters: ScholarInformationFilters): string {
  const parts: string[] = [];
  if (filters.name) parts.push(`Name contains "${filters.name}"`);
  if (filters.barangay) parts.push(`Barangay = ${filters.barangay}`);
  if (filters.course) parts.push(`Course contains "${filters.course}"`);
  if (filters.school) parts.push(`School contains "${filters.school}"`);
  if (filters.yearLevel) parts.push(`Year Level = ${filters.yearLevel}`);
  if (filters.ageMin !== undefined && filters.ageMax !== undefined) parts.push(`Age ${filters.ageMin}–${filters.ageMax}`);
  else if (filters.ageMin !== undefined) parts.push(`Age ≥ ${filters.ageMin}`);
  else if (filters.ageMax !== undefined) parts.push(`Age ≤ ${filters.ageMax}`);
  return parts.length ? `Filters: ${parts.join("; ")}` : "Filters: none";
}

/** Truncates `text` (appending "…") so it fits within `maxWidth` mm at the pdf's current font — used by the PDF export's hand-drawn table cells since this project has no jspdf-autotable plugin installed to wrap/measure text automatically. */
function truncateToWidth(pdf: jsPDF, text: string, maxWidth: number): string {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && pdf.getTextWidth(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length < text.length ? `${truncated}…` : text;
}

const EMPTY_FILTERS: ScholarInformationFilters = {};

/**
 * Shell + column picker (Milestone 2) + combinable filters (Milestone 3)
 * + CSV/PDF export (Milestone 4a). Scholar ID and Full Name always show;
 * the other 7 columns are toggleable (remembered via localStorage).
 * Filters (name, barangay, course, school, year level, age range) all AND
 * together — see fetchScholarsInformationPage in seadApi.ts for where the
 * actual combining happens. Export covers the FULL currently-filtered
 * result set (not just the 50-row page on screen) and respects the
 * column picker's current visible-columns selection — both confirmed
 * directly with the person before building this milestone. Word export
 * is a separate milestone (4b), not part of this one.
 */
function ScholarsInformationSubtab() {
  const [rows, setRows] = useState<ScholarInformationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<keyof ScholarInformationRow>>(() => {
    try {
      const saved = window.localStorage.getItem(INFO_COLUMNS_STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as (keyof ScholarInformationRow)[]);
    } catch { /* fall through to default */ }
    return new Set(INFO_COLUMNS.map(c => c.key));
  });

  // Draft filter field values, edited freely in the UI before being
  // debounced into `appliedFilters` below (mirrors ScholarsAccountSubtab's
  // own search/debounce pattern for consistency). Kept separate from
  // appliedFilters so e.g. typing in the Course field doesn't refire a
  // fetch on every keystroke.
  const [nameFilter, setNameFilter] = useState("");
  const [barangayFilter, setBarangayFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [yearLevelFilter, setYearLevelFilter] = useState("");
  const [ageMinFilter, setAgeMinFilter] = useState("");
  const [ageMaxFilter, setAgeMaxFilter] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<ScholarInformationFilters>(EMPTY_FILTERS);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const activeFilterCount = Object.keys(appliedFilters).length;

  const totalPages = Math.max(1, Math.ceil(total / SCHOLARS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * SCHOLARS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * SCHOLARS_PAGE_SIZE, total);

  async function load(pageToLoad: number, filters: ScholarInformationFilters) {
    setLoading(true);
    const result = await fetchScholarsInformationPage(pageToLoad, filters);
    setRows(result.items);
    setTotal(result.total);
    setLoading(false);
  }

  useEffect(() => { load(1, EMPTY_FILTERS); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Debounce draft filter fields into appliedFilters, and drop any field
  // that's blank/unset from the object entirely (rather than sending e.g.
  // course: "") — keeps activeFilterCount and fetchScholarsInformationPage's
  // own per-field `if (filters.x)` checks both meaningful.
  useEffect(() => {
    const t = setTimeout(() => {
      const ageMin = ageMinFilter.trim() === "" ? undefined : Number(ageMinFilter);
      const ageMax = ageMaxFilter.trim() === "" ? undefined : Number(ageMaxFilter);
      const next: ScholarInformationFilters = {};
      if (nameFilter.trim()) next.name = nameFilter.trim();
      if (barangayFilter) next.barangay = barangayFilter;
      if (courseFilter.trim()) next.course = courseFilter.trim();
      if (schoolFilter.trim()) next.school = schoolFilter.trim();
      if (yearLevelFilter) next.yearLevel = yearLevelFilter;
      if (ageMin !== undefined && !Number.isNaN(ageMin)) next.ageMin = ageMin;
      if (ageMax !== undefined && !Number.isNaN(ageMax)) next.ageMax = ageMax;
      setAppliedFilters(next);
      setPage(1);
      load(1, next);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFilter, barangayFilter, courseFilter, schoolFilter, yearLevelFilter, ageMinFilter, ageMaxFilter]);

  function clearFilters() {
    setNameFilter(""); setBarangayFilter(""); setCourseFilter(""); setSchoolFilter("");
    setYearLevelFilter(""); setAgeMinFilter(""); setAgeMaxFilter("");
    // The debounce effect above will pick this up and reload with empty
    // filters — no need to duplicate that call here.
  }

  function goToPage(p: number) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    load(clamped, appliedFilters);
  }

  function toggleColumn(key: keyof ScholarInformationRow) {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { window.localStorage.setItem(INFO_COLUMNS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* non-fatal */ }
      return next;
    });
  }

  const activeColumns = INFO_COLUMNS.filter(c => visibleColumns.has(c.key));

  /**
   * Milestone 4a. Both exports share this same "Scholar ID, Name, then
   * whatever's currently visible" column shape, built fresh from
   * `activeColumns` on every call so a toggle in the column picker is
   * reflected the next time either export button is pressed — never a
   * stale snapshot of columns from an earlier open of the picker.
   */
  function buildExportColumns(): { label: string; value: (r: ScholarInformationRow) => string }[] {
    return [
      { label: "Scholar ID", value: (r: ScholarInformationRow) => r.scholarIdNumber },
      { label: "Name", value: formatScholarName },
      ...activeColumns.map(c => ({ label: c.label, value: (r: ScholarInformationRow) => formatInfoColumnValue(r, c.key, "") })),
    ];
  }

  async function handleExportCsv() {
    if (exportingCsv || exportingPdf || total === 0) return;
    setExportError(null);
    setExportingCsv(true);
    try {
      const allRows = await fetchAllScholarsInformationForExport(appliedFilters);
      const columns = buildExportColumns();
      const csvRows = allRows.map(r => columns.map(c => c.value(r)));
      downloadCsv(`scholars-information-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns.map(c => c.label), csvRows));
    } catch {
      setExportError("CSV export failed — please try again.");
    } finally {
      setExportingCsv(false);
    }
  }

  /**
   * Hand-drawn table (no jspdf-autotable in this project — see the
   * truncateToWidth helper above) rather than a table-plugin call.
   * Landscape A4 to fit up to 9 columns (Scholar ID + Name + all 7
   * optional columns) without cramming; Name gets extra column width
   * since it's typically the longest value. Paginates automatically,
   * repeating the header row on every new page, and stamps "Page X of Y"
   * once the final page count is known.
   */
  async function handleExportPdf() {
    if (exportingCsv || exportingPdf || total === 0) return;
    setExportError(null);
    setExportingPdf(true);
    try {
      const allRows = await fetchAllScholarsInformationForExport(appliedFilters);
      const exportColumns = buildExportColumns();
      const weights = exportColumns.map(c => (c.label === "Name" ? 1.6 : 1));

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const usableWidth = pageWidth - margin * 2;
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const colWidths = weights.map(w => (w / totalWeight) * usableWidth);
      const headerRowHeight = 7;
      const dataRowHeight = 6.5;

      function drawColumnHeader(y: number): number {
        pdf.setFillColor(248, 250, 253);
        pdf.rect(margin, y, usableWidth, headerRowHeight, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(0, 136, 204);
        let x = margin;
        exportColumns.forEach((c, i) => {
          pdf.text(truncateToWidth(pdf, c.label, colWidths[i] - 3), x + 1.5, y + headerRowHeight - 2);
          x += colWidths[i];
        });
        return y + headerRowHeight;
      }

      // Title block.
      let y = margin;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(6, 36, 68);
      pdf.text("Scholars Information", margin, y);
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Generated ${new Date().toLocaleString()} • ${allRows.length} scholar${allRows.length === 1 ? "" : "s"}`, margin, y);
      y += 5;
      pdf.text(describeAppliedFilters(appliedFilters), margin, y);
      y += 6;

      y = drawColumnHeader(y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);

      for (const row of allRows) {
        if (y + dataRowHeight > pageHeight - margin) {
          pdf.addPage();
          y = drawColumnHeader(margin);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7.5);
          pdf.setTextColor(51, 65, 85);
        }
        let x = margin;
        exportColumns.forEach((c, i) => {
          pdf.text(truncateToWidth(pdf, c.value(row), colWidths[i] - 3), x + 1.5, y + dataRowHeight - 2);
          x += colWidths[i];
        });
        pdf.setDrawColor(240, 243, 248);
        pdf.line(margin, y + dataRowHeight, margin + usableWidth, y + dataRowHeight);
        y += dataRowHeight;
      }

      const pageCount = pdf.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        pdf.setPage(p);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 4, { align: "right" });
      }

      pdf.save(`scholars-information-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      setExportError("PDF export failed — please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <button onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-1.5 text-[12.5px] font-semibold border rounded-lg px-3.5 py-2 ${
            activeFilterCount > 0 ? "bg-[#0088cc]/10 border-[#0088cc] text-[#0088cc]" : "bg-white border-[#e6ecf5] text-[#062444] hover:bg-[#f8fafd]"
          }`}>
          <Filter size={13} /> Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-[#062444]">
            <RotateCcw size={12} /> Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handleExportCsv} disabled={exportingCsv || exportingPdf || total === 0}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#062444] border border-[#e6ecf5] bg-white rounded-lg px-3 py-2 hover:bg-[#f8fafd] disabled:opacity-50 disabled:cursor-not-allowed">
            <Download size={13} /> {exportingCsv ? "Exporting…" : "Export CSV"}
          </button>
          <button onClick={handleExportPdf} disabled={exportingCsv || exportingPdf || total === 0}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#062444] border border-[#e6ecf5] bg-white rounded-lg px-3 py-2 hover:bg-[#f8fafd] disabled:opacity-50 disabled:cursor-not-allowed">
            <Download size={13} /> {exportingPdf ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </div>
      {exportError && (
        <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-red-600">
          <AlertTriangle size={13} /> {exportError}
        </p>
      )}

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 bg-white border border-[#e6ecf5] rounded-xl p-4">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Name</label>
            <input value={nameFilter} onChange={e => setNameFilter(e.target.value)} placeholder="Search name…"
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Barangay</label>
            <select value={barangayFilter} onChange={e => setBarangayFilter(e.target.value)}
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc] bg-white">
              <option value="">Any</option>
              {ALL_BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Course</label>
            <input value={courseFilter} onChange={e => setCourseFilter(e.target.value)} placeholder="e.g. BSIT"
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">School</label>
            <input value={schoolFilter} onChange={e => setSchoolFilter(e.target.value)} placeholder="Search school…"
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Year Level</label>
            <select value={yearLevelFilter} onChange={e => setYearLevelFilter(e.target.value)}
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc] bg-white">
              <option value="">Any</option>
              {FORMATION_YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Age (min)</label>
            <input type="number" min={0} value={ageMinFilter} onChange={e => setAgeMinFilter(e.target.value)} placeholder="e.g. 18"
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">Age (max)</label>
            <input type="number" min={0} value={ageMaxFilter} onChange={e => setAgeMaxFilter(e.target.value)} placeholder="e.g. 25"
              className="w-full text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 px-1 relative">
        <p className="text-[12.5px] text-slate-500">
          {loading ? "Loading…" : total === 0 ? "No scholars found." : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button onClick={() => setShowPicker(v => !v)}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#062444] border border-[#e6ecf5] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f8fafd]">
              <SlidersHorizontal size={13} /> Columns
            </button>
            {showPicker && (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-[#e6ecf5] bg-white p-2 shadow-lg">
                <p className="text-[10.5px] font-bold uppercase text-slate-400 px-1 mb-1">Scholar ID and Name always shown</p>
                {INFO_COLUMNS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 px-1 py-1.5 text-[12.5px] text-[#062444] cursor-pointer hover:bg-[#f8fafd] rounded">
                    <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => toggleColumn(c.key)} className="w-3.5 h-3.5 accent-[#062444]" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3 whitespace-nowrap">Scholar ID</th>
              <th className="px-4 py-3 whitespace-nowrap">Name</th>
              {activeColumns.map(c => <th key={c.key} className="px-4 py-3 whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={2 + activeColumns.length} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={2 + activeColumns.length} className="px-4 py-8 text-center text-slate-400">No scholars found.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444] whitespace-nowrap">{r.scholarIdNumber}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatScholarName(r)}</td>
                  {activeColumns.map(c => (
                    <td key={c.key} className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {formatInfoColumnValue(r, c.key, "—")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-3">
        <PaginationControls page={page} totalPages={totalPages} onGoTo={goToPage} disabled={loading} />
      </div>
    </div>
  );
}

function ResetAllPasswordsModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const canConfirm = confirmText.trim().toUpperCase() === "RESET";

  async function handleConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError("");
    setProgress(null);
    const result = await resetAllScholarPasswords((done, total) => setProgress({ done, total }));
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to reset passwords."); return; }
    const total = result.total ?? 0;
    const succeeded = result.succeeded ?? 0;
    const failed = result.failed ?? 0;
    const message = failed === 0
      ? `Reset ${succeeded} scholar password${succeeded === 1 ? "" : "s"} to 123456.`
      : `Reset ${succeeded} of ${total} scholar passwords to 123456 — ${failed} failed. Check the account log or try again for the ones that failed.`;
    onDone(message);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <span className="flex items-center gap-2 text-white font-bold text-[15px]"><KeyRound size={17} className="text-[#F3BC00]" /> Reset All Passwords</span>
          <button onClick={onClose} disabled={busy} className="text-white/70 hover:text-white disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-lg px-3.5 py-3 mb-4">
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-red-700 leading-relaxed">
              This resets <strong>every scholar's</strong> password to <strong>123456</strong> — not just the ones on this page or matching your search. It cannot be undone, and every scholar will need to sign in with the default password again.
            </p>
          </div>

          <label className="block text-[12.5px] font-semibold text-[#062444] mb-1.5">
            Type <span className="font-mono bg-[#f8fafd] border border-[#e6ecf5] rounded px-1.5 py-0.5">RESET</span> to confirm
          </label>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            disabled={busy}
            placeholder="RESET"
            className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-red-400 mb-4"
          />

          {error && <p className="text-[12.5px] text-red-600 mb-3">{error}</p>}

          {busy && (
            <div className="mb-3">
              <p className="text-[12px] text-slate-500 mb-1.5">
                {progress && progress.total > 0
                  ? `Resetting… ${progress.done} / ${progress.total}`
                  : "Starting…"}
              </p>
              <div className="w-full h-1.5 bg-[#f0f3f8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0088cc] rounded-full transition-all"
                  style={{ width: progress && progress.total > 0 ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "10%" }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="text-[13px] font-semibold text-slate-500 hover:text-[#062444] disabled:opacity-40 px-4 py-2.5">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || busy}
              className="flex items-center gap-2 bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg px-5 py-2.5 hover:bg-red-700"
            >
              {busy ? "Resetting…" : "Reset All Passwords"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaginationControls({ page, totalPages, onGoTo, disabled }: {
  page: number; totalPages: number; onGoTo: (p: number) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onGoTo(page - 1)} disabled={disabled || page <= 1}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
        <ChevronLeft size={14} /> Prev
      </button>
      <span className="text-[12.5px] text-slate-500 min-w-[90px] text-center">Page {page} of {totalPages}</span>
      <button onClick={() => onGoTo(page + 1)} disabled={disabled || page >= totalPages}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}
