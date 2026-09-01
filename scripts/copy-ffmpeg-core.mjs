// Copies the single-threaded ffmpeg-core build out of node_modules into
// public/kauban-admin/ffmpeg-core/ so the Kauban admin video compressor
// (src/kauban/admin/videoCompression.ts) can self-host it instead of
// depending on a CDN. Runs on every `npm install` (see package.json's
// "postinstall") rather than being committed to git — it's ~32MB of
// fully derived binary, identical to what's already sitting in
// node_modules/@ffmpeg/core, so committing a second copy would just
// permanently bloat the repo for no benefit.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "node_modules", "@ffmpeg", "core", "dist", "umd");
const destDir = join(rootDir, "public", "kauban-admin", "ffmpeg-core");

if (!existsSync(srcDir)) {
  // Not installed (e.g. a CI step that only needs other packages) — skip
  // quietly rather than failing the whole install.
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}
console.log("Copied ffmpeg-core into public/kauban-admin/ffmpeg-core/");
