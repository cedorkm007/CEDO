// localdemo/server.mjs — the local stand-in for Supabase: sign-in, the database API, a few of the project's helper functions, file storage
// and a do-nothing live-updates channel, all on http://localhost:54321, all backed by the private local database.
// It only ever listens on this computer (127.0.0.1) and never contacts any other server.
import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { RestApi } from "./postgrest.mjs";
import { sign, verify, ANON_KEY, SERVICE_KEY, hashPassword, checkPassword } from "./jwt.mjs";

const ACCESS_SECONDS = 60 * 60 * 8;
const REFRESH_SECONDS = 60 * 60 * 24 * 30;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
};

function userObject(u) {
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at,
    phone: "", confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: "email", providers: ["email"], ...(u.raw_app_meta_data ?? {}) }, user_metadata: u.raw_user_meta_data ?? {},
    identities: [], created_at: u.created_at, updated_at: u.updated_at,
  };
}

function sessionFor(u) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: "authenticated", role: "authenticated", sub: u.id, email: u.email, iat: now, iss: "localdemo", app_metadata: u.raw_app_meta_data ?? {}, user_metadata: u.raw_user_meta_data ?? {} };
  return {
    access_token: sign({ ...claims, exp: now + ACCESS_SECONDS }),
    token_type: "bearer", expires_in: ACCESS_SECONDS, expires_at: now + ACCESS_SECONDS,
    refresh_token: sign({ typ: "refresh", sub: u.id, iat: now, exp: now + REFRESH_SECONDS, jti: crypto.randomUUID() }),
    user: userObject(u),
  };
}

export async function startServer({ db, port = 54321, log = () => {} }) {
  const rest = new RestApi(db);
  await rest.loadMeta();

  /** Who is calling: the key / token in the request headers. */
  function caller(req) {
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const key = String(req.headers.apikey ?? "");
    const token = bearer || key;
    const claims = verify(token);
    if (!claims) return { role: "anon", claims: { role: "anon" }, valid: !token };
    if (claims.role === "service_role") return { role: "service_role", claims, valid: true };
    if (claims.sub && claims.role === "authenticated") return { role: "authenticated", claims, valid: true };
    return { role: "anon", claims: { role: "anon" }, valid: true };
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }

  // ── Auth ──────────────────────────────────────────────────────
  async function findUserByEmail(email) {
    return (await db.query("select * from auth.users where lower(email) = lower($1)", [email])).rows[0];
  }
  async function handleAuth(req, res, url, body) {
    const p = url.pathname.replace(/^\/auth\/v1/, "");
    if (p === "/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = await findUserByEmail(body.email ?? "");
        const banned = u?.banned_until && new Date(u.banned_until) > new Date();
        if (!u || !checkPassword(body.password ?? "", u.encrypted_password)) return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        if (banned) return json(res, 400, { code: 400, error_code: "user_banned", msg: "User is banned" });
        await db.query("update auth.users set last_sign_in_at = now() where id = $1", [u.id]);
        return json(res, 200, sessionFor(u));
      }
      if (grant === "refresh_token") {
        const c = verify(body.refresh_token);
        if (!c || c.typ !== "refresh") return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
        const u = (await db.query("select * from auth.users where id = $1", [c.sub])).rows[0];
        if (!u || (u.banned_until && new Date(u.banned_until) > new Date())) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
        return json(res, 200, sessionFor(u));
      }
      return json(res, 400, { code: 400, msg: "Unsupported grant type" });
    }
    if (p === "/user") {
      const who = caller(req);
      if (who.role !== "authenticated") return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const u = (await db.query("select * from auth.users where id = $1", [who.claims.sub])).rows[0];
      if (!u) return json(res, 401, { code: 401, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
      if (req.method === "PUT") {
        if (body.password) await db.query("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [u.id, hashPassword(body.password)]);
        if (body.email) await db.query("update auth.users set email = $2, updated_at = now() where id = $1", [u.id, body.email]);
        if (body.data) await db.query("update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb, updated_at = now() where id = $1", [u.id, JSON.stringify(body.data)]);
        const fresh = (await db.query("select * from auth.users where id = $1", [u.id])).rows[0];
        return json(res, 200, userObject(fresh));
      }
      return json(res, 200, userObject(u));
    }
    if (p === "/logout") return json(res, 204, undefined);
    if (p === "/settings") return json(res, 200, { external: {}, disable_signup: true, mailer_autoconfirm: true });
    if (p === "/recover" || p === "/signup" || p === "/otp" || p === "/verify") return json(res, 400, { code: 400, msg: "Not available in the local demo" });
    return json(res, 404, { code: 404, msg: "Not found" });
  }

  // ── Edge functions (only the ones the demo needs) ──────────────
  async function handleFunction(req, res, url, body) {
    const name = url.pathname.replace(/^\/functions\/v1\//, "");
    const who = caller(req);
    if (who.role !== "authenticated" && who.role !== "service_role") return json(res, 200, { error: "Please sign in first." });
    const notInDemo = () => json(res, 200, { error: "This action is not available in the local demo." });
    switch (name) {
      case "csr-issue": return await csrIssue(res, who, body);
      default: return notInDemo();
    }
  }

  // ── The stand-in for the csr-issue edge function: the same steps, with the same PDF builder (bundled from supabase/functions/_shared/csrPdf.ts) ──
  let csrBuilder = null;
  async function csrBuilderModule() {
    if (!csrBuilder) {
      const { build } = await import("esbuild");
      const os = await import("node:os"), fsm = await import("node:fs"), pathm = await import("node:path"), { pathToFileURL, fileURLToPath } = await import("node:url");
      const root = pathm.resolve(pathm.dirname(fileURLToPath(import.meta.url)), "..");
      const outDir = fsm.mkdtempSync(pathm.join(os.tmpdir(), "csr-demo-"));
      const outfile = pathm.join(outDir, "csrPdf.mjs");
      await build({ entryPoints: [pathm.join(root, "supabase/functions/_shared/csrPdf.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
      csrBuilder = await import(pathToFileURL(outfile).href);
    }
    return csrBuilder;
  }
  async function csrIssue(res, who, body) {
    const answer = (status, payload) => json(res, status, payload);
    const recordId = String(body.recordId ?? "").trim(), reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    if (!recordId) return answer(400, { error: "Missing the renewal." });
    let prep;
    try { prep = await rest.withRole({ role: who.role, claims: who.claims }, async tx => (await tx.query("select public.csr_prepare($1, $2) r", [recordId, reason])).rows[0].r); }
    catch (e) { return answer(400, { error: String(e.message ?? e) }); }
    const link = (path, scholarId, term, schoolYear, csrNumber, version) => {
      const fileName = `Certificate of Scholarship Renewal - ${scholarId} - ${term} ${schoolYear}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
      const token = sign({ url: `csr-issued/${path}`, exp: Math.floor(Date.now() / 1000) + 3600 });
      return answer(200, { url: `http://127.0.0.1:${port}/storage/v1/object/sign/csr-issued/${path.split("/").map(encodeURIComponent).join("/")}?token=${token}&download=${encodeURIComponent(fileName)}`, csrNumber, version, fileName });
    };
    if (prep.ready) return link(prep.storage_path, prep.scholar_id_number, prep.term, prep.school_year, prep.csr_number, prep.version);
    const M = await csrBuilderModule();
    const d = prep.data, set = prep.settings;
    const picture = async path => {
      if (!path) return null;
      const row = (await db.query("select metadata from storage.objects where bucket_id = 'csr-assets' and name = $1", [path])).rows[0];
      return row?.metadata?.base64 ? new Uint8Array(Buffer.from(row.metadata.base64, "base64")) : null;
    };
    const pdf = await M.buildCsrPdf({
      csrNumber: prep.csr_number, version: prep.version, fullName: M.csrFullName(d.first_name, d.middle_name, d.last_name), scholarIdNumber: d.scholar_id_number, barangay: d.barangay,
      program: M.csrProgramCode(d.program, d.year_level), school: d.school, term: d.term, schoolYear: d.school_year, issuedAt: new Date(), place: set.place,
      officer: { name: set.officer_name, title: set.officer_title, signature: await picture(set.officer_signature_path) },
      mayor: { name: set.mayor_name, title: set.mayor_title, signature: await picture(set.mayor_signature_path), mark: await picture(set.mayor_mark_path) },
      qrUrl: `http://127.0.0.1:5173/CEDO/id?token=${prep.qr_token}`,
    });
    const path = `${d.scholar_id_number}/${prep.csr_number}-v${prep.version}.pdf`;
    await db.query("delete from storage.objects where bucket_id = 'csr-issued' and name = $1", [path]);
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('csr-issued', $1, $2::jsonb)", [path, JSON.stringify({ mimetype: "application/pdf", size: pdf.length, base64: Buffer.from(pdf).toString("base64") })]);
    try { await db.query("select public.csr_complete($1, $2)", [prep.csr_id, path]); } catch (e) { return answer(500, { error: String(e.message ?? e) }); }
    return link(path, d.scholar_id_number, d.term, d.school_year, prep.csr_number, prep.version);
  }

  // ── Storage (files kept in the private database, nothing leaves this computer) ──
  /** Pulls the file out of a multipart/form-data upload (what the website's storage client sends for a File). */
  function parseMultipart(buf, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!m) return null;
    const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
    const parts = [];
    let pos = buf.indexOf(boundary);
    while (pos >= 0) {
      const next = buf.indexOf(boundary, pos + boundary.length);
      if (next < 0) break;
      parts.push(buf.subarray(pos + boundary.length + 2, next - 2));   // skip the CRLF after the boundary and before the next one
      pos = next;
    }
    for (const p of parts) {
      const split = p.indexOf("\r\n\r\n");
      if (split < 0) continue;
      const head = p.subarray(0, split).toString("utf8");
      if (/name=""/.test(head) || /filename=/.test(head)) {
        return { data: p.subarray(split + 4), type: (/content-type:\s*([^\r\n]+)/i.exec(head) ?? [])[1] ?? "application/octet-stream" };
      }
    }
    return null;
  }

  /** Files are kept inside the private database (never on disk elsewhere). Access rules run as the caller, so the real storage policies apply. */
  const tusUploads = new Map();   // uploads in progress: id -> { bucket, name, type, length, chunks, received }
  async function handleStorage(req, res, url) {
    const who = caller(req);
    const asCaller = fn => rest.withRole({ role: who.role, claims: who.claims }, fn);
    const none = (status, message) => json(res, status, { statusCode: String(status), error: message, message });
    const p = url.pathname.replace(/^\/storage\/v1/, "");

    // ── Resumable (tus) uploads: what the website uses for files over 6 MB. POST creates, HEAD tells how much arrived, PATCH adds a chunk. ──
    const tusM = /^\/upload\/resumable(?:\/([^/]+))?$/.exec(p);
    if (tusM) {
      const tusHeaders = extra => ({ "tus-resumable": "1.0.0", ...extra });
      const decodeMeta = h => Object.fromEntries(String(h ?? "").split(",").map(s => s.trim()).filter(Boolean).map(s => { const [k, v] = s.split(" "); return [k, v ? Buffer.from(v, "base64").toString("utf8") : ""]; }));
      const storeObject = async (bucket, name, type, data) => asCaller(async tx => {
        await tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, $3::jsonb)",
          [bucket, name, JSON.stringify({ mimetype: type, size: data.length, base64: data.toString("base64") })]);
      });
      if (req.method === "POST" && !tusM[1]) {
        const meta = decodeMeta(req.headers["upload-metadata"]);
        const length = Number(req.headers["upload-length"]);
        const bucket = meta.bucketName, name = meta.objectName, type = meta.contentType || "application/octet-stream";
        if (!bucket || !name || !Number.isFinite(length)) return none(400, "Missing upload information");
        const bucketRow = (await db.query("select file_size_limit from storage.buckets where id = $1", [bucket])).rows[0];
        if (!bucketRow) return none(404, "Bucket not found");
        if (bucketRow.file_size_limit && length > Number(bucketRow.file_size_limit)) return none(413, "The object exceeded the maximum allowed size");
        const verdict = await asCaller(async tx => {
          if ((await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows.length > 0) throw new Error("__exists__");
          await tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, '{}'::jsonb)", [bucket, name]);
          throw new Error("__allowed__");
        }).then(() => "?", e => (e.message === "__allowed__" ? "ok" : e.message === "__exists__" ? "exists" : "denied"));
        if (verdict === "exists") return none(409, "The resource already exists");
        if (verdict !== "ok") return none(403, "new row violates row-level security policy");
        const id = crypto.randomUUID();
        const up = { bucket, name, type, length, chunks: [], received: 0 };
        tusUploads.set(id, up);
        const body = await readBody(req);
        if (body.length) { up.chunks.push(body); up.received += body.length; }
        const loc = `http://127.0.0.1:${port}/storage/v1/upload/resumable/${id}`;
        if (up.received >= up.length) { try { await storeObject(bucket, name, type, Buffer.concat(up.chunks)); } catch { return none(403, "new row violates row-level security policy"); } tusUploads.delete(id); }
        res.writeHead(201, tusHeaders({ location: loc, "upload-offset": String(up.received) }));
        return res.end();
      }
      const up = tusM[1] ? tusUploads.get(tusM[1]) : null;
      if (req.method === "HEAD") {
        if (!up) return none(404, "Not found");
        res.writeHead(200, tusHeaders({ "upload-offset": String(up.received), "upload-length": String(up.length), "cache-control": "no-store" }));
        return res.end();
      }
      if (req.method === "PATCH") {
        if (!up) return none(404, "Not found");
        if (Number(req.headers["upload-offset"]) !== up.received) { res.writeHead(409, tusHeaders({})); return res.end(); }
        const body = await readBody(req);
        up.chunks.push(body); up.received += body.length;
        if (up.received >= up.length) {
          try { await storeObject(up.bucket, up.name, up.type, Buffer.concat(up.chunks)); } catch { return none(403, "new row violates row-level security policy"); }
          tusUploads.delete(tusM[1]);
        }
        res.writeHead(204, tusHeaders({ "upload-offset": String(up.received) }));
        return res.end();
      }
      if (req.method === "DELETE") { tusUploads.delete(tusM[1]); res.writeHead(204, tusHeaders({})); return res.end(); }
      return none(405, "Method not allowed");
    }

    // Remove files: DELETE /object/<bucket> with { prefixes: [...] }
    let m = /^\/object\/([^/]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const removed = await asCaller(async tx => {
        const out = [];
        for (const name of body.prefixes ?? []) out.push(...(await tx.query("delete from storage.objects where bucket_id = $1 and name = $2 returning name", [m[1], name])).rows);
        return out;
      }).catch(e => ({ error: e }));
      if (removed.error) return none(403, String(removed.error.message));
      return json(res, 200, removed.map(r => ({ name: r.name })));
    }
    // Signed link: POST /object/sign/<bucket>/<path>
    m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p);
    if (m && req.method === "POST") {
      const name = decodeURIComponent(m[2]);
      const found = await asCaller(async tx => (await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [m[1], name])).rows.length > 0).catch(() => false);
      if (!found) return none(400, "Object not found");
      const token = sign({ url: `${m[1]}/${name}`, exp: Math.floor(Date.now() / 1000) + 3600 });
      return json(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` });
    }
    m = /^\/object\/(?:(public|sign|authenticated)\/)?([^/]+)\/(.+)$/.exec(p);
    if (!m) return none(404, "Not found");
    const [, mode, bucket, objectPath] = m;
    const name = decodeURIComponent(objectPath);

    if (req.method === "GET" || req.method === "HEAD") {
      let allowed = false;
      if (mode === "sign") allowed = verify(url.searchParams.get("token"))?.url === `${bucket}/${name}`;
      else if (mode === "public") allowed = !!(await db.query("select 1 from storage.buckets where id = $1 and public", [bucket])).rows.length;
      else allowed = await asCaller(async tx => (await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows.length > 0).catch(() => false);
      if (!allowed) return none(404, "Object not found");
      const row = (await db.query("select metadata from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows[0];
      if (!row) return none(404, "Object not found");
      const meta = row.metadata ?? {};
      // The real storage saves the file under the name asked for with ?download=<name> (the study plan form and the certificate use it).
      const asked = url.searchParams.get("download");
      res.writeHead(200, { "content-type": meta.mimetype ?? "application/octet-stream", ...(asked ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asked)}` } : {}) });
      return res.end(req.method === "HEAD" ? undefined : Buffer.from(meta.base64 ?? "", "base64"));
    }
    if (req.method === "POST" || req.method === "PUT") {
      const raw = await readBody(req);
      const ct = String(req.headers["content-type"] ?? "application/octet-stream");
      const file = /multipart\/form-data/i.test(ct) ? parseMultipart(raw, ct) : { data: raw, type: ct };
      if (!file) return none(400, "Could not read the upload");
      const bucketRow = (await db.query("select file_size_limit, allowed_mime_types from storage.buckets where id = $1", [bucket])).rows[0];
      if (!bucketRow) return none(404, "Bucket not found");
      if (bucketRow.file_size_limit && file.data.length > Number(bucketRow.file_size_limit)) return none(413, "The object exceeded the maximum allowed size");
      if (bucketRow.allowed_mime_types && !bucketRow.allowed_mime_types.includes(file.type)) return none(415, "mime type " + file.type + " is not supported");
      try {
        await asCaller(async tx => {
          const exists = (await tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows.length > 0;
          if (exists && req.headers["x-upsert"] !== "true") { const e = new Error("The resource already exists"); e.code = "23505"; throw e; }
          if (exists) await tx.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, name]);
          await tx.query("insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, $3::jsonb)",
            [bucket, name, JSON.stringify({ mimetype: file.type, size: file.data.length, base64: file.data.toString("base64") })]);
        });
      } catch (e) {
        return none(e.code === "23505" ? 409 : 403, e.code === "23505" ? String(e.message) : "new row violates row-level security policy");
      }
      return json(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    }
    return none(405, "Method not allowed");
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
      "access-control-expose-headers": "Content-Range, Content-Type, Location, Upload-Offset, Upload-Length, Tus-Resumable",
      "access-control-max-age": "600",
    };
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://localhost:${port}`);
    try {
      if (url.pathname.startsWith("/storage/v1/")) return await handleStorage(req, res, url);
      const raw = await readBody(req);
      let body;
      if (raw.length && /json/.test(String(req.headers["content-type"] ?? ""))) {
        try { body = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { code: "PGRST102", message: "Empty or invalid json" }); }
      }
      if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url, body ?? {});
      if (url.pathname.startsWith("/functions/v1/")) return await handleFunction(req, res, url, body ?? {});
      if (url.pathname.startsWith("/rest/v1")) {
        const who = caller(req);
        if (!who.valid) return json(res, 401, { code: "PGRST301", message: "JWT expired", details: null, hint: null });
        const out = await rest.handle({
          method: req.method, path: url.pathname.replace(/^\/rest\/v1/, ""), params: url.searchParams,
          headers: req.headers, body, role: who.role, claims: who.claims,
        });
        res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", ...(out.headers ?? {}) });
        return res.end(out.body);
      }
      if (url.pathname === "/" || url.pathname === "/health") return json(res, 200, { ok: true, localdemo: true });
      return json(res, 404, { message: "Not found" });
    } catch (e) {
      log(`server error on ${req.method} ${req.url}: ${e.stack ?? e}`);
      return json(res, 500, { message: String(e.message ?? e) });
    }
  });

  // Live-updates channel: accepts the website's connection and answers politely, but sends no changes (the demo has none).
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", ws => {
    ws.on("message", data => {
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      const arr = Array.isArray(m);
      const [joinRef, ref, topic, event] = arr ? m : [m.join_ref, m.ref, m.topic, m.event];
      const reply = payload => ws.send(JSON.stringify(arr ? [joinRef, ref, topic, "phx_reply", payload] : { join_ref: joinRef, ref, topic, event: "phx_reply", payload }));
      if (event === "heartbeat") reply({ status: "ok", response: {} });
      else if (event === "phx_join") reply({ status: "ok", response: { postgres_changes: [] } });
      else if (event === "phx_leave") reply({ status: "ok", response: {} });
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!String(req.url).startsWith("/realtime/v1/websocket")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  // The stand-in for the real project's scheduler (pg_cron): once a minute, send due consultation reminders, notice INC deadlines that passed,
  // and send the INC / window-closing reminders.
  const runJobs = () => db.query("select public.renewal_run_scheduled_jobs()").catch(() => {});
  void runJobs();
  const jobsTimer = setInterval(runJobs, 60_000);
  // The stand-in for the push-sender function: it takes the waiting push messages the same way the real function does (push_claim) and
  // reports every device as "delivered" (push_report). Nothing leaves this computer; the line it prints is the only trace of a "push".
  const runPush = async () => {
    try {
      const claimed = (await db.query("select public.push_claim(50) c")).rows[0].c ?? [];
      for (const m of claimed) {
        console.error(`[demo push] "${m.title}" -> ${m.subscriptions.length} device(s)`);
        await db.query("select public.push_report($1, $2::jsonb)", [m.id, JSON.stringify(m.subscriptions.map(s => ({ endpoint: s.endpoint, status: 201 })))]);
      }
    } catch { /* the push tables are not there yet (an older database) */ }
  };
  const pushTimer = setInterval(runPush, 15_000);
  return {
    url: `http://127.0.0.1:${port}`, port, rest,
    close: () => new Promise(r => { clearInterval(jobsTimer); clearInterval(pushTimer); wss.close(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}

export { ANON_KEY, SERVICE_KEY };
