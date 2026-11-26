// tests/renewal-removal-wording/tests.mjs — an endorsement for removal is never called a renewal (3 checks, short on purpose)
// Run:  node tests/renewal-removal-wording/tests.mjs        (the third check builds a throwaway in-memory database)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { buildDb } from "../../localdemo/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rrw-"));
const outfile = path.join(tmp, "renewal.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

check("1 the approval button says what it does: a removal removes (never 'renew'), documents-first statuses only approve, the others approve and renew",
  R.approveEndorsementLabel("Removed", false) === "Yes, remove the scholar" && R.approveEndorsementLabel("Probationary", true) === "Yes, approve" && R.approveEndorsementLabel("Regular", false) === "Yes, approve and renew");

const view = src("src/sead/renewal/RenewalDetailView.tsx");
const waiting = R.renewalProgress("endorsed_for_approval", { required_documents: [], consultation_required: true, consultation_done: true, consult_route: true });
const renewed = R.renewalProgress("renewed", { required_documents: [] });
check("2 the case and the window say the scholar is removed and not renewed; while an endorsement waits, the scholar's steps end with 'Result' and no message promises a renewal",
  /confirmLabel=\{approveEndorsementLabel\(final, needsDocs\)\}/.test(view) && /endorsed removal after the consultation/.test(view) && /is <strong>not renewed<\/strong>/.test(view)
  && waiting.at(-1).label === "Result" && renewed.at(-1).label === "Renewed" && !/evaluator will approve it, and then you are renewed/.test(src("src/lib/renewal.ts")));

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
const def = async () => (await db.query("select pg_get_functiondef('public.renewal_endorse_status(uuid,text,text)'::regprocedure) d")).rows[0].d;
const file = async f => { try { await db.exec(fs.readFileSync(path.join(root, f), "utf8")); return "ok"; } catch (e) { await db.exec("rollback").catch(() => {}); return String(e.message); } };
const u0 = await file("undo_renewal_endorsement_message.sql");
const before = /then you are renewed/.test(await def());
const a = await file("supabase_migration_renewal_endorsement_message.sql"), b = await file("supabase_migration_renewal_endorsement_message.sql");
const after = await def();
const u = await file("undo_renewal_endorsement_message.sql");
const undone = /then you are renewed/.test(await def());
const re = await file("supabase_migration_renewal_endorsement_message.sql"), q = await file("check_removed_not_renewed_readonly.sql");
check("3 the database file changes the message sent to the scholar (safe to run twice), can be undone, and the read-only check runs",
  u0 === "ok" && before && a === "ok" && b === "ok" && /will decide on it/.test(after) && !/then you are renewed/.test(after) && u === "ok" && undone && re === "ok" && q === "ok", `${u0} ${before} ${a} ${b} ${u} ${undone} ${q}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
