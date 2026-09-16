import { useState } from "react";
import { X, UserPlus, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  createFinancialAssistanceApplicant, updateFinancialAssistanceApplicant, checkFinancialAssistanceSiblingMatch, FA_MODES_OF_APPLICATION,
  type FinancialAssistanceApplicant, type NewFinancialAssistanceApplicantInput, type FaModeOfApplication, type FinancialAssistanceSiblingMatch,
} from "../financialAssistanceApi";

type FormState = Omit<NewFinancialAssistanceApplicantInput, "periodId">;

const EMPTY_FORM: FormState = {
  name: "", barangay: "", school: "", program: "", yearLevel: "", vulnerableSector: "", modeOfApplication: "",
  fatherFirstName: "", fatherMiddleInitial: "", fatherLastName: "",
  motherFirstName: "", motherMiddleInitial: "", motherLastName: "",
  contactEmail: "",
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
    fatherFirstName: existing.fatherFirstName, fatherMiddleInitial: existing.fatherMiddleInitial, fatherLastName: existing.fatherLastName,
    motherFirstName: existing.motherFirstName, motherMiddleInitial: existing.motherMiddleInitial, motherLastName: existing.motherLastName,
    contactEmail: existing.contactEmail,
  } : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkingSibling, setCheckingSibling] = useState(false);
  const [siblingMatches, setSiblingMatches] = useState<FinancialAssistanceSiblingMatch[] | null>(null);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    if (key.startsWith("father") || key.startsWith("mother")) setSiblingMatches(null);
  }

  async function handleCheckSibling() {
    setCheckingSibling(true);
    const matches = await checkFinancialAssistanceSiblingMatch(form);
    setCheckingSibling(false);
    setSiblingMatches(matches);
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
          <F label="Email" type="email" value={form.contactEmail} onChange={v => set("contactEmail", v)} className="mb-3" />
          <div className="mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Father's Complete Name</p>
            <div className="grid grid-cols-3 gap-3">
              <F label="First Name" value={form.fatherFirstName} onChange={v => set("fatherFirstName", v)} />
              <F label="Middle Initial" value={form.fatherMiddleInitial} onChange={v => set("fatherMiddleInitial", v)} />
              <F label="Last Name" value={form.fatherLastName} onChange={v => set("fatherLastName", v)} />
            </div>
          </div>
          <div className="mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Mother's Complete Name</p>
            <div className="grid grid-cols-3 gap-3">
              <F label="First Name" value={form.motherFirstName} onChange={v => set("motherFirstName", v)} />
              <F label="Middle Initial" value={form.motherMiddleInitial} onChange={v => set("motherMiddleInitial", v)} />
              <F label="Last Name" value={form.motherLastName} onChange={v => set("motherLastName", v)} />
            </div>
          </div>

          <div className="mb-4">
            <button type="button" onClick={handleCheckSibling} disabled={checkingSibling}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80 disabled:opacity-60">
              <ShieldAlert size={14} /> {checkingSibling ? "Checking…" : "Check for Sibling Match"}
            </button>
            {siblingMatches !== null && (
              siblingMatches.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-emerald-700 mt-2">
                  <ShieldCheck size={14} /> No sibling match found among Mainstream Scholars.
                </p>
              ) : (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-800 mb-1.5">
                    <ShieldAlert size={14} /> Possible sibling of an existing Mainstream Scholar — siblings are not eligible for Financial Assistance:
                  </p>
                  <ul className="text-[12px] text-amber-800 space-y-0.5">
                    {siblingMatches.map(m => (
                      <li key={`${m.scholarId}-${m.matchedParent}`}>
                        <strong>{m.scholarName}</strong> ({m.scholarIdNumber}) — matched via {m.matchedParent}'s name
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
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

function F({ label, value, onChange, required, className = "", type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; className?: string; type?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
    </div>
  );
}
