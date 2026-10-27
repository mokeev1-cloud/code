/* =====================================================================
   views/hyper.js — «Гиперзум»: Power Query → DuckDB в три шага.
   ① Оценка — какие шаги переводятся в SQL (карта переноса как «Примененные шаги»), прогноз выигрыша,
     словарь «команда Power Query → SQL», непереведённое — вручную или через Claude (обезличенно, gate()).
   ② В браузере — DuckDB-WASM считает тот же SQL на ваших данных; результат сверяется с логикой Power Query
     (интерпретатор Мастера), время — по запросам, прогноз на объёме, экономия часов, витрина для руководителя.
   ③ Комплект и обслуживание — папка для настоящего DuckDB (app/hzkit.js), Excel- и HTML-витрины,
     разбор журнала запусков.
   Данные не покидают компьютер: DuckDB работает в этой вкладке, комплект и витрины только сохраняются
   локально по явному действию; наружу (Claude) — только обезличенный код через gate().
   ===================================================================== */
const HZ = { tab: 'plan', plan: null, planKey: '', selQ: null, selStep: null, run: null, busy: false, progress: '', over: new Map(), counts: new Map(),
  calc: { min: 60, perDay: 1, days: 21, src: 30 }, scale: null, race: 'scale', maint: null, kit: { dir: '', book: '', time: '06:30', sched: true }, vz: false };
const HZ_KCLS = { sql: 'ok', claude: 'vio', source: 'acc', loader: 'warn', manual: 'bad', helper: '' };
const HZ_KLBL = { sql: 'SQL', claude: 'Claude', source: 'источник', loader: 'загрузчик', manual: 'вручную', helper: 'значение' };
const HZ_KCOL = { sql: 'var(--ok)', claude: 'var(--violet)', source: 'var(--accent)', loader: 'var(--warn)', manual: 'var(--bad)' };
const HZ_QST = { auto: ['ok', 'переносится'], loader: ['warn', 'нужен загрузчик'], partial: ['warn', 'частично'], manual: ['bad', 'вручную'], param: ['', 'параметр'] };
const hzPlanKey = () => S.work + '\u0001' + [...HZ.over].map(([k, v]) => k + '=' + v.hash + v.sql).join('\u0002');
function hzEnsure(){
  if (!S.A) return null; const k = hzPlanKey();
  if (HZ.planKey !== k){ HZ.plan = hzPlan(S.A, { over: HZ.over }); HZ.planKey = k; HZ.counts = new Map(); if (HZ.run && HZ.run.planKey !== k) HZ.run = null; }
  return HZ.plan;
}
const hzMs = ms => ms == null ? '—' : ms < 1 ? '<1 мс' : ms < 1000 ? Math.round(ms) + ' мс' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace('.', ',') + ' с';
const hzX = r => !isFinite(r) || r <= 0 ? '—' : '×' + (r >= 10 ? Math.round(r).toLocaleString('ru-RU') : r.toFixed(1).replace('.', ','));
/** Текст шага M: «Имя = выражение» (одиночный запрос — всё выражение) */
function hzStepCode(qn, step){
  const m = S.A && S.A.byName.get(qn); if (!m) return '';
  const s = m.steps && m.steps.steps.find(x => x.name === step); return s ? S.work.slice(s.s, s.exprE) : S.work.slice(m.exprStart, m.exprEnd).trim();
}
/** Подсветка SQL: комментарии, строки, имена в кавычках, ключевые слова */
function hzHl(sql){
  const KW = new Set('SELECT FROM WHERE GROUP BY ORDER AS WITH JOIN LEFT RIGHT FULL ANTI ON AND OR NOT IN IS NULL DISTINCT CASE WHEN THEN ELSE END OVER PARTITION ROWS BETWEEN UNBOUNDED PRECEDING FOLLOWING CURRENT ROW QUALIFY UNION ALL EXCLUDE REPLACE RENAME PIVOT UNPIVOT USING INTO NAME VALUE COLUMNS CREATE TABLE CAST TRUE FALSE DESC ASC NULLS FIRST LAST EXISTS IGNORE LIMIT COPY TO HEADER DELIMITER MACRO SET LOAD VALUES'.split(' '));
  let out = '', i = 0;
  while (i < sql.length){
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-'){ const e = sql.indexOf('\n', i); const j = e < 0 ? sql.length : e; out += '<span class="c">' + escHtml(sql.slice(i, j)) + '</span>'; i = j; continue; }
    if (ch === "'" || ch === '"'){ let j = i + 1; while (j < sql.length){ if (sql[j] === ch){ if (sql[j + 1] === ch){ j += 2; continue; } break; } j++; } out += '<span class="' + (ch === "'" ? 's' : 'q') + '">' + escHtml(sql.slice(i, j + 1)) + '</span>'; i = j + 1; continue; }
    const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i, i + 40));
    if (m){ const w = m[0]; out += KW.has(w.toUpperCase()) ? '<span class="k">' + w + '</span>' : /^\w+$/.test(w) && sql[i + w.length] === '(' ? '<span class="f">' + w + '</span>' : w; i += w.length; continue; }
    const n = /^\d+(\.\d+)?/.exec(sql.slice(i, i + 30)); if (n){ out += '<span class="n">' + n[0] + '</span>'; i += n[0].length; continue; }
    out += escHtml(ch); i++;
  }
  return out;
}
/** Перенос строк для чтения: FROM, WHERE, GROUP BY… с новой строки */
const hzPretty = sql => sql.replace(/(?<!DISTINCT|LEFT|RIGHT|FULL|ANTI|BY NAME) (FROM|WHERE|GROUP BY|QUALIFY|LEFT JOIN|RIGHT JOIN|FULL JOIN|ANTI JOIN|JOIN|UNION ALL BY NAME) /g, '\n  $1 ');
function hzDonut(segs, total, size){
  const r = 42, c = 2 * Math.PI * r; let off = 0;
  const arcs = segs.filter(([, n]) => n > 0).map(([k, n]) => { const len = n / (total || 1) * c; const a = '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + HZ_KCOL[k] + '" stroke-width="13" stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 50 50)"><title>' + HZ_KLBL[k] + ': ' + n + '</title></circle>'; off += len; return a; });
  return '<svg class="hz-donut" viewBox="0 0 100 100" width="' + (size || 132) + '" height="' + (size || 132) + '"><circle cx="50" cy="50" r="' + r + '" fill="none" stroke="var(--panel3)" stroke-width="13"/>' + arcs.join('') + '</svg>';
}

/* ---------- Навигация по шагам ---------- */
function hzNavHtml(){
  const P = HZ.plan, R = HZ.run, Z = HZ.scale;
  const ok = R ? R.items.filter(x => x.cmp && x.cmp.same).length : 0, tot = R ? R.items.filter(x => !x.skip).length : 0;
  const tabs = [
    ['plan', '1', 'Оценка', P ? P.stats.pct + '% шагов переводятся сразу' : 'что переносится в SQL', true],
    ['run', '2', 'Сверка и замер', R ? (ok === tot && tot ? '✓ совпало ' : 'совпало ') + ok + ' из ' + tot + (Z ? ' · быстрее ' + hzX(Z.ratio) : '') : 'DuckDB на ваших данных, прямо здесь', R && ok === tot && tot > 0],
    ['kit', '3', 'Комплект', HZ.maint ? 'журнал: ' + HZ.maint.runs.length + ' запусков' : 'настоящий DuckDB, витрины, расписание', !!HZ.maint]
  ];
  return tabs.map(([id, n, t, s, done]) => '<button class="hz-tab' + (HZ.tab === id ? ' on' : done ? ' done' : '') + '" data-hz-tab="' + id + '"><span class="hz-n">' + (done && HZ.tab !== id ? '✓' : n) + '</span><span><b>' + t + '</b><br><span class="small muted">' + escHtml(s) + '</span></span></button>').join('<span class="hz-arrow">→</span>');
}
function renderHyper(){
  if (!S.book || !S.A) return;
  hzEnsure();
  $('#hzNav').innerHTML = hzNavHtml();
  $('#hzBody').innerHTML = HZ.tab === 'run' ? hzRunHtml() : HZ.tab === 'kit' ? hzKitHtml() : hzPlanHtml();
  if (HZ.tab === 'run' && HZ.vz && HZ.run) hzShowVitrina();
}

/* ---------- ① Оценка ---------- */
function hzPlanHtml(){
  const P = HZ.plan, st = P.stats; const segs = [['sql', st.sql], ['source', st.source], ['loader', st.loader], ['manual', st.manual]];
  const tq = P.queries.filter(q => q.kind === 'table'); const man = tq.flatMap(q => q.manualSteps.map(s => [q, s]));
  const head = st.pct >= 90 ? 'Книга готова к Гиперзуму' : st.pct >= 60 ? 'Большая часть книги переносится сразу' : 'Перенос частичный — начать можно уже сейчас';
  const lead = 'Из ' + st.steps + ' шагов в ' + tq.length + ' запросах ' + (st.sql + st.source) + ' переводятся в SQL автоматически' + (st.loader ? ', ещё ' + st.loader + ' — внешние источники (1С OData, SQL Server, веб): в браузере их заменяют ваши выгрузки, в комплекте 1С и SQL Server выгружает загрузчик' : '') + (st.manual ? ', ' + st.manual + ' — вручную или через Claude (в браузере их посчитает Мастер, сверке это не мешает)' : '') + '. Каждый шаг Power Query станет шагом SQL с тем же именем — его легко узнать.';
  const hero = '<div class="card hz-hero"><div class="hz-dwrap">' + hzDonut(segs, st.steps) + '<div class="hz-dc"><b>' + st.pct + '%</b><span>сразу</span></div></div><div>' +
    '<div class="hz-big">' + head + '</div><p class="hz-lead">' + escHtml(lead) + '</p>' +
    '<div class="hz-seg">' + segs.filter(x => x[1]).map(([k, n]) => '<i style="flex:' + n + ';background:' + HZ_KCOL[k] + '" title="' + HZ_KLBL[k] + ': ' + n + '"></i>').join('') + '</div>' +
    '<div class="legend">' + segs.map(([k, n]) => '<span><i class="sw" style="background:' + HZ_KCOL[k] + '"></i>' + HZ_KLBL[k] + ': <b>' + n + '</b></span>').join('') + '</div>' +
    '<div class="hz-cta"><button class="btn pri big" data-hz-tab="run">Дальше: сверить на ваших данных →</button><span class="small muted">10–30 секунд · DuckDB работает в этой вкладке, данные никуда не уходят</span></div></div></div>';
  const manCard = man.length ? '<div class="card hz-man"><div class="card-h"><h2>Осталось перевести: ' + man.length + ' ' + hzPlural(man.length, 'шаг', 'шага', 'шагов') + '</h2><span class="sp"></span><button class="btn" id="hzClaude" title="Скопировать задачу: только обезличенный код, проходит сканер утечек">🤖 Задача для Claude</button><button class="btn" id="hzClaudeIn">📥 Вставить ответ</button></div>' +
    '<p class="small muted" style="margin:0 0 6px">Сверке и замеру они не мешают: в браузере эти шаги посчитает Мастер. Для комплекта (настоящий DuckDB) нужен SQL — напишите сами или попросите Claude.</p>' +
    '<ul class="next-list">' + man.map(([q, s]) => '<li><span class="badge bad">вручную</span><b>' + escHtml(q.name) + '</b> › <a href="#" data-hz-q="' + escHtml(q.name) + '" data-hz-s="' + escHtml(s.name) + '">' + escHtml(s.name) + '</a><span class="small muted">— ' + escHtml(s.reason) + '</span><span class="sp"></span><button class="btn sm" data-hz-man="' + escHtml(q.name + '\u0001' + s.name) + '">✍ Перевести</button></li>').join('') + '</ul></div>' : '';
  const map = '<div class="card"><div class="card-h"><h2>Карта переноса</h2><span class="small muted">шаги каждого запроса — как в «Примененных шагах»; нажмите шаг: Power Query и SQL рядом</span><span class="sp"></span><span class="legend">' + ['sql', 'source', 'loader', 'manual', 'claude'].map(k => '<span><i class="sw" style="background:' + HZ_KCOL[k] + '"></i>' + HZ_KLBL[k] + '</span>').join('') + '</span></div>' +
    P.queries.filter(q => q.kind !== 'param').map(q => { const on = HZ.selQ === q.name;
      return '<div class="hz-q' + (on ? ' on' : '') + '"><div class="hz-qn"><b data-hz-q="' + escHtml(q.name) + '">' + escHtml(q.name) + '</b>' + hzQBadge(q) + (q.out ? '<span class="badge acc" title="загружается на лист или в модель">итоговый</span>' : '') + (P.dims.has(q.name) ? '<span class="badge" title="к нему обращаются слияния и поиск">справочник</span>' : '') + '<span class="sp"></span>' + (q.kind === 'table' ? '<button class="link small" data-hz-sqlall="' + escHtml(q.name) + '">весь SQL</button>' : '') + '</div><div class="hz-chips">' +
        (q.kind === 'fn' ? '<span class="small muted">' + escHtml(q.reason) + '</span>' : q.steps.filter(s => !s.dead).map(s => '<button class="hz-st k-' + s.kind + (on && HZ.selStep === s.name ? ' sel' : '') + '" data-hz-q="' + escHtml(q.name) + '" data-hz-s="' + escHtml(s.name) + '" title="' + escHtml((s.op ? s.op.ui + ' → ' + s.op.sql : s.fn || '') + (s.reason ? ' · ' + s.reason : '')) + '">' + escHtml(s.name) + '</button>').join('<span class="hz-ch">›</span>')) + '</div>' +
        (on && q.kind === 'table' ? '<div class="hz-inline">' + hzDetailBody(q) + '</div>' : '') + '</div>'; }).join('') + '</div>';
  const gains = tq.slice().sort((a, b) => b.gain.level - a.gain.level);
  const gainCard = '<div class="card"><div class="card-h"><h2>Где ждём выигрыш</h2><span class="small muted">прогноз по операциям; замер — на шаге 2</span></div><div class="hz-gains">' +
    gains.map(q => '<div class="hz-gain" data-hz-q="' + escHtml(q.name) + '"><span class="hz-lvl" title="уровень выигрыша">' + [0, 1, 2, 3].map(i => '<i class="' + (i <= q.gain.level ? 'on l' + q.gain.level : '') + '"></i>').join('') + '</span><div><b>' + escHtml(q.name) + '</b> ' + hzQBadge(q) + '<div class="small muted">' + escHtml(q.gain.text) + '</div></div></div>').join('') + '</div></div>';
  const used = new Set(tq.flatMap(q => q.steps.map(s => s.fn))); const gl = [...HZ_OPS].filter(([f]) => used.has(f));
  const gloss = gl.length ? '<div class="card"><div class="card-h"><h2>Словарь: Power Query → SQL</h2><span class="small muted">команды этой книги</span></div><table class="hz-tbl"><tr><th>Команда Power Query</th><th>В SQL</th><th>Что делает</th></tr>' +
    gl.map(([f, o]) => '<tr><td><b>' + escHtml(o.ui) + '</b><div class="small muted mono">' + escHtml(f) + '</div></td><td class="mono">' + escHtml(o.sql) + '</td><td class="small">' + escHtml(o.note) + '</td></tr>').join('') + '</table></div>' : '';
  return hero + manCard + map + '<div class="viz-2col">' + gainCard + gloss + '</div>';
}
const hzPlural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
function hzQBadge(q){ const s = HZ_QST[q.status] || ['', q.status]; return '<span class="badge ' + s[0] + '">' + s[1] + '</span>'; }
function hzStepSqlHtml(q, s){
  if (s.kind === 'sql' || s.kind === 'claude'){ if (s.fused) return '<p class="small muted">Слияние выполняется вместе со следующим шагом («Развернуть» или «Агрегировать») — одним JOIN. Нажмите следующий шаг.</p>'; return '<pre class="code wrap">' + hzHl('-- ' + (s.op ? s.op.ui + ' → ' + s.op.sql : 'перевод вручную') + '\n' + hzQ(s.cte) + ' AS (\n  ' + hzPretty(s.sql) + '\n)') + '</pre>'; }
  if (s.reader){ const r = hzReader(q, s, { wb: hzWbInfo(), bookPath: HZ.kit.book || 'КНИГА.xlsx', text: S.work }); return r ? '<pre class="code wrap">' + hzHl('-- ' + r.note + '\n' + r.sql) + '</pre><p class="small muted">' + (r.prep ? 'Перед чтением: ' + escHtml(r.prep.kind === 'recode' ? 'перекодировка в UTF-8 (PowerShell)' : r.prep.kind === 'odata' ? 'выгрузка из 1С OData в CSV (PowerShell)' : 'выгрузка из SQL Server в CSV (PowerShell)') + '. ' : '') + 'В браузере этот шаг считает Мастер, в комплекте — DuckDB читает источник сам.</p>' : '<p class="small muted">Источник без готового чтения в комплекте.</p>'; }
  if (s.kind === 'helper') return '<p class="small muted">Значение или список — DuckDB подставит его прямо в те шаги, где оно используется.</p>';
  return '<div class="note bad small"><b>Не переводится автоматически:</b> ' + escHtml(s.reason) + '</div><p class="small muted">В браузере этот шаг посчитает Мастер по логике Power Query, всё после него — DuckDB. Для комплекта нужен SQL: <button class="btn sm" data-hz-man="' + escHtml(q.name + '\u0001' + s.name) + '">✍ Перевести</button></p>';
}
/** Шаг запроса: Power Query и SQL рядом, пояснение команды и тонкости */
function hzDetailBody(q){
  const s = q.steps.find(x => x.name === HZ.selStep && !x.dead) || q.steps.find(x => x.kind !== 'helper') || q.steps[0];
  const risks = s.risks.map(r => '<li>' + escHtml(HZ_RISKS[r]) + '</li>').join('');
  return '<div class="hz-dh"><b>Шаг «' + escHtml(s.name) + '»</b><span class="badge ' + HZ_KCLS[s.kind] + '">' + HZ_KLBL[s.kind] + '</span>' + (s.op ? '<span class="small">Power Query: <b>' + escHtml(s.op.ui) + '</b> → SQL: <b>' + escHtml(s.op.sql) + '</b> <span class="muted">— ' + escHtml(s.op.note) + '</span></span>' : '') + '</div>' +
    '<div class="hz-panes"><div><div class="pane-cap">Power Query (M)</div><pre class="code wrap">' + highlightM(hzStepCode(q.name, s.name)) + '</pre></div><div><div class="pane-cap">DuckDB (SQL)</div>' + hzStepSqlHtml(q, s) + '</div></div>' +
    (risks ? '<div class="note warn small"><b>Тонкость перевода:</b><ul style="margin:4px 0 0 18px;padding:0">' + risks + '</ul></div>' : '');
}
/** Таблицы книги: имя → лист и диапазон (для чтения в комплекте) */
function hzWbInfo(){
  const m = new Map(); if (!DATA.wb || !S.book || !S.book.zip) return m;
  for (const t of DATA.wb.tables) if (t.sheet) m.set(t.name, { sheet: t.sheet, range: t.range || null });
  return m;
}

/* ---------- ② Сверка и замер ---------- */
const hzProgFn = () => t => { HZ.progress = t; const el = $('#hzProg'); if (el) el.textContent = t; };
async function hzRun(){
  if (HZ.busy || !S.A) return;
  HZ.busy = true; HZ.progress = ''; HZ.scale = null; renderHyper();
  const prog = hzProgFn();
  try {
    const P = hzEnsure();
    await duckOpen(prog);
    if (!dataRunValid()){ prog('Эталон: запросы по логике Power Query…'); await tick(); await dataRunAll(); }
    if (!dataRunValid()) throw new Error('не удалось посчитать запросы по логике Power Query — откройте «Проверку на данных»');
    const items = []; const mvals = new Map(); for (const r of DATA.run.queries) if (r.value != null) mvals.set(r.name, r.value);
    for (const q of P.queries){
      if (q.kind !== 'table') continue;
      const ref = DATA.run.queries.find(x => x.name === q.name); const it = { name: q.name, out: q.out, status: q.status, mat: q.mat.length };
      if (!ref || ref.error || !(ref.value instanceof MTab)){ it.skip = ref && ref.error ? (ref.error.need ? 'нет файла: ' + (ref.error.need.path || '').replace(/^.*[\\/]/, '') : 'ошибка в Power Query') : 'результат — не таблица'; it.skipWhy = ref && ref.error ? ref.error.message : ''; items.push(it); continue; }
      prog('«' + q.name + '»: готовые таблицы…'); await tick();
      const bset = new Set(q.steps.filter(s => s.idx <= q.boundary).map(s => s.name));
      it.pqMs = ref.ms; it.pqSrcMs = ref.steps.filter(s => bset.has(s.name)).reduce((a, s) => a + (s.ms || 0), 0); it.pqTrMs = Math.max(0, it.pqMs - it.pqSrcMs); it.pqRows = ref.value.rows.length;
      try {
        let vals = new Map(); const t0 = performance.now();
        if (q.mat.length){ const ov = typeof sbOverrides === 'function' ? sbOverrides(q.name) : { steps: new Map(), queries: new Map() }; vals = mStepValues(S.work, q.name, q.mat, { steps: ov.steps, queries: new Map([...mvals, ...ov.queries]) }); }
        it.matMs = performance.now() - t0; const t1 = performance.now(); it.load = { errs: 0, mixed: [] };
        for (const [n, v] of vals){ if (!(v instanceof MTab)) throw new Error('шаг «' + n + '» — не таблица'); const li = duckLoad(hzMatName(q.name, n), v); it.load.errs += li.errs; it.load.mixed.push(...li.mixed); }
        it.loadMs = performance.now() - t1; it.vals = vals;
        prog('«' + q.name + '»: DuckDB…'); await tick();
        const sql = hzQuerySql(P, q); duckQuery(sql); const t2 = performance.now(); duckQuery(sql); it.duckMs = performance.now() - t2;   // второй прогон — без разовой подготовки движка
        it.types = duckQuery('DESCRIBE ' + hzQ(q.name)).toArray().map(r => [r.column_name, r.column_type]);
        const dt = duckTab(q.name); it.cmp = hzCompare(ref.value, dt); it.duckRows = dt.rows.length;
      } catch (e){
        it.sqlError = e.message;
        try { duckLoad(q.name, ref.value); duckQuery('ALTER TABLE ' + hzQ(q.name) + ' ADD COLUMN ' + HZ_R + ' DOUBLE'); duckQuery('UPDATE ' + hzQ(q.name) + ' SET ' + HZ_R + ' = rowid + 1'); it.fallback = true; } catch { /* зависимые запросы тоже не посчитаются */ }
      }
      items.push(it);
    }
    const done = items.filter(x => x.duckMs != null && x.cmp); const tr = done.filter(x => hzTrans(x.name));
    const pq = tr.reduce((a, x) => a + x.pqTrMs, 0), dk = tr.reduce((a, x) => a + x.duckMs, 0);
    HZ.run = { planKey: HZ.planKey, forWork: S.work, items, pq, dk, ratio: dk ? pq / dk : 0, at: new Date(), init: DUCK.ms, ver: DUCK.ver };
    HZ.selQ = (items.find(x => x.cmp && !x.cmp.same) || items.find(x => x.sqlError) || {}).name || null; HZ.selStep = null;
    // на маленьких данных разницу не видно — сразу замер на объёме ≈ 200 тыс. строк (обе стороны по-настоящему)
    const big = Math.max(0, ...done.flatMap(it => [...it.vals.values()].map(v => v.rows.length)));
    if (done.length && big > 0 && big < 50000) await hzScale(0, true);
  } catch (e){ console.error(e); toast('Гиперзум: ' + e.message, 'bad'); }
  finally { HZ.busy = false; HZ.progress = ''; renderHyper(); }
}
/** У запроса есть преобразования в SQL (а не только чтение источника) — только такие идут в гонку и общий множитель */
const hzTrans = n => { const q = HZ.plan.byName.get(n); return !!q && q.sqlSteps > 0 && !q.mat.includes(q.final); };
const hzRepeat = (t, k) => { const rows = new Array(t.rows.length * k); let o = 0; for (let i = 0; i < k; i++) for (const r of t.rows) rows[o++] = r; return new MTab(t.cols, rows); };
/** Замер на объёме: таблицы-«факты» (не справочники) размножаются ×k, затем те же запросы считают DuckDB и логика Power Query.
    Обе стороны — настоящий замер (до ~400 тыс. строк); больше — время Power Query пересчитывается по замеру на ваших данных. */
async function hzScale(k, auto){
  if (!HZ.run || (HZ.busy && !auto)) return;
  const prog = hzProgFn();
  if (!auto){ HZ.busy = true; renderHyper(); }
  const P = HZ.plan;
  try {
    const items = HZ.run.items.filter(it => it.duckMs != null && !it.sqlError && !it.fallback);
    const cand = []; for (const it of items) for (const [n, v] of it.vals || []) cand.push({ q: it.name, name: hzMatName(it.name, n), rows: v.rows.length, dim: P.dims.has(it.name) });
    let facts = cand.filter(c => !c.dim && c.rows); if (!facts.length) facts = cand.filter(c => c.rows);
    if (!facts.length) throw new Error('нет таблиц, которые можно размножить');
    const big = Math.max(...facts.map(c => c.rows)); const grow = facts.filter(c => c.rows >= big * 0.3);
    if (!k) k = Math.max(2, Math.round(200000 / big));
    k = Math.max(2, Math.min(k, Math.floor(5e6 / big)));
    const measured = big * k <= 400000;
    for (const c of grow){ duckQuery('CREATE OR REPLACE TABLE ' + hzQ(c.name + '·orig') + ' AS SELECT * FROM ' + hzQ(c.name)); duckQuery('CREATE OR REPLACE TABLE ' + hzQ(c.name) + ' AS SELECT x.* FROM ' + hzQ(c.name + '·orig') + ' AS x, range(' + k + ')'); }
    const res = [];
    try {
      for (const it of items){ prog('DuckDB на объёме ×' + k.toLocaleString('ru-RU') + ': «' + it.name + '»…'); await tick(); const sql = hzQuerySql(P, P.byName.get(it.name)); const t0 = performance.now(); duckQuery(sql); res.push({ name: it.name, ms: performance.now() - t0, rows: duckCount('SELECT * FROM ' + hzQ(it.name)) }); }
    } finally {
      for (const c of grow){ duckQuery('CREATE OR REPLACE TABLE ' + hzQ(c.name) + ' AS SELECT * FROM ' + hzQ(c.name + '·orig')); duckQuery('DROP TABLE IF EXISTS ' + hzQ(c.name + '·orig')); }
      for (const it of items) duckQuery(hzQuerySql(P, P.byName.get(it.name)));
    }
    if (measured){
      const done = new Map(); for (const r of DATA.run.queries) if (r.value != null) done.set(r.name, r.value);
      for (const it of items){
        const q = P.byName.get(it.name); const r = res.find(x => x.name === it.name); const m = S.A.byName.get(it.name);
        const scaled = new Map(); for (const [n, v] of it.vals){ scaled.set(n, grow.some(c => c.name === hzMatName(it.name, n)) ? hzRepeat(v, k) : v); }
        if (!m || !m.steps){ const v = scaled.get(q.final); if (v) done.set(it.name, v); r.pq = 0; r.pqRows = v ? v.rows.length : null; continue; }   // запрос из одного выражения — только источник
        prog('Power Query на объёме ×' + k.toLocaleString('ru-RU') + ': «' + it.name + '»…'); await tick();
        const after = new Set(q.steps.filter(s => s.idx > q.boundary).map(s => s.name)); after.add('in → результат');
        const rr = mRunSteps(S.work, it.name, { steps: scaled, queries: done }); const fin = rr[rr.length - 1];
        if (fin.value != null) done.set(it.name, fin.value);
        r.pq = rr.filter(s => after.has(s.name)).reduce((a, s) => a + (s.ms || 0), 0); r.pqRows = fin.value instanceof MTab ? fin.value.rows.length : null;
      }
    } else for (const r of res){ const it = items.find(x => x.name === r.name); r.pq = it.pqTrMs * k; r.est = true; }
    const rt = res.filter(r => hzTrans(r.name)); const pq = rt.reduce((a, r) => a + r.pq, 0), dk = rt.reduce((a, r) => a + r.ms, 0);
    HZ.scale = { k, items: res, grown: grow.length, rows: grow.reduce((a, c) => a + c.rows * k, 0), measured, auto: !!auto, pq, dk, ratio: dk ? pq / dk : 0 };
    HZ.race = 'scale';
  } catch (e){ console.error(e); toast('Замер на объёме: ' + e.message, 'bad'); }
  finally { if (!auto){ HZ.busy = false; HZ.progress = ''; renderHyper(); } }
}
function hzRunStartHtml(){
  const wb = DATA.wb ? DATA.wb.tables.length + DATA.wb.names.length : 0, files = DATA.files.size + [...DATA.folders.values()].reduce((a, x) => a + x.length, 0);
  const needs = typeof dataNeeds === 'function' ? dataNeeds() : new Map();
  const row = (ok, t, s) => '<li class="' + (ok ? 'ok' : 'todo') + '"><span>' + (ok ? '✓' : '•') + '</span><b>' + t + '</b> <span class="small muted">' + s + '</span></li>';
  return '<div class="card hz-start"><h2>Сверим и замерим на ваших данных</h2>' +
    '<ol class="hz-how"><li><b>Эталон.</b> Мастер считает каждый запрос по логике Power Query.</li><li><b>DuckDB.</b> Тот же запрос считается по переведённому SQL — в этой вкладке.</li><li><b>Сверка.</b> Результаты сравниваются построчно; на маленьких данных Мастер сам замерит скорость на объёме ≈ 200 тыс. строк.</li></ol>' +
    '<ul class="hz-check">' + row(S.book.family !== 'excel' || wb > 0 || !!DATA.wb, 'Таблицы книги', wb ? 'прочитано: ' + wb : 'прочитаются сами при запуске') +
    row(!needs.size, 'Выгрузки, которые читают запросы', (files ? 'прикреплено файлов: ' + files : 'не прикреплены') + (needs.size ? ' · не хватает: ' + needs.size + ' — <a href="#" data-hz-go="data">прикрепить в «Проверке на данных»</a>' : !files ? ' · если запросы читают CSV/Excel — <a href="#" data-hz-go="data">прикрепите</a>' : '')) +
    row(true, 'DuckDB', 'встроен в этот файл, запуск ≈ 2 с') + '</ul>' +
    '<div class="hz-cta"><button class="btn pri big" id="hzRunBtn"' + (HZ.busy ? ' disabled' : '') + '>' + (HZ.busy ? '⏳ <span id="hzProg">' + escHtml(HZ.progress || 'Считаю…') + '</span>' : '▶ Запустить сверку') + '</button><span class="small muted">🔒 Данные не покидают эту вкладку: сеть запрещена, DuckDB работает в памяти.</span></div></div>';
}
function hzRunHtml(){
  const R = HZ.run; if (!R) return hzRunStartHtml();
  const Z = HZ.scale; const items = R.items; const ok = items.filter(x => x.cmp && x.cmp.same).length, tot = items.filter(x => !x.skip).length;
  const c = HZ.calc; const ratio = Z ? Z.ratio : R.ratio; const share = Math.min(95, Math.max(0, c.src)) / 100;
  const after = c.min * share + c.min * (1 - share) / Math.max(1, ratio); const saved = Math.max(0, (c.min - after) * c.perDay * c.days / 60);
  const head = '<div class="card hz-head"><div class="card-h"><h2>Сверка и замер</h2><span class="small muted">' + escHtml(fmtDateTime(R.at)) + ' · DuckDB ' + escHtml(R.ver || '') + ' · запуск движка ' + hzMs(R.init) + '</span><span class="sp"></span>' +
    '<button class="btn" id="hzRunBtn"' + (HZ.busy ? ' disabled' : '') + '>' + (HZ.busy ? '⏳ <span id="hzProg">' + escHtml(HZ.progress || 'Считаю…') + '</span>' : '↻ Пересчитать') + '</button></div>' +
    (ok === tot && tot ? '<div class="note ok small">✓ Все ' + tot + ' ' + hzPlural(tot, 'запрос', 'запроса', 'запросов') + ' дали в DuckDB тот же результат, что Power Query. Этот же SQL будет работать в комплекте.</div>' : '<div class="note warn small">Совпало ' + ok + ' из ' + tot + '. Нажмите строку с «≠» в таблице сверки — Мастер покажет шаг, где начинается расхождение.</div>') +
    (items.some(x => x.skip) ? '<div class="note small">Без эталона: ' + items.filter(x => x.skip).map(x => '«' + escHtml(x.name) + '» (' + escHtml(x.skip) + ')').join(', ') + ' — <a href="#" data-hz-go="data">прикрепите данные</a> и пересчитайте.</div>' : '') + '</div>';
  const tiles = '<div class="tiles hz-tiles">' +
    '<div class="tile"><div class="small muted">Сверка с Power Query</div><div class="hz-tv ' + (ok === tot ? 'ok' : 'bad') + '">' + ok + ' из ' + tot + '</div><div class="small muted">запросов совпали</div></div>' +
    '<div class="tile hz-wow"><div class="small muted">Преобразования быстрее</div><div class="hz-tv acc">' + hzX(ratio) + '</div><div class="small muted">' + (Z ? 'на объёме ' + fmtN(Z.rows) + ' строк' + (Z.measured ? ', обе стороны — замер' : ', Power Query — оценка') : 'на ваших данных') + '</div></div>' +
    '<div class="tile"><div class="small muted">Время преобразований</div><div class="hz-tv">' + hzMs(Z ? Z.dk : R.dk) + '</div><div class="small muted">вместо ' + hzMs(Z ? Z.pq : R.pq) + ' по логике Power Query</div></div>' +
    '<div class="tile"><div class="small muted">Экономия в месяц</div><div class="hz-tv ok">' + saved.toFixed(saved < 10 ? 1 : 0).replace('.', ',') + ' ч</div><div class="small muted">при обновлении ' + c.min + ' мин × ' + c.perDay + ' в день — <a href="#" data-hz-scroll="hzCalc">настроить</a></div></div></div>';
  const useZ = Z && HZ.race !== 'base';
  const all = useZ ? Z.items.map(s => ({ name: s.name, pq: s.pq, dk: s.ms, est: s.est, same: s.pqRows == null || s.pqRows === s.rows })) : items.filter(x => x.duckMs != null).map(x => ({ name: x.name, pq: x.pqTrMs, dk: x.duckMs }));
  const trans = hzTrans;
  const rows = all.filter(x => trans(x.name)); const idle = all.filter(x => !trans(x.name)).map(x => x.name);
  const mx = Math.max(1, ...rows.map(x => Math.max(x.pq || 0, x.dk || 0)));
  const race = '<div class="card"><div class="card-h"><h2>Гонка: Power Query против DuckDB</h2><span class="small muted">одни и те же шаги; чтение источников одинаковое и не входит</span><span class="sp"></span>' +
    (Z ? '<div class="seg"><button data-hz-race="scale" class="' + (useZ ? 'on' : '') + '">на объёме ×' + Z.k.toLocaleString('ru-RU') + '</button><button data-hz-race="base" class="' + (useZ ? '' : 'on') + '">на ваших данных</button></div>' : '') +
    '<span class="legend"><i class="sw" style="background:var(--viz-2)"></i>Power Query <i class="sw" style="background:var(--viz-1)"></i>DuckDB</span></div><div class="hz-race">' +
    rows.map(x => '<div class="hz-rr" data-hz-q="' + escHtml(x.name) + '"><span class="hz-rl">' + escHtml(x.name) + (x.same === false ? ' <span class="badge bad" title="на объёме число строк разошлось">≠</span>' : '') + '</span><div class="hz-rb"><div><i class="pq" style="width:' + Math.max(0.4, (x.pq || 0) / mx * 82).toFixed(1) + '%"></i><span>' + hzMs(x.pq) + (x.est ? ' (оценка)' : '') + '</span></div><div><i class="dk" style="width:' + Math.max(0.4, x.dk / mx * 100).toFixed(1) + '%"></i><span>' + hzMs(x.dk) + '</span></div></div><b class="hz-rx">' + hzX(x.pq / x.dk) + '</b></div>').join('') + '</div>' +
    (idle.length ? '<p class="small muted" style="margin:8px 0 0">Без преобразований (только чтение источника): ' + idle.map(n => '«' + escHtml(n) + '»').join(', ') + '.</p>' : '') +
    (!useZ && R.pq < 300 ? '<p class="note small">На маленьких данных разницы почти нет: DuckDB тратит на запуск запроса миллисекунды. Выигрыш растёт с объёмом — посмотрите вкладку «на объёме».</p>' : '') +
    '<div class="hz-scale"><span class="small muted">Замерить на объёме:</span>' + [10, 100, 1000].map(k => '<button class="btn sm" data-hz-scale="' + k + '"' + (HZ.busy ? ' disabled' : '') + '>×' + k + '</button>').join('') + '<button class="btn sm" data-hz-scale="0"' + (HZ.busy ? ' disabled' : '') + '>≈ 200 тыс. строк</button><span class="small muted">размножаются таблицы-факты, справочники — нет; считают обе стороны</span></div></div>';
  const ver = '<div class="card"><div class="card-h"><h2>Сверка по запросам</h2><span class="small muted">столбцы — по именам, строки — как набор; числа — до 10 значащих цифр. Нажмите строку — шаги запроса</span></div><table class="hz-tbl hz-ver"><tr><th>Запрос</th><th class="num">строк PQ</th><th class="num">строк DuckDB</th><th>Результат</th><th class="num">PQ</th><th class="num">DuckDB</th></tr>' +
    items.map(x => '<tr data-hz-q="' + escHtml(x.name) + '" class="' + (HZ.selQ === x.name ? 'sel' : '') + '"><td><b>' + escHtml(x.name) + '</b>' + (x.out ? ' <span class="badge acc">итоговый</span>' : '') + '</td><td class="num">' + fmtN(x.pqRows) + '</td><td class="num">' + fmtN(x.duckRows) + '</td><td>' +
      (x.skip ? '<span class="badge" title="' + escHtml(x.skipWhy || '') + '">' + escHtml(x.skip) + '</span>' : x.sqlError ? '<span class="badge bad">ошибка SQL</span> <span class="small">' + escHtml(x.sqlError.split('\n')[0].slice(0, 160)) + '</span>' : x.cmp.same ? '<span class="badge ok">✓ ' + escHtml(x.cmp.note) + '</span>' : '<span class="badge bad">≠</span> <span class="small">' + escHtml(x.cmp.note) + '</span>') +
      (x.cmp && x.cmp.errA ? ' <span class="small muted" title="в DuckDB ошибок в ячейках нет — такие ячейки пустые">ошибок в ячейках PQ: ' + x.cmp.errA + '</span>' : '') + (x.load && x.load.mixed.length ? ' <span class="small muted">смешанные типы → текст: «' + escHtml(x.load.mixed.slice(0, 3).join('», «')) + '»</span>' : '') + '</td><td class="num">' + hzMs(x.pqTrMs) + '</td><td class="num">' + hzMs(x.duckMs) + '</td></tr>').join('') + '</table></div>';
  const q = HZ.selQ && HZ.plan.byName.get(HZ.selQ); const it = q && items.find(x => x.name === q.name);
  const det = q && it && !it.skip ? hzStepsCmpHtml(q, it) : '';
  const calc = '<div class="card" id="hzCalc"><div class="card-h"><h2>Экономия времени</h2><span class="small muted">для руководителя: сколько часов перестанет уходить на ожидание</span></div><div class="hz-calc">' +
    '<label>Обновление сейчас, мин<input type="number" min="1" data-hz-calc="min" value="' + c.min + '"></label><label>Обновлений в день<input type="number" min="1" data-hz-calc="perDay" value="' + c.perDay + '"></label><label>Рабочих дней в месяц<input type="number" min="1" data-hz-calc="days" value="' + c.days + '"></label><label>Доля чтения источников, %<input type="number" min="0" max="95" data-hz-calc="src" value="' + c.src + '"></label></div>' +
    '<div class="hz-calc-out"><div><span class="small muted">будет длиться</span><b>' + (after < 1 ? Math.max(1, Math.round(after * 60)) + ' с' : after.toFixed(1).replace('.', ',') + ' мин') + '</b></div><div><span class="small muted">экономия в месяц</span><b>' + saved.toFixed(1).replace('.', ',') + ' ч</b></div><div><span class="small muted">ускорение преобразований</span><b>' + hzX(ratio) + '</b></div></div>' +
    '<p class="small muted">Чтение источников (1С, файлы) DuckDB само не ускоряет — эта доля остаётся; загрузка только новых периодов сократит и её. Ускорение — ' + (Z ? 'по замеру на объёме ×' + Z.k.toLocaleString('ru-RU') : 'по замеру на ваших данных') + '.</p></div>';
  const vz = '<div class="card"><div class="card-h"><h2>Витрина для руководителя</h2><span class="sp"></span><button class="btn" id="hzVz">' + (HZ.vz ? 'Скрыть' : '👁 Показать') + '</button><button class="btn" id="hzVzDl" title="HTML-файл с итоговыми таблицами и графиками — открывается в любом браузере">⬇ Скачать</button></div><p class="small muted" style="margin:0">Итоговые запросы из DuckDB — плитки с итогами, динамика по месяцам, крупнейшие статьи, таблицы с поиском. Тот же вид комплект обновляет по расписанию.</p><div id="hzVzBox"' + (HZ.vz ? '' : ' class="hidden"') + '></div></div>';
  const next = '<div class="hz-next"><span>' + (ok === tot && tot ? 'Сверка пройдена — можно собирать комплект для настоящего DuckDB.' : 'Комплект можно собрать и сейчас: в него войдут совпавшие запросы.') + '</span><button class="btn pri big" data-hz-tab="kit">Дальше: комплект →</button></div>';
  return head + tiles + race + ver + det + calc + vz + next;
}
/** Шаги запроса: строки в Power Query и в DuckDB по каждому шагу — первое расхождение видно сразу */
function hzStepsCmpHtml(q, it){
  const ref = DATA.run.queries.find(x => x.name === q.name); const P = HZ.plan; const parts = hzQueryParts(P, q); const real = parts.ctes.filter(c => !c.fused);
  let counts = HZ.counts.get(q.name);
  if (!counts && DUCK.c && !it.sqlError){ counts = new Map(); real.forEach((c, i) => { try { counts.set(c.step, duckCount(hzWith(parts, i) + ' SELECT * FROM ' + c.name)); } catch { counts.set(c.step, null); } }); HZ.counts.set(q.name, counts); }
  let first = null;
  const rows = q.steps.filter(s => s.kind !== 'helper').map(s => { const pr = ref && ref.steps.find(x => x.name === s.name); const a = pr ? pr.rows : null; const b = counts && counts.has(s.name) ? counts.get(s.name) : null; const bad = a != null && b != null && a !== b; if (bad && !first) first = s.name;
    return '<tr data-hz-q="' + escHtml(q.name) + '" data-hz-s="' + escHtml(s.name) + '" class="' + (bad ? 'bad' : '') + (HZ.selStep === s.name ? ' sel' : '') + '"><td>' + escHtml(s.name) + '</td><td class="small">' + escHtml(s.op ? s.op.ui : s.fn || '') + '</td><td><span class="badge ' + HZ_KCLS[s.kind] + '">' + HZ_KLBL[s.kind] + '</span></td><td class="num">' + fmtN(a) + '</td><td class="num">' + (b == null ? (s.idx <= q.boundary && !q.mat.includes(s.name) ? '<span class="small muted">считает Мастер</span>' : '—') : fmtN(b)) + '</td><td>' + (bad ? '≠' : a != null && b != null ? '✓' : '') + '</td></tr>'; });
  return '<div class="card"><div class="card-h"><h2>«' + escHtml(q.name) + '» по шагам</h2><span class="small muted">строки после каждого шага: Power Query и DuckDB' + (first ? ' · <b>первое расхождение — шаг «' + escHtml(first) + '»</b>' : '') + '</span></div>' +
    '<table class="hz-tbl hz-ver"><tr><th>Шаг</th><th>Команда Power Query</th><th></th><th class="num">строк PQ</th><th class="num">строк DuckDB</th><th></th></tr>' + rows.join('') + '</table><div class="hz-inline">' + hzDetailBody(q) + '</div></div>';
}
/** Данные витрины из DuckDB: итоговые запросы, до 50 000 строк */
function hzVitrinaData(){
  const tabs = []; for (const it of HZ.run.items){ if (!it.out || it.duckMs == null || it.sqlError) continue; const t = duckTab(it.name, 50000); tabs.push({ name: it.name, cols: t.cols, rows: t.rows.map(r => r.map(v => v instanceof MDate ? mToText(v) : v)) }); }
  return { title: 'Витрина — ' + S.book.name.replace(/\.[^.]+$/, ''), built: new Date().toLocaleString('ru-RU'), tables: tabs };
}
function hzShowVitrina(){ const box = $('#hzVzBox'); if (!box || !DUCK.c) return;
  if (!$('#hzVzStyle')){ const st = document.createElement('style'); st.id = 'hzVzStyle'; st.textContent = HZ_VZ_CSS; document.head.appendChild(st); }
  box.classList.add('vz'); box.classList.remove('hidden'); try { hzVitrinaRender(box, hzVitrinaData()); } catch (e){ box.textContent = 'Витрина: ' + e.message; } }
async function hzLocalSave(what){
  const r = await modal('<h2>Сохранить ' + escHtml(what) + '</h2><p>Файл содержит <b>данные и пути компании</b> (итоги, имена контрагентов, пути к выгрузкам). Он сохраняется только на этот компьютер — как «Сохранить копию» книги. Не пересылайте его наружу.</p>', [['cancel', 'Отмена'], ['ok', 'Сохранить', 'pri']]);
  return r === 'ok';
}

/* ---------- ③ Комплект и обслуживание ---------- */
function hzKitOpts(){
  const base = S.book.name.replace(/\.[^.]+$/, '');
  const types = new Map(); if (HZ.run) for (const it of HZ.run.items) if (it.types) types.set(it.name, it.types);
  return { book: S.book.name, bookPath: HZ.kit.book || 'C:\\Отчёты\\' + S.book.name, kitDir: HZ.kit.dir || 'C:\\Гиперзум\\' + HZ_SAFE(base), wb: hzWbInfo(), run: dataRunValid() ? DATA.run : null, schedule: HZ.kit.sched ? HZ.kit.time : '', types, now: new Date().toLocaleString('ru-RU'), text: S.work };
}
function hzKitHtml(){
  const P = HZ.plan; const ok = hzKitQueries(P); const tq = P.queries.filter(q => q.kind === 'table'); const o = hzKitOpts();
  const srcs = []; const loaders = []; let xl = false;
  for (const q of tq) for (const n of q.mat){ const s = q.steps.find(x => x.name === n); if (!s.reader) continue; const r = s.reader; if (r.kind === 'wb' || r.kind === 'xlsx') xl = true; (r.loader ? loaders : srcs).push(r.kind === 'wb' ? 'таблица «' + r.table + '»' : r.kind === 'csv' ? 'CSV ' + r.path.replace(/^.*[\\/]/, '') : r.kind === 'xlsx' ? 'лист «' + r.sheet + '»' : r.kind === 'odata' ? '1С: ' + r.entity : r.kind === 'sqldb' ? 'SQL: ' + (r.table || 'запрос') : r.kind === 'folder' ? 'папка ' + r.path.replace(/^.*[\\/]/, '') : r.kind); }
  const box = (t, items, cls) => '<div class="hz-fbox ' + (cls || '') + '"><b>' + t + '</b>' + items.slice(0, 7).map(x => '<span>' + escHtml(x) + '</span>').join('') + (items.length > 7 ? '<span class="muted">…ещё ' + (items.length - 7) + '</span>' : '') + '</div>';
  const flow = '<div class="hz-flow">' + box('Источники', [...new Set(srcs)].concat(!srcs.length ? ['—'] : [])) + '<span class="hz-fa">→</span>' + (loaders.length ? box('Загрузчики PowerShell', [...new Set(loaders)], 'warn') + '<span class="hz-fa">→</span>' : '') +
    box('DuckDB · база.duckdb', tq.filter(q => ok.get(q.name)).map(q => q.name), 'acc') + '<span class="hz-fa">→</span>' + box('Витрины', ['HTML для руководителя', 'Excel: книга читает готовые CSV'], 'ok') + '<span class="hz-fa">→</span>' + box('Расписание', [HZ.kit.sched ? 'каждый день в ' + HZ.kit.time : 'вручную: «Обновить.bat»']) + '</div>';
  const wait = tq.filter(q => !ok.get(q.name));
  const kit = '<div class="card"><div class="card-h"><h2>Комплект для настоящего DuckDB</h2><span class="small muted">папка с SQL (тот же, что прошёл сверку), скриптами и инструкцией — нужен только duckdb.exe</span></div>' +
    '<ol class="hz-how hz-how-row"><li><b>Скачайте комплект</b> и распакуйте в папку ниже.</li><li><b>Положите duckdb.exe</b> — один файл с duckdb.org (или попросите ИТ).</li><li><b>Запустите «Установить.bat»</b> — проверка, расписание, первое обновление. Дальше — «Обновить.bat» или по расписанию.</li></ol>' + flow +
    '<div class="form-grid hz-form"><label>Папка комплекта на компьютере, где он будет работать<input type="text" data-hz-kit="dir" value="' + escHtml(HZ.kit.dir) + '" placeholder="' + escHtml(o.kitDir) + '"></label>' +
    (tq.some(q => q.mat.some(n => { const s = q.steps.find(x => x.name === n); return s.reader && s.reader.kind === 'wb'; })) ? '<label>Полный путь к этой книге (таблицы-справочники читаются из неё)<input type="text" data-hz-kit="book" value="' + escHtml(HZ.kit.book) + '" placeholder="' + escHtml(o.bookPath) + '"></label>' : '') +
    '<label class="row" style="gap:8px"><input type="checkbox" data-hz-kit="sched"' + (HZ.kit.sched ? ' checked' : '') + '> обновлять по расписанию в <input type="time" data-hz-kit="time" value="' + escHtml(HZ.kit.time) + '" style="width:110px"></label></div>' +
    '<p class="small">В комплекте: <b>' + tq.filter(q => ok.get(q.name)).length + ' из ' + tq.length + '</b> запросов' + (xl ? ' · нужно расширение excel (поставит «Установить.bat»)' : '') + (loaders.length ? ' · загрузчики: ' + loaders.length : '') + (dataRunValid() ? ' · сверка с Power Query при первом запуске' : ' · <span class="muted">сверка появится после «Проверки на данных»</span>') + '</p>' +
    (wait.length ? '<div class="note warn small">Пока не в комплекте: ' + wait.map(q => '«' + escHtml(q.name) + '»').join(', ') + ' — есть непереведённые шаги (шаг 1 → «Осталось перевести») или зависимость от них. Остальное работает уже сейчас.</div>' : '') +
    '<div class="row" style="gap:8px;margin-top:10px"><button class="btn pri" id="hzKitZip">⬇ Скачать комплект (.zip)</button>' + (window.showDirectoryPicker ? '<button class="btn" id="hzKitDir">📁 Записать в папку…</button>' : '') + '<button class="btn" id="hzKitXl"' + (HZ.run && S.book.family === 'excel' ? '' : ' disabled title="нужен прогон в шаге ② (типы столбцов) и книга Excel"') + '>⬇ Excel-витрина (.xlsx)</button></div>' +
    '<p class="small muted">Excel-витрина — копия книги, где итоговые запросы читают готовые таблицы из папки комплекта: «Обновить всё» занимает секунды. Оригинал с Power Query остаётся резервом и местом, где правят запросы.</p></div>';
  return kit + hzMaintHtml();
}
const HZ_ERR = [
  [/duckdb\.exe|not recognized|не является внутренней/i, 'Нет duckdb.exe: положите его в папку комплекта (см. «ПРОЧТИ МЕНЯ.txt»).'],
  [/More than one row returned by a subquery/i, 'Поиск в справочнике нашёл несколько строк по одному ключу (в Power Query была бы ошибка): уберите дубли ключей в справочнике.'],
  [/cannot open|No files found|не удается найти|не найден|does not exist.*file|IO Error/i, 'Файл источника не найден или занят: проверьте путь в запросе Power Query и закрыта ли выгрузка в другой программе.'],
  [/Catalog Error|Referenced column|Binder Error/i, 'Изменилась структура источника или запроса (столбец переименован или удалён): исправьте запрос в Power Query и пересоздайте комплект.'],
  [/Conversion Error|Could not convert/i, 'В данных появилось значение неожиданного типа: проверьте шаг «Изменить тип» и исходные данные.'],
  [/401|Unauthorized|403|Forbidden/i, 'Логин 1С не подошёл: удалите файл журнал\\*.cred — при следующем запуске логин спросят заново.'],
  [/excel|extension/i, 'Нет расширения excel: запустите «Установить.bat» (нужен интернет один раз) или установите расширение из файла.'],
  [/Out of Memory|memory/i, 'Не хватило памяти: закройте лишние программы или обновляйте ночью по расписанию.']
];
const hzErrAdvice = t => (HZ_ERR.find(([re]) => re.test(t || '')) || [, 'Посмотрите текст ошибки в «журнал\\последний.json»; если он про запрос — откройте этот запрос в ① и ②.'])[1];
async function hzOpenLog(){
  const files = await pickFiles(true, true); if (!files.length) return;
  const find = n => files.find(f => f.name.toLowerCase() === n);
  const txt = async f => f ? (await f.text()).replace(/^\uFEFF/, '') : '';
  const M = { runs: [], last: null, check: [], rows: [], manifest: null };
  for (const l of (await txt(find('журнал.csv'))).split(/\r?\n/).slice(1)){ if (!l.trim()) continue; const [t, sec, st, ...err] = l.split(';'); M.runs.push({ t, sec: parseFloat(sec), ok: st === 'ok', err: err.join(';') }); }
  try { M.last = JSON.parse(await txt(find('последний.json')) || 'null'); } catch { /* нет */ }
  for (const l of (await txt(find('сверка.csv'))).split(/\r?\n/).slice(1)){ if (!l.trim()) continue; const c = l.split(';'); M.check.push({ q: c[0], m: c[1], pq: +c[2], dk: c[3] === '' ? null : +c[3], ok: c[4] === 'true' }); }
  for (const l of (await txt(find('строки.csv'))).split(/\r?\n/).slice(1)){ if (!l.trim()) continue; const c = l.split(';'); M.rows.push({ q: c[0], n: +c[1] }); }
  try { M.manifest = JSON.parse(await txt(find('manifest.json')) || 'null'); } catch { /* нет */ }
  if (!M.runs.length && !M.last && !M.manifest) return toast('В папке нет журнала Гиперзума (журнал\\журнал.csv). Выберите папку комплекта.', 'warn');
  HZ.maint = M; renderHyper();
}
function hzMaintHtml(){
  const M = HZ.maint;
  const head = '<div class="card"><div class="card-h"><h2>Обслуживание</h2><span class="small muted">история запусков, время по запросам, ошибки с подсказками, сверка с Power Query</span><span class="sp"></span><button class="btn" id="hzLog">📂 Открыть папку комплекта</button></div>';
  if (!M) return head + '<p class="small muted">Выберите папку комплекта (или папку «журнал» в ней) — журнал читается только здесь, в браузере.</p></div>';
  const runs = M.runs.slice(-60); const last = M.runs[M.runs.length - 1]; const okN = runs.filter(r => r.ok).length; const avg = runs.filter(r => r.ok).reduce((a, r) => a + r.sec, 0) / Math.max(1, okN);
  const mx = Math.max(1, ...runs.map(r => r.sec));
  const chart = runs.length ? '<svg viewBox="0 0 600 120" class="hz-runs">' + runs.map((r, i) => { const w = 600 / runs.length; const h = Math.max(2, r.sec / mx * 100); return '<rect x="' + (i * w + w * 0.15).toFixed(1) + '" y="' + (110 - h).toFixed(1) + '" width="' + (w * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (r.ok ? 'var(--viz-1)' : 'var(--bad)') + '"><title>' + escHtml(r.t + ': ' + r.sec + ' с' + (r.ok ? '' : ' — ошибка')) + '</title></rect>'; }).join('') + '</svg>' : '';
  const steps = M.last && M.last.steps ? M.last.steps : []; const smx = Math.max(1, ...steps.map(s => s.ms));
  const stepBars = steps.length ? '<div class="hbars">' + steps.map(s => '<div class="hb"><span class="hl" title="' + escHtml(s.name) + '">' + escHtml(s.name) + '</span><span class="hz-sb"><i style="width:' + Math.max(1, s.ms / smx * 100).toFixed(1) + '%;background:' + (s.ok ? 'var(--viz-1)' : 'var(--bad)') + '"></i>' + hzMs(s.ms) + '</span></div>').join('') + '</div>' : '<p class="small muted">Нет «последний.json».</p>';
  const err = M.last && M.last.status === 'error' ? '<div class="note bad small"><b>Последний запуск с ошибкой:</b> ' + escHtml(String(M.last.error).slice(0, 400)) + '<br><b>Что сделать:</b> ' + escHtml(hzErrAdvice(M.last.error)) + '</div>' : '';
  const stale = M.manifest ? HZ.plan.queries.filter(q => q.kind === 'table').filter(q => { const m = M.manifest.queries.find(x => x.name === q.name); return !m || m.steps !== q.steps.length; }).map(q => q.name) : [];
  const check = M.check.length ? '<table class="val-table"><tr><th>Запрос</th><th>Показатель</th><th class="num">Power Query</th><th class="num">DuckDB</th><th></th></tr>' + M.check.map(c => '<tr><td>' + escHtml(c.q) + '</td><td>' + escHtml(c.m) + '</td><td class="num">' + fmtN(c.pq) + '</td><td class="num">' + fmtN(c.dk) + '</td><td>' + (c.ok ? '<span class="badge ok">✓</span>' : '<span class="badge bad">≠</span>') + '</td></tr>').join('') + '</table>' : '<p class="small muted">Сверки нет (комплект создан без «Проверки на данных»).</p>';
  return head + '<div class="tiles"><div class="tile"><div class="small muted">Последний запуск</div><div class="hz-tv ' + (last && last.ok ? 'ok' : 'bad') + '">' + (last ? (last.ok ? '✓ ' : '✗ ') + escHtml(last.t.slice(5, 16)) : '—') + '</div><div class="small muted">' + (last ? last.sec + ' с' : '') + '</div></div>' +
    '<div class="tile"><div class="small muted">Успешных</div><div class="hz-tv">' + okN + ' из ' + runs.length + '</div><div class="small muted">последние запуски</div></div><div class="tile"><div class="small muted">Среднее время</div><div class="hz-tv acc">' + (avg ? avg.toFixed(1).replace('.', ',') + ' с' : '—') + '</div><div class="small muted">успешного обновления</div></div>' +
    '<div class="tile"><div class="small muted">Строк в базе</div><div class="hz-tv">' + fmtN(M.rows.reduce((a, r) => a + r.n, 0)) + '</div><div class="small muted">' + M.rows.length + ' таблиц</div></div></div>' + err +
    (stale.length ? '<div class="note warn small">Комплект отстал от книги: изменились запросы ' + stale.map(n => '«' + escHtml(n) + '»').join(', ') + ' — пересоздайте комплект (кнопки выше) и замените файлы sql\\ и scripts\\.</div>' : M.manifest ? '<div class="note ok small">Комплект соответствует запросам открытой книги.</div>' : '') +
    '<div class="viz-2col"><div><h3 class="small muted">Длительность запусков (красные — с ошибкой)</h3>' + chart + '</div><div><h3 class="small muted">Последний запуск по шагам</h3>' + stepBars + '</div></div><h3 class="small muted" style="margin-top:12px">Сверка с Power Query (первый запуск)</h3>' + check + '</div>';
}
async function hzKitFilesNow(){ const P = hzEnsure(); return hzKitFiles(P, hzKitOpts()); }
async function hzKitZip(){
  if (!(await hzLocalSave('комплект'))) return;
  const files = await hzKitFilesNow(); const root = 'Гиперзум — ' + HZ_SAFE(S.book.name.replace(/\.[^.]+$/, ''));
  const entries = []; for (const f of files) entries.push(await zipFinalizeNew(zipNewEntry(root + '/' + f.path, te.encode(f.text), true)));
  download(root + '.zip', zipWrite(entries), 'application/zip'); toast('Комплект: ' + files.length + ' файлов. Распакуйте, положите duckdb.exe и запустите «Установить.bat».', 'ok', 8000);
}
async function hzKitDir(){
  if (!window.showDirectoryPicker) return;
  let dir; try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
  const files = await hzKitFilesNow();
  for (const f of files){ const parts = f.path.split('/'); let d = dir; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true }); const fh = await d.getFileHandle(parts[parts.length - 1], { create: true }); const w = await fh.createWritable(); await w.write(f.text); await w.close(); }
  toast('Комплект записан в папку «' + dir.name + '»: ' + files.length + ' файлов. Журнал и база не тронуты.', 'ok', 8000);
}
async function hzKitXl(){
  if (!HZ.run || S.book.family !== 'excel') return;
  if (!(await hzLocalSave('Excel-витрину'))) return;
  const o = hzKitOpts(); const sec = hzExcelSection(HZ.plan, o.types, o.kitDir);
  if (!sec.count) return toast('Нет итоговых запросов, посчитанных в DuckDB.', 'warn');
  const bytes = await buildBookWithSection(S.book, sec.text, {});
  download(S.book.name.replace(/(\.[^.]+)$/, ' — витрина Гиперзум$1'), bytes);
  toast('Excel-витрина: ' + sec.count + ' итоговых запросов читают CSV из «' + o.kitDir + '\\витрина\\данные».', 'ok', 8000);
}

/* ---------- Ручной перевод и Claude ---------- */
async function hzManual(key){
  const [qn, sn] = key.split('\u0001'); const q = HZ.plan.byName.get(qn); const s = q && q.steps.find(x => x.name === sn); if (!s) return;
  const prev = q.steps[s.idx - 1]; const cur = HZ.over.get(key);
  const tpl = cur ? cur.sql : 'SELECT t.* FROM ' + (prev ? hzQ(prev.cte) : '"Предыдущий шаг"') + ' AS t';
  const r = await modal('<h2>✍ Перевод шага «' + escHtml(sn) + '»</h2><p class="small muted">Запрос «' + escHtml(qn) + '». Причина: ' + escHtml(s.reason) + '. Напишите один SELECT (тело CTE). На шаги ссылайтесь по именам в кавычках, на другие запросы — по именам запросов. Сохраняйте столбец <code>__r</code> (номер строки — порядок Power Query). Помощники: pq_num, pq_date, pq_datetime, pq_text, pq_bool.</p>' +
    '<div class="panes"><div><div class="pane-cap">Power Query (M)</div><pre class="code wrap">' + highlightM(hzStepCode(qn, sn)) + '</pre></div><div><div class="pane-cap">SQL</div><textarea id="hzManSql" class="code" style="width:100%;min-height:180px">' + escHtml(tpl) + '</textarea></div></div>' +
    '<p class="small muted">После сохранения шаг станет «переведён» — проверьте его в ② на данных.</p>', [['cancel', 'Отмена']].concat(cur ? [['del', 'Убрать перевод']] : []).concat([['ok', 'Сохранить', 'pri']]), { wide: true });
  if (r === 'del'){ HZ.over.delete(key); renderHyper(); return; }
  if (r !== 'ok') return;
  const sql = $('#hzManSql').value.trim().replace(/;\s*$/, ''); if (!/^(select|with|from|pivot|unpivot)\b/i.test(sql)) return toast('Нужен один SELECT.', 'warn');
  HZ.over.set(key, { sql, hash: s.hash }); renderHyper(); toast('Перевод сохранён — проверьте в ② «DuckDB в браузере».', 'ok');
}
function hzClaudeText(){
  ensureAnon(); const P = HZ.plan;
  const items = P.queries.flatMap(q => q.manualSteps.map(s => '- запрос ' + anonQueryName(q.name) + ', шаг ' + sanitizeName(s.name) + ' (' + (s.fn || 'выражение') + '): ' + sanitizeName(s.reason)));
  return 'Ты переводишь шаги Power Query (M) в SQL DuckDB 1.4 для «Гиперзума» (инструмент Мастер PQ). Код обезличен: значения заменены метками ⟦КАТЕГОРИЯ_N⟧ — оставляй их как есть.\n\n' +
    'Правила:\n1. Каждый шаг — один SELECT (тело CTE). На предыдущие шаги ссылайся по имени в двойных кавычках ("Имя шага"), на другие запросы — по имени запроса в кавычках.\n' +
    '2. Сохраняй служебный столбец __r (номер строки, порядок Power Query): он должен быть в выходе; при группировке — min(__r), при сортировке — row_number() OVER (ORDER BY …, __r).\n' +
    '3. Помощники: pq_num(x), pq_date(x), pq_datetime(x), pq_text(x), pq_bool(x) — преобразования как в Power Query (культура ru-RU); pq_num_en, pq_date_en — для en-US.\n' +
    '4. Равенство — IS NOT DISTINCT FROM (в M null = null истинно). Без расширений DuckDB.\n5. Если шаг перевести нельзя — объясни в note и оставь sql пустым.\n\n' +
    'Формат ответа — один блок ```json:\n{"hyperzoom": [{"query": "<имя запроса>", "step": "<имя шага>", "sql": "SELECT …", "note": "…"}]}\n\n' +
    'Шаги для перевода:\n' + items.join('\n') + '\n\nКод (Section1.m, обезличен):\n```m\n' + S.anon.out + '\n```\n';
}
async function hzClaude(){
  const t = hzClaudeText();
  if (!(await gate(t, 'Гиперзум: задача для Claude'))) return;
  audit('буфер', 'гиперзум-задача.txt', t);
  if (await copyText(t)) toast('Задача для Claude скопирована (обезличено, сканер пройден). Вставьте ответ кнопкой «📥 Вставить ответ Claude».', 'ok', 8000);
  else download('гиперзум-задача.txt', t, 'text/plain');
}
async function hzClaudeIn(){
  const r = await modal('<h2>📥 Ответ Claude</h2><p class="small muted">Вставьте ответ целиком — Мастер найдёт блок JSON и вернёт настоящие имена вместо меток.</p><textarea id="hzAns" class="code" style="width:100%;min-height:220px"></textarea>', [['cancel', 'Отмена'], ['ok', 'Применить', 'pri']], { wide: true });
  if (r !== 'ok') return;
  const raw = $('#hzAns').value; const rs = restoreTokens(raw, S.dict);
  const m = /```json\s*([\s\S]*?)```/.exec(rs.out) || /(\{[\s\S]*"hyperzoom"[\s\S]*\})/.exec(rs.out);
  let j; try { j = JSON.parse(m ? m[1] : rs.out); } catch (e){ return toast('Не найден JSON с полем hyperzoom: ' + e.message, 'bad'); }
  let n = 0, skip = [];
  for (const x of (j.hyperzoom || [])){ const q = HZ.plan.byName.get(x.query); const s = q && q.steps.find(y => y.name === x.step); if (!s || !x.sql){ skip.push((x.query || '?') + ' › ' + (x.step || '?') + (x.note ? ': ' + x.note : '')); continue; } HZ.over.set(q.name + '\u0001' + s.name, { sql: String(x.sql).trim().replace(/;\s*$/, ''), hash: s.hash }); n++; }
  if (rs.unknown.length) toast('В ответе ' + rs.unknown.length + ' неизвестных меток — проверьте SQL.', 'warn');
  renderHyper(); toast('Переводов принято: ' + n + (skip.length ? '; без перевода: ' + skip.length : '') + '. Проверьте в ② на данных.', n ? 'ok' : 'warn', 8000);
}

/* ---------- События ---------- */
function hzWire(){
  const root = $('#view-hyper');
  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-hz-tab],[data-hz-q],[data-hz-man],[data-hz-scale],[data-hz-go],[data-hz-race],[data-hz-sqlall],[data-hz-scroll],button[id^="hz"]'); if (!t) return;
    if (t.dataset.hzTab){ HZ.tab = t.dataset.hzTab; renderHyper(); $('#hzNav').scrollIntoView({ block: 'nearest' }); return; }
    if (t.dataset.hzRace){ HZ.race = t.dataset.hzRace; renderHyper(); return; }
    if (t.dataset.hzScroll){ e.preventDefault(); const el = document.getElementById(t.dataset.hzScroll); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (t.dataset.hzSqlall){ const q = HZ.plan.byName.get(t.dataset.hzSqlall); if (!q) return; const sql = hzQuerySql(HZ.plan, q); const r = await modal('<h2>SQL запроса «' + escHtml(q.name) + '»</h2><p class="small muted">Каждый шаг Power Query — блок с тем же именем; комментарий над ним — какая команда во что превратилась.</p><pre class="code">' + hzHl(sql) + '</pre>', [['copy', 'Копировать'], ['ok', 'Закрыть', 'pri']], { wide: true }); if (r === 'copy' && await copyText(sql)) toast('SQL скопирован', 'ok'); return; }
    if (t.dataset.hzMan){ e.preventDefault(); return hzManual(t.dataset.hzMan); }
    if (t.dataset.hzScale) return hzScale(+t.dataset.hzScale);
    if (t.dataset.hzGo){ e.preventDefault(); return showView(t.dataset.hzGo); }
    if (t.dataset.hzQ != null && !t.id){ e.preventDefault();
      if (HZ.selQ === t.dataset.hzQ && !t.dataset.hzS && HZ.tab === 'plan'){ HZ.selQ = null; HZ.selStep = null; } else { HZ.selQ = t.dataset.hzQ; HZ.selStep = t.dataset.hzS || null; }
      renderHyper(); const d = $('.hz-inline'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    switch (t.id){
      case 'hzRunBtn': return hzRun();
      case 'hzVz': HZ.vz = !HZ.vz; return renderHyper();
      case 'hzVzDl': if (!HZ.run || !DUCK.c) return; if (!(await hzLocalSave('витрину'))) return; download('Витрина — ' + HZ_SAFE(S.book.name.replace(/\.[^.]+$/, '')) + '.html', hzVitrinaHtml(hzVitrinaData(), S.book.name), 'text/html'); return;
      case 'hzClaude': return hzClaude();
      case 'hzClaudeIn': return hzClaudeIn();
      case 'hzKitZip': return hzKitZip();
      case 'hzKitDir': return hzKitDir();
      case 'hzKitXl': return hzKitXl();
      case 'hzLog': return hzOpenLog();
    }
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.hzCalc){ HZ.calc[t.dataset.hzCalc] = Math.max(0, +t.value || 0); renderHyper(); }
    if (t.dataset.hzKit){ HZ.kit[t.dataset.hzKit] = t.type === 'checkbox' ? t.checked : t.value.trim(); renderHyper(); }
  });
}
registerView('hyper', { render: () => renderHyper(), onShow: () => renderHyper() });
onState(reason => { if (reason === 'book'){ HZ.plan = null; HZ.planKey = ''; HZ.run = null; HZ.over = new Map(); HZ.selQ = null; HZ.selStep = null; HZ.maint = null; HZ.scale = null; HZ.vz = false; HZ.kit.book = ''; HZ.kit.dir = ''; } });
hzWire();
