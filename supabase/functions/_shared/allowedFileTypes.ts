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
 * Same "trust MIME type; fall back to extension only when the browser
 * reported a blank/generic MIME type" logic as the frontend check, kept
 * consistent on purpose.
 */
export function isAllowedSubmissionUpload(fileName: string, mimeType: string, allowedCategories?: string[]): boolean {
  const name = fileName.toLowerCase();
  const candidates = allowedCategories && allowedCategories.length > 0
    ? SUBMISSION_ALLOWED_FILE_TYPES.filter(t => allowedCategories.includes(t.label))
    : SUBMISSION_ALLOWED_FILE_TYPES;
  return candidates.some(
    t => t.mimeTypes.includes(mimeType) || (!mimeType && t.extensions.some(ext => name.endsWith(ext))),
  );
}
