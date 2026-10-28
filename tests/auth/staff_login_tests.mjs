// tests/auth/staff_login_tests.mjs — the staff sign-in page: a stray space must not break a correct email, and the real reason for a failure is shown
//   (src/lib/staffLogin.ts, used by SignInPage in src/app/App.tsx)
// Run:  node tests/auth/staff_login_tests.mjs
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stafflogin-"));
const outfile = path.join(tmp, "staffLogin.mjs");
await build({ entryPoints: [path.join(root, "src/lib/staffLogin.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const L = await import(pathToFileURL(outfile).href);

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The username / email box");
test("a space at the start or end is removed (an email with a trailing space from autofill still works)", () => {
  assert.equal(L.cleanLoginName("juan.delacruz@cedo.gov.ph "), "juan.delacruz@cedo.gov.ph");
  assert.equal(L.cleanLoginName("  demo.evaluator\t"), "demo.evaluator");
});
test("invisible characters a keyboard can add are removed", () => {
  assert.equal(L.cleanLoginName("demo.evaluator​"), "demo.evaluator");
  assert.equal(L.cleanLoginName("﻿demo.evaluator"), "demo.evaluator");
});
test("capitals and the inside of the text are left as typed (the database ignores capitals itself)", () => {
  assert.equal(L.cleanLoginName("Demo.Evaluator"), "Demo.Evaluator");
  assert.equal(L.cleanLoginName("de mo"), "de mo");
});
test("only spaces becomes empty (so the page asks for the username again)", () => assert.equal(L.cleanLoginName("   "), ""));

console.log("\nThe message for a failed sign-in");
const msg = L.staffSignInErrorMessage;
test("a wrong password or unknown account says incorrect username or password", () => {
  assert.equal(msg({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }), "Incorrect username or password.");
  assert.equal(msg(null), "Incorrect username or password.");
  assert.equal(msg(undefined), "Incorrect username or password.");
});
test("a deactivated account says so, instead of calling the right password incorrect", () => {
  assert.match(msg({ status: 400, code: "user_banned", message: "User is banned" }), /deactivated/);
});
test("too many attempts says to wait (also from the sign-in service's own limit)", () => {
  assert.match(msg({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }), /Too many attempts/);
  assert.match(msg({ message: "Too many attempts. Please wait a few minutes and try again." }), /Too many attempts/);
});
test("an unconfirmed email says so", () => assert.match(msg({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }), /not been confirmed/));
test("a network problem or a service problem is not blamed on the password", () => {
  assert.match(msg({ status: 0, message: "Failed to fetch" }), /Couldn't reach the server/);
  assert.match(msg({ status: 503, message: "Service unavailable" }), /sign-in service is having a problem/);
});

console.log("\nThe page uses them");
test("the sign-in page cleans the name, never changes the password, and shows the matching message", () => {
  const app = fs.readFileSync(path.join(root, "src/app/App.tsx"), "utf8");
  assert.match(app, /const loginName = cleanLoginName\(username\)/);
  assert.match(app, /resolve_staff_login_email", \{ p_username: loginName \}/);
  assert.match(app, /signInWithPassword\(\{ email: resolvedEmail, password \}\)/, "the password is sent exactly as typed");
  assert.match(app, /setError\(staffSignInErrorMessage\(authError\)\)/);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
