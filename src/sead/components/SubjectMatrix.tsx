import { Plus, Trash2 } from "lucide-react";
import type { SubjectMatrixRow } from "../referralApi";

/**
 * The "Failed Subjects" / "Lacking Grades" matrix from the Referral Form
 * (Form R5) — an add/remove-row table of Subject Code / Semester &
 * Academic Year / Year Level. Shared by both matrices since they're the
 * same shape.
 */
export function SubjectMatrix({
  label, rows, onChange, readOnly = false,
}: {
  label: string;
  rows: SubjectMatrixRow[];
  onChange: (rows: SubjectMatrixRow[]) => void;
  readOnly?: boolean;
}) {
  function updateRow(index: number, patch: Partial<SubjectMatrixRow>) {
    onChange(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  }
  function addRow() {
    onChange([...rows, { subjectCode: "", semesterAcademicYear: "", yearLevel: "" }]);
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  const displayRows = readOnly ? rows.filter(r => r.subjectCode || r.semesterAcademicYear || r.yearLevel) : rows;

  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="border border-[#062444]/15 rounded-lg overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-2.5 py-2">Subject Code</th>
              <th className="px-2.5 py-2">Semester and Academic Year</th>
              <th className="px-2.5 py-2 w-24">Yr. Lvl</th>
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr><td colSpan={readOnly ? 3 : 4} className="px-2.5 py-3 text-center text-slate-400">None.</td></tr>
            ) : displayRows.map((row, i) => (
              <tr key={i} className="border-t border-[#f0f3f8]">
                {readOnly ? (
                  <>
                    <td className="px-2.5 py-2">{row.subjectCode || "—"}</td>
                    <td className="px-2.5 py-2">{row.semesterAcademicYear || "—"}</td>
                    <td className="px-2.5 py-2">{row.yearLevel || "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="px-1.5 py-1.5">
                      <input value={row.subjectCode} onChange={e => updateRow(i, { subjectCode: e.target.value })}
                        className="w-full border border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] rounded px-1.5 py-1 outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <input value={row.semesterAcademicYear} onChange={e => updateRow(i, { semesterAcademicYear: e.target.value })}
                        placeholder="e.g. 1st Sem, 2025-2026"
                        className="w-full border border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] rounded px-1.5 py-1 outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <input value={row.yearLevel} onChange={e => updateRow(i, { yearLevel: e.target.value })}
                        className="w-full border border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] rounded px-1.5 py-1 outline-none" />
                    </td>
                    <td className="text-center">
                      <button type="button" onClick={() => removeRow(i)} className="text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" onClick={addRow} className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
          <Plus size={13} /> Add row
        </button>
      )}
    </div>
  );
}
