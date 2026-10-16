import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";

/** A question with two buttons. `onConfirm` returns an error text to show in the dialog, or null when it worked (the dialog is then closed by the caller). */
export function ConfirmDialog({ title, children, confirmLabel, danger, onCancel, onConfirm }: {
  title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() { setBusy(true); setError(""); const e = await onConfirm(); setBusy(false); if (e) setError(e); }
  return (
    <ModalShell title={title} onClose={busy ? () => undefined : onCancel}>
      <div className="space-y-3 text-[14px] text-slate-800">
        {children}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444] disabled:opacity-60">Cancel</button>
          <button onClick={() => void go()} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60 ${danger ? "bg-red-800 hover:bg-red-900" : "bg-[#062444] hover:bg-[#0a3a6e]"}`}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Rename a file or folder. The whole name is selected, except the extension of a file, so typing keeps ".pdf". */
export function RenameDialog({ kind, name, onCancel, onRename }: { kind: "file" | "folder"; name: string; onCancel: () => void; onRename: (newName: string) => Promise<string | null> }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current; if (!el) return;
    el.focus();
    const dot = kind === "file" ? name.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [kind, name]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) { setError("Please type a name."); return; }
    setBusy(true); setError("");
    const err = await onRename(value);
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <ModalShell title={kind === "folder" ? "Rename folder" : "Rename file"} onClose={busy ? () => undefined : onCancel}>
      <form onSubmit={e => void save(e)} className="space-y-3">
        <label className="block text-[14px] font-semibold text-[#062444]">New name
          <input ref={input} value={value} onChange={e => setValue(e.target.value)} maxLength={255} className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444]" />
        </label>
        <p className="text-[13.5px] text-slate-700">If the name is already used here, a number is added: “name (1)”.</p>
        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Rename</button>
        </div>
      </form>
    </ModalShell>
  );
}
