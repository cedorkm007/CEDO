// ─────────────────────────────────────────────────────────────
// src/lib/pushClient.ts
// Turning web push on and off for THIS device (scholars and staff alike). The device registers /push-sw.js, asks permission (only ever
// after a tap), subscribes with the office's public VAPID key and tells the database (push_subscribe). The database queues a push for every
// bell notification and the push-sender function delivers it; see supabase_migration_renewal_p6_notifications.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { classifyPushSupport, deviceLabel, isInAppBrowser, isIOSDevice, urlBase64ToUint8Array, type PushSupport } from "@/lib/pushSupport";

const PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? "";
const SW_URL = "/push-sw.js";

export type PushResult = { ok: true } | { ok: false; error: string };
export interface PushState { support: PushSupport; subscribed: boolean }

function environment() {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return classifyPushSupport({
    hasKey: PUBLIC_KEY.length > 0,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
    isIOS: isIOSDevice(ua, navigator.maxTouchPoints), isStandalone: standalone, insideAppBrowser: isInAppBrowser(ua),
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL.replace("/push-sw.js", "/")) ?? await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** Can this device use push, and is it already on? (Reading only: nothing is asked or changed.) */
export async function getPushState(): Promise<PushState> {
  const support = environment();
  if (support !== "supported" && support !== "blocked") return { support, subscribed: false };
  return { support, subscribed: (await currentSubscription()) !== null };
}

/** Must be called straight from a tap: browsers refuse to ask permission any other way. */
export async function enablePush(): Promise<PushResult> {
  if (environment() !== "supported") return { ok: false, error: "This device cannot receive notifications." };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, error: "Notifications were not allowed. You can allow them later in your browser settings." };
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    const subscription = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as unknown as BufferSource,
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, error: "This device did not give the details needed for notifications." };
    const { error } = await supabase.rpc("push_subscribe", { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: deviceLabel(navigator.userAgent) });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "NotAllowedError" ? "Notifications were not allowed on this device." : "Couldn't turn on notifications on this device. Please try again, or use a different browser." };
  }
}

export async function disablePush(): Promise<PushResult> {
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const { error } = await supabase.rpc("push_unsubscribe", { p_endpoint: endpoint });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch { return { ok: false, error: "Couldn't turn off notifications on this device." }; }
}

/** Queues one test notification for my devices; returns how many devices will get it. */
export async function sendTestPush(): Promise<{ ok: true; devices: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("push_send_test");
  return error ? { ok: false, error: error.message } : { ok: true, devices: Number(data ?? 0) };
}
