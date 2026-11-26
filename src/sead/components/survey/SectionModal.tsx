import { useState } from "react";
import { ModalShell } from "../SeadUiShell";
import { saveSection } from "../../surveyEditorApi";
import type { OutlineSection } from "@/lib/surveyBuilder";

export function SectionModal({ surveyId, existing, movesExistingQuestions, onClose, onSaved }: {
  surveyId: string; existing: OutlineSection | null; movesExistingQuestions: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Enter a section title."); return; }
    setBusy(true);
    const r = await saveSection(surveyId, existing?.id ?? null, title.trim(), description.trim());
    setBusy(false);
    if (r.ok) onSaved(); else setError(r.error);
  }

  return (
    <ModalShell title={existing ? "Edit Section" : "Add Section"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {movesExistingQuestions && (
          <p className="rounded-lg bg-[#eef3fb] px-3 py-2 text-[12.5px] text-[#062444]">The questions already in this survey will be put in a first section named "Section 1". You can rename it.</p>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-500">Section title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus maxLength={200}
            className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-500">Description (optional)</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000}
            className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
        </label>
        {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="rounded-lg bg-[#062444] px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save Section"}</button>
        </div>
      </form>
    </ModalShell>
  );
}
