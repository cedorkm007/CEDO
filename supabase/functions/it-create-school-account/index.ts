import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";
import { issueTemporaryPassword, markMustChangePassword } from "../_shared/temporaryPassword.ts";
import { generateTemporaryPassword } from "../_shared/passwordPolicy.ts";

// Every new school account starts on a RANDOM temporary password, shown once to the administrator. Any password typed in the request is ignored.

// Must match the format check in supabase_migration_school_account_username.sql
// and validateSchoolUsername() in src/itadmin/schoolAccountsApi.ts. The
// username is also the local part of the hidden login email, so it has to be
// a valid one: lowercase letters/digits, single '.', '_' or '-' between them.
const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;

// Same placeholder-email convention as scholars (<id>@scholars.cedo.local):
// nobody types or receives mail here, it only gives Supabase Auth an email.
const SCHOOL_LOGIN_EMAIL_DOMAIN = "schools.cedo.local";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireItAdmin(req);
    const body = await req.json();

    const schoolId = String(body.schoolId ?? "").trim();
    const username = String(body.username ?? "").trim().toLowerCase();
    const legacyEmail = String(body.email ?? "").trim();
    const usingUsername = username.length > 0;

    if (!schoolId) return json({ error: "School is required." }, 400);

    let loginEmail: string;
    let accountPassword: string;
    if (usingUsername) {
      if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_PATTERN.test(username)) {
        return json({ error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: lowercase letters and numbers, with single dots, dashes, or underscores between them.` }, 400);
      }
      loginEmail = `${username}@${SCHOOL_LOGIN_EMAIL_DOMAIN}`;
      accountPassword = generateTemporaryPassword();
    } else if (legacyEmail) {
      loginEmail = legacyEmail;
      accountPassword = generateTemporaryPassword();
    } else {
      return json({ error: "School and username are required." }, 400);
    }

    const { data: school, error: schoolLookupError } = await admin.from("schools").select("id, name").eq("id", schoolId).maybeSingle();
    if (schoolLookupError || !school) return json({ error: "School not found." }, 404);

    const { data: existingAccount } = await admin.from("school_accounts").select("id").eq("school_id", schoolId).maybeSingle();
    if (existingAccount) return json({ error: `"${school.name}" already has an account.` }, 409);

    // The login email is derived from the username, so checking it covers
    // both a taken username and a taken legacy email in one lookup.
    const { data: existingLogin } = await admin.from("school_accounts").select("id").ilike("email", loginEmail).maybeSingle();
    if (existingLogin) {
      return json({ error: usingUsername ? `The username "${username}" is already taken.` : `An account with email "${legacyEmail}" already exists.` }, 409);
    }

    // email_confirm: true — created already-confirmed, so no confirmation
    // email is ever sent (sidesteps Supabase's built-in email rate limit,
    // same fix as staff/scholar accounts).
    const { data: authUser, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail, password: accountPassword, email_confirm: true,
      user_metadata: { schoolId, kind: "school" },
    });
    if (createError || !authUser?.user) return json({ error: createError?.message ?? "Failed to create login." }, 500);

    const { error: insertError } = await admin.from("school_accounts").insert({
      id: authUser.user.id, school_id: schoolId, email: loginEmail,
      ...(usingUsername ? { username } : {}),
    });
    if (insertError) {
      // Roll back the orphaned auth user if the account row insert failed.
      await admin.auth.admin.deleteUser(authUser.user.id);
      return json({ error: insertError.message }, 500);
    }

    const markError = await markMustChangePassword(admin, authUser.user.id);
    if (markError) {
      // Never leave an account with a temporary password that does not have to be changed.
      await admin.from("school_accounts").delete().eq("id", authUser.user.id);
      await admin.auth.admin.deleteUser(authUser.user.id);
      return json({ error: "The account could not be marked to choose a new password at sign-in, so it was not created. Run the Phase 6 database update first." }, 500);
    }

    return json({
      ok: true, schoolName: school.name, ...(usingUsername ? { username } : {}),
      temporaryPassword: accountPassword, defaultPassword: accountPassword,
    }, 200);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return json({ error: "Unexpected error." }, 500);
  }
});
