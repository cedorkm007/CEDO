// localdemo/tools/describe.mjs <table...> — prints a table's columns from the local database (handy while writing seed data).
import { openDb } from "../build.mjs";
const db = openDb(); await db.waitReady;
for (const t of process.argv.slice(2)) {
  const r = await db.query("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t]);
  console.log(`\n${t}`); for (const c of r.rows) console.log(`  ${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " NN" : ""}${c.column_default ? " = " + c.column_default.slice(0, 40) : ""}`);
  const ch = await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = ('public.' || quote_ident($1))::regclass and contype = 'c'", [t]);
  for (const c of ch.rows) console.log("  CHECK " + c.d.slice(0, 160));
}
await db.close();
