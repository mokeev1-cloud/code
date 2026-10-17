/* =====================================================================
   views/model.js — «Карта модели»: суть книги с одного взгляда.
   Плитки (запросы, источники, строки, время, здоровье, ускорение), поток данных
   источники → запросы → лист/модель (толщина связи — объём, ×N — повторные вычисления),
   объём и скорость по запросам, строки по шагам выбранного запроса и оценка ускорения:
   число операций Power Query до и после исправлений по объёмам данных этого компьютера.
   Объёмы — из «Проверки на данных» (DATA.run) или из метаданных книги (последнее обновление);
   время — из диагностики Power Query или из вычисления в браузере. Только показ на экране.
   ===================================================================== */
const MDL = { sel: null };
/** Итоговый запрос: загружается на лист или в модель; если сведений о загрузке нет (M-текст) — тот, на который никто не ссылается */
function mdlIsOut(m, qs){ const known = qs.some(x => x.load.sheet || x.load.model); return known ? !!(m.load.sheet || m.load.model) : !m.usedBy.length; }
const nameNorm = n => String(n || '').replace(/^#"|"$/g, '');
function mdlRows(name){
  if (dataRunValid()){ const q = DATA.run.queries.find(x => x.name === name); if (q){ const f = q.steps[q.steps.length - 1]; if (f && f.rows != null) return { rows: f.rows, cols: f.cols, src: 'data' }; } }
  const m = S.A && S.A.byName.get(name); return m && m.load.rows != null ? { rows: m.load.rows, cols: Array.isArray(m.load.columns) ? m.load.columns.length : null, src: 'meta' } : { rows: null, cols: null, src: '' };
}
function mdlStepRows(q, step){ if (!dataRunValid() || !step) return null; const r = DATA.run.queries.find(x => x.name === q); const s = r && r.steps.find(x => x.name === nameNorm(step)); return s && s.rows != null ? s.rows : null; }
/** Время запроса: диагностика Power Query (секунды в Excel) или вычисление в браузере */
function mdlTimes(){
  const out = new Map(); const ds = typeof diagSecondsMap === 'function' ? diagSecondsMap() : new Map();
  if (ds.size){ for (const [k, v] of ds){ const q = k.split('\u0001')[0]; out.set(q, (out.get(q) || 0) + v); } return { map: out, src: 'diag' }; }
  if (dataRunValid()) for (const q of DATA.run.queries) out.set(q.name, q.ms / 1000);
  return { map: out, src: out.size ? 'browser' : '' };
}
/** Источники запроса из текста кода: файлы, папки, таблицы книги, базы, веб */
function mdlSources(m){
  const t = S.work.slice(m.exprStart, m.exprEnd); const out = []; let x;
  const base = p => String(p).replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');
  const re = /Excel\.CurrentWorkbook\(\)\s*\{\s*\[\s*Name\s*=\s*"([^"]+)"|File\.Contents\(\s*"([^"]+)"|Folder\.(?:Files|Contents)\(\s*"([^"]+)"|\b(Sql\.Databases?|Odbc\.\w+|OleDb\.\w+|Oracle\.Database|PostgreSQL\.Database|MySQL\.Database|Access\.Database)\s*\(\s*"([^"]*)"|\b(Web\.Contents|Web\.Page|OData\.Feed|SharePoint\.\w+)\b/g;
  while ((x = re.exec(t))){
    if (x[1]) out.push({ key: 'wb:' + x[1], icon: '▦', label: x[1], kind: 'таблица книги' });
    else if (x[2]) out.push({ key: 'f:' + x[2].toLowerCase(), icon: '📄', label: base(x[2]), kind: 'файл', path: x[2] });
    else if (x[3]) out.push({ key: 'd:' + x[3].toLowerCase(), icon: '📁', label: base(x[3]) || x[3], kind: 'папка', path: x[3] });
    else if (x[4]) out.push({ key: 'db:' + x[4] + x[5], icon: '🗄', label: x[5] || x[4], kind: x[4] });
    else if (x[6]) out.push({ key: 'web:' + x[6], icon: '🌐', label: x[6], kind: 'веб' });
  }
  if (!out.length && m.hasSource) out.push({ key: 'src:' + m.name, icon: '🔌', label: [...new Set(m.sources)][0] || 'источник', kind: 'источник' });
  return out.filter((s, i) => out.findIndex(y => y.key === s.key) === i);
}
const fmtSec = s => s == null ? '—' : s >= 60 ? (s / 60).toFixed(1).replace('.', ',') + ' мин' : s >= 10 ? s.toFixed(0) + ' с' : s >= 1 ? s.toFixed(1).replace('.', ',') + ' с' : Math.round(s * 1000) + ' мс';
const fmtBig = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : n >= 1e4 ? Math.round(n / 1e3) + ' тыс.' : fmtN(n);
const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 12 || y > 14) ? b : c; };
/** Оценка ускорения: операции движка Power Query до и после исправления по объёмам данных */
function mdlSpeedups(){
  const out = []; if (!S.opt) return out;
  const tableOf = d => d ? nameNorm(d.name || ((/^(?:Table|List)\.Buffer\(\s*(#"[^"]+"|[\p{L}_][\p{L}\p{N}_]*)/u.exec(d.expr || '') || [])[1]) || ((/^(#"[^"]+"|[\p{L}_][\p{L}\p{N}_]*)/u.exec(d.expr || '') || [])[1])) : '';
  for (const f of S.opt.findings){
    if (f.rule === 'multi-eval'){ const k = +((/≈(\d+)/.exec((f.why || '') + ' ' + (f.title || '')) || [])[1]); const R = mdlRows(f.query).rows; if (k >= 2 && R) out.push({ f, before: k * R, after: R, how: 'вычисляется ' + k + ' ' + plural(k, 'раз', 'раза', 'раз') + ' за «Обновить всё» → один раз', N: R, k }); continue; }
    if (!['row-lookup', 'buffer-in-each', 'list-buffer'].includes(f.rule)) continue;
    const N = mdlStepRows(f.query, f.step) ?? mdlRows(f.query).rows; const T = tableOf(f.data);
    const M = T ? (mdlStepRows(f.query, T) ?? mdlRows(T).rows) : null;
    if (!N || !M) continue;
    if (f.rule === 'row-lookup') out.push({ f, before: N * M, after: N + M, how: 'поиск в «' + T + '» для каждой из ' + fmtBig(N) + ' строк → одно слияние', N, M });
    else out.push({ f, before: 2 * N * M, after: M + N * M, how: '«' + T + '» пересобирается для каждой строки → один раз', N, M });
  }
  return out.map(x => Object.assign(x, { k: x.before / Math.max(1, x.after) })).sort((a, b) => b.before - a.before);
}
function mdlTiles(){
  const ms = S.A.members, qs = ms.filter(m => !m.isFn && !m.isParam);
  const loaded = qs.filter(m => mdlIsOut(m, qs)), staging = qs.filter(m => !mdlIsOut(m, qs));
  const src = new Map(); for (const m of qs) for (const s of mdlSources(m)) src.set(s.key, s);
  const kinds = [...new Set([...src.values()].map(s => s.kind))];
  const rows = loaded.map(m => mdlRows(m.name)); const known = rows.filter(r => r.rows != null);
  const tm = mdlTimes(); const total = [...tm.map.values()].reduce((a, b) => a + b, 0);
  const sp = mdlSpeedups(); const best = sp.length ? Math.max(...sp.map(x => x.k)) : 0;
  const tile = (label, value, sub, cls) => '<div class="tile' + (cls ? ' ' + cls : '') + '"><div class="tl">' + label + '</div><div class="tv">' + value + '</div><div class="ts">' + sub + '</div></div>';
  return tile('Запросов', qs.length, 'итоговых ' + loaded.length + ' · промежуточных ' + staging.length + (ms.length > qs.length ? ' · функций и параметров ' + (ms.length - qs.length) : '')) +
    tile('Источников', src.size, kinds.join(', ') || 'нет внешних источников') +
    tile('Строк в итоговых таблицах', known.length ? fmtBig(known.reduce((a, r) => a + r.rows, 0)) : '—', known.length ? (known.some(r => r.src === 'data') ? 'на ваших данных' : 'по последнему обновлению в Excel') : 'посчитайте на данных') +
    tile('Время обработки', tm.src ? fmtSec(total) : '—', tm.src === 'diag' ? 'по диагностике Power Query' : tm.src === 'browser' ? 'в браузере (соотношения, не секунды Excel)' : 'загрузите диагностику или посчитайте на данных') +
    tile('Здоровье кода', S.opt.score + '<small>/100</small>', OPT.potential != null && OPT.potentialFor === S.work && OPT.potential > S.opt.score ? 'после безопасных исправлений — ' + OPT.potential : (S.opt.breakdown.safeFixable ? 'безопасных исправлений: ' + S.opt.breakdown.safeFixable : 'советы — в «Оптимизаторе»')) +
    tile('Ускорение', best >= 1.5 ? 'до ×' + fmtBig(Math.round(best)) : '—', sp.length ? sp.length + ' ' + plural(sp.length, 'место', 'места', 'мест') + ' · оценка по объёмам' : dataRunValid() ? 'тяжёлых мест не найдено' : 'посчитайте на данных', best >= 10 ? 'hot' : '');
}
/** Поток данных: колонки — источники, слои запросов по зависимостям, лист/модель */
function mdlFlow(){
  const qs = S.A.members.filter(m => !m.isFn && !m.isParam); const byName = new Map(qs.map(m => [m.name, m]));
  const layer = new Map(); const seen = new Set();
  const L = m => { if (layer.has(m.name)) return layer.get(m.name); if (seen.has(m.name)) return 1; seen.add(m.name); let l = 1; for (const r of m.refs){ const x = byName.get(r); if (x && x !== m) l = Math.max(l, L(x) + 1); } layer.set(m.name, l); return l; };
  qs.forEach(L);
  const reads = new Map((S.opt.heat || []).map(h => [h.query, h.reads || 0]));
  const tm = mdlTimes();
  const nodes = new Map(); const edges = [];
  const role = m => mdlIsOut(m, qs) ? 'out' : 'mid';
  for (const m of qs){ const r = mdlRows(m.name); nodes.set('q:' + m.name, { id: 'q:' + m.name, q: m.name, col: layer.get(m.name), label: m.name, role: role(m), rows: r.rows, cols: r.cols, rsrc: r.src, sec: tm.map.get(m.name), reads: reads.get(m.name) || 0, steps: m.steps ? m.steps.steps.length : 0, warn: S.lint.filter(l => l.query === m.name && (l.sev === 'err' || l.sev === 'warn')).length }); }
  const firstRows = name => { if (!dataRunValid()) return null; const q = DATA.run.queries.find(x => x.name === name); const s = q && q.steps.find(x => x.rows != null); return s ? s.rows : null; };
  for (const m of qs){
    for (const s of mdlSources(m)){
      if (!nodes.has('s:' + s.key)){ let rows = null; if (s.key.startsWith('wb:') && DATA.wb){ const t = DATA.wb.tables.concat(DATA.wb.names).find(x => x.name === s.label); if (t) rows = t.rows.length; } nodes.set('s:' + s.key, { id: 's:' + s.key, col: 0, label: s.icon + ' ' + s.label, role: 'src', kind: s.kind, path: s.path, rows }); }
      const fr = firstRows(m.name); edges.push({ a: 's:' + s.key, b: 'q:' + m.name, rows: fr });
      const sn = nodes.get('s:' + s.key); if (sn.rows == null && fr != null) sn.rows = fr;   // объём файла — строки первого шага, который его читает
    }
    for (const r of m.refs) if (byName.has(r) && r !== m.name) edges.push({ a: 'q:' + r, b: 'q:' + m.name, rows: mdlRows(r).rows });
  }
  const maxQ = Math.max(1, ...[...layer.values()]); const tcol = maxQ + 1;
  const anySheet = qs.some(m => m.load.sheet), anyModel = qs.some(m => m.load.model);
  if (anySheet) nodes.set('t:sheet', { id: 't:sheet', col: tcol, label: '▦ Листы Excel', role: 'tgt' });
  if (anyModel) nodes.set('t:model', { id: 't:model', col: tcol, label: '◈ Модель данных', role: 'tgt' });
  for (const m of qs){ const r = mdlRows(m.name).rows; if (m.load.sheet) edges.push({ a: 'q:' + m.name, b: 't:sheet', rows: r }); if (m.load.model) edges.push({ a: 'q:' + m.name, b: 't:model', rows: r }); }
  // колонки и порядок (барицентры по входящим связям, несколько проходов)
  const cols = []; for (const n of nodes.values()) (cols[n.col] = cols[n.col] || []).push(n);
  if (!cols.length) return { svg: '<div class="small muted">Обычных запросов нет — только функции и параметры.</div>', legend: '' };
  cols[0] = cols[0] || [];
  for (let i = 0; i < cols.length; i++) cols[i] = cols[i] || [];
  const pos = new Map(); cols.forEach(c => c.forEach((n, i) => pos.set(n.id, i)));
  const into = new Map(); for (const e of edges){ if (!into.has(e.b)) into.set(e.b, []); into.get(e.b).push(e.a); }
  const outOf = new Map(); for (const e of edges){ if (!outOf.has(e.a)) outOf.set(e.a, []); outOf.get(e.a).push(e.b); }
  for (let it = 0; it < 6; it++){
    for (let c = 1; c < cols.length; c++){ const bc = n => { const p = (into.get(n.id) || []).filter(x => pos.has(x)); return p.length ? p.reduce((s, x) => s + pos.get(x), 0) / p.length : pos.get(n.id); }; cols[c].sort((a, b) => bc(a) - bc(b)); cols[c].forEach((n, i) => pos.set(n.id, i)); }
    const bc0 = n => { const p = (outOf.get(n.id) || []).filter(x => pos.has(x)); return p.length ? p.reduce((s, x) => s + pos.get(x), 0) / p.length : pos.get(n.id); }; cols[0].sort((a, b) => bc0(a) - bc0(b)); cols[0].forEach((n, i) => pos.set(n.id, i));
  }
  const W = 210, H = 52, GX = 70, GY = 16, P = 14;
  const maxN = Math.max(1, ...cols.map(c => c.length));
  const width = P * 2 + cols.length * W + (cols.length - 1) * GX, height = P * 2 + maxN * (H + GY) - GY;
  const xy = new Map(); cols.forEach((c, ci) => { const off = (maxN - c.length) * (H + GY) / 2; c.forEach((n, i) => xy.set(n.id, { x: P + ci * (W + GX), y: P + off + i * (H + GY) })); });
  const maxRows = Math.max(1, ...[...nodes.values()].map(n => n.rows || 0), ...edges.map(e => e.rows || 0));
  const lg = v => Math.log10((v || 0) + 1) / Math.log10(maxRows + 1);
  const ROLE = { src: ['var(--viz-1)', 'источник'], mid: ['var(--viz-3)', 'промежуточный'], out: ['var(--viz-2)', 'итоговый — загружается'], tgt: ['var(--muted)', 'куда загружается'] };
  let svg = '<svg class="flow" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
  for (const e of edges){ const a = xy.get(e.a), b = xy.get(e.b); if (!a || !b) continue;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2; const w = e.rows == null ? 1.5 : 1.5 + 9 * lg(e.rows);
    svg += '<path class="fedge" data-a="' + escHtml(e.a) + '" data-b="' + escHtml(e.b) + '" d="M' + x1 + ',' + y1 + ' C' + (x1 + GX * 0.55) + ',' + y1 + ' ' + (x2 - GX * 0.55) + ',' + y2 + ' ' + x2 + ',' + y2 + '" stroke-width="' + w.toFixed(1) + '" data-tip="' + escHtml(escHtml(nodes.get(e.a).label) + ' → ' + escHtml(nodes.get(e.b).label) + (e.rows != null ? '<br><b>' + fmtN(e.rows) + '</b> строк' : '')) + '"/>'; }
  for (const n of nodes.values()){ const p = xy.get(n.id); const [col, rl] = ROLE[n.role];
    const label = n.label.length > 27 ? n.label.slice(0, 26) + '…' : n.label;
    const sub = n.role === 'tgt' ? '' : [n.rows != null ? fmtBig(n.rows) + ' строк' : n.role === 'src' ? n.kind : '', n.sec != null ? fmtSec(n.sec) : ''].filter(Boolean).join(' · ');
    const tip = '<b>' + escHtml(n.label) + '</b><br>' + rl + (n.rows != null ? '<br>строк: <b>' + fmtN(n.rows) + '</b>' + (n.cols ? ' × ' + n.cols + ' столбцов' : '') + (n.rsrc === 'meta' ? ' (по последнему обновлению)' : '') : '') + (n.sec != null ? '<br>время: <b>' + fmtSec(n.sec) + '</b>' + (tm.src === 'browser' ? ' в браузере' : ' по диагностике') : '') + (n.steps ? '<br>шагов: ' + n.steps : '') + (n.reads >= 2 ? '<br>⟳ вычисляется ×' + n.reads + ' за «Обновить всё»' : '') + (n.warn ? '<br>⚠ замечаний: ' + n.warn : '') + (n.path ? '<br><span class="muted">' + escHtml(n.path) + '</span>' : '');
    svg += '<g class="fnode ' + n.role + (n.q && n.q === MDL.sel ? ' sel' : '') + '" data-id="' + escHtml(n.id) + '"' + (n.q ? ' data-q="' + escHtml(n.q) + '"' : '') + ' data-tip="' + escHtml(tip) + '">' +
      '<rect class="bg" x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="8"/>' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="5" height="' + H + '" rx="2" fill="' + col + '"/>' +
      '<text class="nt" x="' + (p.x + 14) + '" y="' + (p.y + 20) + '">' + escHtml(label) + '</text>' +
      (sub ? '<text class="ns" x="' + (p.x + 14) + '" y="' + (p.y + 36) + '">' + escHtml(sub) + '</text>' : '') +
      (n.rows != null && n.role !== 'tgt' ? '<rect class="vtrack" x="' + (p.x + 14) + '" y="' + (p.y + H - 8) + '" width="' + (W - 28) + '" height="3" rx="1.5"/><rect x="' + (p.x + 14) + '" y="' + (p.y + H - 8) + '" width="' + Math.max(3, (W - 28) * lg(n.rows)).toFixed(1) + '" height="3" rx="1.5" fill="' + col + '"/>' : '') +
      (n.reads >= 2 ? '<g class="badge"><rect x="' + (p.x + W - 44) + '" y="' + (p.y + 6) + '" width="38" height="17" rx="8.5"/><text x="' + (p.x + W - 25) + '" y="' + (p.y + 18) + '" text-anchor="middle">⟳×' + n.reads + '</text></g>' : '') +
      (n.warn ? '<text class="nwarn" x="' + (p.x + W - (n.reads >= 2 ? 52 : 10)) + '" y="' + (p.y + 19) + '" text-anchor="end">⚠' + n.warn + '</text>' : '') + '</g>'; }
  svg += '</svg>';
  const legend = Object.entries(ROLE).filter(([k]) => k !== 'tgt').map(([, [c, l]]) => '<i class="sw" style="background:' + c + '"></i>' + l).join(' ') + ' <span class="badge-key">⟳×N</span> вычисляется N раз';
  return { svg, legend };
}
/** Горизонтальные столбцы: один ряд — один цвет; подпись значения у конца столбца */
function mdlBars(items, fmt, empty){
  if (!items.length) return '<div class="small muted">' + empty + '</div>';
  const top = items.slice(0, 12); const max = Math.max(...top.map(x => x.v), 1e-9);
  return '<div class="hbars">' + top.map(x => '<div class="hb" data-q="' + escHtml(x.q) + '" data-tip="' + escHtml('<b>' + escHtml(x.q) + '</b><br>' + x.tip) + '"><span class="hl">' + escHtml(x.q) + '</span><span class="ht"><i style="width:' + Math.max(0.6, x.v / max * 80).toFixed(2) + '%"></i><b>' + fmt(x.v) + '</b></span></div>').join('') + '</div>' +
    (items.length > top.length ? '<div class="small muted">ещё ' + (items.length - top.length) + ' — меньше</div>' : '');
}
function mdlDetail(){
  const q = MDL.sel && S.A.byName.get(MDL.sel) ? MDL.sel : null;
  if (!q) return '<div class="card-h"><h2>Строки по шагам</h2></div><div class="small muted">Щёлкните запрос на схеме или в графиках — здесь появится, как меняется число строк по его шагам.</div>';
  const run = dataRunValid() ? DATA.run.queries.find(x => x.name === q) : null;
  let h = '<div class="card-h"><h2>Строки по шагам — ' + escHtml(q) + '</h2><span class="sp"></span><button class="btn sm" id="mdlOpen">Открыть в редакторе</button></div>';
  if (!run) return h + '<div class="small muted">Посчитайте на данных — появятся строки на каждом шаге.</div>';
  const st = run.steps.filter(s => s.rows != null || s.error); const max = Math.max(1, ...st.map(s => s.rows || 0)); let prev = null;
  h += '<div class="hbars steps">' + st.map(s => { const grow = prev != null && s.rows != null && prev >= 100 && s.rows > prev * 1.5, drop = prev != null && s.rows != null && s.rows < prev * 0.5; const t = '<div class="hb' + (grow ? ' grow' : '') + '" data-tip="' + escHtml('<b>' + escHtml(s.name) + '</b><br>' + (s.error ? escHtml(s.error.message) : fmtN(s.rows) + ' строк × ' + s.cols + ' столбцов' + (prev != null ? '<br>было ' + fmtN(prev) : ''))) + '"><span class="hl">' + escHtml(s.name === 'in → результат' ? 'результат' : s.name) + '</span><span class="ht">' + (s.error ? '<em class="err">✖ ' + escHtml(s.error.reason) + '</em>' : '<i style="width:' + Math.max(0.6, s.rows / max * 80).toFixed(2) + '%"></i><b>' + fmtN(s.rows) + (grow ? ' ⚠ рост ×' + (s.rows / prev).toFixed(1).replace('.', ',') : drop ? ' ↓' : '') + '</b>') + '</span></div>'; if (s.rows != null) prev = s.rows; return t; }).join('') + '</div>';
  const js = run.joins.filter(j => j.dupKeys || j.miss);
  if (js.length) h += '<div class="small">' + js.map(j => '⚠ шаг «' + escHtml(j.step) + '»: ' + (j.dupKeys ? 'дубли ключей справа ' + fmtN(j.dupKeys) : '') + (j.dupKeys && j.miss ? ', ' : '') + (j.miss ? 'без пары ' + fmtN(j.miss) + ' из ' + fmtN(j.left) : '')).join('<br>') + '</div>';
  return h;
}
function mdlSpeedupHtml(){
  const sp = mdlSpeedups();
  if (!sp.length) return '<div class="small muted">' + (dataRunValid() || S.A.members.some(m => m.load.rows != null) ? 'Мест, где объём данных умножает работу (поиск для каждой строки, повторные вычисления), не найдено.' : 'Посчитайте на данных: оценка строится по реальным объёмам таблиц.') + '</div>';
  const lo = Math.min(...sp.map(x => x.after)), hi = Math.max(...sp.map(x => x.before));
  const X = v => (Math.log10(v) - Math.log10(lo)) / Math.max(1e-9, Math.log10(hi) - Math.log10(lo)) * 100;
  const tb = sp.reduce((a, x) => a + x.before, 0), ta = sp.reduce((a, x) => a + x.after, 0);
  const ver = DATA.verify && DATA.verify.forWork === S.work ? DATA.verify.items : new Map();
  return '<div class="sp-hero"><div><div class="tv">×' + fmtBig(Math.round(tb / ta)) + '</div><div class="ts">меньше операций в этих местах после исправлений</div></div><div class="small muted">' + fmtBig(tb) + ' → ' + fmtBig(ta) + ' операций (сравнений строк и повторных чтений) на ваших объёмах. Power Query не строит индекс для поиска «для каждой строки» и не делит результат промежуточного запроса между загружаемыми таблицами — отсюда умножение. Реальное время зависит от источника и машины: проверьте диагностикой до и после.</div></div>' +
    '<div class="dumb">' + sp.slice(0, 12).map(x => { const v = ver.get(x.f.id); const a = X(x.after), b = X(x.before);
      return '<div class="dr" data-tip="' + escHtml('<b>' + escHtml(x.f.query + (x.f.step ? ' › ' + x.f.step : '')) + '</b><br>' + escHtml(x.how) + '<br>сейчас ≈ ' + fmtBig(x.before) + ' операций<br>после ≈ ' + fmtBig(x.after) + (v ? '<br>на данных: ' + (v.same ? 'результат тот же ✓' : v.results.some(r => r.same) ? 'вариант «' + escHtml(v.results.find(r => r.same).label) + '» — тот же ✓' : 'результат другой ✖') : '')) + '"><span class="hl"><b>' + escHtml(x.f.query) + '</b>' + (x.f.step ? ' › ' + escHtml(x.f.step) : '') + '<br><span class="muted">' + escHtml(x.how) + '</span></span>' +
        '<span class="dt"><i class="dl" style="left:' + a.toFixed(2) + '%;width:' + Math.max(0, b - a).toFixed(2) + '%"></i><i class="dd after" style="left:' + a.toFixed(2) + '%"></i><i class="dd before" style="left:' + b.toFixed(2) + '%"></i></span>' +
        '<span class="dk"><b>×' + fmtBig(Math.round(x.k)) + '</b>' + (v ? (v.results.some(r => r.same) ? ' <span class="ok">✓</span>' : ' <span class="bad">✖</span>') : '') + '</span>' +
        '<button class="btn sm" data-fix="' + escHtml(x.f.id) + '">Исправить…</button></div>'; }).join('') + '</div>' +
    '<div class="small muted">Шкала логарифмическая: каждое деление — в 10 раз. ✓/✖ — сверка исправления на данных («Проверка на данных»).</div>';
}
function renderModel(){
  if (!S.A || !S.opt) return;
  const runOk = dataRunValid();
  $('#mdlRun').textContent = DV.busy ? '⏳ ' + (DV.progress || 'Вычисление…') : runOk ? '↻ Пересчитать на данных' : '▶ Посчитать на данных';
  $('#mdlRun').disabled = DV.busy;
  $('#mdlNote').textContent = runOk ? 'объёмы — на ваших данных (только в этом браузере)' : 'объёмы — по последнему обновлению в Excel; посчитайте на данных для полной картины';
  $('#mdlTiles').innerHTML = mdlTiles();
  const fl = mdlFlow(); $('#mdlFlow').innerHTML = fl.svg; $('#mdlLegend').innerHTML = fl.legend;
  const qs = S.A.members.filter(m => !m.isFn && !m.isParam);
  const vol = qs.map(m => ({ q: m.name, r: mdlRows(m.name) })).filter(x => x.r.rows != null).map(x => ({ q: x.q, v: x.r.rows, tip: fmtN(x.r.rows) + ' строк' + (x.r.cols ? ' × ' + x.r.cols + ' столбцов' : '') })).sort((a, b) => b.v - a.v);
  $('#mdlVolNote').textContent = vol.length ? 'строк в результате запроса' : '';
  $('#mdlVol').innerHTML = mdlBars(vol, fmtBig, 'Объёмов пока нет — посчитайте на данных.');
  const tm = mdlTimes(); const spd = [...tm.map].map(([q, s]) => ({ q, v: s, tip: fmtSec(s) + (tm.src === 'diag' ? ' по диагностике' : ' в браузере') })).filter(x => S.A.byName.has(x.q)).sort((a, b) => b.v - a.v);
  $('#mdlSpeedNote').textContent = tm.src === 'diag' ? 'секунды по диагностике Power Query' : tm.src === 'browser' ? 'время в браузере — важны соотношения' : '';
  $('#mdlSpeed').innerHTML = mdlBars(spd, fmtSec, 'Времени пока нет — загрузите диагностику («Диагностика») или посчитайте на данных.');
  $('#mdlDetail').innerHTML = mdlDetail();
  $('#mdlSpeedup').innerHTML = mdlSpeedupHtml();
  $$('#view-model [data-q]').forEach(el => el.onclick = () => { MDL.sel = el.dataset.q; renderModel(); $('#mdlDetail').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  $$('#view-model .fnode').forEach(g => { g.onmouseenter = () => $$('#view-model .fedge').forEach(p => p.classList.toggle('hot', p.dataset.a === g.dataset.id || p.dataset.b === g.dataset.id)); g.onmouseleave = () => $$('#view-model .fedge.hot').forEach(p => p.classList.remove('hot')); });
  if ($('#mdlOpen')) $('#mdlOpen').onclick = () => openInEditor(MDL.sel);
  $$('#mdlSpeedup [data-fix]').forEach(b => b.onclick = () => { showView('optimizer'); const f = S.opt.findings.find(x => x.id === b.dataset.fix); if (f) setTimeout(() => previewFinding(f.id), 50); });
}
/* всплывающая подсказка для всех [data-tip] в разделе (подсказка — уже экранированный HTML) */
$('#view-model').addEventListener('mousemove', e => { const t = e.target.closest('[data-tip]'); const tip = $('#vizTip'); if (!t){ tip.classList.add('hidden'); return; } tip.innerHTML = t.dataset.tip; tip.classList.remove('hidden'); const r = tip.getBoundingClientRect(); tip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + 'px'; tip.style.top = Math.min(window.innerHeight - r.height - 8, e.clientY + 14) + 'px'; });
$('#view-model').addEventListener('mouseleave', () => $('#vizTip').classList.add('hidden'));
$('#mdlRun').onclick = async () => { await dataRunAll(); renderModel(); };
registerView('model', { render: renderModel });
