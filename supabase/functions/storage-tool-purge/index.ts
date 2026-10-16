// storage-tool-purge — removes the stored files of items that have been in the Storage Tool's Trash for longer than the number of days in the
// settings (30), then removes their rows. Called once an hour by a pg_cron job (see storage_tool_purge_schedule() in
// supabase_migration_storage_tool_p2.sql). It is NOT for the browser: it is deployed with --no-verify-jwt and protected by a secret header.
//
//   Secrets (supabase secrets set ...):  STORAGE_TOOL_PURGE_SECRET
//   Deploy:                              supabase functions deploy storage-tool-purge --no-verify-jwt
//
// Each call (up to 5 rounds of 200 files): ask the database which trashed files are due (storage_tool_purge_claim), remove them from the storage
// folder "storage-tool" with the storage service's own API (the only right way to remove a stored file), then tell the database to delete the rows
// whose stored file is really gone (storage_tool_purge_finish). A file that could not be removed stays and is tried again next hour.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { secretMatches } from "../_shared/pushMessage.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!secretMatches(req.headers.get("x-purge-secret"), Deno.env.get("STORAGE_TOOL_PURGE_SECRET"))) return json({ error: "Not allowed." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let rounds = 0, deletedFiles = 0, deletedFolders = 0, failed = 0;
  for (; rounds < 5; rounds++) {
    const { data, error } = await admin.rpc("storage_tool_purge_claim", { p_limit: 200 });
    if (error) return json({ error: error.message, rounds, deletedFiles, deletedFolders }, 500);
    const due = (data ?? []) as { id: string; path: string }[];
    if (due.length === 0) break;
    const removed = await admin.storage.from("storage-tool").remove(due.map(d => d.path));
    if (removed.error) { failed += due.length; break; }
    const done = await admin.rpc("storage_tool_purge_finish", { p_ids: due.map(d => d.id) });
    if (done.error) return json({ error: done.error.message, rounds, deletedFiles, deletedFolders }, 500);
    deletedFiles += Number((done.data as { deleted_files?: number } | null)?.deleted_files ?? 0);
    deletedFolders += Number((done.data as { deleted_folders?: number } | null)?.deleted_folders ?? 0);
    if (due.length < 200) { rounds++; break; }
  }
  return json({ rounds, deletedFiles, deletedFolders, failed });
});
