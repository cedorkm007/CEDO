// tests/sdp-progress/logic_tests.mjs — SDP Progress Monitoring: the picture helpers (src/lib/progressPicture.ts), the scholar and staff screens (what they say and what they call)
// Run:  node tests/sdp-progress/logic_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prog-"));
const outfile = path.join(tmp, "p.mjs");
await build({ entryPoints: [path.join(root, "src/lib/progressPicture.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const P = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("What is printed on the picture");
await test("the date and time are in Philippine time", () => {
  assert.equal(P.manilaStamp(new Date("2026-11-05T06:35:10Z")), "Nov 5, 2026 · 2:35:10 PM");
  assert.equal(P.manilaStamp(new Date("2026-11-05T16:05:00Z")), "Nov 6, 2026 · 12:05:00 AM");
});
await test("coordinates have five decimals, the lines start with the place, then the position with its accuracy, the time, and who/what", () => {
  assert.equal(P.formatCoords(8.4542, 124.6319), "8.45420, 124.63190");
  const l = P.watermarkLines({ place: "Carmen, Cagayan De Oro City, Misamis Oriental", lat: 8.4542, lng: 124.6319, accuracy: 11.6, when: new Date("2026-11-05T06:35:10Z"), scholarId: "TEST-0001", activityName: "Tree Planting" });
  assert.deepEqual(l, ["Carmen, Cagayan De Oro City, Misamis Oriental", "8.45420, 124.63190 (±12 m)", "Nov 5, 2026 · 2:35:10 PM", "TEST-0001 · Tree Planting"]);
});
await test("when the place name is not found the picture carries the coordinates only (never an empty line)", () => {
  const l = P.watermarkLines({ place: "  ", lat: 8.4, lng: 124.6, accuracy: null, when: new Date("2026-11-05T06:35:10Z") });
  assert.deepEqual(l, ["8.40000, 124.60000", "Nov 5, 2026 · 2:35:10 PM"]);
});
await test("a long line is cut to fit with an ellipsis, a short one is left alone", () => {
  const measure = s => s.length * 10;
  assert.equal(P.fitLine("short", 100, measure), "short");
  const cut = P.fitLine("a very long place name indeed", 100, measure);
  assert.ok(cut.endsWith("…") && measure(cut) <= 100, cut);
});
await test("the watermark is a dark band at the bottom, the first line is the biggest, every line is drawn", () => {
  const calls = [], rects = [];
  const ctx = { fillStyle: "", font: "", textBaseline: "", fillRect: (...a) => rects.push(a), fillText: (t, x, y) => calls.push({ t, x, y, font: ctx.font }), measureText: t => ({ width: t.length * 8 }) };
  const h = P.drawWatermark(ctx, 1280, 720, ["Place", "8.4, 124.6", "Nov 5, 2026 · 2:35:10 PM", "TEST-0001 · Tree"]);
  assert.equal(calls.length, 4); assert.equal(rects.length, 1);
  assert.deepEqual(rects[0].slice(0, 1).concat(rects[0][2]), [0, 1280]);
  assert.equal(rects[0][1] + rects[0][3], 720, "the band ends at the bottom of the picture");
  assert.equal(h, rects[0][3]);
  const size = c => Number(/(\d+)px/.exec(c.font)[1]);
  assert.ok(size(calls[0]) > size(calls[1]));
  assert.ok(calls.every((c, i) => i === 0 || c.y > calls[i - 1].y), "lines go downwards");
  assert.ok(calls[0].y >= rects[0][1], "the text is inside the band");
});
await test("nothing to print: no band", () => assert.equal(P.drawWatermark({ fillStyle: "", font: "", textBaseline: "", fillRect() { throw new Error("no"); }, fillText() {}, measureText: () => ({ width: 0 }) }, 100, 100, []), 0));

console.log("\nThe picture itself");
await test("the picture is made smaller to the longest side, never bigger, and keeps its shape", () => {
  assert.deepEqual(P.pictureSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(P.pictureSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(P.pictureSize(640, 480), { width: 640, height: 480 });
});
await test("compression tries lower qualities and aims for a small file", () => {
  assert.deepEqual(P.PICTURE_QUALITIES, [...P.PICTURE_QUALITIES].sort((a, b) => b - a)); assert.ok(P.PICTURE_QUALITIES[0] <= 0.8);
  assert.ok(P.PICTURE_TARGET_BYTES <= 400 * 1024 && P.PICTURE_TARGET_BYTES < 2 * 1024 * 1024);
});
await test("distances between positions are in metres", () => {
  assert.ok(P.distanceMeters({ lat: 8.4542, lng: 124.6319 }, { lat: 8.4542, lng: 124.6319 }) < 0.01);
  const d = P.distanceMeters({ lat: 8.4542, lng: 124.6319 }, { lat: 8.4552, lng: 124.6319 });
  assert.ok(d > 100 && d < 125, String(d));
});

console.log("\nThe place name");
await test("the place is the locality, the city and the province, without repeats", () => {
  assert.equal(P.placeFromGeocode({ locality: "Carmen", city: "Cagayan De Oro City", principalSubdivision: "Misamis Oriental" }), "Carmen, Cagayan De Oro City, Misamis Oriental");
  assert.equal(P.placeFromGeocode({ locality: "Cagayan De Oro City", city: "Cagayan De Oro City", principalSubdivision: "Misamis Oriental" }), "Cagayan De Oro City, Misamis Oriental");
  assert.equal(P.placeFromGeocode({}), ""); assert.equal(P.placeFromGeocode(null), "");
});
await test("the free map service is called with the position (and is the one the site's security policy allows)", () => {
  assert.match(P.reverseGeocodeUrl(8.4542, 124.6319), /^https:\/\/api\.bigdatacloud\.net\/data\/reverse-geocode-client\?latitude=8\.45420&longitude=124\.63190/);
  assert.ok(JSON.parse(src("vercel.json")).headers[0].headers.find(h => h.key === "Content-Security-Policy-Report-Only").value.includes("https://api.bigdatacloud.net"));
});
await test("a place name is found when the service answers, and '' when it fails, answers badly or is too slow", async () => {
  assert.equal(await P.reverseGeocode(8.4, 124.6, async () => ({ ok: true, json: async () => ({ locality: "Carmen", city: "CDO", principalSubdivision: "Misamis Oriental" }) })), "Carmen, CDO, Misamis Oriental");
  assert.equal(await P.reverseGeocode(8.4, 124.6, async () => { throw new TypeError("Failed to fetch"); }), "");
  assert.equal(await P.reverseGeocode(8.4, 124.6, async () => ({ ok: false, json: async () => ({}) })), "");
  const slow = (url, opts) => new Promise((_, rej) => opts?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
  assert.equal(await P.reverseGeocode(8.4, 124.6, slow, 30), "");
});

console.log("\nWhat the scholar is told when the camera or the location does not work");
await test("blocked camera, no camera, busy camera, blocked location, no signal and slow signal each have their own plain message", () => {
  assert.match(P.cameraProblemText({ name: "NotAllowedError" }), /camera is blocked/); assert.match(P.cameraProblemText({ name: "NotFoundError" }), /No camera/);
  assert.match(P.cameraProblemText({ name: "NotReadableError" }), /another app/); assert.match(P.cameraProblemText(new Error("x")), /could not be opened/);
  assert.match(P.locationProblemText(1), /location is blocked/); assert.match(P.locationProblemText(2), /cannot tell where you are/); assert.match(P.locationProblemText(3), /taking too long/);
});
await test("a browser that cannot open the camera or find the location, or a page that is not secure, gets a message before anything is asked", () => {
  assert.equal(P.cameraUnavailableText({ hasMediaDevices: true, hasGeolocation: true, secure: true }), "");
  assert.match(P.cameraUnavailableText({ hasMediaDevices: true, hasGeolocation: true, secure: false }), /secure/);
  assert.match(P.cameraUnavailableText({ hasMediaDevices: false, hasGeolocation: true, secure: true }), /cannot open the camera/);
  assert.match(P.cameraUnavailableText({ hasMediaDevices: true, hasGeolocation: false, secure: true }), /cannot find your location/);
});

console.log("\nThe scholar's screens");
const cam = src("src/scholar/components/dashboard/ProgressCameraModal.tsx");
await test("the picture can only come from the live camera: no file chooser, no gallery", () => {
  assert.match(cam, /getUserMedia\(/); assert.match(cam, /watchPosition\(/); assert.doesNotMatch(cam, /type="file"|<input/);
});
await test("the button stays off until the camera is ready and the location is fresh; the watermark is burned into the picture and the picture is compressed and sent at once", () => {
  assert.match(cam, /canCapture = stage === "live" && cameraReady && fixFresh/);
  assert.match(cam, /drawWatermark\(ctx, width, height,/); assert.match(cam, /PICTURE_QUALITIES/); assert.match(cam, /submitProgressPicture\(\{/);
});
await test("the screen shows the place, the date and the time over the camera while it is open", () => {
  assert.match(cam, /What will be printed on the picture/); assert.match(cam, /setInterval\(\(\) => setNow\(new Date\(\)\), 1000\)/);
});
await test("a failed send lets the scholar take the picture again; a sent picture says to wait for the evaluator", () => {
  assert.match(cam, /Take the picture again/); assert.match(cam, /wait for the evaluator to approve it/);
});
const panel = src("src/scholar/components/dashboard/SDPPanel.tsx");
await test("the SDP list: the activity says Capture a Picture, waiting / approved / rejected are shown, and the list looks again while a picture waits", () => {
  assert.match(panel, /Capture a Picture/); assert.match(panel, /waiting for approval/); assert.match(panel, /Approved\. You are credited/); assert.match(panel, /was not approved\. Please take a picture again/);
  assert.match(panel, /Take another picture \(it replaces this one\)/); assert.match(panel, /setInterval\(\(\) => \{ void loadAll\(true\); \}, 20_000\)/);
});
const api = src("src/scholar/sdpApi.ts");
await test("sending: the picture goes to the private folder first, the database records it, and the OLD picture is deleted", () => {
  assert.match(api, /from\(PROGRESS_BUCKET\)\.upload\(/); assert.match(api, /sdp_progress_submit/); assert.match(api, /old_path/); assert.match(api, /\.remove\(\[oldPath\]\)/);
  assert.match(api, /remove\(\[path\]\)/, "a picture that could not be recorded is removed again");
});

console.log("\nThe staff screens");
const staff = src("src/sead/components/ProgressMonitoringSection.tsx");
await test("the Progress Monitoring list has Scholar ID, Name, School, Program, View image, and Approve / Reject; the picture opens in a pop-up", () => {
  for (const h of ["Scholar ID", "Name", "School", "Program", "View image", "Approve / Reject"]) assert.ok(staff.includes(h), h);
  assert.match(staff, /PictureDialog/); assert.match(staff, /fetchProgressPictureUrl/); assert.match(staff, /approveProgress/); assert.match(staff, /rejectProgress/);
});
await test("the list is paged (50), can be searched and narrowed by activity, and refreshes by itself", () => {
  assert.match(src("src/sead/progressMonitorApi.ts"), /PROGRESS_PAGE_SIZE = 50/); assert.match(staff, /Search by name or Scholar ID/); assert.match(staff, /aria-label="Activity"/); assert.match(staff, /REFRESH_MS = 30_000/);
});
const tab = src("src/sead/pages/SDPMonitoringTab.tsx");
await test("SDP Monitoring has the Progress Monitoring tab, an activity has a Progress Monitoring tab, and QR attendance cannot be enabled where it is attached", () => {
  assert.match(tab, /label: "Progress Monitoring"/); assert.match(tab, /<ProgressMonitoringSection \/>/); assert.match(tab, /setTab\("progress"\)/); assert.match(tab, /<ProgressAttachSection activity=\{activity\} \/>/);
  assert.match(tab, /so QR attendance cannot be enabled too/); assert.match(tab, /progress_picture: /);
});
await test("the credit history says an approved picture was the source", () => assert.match(tab, /progress_picture: "a picture was approved/));

console.log("\nThe site's settings");
await test("the camera and the location are allowed for the site itself only", () => {
  const h = JSON.parse(src("vercel.json")).headers[0].headers.find(x => x.key === "Permissions-Policy").value;
  assert.match(h, /camera=\(self\)/); assert.match(h, /geolocation=\(self\)/); assert.doesNotMatch(h, /geolocation=\(\*\)/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
