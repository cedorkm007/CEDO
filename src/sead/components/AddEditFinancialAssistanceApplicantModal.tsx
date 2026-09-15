import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import {
  createFinancialAssistanceApplicant, updateFinancialAssistanceApplicant, FA_MODES_OF_APPLICATION,
  type FinancialAssistanceApplicant, type NewFinancialAssistanceApplicantInput, type FaModeOfApplication,
} from "../financialAssistanceApi";

type FormState = Omit<NewFinancialAssistanceApplicantInput, "periodId">;

const EMPTY_FORM: FormState = {
  name: "", barangay: "", school: "", program: "", yearLevel: "",
  vulnerableSector: "", modeOfApplication: "", fatherName: "", motherName: "",
};

/** Add-or-edit dual-purpose modal — mirrors SurveyQuestionEditorModal.tsx's existing/create split. Only "Add" generates a reference number + QR (via the parent's onSaved callback); editing never touches the reference number. */
export function AddEditFinancialAssistanceApplicantModal({
  periodId, existing, onClose, onSaved,
}: {
  periodId: string;
  existing: FinancialAssistanceApplicant | null;
  onClose: () => void;
  onSaved: (created?: FinancialAssistanceApplicant) => void;
}) {
  const [form, setForm] = useState<FormState>(existing ? {
    name: existing.name, barangay: existing.barangay, school: existing.school, program: existing.program,
    yearLevel: existing.yearLevel, vulnerableSector: existing.vulnerableSector, modeOfApplication: existing.modeOfApplication,
    fatherName: existing.fatherName, motherName: existing.motherName,
  } : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.modeOfApplication) { setError("Choose a mode of application."); return; }

    setBusy(true);
    if (existing) {
      const result = await updateFinancialAssistanceApplicant(existing.id, form);
      setBusy(false);
      if (!result.ok) { setError(result.error || "Failed to save changes."); return; }
      onSaved();
    } else {
      const result = await createFinancialAssistanceApplicant({ periodId, ...form });
      setBusy(false);
      if (!result.ok || !result.id || !result.referenceNumber) { setError(result.error || "Failed to create applicant."); return; }
      onSaved({
        id: result.id, periodId, referenceNumber: result.referenceNumber, ...form,
        modeOfApplication: form.modeOfApplication as FaModeOfApplication,
        status: "processing", appliedAt: new Date().toISOString(), approvedAt: null,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UserPlus size={16} className="text-[#F3BC00]" /> {existing ? "Edit Applicant" : "Add Applicant"}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <F label="Name" value={form.name} onChange={v => set("name", v)} required className="mb-3" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <F label="Barangay" value={form.barangay} onChange={v => set("barangay", v)} />
            <F label="School" value={form.school} onChange={v => set("school", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <F label="Program" value={form.program} onChange={v => set("program", v)} />
            <F label="Year Level" value={form.yearLevel} onChange={v => set("yearLevel", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <F label="Vulnerable Sector" value={form.vulnerableSector} onChange={v => set("vulnerableSector", v)} />
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Mode of Application</label>
              <select value={form.modeOfApplication} onChange={e => set("modeOfApplication", e.target.value)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
                <option value="">-- Select --</option>
                {FA_MODES_OF_APPLICATION.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <F label="Father's Complete Name" value={form.fatherName} onChange={v => set("fatherName", v)} />
            <F label="Mother's Complete Name" value={form.motherName} onChange={v => set("motherName", v)} />
          </div>

          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={busy}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Saving…" : existing ? "Save Changes" : "Create Applicant"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function F({ label, value, onChange, required, className = "" }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
    </div>
  );
}
