import { useState } from "react";
import { X, Plus, Trash2, Lock } from "lucide-react";
import {
  saveProposalDevelopmentSubmission,
  MAX_OBJECTIVES, MAX_WORK_PLAN_ACTIVITIES, MAX_EXPECTED_OUTPUTS, MAX_EXPECTED_OUTCOMES,
  type ResearchProject, type StageSubmission, type ProposalDevelopmentFormData,
  type ObjectiveItem, type WorkPlanActivity, type BudgetLineItem, type OutputItem, type OutcomeItem,
} from "../researchProjectApi";

type StepKey = "statement" | "objectives" | "methodology" | "workPlan" | "budget" | "outputs";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "statement", label: "Statement of the Problem" },
  { key: "objectives", label: "Objectives" },
  { key: "methodology", label: "Methodology" },
  { key: "workPlan", label: "Work Plan and Timeline" },
  { key: "budget", label: "Budget Requirement" },
  { key: "outputs", label: "Expected Outputs and Outcomes" },
];

// Timezone-safe inclusive day count between two yyyy-mm-dd dates (mirrors App.tsx's dateRangeArray/CTOLeaveModal).
function dayCount(from: string, to: string): number {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function FSec({ title }: { title: string }) {
  return <div className="bg-[#062444] text-[#F3BC00] font-bold text-xs px-4 py-2 -mx-6 mt-0 mb-3 uppercase tracking-wide">{title}</div>;
}
function FLabel({ label, required }: { label: string; required?: boolean }) {
  return <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{label}{required && <span className="text-red-400 ml-1">*</span>}</label>;
}
function FInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white" />;
}
function FTextarea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white resize-none" />;
}

const emptyForm = (): ProposalDevelopmentFormData => ({
  statementOfProblem: "",
  mainObjective: "",
  objectives: [{ text: "" }, { text: "" }],
  workPlanStart: "", workPlanEnd: "",
  workPlanActivities: [{ activity: "", days: "", deliverable: "" }],
  budgetTotal: "",
  budgetItems: [{ quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }],
  expectedOutputs: [{ text: "" }],
  expectedOutcomes: [{ text: "" }],
});

export function ProposalDevelopmentWizard({
  project, existing, onClose, onSaved,
}: { project: ResearchProject; existing: StageSubmission | null; onClose: () => void; onSaved: () => void }) {
  const initial = existing?.formData && Object.keys(existing.formData).length > 0
    ? { ...emptyForm(), ...(existing.formData as Partial<ProposalDevelopmentFormData>) }
    : emptyForm();
  const [form, setForm] = useState<ProposalDevelopmentFormData>(initial);
  const [step, setStep] = useState<StepKey>("statement");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setField = <K extends keyof ProposalDevelopmentFormData>(key: K, value: ProposalDevelopmentFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const setObjective = (i: number, v: string) => setField("objectives", form.objectives.map((r, idx) => idx === i ? { text: v } : r));
  const addObjective = () => { if (form.objectives.length >= MAX_OBJECTIVES) return; setField("objectives", [...form.objectives, { text: "" }]); };
  const delObjective = (i: number) => { if (form.objectives.length <= 1) return; setField("objectives", form.objectives.filter((_, idx) => idx !== i)); };

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
  const budgetTotalField = parseFloat(form.budgetTotal) || 0;
  const budgetMismatch = form.budgetTotal.trim() !== "" && Math.abs(budgetGrandTotal - budgetTotalField) > 0.01;

  const workPlanDaysTotal = dayCount(form.workPlanStart, form.workPlanEnd);
  const activitiesDaysSum = form.workPlanActivities.reduce((sum, a) => sum + (parseFloat(a.days) || 0), 0);
  const workPlanMismatch = form.workPlanStart && form.workPlanEnd && workPlanDaysTotal > 0 && activitiesDaysSum !== workPlanDaysTotal;

  async function handleSubmit() {
    setError("");
    if (!form.statementOfProblem.trim()) { setError("Fill in the Statement of the Problem."); setStep("statement"); return; }
    if (!form.mainObjective.trim() || form.objectives.some(o => !o.text.trim())) { setError("Fill in the main objective and every objective row."); setStep("objectives"); return; }
    if (!form.workPlanStart || !form.workPlanEnd || form.workPlanActivities.some(a => !a.activity.trim() || !a.deliverable.trim())) {
      setError("Fill in the work plan timeframe and every activity row."); setStep("workPlan"); return;
    }
    if (form.budgetItems.some(b => !b.specification.trim())) { setError("Fill in every budget line item's specification."); setStep("budget"); return; }
    if (form.expectedOutputs.some(o => !o.text.trim()) || form.expectedOutcomes.some(o => !o.text.trim())) {
      setError("Fill in every expected output and outcome row."); setStep("outputs"); return;
    }

    setBusy(true);
    const result = await saveProposalDevelopmentSubmission(project.id, existing?.id ?? null, form);
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
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-56 shrink-0 border-r border-[#e6ecf5] py-3 overflow-y-auto">
            {STEPS.map(s => (
              <button key={s.key} type="button"
                onClick={() => s.key !== "methodology" && setStep(s.key)}
                disabled={s.key === "methodology"}
                className={`w-full text-left px-4 py-2.5 text-[12.5px] font-semibold flex items-center justify-between gap-2 ${
                  step === s.key ? "bg-[#062444]/5 text-[#062444] border-r-2 border-[#062444]" : "text-slate-500 hover:bg-[#f7f9fc]"
                } ${s.key === "methodology" ? "opacity-50 cursor-not-allowed" : ""}`}>
                <span>{s.label}</span>
                {s.key === "methodology" && <Lock size={12} />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

            {step === "statement" && (
              <div>
                <FSec title="Statement of the Problem" />
                <p className="text-xs text-gray-400 mb-2 italic">Describe the problem this research addresses.</p>
                <FTextarea value={form.statementOfProblem} onChange={v => setField("statementOfProblem", v)} rows={10} placeholder="Statement of the problem…" />
              </div>
            )}

            {step === "objectives" && (
              <div>
                <FSec title="Objectives" />
                <FLabel label="Main Objective" required />
                <FTextarea value={form.mainObjective} onChange={v => setField("mainObjective", v)} rows={2} placeholder="Main objective…" />
                <div className="mt-4 flex items-center justify-between mb-1.5">
                  <FLabel label="Specific Objectives" required />
                  {form.objectives.length < MAX_OBJECTIVES && (
                    <button type="button" onClick={addObjective} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline mb-1">
                      <Plus size={13} /> Add objective
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.objectives.map((o: ObjectiveItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <textarea value={o.text} onChange={e => setObjective(i, e.target.value)} rows={2} placeholder={`Objective ${i + 1}`}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white resize-none" />
                      {form.objectives.length > 1 && (
                        <button type="button" onClick={() => delObjective(i)} className="shrink-0 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">{form.objectives.length} / {MAX_OBJECTIVES} objectives</p>
              </div>
            )}

            {step === "workPlan" && (
              <div>
                <FSec title="Work Plan and Timeline" />
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <FLabel label="Start Date" required />
                    <FInput type="date" value={form.workPlanStart} onChange={v => setField("workPlanStart", v)} />
                  </div>
                  <div>
                    <FLabel label="End Date" required />
                    <FInput type="date" value={form.workPlanEnd} onChange={v => setField("workPlanEnd", v)} />
                  </div>
                </div>
                {workPlanDaysTotal > 0 && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                    Project timeframe: {workPlanDaysTotal} day(s). Activities total: {activitiesDaysSum} day(s).
                    {workPlanMismatch && <span className="text-amber-700 font-semibold"> These don't match — double-check the activity durations.</span>}
                  </p>
                )}
                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Activities" required />
                  {form.workPlanActivities.length < MAX_WORK_PLAN_ACTIVITIES && (
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
                        <input value={row.activity} onChange={e => setActivity(i, "activity", e.target.value)} placeholder="Activity…"
                          className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                      </div>
                      <div className="p-2 border-r border-gray-100">
                        <input type="number" value={row.days} onChange={e => setActivity(i, "days", e.target.value)} placeholder="0"
                          className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                      </div>
                      <div className="p-2 flex gap-1">
                        <input value={row.deliverable} onChange={e => setActivity(i, "deliverable", e.target.value)} placeholder="Deliverable…"
                          className="flex-1 text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                        {form.workPlanActivities.length > 1 && (
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
                <FInput type="number" value={form.budgetTotal} onChange={v => setField("budgetTotal", v)} placeholder="0.00" />

                <div className="mt-4 flex items-center justify-between mb-1.5">
                  <FLabel label="Itemized Breakdown" required />
                  <button type="button" onClick={addBudgetRow} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                    <Plus size={13} /> Add item
                  </button>
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
                          <input type={col === "quantity" || col === "unitCost" ? "number" : "text"} value={row[col]} onChange={e => setBudgetRow(i, col, e.target.value)}
                            placeholder={col === "quantity" ? "0" : col === "unitCost" ? "0.00" : "…"} className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                        </div>
                      ))}
                      <div className="p-1.5 flex gap-1">
                        <input value={row.subtotal} readOnly className="flex-1 text-xs border-0 bg-transparent text-gray-500 font-semibold" />
                        {form.budgetItems.length > 1 && (
                          <button onClick={() => delBudgetRow(i)} className="text-red-300 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-gray-100 p-2 text-right">
                    <span className="text-xs font-bold text-[#062444]">Itemized total: ₱{budgetGrandTotal.toFixed(2)}</span>
                  </div>
                </div>
                {budgetMismatch && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    The itemized total (₱{budgetGrandTotal.toFixed(2)}) doesn't match the total budget (₱{budgetTotalField.toFixed(2)}) — double-check the figures.
                  </p>
                )}
              </div>
            )}

            {step === "outputs" && (
              <div>
                <FSec title="Expected Outputs and Outcomes" />
                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Expected Outputs" required />
                  {form.expectedOutputs.length < MAX_EXPECTED_OUTPUTS && (
                    <button type="button" onClick={addOutput} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add output
                    </button>
                  )}
                </div>
                <div className="space-y-2 mb-2">
                  {form.expectedOutputs.map((o: OutputItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={o.text} onChange={e => setOutput(i, e.target.value)} placeholder={`Output ${i + 1}`}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white" />
                      {form.expectedOutputs.length > 1 && (
                        <button type="button" onClick={() => delOutput(i)} className="shrink-0 text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mb-4">{form.expectedOutputs.length} / {MAX_EXPECTED_OUTPUTS} outputs</p>

                <div className="flex items-center justify-between mb-1.5">
                  <FLabel label="Expected Outcomes" required />
                  {form.expectedOutcomes.length < MAX_EXPECTED_OUTCOMES && (
                    <button type="button" onClick={addOutcome} className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                      <Plus size={13} /> Add outcome
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {form.expectedOutcomes.map((o: OutcomeItem, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={o.text} onChange={e => setOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white" />
                      {form.expectedOutcomes.length > 1 && (
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
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-[13px] font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSubmit} disabled={busy}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            {busy ? "Submitting…" : "Submit for Review"}
          </button>
        </div>
      </div>
    </div>
  );
}
