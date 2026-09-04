import { useEffect, useState } from "react";
import { MapPin, School as SchoolIcon, BarChart3, ChevronLeft, AlertTriangle } from "lucide-react";
import {
  fetchScholarshipStatusCounts, fetchScholarsByBarangay, fetchAllScholarsInformationForExport,
  fetchScholarsBySchool, fetchScholarsBySchoolYearLevel, fetchScholarsBySchoolYearLevelCourse,
  fetchScholarsByYearLevelForStatus, fetchScholarsBySchoolForStatus, fetchScholarsByBarangayForStatus,
  type ScholarshipStatusCounts, type ScholarInformationRow,
} from "../seadApi";
import type { ScholarshipStatus } from "../types";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { ScholarListPanel } from "../components/ScholarListPanel";
import { GroupCountBreakdown, type GroupCountRow } from "../components/GroupCountBreakdown";
import { Modal } from "../components/Modal";

type InfoSubtab = "barangay" | "school";
type StatusDimension = "yearLevel" | "school" | "barangay";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Birds-eye view of the scholarship program (see the approved plan for
 * the full 5-phase design). Covers Phase 1 (status counts + subtab
 * shell), Phase 2 (Barangay breakdown), and Phase 3 (School -> Year
 * Level -> Course drill-down). Per-scholar comprehensive profile export
 * lands in Phase 4.
 */
export function ScholarshipProgramInfoPage() {
  const [counts, setCounts] = useState<ScholarshipStatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subtab, setSubtab] = useState<InfoSubtab>("barangay");
  const [activeStatus, setActiveStatus] = useState<ScholarshipStatus | null>(null);

  async function loadCounts() {
    setLoading(true);
    setError("");
    const result = await fetchScholarshipStatusCounts();
    if (result.ok && result.counts) {
      setCounts(result.counts);
    } else {
      setError(result.error || "Failed to load Scholarship Status counts.");
    }
    setLoading(false);
  }

  useEffect(() => { loadCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={20} className="text-[#062444]" />
        <h2 className="text-lg font-bold text-[#062444]">Scholarship Program Information</h2>
      </div>
      <p className="text-[12.5px] text-slate-500 mb-5">A birds-eye view of the scholarship program.</p>

      {error && <div className="mb-4"><ErrorRetry message={error} onRetry={loadCounts} /></div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Regular" value={counts?.regular} loading={loading} colorClasses="bg-green-100 text-green-700" onClick={() => setActiveStatus("Regular")} />
        <StatCard label="Probationary" value={counts?.probationary} loading={loading} colorClasses="bg-red-100 text-red-600" onClick={() => setActiveStatus("Probationary")} />
        <StatCard label="On leave" value={counts?.onLeave} loading={loading} colorClasses="bg-amber-100 text-amber-700" onClick={() => setActiveStatus("On leave")} />
        <StatCard label="Reconsidered" value={counts?.reconsidered} loading={loading} colorClasses="bg-blue-100 text-blue-700" onClick={() => setActiveStatus("Reconsidered")} />
      </div>

      {activeStatus && <StatusDrilldown status={activeStatus} onClose={() => setActiveStatus(null)} />}

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setSubtab("barangay")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "barangay" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <MapPin size={14} /> Barangay
        </button>
        <button onClick={() => setSubtab("school")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${subtab === "school" ? "bg-[#062444] text-white" : "bg-white border border-[#e6ecf5] text-slate-500 hover:bg-[#f8fafd]"}`}>
          <SchoolIcon size={14} /> School
        </button>
      </div>

      {subtab === "barangay" ? <BarangaySubtab /> : <SchoolSubtab />}
    </div>
  );
}

function StatCard({ label, value, loading, colorClasses, onClick }: { label: string; value: number | undefined; loading: boolean; colorClasses: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick || loading}
      className="bg-white rounded-2xl border border-[#e6ecf5] p-4 text-left hover:border-[#0088cc]/40 hover:shadow-sm transition disabled:cursor-default disabled:hover:border-[#e6ecf5] disabled:hover:shadow-none">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>
      {loading ? (
        <p className="text-2xl font-extrabold text-slate-300">—</p>
      ) : (
        <span className={`inline-block text-2xl font-extrabold rounded-lg px-2.5 py-0.5 ${colorClasses}`}>{value?.toLocaleString() ?? 0}</span>
      )}
    </button>
  );
}

const STATUS_DIMENSIONS: { key: StatusDimension; label: string }[] = [
  { key: "yearLevel", label: "Year Level" },
  { key: "school", label: "School" },
  { key: "barangay", label: "Barangay" },
];

/**
 * Popup opened from clicking a status stat card (Regular / Probationary /
 * On leave / Reconsidered): first asks which dimension to break that
 * status down by, then shows the same GroupCountBreakdown used
 * everywhere else in this tab, scoped to that one status. Selecting a
 * row opens a second, stacked (`elevated`) modal with the matching
 * scholar list — reusing ScholarListPanel as-is, so the CSV/PDF/Word
 * list export and the per-scholar comprehensive-profile download menu
 * both come for free.
 */
function StatusDrilldown({ status, onClose }: { status: ScholarshipStatus; onClose: () => void }) {
  const [dimension, setDimension] = useState<StatusDimension | null>(null);
  const [rows, setRows] = useState<GroupCountRow[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");

  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [scholarRows, setScholarRows] = useState<ScholarInformationRow[] | null>(null);
  const [loadingScholars, setLoadingScholars] = useState(false);

  async function handleChooseDimension(key: StatusDimension) {
    setDimension(key);
    setRows(null);
    setError("");
    setLoadingRows(true);
    if (key === "yearLevel") {
      const result = await fetchScholarsByYearLevelForStatus(status);
      if (result.ok && result.counts) {
        const byLevel = new Map(result.counts.map(c => [c.label, c.count]));
        setRows(FORMATION_YEAR_LEVELS.map(l => ({ label: l, count: byLevel.get(l) ?? 0 })));
      } else {
        setError(result.error || "Failed to load the Year Level breakdown.");
      }
    } else if (key === "school") {
      const result = await fetchScholarsBySchoolForStatus(status);
      if (result.ok && result.counts) setRows([...result.counts].sort((a, b) => b.count - a.count));
      else setError(result.error || "Failed to load the School breakdown.");
    } else {
      const result = await fetchScholarsByBarangayForStatus(status);
      if (result.ok && result.counts) {
        const byBarangay = new Map(result.counts.map(c => [c.label, c.count]));
        setRows(ALL_BARANGAYS.map(b => ({ label: b, count: byBarangay.get(b) ?? 0 })).sort((a, b) => b.count - a.count));
      } else {
        setError(result.error || "Failed to load the Barangay breakdown.");
      }
    }
    setLoadingRows(false);
  }

  async function handleSelectValue(value: string) {
    if (!dimension) return;
    setSelectedValue(value);
    setLoadingScholars(true);
    const filters = dimension === "yearLevel" ? { status, yearLevel: value } : dimension === "school" ? { status, schoolExact: value } : { status, barangay: value };
    const rows = await fetchAllScholarsInformationForExport(filters);
    setScholarRows(rows);
    setLoadingScholars(false);
  }

  function handleBack() {
    setDimension(null);
    setRows(null);
    setError("");
  }

  const dimensionLabel = STATUS_DIMENSIONS.find(d => d.key === dimension)?.label ?? "";

  return (
    <Modal title={dimension ? `${status} — By ${dimensionLabel}` : `${status} Scholars`} onClose={onClose}>
      {!dimension ? (
        <div className="space-y-3">
          <p className="text-[12.5px] text-slate-500">Break this status down by:</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STATUS_DIMENSIONS.map(d => (
              <button key={d.key} onClick={() => handleChooseDimension(d.key)}
                className="bg-white rounded-xl border border-[#e6ecf5] px-4 py-5 text-center font-bold text-[13px] text-[#062444] hover:border-[#0088cc]/40 hover:shadow-sm transition">
                {d.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button onClick={handleBack} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
            <ChevronLeft size={13} /> Choose a different breakdown
          </button>
          {error && <ErrorRetry message={error} onRetry={() => handleChooseDimension(dimension)} />}
          {loadingRows ? <LoadingPanel label="Loading…" /> : rows && (
            <GroupCountBreakdown title={`${status} Scholars per ${dimensionLabel}`} columnLabel={dimensionLabel} rows={rows} onSelect={handleSelectValue} />
          )}
        </div>
      )}

      {selectedValue && (
        <Modal elevated title={`${status} — ${dimensionLabel}: ${selectedValue}`} onClose={() => { setSelectedValue(null); setScholarRows(null); }}>
          {loadingScholars ? <LoadingPanel label="Loading scholars…" /> : (
            <ScholarListPanel
              title={`${status} — ${selectedValue}`}
              rows={scholarRows ?? []}
              filtersSummary={`Filters: Status = ${status}; ${dimensionLabel} = ${selectedValue}`}
              filenamePrefix={`scholars-${slugify(status)}-${slugify(dimensionLabel)}-${slugify(selectedValue)}`}
              defaultExpanded
              modalLevel={1}
            />
          )}
        </Modal>
      )}
    </Modal>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">{label}</div>;
}

/** Consistent error + Retry affordance for every load failure in this tab, matching the AlertTriangle/Retry convention used elsewhere in the SEAD app (e.g. RankingsTab). */
function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-red-600 bg-red-50 rounded-lg px-3 py-2">
      <AlertTriangle size={13} /> {message}
      <button onClick={onRetry} className="underline font-semibold ml-1">Retry</button>
    </p>
  );
}

/**
 * All 80 CDO barangays, real counts merged in (zero for any barangay
 * with no scholars — ALL_BARANGAYS is the canonical list, not derived
 * from who actually has scholars), sorted by count so both the chart and
 * table read most-to-least at a glance.
 */
function BarangaySubtab() {
  const [counts, setCounts] = useState<GroupCountRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [scholarRows, setScholarRows] = useState<ScholarInformationRow[] | null>(null);
  const [loadingScholars, setLoadingScholars] = useState(false);

  async function loadCounts() {
    setLoading(true);
    setError("");
    const result = await fetchScholarsByBarangay();
    if (result.ok && result.counts) {
      const byBarangay = new Map(result.counts.map(c => [c.barangay, c.count]));
      const merged = ALL_BARANGAYS.map(b => ({ label: b, count: byBarangay.get(b) ?? 0 }))
        .sort((a, b) => b.count - a.count);
      setCounts(merged);
    } else {
      setError(result.error || "Failed to load barangay counts.");
    }
    setLoading(false);
  }

  useEffect(() => { loadCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function handleSelect(barangay: string) {
    setSelected(barangay);
    setLoadingScholars(true);
    const rows = await fetchAllScholarsInformationForExport({ barangay });
    setScholarRows(rows);
    setLoadingScholars(false);
  }

  function handleClose() {
    setSelected(null);
    setScholarRows(null);
  }

  if (loading) return <LoadingPanel label="Loading…" />;
  if (error) return <ErrorRetry message={error} onRetry={loadCounts} />;
  if (!counts) return null;

  return (
    <div className="space-y-4">
      <GroupCountBreakdown title="Scholars per Barangay" columnLabel="Barangay" rows={counts} onSelect={handleSelect} />

      {selected && (
        <Modal title={`Scholars in ${selected}`} onClose={handleClose}>
          {loadingScholars ? <LoadingPanel label={`Loading scholars in ${selected}…`} /> : (
            <ScholarListPanel
              title={`Scholars in ${selected}`}
              rows={scholarRows ?? []}
              filtersSummary={`Filters: Barangay = ${selected}`}
              filenamePrefix={`scholars-barangay-${slugify(selected)}`}
              defaultExpanded
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * School -> Year Level -> Course drill-down. Unlike Barangay, School has
 * no fixed canonical list — it's whatever distinct school values
 * currently exist in scholars.school, expected to grow/shrink as the
 * program adds or drops partner schools, so nothing here assumes any
 * particular count or set of schools.
 */
function SchoolSubtab() {
  const [schoolCounts, setSchoolCounts] = useState<GroupCountRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [yearLevelCounts, setYearLevelCounts] = useState<GroupCountRow[] | null>(null);
  const [loadingYearLevels, setLoadingYearLevels] = useState(false);
  const [yearLevelError, setYearLevelError] = useState("");

  const [selectedYearLevel, setSelectedYearLevel] = useState<string | null>(null);
  const [courseCounts, setCourseCounts] = useState<GroupCountRow[] | null>(null);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [courseError, setCourseError] = useState("");

  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [scholarRows, setScholarRows] = useState<ScholarInformationRow[] | null>(null);
  const [loadingScholars, setLoadingScholars] = useState(false);

  async function loadSchoolCounts() {
    setLoading(true);
    setError("");
    const result = await fetchScholarsBySchool();
    if (result.ok && result.counts) {
      setSchoolCounts([...result.counts].map(c => ({ label: c.label, count: c.count })).sort((a, b) => b.count - a.count));
    } else {
      setError(result.error || "Failed to load school counts.");
    }
    setLoading(false);
  }

  useEffect(() => { loadSchoolCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function handleSelectSchool(school: string) {
    setSelectedSchool(school);
    setSelectedYearLevel(null);
    setSelectedCourse(null);
    setYearLevelCounts(null);
    setCourseCounts(null);
    setScholarRows(null);
    setYearLevelError("");
    setLoadingYearLevels(true);
    const result = await fetchScholarsBySchoolYearLevel(school);
    if (result.ok && result.counts) setYearLevelCounts([...result.counts].sort((a, b) => b.count - a.count));
    else setYearLevelError(result.error || "Failed to load year levels.");
    setLoadingYearLevels(false);
  }

  async function handleSelectYearLevel(yearLevel: string) {
    if (!selectedSchool) return;
    setSelectedYearLevel(yearLevel);
    setSelectedCourse(null);
    setCourseCounts(null);
    setScholarRows(null);
    setCourseError("");
    setLoadingCourses(true);
    const result = await fetchScholarsBySchoolYearLevelCourse(selectedSchool, yearLevel);
    if (result.ok && result.counts) setCourseCounts([...result.counts].sort((a, b) => b.count - a.count));
    else setCourseError(result.error || "Failed to load courses.");
    setLoadingCourses(false);
  }

  async function handleSelectCourse(course: string) {
    if (!selectedSchool || !selectedYearLevel) return;
    setSelectedCourse(course);
    setLoadingScholars(true);
    const rows = await fetchAllScholarsInformationForExport({ schoolExact: selectedSchool, yearLevel: selectedYearLevel, courseExact: course });
    setScholarRows(rows);
    setLoadingScholars(false);
  }

  function resetToSchools() {
    setSelectedSchool(null); setSelectedYearLevel(null); setSelectedCourse(null);
    setYearLevelCounts(null); setCourseCounts(null); setScholarRows(null);
  }
  function resetToYearLevels() {
    setSelectedYearLevel(null); setSelectedCourse(null);
    setCourseCounts(null); setScholarRows(null);
  }
  function resetToCourses() {
    setSelectedCourse(null); setScholarRows(null);
  }

  if (loading) return <LoadingPanel label="Loading…" />;
  if (error) return <ErrorRetry message={error} onRetry={loadSchoolCounts} />;
  if (!schoolCounts) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center flex-wrap gap-1.5 text-[12.5px]">
        <Crumb label="Schools" onClick={selectedSchool ? resetToSchools : undefined} current={!selectedSchool} />
        {selectedSchool && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedSchool} onClick={selectedYearLevel ? resetToYearLevels : undefined} current={!selectedYearLevel} />
        </>}
        {selectedYearLevel && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedYearLevel} current />
        </>}
      </div>

      {!selectedSchool && (
        <GroupCountBreakdown title="Scholars per School" columnLabel="School" rows={schoolCounts} onSelect={handleSelectSchool} />
      )}
      {selectedSchool && !selectedYearLevel && (
        loadingYearLevels ? <LoadingPanel label="Loading year levels…" /> : yearLevelError ? (
          <ErrorRetry message={yearLevelError} onRetry={() => handleSelectSchool(selectedSchool)} />
        ) : (
          <GroupCountBreakdown title={`Scholars per Year Level — ${selectedSchool}`} columnLabel="Year Level" rows={yearLevelCounts ?? []} onSelect={handleSelectYearLevel} />
        )
      )}
      {selectedSchool && selectedYearLevel && (
        loadingCourses ? <LoadingPanel label="Loading courses…" /> : courseError ? (
          <ErrorRetry message={courseError} onRetry={() => handleSelectYearLevel(selectedYearLevel)} />
        ) : (
          <GroupCountBreakdown title={`Scholars per Course — ${selectedSchool}, ${selectedYearLevel}`} columnLabel="Course" rows={courseCounts ?? []} onSelect={handleSelectCourse} />
        )
      )}
      {selectedSchool && selectedYearLevel && selectedCourse && (
        <Modal title={`Scholars — ${selectedSchool}, ${selectedYearLevel}, ${selectedCourse}`} onClose={resetToCourses}>
          {loadingScholars ? <LoadingPanel label="Loading scholars…" /> : (
            <ScholarListPanel
              title={`Scholars — ${selectedSchool}, ${selectedYearLevel}, ${selectedCourse}`}
              rows={scholarRows ?? []}
              filtersSummary={`Filters: School = ${selectedSchool}; Year Level = ${selectedYearLevel}; Course = ${selectedCourse}`}
              filenamePrefix={`scholars-${slugify(selectedSchool)}-${slugify(selectedYearLevel)}-${slugify(selectedCourse)}`}
              defaultExpanded
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function Crumb({ label, onClick, current }: { label: string; onClick?: () => void; current?: boolean }) {
  if (!onClick) return <span className={current ? "font-bold text-[#062444]" : "text-slate-500"}>{label}</span>;
  return <button onClick={onClick} className="text-[#0088cc] hover:underline font-semibold">{label}</button>;
}
