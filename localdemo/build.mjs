// localdemo/build.mjs — builds the private local database for the demo (a PGlite database in localdemo/.data).
//
// How: Supabase's built-in pieces (stubs.sql) -> every real migration file, in the order they were added to the project (each SQL
// statement separately, so one problem never stops the rest) -> any real table the migration files never created (some were made by
// hand) from localdemo/schema/tables.json -> retry whatever failed along the way. Nothing here touches the real project.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { splitSql } from "./sqlsplit.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "localdemo/.data/pgdata");
export const REPORT = path.join(ROOT, "localdemo/.data/build-report.txt");

/** Real views (not tables): never created as tables from the structure description. */
const VIEWS = new Set(["scholar_subject_progress"]);
/** Statements that only make sense on the real Supabase service (live-update publications, scheduled jobs). */
const SKIP = [ /^select\s+cron\./i, /^(begin|commit|rollback)$/i, /^create\s+extension\s+(if\s+not\s+exists\s+)?(pg_cron|pg_net)\b/i];

export function openDb(dir = DATA_DIR) {
  return new PGlite(dir, { extensions: { pg_trgm, pgcrypto } });
}

/** Migration files oldest first: the order they were first committed, files not committed yet by modification time. */
export function migrationFiles() {
  const names = fs.readdirSync(ROOT).filter(f => /^supabase_migration_.*\.sql$/.test(f));
  const added = new Map();
  try {
    const log = execFileSync("git", ["log", "--diff-filter=A", "--name-only", "--format=@@%ct", "--", "supabase_migration_*.sql"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    let t = 0;
    for (const line of log.split(/\r?\n/)) {
      if (line.startsWith("@@")) t = Number(line.slice(2));
      else if (line.trim()) added.set(line.trim(), Math.min(added.get(line.trim()) ?? Infinity, t));
    }
  } catch { /* not a git checkout: fall back to modification time below */ }
  const stamp = f => added.get(f) ?? Math.floor(fs.statSync(path.join(ROOT, f)).mtimeMs / 1000);
  return names.sort((a, b) => stamp(a) - stamp(b) || a.localeCompare(b));
}

/**
 * Runs one statement. When the real database would have been in a different state (a later file replaces a function with a new return
 * type, or re-creates a policy without dropping it first), the older object is dropped and the statement is run again — the later
 * definition wins, as it did on the real project.
 */
async function execTolerant(db, stmt) {
  try { await db.exec(stmt); return; } catch (e) {
    const msg = String(e.message);
    if (/cannot change return type of existing function|cannot change name of input parameter|cannot remove parameter defaults|is not a view/.test(msg) && /^create\s+(or\s+replace\s+)?function/i.test(stmt)) {
      const head = /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(/i.exec(stmt);
      if (head) {
        let depth = 0, start = stmt.indexOf("(", head.index) + 1, end = start, items = 0, nonEmpty = false;
        for (let i = start; i < stmt.length; i++) {
          const ch = stmt[i];
          if (ch === "(") depth++;
          else if (ch === ")") { if (depth === 0) { end = i; break; } depth--; }
          else if (ch === "," && depth === 0) items++;
          else if (!/\s/.test(ch)) nonEmpty = true;
        }
        const argCount = nonEmpty ? items + 1 : 0;
        const rows = (await db.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 and p.pronargs = $2`, [head[1], argCount])).rows;
        for (const r of rows) await db.exec(`drop function ${r.sig}`);
        await db.exec(stmt);
        return;
      }
    }
    const pol = /policy "([^"]+)" for table "([^"]+)" already exists/.exec(msg);
    if (pol && /^create\s+policy/i.test(stmt)) {
      await db.exec(`drop policy "${pol[1]}" on public."${pol[2]}"`).catch(() => db.exec(`drop policy "${pol[1]}" on storage."${pol[2]}"`));
      await db.exec(stmt);
      return;
    }
    throw e;
  }
}

const colType = f => f;
function colDefault(type, d) {
  if (d === null || d === undefined) return "";
  if (typeof d === "number" || typeof d === "boolean") return ` default ${d}`;
  if (/^[a-z_.]+\(.*\)$/i.test(d) || /^CURRENT_/.test(d)) return ` default ${d}`;
  return ` default '${String(d).replace(/'/g, "''")}'::${colType(type)}`;
}
const q = n => `"${n}"`;

/** Creates the real tables the migration files never created, and adds any column they are missing. */
async function completeFromStructure(db, log) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "localdemo/schema/tables.json"), "utf8")).tables;
  const have = new Set((await db.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map(r => r.table_name));
  let created = 0, columnsAdded = 0;
  for (const [name, t] of Object.entries(spec)) {
    if (VIEWS.has(name)) continue;
    if (!have.has(name)) {
      const cols = t.columns.map(c => `${q(c.name)} ${colType(c.type)}${c.notNull && c.default === null ? " not null" : ""}${colDefault(c.type, c.default)}`);
      if (t.pk.length) cols.push(`primary key (${t.pk.map(q).join(", ")})`);
      try { await db.exec(`create table public.${q(name)} (${cols.join(", ")})`); created++; log.push(`created table ${name} from the structure description`); }
      catch (e) { log.push(`COULD NOT create table ${name}: ${e.message}`); }
    } else {
      const present = new Set((await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [name])).rows.map(r => r.column_name));
      for (const c of t.columns) {
        if (present.has(c.name)) continue;
        try { await db.exec(`alter table public.${q(name)} add column ${q(c.name)} ${colType(c.type)}${colDefault(c.type, c.default)}`); columnsAdded++; log.push(`added column ${name}.${c.name}`); }
        catch (e) { log.push(`COULD NOT add column ${name}.${c.name}: ${e.message}`); }
      }
    }
  }
  // Foreign keys last (every table exists by now); skip any that cannot be added.
  for (const [name, t] of Object.entries(spec)) {
    if (VIEWS.has(name)) continue;
    for (const fk of t.fks) {
      const cname = `fk_${name}_${fk.column}`.slice(0, 60);
      const exists = (await db.query("select 1 from pg_constraint where conname = $1", [cname])).rows.length > 0;
      const alreadyFk = (await db.query(`select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_attribute a on a.attrelid = r.oid and a.attnum = any(c.conkey)
        where c.contype = 'f' and r.relname = $1 and a.attname = $2`, [name, fk.column])).rows.length > 0;
      if (exists || alreadyFk) continue;
      try { await db.exec(`alter table public.${q(name)} add constraint ${q(cname)} foreign key (${q(fk.column)}) references public.${q(fk.table)} (${q(fk.refColumn)}) not valid`); }
      catch { /* the referenced table or column is not there in the demo: harmless */ }
    }
  }
  return { created, columnsAdded };
}

export async function buildDb({ onProgress = () => {}, dataDir = DATA_DIR, writeReport = true } = {}) {
  if (dataDir === DATA_DIR) {
    fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  }
  const db = openDb(dataDir);
  await db.waitReady;
  const log = [];

  for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, "localdemo/stubs.sql"), "utf8"))) await db.exec(stmt);
  // Live-update publication: the migration files add tables to it; the demo has no live updates, but the object must exist.
  await db.exec("create publication supabase_realtime").catch(() => log.push("publication supabase_realtime could not be created (its statements are skipped)"));

  const files = migrationFiles();
  let failed = [];
  let ok = 0;
  let skipped = 0;
  for (let i = 0; i < files.length; i++) {
    onProgress(`Applying migration files ${i + 1}/${files.length}`);
    for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, files[i]), "utf8"))) {
      if (SKIP.some(re => re.test(stmt))) { skipped++; continue; }
      try { await execTolerant(db, stmt); ok++; } catch (e) { failed.push({ file: files[i], stmt, error: e.message }); }
    }
  }
  onProgress("Adding the tables the migration files never created");
  const added = await completeFromStructure(db, log);

  for (let pass = 1; pass <= 8 && failed.length > 0; pass++) {
    onProgress(`Retrying ${failed.length} statements (pass ${pass})`);
    const still = [];
    for (const f of failed) {
      try { await execTolerant(db, f.stmt); ok++; } catch (e) { f.error = e.message; still.push(f); }
    }
    const progress = still.length < failed.length;
    failed = still;
    if (!progress) break;
  }

  const lines = [
    `Local demo database built ${new Date().toISOString()}`,
    `migration files: ${files.length}; statements applied: ${ok}; skipped (live-service only): ${skipped}; still failing: ${failed.length}`,
    `tables created from the structure description: ${added.created}; columns added: ${added.columnsAdded}`,
    "", "── still failing ──",
    ...failed.map(f => `${f.file}: ${f.stmt.replace(/\s+/g, " ").slice(0, 110)}\n    -> ${f.error}`),
    "", "── notes ──", ...log,
  ];
  if (writeReport) fs.writeFileSync(REPORT, lines.join("\n"));
  return { db, ok, failed, added, files };
}
