// localdemo/tools/storage_check.mjs — signs in to the RUNNING local demo as TEST-0003 with the website's own Supabase client, uploads a
import { randomUUID } from "node:crypto";
// study plan, records it, opens it through a signed link, and removes it again (a quick self-check of storage + the documents rules).
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY } from "../jwt.mjs";
import ws from "ws";
const opts = { auth: { persistSession: false }, realtime: { transport: ws } };
const sb = createClient("http://127.0.0.1:54321", ANON_KEY, opts);
const { error: e0 } = await sb.auth.signInWithPassword({ email: "test-0003@demo.local", password: "Demo#2026" });
if (e0) throw e0;
const { data: ov, error: e1 } = await sb.rpc("renewal_my_overview");
if (e1) throw e1;
let rec = ov.windows.find(w => w.window.term === "1st Semester" && w.window.school_year === "2026-2027")?.record;
if (!rec) { const w = ov.windows.find(w => w.window.term === "1st Semester" && w.window.school_year === "2026-2027"); const { error } = await sb.rpc("renewal_apply", { p_window_id: w.window.id, p_school: "S", p_program: "P", p_year_level: "2nd Year", p_note: "" }); if (error) throw error; rec = (await sb.rpc("renewal_my_overview")).data.windows.find(x => x.window.id === w.window.id).record; }
console.log("stage:", rec.stage, "docs needed:", JSON.stringify(rec.evaluation.required_documents));
const path = `TEST-0003/${rec.id}/study_plan/${randomUUID()}-plan.pdf`;
const body = new Blob(["%PDF-1.4 demo study plan"], { type: "application/pdf" });
const up = await sb.storage.from("renewal-documents").upload(path, body, { contentType: "application/pdf", upsert: false });
console.log("upload:", up.error ? up.error.message : "ok");
const ins = await sb.from("renewal_documents").insert({ record_id: rec.id, scholar_id_number: "TEST-0003", kind: "study_plan", storage_path: path, file_name: "plan.pdf", mime_type: "application/pdf", size_bytes: 24 }).select("id");
console.log("record:", ins.error ? ins.error.message : "ok");
const signed = await sb.storage.from("renewal-documents").createSignedUrl(path, 60);
console.log("signed:", signed.error ? signed.error.message : signed.data.signedUrl.slice(0, 70));
if (signed.data) { const r = await fetch(signed.data.signedUrl); console.log("download:", r.status, JSON.stringify(await r.text())); }
const after = (await sb.rpc("renewal_my_overview")).data.windows.find(x => x.record?.id === rec.id).record;
console.log("stage after upload:", after.stage, "satisfied:", JSON.stringify(after.evaluation.required_documents));
const rm = await sb.storage.from("renewal-documents").remove([path]);
console.log("remove:", rm.error ? rm.error.message : "ok");
const del = await sb.from("renewal_documents").delete().eq("storage_path", path).select("id");
console.log("row removed:", del.data?.length);
// another scholar cannot read it
const sb2 = createClient("http://127.0.0.1:54321", ANON_KEY, opts);
await sb2.auth.signInWithPassword({ email: "test-0004@demo.local", password: "Demo#2026" });
const o = await sb2.storage.from("renewal-documents").createSignedUrl(path, 60);
console.log("other scholar:", o.error ? "refused (" + o.error.message + ")" : "ALLOWED?!");
process.exit(0);
