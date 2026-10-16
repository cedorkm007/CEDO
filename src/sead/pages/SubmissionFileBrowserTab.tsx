import { useEffect, useState } from "react";
import { FileText, Eye } from "lucide-react";
import {
  fetchSubmissionUploadCountsByActivity, fetchSubmissionUploadCountsByYearLevel, fetchSubmissionUploadCountsBySchool,
  fetchSubmissionFiles, fetchSubmissionUploadStatusCounts, fetchSubmissionActivities,
  type SubmissionActivity, type SubmissionUploadActivityCount, type SubmissionUploadGroupCount, type SubmissionFileRow, type SubmissionUploadStatusCounts, type SubmissionUploadStatus,
} from "../submissionActivitiesApi";
import { GroupCountBreakdown, type GroupCountRow } from "../components/GroupCountBreakdown";
import { Modal } from "../components/Modal";
import { SubmissionFilePreviewModal } from "../components/SubmissionFilePreviewModal";
import { SubmissionStatusScholarsPanel } from "../components/SubmissionStatusScholarsPanel";

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
/** The wording on the three totals (the stored status "uploaded" is shown as "Pending" there). */
const TILE_LABELS: Record<SubmissionUploadStatus, string> = { accepted: "Accepted", needs_resubmission: "Needs Resubmission", uploaded: "Pending" };
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
  const [statusCounts, setStatusCounts] = useState<(SubmissionUploadStatusCounts & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  // The three totals follow ONE submission activity that was created in Submission Activities (the newest by default), or all of them.
  const [createdActivities, setCreatedActivities] = useState<SubmissionActivity[]>([]);
  const [statusActivityId, setStatusActivityId] = useState<string | null>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);

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
  // Which of the three totals is open (its scholars are listed below, with Year Level / School filters). null = the normal Activity drill-down.
  const [statusView, setStatusView] = useState<SubmissionUploadStatus | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [activities, created] = await Promise.all([fetchSubmissionUploadCountsByActivity(), fetchSubmissionActivities()]);
      setActivityCounts(activities);
      setCreatedActivities(created);                       // newest first
      setStatusActivityId(created[0]?.id ?? null);
      setStatusReady(true);
      setLoading(false);
    })();
  }, []);

  // The totals are read again whenever another activity is chosen.
  useEffect(() => {
    if (!statusReady) return;
    let cancelled = false;
    setLoadingStatus(true);
    void fetchSubmissionUploadStatusCounts(statusActivityId).then(counts => { if (!cancelled) { setStatusCounts(counts); setLoadingStatus(false); } });
    return () => { cancelled = true; };
  }, [statusActivityId, statusReady]);
  const statusActivityName = statusActivityId === null ? "All submission activities" : createdActivities.find(a => a.id === statusActivityId)?.name ?? "Submission activity";

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

      {!selectedActivity && createdActivities.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor="status-activity" className="text-[13px] font-bold text-[#062444]">Submission activity</label>
          <select id="status-activity" value={statusActivityId ?? "all"} onChange={e => setStatusActivityId(e.target.value === "all" ? null : e.target.value)}
            className="max-w-full rounded-lg border border-[#062444]/15 bg-white px-3 py-2 text-[13px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            {createdActivities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="all">All submission activities</option>
          </select>
          <p className="text-[12.5px] text-slate-600">The totals count the scholars with files in that activity only.</p>
        </div>
      )}
      {!selectedActivity && statusCounts?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{statusCounts.error}</p>}

      {!selectedActivity && statusCounts && !statusCounts.error && (createdActivities.length > 0 || statusCounts.accepted + statusCounts.needsResubmission + statusCounts.pending > 0) && (
        <div role="group" aria-label={`Submission status totals for ${statusActivityName}`} aria-busy={loadingStatus} className={`grid grid-cols-3 gap-2 ${loadingStatus ? "opacity-60" : ""}`}>
          {([
            ["accepted", "Accepted", statusCounts.accepted],
            ["needs_resubmission", "Needs Resubmission", statusCounts.needsResubmission],
            ["uploaded", "Pending", statusCounts.pending],
          ] as const).map(([key, label, count]) => {
            const active = statusView === key;
            return (
              <button key={key} type="button" aria-pressed={active} onClick={() => setStatusView(active ? null : key)}
                title={active ? "Click to close this list" : `Show the scholars with ${label} files`}
                className={`rounded-xl px-4 py-3 text-center transition ${STATUS_CLASSES[key]} ${active ? "ring-2 ring-offset-1 ring-[#062444]" : "hover:opacity-80"}`}>
                <p className="text-[20px] font-extrabold">{count.toLocaleString()}</p>
                <p className="text-[12px] font-bold uppercase tracking-wide leading-tight">{label}</p>
                <p className="mt-0.5 text-[12px] font-semibold">{active ? "Hide list" : "View scholars"}</p>
              </button>
            );
          })}
        </div>
      )}

      {!selectedActivity && statusView && (
        <SubmissionStatusScholarsPanel status={statusView} label={TILE_LABELS[statusView]} activityId={statusActivityId} activityName={statusActivityName} />
      )}

      {!selectedActivity && !statusView && (
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
