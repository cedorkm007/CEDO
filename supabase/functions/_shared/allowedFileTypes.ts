// Part 4. Deno-native mirror of SUBMISSION_ALLOWED_FILE_TYPES in
// src/sead/submissionActivitiesApi.ts. Edge Functions run in a separate
// Deno runtime that can't import that file directly — it imports
// `{ supabase } from "@/lib/supabase"`, which depends on a Vite path
// alias and `import.meta.env`, neither of which resolves outside the
// Vite/browser build. There is deliberately no single shared source file
// between the two runtimes; keep this list in sync with the frontend one
// by hand if the accepted file types ever change.
export const SUBMISSION_ALLOWED_FILE_TYPES = [
  { label: "PDF", extensions: [".pdf"], mimeTypes: ["application/pdf"] },
  {
    label: "Word",
    extensions: [".doc", ".docx"],
    mimeTypes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  { label: "JPEG", extensions: [".jpg", ".jpeg"], mimeTypes: ["image/jpeg"] },
  { label: "PNG", extensions: [".png"], mimeTypes: ["image/png"] },
  {
    label: "Excel/CSV",
    extensions: [".xls", ".xlsx", ".csv"],
    mimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ],
  },
];

export const SUBMISSION_ALLOWED_FILE_TYPES_LABEL = SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label).join(", ");

/**
 * The REAL file-type check — the frontend's isAllowedSubmissionFileType
 * (src/scholar/submissionsApi.ts) is UX convenience only, as its own
 * comment says. This is what submission-upload-file actually gates on.
 *
 * BUG FIX (found while debugging observation (b) — scholars unable to
 * upload files of the intended, actually-allowed type): this used to
 * accept a file by extension ONLY when the browser reported a completely
 * BLANK MIME type (`!mimeType`). In practice browsers frequently report a
 * non-blank but WRONG MIME type for a perfectly legitimate file — most
 * famously .csv, which different OS/browser combinations report as
 * "text/plain", "application/vnd.ms-excel", or "application/octet-stream"
 * depending on what's registered to handle that extension locally, not
 * "text/csv"; the same happens for .docx/.xlsx reported as generic
 * "application/octet-stream" when no file association exists on the
 * uploading device. Any of those legitimate files hit the old `!mimeType`
 * guard's false branch and were rejected outright, even though the
 * extension was exactly right and the field's allowed categories included
 * it. Now matches on extension whenever the MIME type isn't a recognized
 * match, not only when it's empty — same intent (trust MIME type when
 * it's actually informative), safer fallback (trust the extension
 * whenever the MIME type isn't), same as the frontend's own check.
 */
export function isAllowedSubmissionUpload(fileName: string, mimeType: string, allowedCategories?: string[]): boolean {
  const name = fileName.toLowerCase();
  const candidates = allowedCategories && allowedCategories.length > 0
    ? SUBMISSION_ALLOWED_FILE_TYPES.filter(t => allowedCategories.includes(t.label))
    : SUBMISSION_ALLOWED_FILE_TYPES;
  return candidates.some(
    t => t.mimeTypes.includes(mimeType) || t.extensions.some(ext => name.endsWith(ext)),
  );
}
