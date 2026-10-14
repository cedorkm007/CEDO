// scripts/localdemo/start.mjs — starts the LOCAL DEMO: a private database with hypothetical TEST data, a local stand-in for Supabase,
// and the real website pointed at it. Nothing here can reach the real project.
//
//   npm run demo          start (builds the private database the first time, ~30 seconds)
//   npm run demo:reset    throw away everything entered during testing and start again from the original TEST data
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { buildDb, openDb, DATA_DIR, ROOT } from "../../localdemo/build.mjs";
import { seedDb, ACCOUNTS } from "../../localdemo/seed.mjs";
import { startServer } from "../../localdemo/server.mjs";
import { ANON_KEY } from "../../localdemo/jwt.mjs";

const API_PORT = 54321;
const WEB_PORT = 5173;
const reset = process.argv.includes("--reset");

// ── Safety: the website is pointed ONLY at this computer; refuse to run otherwise ──
const API_URL = `http://127.0.0.1:${API_PORT}`;
process.env.VITE_SUPABASE_URL = API_URL;
process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;      // process variables beat the values in .env.local, which points at the real project
function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) { console.error(`REFUSING TO START: the website would talk to ${host}, which is not this computer.`); process.exit(1); }
}
assertLocal(process.env.VITE_SUPABASE_URL);

const t0 = Date.now();
let db;
if (reset || !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
  console.log(reset ? "Starting again from the original TEST data…" : "First start: building the private database from the project's SQL files (about 30 seconds)…");
  ({ db } = await buildDb({ onProgress: m => process.stdout.write(`\r  ${m}                    `) }));
  process.stdout.write("\r  Loading the TEST data…                                   \n");
  await seedDb(db);
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(0)} seconds.`);
} else {
  db = openDb(); await db.waitReady;
}

const api = await startServer({ db, port: API_PORT, log: m => console.error(m) });
const vite = await createServer({ root: ROOT, server: { host: "127.0.0.1", port: WEB_PORT, strictPort: true }, logLevel: "warn" });
await vite.listen();

const web = `http://127.0.0.1:${WEB_PORT}`;
console.log(`
══════════════════════════════════════════════════════════════
 LOCAL DEMO IS RUNNING — nothing here touches the real project
══════════════════════════════════════════════════════════════
 Staff portal:    ${web}/
 School portal:   ${web}/school
 Scholar portal:  ${web}/CEDO
 Every demo login uses the same throwaway password: ${ACCOUNTS.password}

 Staff:   ${ACCOUNTS.staff.map(a => a.login).join(", ")}
 Schools: ${ACCOUNTS.schools.map(a => a.login).join(", ")}
 Scholars sign in with their ID: TEST-0001 … TEST-0045 (Scholar portal)

 Stop with Ctrl+C. Your test changes are kept until you run  npm run demo:reset
`);

const stop = async () => { try { await vite.close(); await api.close(); await db.close(); } finally { process.exit(0); } };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
