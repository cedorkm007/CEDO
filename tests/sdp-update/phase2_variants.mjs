// Experiment (TEST data): can the whole-list calculation be made cheaper? Compares the current function with a variant, same answers required.
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import { addManyScholars } from "../../localdemo/many.mjs";
import fs from "node:fs";
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db); await addManyScholars(db, 8000);
await db.query("set timezone to 'UTC'");
const src = fs.readFileSync("supabase_migration_sdp_update_p2_checklist_paging.sql", "utf8");
const s0 = src.indexOf("create or replace function public._sdp_period_totals_ids("); const cur = src.slice(s0, src.indexOf("$$;", s0) + 3);
let variant = cur.replace("public._sdp_period_totals_ids(", "public._sdp_period_totals_v2(");
const e0 = variant.indexOf("  earned as ("), e1 = variant.indexOf("  pairs as (");
variant = variant.slice(0, e0) + `  earned as (
    select x.scholar_id_number, x.category, x.rn, sum(x.amt)::integer as amt
    from (
      select a.scholar_id_number, act.category, pr.rn, sum(act.credits::integer) as amt
      from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      join periods pr on pr.school_year = a.school_year and pr.semester = a.semester
      where act.category is not null and pr.rn <= (select t.rn from target t) and (p_ids is null or a.scholar_id_number = any(p_ids))
      group by a.scholar_id_number, act.category, pr.rn
      union all
      select rc.scholar_id_number, rc.category, pr.rn, sum(rc.amount)
      from public.sdp_reserved_credits rc
      join periods pr on pr.school_year = rc.source_school_year and pr.semester = rc.source_semester
      where pr.rn <= (select t.rn from target t) and (p_ids is null or rc.scholar_id_number = any(p_ids))
      group by rc.scholar_id_number, rc.category, pr.rn
    ) x
    group by x.scholar_id_number, x.category, x.rn
  ),
` + variant.slice(e1);
await db.query(variant);
const t = async (label, sql) => { const s = performance.now(); const r = (await db.query(sql)).rows; console.log(label.padEnd(40), Math.round(performance.now() - s), "ms", r.length); return r; };
for (let i = 0; i < 2; i++) {
  const a = await t("current", "select * from public._sdp_period_totals_ids('2025-2026','2nd Semester', null) order by 1,2");
  const b = await t("variant", "select * from public._sdp_period_totals_v2('2025-2026','2nd Semester', null) order by 1,2");
  console.log("same:", JSON.stringify(a) === JSON.stringify(b));
}
