// tests/renewal-tagged/web_tests.mjs — Scholar tagging screens: the ID box, who sees what, the tag it.admin1 hands out (5 checks, short on purpose)
// Run:  node tests/renewal-tagged/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rtag-"));
const bundle = async (rel, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } }); return import(pathToFileURL(outfile).href); };
const T = await bundle("src/lib/renewalTagging.ts", "t.mjs"), A = await bundle("src/lib/renewalAccess.ts", "a.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

await test("1 the ID box: one or many IDs, any separator, a column pasted from Excel, Word dashes, quotes; each ID once", () => {
  assert.deepEqual(T.parseScholarIds("2506-00177"), ["2506-00177"]);
  assert.deepEqual(T.parseScholarIds('2506-00177\n"2306–00092", 2310\u201400057;\t2506-00177 2306-00092\r\n\n'), ["2506-00177", "2306-00092", "2310-00057"]);
  assert.deepEqual(T.parseScholarIds("  \n ,; "), []);
});
await test("2 the sentence after tagging says what happened in plain words", () => {
  assert.equal(T.tagResultText({ tagged: 3, already: 1, notFound: ["X"], skipped: ["A (Removed)", "B (On leave)"] }), "3 scholars tagged · 1 already tagged · 1 ID not found · 2 skipped (Removed or On leave).");
  assert.equal(T.tagResultText({ tagged: 1, already: 0, notFound: [], skipped: [] }), "1 scholar tagged.");
});
await test("3 who tags: it.admin1 and an account with the tag renewal_scholar_tagger; nobody else (not even the evaluator); a tagger sees the renewal tool", () => {
  const u = (tags, username = "x") => ({ tags, role: "staff", division: "SEAD", username });
  assert.equal(A.canTagRenewedScholars(u([], "it.admin1")), true);
  assert.equal(A.canTagRenewedScholars(u(["renewal_scholar_tagger"])), true);
  assert.equal(A.canTagRenewedScholars(u(["scholar_renewal_evaluator"])), false);
  assert.equal(A.canSeeScholarRenewal(u(["renewal_scholar_tagger"])), true);
  assert.equal(A.canSeeScholarRenewal(u([])), false);
});
await test("4 the tag is in the list it.admin1 hands out, and a tagged account sees ONLY the Scholar tagging tab (it opens on it; the evaluator reads it)", () => {
  assert.ok(src("src/app/staffToolTags.ts").includes('key: "renewal_scholar_tagger"'));
  const page = src("src/sead/ScholarRenewalPage.tsx");
  assert.ok(page.includes('t.key === "tagging" ? (isEvaluator || isTagger)') && page.includes('isDocumentsApprover ? "documents" : isTagger ? "tagging"'));
  assert.ok(!/seesRenewals && .*tagging/.test(page) && page.includes('canManage={isTagger}'));
  assert.ok(src("src/app/App.tsx").includes("isTagger={canTagRenewedScholars(currentUser)}"));
});
await test("5 the tab calls only the tagging functions (the database decides who may); removing a tag asks first; the list can be searched and paged", () => {
  const tab = src("src/sead/renewal/RenewalTaggingTab.tsx"), api = src("src/sead/renewalTaggingApi.ts");
  for (const f of ["renewal_tag_scholars", "renewal_untag_scholars", "renewal_tagged_list", "renewal_tag_terms"]) assert.ok(api.includes(`"${f}"`), f);
  assert.ok(tab.includes("Remove the tag?") && tab.includes("Search tagged scholars") && tab.includes("<ListPagination"));
  assert.equal(/\.from\("renewal_tagged_scholars"\)/.test(tab + api), false);
});
console.log(`\n${passed} passed`);
