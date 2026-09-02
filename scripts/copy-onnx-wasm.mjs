// Copies onnxruntime-web's WASM runtime out of node_modules into
// public/kauban-onnx-wasm/ so the offline Whisper speech recognizer
// (src/kauban/whisperWorker.ts) can self-host it instead of depending on
// transformers.js's default CDN. Runs on every `npm install` (see
// package.json's "postinstall") rather than being committed to git — same
// reasoning as copy-ffmpeg-core.mjs: it's fully derived binary already
// sitting in node_modules.
//
// This matters specifically for offline support: transformers.js's own
// model-weight cache (Cache Storage) works fine offline once populated,
// but the ONNX *runtime* itself (the WASM engine that runs the model) is
// loaded from an external CDN by default — same-origin + our own service
// worker's cache-first strategy (kauban-sw.js) makes that reliably
// available offline too, instead of depending on the browser's ordinary
// HTTP cache not having evicted it.
//
// The whole dist/ output is copied rather than picking one file: the
// runtime auto-selects between SIMD/threaded/JSEP(WebGPU)/asyncify/jspi
// variants based on runtime feature detection, and guessing wrong here
// would silently break on whatever devices don't match the guess.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "node_modules", "onnxruntime-web", "dist");
const destDir = join(rootDir, "public", "kauban-onnx-wasm");

if (!existsSync(srcDir)) {
  process.exit(0);
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

// Skip source maps (dev-only, never fetched at runtime) and the
// Node.js-only build (irrelevant in a browser) — safe, unambiguous
// trims. Everything else is kept: the WASM execution provider auto-
// selects between SIMD/threaded/JSEP(WebGPU)/asyncify/JSPI binaries at
// runtime based on feature detection, and guessing which one narrower
// would silently break whichever devices don't match the guess.
for (const file of readdirSync(srcDir)) {
  if (file.endsWith(".map") || file.includes(".node.")) continue;
  cpSync(join(srcDir, file), join(destDir, file));
}
console.log("Copied onnxruntime-web dist into public/kauban-onnx-wasm/");
