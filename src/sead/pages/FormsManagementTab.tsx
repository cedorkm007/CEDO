import { useEffect, useState } from "react";
import { FileText, Link2, Plus, Pencil, Trash2, X, Check, UploadCloud, Eye, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  fetchFormMaterials, createFormMaterial, updateFormMaterial, deleteFormMaterial,
  uploadFormMaterialFile, removeFormMaterialFile, fetchFormMaterialPreviewUrl,
} from "../formsManagementApi";
import { isValidHttpsUrl } from "@/lib/urlValidation";
import type { FormMaterial, FormMaterialKind } from "../formsManagementApi";

/**
 * Staff-side list + create/edit UI for the materials scholars see under
 * Forms and Services. The unlock-condition editor is a separate, later
 * task — this tab only shows a read-only "visible to all / N condition(s)"
 * indicator per material for now (conditions are managed elsewhere in the
 * database until that editor exists).
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

export function FormsManagementTab() {
  const [materials, setMaterials] = useState<FormMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<FormMaterial | null>(null);

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
                  <span className="flex items-center gap-1 font-semibold text-amber-700"><ShieldAlert size={12} /> {material.conditions.length} condition{material.conditions.length === 1 ? "" : "s"} set — hidden from scholars until the condition editor is built</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <FormMaterialModal material={null} onClose={() => setShowNew(false)} onSaved={() => void load()} />}
      {editing && <FormMaterialModal material={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </div>
  );
}
