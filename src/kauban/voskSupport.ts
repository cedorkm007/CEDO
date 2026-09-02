// Split out from voskRecognition.ts deliberately: that file imports
// vosk-browser at the top level, and statically importing it from every
// page that needs this one-line capability check ballooned the *main*
// app bundle from ~2.3MB to ~8.1MB (confirmed via a full production
// build) — vosk-browser was getting bundled into the entry chunk instead
// of split off, since nothing forced Vite to treat it as lazy. This file
// has no such dependency, so it's safe to import statically anywhere;
// voskRecognition.ts itself should only ever be reached via a dynamic
// import() inside an event handler, not a top-level import.
export function isVoskRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
}
