import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

const DEFAULT_PASSWORD = "123456";
const CONCURRENCY = 10; // resets within a batch run in small parallel groups
const BATCH_SIZE = 200; // scholars processed per invocation — keeps every single call fast regardless of roster size, so it can't hit an execution-time limit

interface ScholarRow {
  id: string;
  scholar_id_number: string;
  first_name: string;
  last_name: string;
}

/**
 * Resets ONE bounded batch of scholars (BATCH_SIZE, starting at `offset`)
 * per invocation, instead of the entire roster in one call. A single call
 * trying to loop through everyone got slow enough on a large roster to run
 * into Supabase's Edge Function execution-time limit, which kills the
 * function mid-run with no readable error — this batched design keeps each
 * individual call small and fast no matter how many scholars there are;
 * the client is expected to call this repeatedly (bumping `offset` each
 * time using the `nextOffset` this returns) until `done: true` comes back.
 *
 * Logs one 'reset' account-history entry per successfully-reset scholar,
 * all sharing the SAME batch_id across every invocation of this whole
 * reset-all run — the client generates that id once (crypto.randomUUID())
 * before starting the offset loop and passes it on every call, so Account
 * History can group the entire run together even though it's actually
 * many separate Edge Function invocations.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, callerId } = await requireSeadStaff(req);

    const body = await req.json().catch(() => ({}));
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Number(body.offset)) : 0;
    const batchId = typeof body?.batchId === "string" && body.batchId ? body.batchId : crypto.randomUUID();

    const { data: scholars, error: fetchError, count } = await admin
      .from("scholars")
      .select("id, scholar_id_number, first_name, last_name", { count: "exact" })
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (scholars ?? []) as ScholarRow[];
    const total = count ?? rows.length;
    let succeeded = 0;
    const failures: { scholarIdNumber: string; error: string }[] = [];
    const staffName = await getStaffName(admin, callerId);

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (scholar) => {
        const { error } = await admin.auth.admin.updateUserById(scholar.id, { password: DEFAULT_PASSWORD });
        return { scholar, error };
      }));
      for (const { scholar, error } of results) {
        if (error) {
          failures.push({ scholarIdNumber: scholar.scholar_id_number, error: error.message });
        } else {
          succeeded++;
          await logScholarChange(admin, {
            action: "reset",
            scholarId: scholar.id,
            scholarIdNumber: scholar.scholar_id_number,
            scholarName: `${scholar.first_name} ${scholar.last_name}`,
            performedBy: callerId,
            performedByName: staffName,
            batchId,
            source: "bulk",
            description: `Password reset to the default (${DEFAULT_PASSWORD}) as part of a reset-all-scholars action.`,
          });
        }
      }
    }

    const nextOffset = offset + rows.length;
    const done = rows.length < BATCH_SIZE || nextOffset >= total;

    return new Response(JSON.stringify({
      ok: true, total, processed: rows.length, succeeded, failed: failures.length, failures,
      nextOffset, done, newPassword: DEFAULT_PASSWORD, batchId,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const message = thrown instanceof Error ? thrown.message : "Unexpected error.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


