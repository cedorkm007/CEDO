// tests/sdp-update/phase3_screen_checks.mjs — what the Phase 3 screens must do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase3_screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };
const read = f => fs.readFileSync(f, "utf8");
const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts"), scholarApi = read("src/scholar/sdpApi.ts");
const sel = read("src/sead/components/SubCategorySelect.tsx"), light = read("src/sead/components/LightweightActivityEditModal.tsx");
const hist = read("src/sead/components/SDPHistoryModal.tsx"), exp = read("src/sead/scholarProfileExport.ts");
const panel = read("src/scholar/components/dashboard/SDPPanel.tsx"), cal = read("src/scholar/components/dashboard/CalendarAndActivitiesPanel.tsx");
const after = (src, marker) => src.slice(src.indexOf(marker));

check("the three sub-categories are School-based, Community-based and CEDO Projects", /school_based.*School-based/s.test(scholarApi) && /community_based.*Community-based/s.test(scholarApi) && /cedo_projects.*CEDO Projects/s.test(scholarApi));
check("a sub-category is chosen right after the category buttons in “+ New Approved Activity”, and is required", /<CategorySelect value=\{category\} onChange=\{setCategory\} \/>\s*<\/div>\s*\{subSupported && \(\s*<div>\s*<label[^>]*>SDP Sub-category<\/label>\s*<SubCategorySelect/.test(after(tab, "function NewActivityModal")) && /if \(subSupported && !subCategory\) \{ setError\("Choose a sub-category/.test(after(tab, "function NewActivityModal")));
check("the sub-category can be changed in Activity Details, and is required there too", /SDP Sub-category/.test(after(tab, "function DetailModal")) && (after(tab, "function DetailModal").match(/if \(subSupported && !subCategory\)/g) || []).length >= 1);
check("the sub-category buttons wait for a category (a sub-category cannot exist without one)", /disabled=\{!hasCategory\}/.test(sel) && /Choose a category first/.test(sel));
check("each category card shows one column per sub-category and “No activities” in an empty column", /SDP_SUBCATEGORIES\.map\(sc => <SubCategoryColumn/.test(tab) && /No activities<\/p>/.test(tab));
check("a fourth “No sub-category” column appears only when some activity has none", /withoutSub\.length > 0 && <SubCategoryColumn label="No sub-category"/.test(tab) && /withoutSub\.length > 0 \? "md:grid-cols-4" : "md:grid-cols-3"/.test(tab));
check("the columns stack on a phone and sit side by side on a wide screen", /grid grid-cols-1 /.test(tab) && /md:grid-cols-3/.test(tab));
check("there is a sub-category filter (All, School-based, Community-based, CEDO Projects) that works together with the search", /aria-label="Filter by sub-category"/.test(tab) && /subFilter !== "all" && a\.subCategory !== subFilter/.test(tab) && /a\.name\.toLowerCase\(\)\.includes\(q\)/.test(after(tab, "function ActivitiesSection")));
check("the activity window header shows the category and the sub-category", /categoryLabel\(activity\.category\)[\s\S]{0,200}subCategoryLabel\(activity\.subCategory\)/.test(after(tab, "function DetailModal")));
check("a sub-category change is shown in the activity's history", /Sub-category changed:/.test(tab) && /d\.field === "sub_category"/.test(tab));
check("the scholar's SDP History window has a Sub-category column", /label="Sub-category"/.test(hist) && /subCategoryLabel\(r\.subCategory\)/.test(hist));
check("the scholar profile export (CSV, PDF, Word, preview) has a Sub-category column", /columns: \["Activity", "Category", "Sub-category", "Date"\]/.test(exp) && /toCsv\(\["Activity", "Category", "Sub-category", "Date"\]/.test(exp) && /Sub-category/.test(read("src/lib/docGenerator.ts")) && /Sub-category/.test(read("src/sead/components/ScholarProfilePreviewModal.tsx")));
check("the scholar portal shows the sub-category on the activity card and in the calendar list", /subCategoryLabel\(act\.subCategory\)/.test(panel) && /a\.subLabel/.test(cal));
check("a monitor can set the sub-category of an activity of theirs that has a category", /showSubCategory = !!sdpActivity && !!sdpActivity\.category/.test(light) && /<SubCategorySelect/.test(light));
check("before the database update the sub-category choices are hidden and nothing about them is sent (the page works as before)", /isSubCategorySupported\(\)/.test(tab) && /subCategoryColumnPresent = "sub_category" in data\[0\]/.test(api) && /mentionsSubCategory\(error\.message\)/.test(api));
check("the compliance rule is untouched: nothing about sub-categories reaches the Checklist or the credit functions", !/sub_?category/i.test(after(tab, "function ChecklistSection")) && !/sub_category/.test(read("supabase_migration_sdp_update_p2b_saved_results.sql")));
check("the Checklist table is smaller so it fits without sideways scrolling (12 px text, tighter spacing, names can wrap)", /<table className="w-full text-\[12px\]"/.test(tab) && /px-2\.5 py-2\.5/.test(after(tab, "function ChecklistSection")) && !/px-5 py-3 whitespace-nowrap/.test(after(tab, "function ChecklistSection")));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
