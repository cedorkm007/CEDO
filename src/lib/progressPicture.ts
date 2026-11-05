// ─────────────────────────────────────────────────────────────
// src/lib/progressPicture.ts
// SDP Progress Monitoring: the pure helpers for the picture a scholar takes (no React, no Supabase; the parts that touch the canvas take the context as an argument so
// they can be tested): what is printed on the picture (the place, the date and time), how big the picture is, how it is compressed, and how the place name is found.
// The checks on the database side are in supabase_migration_sdp_progress_a_tables_functions.sql.
// ─────────────────────────────────────────────────────────────

/** The longest side of the saved picture, in pixels. Enough to read the watermark and see the place; small enough to upload fast on mobile data. */
export const PICTURE_MAX_SIDE = 1280;
/** JPEG quality tried first, then lower ones until the picture is small enough. */
export const PICTURE_QUALITIES = [0.72, 0.62, 0.52, 0.42];
/** The picture should be at most this many bytes (the private folder allows 2 MB; this keeps it small). */
export const PICTURE_TARGET_BYTES = 350 * 1024;
/** A rough position this old (milliseconds) is not used: the scholar must have a fresh fix. */
export const LOCATION_MAX_AGE_MS = 60_000;

const TZ = "Asia/Manila";

/** The size the picture takes so its longest side is at most `max` (never bigger than it is). */
export function pictureSize(width: number, height: number, max = PICTURE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: Math.max(1, width), height: Math.max(1, height) };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "Nov 5, 2026 · 2:35:10 PM" in Philippine time. */
export function manilaStamp(when: Date): string {
  const date = when.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
  const time = when.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${date} · ${time}`;
}

/** "8.45420, 124.63190" — five decimals is about one metre. */
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export interface WatermarkInput {
  /** The place name ("" when it could not be found: only the coordinates are printed). */
  place: string;
  lat: number;
  lng: number;
  /** Metres of uncertainty reported by the phone (null when unknown). */
  accuracy: number | null;
  when: Date;
  scholarId?: string;
  activityName?: string;
}

/** The lines printed on the picture, from the most important: the place, the coordinates, the date and time, and (smaller) who and what. */
export function watermarkLines(w: WatermarkInput): string[] {
  const lines: string[] = [];
  if (w.place.trim()) lines.push(w.place.trim());
  lines.push(`${formatCoords(w.lat, w.lng)}${w.accuracy != null && Number.isFinite(w.accuracy) ? ` (±${Math.round(w.accuracy)} m)` : ""}`);
  lines.push(manilaStamp(w.when));
  const who = [w.scholarId, w.activityName].map(x => (x ?? "").trim()).filter(Boolean).join(" · ");
  if (who) lines.push(who);
  return lines;
}

/** Cuts a line to fit `maxWidth` pixels with "…" (measure = the canvas's measureText). */
export function fitLine(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

/** The part of the canvas context the watermark needs (so tests can pass a fake). */
export interface WatermarkContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/**
 * Prints the watermark on the picture: a dark band across the bottom with the lines in white (the first line bigger). It is burned into the pixels, so it cannot be switched off.
 * Returns the height of the band.
 */
export function drawWatermark(ctx: WatermarkContext, width: number, height: number, lines: string[]): number {
  if (lines.length === 0) return 0;
  const base = Math.max(14, Math.round(width / 38));            // the size of the smaller lines
  const pad = Math.round(base * 0.7);
  const sizes = lines.map((_, i) => (i === 0 ? Math.round(base * 1.25) : i === lines.length - 1 && lines.length > 3 ? Math.round(base * 0.85) : base));
  const gap = Math.round(base * 0.28);
  const bandH = pad * 2 + sizes.reduce((n, s) => n + s, 0) + gap * (lines.length - 1);
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, height - bandH, width, bandH);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  let y = height - bandH + pad;
  lines.forEach((text, i) => {
    ctx.font = `${i === 0 ? "700" : "600"} ${sizes[i]}px Arial, Helvetica, sans-serif`;
    ctx.fillText(fitLine(text, width - pad * 2, s => ctx.measureText(s).width), pad, y);
    y += sizes[i] + gap;
  });
  return bandH;
}

/** Distance in metres between two positions. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── The place name ──
/** The free reverse-geocoding service used to turn the position into a place name (no key needed; it is allowed in the browser). */
export const REVERSE_GEOCODE_HOST = "https://api.bigdatacloud.net";
export function reverseGeocodeUrl(lat: number, lng: number): string {
  return `${REVERSE_GEOCODE_HOST}/data/reverse-geocode-client?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}&localityLanguage=en`;
}

/** "Carmen, Cagayan De Oro City, Misamis Oriental" from the service's answer; "" when it has nothing useful. */
export function placeFromGeocode(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = json as Record<string, unknown>;
  const str = (k: string) => (typeof j[k] === "string" ? (j[k] as string).trim() : "");
  const parts = [str("locality"), str("city"), str("principalSubdivision")].filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex(x => x.toLowerCase() === p.toLowerCase()) === i);
  return unique.join(", ");
}

/** The place name for a position, or "" when the service cannot be reached within `timeoutMs` (the picture then carries the coordinates only). */
export async function reverseGeocode(lat: number, lng: number, fetchFn: typeof fetch = fetch, timeoutMs = 4000): Promise<string> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(reverseGeocodeUrl(lat, lng), ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return "";
    return placeFromGeocode(await res.json());
  } catch { return ""; }
  finally { if (timer) clearTimeout(timer); }
}

// ── What can go wrong with the camera or the location, in plain words ──
export function cameraProblemText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The camera is blocked. Allow the camera for this site in your browser's settings (the lock or camera icon next to the address), then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is being used by another app. Close it and try again.";
  return "The camera could not be opened. Please try again.";
}
export function locationProblemText(code: number | null | undefined): string {
  if (code === 1) return "The location is blocked. Allow the location for this site in your browser's settings (the lock icon next to the address), then try again. It is needed to print the place on the picture.";
  if (code === 2) return "Your phone cannot tell where you are right now. Turn on the location (GPS) of your phone and go to an open place.";
  if (code === 3) return "Finding your location is taking too long. Turn on the location (GPS) of your phone and wait a moment.";
  return "Your location could not be found.";
}

/** Why a scholar cannot use the camera at all (nothing to ask the browser for), or "" when it can be tried. */
export function cameraUnavailableText(env: { hasMediaDevices: boolean; hasGeolocation: boolean; secure: boolean }): string {
  if (!env.secure) return "The camera only works on a secure (https) page.";
  if (!env.hasMediaDevices) return "This browser cannot open the camera. Try another browser (Chrome or Safari).";
  if (!env.hasGeolocation) return "This browser cannot find your location. Try another browser (Chrome or Safari).";
  return "";
}
