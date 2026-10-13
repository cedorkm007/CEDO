# Scholar Renewal System tests

| File | What it checks | How to run |
|---|---|---|
| `run.mjs` | Website side of the grade rules (Phase 1): passed / failed / INC / DRP, the school's passing mark (both directions, letter schools), scenarios 7, 8, 9, 10, 13, 15, 26, 27, INC/DRP accepted when a school enters grades, remarks in the CSV, and source guards (one shared rule, readable text). | `node tests/renewal/run.mjs` — no database or browser needed. |
| `outcome_cases.json` | One table of grade → outcome cases, used by BOTH `run.mjs` (website) and `db/run_db_tests.mjs` (database function `_grade_outcome`) so the two can never disagree. | (data file) |
| `db/run_db_tests.mjs` | The Phase 1 database changes in a scratch Postgres (nothing real is touched): passing mark, INC/DRP, remarks, `_grade_outcome`, SDP Complied / Not complied (scenarios 1–3 and Summer), status history, the status-history backfill preview/apply scripts, and that every earlier grades SQL guard still passes. | Needs PGlite once: `npm i --no-save @electric-sql/pglite`, then `node tests/renewal/db/run_db_tests.mjs`. |
| `phase1_guard.sql` | The same ideas against the **live** (or staging) database, acting as the first school account. | Paste into the Supabase SQL Editor after the Phase 1 migration; every line should say `PASS`. It rolls itself back. |

Scenario numbers refer to the owner's 32-scenario table in the Phase 0 plan.
