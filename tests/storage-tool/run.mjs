// tests/storage-tool/run.mjs — Storage Tool website checks (no database or browser needed).  Run:  node tests/storage-tool/run.mjs
// The pure rules (sizes in words, what can be previewed, the upload size check, sorting, planning a whole-folder upload), the access helper, and source
// guards (the tool only asks the database, files go straight to storage, readable text, every function the website calls exists in the SQL file).
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;   // older Node versions have no global Web Crypto

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
  for (const label of ["Grid view", "List view", "Choose files to upload", "Choose a folder to upload"]) assert.ok(page.includes(label), label);
  assert.ok(read("src/storagetool/components/ItemViews.tsx").includes("More actions for"), "More actions");
});

// ── Phase 2: organizing ──
console.log("\nPhase 2: selecting, moving, copying, ZIP, Trash");
test("item keys: a folder and a file with the same id are different keys, and a key can be read back", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.notEqual(L.itemKey("folder", id), L.itemKey("file", id));
  assert.deepEqual(L.parseItemKey(L.itemKey("folder", id)), { kind: "folder", id }); assert.deepEqual(L.parseItemKey(L.itemKey("file", id)), { kind: "file", id });
  assert.equal(L.parseItemKey("x:abc"), null); assert.equal(L.parseItemKey("d:not-a-uuid"), null); assert.equal(L.parseItemKey(""), null);
});
const T = [{ id: "a", parentId: null, name: "Alpha" }, { id: "b", parentId: "a", name: "Beta" }, { id: "c", parentId: "b", name: "Gamma" }, { id: "d", parentId: null, name: "Docs 10" }, { id: "e", parentId: null, name: "Docs 2" }, { id: "f", parentId: "a", name: "alpha two" }];
test("the folder tree nests folders and sorts siblings by name with numbers in order", () => {
  const tree = L.buildFolderTree(T);
  assert.deepEqual(tree.map(n => n.name), ["Alpha", "Docs 2", "Docs 10"]);
  assert.deepEqual(tree[0].children.map(n => n.name), ["alpha two", "Beta"]); assert.deepEqual(tree[0].children[1].children.map(n => n.name), ["Gamma"]);
});
test("a folder cannot be moved into itself or into a folder inside it (the picker greys these out)", () => {
  assert.deepEqual([...L.folderAndDescendants(T, "a")].sort(), ["a", "b", "c", "f"]);
  assert.deepEqual([...L.blockedMoveTargets(T, ["b"])].sort(), ["b", "c"]); assert.deepEqual([...L.blockedMoveTargets(T, ["b", "d"])].sort(), ["b", "c", "d"]); assert.equal(L.blockedMoveTargets(T, []).size, 0);
});
test("names inside a ZIP: characters Windows does not allow become _, no trailing dots, never empty", () => {
  assert.equal(L.zipSegment("a/b\\c:d*e?f\"g<h>i|j.txt"), "a_b_c_d_e_f_g_h_i_j.txt"); assert.equal(L.zipSegment("report. "), "report"); assert.equal(L.zipSegment("..."), "_"); assert.equal(L.zipSegment("ok name.pdf"), "ok name.pdf");
});
const SUB = { folders: [{ id: "r", parentId: null, name: "Reports" }, { id: "y", parentId: "r", name: "2026" }], files: [
  { id: "1", folderId: "r", name: "a.pdf", sizeBytes: 10, mimeType: "application/pdf", storagePath: "u/1" }, { id: "2", folderId: "y", name: "b:c.pdf", sizeBytes: 20, mimeType: "application/pdf", storagePath: "u/2" }] };
test("a folder becomes ZIP entries with its own name first and its structure kept", () => {
  assert.deepEqual(L.zipEntriesForFolder("r", SUB).map(e => e.path), ["Reports/a.pdf", "Reports/2026/b_c.pdf"]); assert.deepEqual(L.zipEntriesForFolder("r", SUB).map(e => e.storagePath), ["u/1", "u/2"]);
  assert.deepEqual(L.zipEntriesForFolder("y", { folders: [SUB.folders[1]], files: [SUB.files[1]] }).map(e => e.path), ["2026/b_c.pdf"]);
});
test("the ZIP name, and the 500 MB limit with a clear message", () => {
  assert.equal(L.zipFileName([{ kind: "folder", name: "Reports" }]), "Reports.zip"); assert.equal(L.zipFileName([{ kind: "folder", name: "A" }, { kind: "file", name: "b.pdf" }]), "Storage Tool download.zip"); assert.equal(L.zipFileName([{ kind: "file", name: "b.pdf" }]), "Storage Tool download.zip");
  assert.equal(L.ZIP_LIMIT_BYTES, 500 * MB); assert.equal(L.zipProblem([{ sizeBytes: 100 * MB }, { sizeBytes: 400 * MB }]), null); assert.match(L.zipProblem([{ sizeBytes: 300 * MB }, { sizeBytes: 300 * MB }]), /600 MB.*500 MB/);
  assert.match(L.zipProblem([]), /no file to download/);
});
test("copying a folder: the folders are made parents first, the copy's top has no parent, and every file knows its folder", () => {
  const plan = L.planFolderCopy("r", { folders: [SUB.folders[1], SUB.folders[0]], files: SUB.files });
  assert.deepEqual(plan.folders.map(f => f.id), ["r", "y"]); assert.equal(plan.folders[0].parentId, null); assert.equal(plan.folders[1].parentId, "r"); assert.deepEqual(plan.files.map(f => f.id), ["1", "2"]);
  assert.deepEqual(L.planFolderCopy("y", SUB).folders.map(f => f.id), ["y"], "copying a sub-folder takes only what is inside it");
});
test("the Trash says how long an item has left, in plain words", () => {
  assert.equal(L.trashCountdown(30), "Deleted forever in 30 days"); assert.equal(L.trashCountdown(1), "Deleted forever tomorrow"); assert.equal(L.trashCountdown(0), "Deleted forever today"); assert.equal(L.trashCountdown(-2), "Deleted forever today");
  assert.equal(L.countWords(1, "file", "files"), "1 file"); assert.equal(L.countWords(0, "file", "files"), "0 files"); assert.equal(L.countWords(5, "folder", "folders"), "5 folders");
});
test("every database function the Phase 2 screens call exists in the Phase 2 SQL file, and none writes a table directly", () => {
  const sql = read("supabase_migration_storage_tool_p2.sql"), api = read("src/storagetool/storageToolOrganizeApi.ts");
  const called = new Set([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...called].sort(), ["storage_tool_details", "storage_tool_folder_tree", "storage_tool_forever_finish", "storage_tool_forever_prepare", "storage_tool_move", "storage_tool_rename", "storage_tool_restore", "storage_tool_search", "storage_tool_subtree", "storage_tool_trash", "storage_tool_trash_list"]);
  for (const fn of called) assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`).test(sql), fn);
  for (const p of ["src/storagetool/storageToolOrganizeApi.ts", "src/storagetool/copyItems.ts", "src/storagetool/zipDownload.ts", "src/storagetool/pages/StorageToolPage.tsx", "src/storagetool/components/TrashView.tsx"]) assert.equal(/\.from\("storage_tool_[a-z_]+"\)\s*\.(insert|update|delete|upsert)/.test(read(p)), false, p);
});
test("every new function in the SQL file checks access first; the clean-up functions are for the service role only", () => {
  const sql = read("supabase_migration_storage_tool_p2.sql");
  for (const fn of ["storage_tool_rename", "storage_tool_move", "storage_tool_folder_tree", "storage_tool_subtree", "storage_tool_search", "storage_tool_details", "storage_tool_trash", "storage_tool_trash_list", "storage_tool_restore", "storage_tool_forever_prepare", "storage_tool_forever_finish"]) {
    const body = new RegExp(`create or replace function public\\.${fn}\\([^]*?\\n\\$\\$;`).exec(sql)?.[0] ?? "";
    assert.ok(body.includes("perform public._storage_tool_require();"), fn);
  }
  assert.match(sql, /revoke all on function public\.storage_tool_purge_claim\(integer\) from public, anon, authenticated;\s*grant execute on function public\.storage_tool_purge_claim\(integer\) to service_role;/);
  assert.match(sql, /revoke all on function public\.storage_tool_purge_finish\(uuid\[\]\) from public, anon, authenticated;\s*grant execute on function public\.storage_tool_purge_finish\(uuid\[\]\) to service_role;/);
  assert.equal(/to anon/.test(sql.replace(/--.*$/gm, "")), false);
});
test("'Delete forever' lists the stored files, removes them from storage, and only then removes the rows; a ZIP and a copy never go through the website's server", () => {
  const api = read("src/storagetool/storageToolOrganizeApi.ts");
  const forever = /export async function deleteForever[^]*?\r?\n}\r?\n/.exec(api)[0];
  assert.ok(forever.indexOf("storage_tool_forever_prepare") < forever.indexOf(".remove(") && forever.indexOf(".remove(") < forever.indexOf("storage_tool_forever_finish"));
  assert.match(api, /\.copy\(file\.storagePath, newPath\)/); assert.match(api, /registerFile\(newId, targetFolderId, file\.name, file\.mimeType\)/);
  const zip = read("src/storagetool/zipDownload.ts");
  assert.match(zip, /await import\("jszip"\)/, "the ZIP library is loaded only when needed"); assert.match(zip, /zipProblem\(entries\)/);
});
test("the automatic clean-up function checks its secret, removes the stored files first and the rows after", () => {
  const fn = read("supabase/functions/storage-tool-purge/index.ts").replace(/^\s*\/\/.*$/gm, "");
  assert.match(fn, /x-purge-secret/); assert.match(fn, /STORAGE_TOOL_PURGE_SECRET/); assert.match(fn, /secretMatches/); assert.match(fn, /\{ error: "Not allowed\." \}, 401/);
  assert.ok(fn.indexOf("storage_tool_purge_claim") < fn.indexOf(".remove(") && fn.indexOf(".remove(") < fn.indexOf("storage_tool_purge_finish"));
});
test("dragging my own items uses its own drag type (so it is never mistaken for files dropped from the computer), and menus have names", () => {
  const page = read("src/storagetool/pages/StorageToolPage.tsx"), views = read("src/storagetool/components/ItemViews.tsx");
  assert.match(page, /DRAG_TYPE = "application\/x-storage-tool-items"/); assert.match(page, /Array\.from\(e\.dataTransfer\.types\)\.includes\("Files"\)/);
  assert.match(views, /aria-label=\{`Select \$\{name\}`\}/); assert.match(views, /aria-label=\{`More actions for \$\{name\}`\}/); assert.match(views, /onContextMenu/);
  for (const w of ["Move to…", "Copy to…", "Rename", "Details", "Delete"]) assert.ok(page.includes(w), w);
});
test("the Phase 2 screens use readable text (13px and up, no pale greys) and the question before deleting a folder says how much is inside", () => {
  for (const p of ["src/storagetool/pages/StorageToolPage.tsx", "src/storagetool/components/ItemViews.tsx", "src/storagetool/components/Dialogs.tsx", "src/storagetool/components/FolderPickerModal.tsx", "src/storagetool/components/DetailsPanel.tsx", "src/storagetool/components/TrashView.tsx"]) {
    const src = read(p);
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
  const page = read("src/storagetool/pages/StorageToolPage.tsx");
  assert.match(page, /fetchDetails\("folder", e\.folder\.id\)/); assert.match(page, /everything goes to the Trash together/);
});

console.log("\nPhase 3: sharing and upload links");
const P = await bundle("public", "supabase/functions/_shared/storageToolPublic.ts");
const lockHash = await P.hashLockKey("Open-Sesame-7", 1000), lockHash2 = await P.hashLockKey("Open-Sesame-7", 1000);
const lockRight = await P.verifyLockKey("Open-Sesame-7", lockHash), lockCase = await P.verifyLockKey("open-sesame-7", lockHash), lockEmpty = await P.verifyLockKey("", lockHash);
test("the lock key is turned into a scrambled hash in the browser (never sent as text), and only the right key matches it", () => {
  assert.match(lockHash, /^pbkdf2\$1000\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$/); assert.equal(lockHash.includes("Open-Sesame-7"), false);
  assert.equal(lockRight, true); assert.equal(lockCase, false); assert.equal(lockEmpty, false);
  assert.notEqual(lockHash2, lockHash, "a new salt each time");
});
test("the share and link calls the website makes all exist in the Phase 3 SQL file, and none writes a table directly", () => {
  const sql = read("supabase_migration_storage_tool_p3.sql"), api = read("src/storagetool/storageToolShareApi.ts");
  const called = new Set([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...called].sort(), ["storage_tool_browse", "storage_tool_link_create", "storage_tool_link_set_status", "storage_tool_link_update", "storage_tool_link_visitors", "storage_tool_links_list", "storage_tool_share_remove", "storage_tool_share_set", "storage_tool_shared_with_me", "storage_tool_shares_of", "storage_tool_staff_search"]);
  for (const fn of called) assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`).test(sql), fn);
  for (const p of ["src/storagetool/storageToolShareApi.ts", "src/storagetool/components/ShareDialog.tsx", "src/storagetool/components/LinkManager.tsx", "src/storagetool/components/SharedWithMeView.tsx", "src/storagetool/pages/StorageToolPage.tsx"]) assert.equal(/\.from\("storage_tool_[a-z_]+"\)\s*\.(insert|update|delete|upsert)/.test(read(p)), false, p);
});
test("every Phase 3 function a signed-in person calls checks access first; the public ones are for the service role only and never for 'anon'", () => {
  const sql = read("supabase_migration_storage_tool_p3.sql");
  for (const fn of ["storage_tool_browse", "storage_tool_shared_with_me", "storage_tool_staff_search", "storage_tool_share_set", "storage_tool_share_remove", "storage_tool_shares_of", "storage_tool_link_create", "storage_tool_link_update", "storage_tool_link_set_status", "storage_tool_links_list", "storage_tool_link_visitors"]) {
    const body = new RegExp(`create or replace function public\\.${fn}\\([^]*?\\n\\$\\$;`).exec(sql)?.[0] ?? "";
    assert.ok(body.includes("perform public._storage_tool_require();"), fn);
  }
  for (const fn of ["public_link_get", "public_rate", "public_session_create", "public_session_get", "public_register", "public_mine"]) assert.match(sql, new RegExp(`grant execute on function public\\.storage_tool_${fn}\\([^)]*\\) to service_role;`), fn);
  assert.equal(/to anon/.test(sql.replace(/--.*$/gm, "")), false);
});
test("the public page talks only to the storage-tool-public function: no tables, no sign-in, and a visitor can only add files", () => {
  const api = read("src/publicupload/publicUploadApi.ts"), app = read("src/publicupload/PublicUploadApp.tsx");
  assert.match(api, /\/functions\/v1\/storage-tool-public/); assert.equal(/supabase\.(from|rpc|auth|storage)|@\/lib\/supabase/.test(api + app), false, "no database or account access");
  assert.deepEqual([...api.matchAll(/action: "([a-z]+)"/g)].map(m => m[1]).sort(), ["finish", "info", "mine", "open", "start"]);
  assert.match(app, /checkStart\(f\.name, f\.size, rules\)/, "the same file check as the server is run before anything is sent");
  assert.match(read("src/main.tsx"), /isUploadSite[^]*PublicUploadApp/);
});
test("the public page reads well: 14px and up, a progress bar with a name, errors announced, no pale greys", () => {
  for (const p of ["src/publicupload/PublicUploadApp.tsx", "src/storagetool/components/LinkManager.tsx", "src/storagetool/components/ShareDialog.tsx", "src/storagetool/components/SharedWithMeView.tsx"]) {
    const src = read(p);
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
  const app = read("src/publicupload/PublicUploadApp.tsx");
  assert.match(app, /role="progressbar"/); assert.match(app, /role="alert"/); assert.match(app, /aria-label="Choose files to send"/);
});
test("a person who may only look cannot change anything from the screens: add, edit and share are tied to the level the database reported", () => {
  const page = read("src/storagetool/pages/StorageToolPage.tsx");
  assert.match(page, /const canAdd = inBrowse && level >= 2/); assert.match(page, /const canEdit = inBrowse && level >= 3/); assert.match(page, /const isOwner = mode === "files"/);
  assert.match(page, /canEdit \? \[\{ label: "Move to…"/); assert.match(page, /\.\.\.\(many \|\| !isOwner \? \[\] : \[\{ label: "Share…"/);
  assert.match(page, /canDrag=\{canEdit\}/); assert.match(page, /Things you delete go to \$\{ownerName\}'s Trash/);
});
test("the bell and the notifications list know the new 'storage' kind and only show it to the person it was sent to", () => {
  const app = read("src/app/App.tsx");
  assert.match(app, /type NotifType = [^;]*"storage"/); assert.match(app, /n\.type === "referral_approval" \|\| n\.type === "renewal" \|\| n\.type === "storage"\s*\?\s*n\.userId === currentUser\?\.id/);
  assert.match(app, /n\.type !== "storage"\) \|\| n\.userId === currentUser\.id/); assert.match(app, /Open Storage Tool/);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
