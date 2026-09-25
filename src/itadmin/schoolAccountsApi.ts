import { supabase } from "@/lib/supabase";

export interface SchoolOption {
  id: string;
  name: string;
}

/** Every row in the schools lookup table (backfilled from scholars.school — see supabase_migration_scholars_grades_monitoring.sql), for the "Add School Account" school picker. */
export async function fetchSchoolsList(): Promise<SchoolOption[]> {
  const { data, error } = await supabase.from("schools").select("id, name").order("name");
  if (error || !data) return [];
  return data.map(r => ({ id: r.id, name: r.name }));
}

export async function createSchoolAccount(schoolId: string, email: string): Promise<{ ok: boolean; error?: string; defaultPassword?: string; schoolName?: string }> {
  const { data, error } = await supabase.functions.invoke("it-create-school-account", { body: { schoolId, email } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, defaultPassword: data?.defaultPassword, schoolName: data?.schoolName };
}

export interface SchoolAccountListItem {
  id: string;
  schoolId: string;
  schoolName: string;
  email: string;
}

export async function fetchSchoolAccountsList(): Promise<SchoolAccountListItem[]> {
  const { data, error } = await supabase
    .from("school_accounts")
    .select("id, school_id, email, schools(name)")
    .order("email");
  if (error || !data) return [];
  return (data as unknown as { id: string; school_id: string; email: string; schools: { name: string } | null }[]).map(r => ({
    id: r.id, schoolId: r.school_id, schoolName: r.schools?.name ?? "(Unknown school)", email: r.email,
  }));
}

export async function deleteSchoolAccount(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-delete-school-account", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}

export async function resetSchoolPassword(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-reset-school-password", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}
