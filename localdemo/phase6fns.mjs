// localdemo/phase6fns.mjs — local stand-ins for the account edge functions Phase 6 changed (SDP Monitoring update), so the demo can show the real screens:
// "a new account / a reset gives a random temporary password shown once", "the person must choose a new password at first sign-in", and the scholar
// "forgot my password" flow with its wrong-answer limit. They use the very same shared logic as the real functions (bundled from supabase/functions/_shared)
// and the real database functions; only the connection to Supabase's account service is replaced by direct changes to the local database.
import crypto from "node:crypto";
import { hashPassword } from "./jwt.mjs";

let shared = null;
async function sharedModule() {
  if (shared) return shared;
  const { build } = await import("esbuild");
  const os = await import("node:os"), fsm = await import("node:fs"), pathm = await import("node:path"), { pathToFileURL, fileURLToPath } = await import("node:url");
  const root = pathm.resolve(pathm.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = fsm.mkdtempSync(pathm.join(os.tmpdir(), "phase6-demo-"));
  const entry = pathm.join(outDir, "entry.ts");
  const fwd = p => p.replace(/\\/g, "/");
  fsm.writeFileSync(entry, `export * from "${fwd(root)}/supabase/functions/_shared/passwordPolicy.ts";\nexport * from "${fwd(root)}/supabase/functions/_shared/scholarSelfReset.ts";\n`);
  const outfile = pathm.join(outDir, "shared.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
  shared = await import(pathToFileURL(outfile).href);
  return shared;
}

export function makePhase6Functions({ db, hasVerifiedFactor = () => false, sessionLevel = () => null }) {
  const q = (sql, params = []) => db.query(sql, params);

  async function setTemporaryPassword(userId) {
    const { generateTemporaryPassword } = await sharedModule();
    const password = generateTemporaryPassword();
    await q("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [userId, hashPassword(password)]);
    await q("select public.flag_password_change($1::uuid, 'temporary_password')", [userId]);
    return password;
  }

  async function callerIsItAdmin(who) {
    const row = (await q("select username from public.users where id = $1", [who.claims.sub])).rows[0];
    return row && String(row.username).toLowerCase() === "it.admin1";
  }
  /** Like the real functions: once an authenticator app is set up, a session that did not pass the code check is refused. */
  const needsCode = who => hasVerifiedFactor(who.claims.sub) && sessionLevel(who) !== "aal2";
  const TWO_STEP = { status: 403, json: { error: "Two-step sign-in is required. Sign out, sign in again, and enter the code from your authenticator app." } };

  return {
    /** Public (no sign-in), like the real one. */
    async "scholar-self-reset-password"(body, ip = "127.0.0.1") {
      const { handleScholarSelfReset } = await sharedModule();
      const deps = {
        gate: async (identity, address) => {
          try { await q("select public.scholar_reset_gate($1, $2)", [identity, address]); return null; }
          catch { return "Too many attempts. Please wait a while and try again, or ask the SEAD office to reset your password."; }
        },
        isLocked: async identity => (await q("select public.scholar_reset_is_locked($1) as r", [identity])).rows[0].r === true,
        registerFailure: async (identity, address) => { await q("select public.scholar_reset_register_failure($1, $2)", [identity, address]); },
        clearFailures: async identity => { await q("select public.scholar_reset_clear($1)", [identity]); },
        findScholar: async id => (await q("select id, first_name, last_name, security_question from public.scholars where scholar_id_number = $1", [id])).rows[0] ?? null,
        verifyAnswer: async (scholarId, answer) => (await q("select public.verify_scholar_security_answer($1::uuid, $2) as r", [scholarId, answer])).rows[0].r === true,
        setPassword: async (scholarId, password) => {
          await q("update auth.users set encrypted_password = $2, updated_at = now() where id = $1", [scholarId, hashPassword(password)]);
          return null;
        },
        log: async () => {},
      };
      const result = await handleScholarSelfReset(body, ip, deps);
      return { status: result.status, json: result.body };
    },

    async "it-reset-staff-password"(body, who) {
      if (!(await callerIsItAdmin(who))) return { status: 403, json: { error: "This account is not authorized to create staff accounts." } };
      if (needsCode(who)) return TWO_STEP;
      const target = (await q("select id, first_name, last_name from public.users where id = $1", [body.id])).rows[0];
      if (!target) return { status: 404, json: { error: "Account not found." } };
      const password = await setTemporaryPassword(target.id);
      return { status: 200, json: { ok: true, name: `${target.first_name} ${target.last_name}`, temporaryPassword: password } };
    },

    async "it-create-staff-account"(body, who) {
      if (!(await callerIsItAdmin(who))) return { status: 403, json: { error: "This account is not authorized to create staff accounts." } };
      if (needsCode(who)) return TWO_STEP;
      const username = String(body.username ?? "").trim(), email = String(body.email ?? "").trim();
      if (!body.lastName || !body.firstName || !username || !email || !body.division) return { status: 400, json: { error: "Last name, first name, username, email, and division are required." } };
      if ((await q("select 1 from public.users where username = $1", [username])).rows.length) return { status: 409, json: { error: `Username "${username}" is already taken.` } };
      const id = crypto.randomUUID();
      await q("insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, now(), '{}'::jsonb)", [id, email, hashPassword("placeholder-never-used")]);
      await q(`insert into public.users (id, username, last_name, first_name, middle_name, email, is_admin, division, role, profile_picture)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '')`,
        [id, username, body.lastName, body.firstName, body.middleName ?? "", email, (body.role ?? "staff") !== "staff", body.division, body.role ?? "staff"]);
      const password = await setTemporaryPassword(id);
      return { status: 200, json: { ok: true, username, temporaryPassword: password, defaultPassword: password } };
    },

    async "sead-reset-scholar-password"(body) {
      const target = (await q("select id, first_name, last_name from public.scholars where scholar_id_number = $1", [String(body.scholarIdNumber ?? "")])).rows[0];
      if (!target) return { status: 404, json: { error: `No scholar found with ID ${body.scholarIdNumber}.` } };
      const password = await setTemporaryPassword(target.id);
      return { status: 200, json: { ok: true, name: `${target.first_name} ${target.last_name}`, temporaryPassword: password } };
    },
  };
}
