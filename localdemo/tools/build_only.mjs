// localdemo/tools/build_only.mjs — rebuilds the local database without starting anything, and prints a summary.
import { buildDb, REPORT } from "../build.mjs";
const t0 = Date.now();
const { db, ok, failed, added, files } = await buildDb({ onProgress: m => { if (process.stdout.isTTY) process.stdout.write(`\r${m}                    `); } });
console.log(`\nBuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${files.length} files, ${ok} statements ok, ${failed.length} still failing, ${added.created} tables created from structure, ${added.columnsAdded} columns added.`);
console.log("Report:", REPORT);
await db.close();
