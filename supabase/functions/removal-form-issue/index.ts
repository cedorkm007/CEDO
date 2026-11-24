// removal-form-issue — makes the Scholarship Grant Termination Acknowledgement Form of a scholar whose removal the Division Head approved, as a PDF.
//
// Called by the website with the signed-in person's own sign-in: the scholar the form is about, or the consulting staff member the case is assigned to. The database decides who may
// open the form and what is printed on it (removal_form_data in supabase_migration_removal_form.sql); this function only builds the PDF with the two e-signatures attached at approval
// (the Division Head's, kept with the referral; the City Education and Development Officer's, kept in the Certificate settings) and hands it back. Nothing is stored: the same case
// always gives the same form (the date is the day the Division Head approved).
//
//   Deploy:  supabase functions deploy removal-form-issue            (keeps the normal sign-in check)
//
// Body: { "referralId": "<referral id>" }   or   { "recordId": "<renewal record id>" } (a removal approved by the evaluator: the person who signs was chosen from a list)
// Answer: { "fileName": "Scholarship Termination Form - 2108-00001.pdf", "pdfBase64": "..." }  or  { "error": "..." }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { buildRemovalFormPdf, DIVISION_HEAD_TITLE } from "../_shared/removalFormPdf.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** The PDF as base64 (in pieces, so a large file does not overflow the call stack). */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in first." }, 401);
    let body: { referralId?: string; recordId?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const referralId = String(body.referralId ?? "").trim(), recordId = String(body.recordId ?? "").trim();
    if (!referralId && !recordId) return json({ error: "Missing the case." }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data, error } = recordId ? await asCaller.rpc("renewal_removal_form_data", { p_record_id: recordId }) : await asCaller.rpc("removal_form_data", { p_referral_id: referralId });
    if (error || !data) return json({ error: error?.message ?? "Couldn't prepare the form." }, 400);
    const d = data as Record<string, any>;

    const picture = async (bucket: string, path: string | null | undefined): Promise<Uint8Array | null> => {
      if (!path) return null;
      const { data: file } = await admin.storage.from(bucket).download(path);
      return file ? new Uint8Array(await file.arrayBuffer()) : null;
    };
    const pdf = await buildRemovalFormPdf({
      first: d.first_name ?? "", middle: d.middle_name ?? "", last: d.last_name ?? "", program: d.program ?? "", yearLevel: d.year_level ?? "", school: d.school ?? "", barangay: d.barangay ?? "",
      failed: ((d.failed ?? []) as Record<string, string>[]).map(r => ({ semesterYear: r.semester_year ?? "", yearLevel: r.year_level ?? "", code: r.code ?? "", subject: r.subject ?? "" })),
      issuedOn: String(d.issued_on ?? ""),
      divisionHead: d.division_head ? { name: d.division_head.name ?? "", title: d.division_head.title || DIVISION_HEAD_TITLE, signature: await picture("staff-signatures", d.division_head.signature_path) } : null,
      officer: { name: d.officer?.name ?? "", title: d.officer?.title ?? "", signature: await picture("csr-assets", d.officer?.signature_path) },
    });
    const fileName = `Scholarship Termination Form - ${d.scholar_id_number}.pdf`.replace(/[\/:*?"<>|]+/g, " ");
    return json({ fileName, pdfBase64: toBase64(pdf) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
