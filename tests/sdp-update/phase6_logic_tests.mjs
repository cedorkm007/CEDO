// tests/sdp-update/phase6_logic_tests.mjs — SDP Monitoring update, Phase 6: the shared password logic used by the server functions.
//   • the temporary-password generator (random, readable, always valid)
//   • the password rules (min 10 characters, etc.)
//   • giving an account a temporary password (marked "must choose a new password")
//   • the scholar "forgot my password" flow: every way it can go wrong, and that nothing leaks
// Run:  node tests/sdp-update/phase6_logic_tests.mjs
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "p6-logic-"));
const load = async name => {
  const outfile = path.join(outDir, name + ".mjs");
  await build({ entryPoints: [`supabase/functions/_shared/${name}.ts`], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const policy = await load("passwordPolicy"), temp = await load("temporaryPassword"), reset = await load("scholarSelfReset");

console.log("\nThe temporary-password generator");
const samples = Array.from({ length: 2000 }, () => policy.generateTemporaryPassword());
check("every temporary password looks like Kd7m-Xt4q-Wn9R: three groups of four, 14 characters in all", samples.every(p => /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(p) && p.length === 14));
check("none contains a character that is easy to mix up (0, O, 1, l, I)", samples.every(p => !/[0O1lI]/.test(p)));
check("every one has capitals, small letters and numbers", samples.every(p => /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)));
check("every one is accepted by the password rules", samples.every(p => policy.validateNewPassword(p) === null));
check("they are random: 2,000 made, no two the same, and the first character varies", new Set(samples).size === 2000 && new Set(samples.map(p => p[0])).size > 20);
// a bigger sample for the fairness check only: with 2,000 the ratio between the most and least common character can pass 1.25 by chance (about 1 run in 50)
const fairSamples = Array.from({ length: 20000 }, () => policy.generateTemporaryPassword());
const counts = {}; for (const p of fairSamples) for (const ch of p.replace(/-/g, "")) counts[ch] = (counts[ch] ?? 0) + 1;
const within = chars => { const v = chars.map(c => counts[c] ?? 0); return Math.max(...v) / Math.min(...v); };
check("within each kind (capitals, small letters, numbers) no character is much more likely than another (fair choice, no bias to the first letters)", within([..."ABCDEFGHJKLMNPQRSTUVWXYZ"]) < 1.25 && within([..."abcdefghijkmnpqrstuvwxyz"]) < 1.25 && within([..."23456789"]) < 1.25 && Object.keys(counts).length === 56);
check("a fixed random source gives a fixed answer (so the generator really uses the source it is given)", (() => { const fixed = n => new Uint8Array(n).fill(7); return policy.generateTemporaryPassword(fixed) === policy.generateTemporaryPassword(fixed); })());

console.log("\nThe password rules");
const v = (p, ctx) => policy.validateNewPassword(p, ctx);
check("at least 10 characters (9 is refused, 10 is fine)", /at least 10/.test(v("Abcdefg12") ?? "") && v("Abcdefg123") === null);
check("at most 72 characters", /at most 72/.test(v("Ab1" + "xyz".repeat(24)) ?? "") && v("Ab1" + "xyz".repeat(23)) === null);
check("a sentence with spaces is fine (letters and spaces count as two kinds)", v("correct horse battery") === null);
check("only one kind of character is refused", /two kinds/.test(v("qwmzxkhpvbnrty") ?? "") && /two kinds/.test(v("73829164058273") ?? ""));
check("the old default and other common choices are refused", /common|sequence/.test(v("1234567890") ?? "") && /common/.test(v("Password123") ?? "") && /common|few/.test(v("1234512345") ?? ""));
check("too few different characters is refused", /too few/.test(v("aaaaaaaaa1") ?? ""));
check("it cannot contain the user name, Scholar ID or name", /cannot contain/.test(v("My-demo.sead-pass-9", { avoid: ["demo.sead"] }) ?? "") && /cannot contain/.test(v("TEST-0001-secret1", { avoid: ["TEST-0001"] }) ?? "") && v("Fresh-pass-2026", { avoid: ["TEST-0001", "ab"] }) === null);
check("it must differ from the current / temporary password", /different/.test(v("Kd7m-Xt4q-Wn9R", { differentFrom: ["Kd7m-Xt4q-Wn9R"] }) ?? "") && v("Kd7m-Xt4q-Wn9R", { differentFrom: ["something else"] }) === null);
check("a space at the start or end is refused", /start or end/.test(v(" good password 9") ?? ""));

console.log("\nGiving an account a temporary password");
function fakeAdmin({ updateError = null, flagError = null } = {}) {
  const calls = { passwords: [], flags: [] };
  return {
    calls,
    auth: { admin: { async updateUserById(id, attrs) { calls.passwords.push({ id, password: attrs.password }); return { error: updateError ? { message: updateError } : null }; } } },
    rpc: async (name, args) => { calls.flags.push({ name, args }); return { error: flagError ? { message: flagError } : null }; },
  };
}
const a1 = fakeAdmin();
const issued = await temp.issueTemporaryPassword(a1, "user-1");
check("a random temporary password is set and the account is marked “must choose a new password”", issued.ok && /^[A-Za-z2-9]{4}-/.test(issued.password) && a1.calls.passwords[0].password === issued.password && a1.calls.flags[0].name === "flag_password_change" && a1.calls.flags[0].args.p_user_id === "user-1");
const a2 = fakeAdmin({ updateError: "boom" });
const bad = await temp.issueTemporaryPassword(a2, "user-2");
check("if the password could not be set, nothing is marked and no password is returned", !bad.ok && bad.error === "boom" && a2.calls.flags.length === 0 && !("password" in bad));
const a3 = fakeAdmin({ flagError: "no table" });
const warned = await temp.issueTemporaryPassword(a3, "user-3");
check("if the password was set but the marking failed, the administrator is told (with the password, so the account is not locked out)", warned.ok && /could not be marked/.test(warned.warning ?? ""));
check("two resets give two different passwords", (await temp.issueTemporaryPassword(fakeAdmin(), "u")).password !== (await temp.issueTemporaryPassword(fakeAdmin(), "u")).password);

console.log("\nThe scholar “forgot my password” flow");
function world() {
  const state = { failures: new Map(), tries: new Map(), passwords: [], logs: [], lockLimit: 5, tryLimit: 8 };
  const scholars = {
    "TEST-0001": { id: "s1", first_name: "Ana", last_name: "Reyes", security_question: "What was the name of your first pet?", answer: "whiskers" },
    "TEST-0002": { id: "s2", first_name: "Ben", last_name: "Cruz", security_question: null, answer: null },
  };
  const deps = {
    async gate(identity, ip) { const k = identity + "|" + ip; state.tries.set(k, (state.tries.get(k) ?? 0) + 1); return state.tries.get(k) > state.tryLimit ? "Too many attempts." : null; },
    async isLocked(identity) { return (state.failures.get(identity.toLowerCase()) ?? 0) >= state.lockLimit; },
    async registerFailure(identity) { const k = identity.toLowerCase(); state.failures.set(k, (state.failures.get(k) ?? 0) + 1); },
    async clearFailures(identity) { state.failures.delete(identity.toLowerCase()); },
    async findScholar(id) { const s = scholars[id]; return s ? { id: s.id, first_name: s.first_name, last_name: s.last_name, security_question: s.security_question } : null; },
    async verifyAnswer(sid, answer) { const s = Object.values(scholars).find(x => x.id === sid); return !!s && s.answer === answer.toLowerCase().trim(); },
    async setPassword(sid, password) { state.passwords.push({ sid, password }); return null; },
    async log(entry) { state.logs.push(entry); },
  };
  return { state, deps };
}
const body = (o = {}) => ({ scholarIdNumber: "TEST-0001", lastName: "Reyes", firstName: "Ana", ...o });
const shape = r => JSON.stringify({ status: r.status, keys: Object.keys(r.body).sort(), ok: r.body.ok === true, needsAnswer: !!r.body.needsAnswer });

{
  const { deps } = world();
  const real = await reset.handleScholarSelfReset(body(), "1.1.1.1", deps);
  const noSuchId = await reset.handleScholarSelfReset(body({ scholarIdNumber: "TEST-9999" }), "1.1.1.1", deps);
  const wrongName = await reset.handleScholarSelfReset(body({ lastName: "Nope" }), "1.1.1.1", deps);
  const noQuestion = await reset.handleScholarSelfReset(body({ scholarIdNumber: "TEST-0002", lastName: "Cruz", firstName: "Ben" }), "1.1.1.1", deps);
  check("step 1: a real scholar gets their own question", real.status === 200 && real.body.needsAnswer === true && real.body.question === "What was the name of your first pet?");
  check("step 1: an unknown ID, a wrong name and a scholar with no question all get the SAME kind of answer (a question from the standard list, status 200): nothing tells them apart", [noSuchId, wrongName, noQuestion].every(r => shape(r) === shape(real) && reset.SECURITY_QUESTIONS.includes(r.body.question)));
  check("step 1: the made-up question is the same each time for the same ID", (await reset.handleScholarSelfReset(body({ scholarIdNumber: "TEST-9999" }), "1.1.1.1", deps)).body.question === noSuchId.body.question);
  check("missing details are asked for (400)", (await reset.handleScholarSelfReset({ scholarIdNumber: "", lastName: "x", firstName: "y" }, "1.1.1.1", deps)).status === 400);
}
{
  const { deps, state } = world();
  const ok = await reset.handleScholarSelfReset(body({ securityAnswer: " Whiskers ", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  check("the right answer + a good new password saves the scholar's OWN password, and says only that it worked (never any password)", ok.status === 200 && ok.body.reset === true && !("newPassword" in ok.body) && !("password" in ok.body) && state.passwords.length === 1 && state.passwords[0].password === "My-own-new-Pass-77" && state.passwords[0].sid === "s1");
  check("it is written to the account history without any password in it", state.logs.length === 1 && state.logs[0].scholarIdNumber === "TEST-0001" && !JSON.stringify(state.logs).includes("My-own-new-Pass"));
}
{
  const { deps, state } = world();
  const weak = await reset.handleScholarSelfReset(body({ securityAnswer: "whiskers", newPassword: "123456" }), "1.1.1.1", deps);
  check("a weak new password is refused with the reason, and nothing is changed", weak.status === 400 && /at least 10/.test(weak.body.error) && state.passwords.length === 0);
  const inName = await reset.handleScholarSelfReset(body({ securityAnswer: "whiskers", newPassword: "TEST-0001-pass-9" }), "1.1.1.1", deps);
  check("a password containing the Scholar ID is refused", inName.status === 400 && /cannot contain/.test(inName.body.error) && state.passwords.length === 0);
}
{
  const { deps, state } = world();
  const wrongAnswer = await reset.handleScholarSelfReset(body({ securityAnswer: "rex", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  const noSuchId = await reset.handleScholarSelfReset(body({ scholarIdNumber: "TEST-9999", securityAnswer: "rex", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  const noQuestion = await reset.handleScholarSelfReset(body({ scholarIdNumber: "TEST-0002", lastName: "Cruz", firstName: "Ben", securityAnswer: "anything", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  check("step 2: a wrong answer, an unknown ID and a scholar with no question all fail in exactly the same way (401, the same message), and no password is changed", [wrongAnswer, noSuchId, noQuestion].every(r => r.status === 401 && r.body.error === reset.ANSWER_FAILED) && state.passwords.length === 0);
  check("…and the message tells a scholar with no question to ask the SEAD office", /SEAD office/.test(reset.ANSWER_FAILED));
  for (let i = 0; i < 3; i++) await reset.handleScholarSelfReset(body({ securityAnswer: "rex", newPassword: "My-own-new-Pass-77" }), "9.9.9." + i, deps);
  const fifth = await reset.handleScholarSelfReset(body({ securityAnswer: "rex", newPassword: "My-own-new-Pass-77" }), "9.9.9.9", deps);
  check("after 5 wrong answers for one Scholar ID (whoever types them) the answer is no longer checked", fifth.status === 401);
  const sixth = await reset.handleScholarSelfReset(body({ securityAnswer: "whiskers", newPassword: "My-own-new-Pass-77" }), "8.8.8.8", deps);
  check("the 6th try is refused as locked even with the RIGHT answer, and nothing is changed", sixth.status === 429 && sixth.body.error === reset.LOCKED_OUT && state.passwords.length === 0);
}
{
  const { deps, state } = world();
  await reset.handleScholarSelfReset(body({ securityAnswer: "rex", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  const good = await reset.handleScholarSelfReset(body({ securityAnswer: "whiskers", newPassword: "My-own-new-Pass-77" }), "1.1.1.1", deps);
  check("a correct answer clears the wrong-answer count", good.status === 200 && (state.failures.get("test-0001") ?? 0) === 0);
}
{
  const { deps, state } = world();
  let last = null;
  for (let i = 0; i < 9; i++) last = await reset.handleScholarSelfReset(body(), "5.5.5.5", deps);
  check("too many tries from one address for one ID are stopped (429) and say what to do", last.status === 429 && /Too many attempts/.test(last.body.error) && state.passwords.length === 0);
}
check("the list of standard questions is the same as the one on the website", (() => {
  const site = fs.readFileSync("src/scholar/scholarApi.ts", "utf8");
  const block = site.slice(site.indexOf("export const SECURITY_QUESTIONS = ["), site.indexOf("];", site.indexOf("export const SECURITY_QUESTIONS = [")));
  return reset.SECURITY_QUESTIONS.every(q => block.includes(JSON.stringify(q))) && (block.match(/"[^"]+",/g) ?? []).length === reset.SECURITY_QUESTIONS.length;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
