import { X as XIcon, Plus } from "lucide-react";

/** Shared modal chrome — matches the app's existing modal convention. Used by Question Bank and Survey Tools. */
export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl sticky top-0">
          <h3 className="text-white font-bold text-[15px]">{title}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XIcon size={18} /></button>
        </div>
        <div className="p-6 space-y-3">{children}</div>
      </div>
    </div>
  );
}

/** Compact column header with an optional "Add" button that opens a modal. */
export function ColumnHeader({ title, subtitle, onAdd, addLabel }: { title: string; subtitle?: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="px-4 py-3 border-b border-[#e6ecf5] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[12.5px] font-bold text-[#062444] truncate">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[10.5px] text-slate-400 truncate">{subtitle}</p>}
      </div>
      {onAdd && (
        <button onClick={onAdd} className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
          <Plus size={14} /> {addLabel}
        </button>
      )}
    </div>
  );
}

/** Placeholder shown in a column when nothing is selected upstream (e.g. no subject/survey picked yet). */
export function EmptyColumn({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-[#e6ecf5] flex flex-col items-center justify-center text-center px-4 py-10">
      <h3 className="text-[12.5px] font-bold text-[#062444] mb-1">{title}</h3>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
