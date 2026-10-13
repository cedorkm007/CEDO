// localdemo/tools/smoke.mjs — quick self-check of the local API server against the built database.
import { openDb } from "../build.mjs";
import { startServer } from "../server.mjs";
import { ANON_KEY, SERVICE_KEY } from "../jwt.mjs";
const db = openDb(); await db.waitReady;
const s = await startServer({ db, port: 54399, log: console.error });
const call = async (path, opts = {}) => { const r = await fetch(s.url + path, { ...opts, headers: { apikey: ANON_KEY, authorization: `Bearer ${opts.token ?? ANON_KEY}`, "content-type": "application/json", ...(opts.headers ?? {}) } }); return { status: r.status, text: await r.text(), headers: r.headers }; };
console.log("anon schools:", await call("/rest/v1/schools?select=id,name&limit=2"));
console.log("service schools:", (await call("/rest/v1/schools?select=id,name&limit=2", { token: SERVICE_KEY })).text);
console.log("service embed:", (await call("/rest/v1/scholars?select=id,status,scholar_status_history(status)&limit=1", { token: SERVICE_KEY })).text);
console.log("rpc:", await call("/rest/v1/rpc/resolve_school_login_email", { method: "POST", body: JSON.stringify({ p_school_name: "x" }) }));
console.log("count:", await call("/rest/v1/schools?select=id", { token: SERVICE_KEY, headers: { prefer: "count=exact", range: "0-0" } }).then(r => [r.status, r.headers.get("content-range")]));
await s.close(); await db.close();
