import { supabase } from "@/lib/supabase";

export type FormationOrgType = "school" | "community_cluster" | "community_barangay" | "vip_top" | "vip_department";

export interface FormationPosition {
  id: string;
  orgType: FormationOrgType;
  orgKey: string;
  roleKey: string;
  roleLabel: string;
  slotOrder: number;
  scholarIdNumber: string | null;
}

function rowToPosition(r: Record<string, unknown>): FormationPosition {
  return {
    id: String(r.id), orgType: r.org_type as FormationOrgType, orgKey: String(r.org_key ?? ""),
    roleKey: String(r.role_key), roleLabel: String(r.role_label ?? ""),
    slotOrder: Number(r.slot_order ?? 0), scholarIdNumber: (r.scholar_id_number as string | null) ?? null,
  };
}

export async function fetchPositions(orgType: FormationOrgType, orgKey: string): Promise<FormationPosition[]> {
  const { data, error } = await supabase.from("formation_positions")
    .select("*").eq("org_type", orgType).eq("org_key", orgKey).order("role_key").order("slot_order");
  if (error || !data) return [];
  return data.map(rowToPosition);
}

/** Creates the slot if missing, or updates its holder/label if it already exists. */
export async function saveSlot(
  orgType: FormationOrgType, orgKey: string, roleKey: string, slotOrder: number,
  fields: { roleLabel?: string; scholarIdNumber?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabase.from("formation_positions").select("id")
    .eq("org_type", orgType).eq("org_key", orgKey).eq("role_key", roleKey).eq("slot_order", slotOrder).maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.roleLabel !== undefined) patch.role_label = fields.roleLabel;
    if (fields.scholarIdNumber !== undefined) patch.scholar_id_number = fields.scholarIdNumber;
    const { error } = await supabase.from("formation_positions").update(patch).eq("id", existing.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase.from("formation_positions").insert({
    org_type: orgType, org_key: orgKey, role_key: roleKey, slot_order: slotOrder,
    role_label: fields.roleLabel ?? "", scholar_id_number: fields.scholarIdNumber ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteSlot(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_positions").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Distinct school names already on scholars' profiles — the school list for the School-based subsection. */
export async function fetchDistinctSchools(): Promise<string[]> {
  const { data, error } = await supabase.from("scholars").select("school").not("school", "is", null);
  if (error || !data) return [];
  const set = new Set(data.map(r => (r.school as string ?? "").trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface ScholarSearchResult {
  scholarIdNumber: string;
  name: string;
  school: string;
}

/** Lightweight search-as-you-type lookup for assigning a scholar to a position. */
export async function searchScholars(query: string): Promise<ScholarSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.from("scholars")
    .select("scholar_id_number, first_name, last_name, school")
    .or(`scholar_id_number.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
    .limit(8);
  if (error || !data) return [];
  return data.map(r => ({ scholarIdNumber: r.scholar_id_number, name: `${r.first_name} ${r.last_name}`, school: r.school ?? "" }));
}

/** Batch name lookup for rendering already-assigned scholars without one request per row. */
export async function fetchScholarNames(scholarIdNumbers: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(scholarIdNumbers)].filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", ids);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const r of data) map[r.scholar_id_number] = `${r.first_name} ${r.last_name}`;
  return map;
}
