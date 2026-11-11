// ─────────────────────────────────────────────────────────────
// src/lib/uploadResilience.ts
// "Failed to fetch" is what a browser says when a request never got an answer (the phone's connection dropped, a slow upload gave up, the server was too busy to reply).
// These helpers make the renewal application survive that: they recognise it, try again a couple of times, shrink big phone screenshots before sending them, and say in plain
// words what went wrong and what to do. The pure parts are tested in tests/scholar-apply-network.
// ─────────────────────────────────────────────────────────────

/** Does this error message mean "the request did not get through" (as opposed to the server refusing it for a reason)? */
export function isNetworkErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|the network connection was lost|timed? ?out|connection (was )?(lost|reset|closed)/i.test(message);
}

export const NETWORK_RETRY_DELAYS_MS = [1500, 4000];

/**
 * Runs `attempt` and, while it fails only because the request did not get through, tries again (after the given delays). Any other error is returned at once.
 * `attempt` returns the usual { error } shape of the Supabase calls.
 */
export async function retryOnNetworkError<T extends { error: { message: string } | null }>(
  attempt: () => Promise<T>, delays: number[] = NETWORK_RETRY_DELAYS_MS, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<T> {
  let result: T;
  try { result = await attempt(); }
  catch (e) { result = { error: { message: String((e as Error)?.message ?? e) } } as T; }
  for (const d of delays) {
    if (!result.error || !isNetworkErrorMessage(result.error.message)) return result;
    await sleep(d);
    try { result = await attempt(); }
    catch (e) { result = { error: { message: String((e as Error)?.message ?? e) } } as T; }
  }
  return result;
}

/** The plain-words message for a request that did not get through. `what` finishes "We could not …", for example "send your screenshot (2 of 3)". */
export function networkProblemText(what: string): string {
  return `We could not ${what} because your internet connection dropped or was too slow. Nothing was saved. Please check your connection (Wi-Fi or mobile data) and press Submit again.`;
}

/**
 * "No content provided" is what the storage server answers when the file it was sent had NO bytes in it. That happens when a picture was chosen on a phone and the phone later lost it
 * (it was moved or deleted, it lives only in the cloud, or the browser's saved copy of it came back empty). The text names the picture and says what to do.
 */
export function isEmptyUploadMessage(message: string | null | undefined): boolean {
  return !!message && /no content provided|empty (file|body)|zero[- ]length/i.test(message);
}
export function unreadablePictureText(name: string): string {
  return `The picture "${name}" could not be read: it arrived empty (it may have been moved, deleted or lost from your phone's memory, or it is stored only in the cloud). Nothing was saved. Please remove it, choose the picture again from your phone's gallery or Files, and press Submit again.`;
}
/** The message to show for a failed upload: the plain-words text for an empty picture, the server's own words for anything else. */
export function uploadProblemText(message: string, fileName: string): string {
  return isEmptyUploadMessage(message) ? unreadablePictureText(fileName) : message;
}
/**
 * Reads the whole file into memory right now and returns a copy that lives in memory, so what is sent is exactly what was read. Returns null when the file cannot be read or has no bytes
 * (the case behind "No content provided"). Browser only.
 */
export async function makeReadable(file: File): Promise<File | null> {
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return new File([buf], file.name, { type: file.type, lastModified: file.lastModified });
  } catch { return null; }
}

/** The biggest side (in pixels) a grade screenshot keeps. Plenty to read every line, and small enough to upload quickly on mobile data. */
export const SHRINK_MAX_SIDE = 2400;
/** Pictures at or under this size are sent as they are. */
export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** The size a picture shrinks to (never bigger than it is). */
export function shrunkSize(width: number, height: number, maxSide = SHRINK_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A PDF from this size up gets a friendly tip to make it smaller before it is sent. */
export const BIG_PDF_HINT_BYTES = 5 * 1024 * 1024;
/** The biggest file a submission activity takes (the same limit the upload function applies). */
export const SUBMISSION_MAX_BYTES = 20 * 1024 * 1024;
/** A tip, in plain words, for a big PDF (usually a scan): how to make it smaller. Null for any other file and for a PDF that is not big. */
export function bigPdfHint(file: { name: string; type: string; size: number }): string | null {
  const isPdf = file.type === "application/pdf" || /.pdf$/i.test(file.name);
  if (!isPdf || file.size < BIG_PDF_HINT_BYTES) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const how = "Scan it again at a lower quality (for example grayscale, 150 dpi, or the “small file” option of your scanner app), then choose the file again.";
  return file.size > SUBMISSION_MAX_BYTES
    ? `“${file.name}” is ${mb} MB, which is over the ${SUBMISSION_MAX_BYTES / (1024 * 1024)} MB limit, so it will most likely be refused. ${how}`
    : `“${file.name}” is ${mb} MB. Big files upload slowly, most of all on mobile data. If you can, make it smaller first. ${how}`;
}

/** A big phone PHOTO (JPG) is shrunk before it is sent to a submission activity; its type and name stay the same, so the activity's allowed types still fit. */
export function shouldShrinkJpeg(file: { type: string; size: number }): boolean {
  return file.type === "image/jpeg" && file.size > SHRINK_ABOVE_BYTES;
}
export async function shrinkJpegForUpload(file: File): Promise<File> {
  if (!shouldShrinkJpeg(file)) return file;
  const small = await shrinkImageForUpload(file);
  return small === file ? file : new File([small], file.name, { type: "image/jpeg", lastModified: file.lastModified });
}

/** Should this picture be shrunk before it is sent? Only big JPG, PNG or WEBP pictures. */
export function shouldShrink(file: { type: string; size: number }): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size > SHRINK_ABOVE_BYTES;
}

/**
 * A big phone screenshot or photo becomes a JPG of at most SHRINK_MAX_SIDE pixels (usually a few hundred KB), which uploads quickly even on a weak connection.
 * If anything goes wrong, or the result is not smaller, the original file is returned untouched. Browser only.
 */
export async function shrinkImageForUpload(file: File): Promise<File> {
  if (!shouldShrink(file)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = shrunkSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch { return file; }
}
