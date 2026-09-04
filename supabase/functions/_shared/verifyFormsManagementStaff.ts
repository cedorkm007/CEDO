import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { throwJsonError } from "./cors.ts";

/**
 * Submission Activities (submission_activities, and by extension the
 * Milestone 2 file-reorganization Edge Function) is gated by the
 * "forms_management" staff_account_tags tag specifically — confirmed
 * against supabase_migration_submission_activities.sql's own RLS
 * policies, NOT "scholar_management" (which is what verifySeadStaff.ts's
 * requireSeadStaff already checks, for a different feature). Rather than
 * misusing that existing helper or generalizing it (which would touch a
 * file other functions already depend on), this is its own dedicated
 * file — matching this project's own established one-file-per-tag
 * convention (verifyItAdmin.ts, verifySeadStaff.ts).
 *
 * Never trusts anything the client sends about itself — re-derives the
 * caller's identity from their JWT (passed in the Authorization header
 * by supabase.functions.invoke automatically) and checks the SAME
 * forms_management flag the database RLS policies rely on.
 *
 * Returns the admin client (service role — bypasses RLS, use carefully
 * and only for the specific privileged action the function exists for)
 * plus the verified caller's user id, or throws a Response to send
 * straight back.
 */
export async function requireFormsManagementStaff(req: Request): Promise<{ admin: SupabaseClient; callerId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throwJsonError("Missing Authorization header.", 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Client scoped to the CALLER's own JWT — only used to find out who they are.
  const callerClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    throwJsonError("Invalid or expired session.", 401);
  }

  // Admin client — service role, bypasses RLS. Only used from here on for
  // the specific privileged action, never to trust client-supplied data.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: tagRow, error: tagError } = await admin
    .from("staff_account_tags")
    .select("tag_key")
    .eq("staff_id", user.id)
    .eq("tag_key", "forms_management")
    .maybeSingle();

  if (tagError || !tagRow) {
    throwJsonError("This account is not authorized for Submission Activities tools.", 403);
  }

  return { admin, callerId: user.id };
}
