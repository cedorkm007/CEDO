import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { throwJsonError } from "./cors.ts";

/**
 * "Staff Accounts" (creating new staff logins) is gated to ONE specific
 * account, identified by username — not a role, not a flag column. Must
 * match IT_ADMIN_USERNAME in src/app/App.tsx exactly (case-insensitive).
 * If you change one, change the other.
 */
const IT_ADMIN_USERNAME = "it.admin1";

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

  return { admin, callerId: user.id };
}
