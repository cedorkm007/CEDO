import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "../components/SeadUiShell";

/**
 * One small dialog for every evaluator action that needs a written reason or comment (return, accept/decline a late application,
 * mark "not required", decide an INC …). `children` can add extra fields above the reason (a date, a choice).
 * `onConfirm` returns an error message to show, or null when it worked (the dialog then closes).
 */
export function ReasonDialog({
  title, intro, label, confirmLabel, minLength = 3, required = true, danger = false, onCancel, onConfirm, children, extraValid = true,
}: {
  title: string; intro?: React.ReactNode; label: string; confirmLabel: string; minLength?: number; required?: boolean; danger?: boolean;
  onCancel: () => void; onConfirm: (reason: string) => Promise<string | null>; children?: React.ReactNode; extraValid?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = (!required || reason.trim().length >= minLength) && extraValid;

  async function go() {
    setBusy(true); setError("");
    const e = await onConfirm(reason.trim());
    setBusy(false);
    if (e) setError(e);
  }

  return (
    <ModalShell title={title} onClose={onCancel} wide>
      {intro && <div className="text-[14px] text-slate-700 mb-3">{intro}</div>}
      {children}
      <label className="block text-[14px] font-semibold text-[#062444]">
        {label}{required ? "" : " (optional)"}
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
          className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
      </label>
      {required && <p className="text-[13px] text-slate-600 mt-1">At least {minLength} characters.</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
        <button onClick={() => void go()} disabled={busy || !ok}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50 ${danger ? "bg-red-700 hover:bg-red-800" : "bg-[#062444] hover:bg-[#0a3a6e]"}`}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
