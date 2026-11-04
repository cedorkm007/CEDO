// tests/school-update/scholars_pagination_tests.mjs — the School Portal's scholar lists show 50 scholars to a page.
// Run:  node tests/school-update/scholars_pagination_tests.mjs     (no database or browser needed)
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");

const out = path.join(root, ".pagination_tmp.mjs");
await build({ entryPoints: [path.join(root, "src/school/portalLogic.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const P = await import(pathToFileURL(out).href); fs.rmSync(out);

console.log("Which part of the list a page shows");
test("50 to a page", () => assert.equal(P.SCHOLARS_PAGE_SIZE, 50));
test("a short list is one page showing everybody; an empty list is one page showing nobody", () => {
  assert.deepEqual(P.pageWindow(0, 1), { page: 1, pages: 1, start: 0, end: 0 });
  assert.deepEqual(P.pageWindow(37, 1), { page: 1, pages: 1, start: 0, end: 37 });
  assert.deepEqual(P.pageWindow(50, 1), { page: 1, pages: 1, start: 0, end: 50 });
});
test("51 scholars are two pages: 50, then 1", () => {
  assert.deepEqual(P.pageWindow(51, 1), { page: 1, pages: 2, start: 0, end: 50 });
  assert.deepEqual(P.pageWindow(51, 2), { page: 2, pages: 2, start: 50, end: 51 });
});
test("2600 scholars are 52 pages, and the last page is full", () => {
  assert.equal(P.pageWindow(2600, 1).pages, 52);
  assert.deepEqual(P.pageWindow(2600, 52), { page: 52, pages: 52, start: 2550, end: 2600 });
  assert.deepEqual(P.pageWindow(2630, 53), { page: 53, pages: 53, start: 2600, end: 2630 });
});
test("every scholar is on exactly one page, in order", () => {
  const all = Array.from({ length: 237 }, (_, i) => i); const seen = [];
  for (let p = 1; p <= P.pageWindow(237, 1).pages; p++) { const w = P.pageWindow(237, p); seen.push(...all.slice(w.start, w.end)); }
  assert.deepEqual(seen, all);
});
test("a page that no longer exists (the list got shorter) moves to the last page; nonsense pages move to page 1", () => {
  assert.equal(P.pageWindow(120, 9).page, 3); assert.equal(P.pageWindow(120, 0).page, 1); assert.equal(P.pageWindow(120, -4).page, 1); assert.equal(P.pageWindow(120, Number.NaN).page, 1);
});

console.log("\nThe screens");
const table = src("src/school/components/ScholarsTable.tsx"), panel = src("src/school/components/ScholarsDrilldownPanel.tsx");
test("the table shows only the page's scholars, with Previous / Next, 'Showing a–b of n' and (for long lists) a page chooser", () => {
  assert.ok(table.includes("const shown = rows.slice(win.start, win.end)") && table.includes("{shown.map("));
  assert.ok(table.includes("Showing {win.start + 1}–{win.end} of {rows.length} scholars") && table.includes(">Previous</button>") && table.includes(">Next</button>") && table.includes('aria-label="Go to page"'));
});
test("the controls only appear when there is more than one page", () => assert.ok(table.includes("rows.length > SCHOLARS_PAGE_SIZE")));
test("the list starts again at page 1 when the search, a filter or the program changes, but a re-read of the same list keeps the page", () => {
  assert.ok(table.includes("useEffect(() => { setPage(1); }, [resetKey]);"));
  for (const k of ["search:", "table:", "drill:"]) assert.ok(panel.includes(`resetKey={\`${k}`), k);
});
test("all three lists use it: the search results, the Table view and the year level / program drill-down", () => assert.equal((panel.match(/<ScholarsTable /g) ?? []).length, 3));
test("moving to another page scrolls back to the top of the list", () => assert.ok(table.includes("top.current?.scrollIntoView")));

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
