// tests/storage-tool/run.mjs — Storage Tool website checks (no database or browser needed).  Run:  node tests/storage-tool/run.mjs
// The pure rules (sizes in words, what can be previewed, the upload size check, sorting, planning a whole-folder upload), the access helper, and source
// guards (the tool only asks the database, files go straight to storage, readable text, every function the website calls exists in the SQL file).
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "storage-tool-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const L = await bundle("logic", "src/storagetool/storageToolLogic.ts");
const AC = await bundle("access", "src/lib/storageToolAccess.ts");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`); }
}
const MB = 1024 * 1024;

console.log("Sizes and types");
test("sizes are written in plain words", () => {
  assert.equal(L.formatBytes(0), "0 B"); assert.equal(L.formatBytes(-5), "0 B"); assert.equal(L.formatBytes(NaN), "0 B"); assert.equal(L.formatBytes(512), "512 B");
  assert.equal(L.formatBytes(1024), "1 KB"); assert.equal(L.formatBytes(1536), "1.5 KB"); assert.equal(L.formatBytes(5 * MB), "5 MB"); assert.equal(L.formatBytes(500 * MB), "500 MB");
  assert.equal(L.formatBytes(1.25 * 1024 * MB), "1.25 GB"); assert.equal(L.formatBytes(200 * 1024 * MB), "200 GB");
});
test("only images (not SVG), PDF, video and audio open inside the page; web pages, SVG, scripts and Office files never do", () => {
  const k = (mime, name) => L.previewKind(mime, name);
  assert.equal(k("image/png", "a.png"), "image"); assert.equal(k("image/jpeg", "a.jpg"), "image"); assert.equal(k("application/pdf", "a.pdf"), "pdf");
  assert.equal(k("video/mp4", "a.mp4"), "video"); assert.equal(k("audio/mpeg", "a.mp3"), "audio");
  assert.equal(k("image/svg+xml", "logo.svg"), null, "SVG can carry scripts"); assert.equal(k("text/html", "page.html"), null); assert.equal(k("application/javascript", "x.js"), null);
  assert.equal(k("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"), null); assert.equal(k("application/zip", "a.zip"), null);
  assert.equal(k("application/octet-stream", "photo.JPG"), "image", "a generic stored type falls back to the extension"); assert.equal(k("", "scan.pdf"), "pdf"); assert.equal(k("application/octet-stream", "logo.svg"), null);
  assert.equal(k("image/png; charset=binary", "a.png"), "image");
});
test("the type column says what a file is", () => {
  assert.equal(L.typeLabel("application/pdf", "a.pdf"), "PDF"); assert.equal(L.typeLabel("", "a.docx"), "Word"); assert.equal(L.typeLabel("", "a.xlsx"), "Excel"); assert.equal(L.typeLabel("text/csv", "a.csv"), "Excel");
  assert.equal(L.typeLabel("", "deck.pptx"), "PowerPoint"); assert.equal(L.typeLabel("image/gif", "a.gif"), "Image"); assert.equal(L.typeLabel("", "a.zip"), "ZIP"); assert.equal(L.typeLabel("", "notes.txt"), "Text");
  assert.equal(L.typeLabel("", "data.xyz"), "XYZ"); assert.equal(L.typeLabel("", "README"), "File");
});

console.log("\nUpload checks");
test("an empty file or a file over the limit is refused with the file's name, size and the limit in the message", () => {
  assert.equal(L.validateUpload({ name: "ok.pdf", size: 10 * MB }, 500 * MB), null); assert.equal(L.validateUpload({ name: "exact.bin", size: 500 * MB }, 500 * MB), null);
  assert.match(L.validateUpload({ name: "empty.txt", size: 0 }, 500 * MB), /empty/);
  const big = L.validateUpload({ name: "movie.mp4", size: 612 * MB }, 500 * MB);
  assert.match(big, /movie\.mp4/); assert.match(big, /612 MB/); assert.match(big, /500 MB/);
});
test("small files go in one request, bigger ones in 6 MB pieces (what Supabase asks for)", () => {
  assert.equal(L.SMALL_UPLOAD_BYTES, 6 * MB); assert.equal(L.UPLOAD_CHUNK_BYTES, 6 * MB);
  const up = read("src/storagetool/uploader.ts");
  assert.match(up, /file\.size <= SMALL_UPLOAD_BYTES \? await sendSmall/); assert.match(up, /chunkSize: UPLOAD_CHUNK_BYTES/); assert.match(up, /storage\/v1\/upload\/resumable/);
});
test("splitting a path from a folder upload: both slash kinds, empty parts and dot parts are dropped", () => {
  assert.deepEqual(L.splitRelativePath("Reports/2026/a.pdf"), { dirs: ["Reports", "2026"], name: "a.pdf" });
  assert.deepEqual(L.splitRelativePath("Reports\\2026\\a.pdf"), { dirs: ["Reports", "2026"], name: "a.pdf" });
  assert.deepEqual(L.splitRelativePath("/a//b/../c.txt"), { dirs: ["a", "b"], name: "c.txt" }); assert.deepEqual(L.splitRelativePath("single.pdf"), { dirs: [], name: "single.pdf" });
  assert.deepEqual(L.splitRelativePath("../.."), { dirs: [], name: "" });
});
test("a whole-folder upload is planned: outer folders first, each once; empty and too-big files are skipped with a reason", () => {
  const f = (size, rel) => ({ file: { name: rel.split("/").pop(), size }, relativePath: rel });
  const plan = L.planUpload([f(10, "Reports/2026/q1.pdf"), f(10, "Reports/2026/q2.pdf"), f(10, "Reports/readme.txt"), f(0, "Reports/empty.txt"), f(600 * MB, "Reports/huge.iso"), f(5, "loose.pdf"), f(5, "Other/a/b/c.pdf")], 500 * MB);
  assert.deepEqual(plan.dirs.map(d => d.join("/")), ["Reports", "Other", "Reports/2026", "Other/a", "Other/a/b"]);
  assert.equal(plan.files.length, 5); assert.equal(plan.skipped.length, 2); assert.ok(plan.skipped.some(s => /empty\.txt/.test(s)) && plan.skipped.some(s => /huge\.iso/.test(s)));
  assert.deepEqual(plan.files.find(x => x.name === "loose.pdf").dirs, []);
  assert.deepEqual(L.planUpload([], 500 * MB), { dirs: [], files: [], skipped: [] });
});
test("the upload panel's numbers: one percentage for the queue, a plain summary line", () => {
  assert.equal(L.queueProgress([]), 0); assert.equal(L.queueProgress([{ progress: 50, status: "uploading" }, { progress: 100, status: "done" }]), 75);
  assert.equal(L.queueProgress([{ progress: 50, status: "cancelled" }, { progress: 100, status: "done" }]), 100, "a cancelled file does not count");
  assert.equal(L.queueSummary([{ status: "done" }, { status: "uploading" }, { status: "error" }, { status: "cancelled" }]), "1 of 3 uploaded · 1 failed"); assert.equal(L.queueSummary([]), "Nothing to upload");
});

console.log("\nSorting");
test("folders and files sort by name (numbers in order: 2 before 10), date, size and type, both ways", () => {
  const files = [{ id: "1", name: "file10.pdf", sizeBytes: 5, mimeType: "application/pdf", storagePath: "", uploaderLabel: "", createdAt: "2026-01-02", modifiedAt: "2026-01-02" },
    { id: "2", name: "file2.pdf", sizeBytes: 50, mimeType: "application/pdf", storagePath: "", uploaderLabel: "", createdAt: "2026-01-03", modifiedAt: "2026-01-03" },
    { id: "3", name: "a.png", sizeBytes: 20, mimeType: "image/png", storagePath: "", uploaderLabel: "", createdAt: "2026-01-01", modifiedAt: "2026-01-01" }];
  const ids = (k, d) => L.sortFiles(files, k, d).map(f => f.id).join("");
  assert.equal(ids("name", "asc"), "321"); assert.equal(ids("name", "desc"), "123"); assert.equal(ids("size", "asc"), "132"); assert.equal(ids("size", "desc"), "231");
  assert.equal(ids("date", "asc"), "312"); assert.equal(ids("date", "desc"), "213"); assert.equal(ids("type", "asc")[0], "3", "Image before PDF");
  const folders = [{ id: "a", name: "Zeta", createdAt: "", updatedAt: "2026-01-01" }, { id: "b", name: "alpha", createdAt: "", updatedAt: "2026-02-01" }];
  assert.equal(L.sortFolders(folders, "name", "asc").map(f => f.id).join(""), "ba"); assert.equal(L.sortFolders(folders, "date", "desc").map(f => f.id).join(""), "ba");
});

console.log("\nAccess");
test("who sees the tool: the IT admin and staff with the Storage Tool tag, nobody else", () => {
  assert.equal(AC.canUseStorageTool({ tags: ["storage_tool"], username: "someone" }), true); assert.equal(AC.canUseStorageTool({ tags: [], username: "it.admin1" }), true); assert.equal(AC.canUseStorageTool({ tags: [], username: "IT.Admin1" }), true);
  assert.equal(AC.canUseStorageTool({ tags: ["scholar_counseling", "sdp_monitoring"], username: "staff" }), false); assert.equal(AC.canUseStorageTool({ tags: [] }), false);
});
test("the tag exists in the Staff Accounts list, the page is checked in App and the sidebar, and a person without access never reaches the page", () => {
  assert.match(read("src/app/staffToolTags.ts"), /key: "storage_tool",\s*label: "Storage Tool"/);
  const app = read("src/app/App.tsx");
  assert.match(app, /case "storageTool": return canUseStorageTool\(user\)/); assert.match(app, /page==="storageTool" && canUseStorageTool\(currentUser\)/); assert.match(app, /"scanningTools", "storageTool"\]/);
  const side = read("src/app/components/Sidebar.tsx");
  assert.match(side, /\{canUseStorageTool\(user\) && \(\s*<SidebarMenuItem[^]*?Storage Tool/); assert.match(side, /\|\| canUseStorageTool\(user\)/);
  assert.match(read("supabase_migration_storage_tool_p1.sql"), /t\.tag_key = 'storage_tool'/);
  assert.equal(AC.STORAGE_TOOL_TAG, "storage_tool");
});

console.log("\nSource guards");
test("every database function the tool calls exists in the Phase 1 SQL file, and the website never writes the tables directly", () => {
  const sql = read("supabase_migration_storage_tool_p1.sql"), api = read("src/storagetool/storageToolApi.ts");
  const called = new Set([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...called].sort(), ["storage_tool_create_folder", "storage_tool_path", "storage_tool_register_file", "storage_tool_usage"]);
  for (const fn of called) assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`).test(sql), fn);
  for (const p of ["src/storagetool/storageToolApi.ts", "src/storagetool/uploader.ts", "src/storagetool/pages/StorageToolPage.tsx"]) assert.equal(/\.from\("storage_tool_[a-z_]+"\)\s*\.(insert|update|delete|upsert)/.test(read(p)), false, p);
});
test("every function in the SQL file starts by checking access (or is the IT admin's), so the database blocks everybody else", () => {
  const sql = read("supabase_migration_storage_tool_p1.sql");
  for (const fn of ["storage_tool_create_folder", "storage_tool_register_file", "storage_tool_path", "storage_tool_usage"]) {
    const body = new RegExp(`create or replace function public\\.${fn}\\([^]*?\\n\\$\\$;`).exec(sql)?.[0] ?? "";
    assert.ok(body.includes("perform public._storage_tool_require();"), fn);
  }
  assert.match(/create or replace function public\.storage_tool_settings_save[^]*?\n\$\$;/.exec(sql)[0], /if not public\.is_it_admin\(\)/);
  for (const t of ["storage_tool_settings", "storage_tool_folders", "storage_tool_files", "storage_tool_activity"]) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.equal(/to anon/.test(sql.replace(/--.*$/gm, "")), false, "nothing is granted to anon");
});
test("files go straight to storage (never through the website's own server) and are checked again by the database", () => {
  const up = read("src/storagetool/uploader.ts");
  assert.match(up, /storage\/v1\/object\/\$\{STORAGE_TOOL_BUCKET\}/); assert.equal(/fetch\(["`]\/api/.test(up), false);
  assert.match(up, /registerFile\(fileId, folderId, name, file\.type\)/); assert.match(up, /discardUnregistered\(path\)/);
  assert.match(up, /`\$\{session\.user\.id\}\/\$\{fileId\}`/, "the stored name is the person's id and a random id, never the file's own name");
});
test("a file is shown or downloaded only through a temporary link", () => {
  const api = read("src/storagetool/storageToolApi.ts");
  assert.match(api, /createSignedUrl\(storagePath, 300/); assert.equal(/getPublicUrl/.test(api + read("src/storagetool/components/PreviewModal.tsx") + read("src/storagetool/pages/StorageToolPage.tsx")), false);
  assert.match(read("supabase_migration_storage_tool_p1.sql"), /values \('storage-tool', 'storage-tool', false/);
});
test("the Storage Tool screens use readable text (13px and up, no pale greys, no pale-blue links) and give every icon button a name", () => {
  for (const p of ["src/storagetool/pages/StorageToolPage.tsx", "src/storagetool/components/UploadTray.tsx", "src/storagetool/components/PreviewModal.tsx", "src/storagetool/components/FileTypeIcon.tsx"]) {
    const src = read(p);
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
  const page = read("src/storagetool/pages/StorageToolPage.tsx");
  for (const label of ["Grid view", "List view", "More actions", "Choose files to upload", "Choose a folder to upload"]) assert.ok(page.includes(label), label);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
