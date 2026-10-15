// csr-issue — makes (or hands back) a scholar's Certificate of Scholarship Renewal as a PDF.
//
// Called by the website with the signed-in person's own sign-in (a scholar for their own certificate; the evaluator for any, and to issue a
// corrected copy). The database decides who may have a certificate and when (csr_prepare in supabase_migration_renewal_p8_csr.sql); this function
// only builds the PDF, stores the original in the private folder "csr-issued" and answers with a short-lived download link.
//
//   Secrets (supabase secrets set ...):  SITE_URL   the website address the scholar's QR opens, e.g. https://your-site.example   (no trailing slash)
//   Deploy:                              supabase functions deploy csr-issue            (keeps the normal sign-in check)
//
// Body: { "recordId": "<renewal record id>", "reason": "<only for a corrected copy, evaluator only>" }
// Answer: { "url": "<download link>", "csrNumber": "CSR-2026-1S-00012", "version": 1, "fileName": "...pdf" }  or  { "error": "..." }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { buildCsrPdf, csrFullName, csrProgramCode } from "../_shared/csrPdf.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** "Certificate of Scholarship Renewal - 2108-00001 - 1st Semester 2025-2026.pdf" with nothing a file name cannot hold. */
function downloadName(scholarId: string, term: string, schoolYear: string): string {
  return `Certificate of Scholarship Renewal - ${scholarId} - ${term} ${schoolYear}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in first." }, 401);
    let body: { recordId?: string; reason?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const recordId = String(body.recordId ?? "").trim();
    if (!recordId) return json({ error: "Missing the renewal." }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: prep, error: prepError } = await asCaller.rpc("csr_prepare", { p_record_id: recordId, p_reissue_reason: body.reason?.trim() || null });
    if (prepError || !prep) return json({ error: prepError?.message ?? "Couldn't prepare the certificate." }, 400);

    const link = async (path: string, scholarId: string, term: string, schoolYear: string, csrNumber: string, version: number) => {
      const fileName = downloadName(scholarId, term, schoolYear);
      const { data, error } = await admin.storage.from("csr-issued").createSignedUrl(path, 300, { download: fileName });
      if (error || !data) return json({ error: "The certificate was made but could not be opened. Please try again." }, 500);
      return json({ url: data.signedUrl, csrNumber, version, fileName });
    };

    // Already made: hand back the stored original (never a second copy with a different look).
    if (prep.ready) return await link(prep.storage_path, prep.scholar_id_number, prep.term, prep.school_year, prep.csr_number, prep.version);

    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
    if (!siteUrl) return json({ error: "The website address for the certificate's QR is not set up yet (SITE_URL)." }, 500);
    const d = prep.data as Record<string, string>, set = prep.settings as Record<string, string | null>;
    const picture = async (path: string | null | undefined): Promise<Uint8Array | null> => {
      if (!path) return null;
      const { data } = await admin.storage.from("csr-assets").download(path);
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    };
    const pdf = await buildCsrPdf({
      csrNumber: prep.csr_number, version: prep.version,
      fullName: csrFullName(d.first_name, d.middle_name, d.last_name), scholarIdNumber: d.scholar_id_number, barangay: d.barangay,
      program: csrProgramCode(d.program, d.year_level), school: d.school, term: d.term, schoolYear: d.school_year, issuedAt: new Date(), place: set.place ?? "the City of Cagayan de Oro, Philippines",
      officer: { name: set.officer_name ?? "", title: set.officer_title ?? "", signature: await picture(set.officer_signature_path) },
      mayor: { name: set.mayor_name ?? "", title: set.mayor_title ?? "", signature: await picture(set.mayor_signature_path), mark: await picture(set.mayor_mark_path) },
      qrUrl: `${siteUrl}/CEDO/id?token=${prep.qr_token}`,
    });
    const path = `${d.scholar_id_number}/${prep.csr_number}-v${prep.version}.pdf`;
    const { error: uploadError } = await admin.storage.from("csr-issued").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) return json({ error: "The certificate could not be saved. Please try again." }, 500);
    const { error: completeError } = await admin.rpc("csr_complete", { p_csr_id: prep.csr_id, p_storage_path: path });
    if (completeError) return json({ error: completeError.message }, 500);
    return await link(path, d.scholar_id_number, d.term, d.school_year, prep.csr_number, prep.version);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
