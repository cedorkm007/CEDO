// localdemo/tools/api_check.mjs — signs in to the RUNNING local demo as a test account and calls a few endpoints (a quick self-check).
import { ANON_KEY } from "../jwt.mjs";
const base = "http://127.0.0.1:54321";
const h = (t = ANON_KEY) => ({ apikey: ANON_KEY, authorization: `Bearer ${t}`, "content-type": "application/json" });
const email = "demo-admin@demo.local";
const login = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: h(), body: JSON.stringify({ email, password: "Demo#2026" }) })).json();
const t = login.access_token;
const rpc = async (name, args) => { const r = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers: h(t), body: JSON.stringify(args) }); return [r.status, (await r.text()).slice(0, 400)]; };
console.log("history:", await rpc("scholar_status_history_for", { p_scholar_id_number: "TEST-0005" }));
console.log("sdp compliance:", await rpc("scholars_sdp_compliance", { p_school_year: "2025-2026", p_semester: "2nd Semester" }).then(r => [r[0], r[1].slice(0, 150)]));
