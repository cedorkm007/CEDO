import { ModalShell } from "../SeadUiShell";

export interface ConfirmAction { label: string; tone?: "danger" | "primary"; run: () => void }

/** "Are you sure?" with what would be affected; Cancel is always there. */
export function ConfirmDialog({ title, lines, actions, busy, error, onClose }: {
  title: string; lines: string[]; actions: ConfirmAction[]; busy?: boolean; error?: string; onClose: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      {lines.map((line, i) => <p key={i} className="text-[13.5px] leading-relaxed text-[#062444]">{line}</p>)}
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/20 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-[#f7f9fc]">Cancel</button>
        {actions.map(a => (
          <button key={a.label} type="button" disabled={busy} onClick={a.run}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60 ${a.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-[#062444] hover:bg-[#0a3a6b]"}`}>
            {busy ? "Working…" : a.label}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
