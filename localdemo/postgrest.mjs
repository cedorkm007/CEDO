// localdemo/postgrest.mjs — answers the website's database requests (the same ones it sends to Supabase's /rest/v1) using the private
// local database: table reads with filters, joins to related tables, ordering, paging and counts; inserts, updates and deletes; and
// calls to database functions (rpc). Every request runs as the signed-in person's database role, so the REAL row-level-security rules,
// permissions and triggers apply exactly as they would on the real project.
//
// Local demo only. Covers what this website uses, not all of PostgREST.

const esc = s => String(s).replace(/'/g, "''");
const L = v => `'${esc(v)}'`;                       // untyped literal: Postgres takes the column's / parameter's own type
const Q = n => `"${String(n).replace(/"/g, '""')}"`;

class HttpError extends Error { constructor(status, code, message, details = null, hint = null) { super(message); this.status = status; this.code = code; this.details = details; this.hint = hint; } }

// ── parsing helpers ─────────────────────────────────────────────
/** Splits at top-level commas (not inside parentheses or double quotes). */
function splitTop(s) {
  const out = []; let depth = 0, cur = "", inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") { inQ = !inQ; cur += c; continue; }
    if (!inQ) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** "id, name, schools(name), scholars!inner(a,b), alias:col" -> a tree. */
function parseSelect(str) {
  const items = [];
  for (const raw of splitTop(str)) {
    const tok = raw.trim();
    if (!tok) continue;
    if (tok === "*") { items.push({ kind: "star" }); continue; }
    const emb = /^(?:(\w+):)?(\w+)((?:![\w]+)*)\(([\s\S]*)\)$/.exec(tok);
    if (emb) {
      const hints = emb[3].split("!").filter(Boolean);
      const inner = hints.includes("inner");
      const hint = hints.find(h => h !== "inner" && h !== "left");
      items.push({ kind: "embed", alias: emb[1] || emb[2], rel: emb[2], hint, inner, items: parseSelect(emb[4]) });
      continue;
    }
    const col = /^(?:(\w+):)?(\w+(?:->>?\w+)*)(?:::(\w+))?$/.exec(tok);
    if (!col) throw new HttpError(400, "PGRST100", `Unsupported select item: ${tok}`);
    items.push({ kind: "col", alias: col[1], expr: col[2], cast: col[3] });
  }
  return items;
}

function colExpr(alias, expr) {
  const parts = expr.split(/(->>|->)/);
  let sql = `${alias}.${Q(parts[0])}`;
  for (let i = 1; i < parts.length; i += 2) sql += `${parts[i]}${L(parts[i + 1])}`;
  return sql;
}

function listValues(val) {
  const inner = val.trim().replace(/^\(/, "").replace(/\)$/, "");
  return splitTop(inner).map(x => { const t = x.trim(); return t.startsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"') : t; });
}

/** One PostgREST condition ("eq.5", "not.in.(1,2)", "is.null") on an expression. */
function condition(expr, opValue) {
  let s = String(opValue), neg = false;
  if (s.startsWith("not.")) { neg = true; s = s.slice(4); }
  const dot = s.indexOf(".");
  if (dot < 0) throw new HttpError(400, "PGRST100", `Bad filter: ${opValue}`);
  const op = s.slice(0, dot), val = s.slice(dot + 1);
  let sql;
  switch (op) {
    case "eq": sql = `${expr} = ${L(val)}`; break;
    case "neq": sql = `${expr} <> ${L(val)}`; break;
    case "gt": sql = `${expr} > ${L(val)}`; break;
    case "gte": sql = `${expr} >= ${L(val)}`; break;
    case "lt": sql = `${expr} < ${L(val)}`; break;
    case "lte": sql = `${expr} <= ${L(val)}`; break;
    case "like": sql = `${expr} like ${L(val.replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${expr} ilike ${L(val.replace(/\*/g, "%"))}`; break;
    case "match": sql = `${expr} ~ ${L(val)}`; break;
    case "imatch": sql = `${expr} ~* ${L(val)}`; break;
    case "in": { const vs = listValues(val); sql = vs.length ? `${expr} in (${vs.map(L).join(", ")})` : "false"; break; }
    case "is": sql = /^(null|true|false|unknown)$/i.test(val) ? `${expr} is ${val.toLowerCase()}` : "false"; break;
    case "cs": sql = `${expr} @> ${L(val)}`; break;
    case "cd": sql = `${expr} <@ ${L(val)}`; break;
    case "ov": sql = `${expr} && ${L(val)}`; break;
    default: throw new HttpError(400, "PGRST100", `Unsupported filter operator: ${op}`);
  }
  return neg ? `not (${sql})` : sql;
}

/** or=(a.eq.1,and(b.gt.2,c.lt.3)) */
function logicalGroup(alias, kind, valueStr) {
  const inner = valueStr.trim().replace(/^\(/, "").replace(/\)$/, "");
  const parts = splitTop(inner).map(p => {
    const t = p.trim();
    const nested = /^(and|or|not\.and|not\.or)\(([\s\S]*)\)$/.exec(t);
    if (nested) {
      const neg = nested[1].startsWith("not.");
      const sql = logicalGroup(alias, nested[1].replace("not.", ""), `(${nested[2]})`);
      return neg ? `not ${sql}` : sql;
    }
    const m = /^([\w>-]+)\.(.+)$/.exec(t);
    if (!m) throw new HttpError(400, "PGRST100", `Bad logical filter: ${t}`);
    return condition(colExpr(alias, m[1]), m[2]);
  });
  return `(${parts.join(kind === "or" ? " or " : " and ")})`;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export class RestApi {
  constructor(db) { this.db = db; this.meta = null; this.fnCache = new Map(); }

  async loadMeta() {
    const cols = new Map();
    for (const r of (await this.db.query("select table_name, column_name, udt_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position")).rows) {
      if (!cols.has(r.table_name)) cols.set(r.table_name, new Map());
      cols.get(r.table_name).set(r.column_name, r.udt_name);
    }
    const fks = (await this.db.query(`
      select c.conname as name, rel.relname as tbl, a.attname as col, frel.relname as reftbl, fa.attname as refcol
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid join pg_class frel on frel.oid = c.confrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
      where c.contype = 'f' and array_length(c.conkey, 1) = 1 and rel.relnamespace = 'public'::regnamespace and frel.relnamespace = 'public'::regnamespace`)).rows;
    const pks = new Map();
    for (const r of (await this.db.query(`select rel.relname as tbl, a.attname as col from pg_constraint c join pg_class rel on rel.oid = c.conrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'p' and rel.relnamespace = 'public'::regnamespace`)).rows) {
      if (!pks.has(r.tbl)) pks.set(r.tbl, []);
      pks.get(r.tbl).push(r.col);
    }
    this.meta = { cols, fks, pks };
    this.fnCache.clear();
  }

  // ── relations for embedded selects ──
  resolveRel(parent, name, hint) {
    const { fks } = this.meta;
    let cands = [
      ...fks.filter(f => f.tbl === parent && f.reftbl === name).map(f => ({ kind: "one", tbl: name, parentCol: f.col, childCol: f.refcol, fk: f })),
      ...fks.filter(f => f.reftbl === parent && f.tbl === name).map(f => ({ kind: "many", tbl: name, parentCol: f.refcol, childCol: f.col, fk: f })),
    ];
    if (hint) { const h = cands.filter(c => c.fk.col === hint || c.fk.name === hint); if (h.length) cands = h; }
    if (cands.length === 0) throw new HttpError(400, "PGRST200", `Could not find a relationship between '${parent}' and '${name}' in the schema cache`);
    return cands[0];
  }

  /** The SELECT list for a table alias, building embedded sub-selects; also reports "!inner" conditions the parent must satisfy. */
  projection(table, alias, items, embedFilters, counter) {
    const parts = []; const extraWhere = [];
    for (const it of items.length ? items : [{ kind: "star" }]) {
      if (it.kind === "star") parts.push(`${alias}.*`);
      else if (it.kind === "col") {
        let expr = colExpr(alias, it.expr);
        if (it.cast) expr = `(${expr})::${it.cast}`;
        const label = it.alias || it.expr.split(/->>?/).pop();
        parts.push(`${expr} as ${Q(label)}`);
      } else {
        const n = ++counter.n;
        const rel = this.resolveRel(table, it.rel, it.hint);
        const ra = `r${n}`;
        const filt = (embedFilters.get(it.alias) ?? embedFilters.get(it.rel) ?? []).map(([col, ov]) => condition(colExpr(ra, col), ov));
        const link = `${ra}.${Q(rel.childCol)} = ${alias}.${Q(rel.parentCol)}`;
        const inner = this.projection(rel.tbl, ra, it.items, new Map(), counter);
        const where = [link, ...filt, ...inner.extraWhere].join(" and ");
        const sub = `select ${inner.list} from public.${Q(rel.tbl)} ${ra} where ${where}`;
        parts.push(rel.kind === "one"
          ? `(select to_jsonb(e${n}) from (${sub} limit 1) e${n}) as ${Q(it.alias)}`
          : `coalesce((select jsonb_agg(to_jsonb(e${n})) from (${sub}) e${n}), '[]'::jsonb) as ${Q(it.alias)}`);
        if (it.inner) {
          const m = ++counter.n; const xa = `x${m}`;
          const xfilt = (embedFilters.get(it.alias) ?? embedFilters.get(it.rel) ?? []).map(([col, ov]) => condition(colExpr(xa, col), ov));
          extraWhere.push(`exists (select 1 from public.${Q(rel.tbl)} ${xa} where ${[`${xa}.${Q(rel.childCol)} = ${alias}.${Q(rel.parentCol)}`, ...xfilt].join(" and ")})`);
        }
      }
    }
    return { list: parts.join(", "), extraWhere };
  }

  /** WHERE conditions from the query string; dotted keys (rel.col) belong to an embedded table. */
  filters(alias, params, embedNames) {
    const where = []; const embedFilters = new Map();
    for (const [k, v] of params) {
      if (RESERVED.has(k)) continue;
      if (k === "or" || k === "and") { where.push(logicalGroup(alias, k, v)); continue; }
      if (k === "not.or" || k === "not.and") { where.push(`not ${logicalGroup(alias, k.slice(4), v)}`); continue; }
      const dot = k.indexOf(".");
      if (dot > 0 && embedNames.has(k.slice(0, dot))) {
        const rel = k.slice(0, dot);
        if (!embedFilters.has(rel)) embedFilters.set(rel, []);
        embedFilters.get(rel).push([k.slice(dot + 1), v]);
        continue;
      }
      where.push(condition(colExpr(alias, k), v));
    }
    return { where, embedFilters };
  }

  orderBy(alias, str) {
    if (!str) return "";
    return splitTop(str).map(p => {
      const [col, ...mods] = p.trim().split(".");
      const dir = mods.includes("desc") ? "desc" : "asc";
      const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
      return `${colExpr(alias, col)} ${dir}${nulls}`;
    }).join(", ");
  }

  valueSql(table, col, v) {
    if (v === null || v === undefined) return "null";
    const udt = this.meta.cols.get(table)?.get(col) ?? "text";
    if (udt === "jsonb" || udt === "json") return `${L(JSON.stringify(v))}::${udt}`;
    if (udt.startsWith("_")) {
      if (Array.isArray(v)) return `${L(`{${v.map(x => x === null ? "NULL" : `"${String(typeof x === "object" ? JSON.stringify(x) : x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`)}::${udt}`;
      return `${L(v)}::${udt}`;
    }
    if (typeof v === "object") return L(JSON.stringify(v));
    return L(v);
  }

  // ── request entry point ────────────────────────────────────────
  /** req: { method, path, params (URLSearchParams), headers, body, role, claims } -> { status, headers, body } */
  async handle(req) {
    if (!this.meta) await this.loadMeta();
    try {
      const out = await this.dispatch(req);
      return out;
    } catch (e) {
      return this.errorResponse(e, req.role);
    }
  }

  errorResponse(e, role) {
    if (e instanceof HttpError) return { status: e.status, body: JSON.stringify({ code: e.code, message: e.message, details: e.details, hint: e.hint }) };
    const code = e.code || "XX000";
    let status = 400;
    if (code === "42501") status = role === "anon" ? 401 : 403;
    else if (/^23(505|503|P01)$/.test(code)) status = 409;
    else if (code === "42P01") status = 404;
    return { status, body: JSON.stringify({ code, message: String(e.message), details: e.detail ?? null, hint: e.hint ?? null }) };
  }

  async withRole(req, fn) {
    const role = ["anon", "authenticated", "service_role"].includes(req.role) ? req.role : "anon";
    return this.db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.exec("set local time zone 'UTC'");
      await tx.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
        [JSON.stringify(req.claims ?? { role }), req.claims?.sub ?? "", role]);
      return fn(tx);
    });
  }

  wantsObject(req) { return String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json"); }
  prefer(req) { return String(req.headers.prefer ?? "").split(",").map(s => s.trim()).filter(Boolean); }

  async dispatch(req) {
    const p = req.path.replace(/^\/+|\/+$/g, "");
    if (p === "") return { status: 200, body: "{}" };
    if (p.startsWith("rpc/")) return this.rpc(req, p.slice(4));
    if (!this.meta.cols.has(p)) throw new HttpError(404, "PGRST205", `Could not find the table 'public.${p}' in the schema cache`, null, null);
    switch (req.method) {
      case "GET": case "HEAD": return this.read(req, p);
      case "POST": return this.insert(req, p);
      case "PATCH": return this.update(req, p);
      case "DELETE": return this.remove(req, p);
      default: throw new HttpError(405, "PGRST117", "Unsupported HTTP method");
    }
  }

  rangeOf(req) {
    let offset = req.params.get("offset") ? Number(req.params.get("offset")) : 0;
    let limit = req.params.get("limit") ? Number(req.params.get("limit")) : null;
    const range = req.headers.range;
    if (range && /^\d+-\d*$/.test(range)) { const [a, b] = range.split("-"); offset = Number(a); limit = b === "" ? null : Number(b) - Number(a) + 1; }
    return { offset, limit };
  }

  shape(req, rows, total, offset) {
    const headers = {};
    const count = this.prefer(req).find(x => x.startsWith("count="));
    if (count || req.headers.range) {
      const end = offset + rows.length - 1;
      headers["Content-Range"] = `${rows.length ? `${offset}-${end}` : "*"}/${total ?? "*"}`;
    }
    if (this.wantsObject(req)) {
      if (rows.length !== 1) return { status: 406, headers, body: JSON.stringify({ code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" }) };
      return { status: 200, headers, body: JSON.stringify(rows[0]) };
    }
    return { status: 200, headers, body: req.method === "HEAD" ? undefined : JSON.stringify(rows) };
  }

  async read(req, table) {
    const items = parseSelect(req.params.get("select") ?? "*");
    const embedNames = new Set(items.filter(i => i.kind === "embed").flatMap(i => [i.alias, i.rel]));
    const { where, embedFilters } = this.filters("t", req.params, embedNames);
    const counter = { n: 0 };
    const proj = this.projection(table, "t", items, embedFilters, counter);
    const allWhere = [...where, ...proj.extraWhere];
    const order = this.orderBy("t", req.params.get("order"));
    const { offset, limit } = this.rangeOf(req);
    const wantCount = this.prefer(req).some(x => /^count=(exact|planned|estimated)$/.test(x));
    return this.withRole(req, async tx => {
      const inner = `select ${proj.list}, row_number() over (${order ? `order by ${order}` : ""}) as "__n" from public.${Q(table)} t${allWhere.length ? ` where ${allWhere.join(" and ")}` : ""}`;
      const sql = `select coalesce(jsonb_agg((to_jsonb(z) - '__n') order by z."__n"), '[]'::jsonb) as rows from (select * from (${inner}) y order by y."__n"${limit != null ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}) z`;
      const rows = (await tx.query(sql)).rows[0].rows;
      let total = null;
      if (wantCount) total = Number((await tx.query(`select count(*)::int as n from public.${Q(table)} t${allWhere.length ? ` where ${allWhere.join(" and ")}` : ""}`)).rows[0].n);
      return this.shape(req, rows, total, offset);
    });
  }

  returning(req, table) {
    const prefs = this.prefer(req);
    const rep = prefs.includes("return=representation");
    const items = parseSelect(req.params.get("select") ?? "*");
    return { rep, items };
  }

  async writeResult(req, tx, table, cte, statusOk) {
    const { rep, items } = this.returning(req, table);
    if (!rep) { await tx.query(cte.replace("%%SELECT%%", "select 1")); return { status: statusOk === 201 ? 201 : 204, headers: {}, body: undefined }; }
    const proj = this.projection(table, "t", items, new Map(), { n: 0 });
    const sql = cte.replace("%%SELECT%%", `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as rows from (select ${proj.list} from m t) x`);
    const rows = (await tx.query(sql)).rows[0].rows;
    const shaped = this.shape(req, rows, rows.length, 0);
    return { ...shaped, status: shaped.status === 200 ? statusOk : shaped.status };
  }

  async insert(req, table) {
    let rows = req.body;
    if (rows === undefined || rows === null) throw new HttpError(400, "PGRST102", "Empty or invalid json");
    if (!Array.isArray(rows)) rows = [rows];
    const prefs = this.prefer(req);
    const colsParam = req.params.get("columns");
    const cols = colsParam ? colsParam.split(",").map(s => s.trim().replace(/^"|"$/g, "")) : [...new Set(rows.flatMap(r => Object.keys(r)))];
    const values = rows.map(r => `(${cols.map(c => (c in r ? this.valueSql(table, c, r[c]) : "default")).join(", ")})`).join(", ");
    let conflict = "";
    const resolution = prefs.find(x => x.startsWith("resolution="));
    if (resolution) {
      const target = (req.params.get("on_conflict") ?? (this.meta.pks.get(table) ?? []).join(",")).split(",").filter(Boolean);
      if (target.length) {
        const upd = cols.filter(c => !target.includes(c));
        conflict = resolution === "resolution=ignore-duplicates" || upd.length === 0
          ? ` on conflict (${target.map(Q).join(", ")}) do nothing`
          : ` on conflict (${target.map(Q).join(", ")}) do update set ${upd.map(c => `${Q(c)} = excluded.${Q(c)}`).join(", ")}`;
      }
    }
    const sql = `with m as (insert into public.${Q(table)} (${cols.map(Q).join(", ")}) ${rows.length && cols.length ? `values ${values}` : "default values"}${conflict} returning *) %%SELECT%%`;
    return this.withRole(req, tx => this.writeResult(req, tx, table, sql, 201));
  }

  async update(req, table) {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "PGRST102", "Empty or invalid json");
    const { where } = this.filters("t", req.params, new Set());
    const sets = Object.entries(body).map(([c, v]) => `${Q(c)} = ${this.valueSql(table, c, v)}`);
    if (!sets.length) return { status: 204, headers: {}, body: undefined };
    const sql = `with m as (update public.${Q(table)} as t set ${sets.join(", ")}${where.length ? ` where ${where.join(" and ")}` : ""} returning t.*) %%SELECT%%`;
    return this.withRole(req, tx => this.writeResult(req, tx, table, sql, 200));
  }

  async remove(req, table) {
    const { where } = this.filters("t", req.params, new Set());
    const sql = `with m as (delete from public.${Q(table)} as t${where.length ? ` where ${where.join(" and ")}` : ""} returning t.*) %%SELECT%%`;
    return this.withRole(req, tx => this.writeResult(req, tx, table, sql, 200));
  }

  // ── function calls ──────────────────────────────────────────────
  async functions(name) {
    if (this.fnCache.has(name)) return this.fnCache.get(name);
    const rows = (await this.db.query(`
      select p.pronargs, p.pronargdefaults, p.proargnames, p.proargmodes, p.proretset, t.typtype, p.prorettype = 'void'::regtype as isvoid,
        (select coalesce(array_agg(format_type(x, null) order by ord), '{}') from unnest(p.proargtypes) with ordinality as u(x, ord)) as argtypes
      from pg_proc p join pg_type t on t.oid = p.prorettype
      where p.pronamespace = 'public'::regnamespace and p.proname = $1 and p.prokind = 'f'`, [name])).rows;
    const fns = rows.map(r => {
      let names = r.proargnames ?? [];
      if (r.proargmodes) names = names.filter((_, i) => ["i", "b", "v"].includes(r.proargmodes[i]));
      return { ...r, names: names.slice(0, r.pronargs) };
    });
    this.fnCache.set(name, fns);
    return fns;
  }

  argLiteral(type, v) {
    if (v === null || v === undefined) return "null";
    if (/^json/.test(type)) return `${L(typeof v === "string" ? v : JSON.stringify(v))}::${type}`;
    if (type.endsWith("[]")) {
      if (Array.isArray(v)) return `${L(`{${v.map(x => x === null ? "NULL" : `"${String(typeof x === "object" ? JSON.stringify(x) : x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`)}::${type}`;
      return `${L(v)}::${type}`;
    }
    return `${L(typeof v === "object" ? JSON.stringify(v) : v)}::${type}`;
  }

  async rpc(req, name) {
    const fns = await this.functions(name);
    if (!fns.length) throw new HttpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`);
    let args = {};
    if (req.method === "POST") args = (req.body && typeof req.body === "object") ? req.body : {};
    else for (const [k, v] of req.params) if (!RESERVED.has(k) && !k.includes(".") && !/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\./.test(v)) args[k] = v;
    const keys = Object.keys(args);
    const fit = fns.filter(f => keys.every(k => f.names.includes(k)) && f.names.slice(0, f.pronargs - f.pronargdefaults).every(n => keys.includes(n)));
    const fn = (fit.length ? fit : fns.filter(f => keys.every(k => f.names.includes(k)))).sort((a, b) => a.pronargs - b.pronargs)[0];
    if (!fn) throw new HttpError(404, "PGRST202", `Could not find the function public.${name}(${keys.join(", ")}) in the schema cache`);
    const call = `public.${Q(name)}(${keys.map(k => `${Q(k)} := ${this.argLiteral(fn.argtypes[fn.names.indexOf(k)] ?? "text", args[k])}`).join(", ")})`;
    return this.withRole(req, async tx => {
      if (fn.isvoid) { await tx.query(`select ${call}`); return { status: 204, headers: {}, body: undefined }; }
      if (fn.proretset) {
        // Filters / ordering / paging in the query string apply to the function's result rows.
        const { where } = this.filters("t", new URLSearchParams([...req.params].filter(([k]) => k !== "select")), new Set());
        const order = this.orderBy("t", req.params.get("order"));
        const { offset, limit } = this.rangeOf(req);
        const wantCount = this.prefer(req).some(x => /^count=/.test(x));
        const base = `from ${call} t${where.length ? ` where ${where.join(" and ")}` : ""}`;
        const sel = req.params.get("select");
        const items = sel ? parseSelect(sel) : [{ kind: "star" }];
        const list = items.map(i => i.kind === "star" ? "t.*" : `${colExpr("t", i.expr)} as ${Q(i.alias || i.expr)}`).join(", ");
        const sql = `select coalesce(jsonb_agg((to_jsonb(z) - '__n') order by z."__n"), '[]'::jsonb) as rows from (select * from (select ${list}, row_number() over (${order ? `order by ${order}` : ""}) as "__n" ${base}) y order by y."__n"${limit != null ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}) z`;
        const rows = (await tx.query(sql)).rows[0].rows;
        const total = wantCount ? Number((await tx.query(`select count(*)::int as n ${base}`)).rows[0].n) : null;
        return this.shape(req, rows, total, offset);
      }
      const value = (await tx.query(`select to_jsonb(${call}) as r`)).rows[0].r;
      if (this.wantsObject(req) && (value === null || typeof value !== "object" || Array.isArray(value))) return { status: 200, headers: {}, body: JSON.stringify(value) };
      return { status: 200, headers: {}, body: JSON.stringify(value) };
    });
  }
}
