// tests/sdp-update/phase9_headers_test.mjs — SDP Monitoring update, Phase 9: the website security headers (vercel.json).
//   • the page routing is unchanged
//   • the safe headers are on; the page-content policy is REPORT-ONLY first (it cannot break anything; it only writes a note in the browser console)
//   • the policy allows every outside site the website really uses (fonts, Google Drive previews, YouTube, the bot check, Supabase) and nothing risky
// Run:  node tests/sdp-update/phase9_headers_test.mjs
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const cfg = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const all = cfg.headers?.find(h => h.source === "/(.*)")?.headers ?? [];
const h = key => all.find(x => x.key.toLowerCase() === key.toLowerCase())?.value;

check("the page routing is unchanged (survey links, then everything else to the app)", cfg.rewrites.length === 2 && cfg.rewrites[0].source === "/s/:slug" && cfg.rewrites[0].destination === "/survey.html" && cfg.rewrites[1].source === "/(.*)" && cfg.rewrites[1].destination === "/index.html");
check("the safe headers are on: no content-type guessing, a modest referrer, HTTPS only", h("X-Content-Type-Options") === "nosniff" && h("Referrer-Policy") === "strict-origin-when-cross-origin" && /max-age=\d{7,}/.test(h("Strict-Transport-Security") ?? ""));
check("camera and microphone stay allowed for the site itself (QR scanning, speech tool); location, payment and USB are off", /camera=\(self\)/.test(h("Permissions-Policy")) && /microphone=\(self\)/.test(h("Permissions-Policy")) && /geolocation=\(\)/.test(h("Permissions-Policy")));
const csp = h("Content-Security-Policy-Report-Only") ?? "";
check("the page-content policy is report-only (nothing can be blocked yet)", csp.length > 100 && h("Content-Security-Policy") === undefined);
const dir = name => (csp.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ")) ?? "");
check("it never allows eval or plug-ins and pins the base address, forms and framing", !/'unsafe-eval'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp) && /frame-ancestors 'self'/.test(csp));
check("scripts may come only from the site itself (and the bot check); no inline scripts are allowed", /script-src 'self'/.test(dir("script-src")) && !/unsafe-inline/.test(dir("script-src")) && /challenges\.cloudflare\.com/.test(dir("script-src")));
const hosts = { "fonts.googleapis.com": "style-src", "fonts.gstatic.com": "font-src", "drive.google.com": "frame-src", "docs.google.com": "frame-src", "www.youtube.com": "frame-src", "challenges.cloudflare.com": "frame-src", "*.supabase.co": "connect-src" };
for (const [host, d] of Object.entries(hosts)) check(`${host} is allowed where the website uses it (${d})`, dir(d).includes(host));
check("Supabase live updates (wss) and the database address are both allowed", /wss:\/\/\*\.supabase\.co/.test(dir("connect-src")) && /https:\/\/\*\.supabase\.co/.test(dir("connect-src")));
const pageHosts = [...new Set([...fs.readFileSync("index.html", "utf8").matchAll(/(?:href|src)="https?:\/\/([a-z0-9.-]+)/g), ...fs.readFileSync("survey.html", "utf8").matchAll(/(?:href|src)="https?:\/\/([a-z0-9.-]+)/g)].map(m => m[1]))];
check("every outside address written into the two page files is allowed by the policy", pageHosts.every(hn => csp.includes(hn)), pageHosts.join(", "));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
