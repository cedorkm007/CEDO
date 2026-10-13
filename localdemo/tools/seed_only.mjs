// localdemo/tools/seed_only.mjs — rebuilds the local database AND loads the hypothetical data, then prints a short summary.
import { buildDb } from "../build.mjs";
import { seedDb } from "../seed.mjs";
const { db } = await buildDb({});
await seedDb(db);
for (const t of ["schools", "users", "staff_account_tags", "scholars", "scholar_subjects_grades", "sdp_attendance", "scholar_status_history", "school_accounts"])
  console.log(t.padEnd(28), (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n);
await db.close();
