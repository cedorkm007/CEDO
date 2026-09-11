import { useEffect, useState } from "react";
import { X, Plus, Trash2, CheckCircle2, Clock, Lock, AlertCircle, Check, ChevronDown } from "lucide-react";
import {
  saveProposalDevelopmentFormStep, computeProposalDevFormStatuses, PROPOSAL_DEV_FORM_KEYS, PROPOSAL_DEV_FORM_LABELS,
  MAX_OBJECTIVES, MAX_WORK_PLAN_ACTIVITIES, MAX_EXPECTED_OUTPUTS, MAX_EXPECTED_OUTCOMES,
  RESEARCH_APPROACHES, DESIGN_OPTIONS_BY_APPROACH, SAMPLING_CATEGORIES,
  DATA_SOURCE_CATEGORIES, DATA_COLLECTION_CATEGORIES, DATA_ANALYSIS_CATEGORIES,
  type ResearchProject, type StageSubmission, type ProposalDevelopmentFormData, type ResearchApproach, type ProposalDevFormKey, type StepGateStatus,
  type ObjectiveItem, type WorkPlanActivity, type BudgetLineItem, type OutputItem, type OutcomeItem,
} from "../researchProjectApi";

type StepKey = ProposalDevFormKey;
const STEPS: { key: StepKey; label: string }[] = PROPOSAL_DEV_FORM_KEYS.map(key => ({ key, label: PROPOSAL_DEV_FORM_LABELS[key] }));

/** Which slice of the combined form a given step's own submission row is responsible for saving. */
function sliceForStep(key: StepKey, form: ProposalDevelopmentFormData): Record<string, unknown> {
  switch (key) {
    case "statement": return { statementOfProblem: form.statementOfProblem };
    case "objectives": return { mainObjective: form.mainObjective, objectives: form.objectives };
    case "methodology": return { methodology: form.methodology };
    case "workPlan": return { workPlanStart: form.workPlanStart, workPlanEnd: form.workPlanEnd, workPlanActivities: form.workPlanActivities };
    case "budget": return { budgetTotal: form.budgetTotal, budgetItems: form.budgetItems };
    case "outputs": return { expectedOutputs: form.expectedOutputs, expectedOutcomes: form.expectedOutcomes };
  }
}

function validateStep(key: StepKey, form: ProposalDevelopmentFormData): string | null {
  switch (key) {
    case "statement":
      return form.statementOfProblem.trim() ? null : "Fill in the Statement of the Problem.";
    case "objectives":
      return !form.mainObjective.trim() || form.objectives.some(o => !o.text.trim())
        ? "Fill in the main objective and every objective row." : null;
    case "methodology": {
      const m = form.methodology;
      if (!m.approach || !m.design || !m.population.trim() || !m.sampling) return "Fill in the Approach, Design, Population, and Sampling fields.";
      if (m.dataSources.length === 0 || m.dataCollectionMethods.length === 0 || m.dataAnalysis.length === 0)
        return "Select at least one Data Source, Data Collection Method, and Data Analysis technique.";
      return null;
    }
    case "workPlan":
      return !form.workPlanStart || !form.workPlanEnd || form.workPlanActivities.some(a => !a.activity.trim() || !a.deliverable.trim())
        ? "Fill in the work plan timeframe and every activity row." : null;
    case "budget":
      return form.budgetItems.some(b => !b.specification.trim()) ? "Fill in every budget line item's specification." : null;
    case "outputs":
      return form.expectedOutputs.some(o => !o.text.trim()) || form.expectedOutcomes.some(o => !o.text.trim())
        ? "Fill in every expected output and outcome row." : null;
  }
}

const STEP_STATUS_ICON: Record<StepGateStatus, React.ReactNode> = {
  approved: <CheckCircle2 size={13} className="text-emerald-600" />,
  under_review: <Clock size={13} className="text-amber-500" />,
  returned: <AlertCircle size={13} className="text-red-500" />,
  editable: null,
  locked: <Lock size={12} className="text-slate-300" />,
};

// The date `totalDays` (inclusive) after `from` (mirrors the day-count logic in App.tsx's dateRangeArray/CTOLeaveModal).
function addDaysInclusive(from: string, totalDays: number): string {
  const start = new Date(from + "T00:00:00");
  if (isNaN(start.getTime()) || totalDays <= 0) return "";
  start.setDate(start.getDate() + totalDays - 1);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function FSec({ title }: { title: string }) {
  return <div className="bg-[#062444] text-[#F3BC00] font-bold text-xs px-4 py-2 -mx-6 mt-0 mb-3 uppercase tracking-wide">{title}</div>;
}
function FLabel({ label, required }: { label: string; required?: boolean }) {
  return <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{label}{required && <span className="text-red-400 ml-1">*</span>}</label>;
}
function FInput({ value, onChange, placeholder, type = "text", disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:bg-gray-50 disabled:text-gray-500" />;
}
function FTextarea({ value, onChange, placeholder, rows = 4, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} disabled={disabled}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white resize-none disabled:bg-gray-50 disabled:text-gray-500" />;
}
// A fixed-column grid of checkbox rows reads far more easily than wrapped
// pill buttons once a list runs past a handful of options (some of these
// run past 20) — rows line up instead of ragged-wrapping by text length,
// and the checkbox glyph gives a clearer at-a-glance "selected" signal
// than a filled pill background alone.
function FCheckbox({ options, selected, onChange, disabled }: { options: string[]; selected: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (opt: string) => { if (disabled) return; onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]); };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {options.map(opt => {
        const isSelected = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)} disabled={disabled}
            className={`flex items-start gap-2 text-left px-2.5 py-1.5 rounded-lg border text-[12.5px] leading-snug transition-colors disabled:opacity-70 disabled:cursor-not-allowed ${
              isSelected ? "bg-[#062444]/5 border-[#062444]/30 text-[#062444] font-semibold" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            <span className={`mt-0.5 shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded border ${isSelected ? "bg-[#062444] border-[#062444]" : "border-gray-400"}`}>
              {isSelected && <Check size={10} className="text-[#F3BC00]" strokeWidth={3} />}
            </span>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/** One collapsible category card — collapsed by default, so a scholar isn't confronted with every option in every subcategory at once. The header always shows how many are selected inside, even while collapsed. */
function CollapsibleCategory({ label, options, selected, onChange, disabled }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selectedCount = options.filter(o => selected.includes(o)).length;
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
        <span className="flex items-center gap-2 shrink-0">
          {selectedCount > 0 && (
            <span className="text-[10.5px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{selectedCount} selected</span>
          )}
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="p-3 border-t border-gray-200">
          <FCheckbox options={options} selected={selected} onChange={onChange} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

const emptyForm = (): ProposalDevelopmentFormData => ({
  statementOfProblem: "",
  mainObjective: "",
  objectives: [{ text: "" }, { text: "" }],
  methodology: { approach: "", design: "", population: "", sampling: "", dataSources: [], dataCollectionMethods: [], dataAnalysis: [] },
  workPlanStart: "", workPlanEnd: "",
  workPlanActivities: [{ activity: "", days: "", deliverable: "" }],
  budgetTotal: "",
  budgetItems: [{ quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }],
  expectedOutputs: [{ text: "" }],
  expectedOutcomes: [{ text: "" }],
});

export function ProposalDevelopmentWizard({
  project, existingSubmissions, onClose, onSaved,
}: { project: ResearchProject; existingSubmissions: StageSubmission[]; onClose: () => void; onSaved: () => void }) {
  const initial = existingSubmissions.reduce(
    (acc, s) => ({ ...acc, ...(s.formData as Partial<ProposalDevelopmentFormData>) }),
    emptyForm(),
  );
  const [form, setForm] = useState<ProposalDevelopmentFormData>(initial);
  const stepStatuses = computeProposalDevFormStatuses(existingSubmissions);
  // The one step actually open for input right now — the first step that's
  // either never been submitted or came back returned for revision. Every
  // other step is either locked (comes after this one) or read-only
  // (already approved, or submitted and awaiting review).
  const activeStepKey = PROPOSAL_DEV_FORM_KEYS.find(k => stepStatuses[k] === "editable" || stepStatuses[k] === "returned") ?? PROPOSAL_DEV_FORM_KEYS[PROPOSAL_DEV_FORM_KEYS.length - 1];
  const [step, setStep] = useState<StepKey>(activeStepKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentStatus = stepStatuses[step];
  const editable = currentStatus === "editable" || currentStatus === "returned";
  const currentSubmission = existingSubmissions.find(s => s.formKey === step) ?? null;

  const setField = <K extends keyof ProposalDevelopmentFormData>(key: K, value: ProposalDevelopmentFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const setObjective = (i: number, v: string) => setField("objectives", form.objectives.map((r, idx) => idx === i ? { text: v } : r));
  const addObjective = () => { if (form.objectives.length >= MAX_OBJECTIVES) return; setField("objectives", [...form.objectives, { text: "" }]); };
  const delObjective = (i: number) => { if (form.objectives.length <= 1) return; setField("objectives", form.objectives.filter((_, idx) => idx !== i)); };

  const setMethodology = <K extends keyof ProposalDevelopmentFormData["methodology"]>(key: K, value: ProposalDevelopmentFormData["methodology"][K]) =>
    setField("methodology", { ...form.methodology, [key]: value });
  const setApproach = (approach: ResearchApproach | "") => setField("methodology", { ...form.methodology, approach, design: "" });

  const setActivity = (i: number, col: keyof WorkPlanActivity, v: string) =>
    setField("workPlanActivities", form.workPlanActivities.map((r, idx) => idx === i ? { ...r, [col]: v } : r));
  const addActivity = () => { if (form.workPlanActivities.length >= MAX_WORK_PLAN_ACTIVITIES) return; setField("workPlanActivities", [...form.workPlanActivities, { activity: "", days: "", deliverable: "" }]); };
  const delActivity = (i: number) => { if (form.workPlanActivities.length <= 1) return; setField("workPlanActivities", form.workPlanActivities.filter((_, idx) => idx !== i)); };

  const setBudgetRow = (i: number, col: keyof BudgetLineItem, v: string) => {
    setField("budgetItems", form.budgetItems.map((r, idx) => {
      if (idx !== i) return r;
      const updated = { ...r, [col]: v };
      if (col === "quantity" || col === "unitCost") {
        const qty = parseFloat(col === "quantity" ? v : r.quantity) || 0;
        const uc = parseFloat(col === "unitCost" ? v : r.unitCost) || 0;
        updated.subtotal = (qty * uc).toFixed(2);
      }
      return updated;
    }));
  };
  const addBudgetRow = () => setField("budgetItems", [...form.budgetItems, { quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }]);
  const delBudgetRow = (i: number) => { if (form.budgetItems.length <= 1) return; setField("budgetItems", form.budgetItems.filter((_, idx) => idx !== i)); };

  const setOutput = (i: number, v: string) => setField("expectedOutputs", form.expectedOutputs.map((r, idx) => idx === i ? { text: v } : r));
  const addOutput = () => { if (form.expectedOutputs.length >= MAX_EXPECTED_OUTPUTS) return; setField("expectedOutputs", [...form.expectedOutputs, { text: "" }]); };
  const delOutput = (i: number) => { if (form.expectedOutputs.length <= 1) return; setField("expectedOutputs", form.expectedOutputs.filter((_, idx) => idx !== i)); };

  const setOutcome = (i: number, v: string) => setField("expectedOutcomes", form.expectedOutcomes.map((r, idx) => idx === i ? { text: v } : r));
  const addOutcome = () => { if (form.expectedOutcomes.length >= MAX_EXPECTED_OUTCOMES) return; setField("expectedOutcomes", [...form.expectedOutcomes, { text: "" }]); };
  const delOutcome = (i: number) => { if (form.expectedOutcomes.length <= 1) return; setField("expectedOutcomes", form.expectedOutcomes.filter((_, idx) => idx !== i)); };

  const budgetGrandTotal = form.budgetItems.reduce((sum, r) => sum + (parseFloat(r.subtotal) || 0), 0);
  const computedBudgetTotal = budgetGrandTotal.toFixed(2);

  useEffect(() => {
    if (form.budgetTotal !== computedBudgetTotal) setField("budgetTotal", computedBudgetTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedBudgetTotal]);

  const activitiesDaysSum = form.workPlanActivities.reduce((sum, a) => sum + (parseFloat(a.days) || 0), 0);
  const computedWorkPlanEnd = form.workPlanStart ? addDaysInclusive(form.workPlanStart, activitiesDaysSum) : "";

  useEffect(() => {
    if (form.workPlanEnd !== computedWorkPlanEnd) setField("workPlanEnd", computedWorkPlanEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedWorkPlanEnd]);

  async function handleSubmitStep() {
    if (!editable) return;
    setError("");
    const validationError = validateStep(step, form);
    if (validationError) { setError(validationError); return; }

    setBusy(true);
    const result = await saveProposalDevelopmentFormStep(project.id, step, currentSubmission?.id ?? null, sliceForStep(step, form));
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-white font-bold text-[15px]">Proposal Development</h3>
            <p className="text-white/60 text-xs mt-0.5">{project.title}</p>
            <p className="text-[#F3BC00] text-[11px] font-semibold mt-1">
              Form {PROPOSAL_DEV_FORM_KEYS.indexOf(step) + 1} of {PROPOSAL_DEV_FORM_KEYS.length} — {PROPOSAL_DEV_FORM_LABELS[step]}
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-56 shrink-0 border-r border-[#e6ecf5] py-3 overflow-y-auto">
            {STEPS.map(s => {
              const status = stepStatuses[s.key];
              const locked = status === "locked";
              return (
                <button key={s.key} type="button" disabled={locked}
                  onClick={() => setStep(s.key)}
                  className={`w-full flex items-center justify-between gap-2 text-left px-4 py-2.5 text-[12.5px] font-semibold ${
                    locked ? "text-slate-300 cursor-not-allowed" : step === s.key ? "bg-[#062444]/5 text-[#062444] border-r-2 border-[#062444]" : "text-slate-500 hover:bg-[#f7f9fc]"
                  }`}>
                  {s.label}
                  {STEP_STATUS_ICON[status]}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

            {currentStatus === "approved" && (
              <p className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-[12.5px] font-semibold mb-4">
                <CheckCircle2 size={14} /> Approved{currentSubmission?.reviewedAt ? ` on ${new Date(currentSubmission.reviewedAt).toLocaleDateString()}` : ""}.
              </p>
            )}
            {currentStatus === "under_review" && (
              <p className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12.5px] font-semibold mb-4">
                <Clock size={14} /> Submitted — waiting for the evaluator's review.
              </p>
            )}
            {currentStatus === "returned" && (
              <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold mb-1"><AlertCircle size={14} /> Returned for revision.</p>
                {currentSubmission?.evaluatorComment && <p className="text-[12.5px] italic">"{currentSubmission.evaluatorComment}"</p>}
              </div>
            )}

            {step === "statement" && (
              <div>
                <FSec title="Statement of the Problem" />
                <p className="text-xs text-gray-400 mb-2 italic">Describe the problem this research addresses.</p>
                <FTextarea value={form.statementOfProblem} onChange={v => setField("statementOfProblem", v)} rows={10} placeholder="Statement of the problem…" disabled={!editable} />
              </div>
            )}

            {step === "objectives" && (
              <div>
                <FSec title="Objectives" />
                <FLabel label="Main Objective" required />
                <FTextarea value={form.mainObjective} onChange={v => setField("mainObjective", v)} rows={2} placeholder="Main objective…" disabled={!editable} />
                <div className="mt-4 flex items-center justify-between mb-1.5">
                  <FLabel label="Specific Objectives" required />
                  {editable && form.objectives.length < MAX_OBJECTIVES && (
                    <button type="button" onClick={addObjective} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline mb-1">
                      <Plus size={13} /> Add objective
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.objectives.map((o: ObjectiveItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <textarea value={o.text} onChange={e => setObjective(i, e.target.value)} rows={2} placeholder={`Objective ${i + 1}`} disabled={!editable}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white resize-none disabled:bg-gray-50 disabled:text-gray-500" />
                      {editable && form.objectives.length > 1 && (
                        <button type="button" onClick={() => delObjective(i)} className="shrink-0 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">{form.objectives.length} / {MAX_OBJECTIVES} objectives</p>
              </div>
            )}

            {step === "methodology" && (
              <div>
                <FSec title="Methodology (Research Design)" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <FLabel label="Approach" required />
                    <select value={form.methodology.approach} onChange={e => setApproach(e.target.value as ResearchApproach | "")} disabled={!editable}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:bg-gray-50 disabled:text-gray-500">
                      <option value="">Select an approach…</option>
                      {RESEARCH_APPROACHES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <FLabel label="Design" required />
                    <select value={form.methodology.design} onChange={e => setMethodology("design", e.target.value)} disabled={!editable || !form.methodology.approach}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:opacity-50 disabled:cursor-not-allowed">
                      <option value="">{form.methodology.approach ? "Select a design…" : "Select an approach first…"}</option>
                      {(form.methodology.approach ? DESIGN_OPTIONS_BY_APPROACH[form.methodology.approach] : []).map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <FLabel label="Population" required />
                <FInput value={form.methodology.population} onChange={v => setMethodology("population", v)} placeholder="Describe the study population…" disabled={!editable} />

                <div className="mt-4">
                  <FLabel label="Sampling" required />
                  <select value={form.methodology.sampling} onChange={e => setMethodology("sampling", e.target.value)} disabled={!editable}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:bg-gray-50 disabled:text-gray-500">
                    <option value="">Select a sampling method…</option>
                    {SAMPLING_CATEGORIES.map(cat => (
                      <optgroup key={cat.label} label={cat.label}>
                        {cat.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FLabel label="Data Sources" required />
                    <span className="text-[10.5px] font-bold text-[#0088cc]">{form.methodology.dataSources.length} selected</span>
                  </div>
                  <div className="space-y-2">
                    {DATA_SOURCE_CATEGORIES.map(cat => (
                      <CollapsibleCategory key={cat.label} label={cat.label} options={cat.options} selected={form.methodology.dataSources}
                        onChange={v => setMethodology("dataSources", v)} disabled={!editable} />
                    ))}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FLabel label="Data Collection Methods" required />
                    <span className="text-[10.5px] font-bold text-[#0088cc]">{form.methodology.dataCollectionMethods.length} selected</span>
                  </div>
                  <div className="space-y-2">
                    {DATA_COLLECTION_CATEGORIES.map(cat => (
                      <CollapsibleCategory key={cat.label} label={cat.label} options={cat.options} selected={form.methodology.dataCollectionMethods}
                        onChange={v => setMethodology("dataCollectionMethods", v)} disabled={!editable} />
                    ))}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FLabel label="Data Analysis" required />
                    <span className="text-[10.5px] font-bold text-[#0088cc]">{form.methodology.dataAnalysis.length} selected</span>
                  </div>
                  <div className="space-y-2">
                    {DATA_ANALYSIS_CATEGORIES.map(cat => (
                      <CollapsibleCategory key={cat.label} label={cat.label} options={cat.options} selected={form.methodology.dataAnalysis}
                        onChange={v => setMethodology("dataAnalysis", v)} disabled={!editable} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === "workPlan" && (
              <div>
                <FSec title="Work Plan and Timeline" />
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <FLabel label="Start Date" required />
                    <FInput type="date" value={form.workPlanStart} onChange={v => setField("workPlanStart", v)} disabled={!editable} />
                  </div>
                  <div>
                    <FLabel label="End Date" required />
                    <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
                      {computedWorkPlanEnd || "—"}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                  {activitiesDaysSum > 0
                    ? <>End date is calculated automatically: Start Date + {activitiesDaysSum} total activity day(s).</>
                    : <>Enter day counts for each activity below to calculate the End Date automatically.</>}
                </p>
                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Activities" required />
                  {editable && form.workPlanActivities.length < MAX_WORK_PLAN_ACTIVITIES && (
                    <button type="button" onClick={addActivity} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add activity
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-2 overflow-x-auto">
                  <div className="grid grid-cols-[1fr_90px_1fr] bg-[#062444]/5 min-w-[520px]">
                    <div className="px-3 py-2 text-xs font-bold text-[#062444] border-r border-gray-200">Activity</div>
                    <div className="px-3 py-2 text-xs font-bold text-[#062444] border-r border-gray-200">Days</div>
                    <div className="px-3 py-2 text-xs font-bold text-[#062444]">Deliverable</div>
                  </div>
                  {form.workPlanActivities.map((row: WorkPlanActivity, i) => (
                    <div key={i} className="grid grid-cols-[1fr_90px_1fr] border-t border-gray-100 min-w-[520px]">
                      <div className="p-2 border-r border-gray-100">
                        <input value={row.activity} onChange={e => setActivity(i, "activity", e.target.value)} placeholder="Activity…" disabled={!editable}
                          className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700 disabled:text-gray-400" />
                      </div>
                      <div className="p-2 border-r border-gray-100">
                        <input type="number" value={row.days} onChange={e => setActivity(i, "days", e.target.value)} placeholder="0" disabled={!editable}
                          className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700 disabled:text-gray-400" />
                      </div>
                      <div className="p-2 flex gap-1">
                        <input value={row.deliverable} onChange={e => setActivity(i, "deliverable", e.target.value)} placeholder="Deliverable…" disabled={!editable}
                          className="flex-1 text-xs border-0 focus:outline-none bg-transparent text-gray-700 disabled:text-gray-400" />
                        {editable && form.workPlanActivities.length > 1 && (
                          <button onClick={() => delActivity(i)} className="text-red-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">{form.workPlanActivities.length} / {MAX_WORK_PLAN_ACTIVITIES} activities</p>
              </div>
            )}

            {step === "budget" && (
              <div>
                <FSec title="Budget Requirement" />
                <FLabel label="Total Budget (₱)" required />
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600 font-semibold">
                  ₱{computedBudgetTotal}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Calculated automatically from the itemized breakdown below.</p>

                <div className="mt-4 flex items-center justify-between mb-1.5">
                  <FLabel label="Itemized Breakdown" required />
                  {editable && (
                    <button type="button" onClick={addBudgetRow} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add item
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-2 overflow-x-auto">
                  <div className="grid grid-cols-5 bg-[#062444]/5 min-w-[520px]">
                    {["Qty", "Unit", "Specification", "Unit Cost (₱)", "Subtotal (₱)"].map((h, i) => (
                      <div key={h} className={`px-2 py-2 text-xs font-bold text-[#062444] ${i < 4 ? "border-r border-gray-200" : ""}`}>{h}</div>
                    ))}
                  </div>
                  {form.budgetItems.map((row: BudgetLineItem, i) => (
                    <div key={i} className="grid grid-cols-5 border-t border-gray-100 min-w-[520px]">
                      {(["quantity", "unit", "specification", "unitCost"] as const).map(col => (
                        <div key={col} className="p-1.5 border-r border-gray-100">
                          <input type={col === "quantity" || col === "unitCost" ? "number" : "text"} value={row[col]} onChange={e => setBudgetRow(i, col, e.target.value)} disabled={!editable}
                            placeholder={col === "quantity" ? "0" : col === "unitCost" ? "0.00" : "…"} className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700 disabled:text-gray-400" />
                        </div>
                      ))}
                      <div className="p-1.5 flex gap-1">
                        <input value={row.subtotal} readOnly className="flex-1 text-xs border-0 bg-transparent text-gray-500 font-semibold" />
                        {editable && form.budgetItems.length > 1 && (
                          <button onClick={() => delBudgetRow(i)} className="text-red-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === "outputs" && (
              <div>
                <FSec title="Expected Outputs and Outcomes" />
                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Expected Outputs" required />
                  {editable && form.expectedOutputs.length < MAX_EXPECTED_OUTPUTS && (
                    <button type="button" onClick={addOutput} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add output
                    </button>
                  )}
                </div>
                <div className="space-y-2 mb-2">
                  {form.expectedOutputs.map((o: OutputItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={o.text} onChange={e => setOutput(i, e.target.value)} placeholder={`Output ${i + 1}`} disabled={!editable}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:bg-gray-50 disabled:text-gray-500" />
                      {editable && form.expectedOutputs.length > 1 && (
                        <button type="button" onClick={() => delOutput(i)} className="shrink-0 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mb-4">{form.expectedOutputs.length} / {MAX_EXPECTED_OUTPUTS} outputs</p>

                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Expected Outcomes" required />
                  {editable && form.expectedOutcomes.length < MAX_EXPECTED_OUTCOMES && (
                    <button type="button" onClick={addOutcome} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add outcome
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.expectedOutcomes.map((o: OutcomeItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={o.text} onChange={e => setOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`} disabled={!editable}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white disabled:bg-gray-50 disabled:text-gray-500" />
                      {editable && form.expectedOutcomes.length > 1 && (
                        <button type="button" onClick={() => delOutcome(i)} className="shrink-0 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">{form.expectedOutcomes.length} / {MAX_EXPECTED_OUTCOMES} outcomes</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#e6ecf5] shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-[13px] font-semibold text-slate-500 hover:bg-slate-50">Close</button>
          {editable && (
            <button onClick={handleSubmitStep} disabled={busy}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Submitting…" : "Submit for Review"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
