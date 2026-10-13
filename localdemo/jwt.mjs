// localdemo/jwt.mjs — tiny HS256 token helpers for the local demo (never used by the website or the real project).
import crypto from "node:crypto";

export const SECRET = process.env.LOCALDEMO_JWT_SECRET || "localdemo-only-secret-change-me-0123456789abcdef";
const b64 = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const mac = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

export function sign(payload, secret = SECRET) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  return `${head}.${body}.${mac(`${head}.${body}`, secret)}`;
}

/** The token's claims, or null when it is malformed, wrongly signed or expired. */
export function verify(token, secret = SECRET) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const expected = mac(`${parts[0]}.${parts[1]}`, secret);
  const a = Buffer.from(parts[2]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

const FAR = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10;
export const ANON_KEY = sign({ role: "anon", iss: "localdemo", exp: FAR });
export const SERVICE_KEY = sign({ role: "service_role", iss: "localdemo", exp: FAR });

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}
export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = crypto.scryptSync(password, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
