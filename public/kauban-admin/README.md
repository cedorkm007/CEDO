# kauban-admin static assets

`ffmpeg-core/ffmpeg-core.js` and `ffmpeg-core.wasm` are the single-threaded
UMD build of `@ffmpeg/core`, copied here from
`node_modules/@ffmpeg/core/dist/umd/` so the Kauban admin video compressor
(`src/kauban/admin/videoCompression.ts`) can load them from this app's own
origin via `toBlobURL` instead of depending on a CDN being reachable.

Only fetched when a staff member with the `kauban_content` tag actually
uses the batch video uploader — not loaded by the public site or the rest
of the staff app.

To update after bumping the `@ffmpeg/core` version in `package.json`:

```bash
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js public/kauban-admin/ffmpeg-core/ffmpeg-core.js
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm public/kauban-admin/ffmpeg-core/ffmpeg-core.wasm
```
