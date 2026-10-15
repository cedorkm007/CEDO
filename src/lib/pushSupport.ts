// ─────────────────────────────────────────────────────────────
// src/lib/pushSupport.ts
// The pure part of web push on the website: can THIS device turn notifications on, and the plain words that go with each answer.
// No browser / Supabase imports, so tests can run it alone. The browser calls are in pushClient.ts.
// ─────────────────────────────────────────────────────────────

/**
 * supported      the device can receive push: show "Turn on notifications"
 * needs_install  iPhone / iPad in plain Safari: push only works after "Add to Home Screen" and opening the portal from there
 * blocked        the person said No (or the browser blocks it): only the browser's site settings can change that
 * unsupported    this browser or window cannot do push (an in-app browser, a private window, an old browser): the bell still works
 * not_configured the website has no public key yet (the office has not finished the setup): say nothing
 */
export type PushSupport = "supported" | "needs_install" | "blocked" | "unsupported" | "not_configured";

export interface PushEnvironment {
  hasKey: boolean; hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean;
  permission: "default" | "granted" | "denied" | null;
  isIOS: boolean; isStandalone: boolean; insideAppBrowser: boolean;
}

export function classifyPushSupport(env: PushEnvironment): PushSupport {
  if (!env.hasKey) return "not_configured";
  if (env.insideAppBrowser) return "unsupported";
  // On iPhone / iPad push exists only for a portal added to the Home Screen (iOS 16.4+); in plain Safari those objects are missing.
  if (env.isIOS && !env.isStandalone) return "needs_install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (env.permission === "denied") return "blocked";
  return "supported";
}

/** Facebook / Messenger / Instagram / TikTok / Line in-app browsers (no push there), from the user-agent text. */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Messenger|Instagram|TikTok|musical_ly|Line\//i.test(userAgent);
}

export const isIOSDevice = (userAgent: string, maxTouchPoints = 0): boolean =>
  /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);     // iPadOS reports itself as a Mac

/** The public key as the browser's push API wants it (a list of bytes). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A short, friendly device name from the user-agent text, for "Notifications are on for: Chrome on Android". */
export function deviceLabel(userAgent: string): string {
  const os = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad|iPod/i.test(userAgent) ? "iPhone / iPad" : /Windows/i.test(userAgent) ? "Windows" : /Mac OS|Macintosh/i.test(userAgent) ? "Mac" : /Linux/i.test(userAgent) ? "Linux" : "";
  const browser = /Edg\//i.test(userAgent) ? "Edge" : /SamsungBrowser/i.test(userAgent) ? "Samsung Internet" : /Firefox|FxiOS/i.test(userAgent) ? "Firefox" : /Chrome|CriOS/i.test(userAgent) ? "Chrome" : /Safari/i.test(userAgent) ? "Safari" : "Browser";
  return os ? `${browser} on ${os}` : browser;
}

/** The sentence under the control for each answer (plain words, no jargon). */
export const PUSH_MESSAGES: Record<PushSupport, string> = {
  supported: "Get a notification on this device when something needs you, even when the portal is closed. You will always see every update in the bell too.",
  needs_install: "On an iPhone or iPad: tap the Share button, choose “Add to Home Screen”, then open the portal from the new icon and turn notifications on there. (iOS 16.4 or newer.) The bell works without this.",
  blocked: "Notifications are blocked for this site on this device. To turn them on, allow notifications for this site in your browser settings. The bell keeps working.",
  unsupported: "This browser cannot send notifications to your device (some in-app browsers and private windows cannot). Open the portal in Chrome, Edge, Firefox or Safari to use them. The bell keeps working.",
  not_configured: "",
};
