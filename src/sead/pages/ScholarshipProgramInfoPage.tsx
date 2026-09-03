import { useEffect, useState } from "react";
import { MapPin, School as SchoolIcon, BarChart3 } from "lucide-react";
import {
  fetchScholarshipStatusCounts, fetchScholarsByBarangay, fetchAllScholarsInformationForExport,
  fetchScholarsBySchool, fetchScholarsBySchoolYearLevel, fetchScholarsBySchoolYearLevelCourse,
  type ScholarshipStatusCounts, type ScholarInformationRow,
} from "../seadApi";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";
import { ScholarListPanel } from "../components/ScholarListPanel";
import { GroupCountBreakdown, type GroupCountRow } from "../components/GroupCountBreakdown";

type InfoSubtab = "barangay" | "school";

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

  useEffect(() => {
    (async () => {
      const result = await fetchScholarshipStatusCounts();
      if (result.ok && result.counts) {
        setCounts(result.counts);
      } else {
        setError(result.error || "Failed to load Scholarship Status counts.");
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={20} className="text-[#062444]" />
        <h2 className="text-lg font-bold text-[#062444]">Scholarship Program Information</h2>
      </div>
      <p className="text-[12.5px] text-slate-500 mb-5">A birds-eye view of the scholarship program.</p>

      {error && <p className="mb-4 text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Regular" value={counts?.regular} loading={loading} colorClasses="bg-green-100 text-green-700" />
        <StatCard label="Probationary" value={counts?.probationary} loading={loading} colorClasses="bg-red-100 text-red-600" />
        <StatCard label="On leave" value={counts?.onLeave} loading={loading} colorClasses="bg-amber-100 text-amber-700" />
        <StatCard label="Reconsidered" value={counts?.reconsidered} loading={loading} colorClasses="bg-blue-100 text-blue-700" />
      </div>

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

function StatCard({ label, value, loading, colorClasses }: { label: string; value: number | undefined; loading: boolean; colorClasses: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>
      {loading ? (
        <p className="text-2xl font-extrabold text-slate-300">—</p>
      ) : (
        <span className={`inline-block text-2xl font-extrabold rounded-lg px-2.5 py-0.5 ${colorClasses}`}>{value?.toLocaleString() ?? 0}</span>
      )}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">{label}</div>;
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

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  async function handleSelect(barangay: string) {
    setSelected(barangay);
    setLoadingScholars(true);
    const rows = await fetchAllScholarsInformationForExport({ barangay });
    setScholarRows(rows);
    setLoadingScholars(false);
  }

  if (loading) return <LoadingPanel label="Loading…" />;
  if (error) return <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>;
  if (!counts) return null;

  return (
    <div className="space-y-4">
      <GroupCountBreakdown title="Scholars per Barangay" columnLabel="Barangay" rows={counts} onSelect={handleSelect} />

      {selected && (
        loadingScholars ? <LoadingPanel label={`Loading scholars in ${selected}…`} /> : (
          <ScholarListPanel
            title={`Scholars in ${selected}`}
            rows={scholarRows ?? []}
            filtersSummary={`Filters: Barangay = ${selected}`}
            filenamePrefix={`scholars-barangay-${slugify(selected)}`}
            defaultExpanded
          />
        )
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

  const [selectedYearLevel, setSelectedYearLevel] = useState<string | null>(null);
  const [courseCounts, setCourseCounts] = useState<GroupCountRow[] | null>(null);
  const [loadingCourses, setLoadingCourses] = useState(false);

  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [scholarRows, setScholarRows] = useState<ScholarInformationRow[] | null>(null);
  const [loadingScholars, setLoadingScholars] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await fetchScholarsBySchool();
      if (result.ok && result.counts) {
        setSchoolCounts([...result.counts].map(c => ({ label: c.label, count: c.count })).sort((a, b) => b.count - a.count));
      } else {
        setError(result.error || "Failed to load school counts.");
      }
      setLoading(false);
    })();
  }, []);

  async function handleSelectSchool(school: string) {
    setSelectedSchool(school);
    setSelectedYearLevel(null);
    setSelectedCourse(null);
    setYearLevelCounts(null);
    setCourseCounts(null);
    setScholarRows(null);
    setLoadingYearLevels(true);
    const result = await fetchScholarsBySchoolYearLevel(school);
    if (result.ok && result.counts) setYearLevelCounts([...result.counts].sort((a, b) => b.count - a.count));
    setLoadingYearLevels(false);
  }

  async function handleSelectYearLevel(yearLevel: string) {
    if (!selectedSchool) return;
    setSelectedYearLevel(yearLevel);
    setSelectedCourse(null);
    setCourseCounts(null);
    setScholarRows(null);
    setLoadingCourses(true);
    const result = await fetchScholarsBySchoolYearLevelCourse(selectedSchool, yearLevel);
    if (result.ok && result.counts) setCourseCounts([...result.counts].sort((a, b) => b.count - a.count));
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
  if (error) return <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>;
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
          <Crumb label={selectedYearLevel} onClick={selectedCourse ? resetToCourses : undefined} current={!selectedCourse} />
        </>}
        {selectedCourse && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedCourse} current />
        </>}
      </div>

      {!selectedSchool && (
        <GroupCountBreakdown title="Scholars per School" columnLabel="School" rows={schoolCounts} onSelect={handleSelectSchool} />
      )}
      {selectedSchool && !selectedYearLevel && (
        loadingYearLevels ? <LoadingPanel label="Loading year levels…" /> : (
          <GroupCountBreakdown title={`Scholars per Year Level — ${selectedSchool}`} columnLabel="Year Level" rows={yearLevelCounts ?? []} onSelect={handleSelectYearLevel} />
        )
      )}
      {selectedSchool && selectedYearLevel && !selectedCourse && (
        loadingCourses ? <LoadingPanel label="Loading courses…" /> : (
          <GroupCountBreakdown title={`Scholars per Course — ${selectedSchool}, ${selectedYearLevel}`} columnLabel="Course" rows={courseCounts ?? []} onSelect={handleSelectCourse} />
        )
      )}
      {selectedSchool && selectedYearLevel && selectedCourse && (
        loadingScholars ? <LoadingPanel label="Loading scholars…" /> : (
          <ScholarListPanel
            title={`Scholars — ${selectedSchool}, ${selectedYearLevel}, ${selectedCourse}`}
            rows={scholarRows ?? []}
            filtersSummary={`Filters: School = ${selectedSchool}; Year Level = ${selectedYearLevel}; Course = ${selectedCourse}`}
            filenamePrefix={`scholars-${slugify(selectedSchool)}-${slugify(selectedYearLevel)}-${slugify(selectedCourse)}`}
            defaultExpanded
          />
        )
      )}
    </div>
  );
}

function Crumb({ label, onClick, current }: { label: string; onClick?: () => void; current?: boolean }) {
  if (!onClick) return <span className={current ? "font-bold text-[#062444]" : "text-slate-500"}>{label}</span>;
  return <button onClick={onClick} className="text-[#0088cc] hover:underline font-semibold">{label}</button>;
}
