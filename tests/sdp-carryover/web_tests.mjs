// tests/sdp-carryover/web_tests.mjs — credits lacking last semester (an approved SDP reconsideration) show as NEGATIVE credits in the new semester
// Run:  node tests/sdp-carryover/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdpco-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const R = await bundle("renewal", "src/lib/renewal.ts");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The numbers");
test("what is owed is what the requirement is above 3", () => {
  assert.equal(R.sdpOwedFrom(3), 0); assert.equal(R.sdpOwedFrom(5), 2); assert.equal(R.sdpOwedFrom(undefined), 0); assert.equal(R.sdpOwedFrom(null), 0); assert.equal(R.sdpOwedFrom(2), 0, "never negative");
});
test("a category lacked last semester starts negative: lacking 2, nothing earned yet shows -2", () => assert.equal(R.sdpShownCredits(0, 5), -2));
test("credits earned bring it back up; it is complete at 3 shown, exactly when earned reaches 3 + owed", () => {
  assert.equal(R.sdpShownCredits(1, 5), -1); assert.equal(R.sdpShownCredits(3, 5), 1); assert.equal(R.sdpShownCredits(5, 5), 3);
  for (let earned = 0; earned <= 8; earned++) for (const owed of [0, 1, 2, 3]) assert.equal(R.sdpShownCredits(earned, 3 + owed) >= 3, earned >= 3 + owed, `earned ${earned}, owed ${owed}`);
});
test("a scholar who owes nothing sees the same numbers as before", () => { for (const n of [0, 1, 3, 6]) assert.equal(R.sdpShownCredits(n, 3), n); assert.equal(R.sdpShownCredits(4, undefined), 4); });

console.log("The screens");
test("the scholar's SDP tab shows the credits less what is owed, against 3, and the bar never goes below empty", () => {
  const s = src("src/scholar/components/dashboard/SDPPanel.tsx");
  assert.ok(s.includes("sdpShownCredits(credits[c.key] ?? 0, required[c.key])") && s.includes("const need = CREDITS_REQUIRED;"));
  assert.ok(s.includes("Math.max(0, Math.min(100, (count / need) * 100))"));
  assert.ok(/negative credits/.test(s));
});
test("the SDP Monitoring checklist shows credits less what is owed against 3", () => { const s = src("src/sead/pages/SDPMonitoringTab.tsx"); assert.ok(s.includes("const shown = credits - owed;") && s.includes("{shown} / {goal}")); });
test("the SDP credits window of the Scholar List, the application page and the scholar's renewal tile show the same", () => {
  const l = src("src/sead/renewal/RenewalScholarListTab.tsx");
  assert.ok(l.includes("(n ?? 0) - owedOf(k)") && l.includes("negative credits"));
  assert.ok(src("src/sead/renewal/RenewalDetailView.tsx").includes("sdpShownCredits(ev.sdp.community_service, ev.sdp.required?.community_service)"));
  assert.ok(src("src/scholar/components/dashboard/RenewalPanel.tsx").includes("sdpShownCredits(sdp.community_service, sdp.required?.community_service)}/3"));
});
test("the words no longer say the lacking credits are added to the requirement", () => {
  for (const f of ["src/lib/renewal.ts", "src/scholar/components/dashboard/RenewalPanel.tsx", "src/sead/renewal/RenewalSdpReconsiderationTab.tsx"]) assert.equal(/added to (your|their|the|my) SDP requirement/.test(src(f)), false, f);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
