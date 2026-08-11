import { supabase } from "@/lib/supabase";
import { formatPositionLabel, type FormationOrgType } from "@/lib/formationLabels";

/**
 * A scholar's own leadership position(s), formatted for display on their
 * profile card. Plain VIP "member" roster entries are excluded — those
 * aren't an appointed office, just a roster listing.
 */
export async function fetchOwnPositionLabels(scholarIdNumber: string): Promise<string[]> {
  const { data, error } = await supabase.from("formation_positions")
    .select("org_type, org_key, role_key, role_label")
    .eq("scholar_id_number", scholarIdNumber)
    .neq("role_key", "member");
  if (error || !data) return [];
  return data
    .filter(r => r.role_label) // a slot with no label yet isn't meaningfully "held"
    .map(r => formatPositionLabel(r.role_label, r.org_type as FormationOrgType, r.org_key));
}
