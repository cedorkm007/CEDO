// localdemo/tools/compare_functions.mjs — which real database functions does the local demo database not have yet?
// Needs the saved API description: node localdemo/tools/compare_functions.mjs path/to/openapi.json
import fs from "node:fs";
import { openDb } from "../build.mjs";
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const real = new Set(Object.keys(spec.paths).filter(p => p.startsWith("/rpc/")).map(p => p.slice(5)));
const db = openDb();
await db.waitReady;
const have = new Set((await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows.map(r => r.proname));
const missing = [...real].filter(n => !have.has(n)).sort();
console.log(`real functions exposed: ${real.size}; in the demo database: ${[...real].filter(n => have.has(n)).length}; missing: ${missing.length}`);
console.log(missing.join("\n"));
await db.close();
