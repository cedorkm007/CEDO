import { AlertTriangle } from "lucide-react";

export function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center mb-3">
          <AlertTriangle size={20} className="text-red-600" />
        </div>
        <h3 id="confirm-title" className="text-[15px] font-bold text-[#062444] mb-1.5">{title}</h3>
        <p className="text-[13px] text-slate-500 mb-5">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:bg-[#f7f9fc]">Cancel</button>
          <button onClick={onConfirm} className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold bg-red-600 text-white hover:bg-red-700">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
