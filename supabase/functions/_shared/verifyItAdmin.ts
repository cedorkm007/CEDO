import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { throwJsonError } from "./cors.ts";

/**
 * "Staff Accounts" (creating new staff logins) is gated to ONE specific
 * account, identified by username — not a role, not a flag column. Must
 * match IT_ADMIN_USERNAME in src/app/App.tsx exactly (case-insensitive).
 * If you change one, change the other.
 */
const IT_ADMIN_USERNAME = "it.admin1";

/** The "authenticator assurance level" Supabase puts in a session token: "aal2" means the person also entered their authenticator code. */
function sessionAssuranceLevel(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).aal ?? null;
  } catch {
    return null;
  }
}

export async function requireItAdmin(req: Request): Promise<{ admin: SupabaseClient; callerId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throwJsonError("Missing Authorization header.", 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    throwJsonError("Invalid or expired session.", 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.username.toLowerCase() !== IT_ADMIN_USERNAME) {
    throwJsonError("This account is not authorized to create staff accounts.", 403);
  }

  // Two-step sign-in (authenticator app). Once this account has set one up, every action here needs the session to have passed the code check too, so a
  // stolen password alone is not enough. Setting IT_ADMIN_REQUIRE_MFA=true (an Edge Function secret) requires it even before one is set up.
  const { data: factorList } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  const hasVerifiedFactor = (factorList?.factors ?? []).some((factor: { factor_type?: string; status?: string }) => factor.factor_type === "totp" && factor.status === "verified");
  const mustHaveTwoStep = hasVerifiedFactor || Deno.env.get("IT_ADMIN_REQUIRE_MFA") === "true";
  if (mustHaveTwoStep && sessionAssuranceLevel(authHeader) !== "aal2") {
    throwJsonError("Two-step sign-in is required. Sign out, sign in again, and enter the code from your authenticator app.", 403);
  }

  return { admin, callerId: user.id };
}
