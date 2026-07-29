import { useState } from "react";
import { CheckCircle2, AlertTriangle, IdCard, User, Building2, BookOpen, Heart, Phone, MapPin, Save } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { updateOwnContactInfo } from "../../scholarApi";
import type { ScholarProfile } from "../../types";

const CIVIL_STATUS_OPTIONS = ["Single", "Single Parent", "Married", "Widow", "Separated"];

export function ProfilePanel({ profile, onProfileUpdated }: { profile: ScholarProfile; onProfileUpdated: (p: ScholarProfile) => void }) {
  const [civilStatus, setCivilStatus] = useState(profile.civilStatus || "");
  const [contactNo, setContactNo] = useState(profile.contactNo || "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    const result = await updateOwnContactInfo(civilStatus, contactNo);
    setSaving(false);
    if (result.ok) {
      setSaveMessage({ kind: "ok", text: "Saved." });
      onProfileUpdated({ ...profile, civilStatus, contactNo });
    } else {
      setSaveMessage({ kind: "error", text: result.error || "Couldn't save changes." });
    }
  }

  return (
    <SectionCard icon={<User size={14} />} title="Profile">
      {profile.status === "probation" && (
        <div className="flex items-start gap-3.5 bg-gradient-to-br from-red-500/[0.08] to-red-500/[0.04] border border-red-500/25 border-l-4 border-l-red-500 rounded-[10px] px-4.5 py-4 mb-5">
          <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center text-white shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-sm font-bold text-red-600 mb-0.5">Account on Probation</p>
            <p className="text-[13px] text-red-700/90">Please get in touch with the CEDO office for details on your current status.</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap mb-5">
        {profile.status === "probation" ? (
          <span className="inline-flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-600 text-[11px] font-bold uppercase tracking-wider rounded-full px-3.5 py-1.5">
            <AlertTriangle size={12} /> Probation
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 bg-green-600/10 border border-green-600/25 text-green-700 text-[11px] font-bold uppercase tracking-wider rounded-full px-3.5 py-1.5">
            <CheckCircle2 size={12} /> {profile.status === "graduated" ? "Graduated" : profile.status === "inactive" ? "Inactive" : "Active"}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 bg-[#0088cc]/8 border border-[#0088cc]/20 text-[#0088cc] text-[12px] font-semibold tracking-wide rounded-full px-3.5 py-1.5">
          <IdCard size={13} /> {profile.scholarIdNumber}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-6">
        <InfoItem icon={<User size={11} />} label="First Name" value={profile.firstName} />
        <InfoItem icon={<User size={11} />} label="Last Name" value={profile.lastName} />
        <InfoItem icon={<User size={11} />} label="Middle Name" value={profile.middleName || "—"} />
        <InfoItem icon={<Building2 size={11} />} label="School" value={profile.school || "—"} />
        <InfoItem icon={<BookOpen size={11} />} label="Course" value={profile.course || "—"} full />
        <InfoItem icon={<Heart size={11} />} label="Civil Status" value={profile.civilStatus || "—"} />
        <InfoItem icon={<Phone size={11} />} label="Contact No." value={profile.contactNo || "—"} />
        <InfoItem icon={<MapPin size={11} />} label="Address" value={profile.address || "—"} full />
      </div>

      <hr className="border-t border-[#e6ecf5] my-6" />

      <form onSubmit={handleSave}>
        <p className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#0088cc] mb-4">Editable Information</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Civil Status</label>
            <select
              value={civilStatus}
              onChange={e => setCivilStatus(e.target.value)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white"
            >
              <option value="">-- Select --</option>
              {CIVIL_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Contact Number</label>
            <input
              value={contactNo}
              onChange={e => setContactNo(e.target.value)}
              placeholder="09XXXXXXXXX"
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saveMessage && (
            <span className={`text-[13px] font-medium ${saveMessage.kind === "ok" ? "text-green-600" : "text-red-600"}`}>{saveMessage.text}</span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] hover:from-[#041a33] hover:to-[#062444] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5 shadow-[0_3px_10px_rgba(6,36,68,0.25)] transition-colors"
          >
            <Save size={14} className="text-[#F3BC00]" /> {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function InfoItem({ icon, label, value, full }: { icon: React.ReactNode; label: string; value: string; full?: boolean }) {
  return (
    <div className={`bg-[#f8fafd] border border-[#e8edf2] rounded-[10px] px-4 py-3 flex flex-col gap-1 hover:shadow-[0_2px_12px_rgba(6,36,68,0.08)] transition-shadow ${full ? "sm:col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#0088cc]">{icon}{label}</span>
      <span className="text-sm font-medium text-[#1a2e44]">{value}</span>
    </div>
  );
}
