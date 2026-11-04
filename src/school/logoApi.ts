// ─────────────────────────────────────────────────────────────
// src/school/logoApi.ts
// The school's own logo (supabase_migration_school_logo.sql): read it, replace it, remove it. `missing: true` = that database update has not been run yet (the logo box then says so).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

type Failed = { ok: false; error: string; missing: boolean };
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

/** The logo as base64 PNG text, or null when the school has none. */
export async function fetchSchoolLogo(): Promise<{ ok: true; base64: string | null } | Failed> {
  const { data, error } = await supabase.rpc("school_get_logo");
  if (error) return failed(error);
  return { ok: true, base64: typeof data === "string" && data ? data : null };
}

export async function saveSchoolLogo(base64: string): Promise<{ ok: true } | Failed> {
  const { error } = await supabase.rpc("school_set_logo", { p_image_base64: base64 });
  return error ? failed(error) : { ok: true };
}

export async function removeSchoolLogo(): Promise<{ ok: true } | Failed> {
  const { error } = await supabase.rpc("school_remove_logo");
  return error ? failed(error) : { ok: true };
}
