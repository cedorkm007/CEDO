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
