import { useEffect, useState } from "react";
import { FileText, Link2, Plus, Pencil, Trash2, X, Check, UploadCloud, Eye, ShieldCheck, ShieldAlert, SlidersHorizontal } from "lucide-react";
import {
  fetchFormMaterials, createFormMaterial, updateFormMaterial, deleteFormMaterial,
  uploadFormMaterialFile, removeFormMaterialFile, fetchFormMaterialPreviewUrl, setFormMaterialConditions,
} from "../formsManagementApi";
import { isValidHttpsUrl } from "@/lib/urlValidation";
import type { FormMaterial, FormMaterialKind, FormMaterialCondition } from "../formsManagementApi";
import { fetchSubjects } from "../seadApi";
import type { QuestSubject } from "../types";
import { fetchFormationActivities } from "../formationActivitiesApi";
import { FORMATION_YEAR_LEVELS, type FormationActivity } from "@/scholar/formationActivitiesApi";
import { fetchAllSDPActivities, type SDPActivity } from "../sdpMonitorApi";

/**
 * Staff-side list + create/edit UI for the materials scholars see under
 * Forms and Services. Unlock conditions are managed separately, via the
 * FormMaterialConditionsModal opened from each row's sliders icon.
 */
function FormMaterialModal({ material, onClose, onSaved }: { material: FormMaterial | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(material?.title ?? "");
  const [kind, setKind] = useState<FormMaterialKind>(material?.kind ?? "pdf");
  const [description, setDescription] = useState(material?.description ?? "");
  const [url, setUrl] = useState(material?.kind === "flipbook" ? material.url : "");
  const [file, setFile] = useState<File | null>(null);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!title.trim()) { setError("Enter a title."); return; }
    if (kind === "flipbook" && !isValidHttpsUrl(url)) { setError("Enter a valid https:// flipbook link."); return; }
    if (kind === "flipbook" && !url.trim()) { setError("Enter the flipbook link."); return; }
    if (kind === "pdf" && !material && !file) { setError("Choose a PDF file to upload."); return; }

    setBusy(true);
    setError("");
    const fields = { title: title.trim(), kind, url: kind === "flipbook" ? url.trim() : "", description: description.trim() };

    let materialId: string | undefined;
    if (material) {
      const updateResult = await updateFormMaterial(material.id, fields);
      if (!updateResult.ok) { setBusy(false); setError(updateResult.error || "Couldn't save the material."); return; }
      materialId = material.id;
    } else {
      const createResult = await createFormMaterial(fields.title, fields.kind, fields.url, fields.description);
      if (!createResult.ok) { setBusy(false); setError(createResult.error || "Couldn't save the material."); return; }
      materialId = createResult.id;
    }

    if (kind === "pdf" && materialId) {
      if (file) {
        const uploadResult = await uploadFormMaterialFile(materialId, file);
        if (!uploadResult.ok) { setBusy(false); setError(`Saved, but the file upload failed: ${uploadResult.error}`); return; }
      } else if (removeExistingFile) {
        const removeResult = await removeFormMaterialFile(materialId);
        if (!removeResult.ok) { setBusy(false); setError(`Saved, but removing the file failed: ${removeResult.error}`); return; }
      }
    }
    setBusy(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="text-[15px] font-bold text-white">{material ? "Edit Material" : "New Form Material"}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Title (e.g. Scholarship Application Form)" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Description (optional)" rows={3} className="w-full resize-none rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />

          <div className="flex gap-2">
            <button type="button" onClick={() => setKind("pdf")} disabled={!!material} className={`flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold disabled:opacity-50 ${kind === "pdf" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>PDF Upload</button>
            <button type="button" onClick={() => setKind("flipbook")} disabled={!!material} className={`flex-1 rounded-lg border px-2 py-2 text-[11.5px] font-bold disabled:opacity-50 ${kind === "flipbook" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>Flipbook Link</button>
          </div>
          {material && <p className="text-[11px] text-slate-400">The material type can't be changed after creation — delete and re-create instead.</p>}

          {kind === "flipbook" ? (
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" className="w-full rounded-lg border border-[#062444]/15 px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
          ) : (
            <div className="space-y-2 rounded-lg bg-[#f8fafd] p-3">
              {material?.fileName && !removeExistingFile && !file && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[#e6ecf5] bg-white px-3 py-2">
                  <span className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-[#062444]"><FileText size={14} className="shrink-0" />{material.fileName}</span>
                  <button type="button" onClick={() => setRemoveExistingFile(true)} className="shrink-0 text-slate-400 hover:text-red-600" aria-label="Remove file"><Trash2 size={14} /></button>
                </div>
              )}
              {removeExistingFile && <p className="text-[12px] text-red-600">File will be removed when you save.</p>}
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#062444]/25 bg-white px-3 py-2.5 text-[12px] font-semibold text-[#0088cc] hover:bg-[#f0f7fc]">
                <UploadCloud size={14} />
                {file ? file.name : material?.fileName ? "Replace PDF file" : "Choose PDF file"}
                <input type="file" accept="application/pdf" className="hidden" onChange={event => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); if (chosen) setRemoveExistingFile(false); }} />
              </label>
            </div>
          )}

          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSubmit()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Check size={15} />{busy ? "Saving…" : material ? "Save Changes" : "Create Material"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-material unlock-condition editor. Lets staff add/remove rules of the
 * 4 condition types and saves the whole set at once via
 * setFormMaterialConditions(). Note: this only manages which rows exist in
 * form_material_conditions — the scholar-side "show this material once a
 * rule is met" evaluation isn't built yet (see the RLS comment in
 * src/scholar/formsApi.ts): today, any material with 1+ conditions is
 * simply hidden from every scholar until that check exists.
 */
function FormMaterialConditionsModal({ material, onClose, onSaved }: { material: FormMaterial; onClose: () => void; onSaved: () => void }) {
  const [conditions, setConditions] = useState<FormMaterialCondition[]>(material.conditions);
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [activities, setActivities] = useState<FormationActivity[]>([]);
  const [sdpActivities, setSdpActivities] = useState<SDPActivity[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [newType, setNewType] = useState<FormMaterialCondition["type"]>("quest_subject");
  const [newSubjectId, setNewSubjectId] = useState("");
  const [newActivityId, setNewActivityId] = useState("");
  const [newSdpActivityId, setNewSdpActivityId] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newAllYearLevels, setNewAllYearLevels] = useState(true);
  const [newYearLevels, setNewYearLevels] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      setLoadingOptions(true);
      const [s, a, sdp] = await Promise.all([fetchSubjects(), fetchFormationActivities(), fetchAllSDPActivities()]);
      setSubjects(s);
      setActivities(a);
      setSdpActivities(sdp);
      setLoadingOptions(false);
    })();
  }, []);

  function conditionLabel(c: FormMaterialCondition): string {
    switch (c.type) {
      case "quest_subject":
        return `Subject: ${c.subjectName || subjects.find(s => s.id === c.subjectId)?.name || "Unknown subject"}`;
      case "formation_activity":
        return `Formation Activity: ${c.formationActivityName || activities.find(a => a.id === c.formationActivityId)?.name || "Unknown activity"}`;
      case "sdp_activity":
        return `SDP Activity: ${c.sdpActivityName || sdpActivities.find(a => a.id === c.sdpActivityId)?.name || "Unknown activity"}`;
      case "course":
        return `Course: ${c.course}`;
      case "year_level":
        return c.allYearLevels ? "Year Level: Any" : `Year Level: ${c.yearLevels.join(", ") || "None selected"}`;
    }
  }

  function addCondition() {
    setError("");
    if (newType === "quest_subject") {
      if (!newSubjectId) { setError("Choose a subject."); return; }
      if (conditions.some(c => c.type === "quest_subject" && c.subjectId === newSubjectId)) { setError("That subject rule already exists."); return; }
      const subject = subjects.find(s => s.id === newSubjectId);
      setConditions(cs => [...cs, { type: "quest_subject", subjectId: newSubjectId, subjectName: subject?.name }]);
      setNewSubjectId("");
    } else if (newType === "formation_activity") {
      if (!newActivityId) { setError("Choose a formation activity."); return; }
      if (conditions.some(c => c.type === "formation_activity" && c.formationActivityId === newActivityId)) { setError("That activity rule already exists."); return; }
      const activity = activities.find(a => a.id === newActivityId);
      setConditions(cs => [...cs, { type: "formation_activity", formationActivityId: newActivityId, formationActivityName: activity?.name }]);
      setNewActivityId("");
    } else if (newType === "sdp_activity") {
      if (!newSdpActivityId) { setError("Choose an SDP activity."); return; }
      if (conditions.some(c => c.type === "sdp_activity" && c.sdpActivityId === newSdpActivityId)) { setError("That SDP activity rule already exists."); return; }
      const activity = sdpActivities.find(a => a.id === newSdpActivityId);
      setConditions(cs => [...cs, { type: "sdp_activity", sdpActivityId: newSdpActivityId, sdpActivityName: activity?.name }]);
      setNewSdpActivityId("");
    } else if (newType === "course") {
      const trimmed = newCourse.trim();
      if (!trimmed) { setError("Enter a course."); return; }
      // Matches DB matching, which is also case/whitespace-insensitive — so
      // "BSIT" and "bsit" are treated as the same rule here too.
      if (conditions.some(c => c.type === "course" && c.course.trim().toLowerCase() === trimmed.toLowerCase())) { setError("That course rule already exists."); return; }
      setConditions(cs => [...cs, { type: "course", course: trimmed }]);
      setNewCourse("");
    } else {
      if (conditions.some(c => c.type === "year_level")) { setError("Only one year-level rule is allowed — remove the existing one first to change it."); return; }
      if (!newAllYearLevels && newYearLevels.length === 0) { setError('Select at least one year level, or check "Any year level."'); return; }
      setConditions(cs => [...cs, { type: "year_level", allYearLevels: newAllYearLevels, yearLevels: newAllYearLevels ? [] : newYearLevels }]);
      setNewAllYearLevels(true);
      setNewYearLevels([]);
    }
  }

  function removeCondition(index: number) {
    setConditions(cs => cs.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setBusy(true);
    setError("");
    const result = await setFormMaterialConditions(material.id, conditions);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save conditions."); return; }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="min-w-0 truncate text-[15px] font-bold text-white">Unlock Conditions — {material.title}</h3>
          <button onClick={onClose} className="shrink-0 text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-6">
          <p className="text-[12px] text-slate-500">
            A material with no rules is visible to every scholar. Adding one or more rules hides this material from
            all scholars for now — showing it once a scholar actually meets a rule is a separate step that hasn't
            been built yet.
          </p>

          {conditions.length > 0 && (
            <ul className="space-y-1.5">
              {conditions.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[#e6ecf5] bg-[#f8fafd] px-3 py-2">
                  <span className="text-[12.5px] font-semibold text-[#062444]">{conditionLabel(c)}</span>
                  <button onClick={() => removeCondition(i)} className="shrink-0 text-slate-400 hover:text-red-600" aria-label="Remove rule"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2.5 rounded-lg border border-dashed border-[#062444]/20 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Add a rule</p>
            <select value={newType} onChange={event => setNewType(event.target.value as FormMaterialCondition["type"])} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
              <option value="quest_subject">Quest Subject</option>
              <option value="formation_activity">Formation Activity</option>
              <option value="sdp_activity">SDP Activity</option>
              <option value="course">Course</option>
              <option value="year_level">Year Level</option>
            </select>

            {loadingOptions ? (
              <p className="text-[12px] text-slate-400">Loading options…</p>
            ) : newType === "quest_subject" ? (
              <select value={newSubjectId} onChange={event => setNewSubjectId(event.target.value)} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
                <option value="">Select a subject…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : newType === "formation_activity" ? (
              <select value={newActivityId} onChange={event => setNewActivityId(event.target.value)} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
                <option value="">Select a formation activity…</option>
                {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : newType === "sdp_activity" ? (
              <select value={newSdpActivityId} onChange={event => setNewSdpActivityId(event.target.value)} className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]">
                <option value="">Select an SDP activity…</option>
                {sdpActivities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : newType === "course" ? (
              <div>
                <input
                  value={newCourse}
                  onChange={event => setNewCourse(event.target.value)}
                  placeholder="e.g. BSIT"
                  className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]"
                />
                <p className="mt-1 text-[11px] text-slate-400">Matched case- and whitespace-insensitively against each scholar's course on file.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#062444]">
                  <input type="checkbox" checked={newAllYearLevels} onChange={event => setNewAllYearLevels(event.target.checked)} />
                  Any year level
                </label>
                {!newAllYearLevels && (
                  <div className="flex flex-wrap gap-2">
                    {FORMATION_YEAR_LEVELS.map(level => (
                      <label key={level} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer ${newYearLevels.includes(level) ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-600"}`}>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={newYearLevels.includes(level)}
                          onChange={event => setNewYearLevels(cur => event.target.checked ? [...cur, level] : cur.filter(l => l !== level))}
                        />
                        {level}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button type="button" onClick={addCondition} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#f0f7fc] py-2 text-[12.5px] font-bold text-[#0088cc] hover:bg-[#e0f0fa]">
              <Plus size={14} /> Add Rule
            </button>
          </div>

          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button onClick={() => void handleSave()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#062444] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            <Check size={15} />{busy ? "Saving…" : "Save Conditions"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormsManagementTab() {
  const [materials, setMaterials] = useState<FormMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<FormMaterial | null>(null);
  const [managingConditions, setManagingConditions] = useState<FormMaterial | null>(null);

  async function load() { setLoading(true); setMaterials(await fetchFormMaterials()); setLoading(false); }
  useEffect(() => { void load(); }, []);

  async function handlePreview(material: FormMaterial) {
    if (material.kind === "flipbook") { window.open(material.url, "_blank", "noopener,noreferrer"); return; }
    const previewUrl = await fetchFormMaterialPreviewUrl(material.id);
    if (!previewUrl) { window.alert("No file has been uploaded for this material yet."); return; }
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(material: FormMaterial) {
    if (!window.confirm(`Delete "${material.title}"?`)) return;
    const result = await deleteFormMaterial(material.id);
    if (!result.ok) window.alert(result.error || "Couldn't delete the material.");
    else void load();
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-extrabold text-[#062444]">Forms Management</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">Upload PDFs or link flipbooks scholars see under Forms and Services.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-2 text-[12.5px] font-bold text-[#F3BC00]"><Plus size={15} /> New Material</button>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : materials.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No form materials yet.</p>
      ) : (
        <div className="space-y-2.5">
          {materials.map(material => (
            <div key={material.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-[#062444]">
                    {material.kind === "pdf" ? <FileText size={14} className="shrink-0 text-[#0088cc]" /> : <Link2 size={14} className="shrink-0 text-[#0088cc]" />}
                    {material.title}
                  </h3>
                  {material.description && <p className="mt-1 text-[12px] text-slate-500">{material.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => void handlePreview(material)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Preview ${material.title}`}><Eye size={15} /></button>
                  <button onClick={() => setManagingConditions(material)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Manage conditions for ${material.title}`}><SlidersHorizontal size={15} /></button>
                  <button onClick={() => setEditing(material)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Edit ${material.title}`}><Pencil size={15} /></button>
                  <button onClick={() => void handleDelete(material)} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${material.title}`}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
                <span className="rounded-full bg-[#f0f3f8] px-2 py-0.5 font-semibold uppercase text-[#062444]">{material.kind}</span>
                {material.kind === "pdf" && !material.fileName && <span className="text-amber-600">No file uploaded yet</span>}
                {material.conditions.length === 0 ? (
                  <span className="flex items-center gap-1 font-semibold text-green-700"><ShieldCheck size={12} /> Visible to all scholars</span>
                ) : (
                  <button onClick={() => setManagingConditions(material)} className="flex items-center gap-1 font-semibold text-amber-700 hover:underline">
                    <ShieldAlert size={12} /> {material.conditions.length} condition{material.conditions.length === 1 ? "" : "s"} set — hidden from all scholars until condition-based visibility is implemented
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <FormMaterialModal material={null} onClose={() => setShowNew(false)} onSaved={() => void load()} />}
      {editing && <FormMaterialModal material={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      {managingConditions && <FormMaterialConditionsModal material={managingConditions} onClose={() => setManagingConditions(null)} onSaved={() => void load()} />}
    </div>
  );
}
