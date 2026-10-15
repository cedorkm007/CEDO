// Plain helpers for the push-sender function: what goes into a push message, and how a result is classified.
// No Deno / network imports here, so the website's tests can run this file in Node (tests/renewal/run.mjs).

export interface PushJob { id: string; title: string; body: string; url: string; subscriptions: { endpoint: string; p256dh: string; auth: string }[] }
export interface PushResult { endpoint: string; status: number }

const MAX_TITLE = 80;
const MAX_BODY = 200;

/** The text the service worker shows. Long text is shortened (phones cut it anyway); the url is only ever a path on the site. */
export function buildPushPayload(job: Pick<PushJob, "title" | "body" | "url">): string {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const url = typeof job.url === "string" && job.url.startsWith("/") && !job.url.startsWith("//") ? job.url : "/";
  return JSON.stringify({ title: clip(String(job.title ?? "").trim() || "CEDO", MAX_TITLE), body: clip(String(job.body ?? "").trim(), MAX_BODY), url });
}

/** What a push service's answer means: delivered, the device is gone for good (drop it), or a temporary problem (try again later). */
export function classifyPushStatus(status: number): "delivered" | "gone" | "retry" {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 404 || status === 410) return "gone";
  return "retry";
}

/** The shared secret check for calls to the function (constant-time; an unset secret refuses everything). */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
