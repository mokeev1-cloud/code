/* =====================================================================
   views/data.js — «Проверка на данных»: запросы книги вычисляются на её таблицах и прикреплённых
   выгрузках (только в этом браузере). Строки и время по шагам, контрольные суммы, соединения
   (дубли ключей, строки без пары, разные типы ключей), профиль результата и проверка исправлений
   оптимизатора: результат до и после совпадает или нет.
   Результаты — DATA.run / DATA.verify (app/data.js); в пакет для ИИ — только числа (dataChecksForAi).
   ===================================================================== */
const DV = { sel: null, busy: false, progress: '' };
const pct = (a, b) => b ? (a / b * 100).toFixed(a / b < 0.01 ? 2 : 1).replace('.', ',') + '%' : '—';
const fmtN = n => n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
/** Относительное изменение без самих сумм: «−200%», «+12,5%» */
const relChange = (a, b) => a === 0 ? (b === 0 ? '0%' : 'было 0') : ((b - a) / Math.abs(a) * 100 > 0 ? '+' : '−') + Math.abs((b - a) / Math.abs(a) * 100).toFixed(1).replace('.', ',') + '%';
const tick = () => new Promise(r => setTimeout(r, 0));
/** Порядок вычисления: сначала запросы, на которые ссылаются другие (их результат переиспользуется) */
function dataOrder(members){
  const by = new Map(members.map(m => [m.name, m])); const out = [], seen = new Set();
  const visit = (m, stack) => { if (seen.has(m.name) || stack.has(m.name)) return; stack.add(m.name); for (const r of m.refs) if (by.has(r)) visit(by.get(r), stack); seen.add(m.name); out.push(m); };
  for (const m of members) visit(m, new Set());
  return out;
}
/** Профиль таблицы: по столбцу — типы, пустые, ошибки, различных, числа-текстом, пробелы по краям */
function tableProfile(t){
  const n = Math.min(t.rows.length, 200000);
  return t.cols.map((c, i) => {
    const types = new Map(); let nulls = 0, errs = 0, txtNum = 0, spaces = 0, sum = 0, nums = 0; const dist = new Set();
    for (let r = 0; r < n; r++){ let v; try { v = force(t.rows[r][i]); } catch { errs++; continue; }
      if (v === null){ nulls++; continue; } const tn = mTypeName(v); types.set(tn, (types.get(tn) || 0) + 1);
      if (dist.size < 100001){ const k = mHashKey(v); if (k !== null) dist.add(k); }
      if (typeof v === 'number'){ nums++; sum += v; }
      else if (typeof v === 'string'){ if (/^\s*-?[\d  ]+([.,]\d+)?\s*$/.test(v)) txtNum++; if (v !== v.trim()) spaces++; } }
    return { col: c, types: [...types].sort((a, b) => b[1] - a[1]).map(([k, x]) => k + (types.size > 1 ? ' ' + x : '')).join(', ') || 'null', nulls, errs, distinct: dist.size > 100000 ? '>100000' : dist.size, txtNum, spaces, sum: nums ? sum : null, nums, rows: n };
  });
}
/** Сумма числового столбца в каждом шаге-таблице: где итог изменился */
function controlSums(steps, finalTab){
  if (!(finalTab instanceof MTab)) return [];
  const prof = tableProfile(finalTab); const out = [];
  for (const p of prof){ if (!p.nums || p.nums < (p.rows - p.nulls - p.errs) * 0.8) continue;
    const series = []; for (const s of steps){ const v = s.value; if (!(v instanceof MTab)) continue; const ci = v.cols.indexOf(p.col); if (ci < 0) continue; let sum = 0, nn = 0, filled = 0; for (const r of v.rows){ try { const x = force(r[ci]); if (x !== null) filled++; if (typeof x === 'number'){ sum += x; nn++; } } catch { filled++; } }
      if (filled && nn >= filled * 0.8) series.push({ step: s.name, sum, rows: v.rows.length }); }   // шаги, где столбец ещё текст, не сравниваются
    if (series.length < 2) continue;
    const changes = []; for (let i = 1; i < series.length; i++){ const a = series[i - 1].sum, b = series[i].sum; if (Math.abs(a - b) > Math.max(1e-6, Math.abs(a) * 1e-9)) changes.push({ step: series[i].step, before: a, after: b }); }
    out.push({ col: p.col, first: series[0], last: series[series.length - 1], changes });
  }
  return out;
}
/** Одна запуск запроса: шаги, соединения, профиль. queries — уже вычисленные результаты других запросов */
function dataRunQuery(section, name, queries){
  const joins = []; let cur = '';
  const ov = typeof sbOverrides === 'function' ? sbOverrides(name) : { steps: new Map(), queries: new Map() };
  const qs = new Map([...(queries || new Map()), ...ov.queries]);
  M_TRACE = { join: j => joins.push(Object.assign({ step: cur }, j)) };
  const t0 = performance.now(); let res;
  try { res = mRunSteps(section, name, { steps: ov.steps, queries: qs, onStep: s => { cur = s; } }); }
  catch (e){ res = [{ name: '(разбор)', error: toMErr(e), ms: 0, final: true }]; }
  finally { M_TRACE = null; }
  const ms = performance.now() - t0;
  const fin = res[res.length - 1]; const value = fin && !fin.error ? fin.value : null;
  const err = res.find(r => r.error);   // первый шаг с ошибкой — источник ошибки (следующие наследуют её)
  return { name, ms, value, steps: res.map(r => ({ name: r.name, value: r.value, rows: r.value instanceof MTab ? r.value.rows.length : null, cols: r.value instanceof MTab ? r.value.cols.length : null, ms: r.ms, error: r.error ? { reason: r.error.reason, message: r.error.message, need: r.error.need || null } : null, overridden: r.overridden })),
    error: fin && fin.error ? { reason: fin.error.reason, message: fin.error.message, need: fin.error.need || null, step: err ? err.name : '' } : null, joins };
}
/** Сравнение результатов до и после исправления: полностью / с другим порядком строк / отличается */
function tableCompare(a, b){
  const lit = x => { try { return mLit(x); } catch (e){ return '⚠' + (e.reason || 'Error'); } };
  if (!(a instanceof MTab) || !(b instanceof MTab)) return lit(a) === lit(b) ? { same: true, exact: true } : { same: false, note: 'значение изменилось' };
  const ca = a.cols.slice().sort().join('\u0001'), cb = b.cols.slice().sort().join('\u0001');
  if (ca !== cb) return { same: false, note: 'другие столбцы: было ' + a.cols.length + ', стало ' + b.cols.length };
  const ib = a.cols.map(c => b.cols.indexOf(c));
  const keyA = r => r.map(lit).join('\u0001'), keyB = r => ib.map(i => lit(r[i])).join('\u0001');
  const exact = a.cols.join('\u0001') === b.cols.join('\u0001') && a.rows.length === b.rows.length && a.rows.every((r, i) => keyA(r) === keyB(b.rows[i]));
  if (exact) return { same: true, exact: true };
  const cnt = new Map(); for (const r of a.rows){ const k = keyA(r); cnt.set(k, (cnt.get(k) || 0) + 1); }
  let extra = 0; for (const r of b.rows){ const k = keyB(r); const c = cnt.get(k); if (c) cnt.set(k, c - 1); else extra++; }
  let lost = 0; for (const c of cnt.values()) lost += c;
  if (!extra && !lost) return { same: true, exact: false, note: 'те же строки, другой порядок' + (ca === cb && a.cols.join() !== b.cols.join() ? ' и порядок столбцов' : '') };
  return { same: false, note: 'строк было ' + fmtN(a.rows.length) + ', стало ' + fmtN(b.rows.length) + ' · пропало ' + fmtN(lost) + ', появилось ' + fmtN(extra) };
}
/** Проверка исправлений оптимизатора на данных: запрос до и после правки */
async function dataVerifyFixes(run){
  const out = new Map(); const base = new Map(run.queries.map(q => [q.name, q]));
  const fs = (S.opt ? S.opt.findings : []).filter(f => f.fix && base.has(f.query) && !base.get(f.query).error).slice(0, 40);
  for (const f of fs){
    const opt = f.options && f.options[0]; const variants = opt ? opt.values.map(([v, l]) => ({ o: { [opt.key]: v }, label: l })) : [{ o: {}, label: '' }];
    const res = [];
    for (const vnt of variants){
      DV.progress = 'Проверка исправлений: ' + f.title.slice(0, 50) + '…'; renderDataProgress(); await tick();
      let text; try { text = f.fix(S.work, vnt.o); } catch (e){ res.push({ label: vnt.label, same: false, note: 'исправление не применилось: ' + e.message }); continue; }
      // результаты запросов, не затронутых правкой, переиспользуются
      const before = parseSection(S.work).members, after = parseSection(text).members;
      const exprOf = (t, ms) => new Map(ms.map(m => [m.name, t.slice(m.exprStart, m.exprEnd)]));
      const eb = exprOf(S.work, before), ea = exprOf(text, after);
      const changed = new Set([...ea].filter(([n, e]) => eb.get(n) !== e).map(([n]) => n));
      const touched = n => { if (changed.has(n)) return true; const m = S.A.byName.get(n); return !!m && [...m.refs].some(r => r !== n && changed.has(r)); };
      const reuse = new Map(); for (const [n, q] of base) if (n !== f.query && q.value != null && !touched(n)) reuse.set(n, q.value);
      const r2 = dataRunQuery(text, f.query, reuse);
      if (r2.error) res.push({ label: vnt.label, same: false, note: 'после правки ошибка: ' + r2.error.message });
      else res.push(Object.assign({ label: vnt.label }, tableCompare(base.get(f.query).value, r2.value)));
    }
    out.set(f.id, { title: f.title, query: f.query, rule: f.rule, safety: f.safety, results: res, same: res.every(r => r.same) });
  }
  return out;
}
/** Находки на данных — то, что видно только по реальным значениям */
function dataFindings(run){
  const F = []; const add = (sev, q, title, text) => F.push({ sev, q, title, text });
  for (const q of run.queries){
    if (q.error && !q.error.need) add('err', q.name, 'Ошибка при вычислении', (q.error.step ? 'шаг «' + q.error.step + '»: ' : '') + q.error.message);
    for (const j of q.joins){
      const where = 'шаг «' + j.step + '»: ' + j.keysA.join(', ') + ' ↔ ' + j.keysB.join(', ');
      if (j.dupKeys) add('warn', q.name, 'Дубли ключей в присоединяемой таблице', where + ' — ' + fmtN(j.dupKeys) + ' ключей встречаются несколько раз (' + fmtN(j.dupRows) + ' строк). Строки слияния размножаются, суммы задваиваются. Уберите дубли (Table.Distinct по ключу) или проверьте справочник.');
      if (j.typeA && j.typeB && j.typeA !== j.typeB) add('warn', q.name, 'Разные типы ключей', where + ' — слева ' + j.typeA + ', справа ' + j.typeB + ': значения не совпадут. Приведите ключи к одному типу до слияния.');
      if (j.miss && j.kind !== 4) add(j.miss / j.left > 0.05 ? 'warn' : 'info', q.name, 'Строки без пары при слиянии', where + ' — ' + fmtN(j.miss) + ' из ' + fmtN(j.left) + ' строк (' + pct(j.miss, j.left) + ') не нашли пары' + (j.kind === 0 ? ' и выпали из результата (внутреннее соединение).' : ': присоединённые столбцы у них пустые. Проверьте справочник или маппинг.'));
    }
    let prev = null;
    for (const s of q.steps){ if (s.rows == null) continue; if (prev && prev.rows >= 100 && s.rows > prev.rows * 1.5) add('info', q.name, 'Резкий рост строк', 'шаг «' + s.name + '»: ' + fmtN(prev.rows) + ' → ' + fmtN(s.rows) + ' строк (×' + (s.rows / prev.rows).toFixed(1).replace('.', ',') + ').'); prev = s; }
    for (const p of q.profile || []){
      if (p.errs) add('warn', q.name, 'Ошибки в ячейках результата', 'столбец «' + p.col + '»: ' + fmtN(p.errs) + ' ошибок из ' + fmtN(p.rows) + ' строк. В Excel такие ячейки загружаются пустыми или прерывают обновление.');
      if (p.txtNum && p.nums) add('info', q.name, 'Числа и числа-текстом вперемешку', 'столбец «' + p.col + '»: ' + fmtN(p.txtNum) + ' значений — текст, похожий на число. Суммы и слияния по такому столбцу неверны; задайте тип столбца.');
      if (p.spaces) add('info', q.name, 'Пробелы по краям', 'столбец «' + p.col + '»: ' + fmtN(p.spaces) + ' значений с пробелами в начале или конце. Если это ключ слияния или маппинга — совпадений не будет; добавьте Text.Trim.');
    }
    for (const c of q.sums || []) if (c.changes.length) add('info', q.name, 'Контрольная сумма изменилась', '«' + c.col + '»: ' + fmtN(c.first.sum) + ' на шаге «' + c.first.step + '» → ' + fmtN(c.last.sum) + ' в результате (' + relChange(c.first.sum, c.last.sum) + '). Где менялся: ' + c.changes.slice(0, 4).map(x => '«' + x.step + '» ' + (x.after - x.before > 0 ? '+' : '') + fmtN(x.after - x.before)).join(', ') + (c.changes.length > 4 ? '…' : '') + '. Убедитесь, что фильтры и слияния теряют или добавляют именно то, что нужно.');
  }
  const order = { err: 0, warn: 1, info: 2 }; return F.sort((a, b) => order[a.sev] - order[b.sev]);
}
async function dataRunAll(){
  if (!S.A || DV.busy) return;
  DV.busy = true; DATA.run = null; DATA.verify = null; renderData();
  try {
    DV.progress = 'Чтение таблиц книги…'; renderDataProgress(); await tick();
    await dataPrepare();
    const ms = dataOrder(S.A.members.filter(m => !m.isFn && !m.isParam));
    const run = { forWork: S.work, queries: [] }; const done = new Map();
    for (const m of ms){
      DV.progress = 'Вычисление «' + m.name + '» (' + (run.queries.length + 1) + ' из ' + ms.length + ')…'; renderDataProgress(); await tick();
      const q = dataRunQuery(S.work, m.name, done);
      if (q.value instanceof MTab){ q.profile = tableProfile(q.value); q.sums = controlSums(q.steps, q.value); q.sample = { cols: q.value.cols, rows: q.value.rows.slice(0, 100).map(r => r.map(x => { try { const v = force(x); return v === null || typeof v === 'string' || typeof v === 'number' || v instanceof MDate ? v : mToText(v); } catch { return '⚠'; } })) }; }
      if (q.value != null) done.set(m.name, q.value);
      run.queries.push(q);
    }
    // суммы по ключам (коды счетов, статей) бессмысленны: столбцы слияний и поиска Т{[Ключ = [Столбец]]} не сравниваются
    const keyCols = new Set(); for (const q of run.queries) for (const j of q.joins) j.keysA.concat(j.keysB).forEach(k => keyCols.add(k));
    for (const m of S.work.matchAll(/\{\s*\[\s*([^=\]]+?)\s*=\s*\[([^\]]+)\]/g)){ keyCols.add(m[1].replace(/^#"|"$/g, '')); keyCols.add(m[2].replace(/^#"|"$/g, '')); }
    for (const q of run.queries) if (q.sums) q.sums = q.sums.filter(c => !keyCols.has(c.col));
    run.findings = dataFindings(run);
    DATA.run = run;
    DATA.verify = { forWork: S.work, items: await dataVerifyFixes(run) };
    DV.sel = DV.sel && run.queries.some(q => q.name === DV.sel) ? DV.sel : (run.queries.find(q => q.error) || run.queries[0] || {}).name;
  } catch (e){ console.error(e); toast('Проверка на данных: ' + e.message, 'bad'); }
  finally { DV.busy = false; DV.progress = ''; emitState('data'); }
}
function renderDataProgress(){ const b = $('#dataRun'); if (b){ b.disabled = DV.busy; b.textContent = DV.busy ? '⏳ ' + (DV.progress || 'Вычисление…') : '▶ Проверить на данных'; } }
const dataRunValid = () => DATA.run && DATA.run.forWork === S.work;
function dataNeeds(){
  const out = new Map(); if (!dataRunValid()) return out;
  for (const q of DATA.run.queries) for (const s of q.steps) if (s.error && s.error.need){ const k = s.error.need.kind + '|' + s.error.need.path; if (!out.has(k)) out.set(k, Object.assign({ queries: new Set() }, s.error.need)); out.get(k).queries.add(q.name); }
  return out;
}
function pickFiles(multiple, dir){ return new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = !!multiple; if (dir) inp.webkitdirectory = true; inp.onchange = () => res([...inp.files]); inp.click(); }); }
function renderData(){
  if (!S.book) return;
  renderDataProgress();
  // источники
  const needs = dataNeeds(); const wb = DATA.wb;
  const files = [...DATA.files].map(([k, f]) => '<div class="ds-item">📄 <b>' + escHtml(f.name) + '</b> <span class="small muted">' + fmtN(Math.round(f.bytes.length / 1024)) + ' КБ' + (k.startsWith('name:') ? '' : ' · для «' + escHtml(k) + '»') + (f.error ? ' · ⚠ ' + escHtml(f.error) : '') + '</span> <button class="link" data-detach="' + escHtml(k) + '">убрать</button></div>').join('') +
    [...DATA.folders].map(([k, fs]) => '<div class="ds-item">📁 <b>' + escHtml(k) + '</b> <span class="small muted">' + fs.length + ' файл(ов)</span> <button class="link" data-detachf="' + escHtml(k) + '">убрать</button></div>').join('');
  $('#dataSources').innerHTML = '<div class="card-h"><h2>Источники</h2><span class="sp"></span><button class="btn sm" id="dataAttach">Прикрепить файлы…</button></div>' +
    '<h3>Таблицы книги</h3>' + (DATA.wbError ? '<div class="small muted">' + escHtml(DATA.wbError) + '</div>' : wb ? (wb.tables.concat(wb.names).map(t => '<div class="ds-item">▦ <b>' + escHtml(t.name) + '</b> <span class="small muted">' + fmtN(t.rows.length) + ' × ' + t.cols.length + '</span></div>').join('') || '<div class="small muted">Таблиц и именованных диапазонов нет.</div>') + (wb.truncated ? '<div class="small muted">Прочитаны не все строки — см. «Строк на лист».</div>' : '') : '<div class="small muted">' + (S.book.family === 'excel' ? 'Прочитаются при проверке.' : 'Только для книг Excel.') + '</div>') +
    '<h3>Прикреплённые выгрузки</h3>' + (files || '<div class="small muted">Нет. Прикрепите CSV, XLSX, JSON, которые читают запросы (File.Contents, Folder.Files), — или перетащите их сюда.</div>') +
    (needs.size ? '<h3>Нужны для запросов</h3>' + [...needs.values()].map(n => '<div class="ds-item need">' + (n.kind === 'folder' ? '📁 папка' : n.kind === 'workbook' ? '▦ таблицы книги' : '📄 файл') + ' <b>' + escHtml(n.path || '') + '</b> <span class="small muted">' + [...n.queries].map(escHtml).join(', ') + '</span>' + (n.kind === 'workbook' ? '' : ' <button class="btn sm pri" data-need="' + escHtml(n.kind) + '" data-path="' + escHtml(n.path) + '">Прикрепить…</button>') + '</div>').join('') : '') +
    '<p class="small muted">Базы данных и веб-источники недоступны (сети нет): подмените такой шаг выгрузкой в «Песочнице» — подмена действует и здесь.</p>';
  $('#dataAttach').onclick = async () => { const fs = await pickFiles(true); if (fs.length){ await attachFiles(fs, '', ''); toast('Прикреплено файлов: ' + fs.length, 'ok'); } };
  $$('[data-detach]').forEach(b => b.onclick = () => detachData(b.dataset.detach, false));
  $$('[data-detachf]').forEach(b => b.onclick = () => detachData(b.dataset.detachf, true));
  $$('[data-need]').forEach(b => b.onclick = async () => { const folder = b.dataset.need === 'folder'; const fs = await pickFiles(folder, false); if (!fs.length) return; await attachFiles(fs, b.dataset.path, folder ? 'folder' : 'file'); toast('Прикреплено. Запустите проверку снова.', 'ok'); });
  // итоги
  const run = dataRunValid() ? DATA.run : null; const ver = DATA.verify && DATA.verify.forWork === S.work ? [...DATA.verify.items.values()] : [];
  $('#dataSummary').innerHTML = '<div class="card-h"><h2>Итог</h2></div>' + (!run ? '<div class="small muted">' + (DV.busy ? escHtml(DV.progress) : 'Нажмите «Проверить на данных»: каждый запрос вычислится на таблицах книги и прикреплённых файлах, а исправления оптимизатора — до и после правки.') + '</div>' :
    '<div class="kv"><span>Запросов вычислено</span><b>' + run.queries.filter(q => !q.error).length + ' из ' + run.queries.length + '</b><span>Нужно источников</span><b>' + needs.size + '</b><span>Находок</span><b>' + run.findings.length + '</b><span>Исправлений проверено</span><b>' + ver.length + (ver.length ? ' · совпадают ' + ver.filter(v => v.same).length : '') + '</b><span>Время</span><b>' + (run.queries.reduce((s, q) => s + q.ms, 0) / 1000).toFixed(1).replace('.', ',') + ' с</b></div>' +
    '<p class="small muted">Время — в браузере, не в Excel: важны соотношения шагов, а не секунды. Реальное время даёт диагностика Power Query.</p>');
  // находки и исправления
  $('#dataFindings').innerHTML = !run ? '<div class="card-h"><h2>Находки на данных</h2></div><div class="small muted">Появятся после проверки.</div>' :
    '<div class="card-h"><h2>Находки на данных</h2><span class="sp"></span><span class="small muted">видно только по реальным значениям</span></div>' + (run.findings.length ? '<div class="book-issues">' + run.findings.slice(0, 80).map(f => '<div class="bi ' + f.sev + '"><div class="oh"><span class="sev ' + f.sev + '">' + SEV_LABEL[f.sev] + '</span><span class="ot">' + escHtml(f.title) + '</span> <button class="link" data-dq="' + escHtml(f.q) + '">' + escHtml(f.q) + '</button></div><div class="why">' + escHtml(f.text) + '</div></div>').join('') + '</div>' : '<div class="note ok small">Ошибок, дублей ключей, потерь при слияниях и смешанных типов не найдено.</div>') +
    (ver.length ? '<h3>Исправления оптимизатора на данных</h3><table class="t small"><tr><th>Совет</th><th>Запрос</th><th>Результат до и после</th></tr>' + ver.map(v => '<tr><td>' + escHtml(v.title) + '</td><td>' + escHtml(v.query) + '</td><td>' + v.results.map(r => '<div>' + (r.same ? '<span class="pqx-rec ok">✓ совпадает</span>' : '<span class="pqx-rec warn">✖ отличается</span>') + (r.label ? ' <b>' + escHtml(r.label) + '</b>' : '') + (r.note ? ' <span class="muted">' + escHtml(r.note) + '</span>' : '') + '</div>').join('') + '</td></tr>').join('') + '</table>' : '');
  // запросы
  $('#dataQueries').innerHTML = !run ? '' : '<div class="card-h"><h2>Запросы</h2></div><table class="t small"><tr><th>Запрос</th><th>Строк</th><th>Столбцов</th><th>Время</th><th>Состояние</th></tr>' + run.queries.map(q => { const f = q.steps[q.steps.length - 1];
    return '<tr class="click' + (q.name === DV.sel ? ' on' : '') + '" data-dsel="' + escHtml(q.name) + '"><td>' + escHtml(q.name) + '</td><td class="num">' + fmtN(f && f.rows) + '</td><td class="num">' + fmtN(f && f.cols) + '</td><td class="num">' + (q.ms / 1000).toFixed(2).replace('.', ',') + ' с</td><td>' + (q.error ? (q.error.need ? '🔌 нужен источник' : '<span style="color:var(--bad)">✖ ' + escHtml(q.error.reason) + '</span>') : '✔') + '</td></tr>'; }).join('') + '</table>';
  $$('[data-dsel]').forEach(x => x.onclick = () => { DV.sel = x.dataset.dsel; renderData(); });
  $$('[data-dq]').forEach(x => x.onclick = () => { DV.sel = x.dataset.dq; renderData(); $('#dataDetail').scrollIntoView({ block: 'start' }); });
  // подробности по запросу
  const q = run && run.queries.find(x => x.name === DV.sel);
  $('#dataDetail').classList.toggle('hidden', !q);
  if (!q) return;
  const maxR = Math.max(1, ...q.steps.map(s => s.rows || 0));
  $('#dataDetail').innerHTML = '<div class="card-h"><h2>' + escHtml(q.name) + '</h2><span class="sp"></span><button class="btn sm" id="dataToSb">Открыть в песочнице</button></div>' +
    '<h3>Шаги</h3><table class="t small"><tr><th>Шаг</th><th>Строк</th><th></th><th>Время</th></tr>' + q.steps.map(s => '<tr><td>' + escHtml(s.name) + (s.overridden ? ' 📎' : '') + '</td><td class="num">' + (s.error ? '<span style="color:var(--bad)" title="' + escHtml(s.error.message) + '">' + (s.error.need ? '🔌' : '✖') + '</span>' : fmtN(s.rows)) + '</td><td style="width:40%"><div class="bar"><i style="width:' + ((s.rows || 0) / maxR * 100) + '%"></i></div></td><td class="num">' + (s.ms || 0).toFixed(0) + ' мс</td></tr>').join('') + '</table>' +
    (q.sums && q.sums.length ? '<h3>Контрольные суммы</h3><table class="t small"><tr><th>Столбец</th><th>Первый шаг</th><th>Результат</th><th>Где менялась</th></tr>' + q.sums.map(c => '<tr><td>' + escHtml(c.col) + '</td><td class="num">' + fmtN(c.first.sum) + '</td><td class="num">' + fmtN(c.last.sum) + '</td><td>' + (c.changes.length ? c.changes.slice(0, 6).map(x => escHtml(x.step) + ' (' + relChange(x.before, x.after) + ', ' + (x.after - x.before > 0 ? '+' : '') + fmtN(x.after - x.before) + ')').join(', ') : '<span class="muted">не менялась</span>') + '</td></tr>').join('') + '</table>' : '') +
    (q.profile ? '<h3>Профиль результата</h3><table class="t small"><tr><th>Столбец</th><th>Типы</th><th>Пустых</th><th>Ошибок</th><th>Различных</th><th>Числа-текстом</th><th>Пробелы</th></tr>' + q.profile.map(p => '<tr><td>' + escHtml(p.col) + '</td><td>' + escHtml(p.types) + '</td><td class="num">' + pct(p.nulls, p.rows) + '</td><td class="num">' + (p.errs ? '<b style="color:var(--bad)">' + fmtN(p.errs) + '</b>' : '0') + '</td><td class="num">' + fmtN(p.distinct) + '</td><td class="num">' + fmtN(p.txtNum) + '</td><td class="num">' + fmtN(p.spaces) + '</td></tr>').join('') + '</table>' : '') +
    (q.sample ? '<h3>Первые строки результата</h3><div class="table-wrap" style="max-height:40vh"><table class="t small"><tr>' + q.sample.cols.map(c => '<th>' + escHtml(c) + '</th>').join('') + '</tr>' + q.sample.rows.slice(0, 30).map(r => '<tr>' + r.map(v => '<td>' + (v === null ? '<span class="muted">null</span>' : escHtml(v === '⚠' || v === null ? String(v) : mToText(v))) + '</td>').join('') + '</tr>').join('') + '</table></div>' : '');
  $('#dataToSb').onclick = () => { showView('sandbox'); sbRunQuery(q.name); };
}
/** Числа проверки для пакета ИИ: без значений, имена — через словарь обезличивания */
function dataChecksForAi(){
  if (!dataRunValid()) return null;
  const ver = DATA.verify && DATA.verify.forWork === S.work ? [...DATA.verify.items.values()] : [];
  return { note: 'Проверка на данных пользователя (выполнена локально). Только числа: значений данных здесь нет.',
    queries: DATA.run.queries.map(q => ({ query: anonQueryName(q.name), error: q.error ? (q.error.need ? 'нужен источник ' + q.error.need.kind : q.error.reason) : null,
      steps: q.steps.map(s => ({ step: sanitizeName(s.name), rows: s.rows, ms: Math.round(s.ms || 0), error: s.error ? s.error.reason : undefined })),
      joins: q.joins.map(j => ({ step: sanitizeName(j.step), keys: j.keysA.map(anonColName), left: j.left, right: j.right, unmatchedLeft: j.miss, duplicateKeysRight: j.dupKeys, keyTypes: j.typeA + ' / ' + j.typeB })),
      columns: (q.profile || []).map(p => ({ name: anonColName(p.col), types: p.types, nullShare: p.rows ? +(p.nulls / p.rows).toFixed(4) : 0, errors: p.errs, textNumbers: p.txtNum, edgeSpaces: p.spaces })) })),
    fixesOnData: ver.map(v => ({ rule: v.rule, query: anonQueryName(v.query), sameResult: v.same })) };
}
$('#dataRun').onclick = dataRunAll;
wireDrop($('#dataSources'), async e => { const fs = [...e.dataTransfer.files]; if (fs.length){ await attachFiles(fs, '', ''); toast('Прикреплено файлов: ' + fs.length + ' (только в этом браузере)', 'ok'); } });
$('#dataLimit').onchange = async () => {
  DATA.limit = +$('#dataLimit').value || 0; DATA.wbFor = null; DATA.selfBook = null;
  for (const f of [...DATA.files.values(), ...[].concat(...DATA.folders.values())]) if (f.xlsx) f.xlsx = await readXlsxData(zipRead(f.bytes), { maxRows: DATA.limit });
  dataChanged();
};
registerView('data', { render: renderData });
