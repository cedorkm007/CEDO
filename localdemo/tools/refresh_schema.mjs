// localdemo/tools/refresh_schema.mjs
// Rebuilds localdemo/schema/tables.json: the STRUCTURE (table and column names, types, defaults, primary and foreign keys) of the
// real project's public tables, as published by its API description. It reads NO rows and writes NO secrets.
//
//   node localdemo/tools/refresh_schema.mjs                 -> fetches the description with the key in .env.scripts (read-only)
//   node localdemo/tools/refresh_schema.mjs path/to/openapi.json   -> uses a description you already saved
//
// The local demo uses this file to create tables the migration files never created (some real tables were made by hand).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "localdemo/schema/tables.json");

async function load() {
  const given = process.argv[2];
  if (given) return JSON.parse(fs.readFileSync(given, "utf8"));
  const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.scripts"), "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, Accept: "application/openapi+json" } });
  if (!res.ok) throw new Error("Could not read the API description: HTTP " + res.status);
  return res.json();
}

const spec = await load();
const tables = {};
for (const [name, def] of Object.entries(spec.definitions ?? {})) {
  const columns = [];
  const pk = [];
  const fks = [];
  for (const [col, p] of Object.entries(def.properties ?? {})) {
    const desc = p.description ?? "";
    if (/Primary Key/.test(desc)) pk.push(col);
    const fk = desc.match(/<fk table='([^']+)' column='([^']+)'\/>/);
    if (fk) fks.push({ column: col, table: fk[1], refColumn: fk[2] });
    columns.push({ name: col, type: p.format ?? "text", notNull: (def.required ?? []).includes(col), default: p.default === undefined ? null : p.default });
  }
  tables[name] = { columns, pk, fks };
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: "Structure of the real public tables (no data). Regenerate with localdemo/tools/refresh_schema.mjs.", tables }, null, 1));
console.log(`Wrote ${Object.keys(tables).length} tables to localdemo/schema/tables.json`);
