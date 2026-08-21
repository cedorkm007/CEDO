import { useEffect, useState } from "react";
import { UploadCloud, Info } from "lucide-react";
import {
  fetchSubmissionActivitiesForScholar, isAllowedSubmissionFileType, submissionAllowedFileTypesLabel,
  SUBMISSION_ALLOWED_FILE_TYPES, type SubmissionActivityForScholar, type SubmissionUploadFieldForScholar,
} from "../../submissionsApi";

/**
 * One activity's upload form. Files are picked and validated entirely
 * client-side (type + per-field max count) — there is nothing to actually
 * submit to yet (Google Drive integration is Parts 3-4), so clicking
 * Submit never calls any write function; it only shows the placeholder
 * message below. No file ever leaves the browser in this part.
 */
function SubmissionActivityCard({ activity }: { activity: SubmissionActivityForScholar }) {
  const [filesByField, setFilesByField] = useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleFilesSelected(field: SubmissionUploadFieldForScholar, fileList: FileList | null) {
    const selected = fileList ? Array.from(fileList) : [];
    let error = "";
    if (selected.length > field.maxFiles) {
      error = `You can select up to ${field.maxFiles} file${field.maxFiles === 1 ? "" : "s"} here.`;
    } else {
      const badFile = selected.find(f => !isAllowedSubmissionFileType(f));
      if (badFile) error = `"${badFile.name}" isn't an accepted file type. Allowed: ${submissionAllowedFileTypesLabel()}.`;
    }
    setFilesByField(prev => ({ ...prev, [field.id]: error ? [] : selected }));
    setFieldErrors(prev => ({ ...prev, [field.id]: error }));
    setSubmitted(false); // picking new files after a placeholder "submit" re-opens the form rather than staying on the stale message
  }

  function handleSubmit() {
    setSubmitAttempted(true);
    const missingRequired = activity.uploadFields.some(f => f.isRequired && (filesByField[f.id]?.length ?? 0) === 0);
    const hasErrors = Object.values(fieldErrors).some(Boolean);
    if (missingRequired || hasErrors) return;
    setSubmitted(true);
  }

  return (
    <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3.5">
      <p className="text-[13.5px] font-bold text-[#062444]">{activity.name}</p>
      {activity.description && <p className="mt-1 text-[12px] text-slate-500">{activity.description}</p>}

      <div className="mt-3 space-y-3">
        {activity.uploadFields.map(field => (
          <div key={field.id}>
            <label className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold text-[#062444]">
              {field.label}
              {field.isRequired ? <span className="text-red-500">*</span> : <span className="font-normal text-slate-400">(optional)</span>}
              <span className="ml-auto text-[11px] font-normal text-slate-400">Up to {field.maxFiles} file{field.maxFiles === 1 ? "" : "s"}</span>
            </label>
            <input
              type="file"
              multiple={field.maxFiles > 1}
              accept={SUBMISSION_ALLOWED_FILE_TYPES.flatMap(t => t.extensions).join(",")}
              onChange={event => handleFilesSelected(field, event.target.files)}
              aria-label={field.label}
              className="block w-full text-[12px] text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#eef3fb] file:px-3 file:py-1.5 file:text-[11.5px] file:font-bold file:text-[#0088cc]"
            />
            {fieldErrors[field.id] && <p className="mt-1 text-[11.5px] text-red-600">{fieldErrors[field.id]}</p>}
            {submitAttempted && field.isRequired && (filesByField[field.id]?.length ?? 0) === 0 && !fieldErrors[field.id] && (
              <p className="mt-1 text-[11.5px] text-red-600">This file is required.</p>
            )}
            {!fieldErrors[field.id] && (filesByField[field.id]?.length ?? 0) > 0 && (
              <p className="mt-1 text-[11.5px] text-slate-500">Selected: {filesByField[field.id].map(f => f.name).join(", ")}</p>
            )}
          </div>
        ))}
      </div>

      {submitted ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-[#fff7e6] px-3 py-2 text-[12px] font-semibold text-[#8a6300]">
          <Info size={14} className="mt-0.5 shrink-0" />
          Google Drive upload will be connected next — your files haven't been sent anywhere yet.
        </p>
      ) : (
        <button type="button" onClick={handleSubmit} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2 text-[12.5px] font-bold text-[#F3BC00]">
          <UploadCloud size={14} /> Submit
        </button>
      )}
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
