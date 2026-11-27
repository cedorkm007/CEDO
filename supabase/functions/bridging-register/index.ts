// bridging-register — creates a Kagay-anon Bridging account (student or teacher). For the BRIDGING Supabase project ONLY.
//
//   Deploy:   supabase functions deploy bridging-register --project-ref <BRIDGING project ref> --no-verify-jwt
//   Secrets:  BRIDGING_TURNSTILE_SECRET   OPTIONAL: Cloudflare Turnstile secret key ("I am human" check). The website's matching public key is
//                                         VITE_BRIDGING_TURNSTILE_SITE_KEY in Vercel.
//
// No sign-in is needed to call it (people calling it do not have an account yet). It limits attempts per internet address.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { handleBridgingRegister, type RegisterDeps } from "../_shared/bridgingRegister.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Not allowed." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const secret = Deno.env.get("BRIDGING_TURNSTILE_SECRET");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

  const deps: RegisterDeps = {
    isBridgingDatabase: async () => !(await admin.rpc("bridging_options")).error,
    allowAttempt: async (address, perHour, perDay) => {
      const { data, error } = await admin.rpc("bridging_rate_limit", { p_kind: "register", p_ip: address, p_per_hour: perHour, p_per_day: perDay });
      return !error && data === true;
    },
    turnstile: secret
      ? {
        verify: async (token, address) => {
          const form = new URLSearchParams({ secret, response: token, remoteip: address });
          const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
          return ((await r.json()) as { success?: boolean }).success === true;
        },
      }
      : null,
    createUser: async (email, password) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      return error || !data?.user ? { error: error?.message ?? "no user" } : { id: data.user.id };
    },
    register: async (userId, details) => {
      const { data, error } = await admin.rpc("bridging_register", { p_user: userId, p: details });
      return error ? { error: error.message } : { duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
    },
    deleteUser: async userId => { await admin.auth.admin.deleteUser(userId); },
  };

  try {
    const out = await handleBridgingRegister(await req.json(), ip, deps);
    return json(out.json, out.status);
  } catch {
    return json({ error: "Couldn't register. Please try again." }, 500);
  }
});
