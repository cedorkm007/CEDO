// tests/csr-download/web_tests.mjs — the scholar's certificate download is not blocked by the browser (3 checks, short on purpose)
// Run:  node tests/csr-download/web_tests.mjs     (no database or browser needed)
import fs from "node:fs";
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name}`); } };
const api = src("src/lib/csrApi.ts"), panel = src("src/scholar/components/dashboard/CsrDownload.tsx");
const fn = api.slice(api.indexOf("export function openCsrDownload"), api.indexOf("// ── Settings"));
check("1 the download opens in the SAME tab (no new tab after the wait, which phones and in-app browsers block), and saves under the tidy name", !/target\s*=\s*["']_blank["']/.test(fn) && fn.includes("a.download = fileName"));
check("2 after the certificate is made the scholar also gets a visible 'tap here to download it' link, in case the browser blocked the download", panel.includes("setLink({ url: r.url, fileName: r.fileName })") && panel.includes("tap here to download it") && panel.includes("download={link.fileName}"));
check("3 the staff screens use the same helper, and a failed attempt still shows its message under the button", src("src/sead/renewal/RenewalCsrSection.tsx").includes("openCsrDownload(r.url, r.fileName)") && panel.includes('{error && <p role="alert"'));
console.log(`\n${passed} passed`);
