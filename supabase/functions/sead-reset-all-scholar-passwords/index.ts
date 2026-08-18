import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";

const DEFAULT_PASSWORD = "123456";
const CONCURRENCY = 10; // resets run in small parallel batches so this doesn't time out on large rosters

interface ScholarRow {
  id: string;
  scholar_id_number: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireSeadStaff(req);

    const { data: scholars, error: fetchError } = await admin
      .from("scholars")
      .select("id, scholar_id_number");

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (scholars ?? []) as ScholarRow[];
    const total = rows.length;
    let succeeded = 0;
    const failures: { scholarIdNumber: string; error: string }[] = [];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (scholar) => {
        const { error } = await admin.auth.admin.updateUserById(scholar.id, { password: DEFAULT_PASSWORD });
        return { scholar, error };
      }));
      for (const { scholar, error } of results) {
        if (error) failures.push({ scholarIdNumber: scholar.scholar_id_number, error: error.message });
        else succeeded++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, total, succeeded, failed: failures.length, failures, newPassword: DEFAULT_PASSWORD,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
