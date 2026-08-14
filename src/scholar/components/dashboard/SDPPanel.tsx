import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Trash2, ClipboardList, FileText, ChevronRight, Award, List, Lightbulb, Lock } from "lucide-react";
import { SectionCard } from "./SectionCard";
import {
  fetchApprovedSDPActivities, fetchMySDPActivities, submitSDPProposal, checkIsFormationOfficer, ORGANIZATIONS, SDP_CATEGORIES,
  type SDPActivity, type SDPStatus, type SDPCategory, type ObjectiveRow, type WorkPlanRow, type ProgramFlowRow, type BudgetRow, type SDPProposalInput,
} from "../../sdpApi";

const statusColors: Record<SDPStatus, string> = {
  finished: "bg-green-500", ongoing: "bg-blue-500", approved: "bg-[#F3BC00]",
  pending: "bg-orange-400", canceled: "bg-red-500", rescheduled: "bg-purple-500",
};
const statusTextColors: Record<SDPStatus, string> = {
  finished: "text-white", ongoing: "text-white", approved: "text-[#062444]",
  pending: "text-white", canceled: "text-white", rescheduled: "text-white",
};
const statusDescriptions: Record<SDPStatus, string> = {
  finished: "The SDP Activity is completed.",
  ongoing: "The Activity has already started.",
  approved: "The Activity is approved but has not started yet.",
  pending: "The Activity is not yet approved by the approving bodies.",
  canceled: "The Activity has been canceled by the CEDO Staff.",
  rescheduled: "The activity has changed schedules.",
};

const emptyForm = (): Omit<SDPProposalInput, "category"> & { category: SDPCategory | "" } => ({
  name: "", category: "", nature: [], organization: "", dateTime: "", venue: "",
  budgetaryRequirement: "", sourceOfFund: [], sourceOfFundOther: "", rationale: "", linkWithOrg: "",
  objectives: [{ objective: "", deliverable: "" }, { objective: "", deliverable: "" }],
  targetPartners: [], targetPartnersOther: "", specificRole: [],
  workPlan: [{ date: "", activity: "" }, { date: "", activity: "" }],
  programFlow: [{ time: "", segment: "", deliverables: "", personInCharge: "" }, { time: "", segment: "", deliverables: "", personInCharge: "" }],
  budgetItems: [{ quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }, { quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }],
});

function FSec({ title }: { title: string }) {
  return <div className="bg-[#062444] text-[#F3BC00] font-bold text-xs px-4 py-2 -mx-4 mt-5 mb-3 uppercase tracking-wide">{title}</div>;
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
function FCheckbox({ options, selected, onChange, otherLabel, other, onOtherChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void; otherLabel?: string; other?: string; onOtherChange?: (v: string) => void;
}) {
  const toggle = (opt: string) => onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => toggle(opt)}
          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${selected.includes(opt) ? "bg-[#062444] text-white border-[#062444]" : "bg-white text-gray-600 border-gray-300"}`}>
          <span className={`inline-block w-2.5 h-2.5 rounded border mr-1.5 align-middle ${selected.includes(opt) ? "bg-[#F3BC00] border-[#F3BC00]" : "border-gray-400"}`} />
          {opt}
        </button>
      ))}
      {otherLabel !== undefined && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => toggle(otherLabel)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${selected.includes(otherLabel) ? "bg-[#062444] text-white border-[#062444]" : "bg-white text-gray-600 border-gray-300"}`}>
            <span className={`inline-block w-2.5 h-2.5 rounded border mr-1.5 align-middle ${selected.includes(otherLabel) ? "bg-[#F3BC00] border-[#F3BC00]" : "border-gray-400"}`} />
            Others
          </button>
          {selected.includes(otherLabel) && onOtherChange && (
            <input value={other || ""} onChange={e => onOtherChange(e.target.value)} placeholder="Specify..."
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#F3BC00]" />
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SDPStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[status]} ${statusTextColors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ActivityDetailModal({ activity, onClose }: { activity: SDPActivity; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-[#062444] px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-[#F3BC00] text-xs font-bold uppercase tracking-wide mb-1">SDP Activity</p>
            <h3 className="font-bold text-white text-xl leading-tight">{activity.name}</h3>
            <div className="mt-2"><StatusBadge status={activity.status} /></div>
            <p className="text-white/50 text-xs mt-1">{statusDescriptions[activity.status]}</p>
          </div>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white shrink-0 ml-4"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {[
            { label: "Name of Activity", value: activity.name },
            { label: "Nature of Activity", value: activity.nature.join(", ") },
            { label: "Organization", value: activity.organization },
            { label: "Date / Time", value: activity.dateTime ? new Date(activity.dateTime).toLocaleString() : "—" },
            { label: "Venue", value: activity.venue },
            { label: "Project Head", value: activity.projectHead || "—" },
            { label: "Head, Cluster", value: activity.headCluster || "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-3">
              <span className="text-xs text-gray-400 w-32 shrink-0 font-medium pt-0.5">{label}</span>
              <span className="text-sm text-gray-800 font-semibold">{value || "—"}</span>
            </div>
          ))}
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold text-sm">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ProposalForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (a: SDPProposalInput) => Promise<void> }) {
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const setField = <K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) => setForm(prev => ({ ...prev, [key]: value }));

  const setObj = (i: number, col: keyof ObjectiveRow, v: string) => setField("objectives", form.objectives.map((r, idx) => idx === i ? { ...r, [col]: v } : r));
  const addObj = () => setField("objectives", [...form.objectives, { objective: "", deliverable: "" }]);
  const delObj = (i: number) => setField("objectives", form.objectives.filter((_, idx) => idx !== i));

  const setWP = (i: number, col: keyof WorkPlanRow, v: string) => setField("workPlan", form.workPlan.map((r, idx) => idx === i ? { ...r, [col]: v } : r));
  const addWP = () => setField("workPlan", [...form.workPlan, { date: "", activity: "" }]);
  const delWP = (i: number) => setField("workPlan", form.workPlan.filter((_, idx) => idx !== i));

  const setPF = (i: number, col: keyof ProgramFlowRow, v: string) => setField("programFlow", form.programFlow.map((r, idx) => idx === i ? { ...r, [col]: v } : r));
  const addPF = () => setField("programFlow", [...form.programFlow, { time: "", segment: "", deliverables: "", personInCharge: "" }]);
  const delPF = (i: number) => setField("programFlow", form.programFlow.filter((_, idx) => idx !== i));

  const setBudget = (i: number, col: keyof BudgetRow, v: string) => {
    const rows = form.budgetItems.map((r, idx) => {
      if (idx !== i) return r;
      const updated = { ...r, [col]: v };
      if (col === "quantity" || col === "unitCost") {
        const qty = parseFloat(col === "quantity" ? v : r.quantity) || 0;
        const uc = parseFloat(col === "unitCost" ? v : r.unitCost) || 0;
        updated.subtotal = (qty * uc).toFixed(2);
      }
      return updated;
    });
    setField("budgetItems", rows);
  };
  const addBudget = () => setField("budgetItems", [...form.budgetItems, { quantity: "", unit: "", specification: "", unitCost: "", subtotal: "" }]);
  const delBudget = (i: number) => setField("budgetItems", form.budgetItems.filter((_, idx) => idx !== i));

  async function handleSubmit() {
    setError("");
    if (!form.name.trim()) { setError("Please enter the Activity Name."); return; }
    if (!form.category) { setError("Please choose which SDP category this activity counts toward."); return; }
    setSubmitting(true);
    await onSubmit({ ...form, category: form.category });
    setSubmitting(false);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/50 flex items-end lg:items-center justify-center">
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="bg-gray-50 rounded-t-2xl lg:rounded-2xl shadow-2xl w-full lg:max-w-3xl flex flex-col max-h-[95vh] lg:max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="bg-[#062444] px-6 py-4 flex items-center justify-between shrink-0 rounded-t-2xl">
          <div>
            <h2 className="font-bold text-[#F3BC00] text-lg">Project Proposal Form</h2>
            <p className="text-white/60 text-xs">Fill out all required fields (*)</p>
          </div>
          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleSubmit} disabled={submitting}
              className="bg-[#F3BC00] text-[#062444] px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-60">
              {submitting ? "Submitting…" : "Submit"}
            </motion.button>
            <button onClick={onClose} className="p-2 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg mt-4">{error}</p>}

          <FSec title="a. Name of Activity" />
          <FLabel label="Activity Name" required />
          <FInput value={form.name} onChange={v => setField("name", v)} placeholder="Enter activity name" />

          <FSec title="SDP Category" />
          <FLabel label="Which required SDP category does this count toward?" required />
          <div className="flex flex-wrap gap-2">
            {SDP_CATEGORIES.map(c => (
              <button key={c.key} type="button" onClick={() => setField("category", c.key)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  form.category === c.key ? "bg-[#062444] text-white border-[#062444]" : "bg-white text-gray-600 border-gray-300"
                }`}>
                {c.label}
              </button>
            ))}
          </div>

          <FSec title="b. Nature of Activity" />
          <FCheckbox options={["Sports", "Education", "Health", "Environment"]} selected={form.nature} onChange={v => setField("nature", v)} />

          <FSec title="c. Organization" />
          <FLabel label="Select Organization" required />
          <select value={form.organization} onChange={e => setField("organization", e.target.value)} size={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white">
            <option value="">-- Select an Organization --</option>
            {ORGANIZATIONS.map(org => <option key={org} value={org}>{org}</option>)}
          </select>
          {form.organization && <p className="text-xs text-green-600 mt-1 font-medium">✓ {form.organization}</p>}

          <FSec title="d. Date and Time" />
          <FLabel label="Date and Time" required />
          <FInput type="datetime-local" value={form.dateTime} onChange={v => setField("dateTime", v)} />

          <FSec title="e. Venue" />
          <FLabel label="Venue" required />
          <FInput value={form.venue} onChange={v => setField("venue", v)} placeholder="Enter venue" />

          <FSec title="f. Budgetary Requirement (Total)" />
          <FLabel label="Total Budget (₱)" required />
          <FInput type="number" value={form.budgetaryRequirement} onChange={v => setField("budgetaryRequirement", v)} placeholder="0.00" />

          <FSec title="g. Source of Fund" />
          <FCheckbox options={["in kind donation", "monetary donation"]} selected={form.sourceOfFund}
            onChange={v => setField("sourceOfFund", v)} otherLabel="others" other={form.sourceOfFundOther} onOtherChange={v => setField("sourceOfFundOther", v)} />

          <FSec title="h. Rationale / Overview of the Project" />
          <p className="text-xs text-gray-400 mb-2 italic">Briefly discuss in at least 1 paragraph.</p>
          <FTextarea value={form.rationale} onChange={v => setField("rationale", v)} placeholder="Briefly discuss the project rationale and overview." rows={5} />

          <FSec title="i. Link of the Project with the Organization" />
          <p className="text-xs text-gray-400 mb-2 italic">State the link of the project with the mission/purpose of the organization.</p>
          <FTextarea value={form.linkWithOrg} onChange={v => setField("linkWithOrg", v)} placeholder="State the link with the organization's mission." rows={3} />

          <FSec title="j. Objectives and Project Deliverables / Success Indicators" />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3">
            <div className="grid grid-cols-2 bg-[#062444]/5">
              <div className="px-3 py-2 text-xs font-bold text-[#062444] border-r border-gray-200">Objectives<p className="text-gray-400 font-normal mt-0.5 text-[10px]">State using SMART method</p></div>
              <div className="px-3 py-2 text-xs font-bold text-[#062444]">Deliverables / Success Indicators<p className="text-gray-400 font-normal mt-0.5 text-[10px]">What you will deliver</p></div>
            </div>
            {form.objectives.map((row, i) => (
              <div key={i} className="grid grid-cols-2 border-t border-gray-100 group">
                <div className="p-2 border-r border-gray-100">
                  <textarea value={row.objective} onChange={e => setObj(i, "objective", e.target.value)} placeholder="SMART objective..." rows={2}
                    className="w-full text-xs border-0 focus:outline-none resize-none bg-transparent text-gray-700" />
                </div>
                <div className="p-2 flex gap-1">
                  <textarea value={row.deliverable} onChange={e => setObj(i, "deliverable", e.target.value)} placeholder="Deliverable/success indicator..." rows={2}
                    className="flex-1 text-xs border-0 focus:outline-none resize-none bg-transparent text-gray-700" />
                  {form.objectives.length > 1 && <button onClick={() => delObj(i)} className="text-red-300 hover:text-red-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={addObj} className="flex items-center gap-2 text-xs text-[#062444] font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity mb-2"><Plus className="w-4 h-4" />Add Row</button>

          <FSec title="k. Target Partners / Sponsors" />
          <FCheckbox options={["Sangguniang Kabataan", "Sangguniang Barangay"]} selected={form.targetPartners}
            onChange={v => setField("targetPartners", v)} otherLabel="Others" other={form.targetPartnersOther} onOtherChange={v => setField("targetPartnersOther", v)} />

          <FSec title="l. Specific Role to the Project" />
          <FCheckbox options={["Participant", "Organizer", "Partner"]} selected={form.specificRole} onChange={v => setField("specificRole", v)} />

          <FSec title="m. Work Plan" />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3">
            <div className="grid grid-cols-2 bg-[#062444]/5">
              <div className="px-3 py-2 text-xs font-bold text-[#062444] border-r border-gray-200">Date</div>
              <div className="px-3 py-2 text-xs font-bold text-[#062444]">Activity</div>
            </div>
            {form.workPlan.map((row, i) => (
              <div key={i} className="grid grid-cols-2 border-t border-gray-100 group">
                <div className="p-2 border-r border-gray-100">
                  <input type="date" value={row.date} onChange={e => setWP(i, "date", e.target.value)} className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                </div>
                <div className="p-2 flex gap-1">
                  <input value={row.activity} onChange={e => setWP(i, "activity", e.target.value)} placeholder="Activity..." className="flex-1 text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                  {form.workPlan.length > 1 && <button onClick={() => delWP(i)} className="text-red-300 hover:text-red-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={addWP} className="flex items-center gap-2 text-xs text-[#062444] font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity mb-2"><Plus className="w-4 h-4" />Add Row</button>

          <FSec title="n. Program Flow of the Kick-off and Culmination" />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3 overflow-x-auto">
            <div className="grid grid-cols-4 bg-[#062444]/5 min-w-[480px]">
              {["Time", "Segment", "Deliverables", "Person-in-Charge"].map((h, i) => (
                <div key={h} className={`px-3 py-2 text-xs font-bold text-[#062444] ${i < 3 ? "border-r border-gray-200" : ""}`}>{h}</div>
              ))}
            </div>
            {form.programFlow.map((row, i) => (
              <div key={i} className="grid grid-cols-4 border-t border-gray-100 group min-w-[480px]">
                {(["time", "segment", "deliverables", "personInCharge"] as const).map((col, ci) => (
                  <div key={col} className={`p-2 ${ci < 3 ? "border-r border-gray-100" : "flex gap-1"}`}>
                    <input value={row[col]} onChange={e => setPF(i, col, e.target.value)} placeholder={col === "time" ? "8:00 AM" : "..."}
                      className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                    {ci === 3 && form.programFlow.length > 1 && <button onClick={() => delPF(i)} className="text-red-300 hover:text-red-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button onClick={addPF} className="flex items-center gap-2 text-xs text-[#062444] font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity mb-2"><Plus className="w-4 h-4" />Add Row</button>

          <FSec title="o. Budgetary Requirement (Itemized)" />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-3 overflow-x-auto">
            <div className="grid grid-cols-5 bg-[#062444]/5 min-w-[520px]">
              {["Qty", "Unit", "Specification", "Unit Cost (₱)", "Subtotal (₱)"].map((h, i) => (
                <div key={h} className={`px-2 py-2 text-xs font-bold text-[#062444] ${i < 4 ? "border-r border-gray-200" : ""}`}>{h}</div>
              ))}
            </div>
            {form.budgetItems.map((row, i) => (
              <div key={i} className="grid grid-cols-5 border-t border-gray-100 group min-w-[520px]">
                {(["quantity", "unit", "specification", "unitCost"] as const).map(col => (
                  <div key={col} className="p-1.5 border-r border-gray-100">
                    <input type={col === "quantity" || col === "unitCost" ? "number" : "text"} value={row[col]} onChange={e => setBudget(i, col, e.target.value)}
                      placeholder={col === "quantity" ? "0" : col === "unitCost" ? "0.00" : "..."} className="w-full text-xs border-0 focus:outline-none bg-transparent text-gray-700" />
                  </div>
                ))}
                <div className="p-1.5 flex gap-1">
                  <input value={row.subtotal} readOnly className="flex-1 text-xs border-0 bg-transparent text-gray-500 font-semibold" />
                  {form.budgetItems.length > 1 && <button onClick={() => delBudget(i)} className="text-red-300 hover:text-red-500 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
            <div className="border-t border-gray-100 p-2 text-right">
              <span className="text-xs font-bold text-[#062444]">Total: ₱{form.budgetItems.reduce((sum, r) => sum + (parseFloat(r.subtotal) || 0), 0).toFixed(2)}</span>
            </div>
          </div>
          <button onClick={addBudget} className="flex items-center gap-2 text-xs text-[#062444] font-semibold cursor-pointer hover:underline hover:opacity-80 transition-opacity mb-2"><Plus className="w-4 h-4" />Add Row</button>

          <div className="mt-8 flex gap-3">
            <motion.button whileTap={{ scale: 0.97 }} onClick={onClose} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm">Cancel</motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit} disabled={submitting} className="flex-1 bg-[#F3BC00] text-[#062444] py-3 rounded-xl font-bold text-sm shadow-md disabled:opacity-60">
              {submitting ? "Submitting…" : "Submit Proposal"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ActivityCard({ act, onClick }: { act: SDPActivity; onClick: () => void }) {
  return (
    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={onClick}
      className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 text-left hover:shadow-md transition-all border border-gray-100">
      <div className={`w-1.5 self-stretch rounded-full shrink-0 ${statusColors[act.status]}`} />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[#062444] text-sm truncate">{act.name}</p>
        <p className="text-xs text-gray-500 truncate">{act.organization}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <StatusBadge status={act.status} />
          {act.category && (
            <span className="text-[10px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">
              {SDP_CATEGORIES.find(c => c.key === act.category)?.label ?? act.category}
            </span>
          )}
          {act.dateTime && <span className="text-xs text-gray-400">{new Date(act.dateTime).toLocaleDateString()}</span>}
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5 italic">{statusDescriptions[act.status]}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
    </motion.button>
  );
}

interface SDPPanelProps {
  scholarIdNumber: string;
}

/**
 * Cloned from the reference mobile app's SDPPage, adapted to fit inline in
 * this app's panel layout (SectionCard wrapper, our navy/gold tokens) and
 * wired to real Supabase data instead of local mock state. Proposals a
 * scholar submits start 'pending' until a tagged CEDO staff member (SDP
 * Monitoring tag — see the SEAD Division "SDP Monitoring" tab) reviews them.
 */
export function SDPPanel({ scholarIdNumber }: SDPPanelProps) {
  const [approved, setApproved] = useState<SDPActivity[]>([]);
  const [mine, setMine] = useState<SDPActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOfficer, setIsOfficer] = useState(false);
  const [listView, setListView] = useState<"approved" | "mine">("approved");
  const [showProposal, setShowProposal] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<SDPActivity | null>(null);

  async function loadAll() {
    setLoading(true);
    const [a, m, officer] = await Promise.all([
      fetchApprovedSDPActivities(), fetchMySDPActivities(scholarIdNumber), checkIsFormationOfficer(scholarIdNumber),
    ]);
    setApproved(a);
    setMine(m);
    setIsOfficer(officer);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [scholarIdNumber]);

  async function handleSubmit(input: SDPProposalInput) {
    const result = await submitSDPProposal(scholarIdNumber, input);
    if (result.ok) {
      setShowProposal(false);
      setListView("mine");
      loadAll();
    }
  }

  const displayList = listView === "approved" ? approved : mine;

  return (
    <SectionCard icon={<Lightbulb size={14} />} title="Scholars' Development Program (SDP)">
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => setListView("approved")}
          className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border-2 transition-all ${listView === "approved" ? "bg-[#062444] border-[#F3BC00]" : "bg-[#f7f9fc] border-transparent hover:border-[#e6ecf5]"}`}>
          <Award className={`w-6 h-6 ${listView === "approved" ? "text-[#F3BC00]" : "text-[#062444]"}`} />
          <span className={`font-bold text-[11px] text-center leading-tight ${listView === "approved" ? "text-[#F3BC00]" : "text-[#062444]"}`}>Approved Activities</span>
        </motion.button>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => setListView("mine")}
          className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border-2 transition-all ${listView === "mine" ? "bg-[#062444] border-[#F3BC00]" : "bg-[#f7f9fc] border-transparent hover:border-[#e6ecf5]"}`}>
          <List className={`w-6 h-6 ${listView === "mine" ? "text-[#F3BC00]" : "text-[#062444]"}`} />
          <span className={`font-bold text-[11px] text-center leading-tight ${listView === "mine" ? "text-[#F3BC00]" : "text-[#062444]"}`}>My SDP Activity</span>
        </motion.button>
        {isOfficer ? (
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={() => setShowProposal(true)}
            className="bg-[#F3BC00] hover:bg-[#e0ac00] rounded-xl p-3 flex flex-col items-center gap-1.5 shadow-md transition-colors">
            <FileText className="w-6 h-6 text-[#062444]" />
            <span className="text-[#062444] font-bold text-[11px] text-center leading-tight">Submit Proposal</span>
          </motion.button>
        ) : (
          <div className="bg-[#f7f9fc] rounded-xl p-3 flex flex-col items-center gap-1.5 border-2 border-transparent opacity-60" title="Only scholars holding an officer position can submit proposals">
            <Lock className="w-6 h-6 text-slate-400" />
            <span className="text-slate-400 font-bold text-[11px] text-center leading-tight">Officers Only</span>
          </div>
        )}
      </div>

      {!isOfficer && (
        <p className="text-[12px] text-slate-400 italic mb-4 -mt-3">
          Only scholars holding an officer position (see Scholars' Formation Tools) can submit SDP proposals.
        </p>
      )}

      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-[#062444] font-bold text-sm flex-1">{listView === "approved" ? "Approved SDP Activities" : "My SDP Activities"}</h4>
        <span className="text-slate-400 text-xs">{displayList.length} item{displayList.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : displayList.length === 0 ? (
          <div className="text-center py-10 text-slate-400 bg-[#f7f9fc] rounded-2xl">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{listView === "approved" ? "No approved activities yet." : "No submitted activities yet."}</p>
          </div>
        ) : (
          displayList.map(act => <ActivityCard key={act.id} act={act} onClick={() => setSelectedActivity(act)} />)
        )}
      </div>

      <AnimatePresence>
        {showProposal && <ProposalForm onClose={() => setShowProposal(false)} onSubmit={handleSubmit} />}
      </AnimatePresence>
      <AnimatePresence>
        {selectedActivity && <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}
      </AnimatePresence>
    </SectionCard>
  );
}
