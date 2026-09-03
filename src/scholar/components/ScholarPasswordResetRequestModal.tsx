import { useState } from "react";
import { X, IdCard, User, School, GraduationCap, KeyRound } from "lucide-react";
import { requestScholarPasswordReset } from "../scholarApi";
import { FORMATION_YEAR_LEVELS } from "../formationActivitiesApi";

/**
 * The real forgot-password flow isn't functional yet, so this collects
 * enough identifying info for staff to manually verify and reset a
 * scholar's password by hand — submitted to a staff-managed Google Sheet
 * via the scholar-password-reset-request Edge Function (deliberately
 * callable while signed out; see scholarApi.ts). Styled to match
 * ChangePasswordModal.tsx's established modal skeleton.
 */
export function ScholarPasswordResetRequestModal({ onClose }: { onClose: () => void }) {
  const [scholarId, setScholarId] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [school, setSchool] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!lastName.trim() || !firstName.trim() || !school.trim() || !yearLevel) {
      setError("Please fill in Last Name, First Name, School, and Year Level.");
      return;
    }

    setBusy(true);
    const result = await requestScholarPasswordReset({
      scholarId: scholarId.trim(),
      lastName: lastName.trim(),
      firstName: firstName.trim(),
      middleInitial: middleInitial.trim(),
      school: school.trim(),
      yearLevel,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't submit the request."); return; }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <KeyRound size={17} className="text-[#F3BC00]" /> Request Password Reset
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {done ? (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-[#062444] mb-1">Request submitted.</p>
              <p className="text-sm text-slate-500 mb-5">
                Please wait for at least 20 minutes and login again using the default password "123456".
              </p>
              <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="text-[12.5px] text-slate-500 mb-5">
                Fill in your details below and staff will manually reset your password.
              </p>

              <Field icon={<IdCard size={15} />} label="Scholar ID (optional)" value={scholarId} onChange={setScholarId} placeholder="20180000" />
              <Field icon={<User size={15} />} label="Last Name" value={lastName} onChange={setLastName} placeholder="Enter your last name" />
              <Field icon={<User size={15} />} label="First Name" value={firstName} onChange={setFirstName} placeholder="Enter your first name" />
              <Field icon={<User size={15} />} label="Middle Initial" value={middleInitial} onChange={v => setMiddleInitial(v.slice(0, 1))} placeholder="M" maxLength={1} />
              <Field icon={<School size={15} />} label="School" value={school} onChange={setSchool} placeholder="Enter your school" />

              <div className="mb-4">
                <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Year Level</label>
                <div className="flex items-center border border-[#062444]/15 rounded-lg px-3 py-2.5 gap-2">
                  <span className="text-[#0088cc] shrink-0"><GraduationCap size={15} /></span>
                  <select value={yearLevel} onChange={e => setYearLevel(e.target.value)} className="w-full text-sm outline-none bg-transparent text-slate-700">
                    <option value="" disabled>Select year level</option>
                    {FORMATION_YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value, onChange, placeholder, maxLength }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string; maxLength?: number;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center border border-[#062444]/15 rounded-lg px-3 py-2.5 gap-2">
        <span className="text-[#0088cc] shrink-0">{icon}</span>
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
          className="w-full text-sm outline-none placeholder:text-slate-300" />
      </div>
    </div>
  );
}
