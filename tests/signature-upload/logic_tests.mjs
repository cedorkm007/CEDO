// tests/signature-upload/logic_tests.mjs — a signature photo becomes a clean transparent PNG: loops, soft edges, shadows, tight crop, errors in plain words (5 checks, short on purpose)
// Run:  node tests/signature-upload/logic_tests.mjs     (no browser needed: the pixel work is a pure function)
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sig-")), "s.mjs");
await build({ entryPoints: ["src/lib/imageBackgroundRemoval.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const S = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

// a W x H picture: paper colour with a little noise, and a thick dark RING (a closed loop with white inside), like the big loops of a flourish
function picture(W, H, { paper = [255, 255, 255], ink = [20, 20, 20], noise = 3, cx = W / 2, cy = H / 2, rOut = 60, rIn = 44, shadow = 0 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2 * noise;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = Math.hypot(x - cx, y - cy);
    const t = r >= rIn && r <= rOut ? 1 : r > rOut && r < rOut + 2 ? 0.25 : 0;           // ink, with a soft 2px edge outside
    const sh = shadow * (1 - Math.min(1, (x + y) / (W + H) * 3));                          // a shadow in the top-left corner
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, (paper[k] - sh) * (1 - t) + ink[k] * t + rnd()));
    data[i + 3] = 255;
  }
  return data;
}
const alphaAt = (o, x, y) => o.data[(y * o.width + x) * 4 + 3];

const W = 300, H = 200;
const a = S.makeSignaturePixels(picture(W, H), W, H);
check("1 the white INSIDE a loop becomes transparent too (not only the outside); the ink stays solid; the paper noise is gone",
  !!a && alphaAt(a, 150, 100) === 0 && alphaAt(a, 150 + 52, 100) === 255 && alphaAt(a, 5, 5) === 0 && alphaAt(a, 290, 190) === 0);
check("2 the ink keeps its own colour (dark, not grey) and the edge is soft (a part-covered pixel is partly see-through, with no white halo)",
  a.data[(100 * W + (150 + 52)) * 4] < 60 && a.data[(100 * W + (150 + 52)) * 4 + 1] < 60 && (() => { const e = (100 * W + (150 + 61)) * 4; return a.data[e + 3] > 0 && a.data[e + 3] < 255 && a.data[e] < 60; })());
check("3 the crop is tight around the signature with a small margin, and never goes outside the picture (a signature touching the edge is fine)",
  a.box.x === 150 - 61 - S.CROP_PADDING_PX + 0 || Math.abs(a.box.x - (150 - 62 - S.CROP_PADDING_PX)) <= 2 && Math.abs(a.box.w - (2 * 62 + 2 * S.CROP_PADDING_PX)) <= 4);
const edge = S.makeSignaturePixels(picture(120, 120, { cx: 60, cy: 60, rOut: 62, rIn: 40 }), 120, 120);
check("3b a signature that touches the picture's edge is not a problem", !!edge && edge.box.x === 0 && edge.box.y === 0 && edge.box.w === 120);
const warm = S.makeSignaturePixels(picture(W, H, { paper: [244, 240, 228], shadow: 22 }), W, H);
check("4 cream paper and a shadow in one corner leave no ink behind; a blank page (no signature) gives nothing; light grey 'paper only' gives nothing",
  !!warm && alphaAt(warm, 4, 4) === 0 && alphaAt(warm, 40, 20) === 0 && alphaAt(warm, 150 + 52, 100) === 255
  && S.makeSignaturePixels(picture(W, H, { rOut: -5, rIn: -4, noise: 4 }), W, H) === null);
const panel = src("src/sead/components/SignatureUploadPanel.tsx"), api = src("src/sead/referralApi.ts");
const proc = src("src/lib/imageBackgroundRemoval.ts");
check("5 a picture with a TRANSPARENT background (a PNG signature saved without paper) is painted on white first, so its ink is not mistaken for background; the upload panel says WHAT is wrong (not a picture / no signature found), clears the file box so the same file can be chosen again, accepts any picture type, and a replaced signature is not served from an old cache",
  proc.indexOf('ctx.fillStyle = "#ffffff"') > 0 && proc.indexOf('ctx.fillStyle = "#ffffff"') < proc.indexOf("ctx.drawImage(bitmap") && panel.includes("e instanceof Error && e.message") && panel.includes('e.target.value = ""') && panel.includes("image/*") && api.includes('cacheControl: "60"'));
console.log(`\n${passed} passed`);
