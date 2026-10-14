// push-sender — sends the waiting web-push messages (the push_outbox queue) to people's phones and computers.
//
// Called every minute by a pg_cron job (see push_sender_schedule() in supabase_migration_renewal_p6_notifications.sql); it can also be called
// by hand. It is NOT for the browser: it is deployed with --no-verify-jwt and protected by a shared secret header instead.
//
//   Secrets (supabase secrets set ...):  PUSH_SENDER_SECRET   VAPID_PUBLIC_KEY   VAPID_PRIVATE_KEY   VAPID_SUBJECT (mailto: or https: address)
//   Deploy:                              supabase functions deploy push-sender --no-verify-jwt
//
// Each call: ask the database for up to 50 waiting messages (push_claim), send each to every device of the person, tell the database what
// every device answered (push_report) so dead devices are dropped and temporary failures are retried (3 tries).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders } from "../_shared/cors.ts";
import { buildPushPayload, secretMatches, type PushJob, type PushResult } from "../_shared/pushMessage.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!secretMatches(req.headers.get("x-push-secret"), Deno.env.get("PUSH_SENDER_SECRET"))) return json({ error: "Not allowed." }, 401);

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return json({ error: "The VAPID keys are not set." }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:cedo@example.com", publicKey, privateKey);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("push_claim", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);

  let messages = 0, devices = 0, delivered = 0;
  for (const job of (data ?? []) as PushJob[]) {
    const payload = buildPushPayload(job);
    const results: PushResult[] = await Promise.all(job.subscriptions.map(async s => {
      try {
        const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "normal" });
        return { endpoint: s.endpoint, status: r.statusCode };
      } catch (e) {
        return { endpoint: s.endpoint, status: (e as { statusCode?: number }).statusCode ?? 0 };    // 0: could not reach the push service
      }
    }));
    await admin.rpc("push_report", { p_id: job.id, p_results: results });
    messages++; devices += results.length; delivered += results.filter(r => r.status >= 200 && r.status < 300).length;
  }
  return json({ messages, devices, delivered });
});
