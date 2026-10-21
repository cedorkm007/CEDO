// Scholar Portal "I forgot my password" (self-service). Deliberately public/unauthenticated (deployed with --no-verify-jwt): the whole point is
// reaching someone who can't sign in, so there is no session to check.
//
// SDP Monitoring update, Phase 6: the scholar CHOOSES THEIR OWN new password. Nothing here ever sets or shows a fixed password.
//   1. { scholarIdNumber, lastName, firstName }                    -> the security question (a made-up one for an ID that does not exist)
//   2. { ..., securityAnswer, newPassword }                       -> checks the answer (5 wrong per hour at most) and saves the new password
// A scholar who never set a security question cannot use this: they ask the SEAD office. Every failure looks the same from the outside.
// All the rules live in ../_shared/scholarSelfReset.ts (and are tested there); this file only connects them to Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { logScholarChange } from "../_shared/scholarLog.ts";
import { handleScholarSelfReset, type SelfResetDeps } from "../_shared/scholarSelfReset.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

    const deps: SelfResetDeps = {
      async gate(identity, address) {
        const { error } = await admin.rpc("scholar_reset_gate", { p_identity: identity, p_ip: address });
        return error ? "Too many attempts. Please wait a while and try again, or ask the SEAD office to reset your password." : null;
      },
      async isLocked(identity) {
        const { data } = await admin.rpc("scholar_reset_is_locked", { p_identity: identity });
        return data === true;
      },
      async registerFailure(identity, address) { await admin.rpc("scholar_reset_register_failure", { p_identity: identity, p_ip: address }); },
      async clearFailures(identity) { await admin.rpc("scholar_reset_clear", { p_identity: identity }); },
      async findScholar(scholarIdNumber) {
        const { data } = await admin.from("scholars").select("id, first_name, last_name, security_question").eq("scholar_id_number", scholarIdNumber).maybeSingle();
        return data ?? null;
      },
      async verifyAnswer(scholarId, answer) {
        const { data, error } = await admin.rpc("verify_scholar_security_answer", { p_scholar_id: scholarId, p_answer: answer });
        if (error) { console.error("verify_scholar_security_answer error:", error.message); return false; }
        return data === true;
      },
      async setPassword(scholarId, password) {
        const { error } = await admin.auth.admin.updateUserById(scholarId, { password });
        return error ? error.message : null;
      },
      async log(entry) {
        await logScholarChange(admin, {
          action: "reset", scholarId: entry.scholarId, scholarIdNumber: entry.scholarIdNumber, scholarName: entry.scholarName,
          performedBy: null, performedByName: "Scholar (self-service)", source: "self_service",
          description: "Self-service password reset: the scholar answered their security question and chose their own new password.",
        });
      },
    };

    const result = await handleScholarSelfReset(body, ip, deps);
    return jsonResponse(result.body, result.status);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("scholar-self-reset-password unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
