// tests/entered-grades/zoom_web_tests.mjs — zooming a picture in and out in the entered-grades review (only how it is shown)
// Run:  node tests/entered-grades/zoom_web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoom-"));
const outfile = path.join(tmp, "turn.mjs");
await build({ entryPoints: [path.join(root, "src/lib/pictureTurn.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const T = await import(pathToFileURL(outfile).href);
const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalEnteredGradesTab.tsx"), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The steps");
test("zooming in goes up the steps and stops at the largest; zooming out goes down and stops at the smallest", () => {
  let z = 1; const seen = [z]; for (let i = 0; i < 8; i++) { z = T.nextZoom(z, 1); seen.push(z); }
  assert.deepEqual(seen.slice(0, 5), [1, 1.5, 2, 3, 4]); assert.equal(z, 4);
  z = 1; for (let i = 0; i < 8; i++) z = T.nextZoom(z, -1); assert.equal(z, 0.5);
});
test("in then out comes back to where it was", () => { for (const z of T.ZOOM_STEPS.slice(1, -1)) assert.equal(T.nextZoom(T.nextZoom(z, 1), -1), z); });
test("a value between two steps still goes the right way", () => { assert.equal(T.nextZoom(1.2, 1), 1.5); assert.equal(T.nextZoom(1.2, -1), 1); });

console.log("The screen");
test("each picture has zoom out, zoom in and a 'back to normal size' button showing the percentage, named for the picture", () => {
  assert.ok(tab.includes("Zoom ${name} out") && tab.includes("Zoom ${name} in") && tab.includes("Show ${name} at normal size") && tab.includes("Math.round(zoom * 100)"));
  assert.ok(tab.includes("nextZoom(z, -1)") && tab.includes("nextZoom(z, 1)") && tab.includes("setZoom(1)"));
});
test("a zoomed-in picture scrolls inside its own box (it does not push the form wider), and the buttons stay in place", () => {
  assert.ok(tab.includes('zoom > 1 ? "max-h-[80vh] overflow-auto'));
  assert.ok(tab.indexOf('role="group" aria-label={`Zoom') > tab.indexOf('data-testid="picture-scroller"'), "the buttons are outside the scrolling box");
});
test("zooming works with turning: the turned layout is measured on the zoomed box", () => {
  assert.ok(tab.includes("style={{ width: `${zoom * 100}%` }}") && tab.includes("turnedLayout(natural.w, natural.h, boxW, quarter)") && tab.includes("new ResizeObserver"));
});
test("zooming only changes how the picture is shown: no write of any kind, the full-size link still opens the original", () => {
  assert.equal(/storage\.from|\.upload\(|\.update\(/.test(tab), false);
  assert.ok(tab.includes("Open ${name} full size"));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
