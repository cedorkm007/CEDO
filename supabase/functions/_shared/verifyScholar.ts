import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { throwJsonError } from "./cors.ts";

/**
 * Every scholar-facing Edge Function needs to answer the same question
 * requireSeadStaff answers for staff-facing ones: "is whoever is calling
 * this actually a scholar, and which one?" This never trusts anything the
 * client sends about itself — it re-derives the caller's identity from
 * their JWT (passed in the Authorization header by supabase.functions.invoke
 * automatically) and looks them up in public.scholars by that id, the same
 * `scholars.id = auth.uid()` relationship every scholar-facing RLS policy
 * in this codebase already relies on (see
 * supabase_migration_submission_activities.sql's "scholar reads
 * own-year-level activities" policy for the pattern this mirrors).
 *
 * Returns the admin client (service role — bypasses RLS, use carefully and
 * only for the specific action the function exists for) plus the caller's
 * own scholar row, or throws a Response to send straight back.
 */
export interface VerifiedScholar {
  id: string;
  firstName: string;
  lastName: string;
  yearLevel: string;
}

export async function requireScholar(req: Request): Promise<{ admin: SupabaseClient; scholar: VerifiedScholar }> {
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

  const { data: scholarRow, error: scholarError } = await admin
    .from("scholars")
    .select("id, first_name, last_name, year_level")
    .eq("id", user.id)
    .maybeSingle();

  if (scholarError || !scholarRow) {
    throwJsonError("This account is not a scholar account.", 403);
  }

  return {
    admin,
    scholar: {
      id: scholarRow.id as string,
      firstName: (scholarRow.first_name as string) ?? "",
      lastName: (scholarRow.last_name as string) ?? "",
      yearLevel: (scholarRow.year_level as string) ?? "",
    },
  };
}
