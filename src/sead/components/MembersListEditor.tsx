import { useEffect, useState } from "react";
import { X, UserPlus } from "lucide-react";
import { fetchPositions, saveSlot, deleteSlot, fetchScholarNames, type FormationPosition } from "../formationApi";
import { ScholarPicker } from "./ScholarPicker";

/** VIP "Members" department: a plain roster of scholars, not labeled positions. */
export function MembersListEditor({ orgKey }: { orgKey: string }) {
  const [members, setMembers] = useState<FormationPosition[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const pos = await fetchPositions("vip_department", orgKey);
    const memberSlots = pos.filter(p => p.roleKey === "member" && p.scholarIdNumber);
    setMembers(memberSlots);
    setNames(await fetchScholarNames(memberSlots.map(m => m.scholarIdNumber!)));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgKey]);

  async function addMember(scholarIdNumber: string) {
    if (members.some(m => m.scholarIdNumber === scholarIdNumber)) { setAdding(false); return; }
    const nextSlot = members.length === 0 ? 0 : Math.max(...members.map(m => m.slotOrder)) + 1;
    await saveSlot("vip_department", orgKey, "member", nextSlot, { scholarIdNumber });
    setAdding(false);
    load();
  }
  async function removeMember(id: string) {
    await deleteSlot(id);
    load();
  }

  if (loading) return <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-semibold text-[#062444]">{members.length} member{members.length === 1 ? "" : "s"}</p>
        {adding ? (
          <div className="w-64">
            <ScholarPicker currentScholarIdNumber={null} onAssign={addMember} onClear={() => setAdding(false)} placeholder="Search to add a member…" />
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ cursor: 'pointer' }} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:underline hover:opacity-80 transition-opacity">
            <UserPlus size={13} /> Add Member
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 italic">No members yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-3 py-2">
              <span className="text-[12.5px] font-semibold text-[#062444]">{names[m.scholarIdNumber!] ?? m.scholarIdNumber}</span>
              <button onClick={() => removeMember(m.id)} className="text-slate-300 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
