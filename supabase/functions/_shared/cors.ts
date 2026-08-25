export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * BUG FIX (found while debugging a 502 that the browser reported as a CORS
 * failure on submission-upload-file): every shared helper in the
 * Submission Activity Google Drive call chain (verifyScholar.ts,
 * googleDrive.ts, ensureSubmissionDriveFolders.ts) used to construct its
 * own error to throw with a bare `new Response(JSON.stringify(...), {
 * status })` — no headers at all. Each Edge Function's own top-level catch
 * does `if (thrown instanceof Response) return thrown;` and returns that
 * Response completely as-is. Since none of those bare Responses carried
 * Access-Control-Allow-Origin, the browser blocked the response as a CORS
 * violation regardless of what its actual status code said — masking the
 * real error (often a legitimate 502 from a failed Drive API call, or a
 * legitimate 401/403 from a failed auth check) behind a generic
 * "Failed to send a request to the Edge Function" on the client.
 *
 * throwJsonError is now the ONLY way any shared helper in this chain
 * should construct an error to throw, specifically so this class of bug
 * can't be silently reintroduced by a future throw site that forgets to
 * add headers by hand.
 */
export function throwJsonError(error: string, status: number): never {
  throw new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
