import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { SELF_GRADES_MAX_IMAGES, SELF_GRADES_MAX_SUBJECTS, SELF_GRADES_WARNING, validateSelfGradeImage, validateSelfGradeLines } from "@/lib/renewal";

export interface GradeFormRow { code: string; subject: string; units: string; grade: string }
export const emptyGradeRow = (): GradeFormRow => ({ code: "", subject: "", units: "", grade: "" });
export interface GradeFormFile { name: string; path: string }

/** What is still missing before the grades can be sent: null when everything is there (subjects, at least one image, the tick). */
export function gradeFormProblem(rows: GradeFormRow[], imageCount: number, acknowledged: boolean): string | null {
  const p = validateSelfGradeLines(rows);
  if (p) return p;
  if (imageCount === 0) return "Upload at least one screenshot or image of your grades.";
  if (!acknowledged) return "Tick the box to say you understand.";
  return null;
}

const inputCls = "w-full rounded-lg border border-[#062444]/25 px-2.5 py-2 text-[14px] outline-none focus:border-[#062444] bg-white";

/**
 * The form where a scholar enters their grades: for every subject the code, the name, the units and the grade; one to five screenshots / images of the grades; and the tick that wrong
 * or false information means disciplinary action or removal from the scholarship. It only holds what is typed (the parent keeps the state and sends it): used on the renewal page
 * ("Your grades") and inside the application form.
 */
export function SelfGradesForm({ basis, rows, setRows, keep, setKeep, newFiles, setNewFiles, ack, setAck, onError }: {
  basis: string; rows: GradeFormRow[]; setRows: (r: GradeFormRow[]) => void; keep: GradeFormFile[]; setKeep: (k: GradeFormFile[]) => void;
  newFiles: File[]; setNewFiles: (f: File[]) => void; ack: boolean; setAck: (a: boolean) => void; onError: (message: string) => void;
}) {
  const setRow = (i: number, patch: Partial<GradeFormRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function addFiles(list: FileList | null) {
    if (!list) return;
    let count = keep.length + newFiles.length; const accepted: File[] = [];
    for (const f of [...list]) { const p = validateSelfGradeImage(f, count); if (p) { onError(p); continue; } accepted.push(f); count++; }
    if (accepted.length) { onError(""); setNewFiles([...newFiles, ...accepted]); }
  }
  return (
    <div className="space-y-3 text-[14px] text-slate-900">
      <p>Enter every subject of {basis}, exactly as in your screenshot.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-[#e6ecf5] bg-white p-2 sm:grid-cols-[8rem_1fr_5rem_6rem_auto]">
            <input value={r.code} onChange={e => setRow(i, { code: e.target.value })} placeholder="Subject code" aria-label={`Subject ${i + 1} code`} maxLength={30} className={inputCls} />
            <input value={r.subject} onChange={e => setRow(i, { subject: e.target.value })} placeholder="Subject name" aria-label={`Subject ${i + 1} name`} maxLength={150} className={`${inputCls} col-span-2 sm:col-span-1`} />
            <input value={r.units} onChange={e => setRow(i, { units: e.target.value })} placeholder="Units" aria-label={`Subject ${i + 1} units`} inputMode="decimal" maxLength={5} className={inputCls} />
            <input value={r.grade} onChange={e => setRow(i, { grade: e.target.value })} placeholder="Grade" aria-label={`Subject ${i + 1} grade`} maxLength={12} className={inputCls} />
            <button type="button" onClick={() => setRows(rows.length === 1 ? [emptyGradeRow()] : rows.filter((_, j) => j !== i))} aria-label={`Remove subject ${i + 1}`} className="flex items-center justify-center rounded-lg border border-[#062444]/25 px-2 text-[#062444] hover:bg-[#f7f9fc]"><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows([...rows, emptyGradeRow()])} disabled={rows.length >= SELF_GRADES_MAX_SUBJECTS} className="inline-flex items-center gap-1.5 font-semibold text-[#00709f] hover:underline disabled:opacity-50"><Plus size={14} aria-hidden="true" /> Add a subject</button>

      <div>
        <p className="font-semibold text-[#062444]">Screenshot or image of your grades</p>
        <p className="text-[13.5px] text-slate-700">Upload at least one clear JPG, PNG or WEBP image (up to {SELF_GRADES_MAX_IMAGES}, 10 MB each) that shows your grades.</p>
        <ul className="mt-1 space-y-1">
          {keep.map(f => <li key={f.path} className="flex items-center justify-between gap-2 rounded-md border border-[#e6ecf5] bg-white px-2 py-1"><span className="break-all">{f.name} (already sent)</span><button type="button" onClick={() => setKeep(keep.filter(x => x.path !== f.path))} aria-label={`Remove ${f.name}`} className="font-semibold text-red-800">Remove</button></li>)}
          {newFiles.map((f, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-[#e6ecf5] bg-white px-2 py-1"><span className="break-all">{f.name}</span><button type="button" onClick={() => setNewFiles(newFiles.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="font-semibold text-red-800">Remove</button></li>)}
        </ul>
        <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">
          <ImagePlus size={15} aria-hidden="true" /> Add an image
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-950">
        <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
        <span>{SELF_GRADES_WARNING}</span>
      </label>
    </div>
  );
}
