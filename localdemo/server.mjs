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
      default: return notInDemo();
    }
  }

  // ── Storage (files kept in the private database, nothing leaves this computer) ──
  async function handleStorage(req, res, url) {
    const m = /^\/storage\/v1\/object\/(?:(public|sign|authenticated)\/)?([^/]+)\/(.+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { statusCode: "404", error: "not_found", message: "Not found" });
    const [, , bucket, objectPath] = m;
    const name = decodeURIComponent(objectPath);
    if (req.method === "GET") {
      const row = (await db.query("select metadata from storage.objects where bucket_id = $1 and name = $2", [bucket, name])).rows[0];
      if (!row) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      const meta = row.metadata ?? {};
      res.writeHead(200, { "content-type": meta.mimetype ?? "application/octet-stream" });
      return res.end(Buffer.from(meta.base64 ?? "", "base64"));
    }
    if (req.method === "POST" || req.method === "PUT") {
      const buf = await readBody(req);
      const type = String(req.headers["content-type"] ?? "application/octet-stream");
      await db.query("insert into storage.buckets (id, name, public) values ($1, $1, true) on conflict (id) do nothing", [bucket]);
      await db.query(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)
        on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()`, [bucket, name, JSON.stringify({ mimetype: type, size: buf.length, base64: buf.toString("base64") })]);
      return json(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    }
    if (req.method === "DELETE") {
      await db.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, name]);
      return json(res, 200, { message: "Successfully deleted" });
    }
    return json(res, 405, { message: "Method not allowed" });
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
      "access-control-expose-headers": "Content-Range, Content-Type",
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
  return {
    url: `http://127.0.0.1:${port}`, port, rest,
    close: () => new Promise(r => { wss.close(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}

export { ANON_KEY, SERVICE_KEY };
