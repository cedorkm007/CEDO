// storage-tool-public — the server side of the Storage Tool's PUBLIC upload page (https://<site>/upload/<link code>). No account: the person is a visitor.
//
// Everything a visitor can do goes through here, with the service role; the visitor never touches a table or a stored file directly. The rules live in
// ../_shared/storageToolPublic.ts (shared with the tests and the local demo). Actions (POST, JSON): info, open, start, finish, mine.
//
//   Deploy:   supabase functions deploy storage-tool-public --no-verify-jwt        (it has no sign-in: the link code + the visit are its protection)
//   Secrets:  STORAGE_TOOL_IP_SALT      any long random text (visitors' addresses are only ever stored as a salted fingerprint)
//             TURNSTILE_SECRET          OPTIONAL: Cloudflare Turnstile secret key. When set, the page asks visitors to pass the check.
//             (the website's matching public key is VITE_TURNSTILE_SITE_KEY in Vercel)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { handlePublic, type PublicDeps } from "../_shared/storageToolPublic.ts";

const BUCKET = "storage-tool";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Not allowed." }, 405);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 20_000) return json({ error: "That request is too big." }, 413);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const salt = Deno.env.get("STORAGE_TOOL_IP_SALT");
  if (!salt) return json({ error: "The upload page is not set up yet." }, 500);
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET");
  const deps: PublicDeps = {
    rpc: async (name, args) => {
      const { data, error } = await admin.rpc(name, args);
      return { data: data as never, error: error ? { message: error.message } : null };
    },
    storage: {
      signedUpload: async path => {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        return error || !data ? { error: error?.message ?? "no address" } : { url: data.signedUrl };
      },
      stat: async path => {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
        if (!data) return null;
        const res = await fetch(data.signedUrl, { method: "HEAD" });
        if (!res.ok) return null;
        return { size: Number(res.headers.get("content-length") ?? 0) };
      },
      head: async (path, bytes) => {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
        if (!data) return null;
        const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${bytes - 1}` } });
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer()).slice(0, bytes);
      },
      remove: async paths => { await admin.storage.from(BUCKET).remove(paths); },
    },
    ipSalt: salt,
    turnstile: turnstileSecret
      ? { verify: async (token, remoteIp) => {
          if (!token) return false;
          const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: remoteIp }) });
          return Boolean(((await res.json()) as { success?: boolean }).success);
        } }
      : null,
  };
  try {
    const result = await handlePublic(deps, body, ip);
    return json(result.json, result.status);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
