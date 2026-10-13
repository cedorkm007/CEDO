// localdemo/sqlsplit.mjs — splits a SQL file into single statements, respecting comments, '...' strings, "..." names and $tag$ ... $tag$ bodies.
export function splitSql(text) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "-" && next === "-") { while (i < n && text[i] !== "\n") i++; continue; }          // -- comment
    if (c === "/" && next === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; } // /* comment */
    if (c === "'") {                                                                             // 'string' ('' escapes)
      cur += c; i++;
      while (i < n) { cur += text[i]; if (text[i] === "'") { if (text[i + 1] === "'") { cur += "'"; i += 2; continue; } i++; break; } i++; }
      continue;
    }
    if (c === '"') { cur += c; i++; while (i < n && text[i] !== '"') { cur += text[i]; i++; } cur += '"'; i++; continue; }
    if (c === "$") {                                                                             // $tag$ ... $tag$
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += text.slice(i, stop); i = stop; continue;
      }
    }
    if (c === ";") { const s = cur.trim(); if (s) out.push(s); cur = ""; i++; continue; }
    cur += c; i++;
  }
  const last = cur.trim();
  if (last) out.push(last);
  return out;
}
