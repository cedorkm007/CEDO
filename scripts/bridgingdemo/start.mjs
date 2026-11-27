// scripts/bridgingdemo/start.mjs — try /bridging on this computer with a throwaway database. Nothing here can reach the real projects.
//   node scripts/bridgingdemo/start.mjs        then open  http://127.0.0.1:5173/bridging
// Everything entered is forgotten when it stops. One approved test teacher exists: username test.teacher, password Teacher#Demo26
import { createServer } from "vite";
import { openBridgingDb, bridgingRegisterStandIn } from "./db.mjs";
import { startServer } from "../../localdemo/server.mjs";
import { ANON_KEY, hashPassword } from "../../localdemo/jwt.mjs";
import { ROOT } from "../../localdemo/build.mjs";

const API_PORT = 54321, WEB_PORT = 5173;
// the website is pointed ONLY at this computer (these beat the values in .env.local)
process.env.VITE_BRIDGING_SUPABASE_URL = `http://127.0.0.1:${API_PORT}`;
process.env.VITE_BRIDGING_SUPABASE_ANON_KEY = ANON_KEY;
process.env.VITE_BRIDGING_TURNSTILE_SITE_KEY = "";
process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${API_PORT}`;
process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;

const db = await openBridgingDb();
const teacher = (await db.query("insert into auth.users (email, encrypted_password) values ('test.teacher@bridging.cedo.local', $1) returning id", [hashPassword("Teacher#Demo26")])).rows[0].id;
const school = (await db.query("select id from bridging_schools where name = 'TEST National High School'")).rows[0].id;
await db.query("insert into bridging_profiles (user_id, role, username, last_name, first_name, middle_name, school_id, employee_id, status) values ($1, 'teacher', 'test.teacher', 'Reyes', 'Ana', 'N/A', $2, 'E-001', 'active')", [teacher, school]);
await db.query("insert into bridging_teacher_levels (teacher_id, level) select $1, unnest(array['g7','g8','g9','g10'])", [teacher]);
await db.query("insert into bridging_teacher_subjects (teacher_id, subject_key) values ($1, 'math')", [teacher]);
await db.query("insert into bridging_consents (user_id, notice_version) values ($1, 1)", [teacher]);

await startServer({ db, port: API_PORT, log: m => console.error(m), openFunctions: { "bridging-register": await bridgingRegisterStandIn(db) } });
const vite = await createServer({ root: ROOT, server: { host: "127.0.0.1", port: WEB_PORT, strictPort: true }, logLevel: "warn" });
await vite.listen();
console.log(`Bridging demo running:  http://127.0.0.1:${WEB_PORT}/bridging`);
