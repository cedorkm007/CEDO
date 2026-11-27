// scripts/bridgingdemo/db.mjs — a private, in-memory stand-in for the NEW Bridging Supabase project (for tests and the local demo).
// It has the parts of Supabase the Bridging SQL relies on, then runs the same setup files you run on the real project.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { splitSql } from "../../localdemo/sqlsplit.mjs";
import { ROOT } from "../../localdemo/build.mjs";
import { hashPassword } from "../../localdemo/jwt.mjs";
import { build } from "esbuild";
import os from "node:os";
import { pathToFileURL } from "node:url";

/** The server function "bridging-register" running against the private database: the same steps (supabase/functions/_shared/bridgingRegister.ts). */
export async function bridgingRegisterStandIn(db, { turnstile = null } = {}) {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridging-fn-")), "register.mjs");
  await build({ entryPoints: [path.join(ROOT, "supabase/functions/_shared/bridgingRegister.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
  const { handleBridgingRegister } = await import(pathToFileURL(outfile).href);
  const asService = (sql, params) => db.transaction(async tx => { await tx.exec("set local role service_role"); return (await tx.query(sql, params)).rows; });
  const deps = {
    isBridgingDatabase: async () => (await db.query("select to_regprocedure('public.bridging_register(uuid,jsonb)') is not null ok")).rows[0].ok,
    allowAttempt: async (ip, perHour, perDay) => (await asService("select bridging_rate_limit('register', $1, $2, $3) ok", [ip, perHour, perDay]))[0].ok,
    turnstile,
    createUser: async (email, password) => {
      try { return (await db.query("insert into auth.users (email, encrypted_password) values ($1, $2) returning id", [email, hashPassword(password)])).rows[0]; }
      catch (e) { return { error: /duplicate|unique/i.test(e.message) ? "User already registered" : e.message }; }
    },
    register: async (userId, details) => {
      try { return { duplicate: (await asService("select bridging_register($1, $2::jsonb) r", [userId, JSON.stringify(details)]))[0].r.duplicate === true }; }
      catch (e) { return { error: e.message }; }
    },
    deleteUser: async userId => { await db.query("delete from auth.users where id = $1", [userId]); },
  };
  return (body, ip) => handleBridgingRegister(body, ip, deps);
}

export async function openBridgingDb({ install = true } = {}) {
  const db = new PGlite("memory://", { extensions: { pg_trgm, pgcrypto } });
  await db.waitReady;
  for (const stmt of splitSql(fs.readFileSync(path.join(ROOT, "localdemo/stubs.sql"), "utf8"))) await db.exec(stmt);
  if (install) for (const file of ["bridging_phase1_setup.sql", "bridging_phase1_test_schools.sql"]) await db.exec(fs.readFileSync(path.join(ROOT, "bridging_sql", file), "utf8"));
  return db;
}
