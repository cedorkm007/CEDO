import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createResearchProject, updateConceptSubmission, fetchCurrentStaffName,
  INTERNAL_RESEARCH_AGENDAS, EXTERNAL_RESEARCH_AGENDAS,
  type ConceptFormInput, type ResearchProject, type StageSubmission,
} from "../researchProjectApi";
import { ModalShell } from "./SeadUiShell";

const MAX_MEMBERS = 10;

export function ConceptFormModal({
  existing, onClose, onSaved,
}: { existing: { project: ResearchProject; submission: StageSubmission } | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(existing?.project.title ?? "");
  const [researchAgenda, setResearchAgenda] = useState(existing?.project.researchAgenda ?? "");
  const [leaderName, setLeaderName] = useState(existing?.project.leaderName ?? "");
  const [members, setMembers] = useState<string[]>(existing?.project.members.length ? existing.project.members : [""]);
  const [stakeholders, setStakeholders] = useState(existing?.project.stakeholders ?? "");
  const [rationale, setRationale] = useState(existing?.project.rationale ?? "");
  const [significance, setSignificance] = useState(existing?.project.significance ?? "");
  const [expectedOutcomesSummary, setExpectedOutcomesSummary] = useState(existing?.project.expectedOutcomesSummary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!existing) {
      (async () => {
        const name = await fetchCurrentStaffName();
        setLeaderName(prev => prev || name);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setMember(i: number, v: string) {
    setMembers(m => m.map((x, idx) => idx === i ? v : x));
  }
  function addMember() {
    if (members.length >= MAX_MEMBERS) return;
    setMembers(m => [...m, ""]);
  }
  function removeMember(i: number) {
    if (members.length <= 1) return;
    setMembers(m => m.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("Enter a research title."); return; }
    if (!researchAgenda) { setError("Select a research agenda."); return; }
    if (!leaderName.trim()) { setError("Enter the project leader's name."); return; }
    if (!rationale.trim() || !significance.trim() || !expectedOutcomesSummary.trim()) {
      setError("Fill in the rationale, significance, and expected outcomes summary.");
      return;
    }

    const input: ConceptFormInput = {
      title: title.trim(), researchAgenda, leaderName: leaderName.trim(),
      members: members.map(m => m.trim()).filter(Boolean),
      stakeholders: stakeholders.trim(), rationale: rationale.trim(),
      significance: significance.trim(), expectedOutcomesSummary: expectedOutcomesSummary.trim(),
    };

    setBusy(true);
    const result = existing
      ? await updateConceptSubmission(existing.project.id, existing.submission.id, input)
      : await createResearchProject(input);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onSaved();
  }

  return (
    <ModalShell title={existing ? "Edit Research Project" : "New Research Project"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Research agenda</label>
          <select value={researchAgenda} onChange={e => setResearchAgenda(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
            <option value="">Select an agenda…</option>
            <optgroup label="Internal Sources">
              {INTERNAL_RESEARCH_AGENDAS.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="External Sources">
              {EXTERNAL_RESEARCH_AGENDAS.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
          </select>
        </div>

        <div>
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Research title</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Project leader</label>
            <input value={leaderName} onChange={e => setLeaderName(e.target.value)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Stakeholders</label>
            <input value={stakeholders} onChange={e => setStakeholders(e.target.value)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12.5px] font-semibold text-slate-500">Members</label>
            {members.length < MAX_MEMBERS && (
              <button type="button" onClick={addMember} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                <Plus size={13} /> Add member
              </button>
            )}
          </div>
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={m} onChange={e => setMember(i, e.target.value)} placeholder={`Member ${i + 1}`}
                  className="flex-1 border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
                {members.length > 1 && (
                  <button type="button" onClick={() => removeMember(i)} className="shrink-0 text-slate-300 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold text-[#062444] mb-2">Summary</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Rationale</label>
              <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={3}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Significance</label>
              <textarea value={significance} onChange={e => setSignificance(e.target.value)} rows={3}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Expected Outcomes</label>
              <textarea value={expectedOutcomesSummary} onChange={e => setExpectedOutcomesSummary(e.target.value)} rows={3}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
            </div>
          </div>
        </div>

        {error && <p className="text-[13px] text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={busy}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            {busy ? "Saving…" : existing ? "Resubmit" : "Submit Proposal"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
