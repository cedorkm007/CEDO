import { supabase } from "@/lib/supabase";

export interface NewStaffInput {
  lastName: string; firstName: string; middleName: string; suffix: string; nickname: string;
  username: string; designation: string; position: string; natureOfWork: string; mobilePhone: string;
  email: string; division: string; role: "staff" | "division_admin" | "super_admin";
}

export async function createStaffAccount(input: NewStaffInput): Promise<{ ok: boolean; error?: string; defaultPassword?: string }> {
  const { data, error } = await supabase.functions.invoke("it-create-staff-account", { body: input });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, defaultPassword: data?.defaultPassword };
}

export interface StaffListItem {
  id: string; username: string; firstName: string; lastName: string; division: string; role: string; email: string;
}

export async function fetchStaffList(): Promise<StaffListItem[]> {
  const { data, error } = await supabase.from("users")
    .select("id, username, first_name, last_name, division, role, email")
    .order("last_name");
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, username: r.username, firstName: r.first_name, lastName: r.last_name,
    division: r.division, role: r.role, email: r.email,
  }));
}

// ── Division reassignment ───────────────────────────────────
// Staff get reshuffled between CEDO divisions often; this is the "division
// tag" — changeable any time from the Staff Accounts page, logged so
// there's a record of who moved where and when.
export async function changeStaffDivision(staffId: string, oldDivision: string, newDivision: string): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data: caller } = auth.user
    ? await supabase.from("users").select("first_name, last_name").eq("id", auth.user.id).maybeSingle()
    : { data: null };
  const changedByName = caller ? `${caller.first_name} ${caller.last_name}`.trim() : "Unknown staff";

  const { error: updateError } = await supabase.from("users").update({ division: newDivision }).eq("id", staffId);
  if (updateError) return { ok: false, error: updateError.message };

  const { error: logError } = await supabase.from("division_change_log").insert({
    staff_id: staffId, old_division: oldDivision, new_division: newDivision,
    changed_by: auth.user?.id ?? null, changed_by_name: changedByName,
  });
  if (logError) console.error("Failed to log division change:", logError.message);

  return { ok: true };
}

export interface DivisionChangeEntry {
  id: string;
  oldDivision: string | null;
  newDivision: string;
  changedByName: string;
  changedAt: string;
}

export async function fetchDivisionChangeLog(staffId: string): Promise<DivisionChangeEntry[]> {
  const { data, error } = await supabase.from("division_change_log")
    .select("id, old_division, new_division, changed_by_name, changed_at")
    .eq("staff_id", staffId).order("changed_at", { ascending: false });
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, oldDivision: r.old_division, newDivision: r.new_division,
    changedByName: r.changed_by_name, changedAt: r.changed_at,
  }));
}

// ── Staff tool tags ───────────────────────────────────────────
// Returns a map of staffId -> array of tag keys, for every staff account
// at once (used to render the tag column in the Staff Accounts table).
export async function fetchAllStaffTags(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from("staff_account_tags").select("staff_id, tag_key");
  if (error || !data) return {};
  const map: Record<string, string[]> = {};
  for (const row of data) {
    (map[row.staff_id] ??= []).push(row.tag_key);
  }
  return map;
}

/** Fully replaces one staff account's tag set with `tagKeys`. */
export async function setStaffTags(staffId: string, tagKeys: string[]): Promise<{ ok: boolean; error?: string }> {
  const { error: deleteError } = await supabase.from("staff_account_tags").delete().eq("staff_id", staffId);
  if (deleteError) return { ok: false, error: deleteError.message };
  if (tagKeys.length === 0) return { ok: true };
  const { error: insertError } = await supabase.from("staff_account_tags")
    .insert(tagKeys.map(tag_key => ({ staff_id: staffId, tag_key })));
  return insertError ? { ok: false, error: insertError.message } : { ok: true };
}

export async function deleteStaffAccount(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-delete-staff-account", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}

export async function resetStaffPassword(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-reset-staff-password", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}
