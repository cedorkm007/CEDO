// ─────────────────────────────────────────────────────────────
// src/lib/logoImage.ts
// A school's logo: the checks on the picture it chooses, shrinking it to a small PNG (in the browser), and the small helpers the clearance uses to place it. The pure helpers (no
// browser) are tested in tests/school-logo.
// ─────────────────────────────────────────────────────────────

/** The biggest side of the saved logo, in pixels. Plenty for the header picture and for a printed clearance. */
export const LOGO_MAX_SIDE = 320;
export const LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** What is wrong with the chosen file, or null. */
export function logoFileProblem(file: { type: string; size: number; name?: string }): string | null {
  if (!OK_TYPES.includes(file.type)) return "Choose a PNG, JPG or WebP picture.";
  if (file.size > LOGO_MAX_FILE_BYTES) return "That picture is too big (over 5 MB). Choose a smaller one.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Width and height of a PNG, read from its header; null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The size a picture takes inside a square box without being stretched. */
export function fitInBox(width: number, height: number, box: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: box, height: box };
  const scale = Math.min(box / width, box / height);
  return { width: width * scale, height: height * scale };
}

export interface PreparedLogo { base64: string; width: number; height: number }

/** Reads a picture the school chose and shrinks it to a PNG of at most LOGO_MAX_SIDE pixels (transparent parts stay transparent). Browser only. */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the picture.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const url = canvas.toDataURL("image/png");
  return { base64: url.slice(url.indexOf(",") + 1), width, height };
}
