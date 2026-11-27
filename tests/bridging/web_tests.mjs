// tests/bridging/web_tests.mjs — Bridging Phase 1 screens' rules and setup (4 checks, short on purpose)
// Run:  node tests/bridging/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridging-"));
const outfile = path.join(tmp, "logic.mjs");
await build({ entryPoints: [path.join(root, "src/bridging/logic.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const L = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("levels follow the school; usernames and passwords are checked (students 8, teachers 10)", () => {
  assert.deepEqual(L.levelsFor({ jhs: false, shs: true, college: false, als: true }).map(l => l.key), ["g11", "g12", "als_jhs", "als_shs"]);
  assert.equal(L.levelsFor(null).length, 13);
  assert.equal(L.accountEmail("  Juan.Cruz "), "juan.cruz@bridging.cedo.local");
  assert.equal(L.usernameProblem("juan.cruz"), "");
  assert.ok(L.usernameProblem("ju") && L.usernameProblem("juan cruz") && L.usernameProblem("juan@x.com"));
  assert.equal(L.passwordProblem("Matahum#1", "student"), "");
  assert.ok(L.passwordProblem("Matahum#1", "teacher") && L.passwordProblem("12345678", "student") && L.passwordProblem("aaaaaaaa", "student") && L.passwordProblem("juan.cruz", "student", "juan.cruz"));
});

test("consent and the form say what is missing; only what each role needs is sent", () => {
  const c = { agreed: true, under18: true, guardianName: "", guardianAgreed: false };
  assert.match(L.consentProblem(c, "student", "guardian"), /guardian/);
  assert.equal(L.consentProblem(c, "student", "notice"), "");
  assert.equal(L.consentProblem({ ...c, under18: null }, "teacher", "guardian"), "");
  assert.match(L.consentProblem({ ...c, agreed: false, under18: false }, "student", "guardian"), /agree/);
  const f = { ...L.emptyForm, lastName: "Cruz", firstName: "Juan", middleName: "N/A", schoolId: "s", level: "g7", username: "juan.cruz", password: "Matahum#1", confirm: "Matahum#1" };
  assert.equal(L.registerProblem(f, "student"), "");
  assert.match(L.registerProblem({ ...f, teacher: { kind: "no_account", name: " " } }, "student"), /teacher/);
  assert.match(L.registerProblem(f, "teacher"), /levels/);
  const sent = L.registerPayload({ ...f, teacher: { kind: "no_account", name: " Mr. Santos " }, employeeId: "X" }, "student", { ...c, under18: false }, 1, false);
  assert.deepEqual([sent.teacher, sent.employeeId, sent.consent.guardianName, sent.password, sent.username], [{ name: "Mr. Santos" }, "", "", undefined, undefined]);
  assert.equal(L.teacherPayload({ kind: "none" }), null);
});

test("blanks in the privacy notice are never left empty", () => {
  const empty = L.fillNotice("Keep: {retention}. DPO: {dpo_name} {dpo_email}", { dpoName: "", dpoEmail: "", retention: "", under18Mode: "guardian" }, "en");
  assert.ok(!/[{}]/.test(empty) && /to be announced by CEDO/.test(empty));
  assert.equal(L.fillNotice("{dpo_name} {dpo_email}", { dpoName: "A. Cruz", dpoEmail: "dpo@example.gov.ph", retention: "", under18Mode: "guardian" }, "ceb"), "A. Cruz — dpo@example.gov.ph");
});

test("/bridging has its own page and database settings, loads nothing from the other portals, and the other portals load nothing of it", () => {
  const rewrites = JSON.parse(src("vercel.json")).rewrites.map(r => r.source);
  assert.ok(rewrites.indexOf("/bridging") >= 0 && rewrites.indexOf("/bridging/:path*") >= 0 && rewrites.indexOf("/bridging/:path*") < rewrites.indexOf("/(.*)"));
  assert.match(src("vite.config.ts"), /bridging: path\.resolve\(__dirname, 'bridging\.html'\)/);
  assert.match(src("bridging.html"), /src="\/src\/bridging\/main\.tsx"/);
  const files = fs.readdirSync(path.join(root, "src/bridging"), { recursive: true }).filter(f => /\.tsx?$/.test(f));
  for (const f of files) assert.doesNotMatch(src(`src/bridging/${f}`), /from ["'](@\/|\.\.\/\.\.\/|@\/lib\/supabase)/, f);
  assert.doesNotMatch(src("src/bridging/api.ts"), /VITE_SUPABASE_/);
  assert.match(src("src/bridging/api.ts"), /storageKey: "bridging-auth"/);
  assert.doesNotMatch(src("src/main.tsx"), /bridging/i);
});

console.log(`${passed} passed`);
