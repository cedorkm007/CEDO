// Public, unauthenticated lookup for a scholar's permanent QR ID card —
// scanned by any regular camera, no login/portal account needed. Kept out
// of scholarApi.ts since every function there assumes a signed-in
// scholar. Mirrors financialAssistanceStatusApi.ts's own shape exactly.

import { supabase } from "@/lib/supabase";

export interface PublicScholarEmergencyInfo {
  found: boolean;
  name?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactNumber?: string;
}

export async function fetchPublicScholarEmergencyInfo(token: string): Promise<{ ok: boolean; error?: string; result?: PublicScholarEmergencyInfo }> {
  const { data, error } = await supabase.rpc("get_public_scholar_emergency_info", { p_token: token });
  if (error) return { ok: false, error: error.message };
  const payload = data as { found: boolean; name?: string; emergencyContactName?: string; emergencyContactRelationship?: string; emergencyContactNumber?: string } | null;
  if (!payload) return { ok: false, error: "Couldn't load this scholar ID." };
  return { ok: true, result: payload };
}
