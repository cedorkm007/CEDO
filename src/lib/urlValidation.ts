/**
 * Validates an optional resource link (slide deck / video) attached to a
 * quest topic. An empty/blank value is considered valid — these fields are
 * always optional. A non-blank value must be a well-formed URL using the
 * https:// scheme; the exact host isn't restricted, so Google Slides,
 * Canva, YouTube, Google Drive, or any other HTTPS link works.
 */
export function isValidHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}
