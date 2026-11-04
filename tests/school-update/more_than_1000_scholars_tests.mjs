// tests/school-update/more_than_1000_scholars_tests.mjs — a school with more than 1000 scholars: the School Portal must read ALL of them.
// The database returns at most 1000 rows per request. A stand-in for the database that does the same is used here, so the test fails if a read does not go through every page.
// Run:  node tests/school-update/more_than_1000_scholars_tests.mjs     (no database or browser needed)
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

// the stand-in database: up to 1000 rows per request, honours .range(), .eq(), .neq() and .order()
const stub = `
export const state = { scholars: [], renewal: [], requests: 0 };
const MAX = 1000;
function make(rowsOf) {
  const f = { eq: [], neq: [], order: [], range: null };
  const api = {
    select() { return api; }, in() { return api; },
    eq(c, v) { f.eq.push([c, v]); return api; }, neq(c, v) { f.neq.push([c, v]); return api; },
    order(c) { f.order.push(c); return api; }, range(a, b) { f.range = [a, b]; return api; },
    then(resolve) {
      state.requests++;
      let rows = rowsOf().filter(r => f.eq.every(([c, v]) => r[c] === v) && f.neq.every(([c, v]) => r[c] !== v));
      rows = [...rows].sort((x, y) => { for (const c of f.order) { const d = String(x[c]).localeCompare(String(y[c])); if (d) return d; } return 0; });
      const [a, b] = f.range ?? [0, MAX - 1];
      resolve({ data: rows.slice(a, Math.min(b, a + MAX - 1) + 1), error: null });
    },
  };
  return api;
}
export const supabase = { from: (t) => make(() => state[t]), rpc: (name) => make(() => state.renewal) };
`;
const stubPath = path.join(root, ".stub_supabase.mjs");
fs.writeFileSync(stubPath, stub);
const plugin = { name: "stub", setup(b) { b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: stubPath })); } };
const entry = path.join(root, ".stub_entry.ts");
fs.writeFileSync(entry, `export * from "${path.join(root, "src/school/schoolApi.ts").split("\\").join("/")}"; export * from "${path.join(root, "src/school/renewalMonitorApi.ts").split("\\").join("/")}"; export { state } from "${stubPath.split("\\").join("/")}";`);
const out = path.join(root, ".stub_bundle.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") }, plugins: [plugin] });
const M = await import(pathToFileURL(out).href);
for (const f of [stubPath, entry, out]) fs.rmSync(f, { force: true });

const N = 2630, REMOVED = 30;
M.state.scholars = Array.from({ length: N }, (_, i) => ({
  scholar_id_number: `S-${String(i).padStart(5, "0")}`, first_name: "F" + i, last_name: "Last" + String(i % 700).padStart(3, "0"), middle_name: "", year_level: "1st Year", course: "BS Test",
  school_student_no: "", school_id: "school-1", status: i < REMOVED ? "Removed" : "Regular",
}));
M.state.scholars.push({ scholar_id_number: "OTHER-1", first_name: "x", last_name: "y", middle_name: "", year_level: "1", course: "c", school_student_no: "", school_id: "school-2", status: "Regular" });
M.state.renewal = Array.from({ length: 2400 }, (_, i) => ({ scholar_id_number: `S-${String(i).padStart(5, "0")}`, school_student_no: "", last_name: "L", first_name: "F", middle_name: "", year_level: "1st Year", program: "BS Test", scholar_status: "Regular", stage: null, is_late: false, grp: "not_applied", probation: false, grades_state: null, failed: 0, inc: 0, review: 0 }));

console.log("A school with more than 1000 scholars");
await test("the scholar list has every scholar of the school, not the first 1000", async () => {
  const rows = await M.fetchOwnScholars("school-1");
  assert.equal(rows.length, N - REMOVED);
});
await test("nobody is listed twice or skipped between pages, removed scholars are left out, and another school's scholar never appears", async () => {
  const rows = await M.fetchOwnScholars("school-1");
  const ids = rows.map(r => r.scholarIdNumber);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("OTHER-1"));
  for (let i = 0; i < REMOVED; i++) assert.ok(!ids.includes(`S-${String(i).padStart(5, "0")}`));
  for (let i = REMOVED; i < N; i++) assert.ok(ids.includes(`S-${String(i).padStart(5, "0")}`), `missing ${i}`);
});
await test("the list is in last-name order across the pages", async () => {
  const rows = await M.fetchOwnScholars("school-1");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].lastName.localeCompare(rows[i].lastName) <= 0, `row ${i}`);
});
await test("it takes three requests for 2600 scholars (pages of 1000), and a small school still takes one", async () => {
  M.state.requests = 0; await M.fetchOwnScholars("school-1"); assert.equal(M.state.requests, 3);
  const keep = M.state.scholars; M.state.scholars = keep.slice(0, 40).map(r => ({ ...r, status: "Regular" })); M.state.requests = 0;
  assert.equal((await M.fetchOwnScholars("school-1")).length, 40); assert.equal(M.state.requests, 1);
  M.state.scholars = keep;
});
await test("exactly 1000 scholars: the read asks once more and finds nothing more (no scholar lost, none repeated)", async () => {
  const keep = M.state.scholars; M.state.scholars = keep.slice(100, 1100).map(r => ({ ...r, status: "Regular" }));
  const rows = await M.fetchOwnScholars("school-1"); assert.equal(rows.length, 1000); M.state.scholars = keep;
});
await test("the Renewal tab's list also has everybody (2400 rows), not the first 1000", async () => {
  const r = await M.fetchSchoolRenewalRows("2025-2026", "Summer");
  assert.ok(r.ok); assert.equal(r.rows.length, 2400); assert.equal(new Set(r.rows.map(x => x.scholarIdNumber)).size, 2400);
});

console.log("\nThe code");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
await test("both reads go through every page (a 1000-row page that is full means 'ask for the next')", () => {
  assert.ok(/\.range\(from, from \+ PAGE - 1\)/.test(src("src/school/schoolApi.ts")) && src("src/school/schoolApi.ts").includes("if (page.length < PAGE) break;"));
  assert.ok(src("src/school/renewalMonitorApi.ts").includes(".range(from, from + PAGE - 1)") && src("src/school/renewalMonitorApi.ts").includes("page.length < PAGE"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
