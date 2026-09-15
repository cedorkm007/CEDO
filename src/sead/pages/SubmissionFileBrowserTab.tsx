import { useEffect, useState } from "react";
import { FileText, Eye } from "lucide-react";
import {
  fetchSubmissionUploadCountsByActivity, fetchSubmissionUploadCountsByYearLevel, fetchSubmissionUploadCountsBySchool,
  fetchSubmissionFiles, type SubmissionUploadActivityCount, type SubmissionUploadGroupCount, type SubmissionFileRow,
} from "../submissionActivitiesApi";
import { GroupCountBreakdown, type GroupCountRow } from "../components/GroupCountBreakdown";
import { Modal } from "../components/Modal";
import { SubmissionFilePreviewModal } from "../components/SubmissionFilePreviewModal";

function LoadingPanel({ label }: { label: string }) {
  return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">{label}</div>;
}

function EmptyPanel({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">{label}</p>;
}

function Crumb({ label, onClick, current }: { label: string; onClick?: () => void; current?: boolean }) {
  if (!onClick) return <span className={current ? "font-bold text-[#062444]" : "text-slate-500"}>{label}</span>;
  return <button onClick={onClick} className="text-[#0088cc] hover:underline font-semibold">{label}</button>;
}

const STATUS_LABELS: Record<string, string> = { accepted: "Accepted", needs_resubmission: "Needs Resubmission", uploaded: "Pending Review" };
const STATUS_CLASSES: Record<string, string> = {
  accepted: "bg-emerald-50 text-emerald-700", needs_resubmission: "bg-red-50 text-red-700", uploaded: "bg-amber-50 text-amber-700",
};

/**
 * Staff-facing file browser: drills Activity -> Year Level -> School, then
 * a flat list of files at the leaf level. Structured like
 * ScholarshipProgramInfoPage.tsx's own School drill-down (Crumb/reset/
 * handleSelect pattern, GroupCountBreakdown for the count levels, a Modal
 * for the leaf level) — files just replace scholars as the thing being
 * browsed to.
 */
export function SubmissionFileBrowserTab() {
  const [activityCounts, setActivityCounts] = useState<SubmissionUploadActivityCount[] | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedActivity, setSelectedActivity] = useState<SubmissionUploadActivityCount | null>(null);
  const [yearLevelCounts, setYearLevelCounts] = useState<SubmissionUploadGroupCount[] | null>(null);
  const [loadingYearLevels, setLoadingYearLevels] = useState(false);

  const [selectedYearLevel, setSelectedYearLevel] = useState<string | null>(null);
  const [schoolCounts, setSchoolCounts] = useState<SubmissionUploadGroupCount[] | null>(null);
  const [loadingSchools, setLoadingSchools] = useState(false);

  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<SubmissionFileRow[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [previewing, setPreviewing] = useState<SubmissionFileRow | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setActivityCounts(await fetchSubmissionUploadCountsByActivity());
      setLoading(false);
    })();
  }, []);

  async function handleSelectActivity(activityName: string) {
    const activity = activityCounts?.find(a => a.activityName === activityName);
    if (!activity) return;
    setSelectedActivity(activity);
    setSelectedYearLevel(null);
    setSelectedSchool(null);
    setSchoolCounts(null);
    setFileRows(null);
    setLoadingYearLevels(true);
    setYearLevelCounts(await fetchSubmissionUploadCountsByYearLevel(activity.activityId));
    setLoadingYearLevels(false);
  }

  async function handleSelectYearLevel(yearLevel: string) {
    if (!selectedActivity) return;
    setSelectedYearLevel(yearLevel);
    setSelectedSchool(null);
    setFileRows(null);
    setLoadingSchools(true);
    setSchoolCounts(await fetchSubmissionUploadCountsBySchool(selectedActivity.activityId, yearLevel));
    setLoadingSchools(false);
  }

  async function handleSelectSchool(school: string) {
    if (!selectedActivity || !selectedYearLevel) return;
    setSelectedSchool(school);
    setLoadingFiles(true);
    setFileRows(await fetchSubmissionFiles(selectedActivity.activityId, selectedYearLevel, school));
    setLoadingFiles(false);
  }

  function resetToActivities() {
    setSelectedActivity(null); setSelectedYearLevel(null); setSelectedSchool(null);
    setYearLevelCounts(null); setSchoolCounts(null); setFileRows(null);
  }
  function resetToYearLevels() {
    setSelectedYearLevel(null); setSelectedSchool(null);
    setSchoolCounts(null); setFileRows(null);
  }
  function resetToSchools() {
    setSelectedSchool(null); setFileRows(null);
  }

  if (loading) return <LoadingPanel label="Loading…" />;
  if (!activityCounts) return null;

  const activityRows: GroupCountRow[] = activityCounts.map(a => ({ label: a.activityName, count: a.uploadCount }));
  const yearLevelRows: GroupCountRow[] = (yearLevelCounts ?? []).map(c => ({ label: c.label, count: c.count }));
  const schoolRows: GroupCountRow[] = (schoolCounts ?? []).map(c => ({ label: c.label, count: c.count }));

  return (
    <div className="space-y-4">
      <div className="flex items-center flex-wrap gap-1.5 text-[12.5px]">
        <Crumb label="Activities" onClick={selectedActivity ? resetToActivities : undefined} current={!selectedActivity} />
        {selectedActivity && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedActivity.activityName} onClick={selectedYearLevel ? resetToYearLevels : undefined} current={!selectedYearLevel} />
        </>}
        {selectedYearLevel && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedYearLevel} onClick={selectedSchool ? resetToSchools : undefined} current={!selectedSchool} />
        </>}
        {selectedSchool && <>
          <span className="text-slate-300">/</span>
          <Crumb label={selectedSchool} current />
        </>}
      </div>

      {!selectedActivity && (
        activityRows.length === 0 || activityRows.every(r => r.count === 0)
          ? <EmptyPanel label="No files have been uploaded yet." />
          : <GroupCountBreakdown title="Files per Submission Activity" columnLabel="Activity" rows={activityRows} onSelect={handleSelectActivity} />
      )}
      {selectedActivity && !selectedYearLevel && (
        loadingYearLevels ? <LoadingPanel label="Loading year levels…" /> : yearLevelRows.length === 0 ? (
          <EmptyPanel label={`No files yet for "${selectedActivity.activityName}".`} />
        ) : (
          <GroupCountBreakdown title={`Files per Year Level — ${selectedActivity.activityName}`} columnLabel="Year Level" rows={yearLevelRows} onSelect={handleSelectYearLevel} />
        )
      )}
      {selectedActivity && selectedYearLevel && !selectedSchool && (
        loadingSchools ? <LoadingPanel label="Loading schools…" /> : schoolRows.length === 0 ? (
          <EmptyPanel label="No files here." />
        ) : (
          <GroupCountBreakdown title={`Files per School — ${selectedActivity.activityName}, ${selectedYearLevel}`} columnLabel="School" rows={schoolRows} onSelect={handleSelectSchool} />
        )
      )}
      {selectedActivity && selectedYearLevel && selectedSchool && (
        <Modal title={`Files — ${selectedActivity.activityName}, ${selectedYearLevel}, ${selectedSchool}`} onClose={resetToSchools}>
          {loadingFiles ? <LoadingPanel label="Loading files…" /> : (fileRows ?? []).length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-6">No files here.</p>
          ) : (
            <ul className="space-y-2">
              {(fileRows ?? []).map(f => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#e6ecf5] px-3 py-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <FileText size={16} className="shrink-0 text-[#0088cc]" />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-[#062444]">{f.displayFileName}</p>
                      <p className="text-[11px] text-slate-400">{f.scholarName} • {new Date(f.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_CLASSES[f.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABELS[f.status] ?? f.status}
                    </span>
                    {f.storagePath ? (
                      <button type="button" onClick={() => setPreviewing(f)} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                        <Eye size={13} /> Preview
                      </button>
                    ) : f.driveViewUrl ? (
                      <a href={f.driveViewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                        <Eye size={13} /> View
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {previewing && (
        <SubmissionFilePreviewModal
          upload={{ storagePath: previewing.storagePath, mimeType: previewing.mimeType, displayFileName: previewing.displayFileName, originalFileName: previewing.originalFileName }}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}
