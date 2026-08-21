import { useEffect, useState } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, RotateCw } from "lucide-react";
import {
  fetchSubmissionActivitiesForScholar, isAllowedSubmissionFileType, submissionAllowedFileTypesLabel,
  uploadSubmissionFile, fetchSubmissionUploadsForScholar,
  SUBMISSION_ALLOWED_FILE_TYPES, type SubmissionActivityForScholar, type SubmissionUploadFieldForScholar,
  type SubmissionUploadRecord,
} from "../../submissionsApi";

type FileUploadStatus = "uploading" | "uploaded" | "error";

/** Identifies one in-flight/just-picked file within a field for status tracking. Not a stored id — just a stable-enough key for one picker session. */
function fileKey(fieldId: string, file: File): string {
  return `${fieldId}::${file.name}::${file.size}`;
}

/**
 * One activity's upload form. Part 4 wires this to the real
 * submission-upload-file Edge Function — no more "Google Drive upload
 * will be connected next" placeholder. Files upload as soon as Submit is
 * pressed (after client-side type/count validation passes), each file
 * tracked individually so one failing file doesn't block or hide the
 * others, and a failed file can be retried in place without re-picking
 * it. Already-uploaded files are fetched on mount so reopening this tab
 * shows real prior submissions instead of an empty picker.
 */
function SubmissionActivityCard({ activity }: { activity: SubmissionActivityForScholar }) {
  const [existingUploads, setExistingUploads] = useState<SubmissionUploadRecord[]>([]);
  const [filesByField, setFilesByField] = useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileStatuses, setFileStatuses] = useState<Record<string, { status: FileUploadStatus; error?: string }>>({});

  useEffect(() => {
    fetchSubmissionUploadsForScholar(activity.id).then(setExistingUploads);
  }, [activity.id]);

  function uploadedCountFor(fieldId: string): number {
    return existingUploads.filter(u => u.fieldId === fieldId).length;
  }

  function remainingSlotsFor(field: SubmissionUploadFieldForScholar): number {
    return Math.max(0, field.maxFiles - uploadedCountFor(field.id));
  }

  function handleFilesSelected(field: SubmissionUploadFieldForScholar, fileList: FileList | null) {
    const selected = fileList ? Array.from(fileList) : [];
    const remaining = remainingSlotsFor(field);
    let error = "";
    if (selected.length > remaining) {
      error = remaining === 0
        ? `You've already reached the limit of ${field.maxFiles} file${field.maxFiles === 1 ? "" : "s"} here.`
        : `You can select up to ${remaining} more file${remaining === 1 ? "" : "s"} here.`;
    } else {
      const badFile = selected.find(f => !isAllowedSubmissionFileType(f));
      if (badFile) error = `"${badFile.name}" isn't an accepted file type. Allowed: ${submissionAllowedFileTypesLabel()}.`;
    }
    setFilesByField(prev => ({ ...prev, [field.id]: error ? [] : selected }));
    setFieldErrors(prev => ({ ...prev, [field.id]: error }));
  }

  async function uploadOneFile(fieldId: string, file: File) {
    const key = fileKey(fieldId, file);
    setFileStatuses(prev => ({ ...prev, [key]: { status: "uploading" } }));
    const result = await uploadSubmissionFile(activity.id, fieldId, file);
    if (result.ok && result.upload) {
      setFileStatuses(prev => ({ ...prev, [key]: { status: "uploaded" } }));
      setExistingUploads(prev => [...prev, {
        id: result.upload!.id,
        fieldId,
        originalFileName: result.upload!.originalFileName,
        status: result.upload!.status,
        createdAt: result.upload!.createdAt,
      }]);
      setFilesByField(prev => ({ ...prev, [fieldId]: (prev[fieldId] ?? []).filter(f => f !== file) }));
    } else {
      setFileStatuses(prev => ({ ...prev, [key]: { status: "error", error: result.error ?? "Upload failed." } }));
    }
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    const missingRequired = activity.uploadFields.some(
      f => f.isRequired && uploadedCountFor(f.id) === 0 && (filesByField[f.id]?.length ?? 0) === 0,
    );
    const hasErrors = Object.values(fieldErrors).some(Boolean);
    if (missingRequired || hasErrors) return;

    setSubmitting(true);
    for (const field of activity.uploadFields) {
      for (const file of filesByField[field.id] ?? []) {
        await uploadOneFile(field.id, file);
      }
    }
    setSubmitting(false);
  }

  return (
    <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3.5">
      <p className="text-[13.5px] font-bold text-[#062444]">{activity.name}</p>
      {activity.description && <p className="mt-1 text-[12px] text-slate-500">{activity.description}</p>}

      <div className="mt-3 space-y-3">
        {activity.uploadFields.map(field => {
          const uploaded = existingUploads.filter(u => u.fieldId === field.id);
          const remaining = remainingSlotsFor(field);
          const selected = filesByField[field.id] ?? [];
          return (
            <div key={field.id}>
              <label className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold text-[#062444]">
                {field.label}
                {field.isRequired ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(optional)</span>}
                <span className="ml-auto text-[11px] font-normal text-slate-400">
                  {uploaded.length}/{field.maxFiles} file{field.maxFiles === 1 ? "" : "s"}
                </span>
              </label>

              {uploaded.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {uploaded.map(u => (
                    <li key={u.id} className="flex items-center gap-1.5 text-[11.5px] text-emerald-700">
                      <CheckCircle2 size={13} className="shrink-0" /> {u.originalFileName}
                    </li>
                  ))}
                </ul>
              )}

              {remaining > 0 && (
                <input
                  type="file"
                  multiple={remaining > 1}
                  accept={SUBMISSION_ALLOWED_FILE_TYPES.flatMap(t => t.extensions).join(",")}
                  onChange={event => handleFilesSelected(field, event.target.files)}
                  aria-label={field.label}
                  disabled={submitting}
                  className="block w-full text-[12px] text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#eef3fb] file:px-3 file:py-1.5 file:text-[11.5px] file:font-bold file:text-[#0088cc] disabled:opacity-60"
                />
              )}
              {fieldErrors[field.id] && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors[field.id]}</p>}
              {submitAttempted && field.isRequired && uploaded.length === 0 && selected.length === 0 && !fieldErrors[field.id] && (
                <p className="mt-1 text-[11.5px] text-red-600">This file is required.</p>
              )}

              {selected.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {selected.map(f => {
                    const status = fileStatuses[fileKey(field.id, f)];
                    return (
                      <li key={f.name + f.size} className="text-[11.5px]">
                        {status?.status === "uploading" && <span className="text-slate-400">Uploading “{f.name}”…</span>}
                        {!status && <span className="text-slate-500">Selected: {f.name}</span>}
                        {status?.status === "error" && (
                          <span className="flex flex-wrap items-center gap-1 text-red-600">
                            <AlertCircle size={12} className="shrink-0" /> {f.name} — {status.error}
                            <button
                              type="button"
                              onClick={() => uploadOneFile(field.id, f)}
                              className="ml-1 inline-flex items-center gap-0.5 font-bold text-[#0088cc]"
                            >
                              <RotateCw size={11} /> Retry
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2 text-[12.5px] font-bold text-[#F3BC00] disabled:opacity-60"
      >
        <UploadCloud size={14} /> {submitting ? "Uploading…" : "Submit"}
      </button>
    </div>
  );
}

/**
 * Renders inside Calendar and Activities → Activities, above the existing
 * SDP/Formation activities list — see CalendarAndActivitiesPanel.tsx.
 * Deliberately renders nothing (not even an empty-state message) when the
 * scholar has no applicable submission activities, so it doesn't add
 * visual clutter to a tab that already has its own "No upcoming
 * activities" message for the unrelated events list below it.
 */
export function SubmissionActivitiesList() {
  const [activities, setActivities] = useState<SubmissionActivityForScholar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubmissionActivitiesForScholar().then(a => { setActivities(a); setLoading(false); });
  }, []);

  if (loading) return <p className="mb-4 text-[13px] text-slate-400">Loading…</p>;
  if (activities.length === 0) return null;

  return (
    <div className="mb-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Submission Activities</p>
      <div className="space-y-2.5">
        {activities.map(activity => <SubmissionActivityCard key={activity.id} activity={activity} />)}
      </div>
    </div>
  );
}
