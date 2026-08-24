import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Check, GripVertical, ClipboardList, ClipboardCheck, SlidersHorizontal } from "lucide-react";
import {
  fetchSubmissionActivities, createSubmissionActivity, updateSubmissionActivity, deleteSubmissionActivity,
  fetchSubmissionActivityConditions, setSubmissionActivityConditions, SUBMISSION_ALLOWED_FILE_TYPES,
  type SubmissionActivity, type SubmissionActivityInput, type SubmissionActivityCondition, type SubmissionFileCategory,
} from "../submissionActivitiesApi";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { SubmissionReviewPanel } from "./SubmissionReviewPanel";
import { fetchSubjects } from "../seadApi";
import type { QuestSubject } from "../types";
import { fetchFormationActivities } from "../formationActivitiesApi";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";
import { fetchAllSDPActivities, type SDPActivity } from "../sdpMonitorApi";

const ALL_CATEGORY_LABELS = SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label);
type DraftField = { id?: string; label: string; isRequired: boolean; maxFiles: number; allowedCategories: SubmissionFileCategory[] };

function SubmissionActivityConditionsModal({ activity, onClose, onSaved }: { activity: SubmissionActivity; onClose: () => void; onSaved: () => void }) {
  const [conditions, setConditions] = useState<SubmissionActivityCondition[]>([]);
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [formationActivities, setFormationActivities] = useState<FormationActivity[]>([]);
  const [sdpActivities, setSdpActivities] = useState<SDPActivity[]>([]);
  const [type, setType] = useState<SubmissionActivityCondition["type"]>("quest_subject");
  const [selected, setSelected] = useState("");
  const [course, setCourse] = useState("");
  const [allYears, setAllYears] = useState(true);
  const [years, setYears] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void (async () => {
    const results = await Promise.all([fetchSubmissionActivityConditions(activity.id), fetchSubjects(), fetchFormationActivities(), fetchAllSDPActivities()]);
    setConditions(results[0]); setSubjects(results[1]); setFormationActivities(results[2]); setSdpActivities(results[3]);
  })(); }, [activity.id]);

  function conditionLabel(condition: SubmissionActivityCondition): string {
    if (condition.type === "quest_subject") { const subject = subjects.find(item => item.id === condition.subjectId); return "Pass: " + (condition.subjectName || subject?.name || "Quest subject") + " (" + (subject?.passingRateMin ?? "?") + "%–" + (subject?.passingRateMax ?? "?") + "%)"; }
    if (condition.type === "formation_activity") return "Formation attendance: " + (condition.formationActivityName || formationActivities.find(item => item.id === condition.formationActivityId)?.name || "Activity");
    if (condition.type === "sdp_activity") return "SDP attendance: " + (condition.sdpActivityName || sdpActivities.find(item => item.id === condition.sdpActivityId)?.name || "Activity");
    if (condition.type === "course") return "Course: " + condition.course;
    return condition.allYearLevels ? "Year level: Any" : "Year level: " + condition.yearLevels.join(", ");
  }

  function addCondition() {
    setError("");
    if (type === "year_level") {
      if (conditions.some(condition => condition.type === "year_level")) { setError("Only one year-level rule is allowed."); return; }
      if (!allYears && years.length === 0) { setError("Choose at least one year level."); return; }
      setConditions(current => [...current, { type, allYearLevels: allYears, yearLevels: allYears ? [] : years }]); return;
    }
    if (type === "course") {
      const value = course.trim();
      if (!value) { setError("Enter a course."); return; }
      if (conditions.some(condition => condition.type === "course" && condition.course.trim().toLowerCase() === value.toLowerCase())) { setError("That course rule already exists."); return; }
      setConditions(current => [...current, { type, course: value }]); setCourse(""); return;
    }
    if (!selected) { setError("Choose an activity or subject."); return; }
    if (type === "quest_subject") { const item = subjects.find(subject => subject.id === selected); if (conditions.some(condition => condition.type === type && condition.subjectId === selected)) { setError("That subject rule already exists."); return; } setConditions(current => [...current, { type, subjectId: selected, subjectName: item?.name }]); }
    else if (type === "formation_activity") { const item = formationActivities.find(activityItem => activityItem.id === selected); if (conditions.some(condition => condition.type === type && condition.formationActivityId === selected)) { setError("That formation activity rule already exists."); return; } setConditions(current => [...current, { type, formationActivityId: selected, formationActivityName: item?.name }]); }
    else { const item = sdpActivities.find(activityItem => activityItem.id === selected); if (conditions.some(condition => condition.type === type && condition.sdpActivityId === selected)) { setError("That SDP activity rule already exists."); return; } setConditions(current => [...current, { type, sdpActivityId: selected, sdpActivityName: item?.name }]); }
    setSelected("");
  }

  async function save() { setBusy(true); setError(""); const result = await setSubmissionActivityConditions(activity.id, conditions); setBusy(false); if (!result.ok) { setError(result.error || "Could not save conditions."); return; } onSaved(); onClose(); }
  const options = type === "quest_subject"
    ? subjects.map(item => ({ id: item.id, name: item.name, rate: item.passingRateMin + "%–" + item.passingRateMax + "%" }))
    : (type === "formation_activity" ? formationActivities : sdpActivities).map(item => ({ id: item.id, name: item.name, rate: "" }));
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
    <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4"><h3 className="text-[15px] font-bold text-white">Unlock Conditions — {activity.name}</h3><button onClick={onClose} className="text-white"><X size={18} /></button></div>
    <div className="space-y-4 p-6"><p className="text-[12px] text-slate-500">All listed rules are required before a scholar can upload files. No rules means the activity is available to its eligible year levels.</p>
      <div className="space-y-2">{conditions.map((condition, index) => <div key={index} className="flex items-center justify-between rounded-lg border border-[#e6ecf5] bg-[#f8fafd] px-3 py-2 text-[12px] font-semibold text-[#062444]"><span>{conditionLabel(condition)}</span><button onClick={() => setConditions(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></div>)}</div>
      <div className="space-y-2 rounded-lg border border-dashed border-[#062444]/20 p-3"><select value={type} onChange={event => { setType(event.target.value as SubmissionActivityCondition["type"]); setSelected(""); }} className="w-full rounded-lg border p-2 text-sm"><option value="quest_subject">Quest Subject</option><option value="formation_activity">Formation Activity</option><option value="sdp_activity">SDP Activity</option><option value="course">Course</option><option value="year_level">Year Level</option></select>
      {type === "course" ? <input value={course} onChange={event => setCourse(event.target.value)} placeholder="e.g. BSIT" className="w-full rounded-lg border p-2 text-sm" /> : type === "year_level" ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={allYears} onChange={event => setAllYears(event.target.checked)} /> Any year level</label>{!allYears && <div className="flex flex-wrap gap-1">{FORMATION_YEAR_LEVELS.map(year => <label key={year} className="rounded border px-2 py-1 text-xs"><input type="checkbox" checked={years.includes(year)} onChange={() => setYears(current => current.includes(year) ? current.filter(item => item !== year) : [...current, year])} /> {year}</label>)}</div>}</> : <select value={selected} onChange={event => setSelected(event.target.value)} className="w-full rounded-lg border p-2 text-sm"><option value="">Select…</option>{options.map(item => <option key={item.id} value={item.id}>{item.name}{item.rate ? " — " + item.rate : ""}</option>)}</select>}
      <button onClick={addCondition} className="w-full rounded-lg bg-[#eef7fc] py-2 text-xs font-bold text-[#0088cc]"><Plus size={13} className="mr-1 inline" />Add required condition</button></div>
      {error && <p className="text-sm text-red-600">{error}</p>}<button onClick={() => void save()} disabled={busy} className="w-full rounded-lg bg-[#062444] py-2.5 text-sm font-bold text-white">{busy ? "Saving…" : "Save Conditions"}</button>
    </div></div></div>;
}

/**
 * Create/edit modal for one Submission Activity. Upload fields are edited
 * as a local draft list (add/remove/reorder). On save, the whole list is
 * sent to setSubmissionUploadFields() in submissionActivitiesApi.ts,
 * which upserts-and-prunes by each field's `id` rather than replacing the
 * whole set — an existing field (loaded with its real `id` below) keeps
 * that id across edits/reorders, a newly-added field has no `id` until
 * it's saved. This matters starting Part 2: submission_uploads rows
 * reference a field by id, so field ids need to stay stable across
 * ordinary staff edits.
 */
function SubmissionActivityModal({ activity, onClose, onSaved }: { activity: SubmissionActivity | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(activity?.name ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [allYearLevels, setAllYearLevels] = useState(activity?.allYearLevels ?? true);
  const [yearLevels, setYearLevels] = useState<string[]>(activity?.targetYearLevels ?? []);
  const [fields, setFields] = useState<DraftField[]>(
    activity ? activity.uploadFields.map(f => ({ id: f.id, label: f.label, isRequired: f.isRequired, maxFiles: f.maxFiles, allowedCategories: f.allowedCategories })) : []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function addField() { setFields(fs => [...fs, { label: "", isRequired: true, maxFiles: 1, allowedCategories: [...ALL_CATEGORY_LABELS] }]); }
  function removeField(index: number) { setFields(fs => fs.filter((_, i) => i !== index)); }
  function updateField(index: number, patch: Partial<DraftField>) { setFields(fs => fs.map((f, i) => i === index ? { ...f, ...patch } : f)); }
  function moveField(index: number, direction: -1 | 1) {
    setFields(fs => {
      const target = index + direction;
      if (target < 0 || target >= fs.length) return fs;
      const next = [...fs];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) { setError("Enter an activity name."); return; }
    if (!allYearLevels && yearLevels.length === 0) { setError('Select at least one year level, or check "All Year Levels."'); return; }
    if (fields.some(f => !f.label.trim())) { setError("Every upload field needs a label."); return; }
    if (fields.some(f => f.maxFiles < 1)) { setError("Max files must be at least 1 for every field."); return; }
    if (fields.some(f => f.allowedCategories.length === 0)) { setError("Every upload field needs at least one allowed document type."); return; }

    setBusy(true);
    setError("");
    const input: SubmissionActivityInput = {
      name: name.trim(), description: description.trim(),
      allYearLevels, targetYearLevels: allYearLevels ? [] : yearLevels,
      uploadFields: fields.map(f => ({ id: f.id, label: f.label.trim(), isRequired: f.isRequired, maxFiles: f.maxFiles, allowedCategories: f.allowedCategories })),
    };
    const result = activity ? await updateSubmissionActivity(activity.id, input) : await createSubmissionActivity(input);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save the activity."); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="text-[15px] font-bold text-white">{activity ? "Edit Submission Activity" : "New Submission Activity"}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Activity name (e.g. Certificate of Participation Drive)" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Short description (optional)" rows={2} className="w-full resize-none rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <div>
            <p className="mb-1.5 text-[12px] font-bold text-[#062444]">Eligible year levels</p>
            <label className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-slate-600">
              <input type="checkbox" checked={allYearLevels} onChange={event => setAllYearLevels(event.target.checked)} />
              All Year Levels
            </label>
            {!allYearLevels && (
              <div className="flex flex-wrap gap-1.5">
                {FORMATION_YEAR_LEVELS.map(level => (
                  <label key={level} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer ${yearLevels.includes(level) ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-600"}`}>
                    <input type="checkbox" className="hidden" checked={yearLevels.includes(level)}
                      onChange={() => setYearLevels(ls => ls.includes(level) ? ls.filter(l => l !== level) : [...ls, level])} />
                    {level}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[12px] font-bold text-[#062444]">Required upload fields</p>
              <button type="button" onClick={addField} className="flex items-center gap-1 text-[11.5px] font-bold text-[#0088cc]"><Plus size={13} /> Add field</button>
            </div>
            {fields.length === 0 && <p className="text-[12px] text-slate-400">No upload fields yet — add at least one so scholars know what to submit.</p>}
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={index} className="rounded-lg border border-[#e6ecf5] bg-[#f8fafd] p-2.5">
                  <div className="flex items-center gap-1.5">
                    <div className="flex flex-col text-slate-300">
                      <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0} className="disabled:opacity-30" aria-label="Move up"><GripVertical size={12} /></button>
                    </div>
                    <input value={field.label} onChange={event => updateField(index, { label: event.target.value })} placeholder="Field label (e.g. Certificate of Participation)" className="flex-1 rounded-md border border-[#062444]/15 bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-[#0088cc]" />
                    <button type="button" onClick={() => removeField(index)} className="text-slate-400 hover:text-red-600" aria-label="Remove field"><Trash2 size={14} /></button>
                  </div>
                  <div className="mt-2 flex items-center gap-3 pl-[18px] text-[11.5px] text-slate-500">
                    <label className="flex items-center gap-1.5 font-semibold">
                      <input type="checkbox" checked={field.isRequired} onChange={event => updateField(index, { isRequired: event.target.checked })} /> Required
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold">
                      Max files
                      <input type="number" min={1} max={20} value={field.maxFiles} onChange={event => updateField(index, { maxFiles: Math.max(1, Number(event.target.value) || 1) })} className="w-14 rounded-md border border-[#062444]/15 bg-white px-1.5 py-1 text-center outline-none focus:border-[#0088cc]" />
                    </label>
                    <button type="button" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1} className="ml-auto text-slate-400 disabled:opacity-30">Move down</button>
                  </div>
                  <div className="mt-2 pl-[18px]">
                    <p className="mb-1 text-[10.5px] font-bold uppercase text-slate-400">Allowed document types</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_CATEGORY_LABELS.map(category => {
                        const isChecked = field.allowedCategories.includes(category);
                        return (
                          <label
                            key={category}
                            className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] font-semibold ${isChecked ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] bg-white text-slate-500"}`}
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isChecked}
                              onChange={() => updateField(index, {
                                allowedCategories: isChecked ? field.allowedCategories.filter(c => c !== category) : [...field.allowedCategories, category],
                              })}
                            />
                            {category}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSubmit()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Check size={15} />{busy ? "Saving…" : activity ? "Save Changes" : "Create Activity"}</button>
        </div>
      </div>
    </div>
  );
}

export function SubmissionActivitiesSection() {
  const [activities, setActivities] = useState<SubmissionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<SubmissionActivity | null>(null);
  const [reviewing, setReviewing] = useState<SubmissionActivity | null>(null);
  const [managingConditions, setManagingConditions] = useState<SubmissionActivity | null>(null);

  async function load() { setLoading(true); setActivities(await fetchSubmissionActivities()); setLoading(false); }
  useEffect(() => { void load(); }, []);

  async function handleDelete(activity: SubmissionActivity) {
    if (!window.confirm(`Delete "${activity.name}"? This cannot be undone.`)) return;
    const result = await deleteSubmissionActivity(activity.id);
    if (!result.ok) window.alert(result.error || "Couldn't delete the activity.");
    else void load();
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-extrabold text-[#062444]">Submission Activities</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">Define activities that ask scholars to upload files, shown under Calendar and Activities → Activities. Use the review icon on an activity to see and act on what scholars have submitted.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-2 text-[12.5px] font-bold text-[#F3BC00]"><Plus size={15} /> New Activity</button>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No submission activities yet.</p>
      ) : (
        <div className="space-y-2.5">
          {activities.map(activity => (
            <div key={activity.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-[#062444]">
                    <ClipboardList size={14} className="shrink-0 text-[#0088cc]" /> {activity.name}
                  </h3>
                  {activity.description && <p className="mt-1 text-[12px] text-slate-500">{activity.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => setManagingConditions(activity)} className="text-slate-400 hover:text-[#0088cc]" aria-label="Manage unlock conditions"><SlidersHorizontal size={15} /></button>
                  <button onClick={() => setReviewing(activity)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Review submissions for ${activity.name}`}><ClipboardCheck size={15} /></button>
                  <button onClick={() => setEditing(activity)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Edit ${activity.name}`}><Pencil size={15} /></button>
                  <button onClick={() => void handleDelete(activity)} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${activity.name}`}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
                <span className="rounded-full bg-[#f0f3f8] px-2 py-0.5 font-semibold text-[#062444]">
                  {activity.allYearLevels ? "All Year Levels" : activity.targetYearLevels.join(", ") || "No year level set"}
                </span>
                <span>{activity.uploadFields.length} upload field{activity.uploadFields.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <SubmissionActivityModal activity={null} onClose={() => setShowNew(false)} onSaved={() => void load()} />}
      {editing && <SubmissionActivityModal activity={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {reviewing && <SubmissionReviewPanel activity={reviewing} activities={activities} onClose={() => setReviewing(null)} />}
      {managingConditions && <SubmissionActivityConditionsModal activity={managingConditions} onClose={() => setManagingConditions(null)} onSaved={() => void load()} />}
    </div>
  );
}
