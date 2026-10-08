import { AlertTriangle } from "lucide-react";

interface DeleteSurveyModalProps {
  surveyTitle: string;
  responseCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteSurveyModal({ surveyTitle, responseCount, deleting, onCancel, onConfirm }: DeleteSurveyModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-survey-title">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center mb-3">
          <AlertTriangle size={20} className="text-red-600" />
        </div>
        <h3 id="delete-survey-title" className="text-[15px] font-bold text-[#062444] mb-1.5">Delete "{surveyTitle}"?</h3>
        <p className="text-[13px] text-slate-500 mb-5">
          This permanently deletes the survey, its questions, its sharing settings
          {responseCount > 0 ? <> and <span className="font-semibold text-red-600">all {responseCount} collected response{responseCount === 1 ? "" : "s"}</span></> : null}.
          The public link and QR code will stop working. This can't be undone.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={deleting} className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:bg-[#f7f9fc] disabled:opacity-50">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
