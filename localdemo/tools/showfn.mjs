// localdemo/tools/showfn.mjs <function...> — prints a database function's definition from the local database.
import { openDb } from "../build.mjs";
const db = openDb(); await db.waitReady;
for (const n of process.argv.slice(2)) for (const r of (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where pronamespace='public'::regnamespace and proname=$1", [n])).rows) console.log(r.d + "\n");
await db.close();
