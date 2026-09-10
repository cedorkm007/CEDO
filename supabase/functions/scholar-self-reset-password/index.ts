// Scholar Portal instant self-service password reset. Deliberately
// public/unauthenticated (deployed with --no-verify-jwt): the whole point
// is reaching someone who can't log in, so there's no session to verify.
//
// Two-step, stateless protocol (the frontend just resends everything each
// call — no token/session needed between steps):
//   1. { scholarIdNumber, lastName, firstName } — if the three match a
//      scholar AND that scholar has no security question set yet, resets
//      immediately. If they DO have a security question, responds with
//      needsAnswer + the question text instead of resetting.
//   2. { scholarIdNumber, lastName, firstName, securityAnswer } — same
//      identity check, plus the answer must match
//      (verify_scholar_security_answer, service-role only).
//
// Every failure path (scholar not found, name mismatch, wrong answer)
// returns the same shape of generic error — this never reveals which part
// was wrong, to avoid helping someone enumerate valid Scholar IDs or narrow
// down a security answer by trial and error against error text.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { logScholarChange } from "../_shared/scholarLog.ts";

const DEFAULT_PASSWORD = "123456";
const GENERIC_ERROR = "We couldn't verify your identity with those details.";

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

    const scholarIdNumber = String(body.scholarIdNumber ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const firstName = String(body.firstName ?? "").trim();
    const securityAnswer = typeof body.securityAnswer === "string" ? body.securityAnswer.trim() : "";

    if (!scholarIdNumber || !lastName || !firstName) {
      return jsonResponse({ error: "Please fill in your Scholar ID, Last Name, and First Name." }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: scholar, error: lookupError } = await admin
      .from("scholars")
      .select("id, first_name, last_name, security_question")
      .eq("scholar_id_number", scholarIdNumber)
      .maybeSingle();

    if (lookupError || !scholar) {
      return jsonResponse({ error: GENERIC_ERROR }, 404);
    }

    const nameMatches =
      String(scholar.last_name ?? "").trim().toLowerCase() === lastName.toLowerCase() &&
      String(scholar.first_name ?? "").trim().toLowerCase() === firstName.toLowerCase();
    if (!nameMatches) {
      return jsonResponse({ error: GENERIC_ERROR }, 404);
    }

    async function performReset(descriptionSuffix: string): Promise<Response> {
      const { error: updateError } = await admin.auth.admin.updateUserById(scholar!.id, { password: DEFAULT_PASSWORD });
      if (updateError) {
        return jsonResponse({ error: updateError.message }, 500);
      }
      await logScholarChange(admin, {
        action: "reset",
        scholarId: scholar!.id,
        scholarIdNumber,
        scholarName: `${scholar!.first_name} ${scholar!.last_name}`,
        performedBy: null,
        performedByName: "Scholar (self-service)",
        source: "self_service",
        description: `Instant self-service reset to the default (${DEFAULT_PASSWORD}) — ${descriptionSuffix}.`,
      });
      return jsonResponse({ ok: true, reset: true, newPassword: DEFAULT_PASSWORD }, 200);
    }

    if (!scholar.security_question) {
      return await performReset("verified by Scholar ID + name match, no security question set yet");
    }

    if (!securityAnswer) {
      return jsonResponse({ ok: true, needsAnswer: true, question: scholar.security_question }, 200);
    }

    const { data: answerMatches, error: verifyError } = await admin.rpc("verify_scholar_security_answer", {
      p_scholar_id: scholar.id,
      p_answer: securityAnswer,
    });
    if (verifyError) {
      console.error("verify_scholar_security_answer error:", verifyError.message);
      return jsonResponse({ error: "Unexpected error while checking your answer." }, 500);
    }
    if (!answerMatches) {
      return jsonResponse({ error: "That answer doesn't match. Please try again.", needsAnswer: true, question: scholar.security_question }, 401);
    }

    return await performReset("verified by security question answer");
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("scholar-self-reset-password unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
