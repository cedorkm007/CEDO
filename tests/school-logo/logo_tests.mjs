// tests/school-logo/logo_tests.mjs — the school's own logo: the database functions (supabase_migration_school_logo.sql), the picture helpers, the School Portal screens, and the clearance header.
// Run:  node tests/school-logo/logo_tests.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { createRequire } from "node:module";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const { PDFDocument } = require("pdf-lib");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const count = (s, re) => (s.match(re) ?? []).length;
const wellFormed = xml => { const errors = []; new DOMParser({ onError: (l, m) => errors.push(`${l} ${m}`) }).parseFromString(xml, "text/xml"); return errors; };

const bundleOf = async (entry, name) => {
  const out = path.join(root, `.logo_tmp_${name}.mjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") }, external: ["pizzip", "pdf-lib"] });
  const mod = await import(pathToFileURL(out).href); fs.rmSync(out); return mod;
};
const L = await bundleOf("src/lib/logoImage.ts", "img");
const C = await bundleOf("src/lib/clearanceForm.ts", "clr");

const template = fs.readFileSync(path.join(root, "src/assets/ClearanceTemplate.docx"));
const png = new Uint8Array(new PizZip(template).file("word/media/image1.png").asUint8Array());        // a real PNG to stand in for a logo (the template's own footer picture, wide)
const squarePng = (() => {                                                                       // a 2x2 PNG
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7p0cUAAAAASUVORK5CYII=";
  return Uint8Array.from(Buffer.from(b64, "base64"));
})();
const person = n => C.clearanceEntryFor({ firstName: "Juan", middleName: "", lastName: `Cruz ${n}`, contactNo: "0917", schoolName: "Xavier University", gwaText: "2.57", program: "BSIT", yearLevel: "3rd Year", semester: "1st Semester 2025-2026", scholarIdNumber: `2409-0000${n}` });
const docx = (entries, logo) => new PizZip(C.buildClearanceDocx(template, entries, logo));

console.log("The picture helpers");
await test("only PNG, JPG and WebP up to 5 MB are accepted, with a plain message otherwise", () => {
  assert.equal(L.logoFileProblem({ type: "image/png", size: 1000 }), null);
  assert.equal(L.logoFileProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(L.logoFileProblem({ type: "image/webp", size: 1000 }), null);
  assert.equal(L.logoFileProblem({ type: "application/pdf", size: 1000 }), "Choose a PNG, JPG or WebP picture.");
  assert.match(L.logoFileProblem({ type: "image/png", size: 6 * 1024 * 1024 }), /too big/);
  assert.match(L.logoFileProblem({ type: "image/png", size: 0 }), /empty/);
});
await test("a PNG's size is read from its header; anything else is refused", () => {
  assert.deepEqual(L.pngSize(squarePng), { width: 2, height: 2 });
  assert.ok(L.pngSize(png).width > L.pngSize(png).height);
  assert.equal(L.pngSize(new Uint8Array([1, 2, 3])), null);
  assert.equal(L.pngSize(new TextEncoder().encode("GIF89a................................")), null);
});
await test("a picture fits its square box without being stretched, wide or tall", () => {
  assert.deepEqual(L.fitInBox(100, 100, 50), { width: 50, height: 50 });
  assert.deepEqual(L.fitInBox(200, 100, 50), { width: 50, height: 25 });
  assert.deepEqual(L.fitInBox(100, 400, 50), { width: 12.5, height: 50 });
  assert.deepEqual(L.fitInBox(0, 0, 50), { width: 50, height: 50 });
});
await test("base64 turns back into the same bytes", () => assert.deepEqual(L.base64ToBytes(Buffer.from(squarePng).toString("base64")), squarePng));

console.log("\nThe clearance header");
await test("with a logo, every form has the school's picture next to the CEDO banner, placed in the office's own box; the file stays valid", () => {
  const z = docx([person(1), person(2), person(3)], { bytes: png });
  const x = z.file("word/document.xml").asText();
  assert.equal(count(x, /name="school-logo\.png"/g) / 2, 3);                       // docPr + cNvPr per picture
  assert.equal(count(x, /r:embed="rIdClLogo"/g), 3);
  assert.ok(z.file("word/media/school-logo.png") && z.file("word/_rels/document.xml.rels").asText().includes('Id="rIdClLogo"'));
  assert.equal(x.includes("{logo}"), false);
  const ids = [...x.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => m[1]);
  assert.equal(ids.length, 9); assert.equal(new Set(ids).size, 9);                 // banner + logo + footer, three forms, all numbered differently
  assert.deepEqual(wellFormed(x), []);
  const ext = x.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/><wp:effectExtent b="0" l="0" r="0" t="0"\/><wp:wrapNone\/><wp:docPr id="\d+" name="school-logo/);
  assert.ok(Number(ext[1]) <= 619125 && Number(ext[2]) <= 619125 && (Number(ext[1]) === 619125 || Number(ext[2]) === 619125));
});
await test("a square logo keeps its shape in the box", () => {
  const x = docx([person(1)], { bytes: squarePng }).file("word/document.xml").asText();
  const ext = x.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/><wp:effectExtent b="0" l="0" r="0" t="0"\/><wp:wrapNone\/><wp:docPr id="\d+" name="school-logo/);
  assert.equal(ext[1], ext[2]);
});
await test("a school with no logo gets the form without the spot (no leftover text, no picture)", () => {
  for (const logo of [undefined, null]) {
    const z = docx([person(1)], logo); const x = z.file("word/document.xml").asText();
    assert.equal(x.includes("{logo}"), false); assert.equal(x.includes("school-logo"), false); assert.equal(z.file("word/media/school-logo.png"), null);
    assert.deepEqual(wellFormed(x), []);
  }
});
await test("a logo that is not a PNG is refused instead of making a broken file", async () => {
  assert.throws(() => C.buildClearanceDocx(template, [person(1)], { bytes: new Uint8Array([1, 2, 3, 4]) }), /not a PNG/);
  await assert.rejects(() => C.buildClearancePdf(template, [person(1)], { bytes: new Uint8Array([1, 2, 3, 4]) }), /not a PNG/);
});
await test("the PDF takes the logo too (still two to a page)", async () => {
  const withLogo = await C.buildClearancePdf(template, [person(1), person(2), person(3)], { bytes: png });
  const without = await C.buildClearancePdf(template, [person(1), person(2), person(3)]);
  assert.equal((await PDFDocument.load(withLogo)).getPageCount(), 2);
  assert.ok(withLogo.length > without.length);
});
await test("the template has the spot for the logo and no picture of another school", () => {
  const z = new PizZip(template);
  assert.ok(z.file("word/document.xml").asText().includes("{logo}"));
  assert.equal(z.file("word/media/image2.png"), null);
});

console.log("\nThe School Portal");
const page = src("src/school/pages/SchoolPortalPage.tsx"), logoUi = src("src/school/components/SchoolLogo.tsx"), menu = src("src/school/components/SchoolAccountMenu.tsx"), dl = src("src/school/clearanceDownload.ts"), api = src("src/school/logoApi.ts");
await test("the logo is the profile picture in the header, and can be changed from the picture itself or from the Account menu", () => {
  assert.ok(page.includes("<SchoolLogoAvatar base64={logo.base64} size={56} onClick={() => setLogoOpen(true)} />") && page.includes("onOpenLogo={() => setLogoOpen(true)}") && page.includes("<SchoolLogoDialog"));
  assert.ok(menu.includes("School logo") && menu.includes("onOpenLogo"));
});
await test("the dialog says what the logo is for, uploads / changes / removes it, and tells a school whose database update is missing", () => {
  for (const s of ["profile picture", "clearances", "Upload logo", "Change logo", "Remove logo", "supabase_migration_school_logo.sql", "The picture is shrunk before it is saved"]) assert.ok(logoUi.includes(s), s);
  assert.ok(logoUi.includes("logoFileProblem(file)") && logoUi.includes("prepareLogo(file)"));
});
await test("the clearance download reads the school's logo and still works when there is none", () => {
  assert.ok(dl.includes("fetchSchoolLogo()") && dl.includes("buildClearanceDocx(template, loaded.entries, logo)") && dl.includes("buildClearancePdf(template, loaded.entries, logo)"));
  assert.ok(dl.includes("r.ok && r.base64 ?"));
});
await test("the website talks to the database through three functions only", () => {
  assert.deepEqual([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]).sort(), ["school_get_logo", "school_remove_logo", "school_set_logo"]);
});

console.log("\nThe database");
const FILES = { sql: "supabase_migration_school_logo.sql", undo: "undo_school_logo.sql" };
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid ?? "", JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "authenticated" })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const school = async like => (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like $1", [like]))[0];
const lower = await school("%Lower-Is-Better%"), higher = await school("%Higher-Is-Better%");
const SEAD = seedId("staff:demo.sead"), SCHOLAR = seedId("scholar:1");
const B64 = Buffer.from(png).toString("base64");

await db.exec(read(FILES.undo)).catch(() => {});             // the harness may have applied the file already: start from before it
await test("before the file: no table and no functions", async () => assert.equal((await q("select to_regclass('public.school_logos') is null a, to_regprocedure('public.school_get_logo()') is null b"))[0].a, true));
const before = JSON.stringify({ s: await q("select id, name from schools order by id"), g: (await q("select count(*)::int n from scholar_subjects_grades"))[0] });
await db.exec(read(FILES.sql)); await db.exec(read(FILES.sql));
await test("the file only adds: schools and grades are as they were, and running it twice is fine", async () => assert.equal(JSON.stringify({ s: await q("select id, name from schools order by id"), g: (await q("select count(*)::int n from scholar_subjects_grades"))[0] }), before));
await test("a school with no logo gets nothing back", async () => { const r = await attempt(lower.uid, "select public.school_get_logo() l"); assert.ok(r.ok && r.rows[0].l === null, r.msg); });
await test("a school saves its logo and reads it back exactly", async () => {
  const s = await attempt(lower.uid, "select public.school_set_logo($1) t", [B64]); assert.ok(s.ok, s.msg);
  const g = await attempt(lower.uid, "select public.school_get_logo() l"); assert.equal(g.rows[0].l, B64);
});
await test("another school never sees it and has its own", async () => {
  assert.equal((await attempt(higher.uid, "select public.school_get_logo() l")).rows[0].l, null);
  assert.ok((await attempt(higher.uid, "select public.school_set_logo($1) t", ["iVBORw0KGgo" + "B".repeat(150)])).ok);
  assert.equal((await attempt(lower.uid, "select public.school_get_logo() l")).rows[0].l, B64);                       // saving for one school does not touch the other
  assert.equal((await q("select count(*)::int n from school_logos"))[0].n, 2);
  assert.ok((await attempt(higher.uid, "select public.school_remove_logo()")).ok);
});
await test("saving again replaces it (one logo per school)", async () => {
  const other = "iVBORw0KGgo" + "A".repeat(150);
  assert.ok((await attempt(lower.uid, "select public.school_set_logo($1) t", [other])).ok);
  assert.equal((await q("select count(*)::int n from school_logos where school_id = $1", [lower.school_id]))[0].n, 1);
});
await test("a bad picture is refused with a plain message: empty, too big, not text-encoded, not a PNG", async () => {
  assert.match((await attempt(lower.uid, "select public.school_set_logo('')")).msg, /empty/);
  assert.match((await attempt(lower.uid, "select public.school_set_logo($1)", ["A".repeat(700001)])).msg, /too big/);
  assert.match((await attempt(lower.uid, "select public.school_set_logo($1)", ["iVBORw0KGgo" + "!".repeat(200)])).msg, /not a valid picture/);
  assert.match((await attempt(lower.uid, "select public.school_set_logo($1)", ["/9j/4AAQSkZJRgABAQEASABIAAD".padEnd(200, "A")])).msg, /must be a PNG/);
});
await test("nobody but a school account can read, change or remove a logo (staff, a scholar, a visitor)", async () => {
  for (const who of [SEAD, SCHOLAR, null]) for (const sql of ["select public.school_get_logo()", `select public.school_set_logo('${B64}')`, "select public.school_remove_logo()"]) assert.equal((await attempt(who, sql)).ok, false, `${who} ${sql.slice(0, 30)}`);
});
await test("the table itself cannot be reached from the website", async () => {
  for (const sql of ["select * from public.school_logos", "insert into public.school_logos (school_id, image_base64) values (gen_random_uuid(), 'x')", "delete from public.school_logos"]) assert.equal((await attempt(lower.uid, sql)).ok, false, sql);
});
await test("a school removes its logo", async () => {
  assert.ok((await attempt(lower.uid, "select public.school_remove_logo()")).ok);
  assert.equal((await attempt(lower.uid, "select public.school_get_logo() l")).rows[0].l, null);
});
await test("the undo removes the table and the functions, and nothing else", async () => {
  await db.exec(read(FILES.undo)); await db.exec(read(FILES.undo));
  assert.equal((await q("select to_regclass('public.school_logos') is null a, to_regprocedure('public.school_get_logo()') is null b, to_regprocedure('public.school_set_logo(text)') is null c, to_regprocedure('public.school_remove_logo()') is null d"))[0].a, true);
  assert.equal(JSON.stringify({ s: await q("select id, name from schools order by id"), g: (await q("select count(*)::int n from scholar_subjects_grades"))[0] }), before);
  await db.exec(read(FILES.sql));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
await db.close?.();
