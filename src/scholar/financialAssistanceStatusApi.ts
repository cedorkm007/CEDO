// Public, unauthenticated lookup for the Financial Assistance QR
// status-check page — the applicant never gets a portal account, so this
// runs entirely on the anon key, no session required. Kept out of
// scholarApi.ts since every function there assumes a signed-in scholar.

import { supabase } from "@/lib/supabase";

export interface FinancialAssistanceStatusResult {
  found: boolean;
  name?: string;
  appliedAt?: string;
  status?: "processing" | "approved";
  approvedInstructions?: string | null;
}

export async function fetchFinancialAssistanceStatus(referenceNumber: string): Promise<{ ok: boolean; error?: string; result?: FinancialAssistanceStatusResult }> {
  const { data, error } = await supabase.rpc("get_financial_assistance_status", { p_reference_number: referenceNumber });
  if (error) return { ok: false, error: error.message };
  const payload = data as { found: boolean; name?: string; appliedAt?: string; status?: string; approvedInstructions?: string | null } | null;
  if (!payload) return { ok: false, error: "Couldn't load your application status." };
  return {
    ok: true,
    result: {
      found: payload.found,
      name: payload.name,
      appliedAt: payload.appliedAt,
      status: payload.status as "processing" | "approved" | undefined,
      approvedInstructions: payload.approvedInstructions,
    },
  };
}
