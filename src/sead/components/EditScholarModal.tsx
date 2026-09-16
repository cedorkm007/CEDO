import { useEffect, useState } from "react";
import { X, Pencil } from "lucide-react";
import { fetchScholarInformationByIdNumber, bulkUpdateScholars, type BulkScholarUpdateInput } from "../seadApi";
import { SCHOLARSHIP_STATUSES, type ScholarListItem, type ScholarshipStatus } from "../types";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";

const CIVIL_STATUS_OPTIONS = ["Single", "Single Parent", "Married", "Widow", "Separated"];

type EditableFields = Omit<BulkScholarUpdateInput, "scholarIdNumber">;

export function EditScholarModal({ scholar, onClose, onSaved }: { scholar: ScholarListItem; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditableFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const info = await fetchScholarInformationByIdNumber(scholar.scholarIdNumber);
      setForm({
        firstName: info?.firstName ?? scholar.firstName,
        middleName: info?.middleName ?? scholar.middleName,
        lastName: info?.lastName ?? scholar.lastName,
        birthday: info?.birthday ?? "",
        school: info?.school ?? scholar.school,
        course: info?.course ?? "",
        yearLevel: info?.yearLevel ?? "",
        civilStatus: info?.civilStatus ?? "",
        contactNo: info?.contactNo ?? "",
        barangay: info?.barangay ?? "",
        scholarshipStatus: info?.status ?? scholar.status,
        fatherFirstName: info?.fatherFirstName ?? "",
        fatherMiddleInitial: info?.fatherMiddleInitial ?? "",
        fatherLastName: info?.fatherLastName ?? "",
        motherFirstName: info?.motherFirstName ?? "",
        motherMiddleInitial: info?.motherMiddleInitial ?? "",
        motherLastName: info?.motherLastName ?? "",
      });
      setLoading(false);
    })();
  }, [scholar]);

  function set<K extends keyof EditableFields>(key: K, value: EditableFields[K]) {
    setForm(f => f && { ...f, [key]: value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError("");
    if (!form.firstName?.trim() || !form.lastName?.trim()) {
      setError("First name and last name are required.");
      return;
    }
    setBusy(true);
    const { results } = await bulkUpdateScholars([{ scholarIdNumber: scholar.scholarIdNumber, ...form }]);
    setBusy(false);
    const result = results[0];
    if (!result?.ok) { setError(result?.error || "Failed to update scholar."); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <Pencil size={16} className="text-[#F3BC00]" /> Edit Scholar
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          <p className="text-[12px] text-slate-400 mb-4">
            Scholar ID <span className="font-semibold text-[#062444]">{scholar.scholarIdNumber}</span>
          </p>

          {loading || !form ? (
            <p className="text-center text-slate-400 py-6">Loading…</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <F label="First Name" value={form.firstName ?? ""} onChange={v => set("firstName", v)} required />
                <F label="Middle Name" value={form.middleName ?? ""} onChange={v => set("middleName", v)} />
                <F label="Last Name" value={form.lastName ?? ""} onChange={v => set("lastName", v)} required />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <F label="Birthday" type="date" value={form.birthday ?? ""} onChange={v => set("birthday", v)} />
                <F label="Contact No." value={form.contactNo ?? ""} onChange={v => set("contactNo", v)} />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <F label="School" value={form.school ?? ""} onChange={v => set("school", v)} />
                <F label="Program" value={form.course ?? ""} onChange={v => set("course", v)} />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Year Level</label>
                  <select value={form.yearLevel ?? ""} onChange={e => set("yearLevel", e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none bg-white">
                    <option value="">-- Select --</option>
                    {FORMATION_YEAR_LEVELS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Barangay</label>
                  <select value={form.barangay ?? ""} onChange={e => set("barangay", e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none bg-white">
                    <option value="">-- Select --</option>
                    {ALL_BARANGAYS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Civil Status</label>
                  <select value={form.civilStatus ?? ""} onChange={e => set("civilStatus", e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none bg-white">
                    <option value="">-- Select --</option>
                    {CIVIL_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Scholarship Status</label>
                  <select value={form.scholarshipStatus ?? ""} onChange={e => set("scholarshipStatus", e.target.value as ScholarshipStatus)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none bg-white">
                    {SCHOLARSHIP_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Father's Complete Name</p>
                <div className="grid grid-cols-3 gap-3">
                  <F label="First Name" value={form.fatherFirstName ?? ""} onChange={v => set("fatherFirstName", v)} />
                  <F label="Middle Initial" value={form.fatherMiddleInitial ?? ""} onChange={v => set("fatherMiddleInitial", v)} />
                  <F label="Last Name" value={form.fatherLastName ?? ""} onChange={v => set("fatherLastName", v)} />
                </div>
              </div>
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Mother's Complete Name</p>
                <div className="grid grid-cols-3 gap-3">
                  <F label="First Name" value={form.motherFirstName ?? ""} onChange={v => set("motherFirstName", v)} />
                  <F label="Middle Initial" value={form.motherMiddleInitial ?? ""} onChange={v => set("motherMiddleInitial", v)} />
                  <F label="Last Name" value={form.motherLastName ?? ""} onChange={v => set("motherLastName", v)} />
                </div>
              </div>

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-[#062444] px-4 py-2.5">
                  Cancel
                </button>
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
    </div>
  );
}
