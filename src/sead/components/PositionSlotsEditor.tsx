import { useEffect, useState } from "react";
import { Plus, X, Users } from "lucide-react";
import { fetchPositions, saveSlot, deleteSlot, fetchScholarNames, type FormationPosition, type FormationOrgType, type ScholarSearchFilter } from "../formationApi";
import { ScholarPicker } from "./ScholarPicker";

export interface FixedRoleDef { roleKey: string; label: string }
export interface ExpandableGroupDef { roleKey: string; groupLabel: string; addPromptLabel: string }

interface PositionSlotsEditorProps {
  orgType: FormationOrgType;
  orgKey: string;
  fixedRoles: FixedRoleDef[];
  expandableGroups?: ExpandableGroupDef[];
  /** Restricts every scholar-assignment search in this editor to the relevant school/cluster/barangay. */
  scholarFilter?: ScholarSearchFilter;
}

/**
 * Reusable officer-slot editor for one organizational unit (a school, a
 * cluster, a barangay, the VIP top structure, or one VIP department).
 * fixedRoles are single, non-removable slots (President, Cluster Head...).
 * expandableGroups are role types staff can freely add/remove seats for
 * (College Directors, Committee Staff, advocacy committees...) — each new
 * seat gets a staff-typed label (a year level, a committee name, etc).
 */
export function PositionSlotsEditor({ orgType, orgKey, fixedRoles, expandableGroups = [], scholarFilter }: PositionSlotsEditorProps) {
  const [positions, setPositions] = useState<FormationPosition[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  async function load() {
    setLoading(true);
    const pos = await fetchPositions(orgType, orgKey);
    setPositions(pos);
    setNames(await fetchScholarNames(pos.map(p => p.scholarIdNumber).filter((s): s is string => !!s)));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgType, orgKey]);

  function slotsFor(roleKey: string): FormationPosition[] {
    return positions.filter(p => p.roleKey === roleKey).sort((a, b) => a.slotOrder - b.slotOrder);
  }

  async function assign(roleKey: string, slotOrder: number, roleLabel: string, scholarIdNumber: string) {
    await saveSlot(orgType, orgKey, roleKey, slotOrder, { roleLabel, scholarIdNumber });
    load();
  }
  async function clear(roleKey: string, slotOrder: number, roleLabel: string) {
    await saveSlot(orgType, orgKey, roleKey, slotOrder, { roleLabel, scholarIdNumber: null });
    load();
  }
  async function addExpandableSlot(roleKey: string) {
    if (!newLabel.trim()) return;
    const existing = slotsFor(roleKey);
    const nextSlot = existing.length === 0 ? 0 : Math.max(...existing.map(s => s.slotOrder)) + 1;
    await saveSlot(orgType, orgKey, roleKey, nextSlot, { roleLabel: newLabel.trim(), scholarIdNumber: null });
    setNewLabel("");
    setAddingGroup(null);
    load();
  }
  async function removeExpandableSlot(id: string) {
    await deleteSlot(id);
    load();
  }

  if (loading) return <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fixedRoles.map(fr => {
          const slot = slotsFor(fr.roleKey)[0];
          return (
            <div key={fr.roleKey} className="bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0088cc] mb-1.5">{fr.label}</p>
              <ScholarPicker
                currentScholarIdNumber={slot?.scholarIdNumber ?? null}
                currentName={slot?.scholarIdNumber ? names[slot.scholarIdNumber] : undefined}
                onAssign={sid => assign(fr.roleKey, 0, fr.label, sid)}
                onClear={() => clear(fr.roleKey, 0, fr.label)}
                filter={scholarFilter}
              />
            </div>
          );
        })}
      </div>

      {expandableGroups.map(group => {
        const slots = slotsFor(group.roleKey);
        return (
          <div key={group.roleKey}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#0088cc] flex items-center gap-1.5"><Users size={12} /> {group.groupLabel}</p>
              <span className="text-[11px] text-slate-400">{slots.length} seat{slots.length === 1 ? "" : "s"}</span>
            </div>

            {slots.length === 0 ? (
              <p className="text-[12.5px] text-slate-400 italic mb-2">No seats yet.</p>
            ) : (
              <div className="space-y-1.5 mb-2">
                {slots.map(s => (
                  <div key={s.id} className="flex items-center justify-between bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[12.5px] font-semibold text-[#062444] shrink-0">{s.roleLabel}</span>
                      <ScholarPicker
                        currentScholarIdNumber={s.scholarIdNumber}
                        currentName={s.scholarIdNumber ? names[s.scholarIdNumber] : undefined}
                        onAssign={sid => assign(group.roleKey, s.slotOrder, s.roleLabel, sid)}
                        onClear={() => clear(group.roleKey, s.slotOrder, s.roleLabel)}
                        filter={scholarFilter}
                      />
                    </div>
                    <button onClick={() => removeExpandableSlot(s.id)} className="text-slate-300 hover:text-red-500 shrink-0"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {addingGroup === group.roleKey ? (
              <div className="flex items-center gap-2">
                <input autoFocus value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder={group.addPromptLabel}
                  onKeyDown={e => { if (e.key === "Enter") addExpandableSlot(group.roleKey); }}
                  className="flex-1 text-[12.5px] border border-[#0088cc]/40 rounded-lg px-2.5 py-1.5 outline-none" />
                <button onClick={() => addExpandableSlot(group.roleKey)} className="text-[12.5px] font-bold text-[#0088cc] cursor-pointer hover:opacity-80 transition-opacity">Add</button>
                <button onClick={() => { setAddingGroup(null); setNewLabel(""); }} className="text-[12.5px] text-slate-400 cursor-pointer hover:opacity-80 transition-opacity">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddingGroup(group.roleKey)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] cursor-pointer hover:underline hover:opacity-80 transition-opacity">
                <Plus size={13} /> Add Seat
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
