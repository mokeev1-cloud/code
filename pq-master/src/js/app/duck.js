/* =====================================================================
   app/duck.js — DuckDB в браузере (WebAssembly) для «Гиперзума».
   Движок встроен в файл: блок pqm-duckdb-js (DuckDB-WASM 1.32, MIT, вызовы без воркеров) и блок
   pqm-duckdb-wasm (ядро DuckDB, gzip + base64). Распаковывается только по кнопке, ~1,5 с.
   Сеть по-прежнему запрещена: CSP разрешает лишь компиляцию WebAssembly ('wasm-unsafe-eval'),
   автозагрузка расширений DuckDB выключена. Таблицы живут в памяти этой вкладки и никуда не уходят.
   API: duckOpen(progress) → DUCK; duckLoad(имя, MTab) — таблица из значений интерпретатора;
        duckQuery(sql) — выполнить; duckTab(имя) → MTab (числа, даты, текст); duckCount(sql) → число.
   ===================================================================== */
const DUCK = { db: null, c: null, ver: '', loading: null, error: '', ms: 0 };
const duckAvailable = () => !!document.getElementById('pqm-duckdb-wasm');
/** base64 → байты без atob (10 МБ — доли секунды) */
function duckB64(s){
  const T = new Uint8Array(128); const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  s = s.replace(/[^A-Za-z0-9+/]/g, ''); const n = s.length, out = new Uint8Array((n * 3) >> 2); let o = 0;
  for (let i = 0; i < n; i += 4){ const a = T[s.charCodeAt(i)], b = T[s.charCodeAt(i + 1)], c = T[s.charCodeAt(i + 2)], d = T[s.charCodeAt(i + 3)];
    out[o++] = a << 2 | b >> 4; if (i + 2 < n) out[o++] = (b & 15) << 4 | c >> 2; if (i + 3 < n) out[o++] = (c & 3) << 6 | d; }
  return out.subarray(0, o);
}
async function duckOpen(progress){
  if (DUCK.c) return DUCK;
  if (DUCK.loading) return DUCK.loading;
  DUCK.loading = (async () => {
    if (!duckAvailable()) throw new Error('В этой сборке Мастера нет DuckDB (блок pqm-duckdb-wasm).');
    const t0 = performance.now();
    if (progress) progress('Распаковка DuckDB (≈35 МБ в памяти)…');
    await tick();
    if (!window.PQM_DUCKDB){ const sc = document.createElement('script'); sc.textContent = document.getElementById('pqm-duckdb-js').textContent; document.head.appendChild(sc); }
    const gz = duckB64(document.getElementById('pqm-duckdb-wasm').textContent.split('\n').filter(l => !/^\/\* ===== (BEGIN|END) /.test(l)).join(''));   // без строк-границ модуля
    const bytes = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (progress) progress('Запуск DuckDB…');
    await tick();
    const D = window.PQM_DUCKDB;
    const db = await D.createDuckDB({ mvp: { mainModule: 'x', mainWorker: '' }, eh: { mainModule: 'x', mainWorker: '' } }, new D.VoidLogger(), D.DEFAULT_RUNTIME);
    db.instantiateWasm = (imports, ok) => { globalThis.DUCKDB_RUNTIME = db._runtime; WebAssembly.instantiate(bytes, imports).then(r => ok(r.instance, r.module)); return []; };
    await db.instantiate(); db.open({});
    const c = db.connect();
    c.query('SET autoinstall_known_extensions = false; SET autoload_known_extensions = false;');
    c.query(HZ_MACROS);
    DUCK.db = db; DUCK.c = c; DUCK.ver = c.query('SELECT version() AS v').toArray()[0].v; DUCK.ms = performance.now() - t0;
    return DUCK;
  })();
  try { return await DUCK.loading; } catch (e){ DUCK.loading = null; DUCK.error = e.message; throw e; }
}
const duckQuery = sql => DUCK.c.query(sql);
const duckCount = sql => Number(DUCK.c.query('SELECT count(*) AS n FROM (' + sql + ')').toArray()[0].n);
/** Таблица интерпретатора → таблица DuckDB. Тип столбца — по значениям: числа, логические, даты; смешанные — текст */
function duckLoad(name, t){
  const A = window.PQM_DUCKDB.arrow; const n = t.rows.length; const cols = {}; const post = []; const info = { errs: 0, mixed: [] };
  const bitmap = vals => { const b = new Uint8Array((vals.length + 7) >> 3); for (let i = 0; i < vals.length; i++) if (vals[i] != null) b[i >> 3] |= 1 << (i & 7); return b; };
  const nulls = vals => { let k = 0; for (const v of vals) if (v == null) k++; return k; };
  const enc = new TextEncoder();
  const utf8 = vals => { const parts = vals.map(v => v == null ? new Uint8Array(0) : enc.encode(v)); const off = new Int32Array(vals.length + 1); let s = 0; parts.forEach((p, i) => { off[i] = s; s += p.length; }); off[vals.length] = s; const data = new Uint8Array(s); let o = 0; for (const p of parts){ data.set(p, o); o += p.length; }
    return A.makeVector(A.makeData({ type: new A.Utf8(), length: vals.length, nullCount: nulls(vals), nullBitmap: bitmap(vals), valueOffsets: off, data })); };
  const f64 = vals => A.makeVector(A.makeData({ type: new A.Float64(), length: vals.length, nullCount: nulls(vals), nullBitmap: bitmap(vals), data: Float64Array.from(vals, v => v == null ? 0 : v) }));
  const bool = vals => { const d = new Uint8Array((vals.length + 7) >> 3); vals.forEach((v, i) => { if (v) d[i >> 3] |= 1 << (i & 7); }); return A.makeVector(A.makeData({ type: new A.Bool(), length: vals.length, nullCount: nulls(vals), nullBitmap: bitmap(vals), data: d })); };
  t.cols.forEach((c, i) => {
    const vals = new Array(n); const kinds = new Set();
    for (let r = 0; r < n; r++){ let v; try { v = force(t.rows[r][i]); } catch { v = null; info.errs++; } vals[r] = v; if (v !== null) kinds.add(typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : typeof v === 'string' ? 's' : v instanceof MDate ? 'D' + v.kind : 'o'); }
    const kind = kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mix' : 's';
    if (kind === 'n') cols[c] = f64(vals);
    else if (kind === 'b') cols[c] = bool(vals);
    else if (kind === 'Ddate' || kind === 'Ddatetime'){ cols[c] = utf8(vals.map(v => v === null ? null : mToText(v))); post.push([c, kind === 'Ddate' ? 'DATE' : 'TIMESTAMP']); }
    else { if (kind !== 's') info.mixed.push(c); cols[c] = utf8(vals.map(v => v === null ? null : typeof v === 'string' ? v : mToText(v))); }
  });
  DUCK.c.query('DROP TABLE IF EXISTS ' + hzQ(name));
  if (!t.cols.length){ DUCK.c.query('CREATE TABLE ' + hzQ(name) + ' AS SELECT 1 AS __empty WHERE false'); return info; }
  DUCK.c.insertArrowTable(new A.Table(cols), { name, create: true });
  for (const [c, ty] of post) DUCK.c.query('ALTER TABLE ' + hzQ(name) + ' ALTER ' + hzQ(c) + ' TYPE ' + ty + ' USING CAST(' + hzQ(c) + ' AS ' + ty + ')');
  return info;
}
/** Таблица DuckDB → MTab для сверки и показа (служебный __r — только для порядка) */
function duckTab(name, limit){
  const desc = DUCK.c.query('DESCRIBE ' + hzQ(name)).toArray().map(r => [r.column_name, r.column_type]);
  const cols = desc.filter(([c]) => c !== HZ_R);
  const kind = ty => /^DATE$/.test(ty) ? 'date' : /^TIMESTAMP/.test(ty) ? 'datetime' : /^(BIGINT|HUGEINT|INTEGER|SMALLINT|TINYINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT|UHUGEINT|DECIMAL|FLOAT|DOUBLE)/.test(ty) ? 'num' : ty === 'BOOLEAN' ? 'bool' : ty === 'VARCHAR' ? 'text' : 'other';
  const sel = cols.map(([c, ty]) => { const k = kind(ty), q = hzQ(c); return k === 'date' || k === 'datetime' ? 'CAST(epoch_ms(CAST(' + q + ' AS TIMESTAMP)) AS DOUBLE) AS ' + q : k === 'num' ? 'CAST(' + q + ' AS DOUBLE) AS ' + q : k === 'other' ? 'CAST(' + q + ' AS VARCHAR) AS ' + q : q; });
  const res = DUCK.c.query('SELECT ' + (sel.length ? sel.join(', ') : '1 AS x') + ' FROM ' + hzQ(name) + (desc.some(([c]) => c === HZ_R) ? ' ORDER BY ' + HZ_R : '') + (limit ? ' LIMIT ' + limit : ''));
  const kinds = cols.map(([, ty]) => kind(ty)); const vecs = cols.map((_, i) => res.getChildAt(i)); const rows = new Array(res.numRows);
  for (let r = 0; r < res.numRows; r++){ const row = new Array(cols.length); for (let i = 0; i < cols.length; i++){ let v = vecs[i].get(r); if (v != null){ if (kinds[i] === 'date' || kinds[i] === 'datetime') v = new MDate(kinds[i], v); else if (typeof v === 'bigint') v = Number(v); } else v = null; row[i] = v; } rows[r] = row; }
  return new MTab(cols.map(c => c[0]), rows);
}
