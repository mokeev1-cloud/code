/* =====================================================================
   views/optimizer.js — визуализация советов оптимизатора и их применение.
   applyFinding(f) — одно исправление (одна запись в истории);
   applyAllSafeText(text) — все безопасные исправления подряд (чистая функция,
   используется кнопкой «Применить все безопасные» и прогнозом оценки).
   ===================================================================== */
const OPT = { safety: '', query: '', impact: '', potential: null, potentialFor: null, safeResult: null, limit: 60, heatAll: false };
const OPT_PAGE = 60, HEAT_TOP = 40;
function applyAllSafeText(text, meta){
  let t = text; const applied = [];
  for (let pass = 0; pass < 80; pass++){
    const A = analyzeSection(t, meta || {}); const o = optimizeSection(t, A, lintSection(A));
    const safe = o.findings.filter(x => x.safety === 'safe' && x.fix);
    if (!safe.length) break;
    // За проход — первое безопасное исправление каждого запроса. Те, что меняют текст только внутри
    // своего запроса, не зависят друг от друга и применяются пачкой с конца текста; остальные — по одному.
    const first = new Map(); for (const f of safe) if (!first.has(f.query)) first.set(f.query, f);
    const edits = [];
    for (const f of first.values()){
      const m = A.byName.get(f.query); if (!m || !f.local) continue;
      let n; try { n = f.fix(t); } catch { continue; }
      if (n === t) continue;
      // проверка, что исправление действительно изменило только свой запрос: текст до и после него тот же
      const ne = n.length - (t.length - m.end);
      if (ne < m.start || n.slice(0, m.start) !== t.slice(0, m.start) || n.slice(ne) !== t.slice(m.end)) continue;
      edits.push({ s: m.start, e: m.end, repl: n.slice(m.start, ne), f });
    }
    edits.sort((x, y) => y.s - x.s);   // запросы не пересекаются — применяем с конца, позиции не сдвигаются
    let n = t; const done = [];
    for (const d of edits){ n = n.slice(0, d.s) + d.repl + n.slice(d.e); done.push(d.f); }
    if (!done.length || syntaxIssues(n).length > syntaxIssues(t).length){
      // запасной путь: одно исправление за проход
      const f = safe[0]; let one; try { one = f.fix(t); } catch { break; }
      if (one === t || syntaxIssues(one).length > syntaxIssues(t).length) break;
      applied.push(f.fixLabel + ' · ' + f.query); t = one; continue;
    }
    for (const f of done.reverse()) applied.push(f.fixLabel + ' · ' + f.query);
    t = n;
  }
  return { text: t, applied };
}
function currentFinding(id){
  if (!S.opt) return null;
  if (S.opt.srcText !== S.work){ reanalyze(); }
  return S.opt.findings.find(f => f.id === id) || null;
}
function findingOpts(id){ const o = {}; $$('[data-fopt="' + CSS.escape(id) + '"]').forEach(s => { o[s.dataset.k] = s.value; }); return o; }
function applyFinding(id){
  const f = currentFinding(id); if (!f || !f.fix) return toast('Совет уже неактуален — список обновлён', 'warn');
  let n; try { n = f.fix(S.work, findingOpts(id)); } catch (e){ return toast('Не удалось применить: ' + e.message, 'bad'); }
  if (syntaxIssues(n).length > syntaxIssues(S.work).length) return toast('Исправление нарушило синтаксис — отменено. Сообщите о проблеме.', 'bad');
  setWork(n, 'optimizer', f.fixLabel + ' · ' + f.query);
  toast('Применено: ' + f.fixLabel, 'ok', 2500);
}
async function previewFinding(id){
  const f = currentFinding(id); if (!f || !f.fix) return;
  let n; try { n = f.fix(S.work, findingOpts(id)); } catch (e){ return toast('Не удалось построить исправление: ' + e.message, 'bad'); }
  const c = compareSections(S.work, n);
  const parts = c.changed.map(x => '<h3>✎ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div>').concat(c.added.map(x => '<h3>＋ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff('', x.text)) + '</div>'), c.removed.map(x => '<h3>－ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, '')) + '</div>'));
  const r = await modal('<h2>' + escHtml(f.fixLabel) + '</h2><div class="small muted">' + escHtml(f.how || '') + '</div>' + parts.join(''), [['cancel', 'Закрыть'], ['go', 'Применить', 'pri']], { wide: true });
  if (r === 'go') applyFinding(id);
}
async function applyAllSafe(){
  if (!S.work) return;
  // цепочка исправлений уже посчитана прогнозом оценки для этого же текста — берём её
  const r = OPT.potentialFor === S.work && OPT.safeResult ? OPT.safeResult : applyAllSafeText(S.work, S.book.meta);
  if (!r.applied.length) return toast('Безопасных исправлений нет', 'ok');
  const c = compareSections(S.work, r.text);
  const ok = await modal('<h2>Применить ' + r.applied.length + ' безопасных исправлений?</h2><p class="small muted">Безопасные исправления не меняют результат запросов: удаление неиспользуемых шагов, слияние однотипных шагов подряд, буферизация списков, вынос источников в параметры.</p><ul class="small">' + r.applied.map(x => '<li>' + escHtml(x) + '</li>').join('') + '</ul><details><summary>Изменения (' + (c.changed.length + c.added.length) + ' запросов)</summary>' + c.changed.map(x => '<h3>' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div>').join('') + c.added.map(x => '<h3>＋ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff('', x.text)) + '</div>').join('') + '</details>', [['cancel', 'Отмена'], ['go', 'Применить', 'pri']], { wide: true });
  if (ok !== 'go') return;
  setWork(r.text, 'optimizer', 'Безопасные исправления (' + r.applied.length + ')');
  toast('Применено исправлений: ' + r.applied.length + '. Отменить — кнопка ↶ или «История».', 'ok', 5000);
}
/** Реальные секунды по шагам из загруженной диагностики: ключ «запрос\u0001шаг» */
function diagSecondsMap(){
  const map = new Map();
  for (const d of S.diag){
    if (d.kind !== 'table') continue;
    const H = d.rows[0].map(h => String(h).trim().toLowerCase());
    const iQ = H.indexOf('query'), iS = H.indexOf('step'); let iE = H.indexOf('exclusive duration'); if (iE < 0) iE = H.indexOf('duration');
    if (iQ < 0 || iS < 0 || iE < 0) continue;
    for (const r of d.rows.slice(1)){ const sec = parseDuration(r[iE]); if (isFinite(sec)){ const k = r[iQ] + '\u0001' + r[iS]; map.set(k, (map.get(k) || 0) + sec); } }
  }
  return map;
}
/** Прогноз оценки после всех безопасных исправлений: считается после отрисовки, результат кэшируется по тексту */
function renderPotential(){
  if (!S.opt.breakdown.safeFixable){ OPT.potentialFor = S.work; OPT.potential = null; OPT.safeResult = null; }
  const show = () => { const el = $('#optPotential'); if (el) el.innerHTML = OPT.potentialFor !== S.work ? '<span class="muted">после безопасных исправлений: считаю…</span>' : OPT.potential != null ? 'после безопасных исправлений: <b style="color:var(--ok)">' + OPT.potential + '</b>' : ''; };
  show(); if (OPT.potentialFor === S.work) return;
  const text = S.work;
  setTimeout(() => {
    if (S.work !== text || OPT.potentialFor === text) return;
    try { const r = applyAllSafeText(text, S.book.meta); OPT.safeResult = r; const A = analyzeSection(r.text, S.book.meta); OPT.potential = r.applied.length ? optimizeSection(r.text, A, lintSection(A)).score : null; } catch { OPT.potential = null; OPT.safeResult = null; }
    OPT.potentialFor = text; show();
  }, 30);
}
function renderOptimizer(){
  if (!S.opt) return;
  const O = S.opt;
  const b = O.breakdown;
  $('#optScore').innerHTML = gaugeSvg(O.score, 120) + '<div class="score-txt"><b>Здоровье книги</b><div>' + O.findings.length + ' советов · исправимо автоматически: ' + b.fixable + '</div><div id="optPotential"></div><div class="small muted" style="margin-top:4px">Оценка — эвристика по тексту кода: ошибки −12, предупреждения −5, заметки −2, советы −1 (с ограничением на повторы).</div></div>';
  renderPotential();
  $('#optApplySafe').disabled = !b.safeFixable; $('#optApplySafe').textContent = 'Применить все безопасные' + (b.safeFixable ? ' (' + b.safeFixable + ')' : '');
  const maxI = Math.max(1, ...Object.values(b.byImpact));
  const sevCol = { err: 'var(--bad)', warn: 'var(--warn)', info: 'var(--accent)', tip: 'var(--ok)' };
  $('#optBreakdown').innerHTML = '<h2>На что влияют советы</h2>' + Object.keys(IMPACT_LABEL).map(k => { const fs = O.findings.filter(f => (f.impact || []).includes(k)); const segs = ['err', 'warn', 'info', 'tip'].map(s => { const n = fs.filter(f => f.sev === s).length; return n ? '<i style="width:' + (n / maxI * 100) + '%;background:' + sevCol[s] + '" title="' + SEV_LABEL[s] + ': ' + n + '"></i>' : ''; }).join('');
    return '<div class="bd-row"><span>' + IMPACT_LABEL[k] + '</span><div class="bd-track">' + segs + '</div><b>' + fs.length + '</b></div>'; }).join('') +
    '<div class="chips" style="margin-top:10px">' + ['safe', 'check', 'manual'].map(s => '<span class="chip"><span class="safety ' + s + '">' + SAFETY_LABEL[s] + '</span> ' + (b.bySafety[s] || 0) + '</span>').join('') + ['err', 'warn', 'info', 'tip'].map(s => '<span class="chip"><span class="sev ' + s + '">' + SEV_LABEL[s] + '</span> ' + (b.bySev[s] || 0) + '</span>').join('') + '</div>';
  // карта тяжести
  const secs = diagSecondsMap(); const maxSec = Math.max(0, ...secs.values());
  $('#heatNote').textContent = secs.size ? 'Фиолетовая полоска — реальное время из загруженной диагностики' : 'Загрузите диагностику — на карте появятся реальные секунды';
  const heat = OPT.heatAll ? O.heat : O.heat.slice(0, HEAT_TOP);
  $('#optHeat').innerHTML = heat.length ? heat.map(h => '<div class="heat-q"><span class="qn" data-q="' + escHtml(h.query) + '" title="' + escHtml(h.query) + '">' + escHtml(h.query) + '</span><div class="heat-strip">' + h.cells.map(c => { const sec = secs.get(h.query + '\u0001' + c.step); return '<div class="heat-cell' + (c.brk ? ' brk' : '') + '" data-q="' + escHtml(h.query) + '" data-step="' + escHtml(c.step) + '" style="background:' + heatColor(c.level) + (c.dead ? ';opacity:.45' : '') + '" title="' + escHtml(c.step + ' — ' + (c.why.join('; ') || 'лёгкий шаг') + (sec != null ? ' · ' + sec.toFixed(3) + ' с по диагностике' : '') + (c.dead ? ' · не используется' : '')) + '">' + (h.cells.length <= 8 ? escHtml(c.step.slice(0, 14)) : '') + (sec != null && maxSec ? '<span class="secs" style="width:' + (sec / maxSec * 100) + '%"></span>' : '') + '</div>'; }).join('') + '</div><span class="small muted">' + h.total + ' ед.' + (h.reads >= 2 ? ' <b class="reads" title="При «Обновить всё» вычисляется ≈' + h.reads + ' раз — для каждой загружаемой таблицы, которая от него зависит">×' + h.reads + '</b>' : '') + '</span></div>').join('') +
    '<div class="heat-legend">лёгкий <i style="background:var(--heat0)"></i><i style="background:var(--heat1)"></i><i style="background:var(--heat2)"></i><i style="background:var(--heat3)"></i><i style="background:var(--heat4)"></i><i style="background:var(--heat5)"></i> тяжёлый · <span style="box-shadow:inset 3px 0 0 var(--bad);padding:0 6px">красная кромка</span> — здесь прерывается свёртка</div>' +
    (O.heat.length > HEAT_TOP ? '<button class="btn sm" id="heatMore">' + (OPT.heatAll ? 'Только ' + HEAT_TOP + ' самых тяжёлых' : 'Показать все запросы (' + O.heat.length + ')') + '</button>' : '') : '<div class="muted small">Нет запросов</div>';
  if ($('#heatMore')) $('#heatMore').onclick = () => { OPT.heatAll = !OPT.heatAll; renderOptimizer(); };
  $$('[data-step]', $('#optHeat')).forEach(x => x.onclick = () => openInEditor(x.dataset.q, x.dataset.step));
  $$('.qn[data-q]', $('#optHeat')).forEach(x => x.onclick = () => openInEditor(x.dataset.q));
  // как обновляется книга: макросы и подключения (на оценку не влияют)
  const bi = S.book ? bookRefreshIssues(S.book) : [];
  $('#optBook').classList.toggle('hidden', !S.book || S.book.family === 'text');
  const pend = Object.keys((S.bookEdits && S.bookEdits.conns) || {}).length;
  $('#optBookPending').textContent = pend ? 'ожидают записи: свойства ' + pend + ' ' + (pend % 10 === 1 && pend % 100 !== 11 ? 'подключения' : 'подключений') + ' — сохраните книгу' : '';
  $('#optBookList').innerHTML = (bi.length ? '' : '<div class="small muted">Замечаний к макросам и свойствам подключений нет.</div>') + bi.map(i => '<div class="bi ' + i.sev + '"><div class="oh"><span class="sev ' + i.sev + '">' + SEV_LABEL[i.sev] + '</span><span class="ot">' + escHtml(i.title) + '</span></div><div class="why">' + escHtml(i.text) + '</div>' + (i.how ? '<div class="fix">→ ' + escHtml(i.how) + '</div>' : '') + '</div>').join('');
  // фильтры
  const qs = $('#optQuery'); const cur = qs.value; qs.innerHTML = '<option value="">все запросы</option>' + [...new Set(O.findings.map(f => f.query))].map(q => '<option>' + escHtml(q) + '</option>').join(''); qs.value = cur;
  renderOptCards();
}
function renderOptCards(){
  const O = S.opt;
  const list = O.findings.filter(f => (!OPT.safety || f.safety === OPT.safety) && (!$('#optQuery').value || f.query === $('#optQuery').value) && (!$('#optImpact').value || (f.impact || []).includes($('#optImpact').value)));
  const enc = String(pqmSettings().csvEncoding);
  $('#optCards').innerHTML = list.length ? list.slice(0, OPT.limit).map(f => {
    const opts = (f.options || []).map(o => '<label class="small">' + escHtml(o.label) + ': <select data-fopt="' + escHtml(f.id) + '" data-k="' + o.key + '">' + o.values.map(([v, l]) => '<option value="' + v + '"' + (enc === v ? ' selected' : '') + '>' + escHtml(l) + '</option>').join('') + '</select></label>').join('');
    return '<div class="ocard ' + f.sev + '"><div class="oh"><span class="sev ' + f.sev + '">' + SEV_LABEL[f.sev] + '</span><span class="ot">' + escHtml(f.title) + '</span><span class="safety ' + f.safety + '">' + SAFETY_LABEL[f.safety] + '</span></div>' +
      '<div class="where"><button class="link" data-oq="' + escHtml(f.query) + '" data-os="' + escHtml(f.step && !f.step.includes(' + ') ? f.step : '') + '">' + escHtml(f.query) + (f.step ? ' › ' + escHtml(f.step) : '') + '</button> · ' + (f.impact || []).map(i => '<span class="imp">' + IMPACT_LABEL[i] + '</span>').join(' ') + '</div>' +
      (f.why && f.why !== f.title ? '<div class="why">' + escHtml(f.why) + '</div>' : '') + (f.how ? '<div class="fix">→ ' + escHtml(f.how) + '</div>' : '') +
      '<div class="oa">' + opts + (f.fix ? '<button class="btn sm" data-prev="' + escHtml(f.id) + '">Показать изменения</button><button class="btn sm pri" data-apply="' + escHtml(f.id) + '">' + escHtml(f.fixLabel || 'Применить') + '</button>' : '<span class="small muted">исправляется вручную</span>') + '</div></div>';
  }).join('') + (list.length > OPT.limit ? '<button class="btn" id="optMore" style="grid-column:1/-1;justify-self:center">Показать ещё ' + Math.min(OPT_PAGE, list.length - OPT.limit) + ' из ' + (list.length - OPT.limit) + '</button>' : '') : '<div class="note ok">Под выбранный фильтр советов нет.</div>';
  if ($('#optMore')) $('#optMore').onclick = () => { OPT.limit += OPT_PAGE; renderOptCards(); };
  $$('[data-apply]', $('#optCards')).forEach(b => b.onclick = () => applyFinding(b.dataset.apply));
  $$('[data-prev]', $('#optCards')).forEach(b => b.onclick = () => previewFinding(b.dataset.prev));
  $$('[data-oq]', $('#optCards')).forEach(b => b.onclick = () => openInEditor(b.dataset.oq, b.dataset.os || null));
}
const optFilter = () => { OPT.limit = OPT_PAGE; renderOptCards(); };
$('#optSafety').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; OPT.safety = b.dataset.v; $$('#optSafety button').forEach(x => x.classList.toggle('on', x === b)); optFilter(); });
$('#optQuery').addEventListener('change', optFilter);
$('#optImpact').addEventListener('change', optFilter);
$('#optApplySafe').onclick = applyAllSafe;
$('#optReport').onclick = async () => {
  const t = '# Советы оптимизатора — ' + S.book.name + '\nОценка: ' + S.opt.score + '/100\n\n' + S.opt.findings.map(f => '- [' + SEV_LABEL[f.sev] + ', ' + SAFETY_LABEL[f.safety] + '] **' + f.query + (f.step ? ' › ' + f.step : '') + '**: ' + f.title + (f.how ? ' — ' + f.how : '')).join('\n');
  await copyText(t); toast('Отчёт скопирован (Markdown). Внимание: содержит реальные имена запросов.', 'ok');
};
/* ---- Настройки PQ и Excel: что хранится в файле — правится здесь и пишется при сохранении;
   что задаётся только в Excel — макросом (genPqMacro) или вручную. С Excel инструмент не связывается. ---- */
const PQX = { refresh: true, timing: true, fastCombine: null };
/** Внешние источники, которым FastCombine мог бы отправить данные других источников */
const EXTERNAL_SRC = /\b(Web\.(Contents|Page|BrowserContents)|OData\.Feed|SharePoint\.|AzureStorage\.|Salesforce\.|GoogleAnalytics\.|Json\.Document\s*\(\s*Web\.)/;
function pqxConns(){ return (S.book.conns || []).filter(c => c.mashup && !c.deleted); }
const pqxVal = (c, k) => { const e = S.bookEdits.conns[c.id]; return e && k in e ? e[k] : c[k]; };
function pqxSet(c, k, v){
  const E = S.bookEdits.conns; const e = Object.assign({}, E[c.id]);
  if (v === c[k]) delete e[k]; else e[k] = v;
  if (Object.keys(e).length) E[c.id] = e; else delete E[c.id];
}
/** excludeFromRefreshAll без элемента x15:connection в файле не пишется — такие подключения уходят в макрос PQ_Setup */
function pqxMacroOpts(forFile){
  const conns = S.book.conns ? pqxConns() : [];
  const ex = conns.filter(c => !c.hasX15 && PQX.macroExcl && PQX.macroExcl.has(c.id)).map(c => c.name);
  return { refresh: PQX.refresh, timing: PQX.timing, fastCombine: PQX.fastCombine, setup: { exclude: ex }, codePage: (S.book.vba && S.book.vba.codePage) || 1251, bookName: S.book.name, forFile };
}
async function openPqSettings(){
  if (!S.book || S.book.family === 'text') return toast('Откройте книгу Excel или Power BI', 'warn');
  const B = S.book, xl = B.family === 'excel';
  if (PQX.fastCombine === null || PQX.for !== B.sha){ PQX.fastCombine = xl && !EXTERNAL_SRC.test(S.work); PQX.macroExcl = new Set(); PQX.for = B.sha; }
  const conns = xl && B.conns ? pqxConns() : [];
  const ck = (on, attrs) => '<input type="checkbox"' + (on ? ' checked' : '') + ' ' + attrs + '>';
  // рекомендации: «при открытии» — выкл; фоновое — выкл, если в книге есть сводные (иначе вкл); «Обновить всё» — как в файле
  const recBg = !(B.pivots > 0);
  const rec = { refreshOnLoad: false, background: recBg };
  const legend = '<table class="t small pqx-legend"><tr><th>Флажок</th><th>Рекомендуется</th><th>Когда иначе</th></tr>' +
    '<tr><td><b>Обновлять при открытии</b></td><td>выключить</td><td>Открытие книги длится столько же, сколько обновление. Включайте, только если книгу открывают ради свежих данных и ждать при открытии приемлемо.</td></tr>' +
    '<tr><td><b>В «Обновить всё»</b></td><td>включено (как сейчас)</td><td>Снимите у справочников и архивов, которые не меняются (прошлые периоды, план, маппинг): «Обновить всё» перестанет их пересчитывать. Обновляйте их вручную, когда данные изменились.</td></tr>' +
    '<tr><td><b>Фоновое обновление</b></td><td>' + (recBg ? 'включить' : 'выключить') + '</td><td>' + (recBg
      ? 'Сводных таблиц в книге нет: в фоне можно работать в Excel, пока идёт обновление. Скорость от флажка не зависит.'
      : 'В книге есть сводные (' + B.pivots + '): при фоновом обновлении они успевают обновиться раньше данных и «Обновить всё» приходится нажимать дважды. Выключенный флажок — один проход, но Excel не отвечает до конца обновления.') +
      ' Макрос PQ_RefreshAll на время своей работы всё равно выключает фон.</td></tr></table>';
  const recBadge = k => k in rec ? ' <span class="pqx-rec small" data-rk="' + k + '"></span>' : '';
  const fileSec = !xl ? '<p class="small muted">У файлов Power BI свойства обновления задаются в Power BI Desktop — см. «Вручную».</p>'
    : !B.conns ? '<p class="small muted">' + (B.ext === 'xlsb' ? 'В .xlsb подключения хранятся в двоичном виде — здесь их не изменить. Используйте макрос ниже или пункты «Вручную».' : 'В книге нет файла подключений (xl/connections.xml).') + '</p>'
    : !conns.length ? '<p class="small muted">Подключений Power Query в книге нет (запросы не загружаются ни на лист, ни в модель).</p>'
    : legend + '<div class="table-wrap" style="max-height:34vh;margin-top:8px"><table class="t"><tr><th>Подключение</th><th title="Refresh data when opening the file">Обновлять при открытии</th><th title="Refresh this connection on Refresh All">В «Обновить всё»</th><th title="Enable background refresh">Фоновое обновление</th></tr>' +
      conns.map(c => '<tr><td>' + escHtml(c.query || c.name) + (c.model ? ' <span class="small muted">модель данных</span>' : '') + '</td>' +
        '<td>' + ck(pqxVal(c, 'refreshOnLoad'), 'data-cid="' + escHtml(c.id) + '" data-k="refreshOnLoad"') + recBadge('refreshOnLoad') + '</td>' +
        '<td>' + ck(c.hasX15 ? !pqxVal(c, 'excluded') : !PQX.macroExcl.has(c.id), 'data-cid="' + escHtml(c.id) + '" data-k="excluded"') + (c.hasX15 ? '' : ' <span class="small muted" title="Этот флаг в файле не записан — изменение уйдёт в макрос PQ_Setup">макросом</span>') + '</td>' +
        '<td>' + (c.model ? '<span class="small muted" title="Загрузки в модель данных в фоне не выполняются">всегда синхронно</span>' : ck(pqxVal(c, 'background'), 'data-cid="' + escHtml(c.id) + '" data-k="background"') + recBadge('background')) + '</td></tr>').join('') + '</table></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn sm pri" id="pqxRec">Применить рекомендуемое</button><button class="btn sm" id="pqxReset">Вернуть как в файле</button><span class="small muted" id="pqxPend"></span></div>' +
      '<p class="small muted">«Применить рекомендуемое» меняет только «при открытии» и «фоновое»; исключение из «Обновить всё» — ваше решение по смыслу данных. Записывается только xl/connections.xml, код запросов не трогается.</p>';
  const procs = [...new Set(bookRefreshIssues(B).filter(i => /^macro-(refreshall-twice|refresh-again|model-twice|pivot-again)$/.test(i.key)).map(i => (/«([^»]+)»/.exec(i.text) || [])[1]).filter(Boolean))];
  const macroSec = xl ? '<div class="row" style="flex-wrap:wrap;gap:14px">' +
      '<label>' + ck(PQX.refresh, 'id="pqxRefresh"') + ' PQ_RefreshAll — одно «Обновить всё», макрос ждёт данные <span class="pqx-rec ok small">рекомендуется</span></label>' +
      '<label>' + ck(PQX.timing, 'id="pqxTiming"') + ' PQ_TimeQueries — замер времени каждого запроса <span class="small muted">(рекомендуется: запустите один раз, чтобы найти самые медленные)</span></label>' +
      '<label title="ThisWorkbook.Queries.FastCombine = True — действует, пока книга открыта, для любого пользователя">' + ck(PQX.fastCombine, 'id="pqxFast"') + ' игнорировать уровни конфиденциальности (FastCombine) ' + (EXTERNAL_SRC.test(S.work) ? '<span class="pqx-rec warn small">не рекомендуется: есть веб-источники</span>' : '<span class="pqx-rec ok small">рекомендуется: источники внутренние</span>') + '</label></div>' +
      '<p class="small muted" id="pqxFastNote"></p>' +
      (procs.length ? '<div class="note warn small">В процедуре ' + procs.map(p => '«' + escHtml(p) + '»').join(', ') + ' запросы обновляются повторно (см. «Как обновляется книга»). Замените в ней вызовы обновления одной строкой <code>PQ_RefreshAll</code>.</div>' : '') +
      (/^xlsx$/i.test(B.ext) ? '<p class="small muted">Книга .xlsx не хранит макросы: после вставки модуля сохраните её как .xlsm (Книга Excel с поддержкой макросов).</p>' : '') +
      '<pre class="code" id="pqxCode" style="max-height:28vh"></pre>' +
      '<div class="row" style="margin-top:6px"><button class="btn sm" id="pqxCopy">Скопировать код</button><button class="btn sm" id="pqxDl">Скачать PQMaster.bas</button><span class="small muted">Вставка: Alt+F11 → Файл → Импорт файла. Модуль только вызывает обновление и меняет свойства подключений; данные книги он не читает.</span></div>'
    : '<p class="small muted">Для Power BI макросов нет.</p>';
  const stg = (S.lint || []).filter(f => f.rule === 'loaded-staging').map(f => f.query);
  const multi = (S.lint || []).filter(f => f.rule === 'multi-eval').map(f => f.query);
  const priv = B.privacy && B.privacy.firewall === false ? 'сейчас в файле: <b>игнорировать</b> (только для того, кто сохранил книгу)' : B.privacy && B.privacy.firewall === true ? 'сейчас в файле: проверять уровни (по умолчанию)' : '';
  const manual = xl ? [
    ['Уровни конфиденциальности', 'Данные → Получить данные → Параметры запроса → Текущая книга → Конфиденциальность → «Игнорировать уровни конфиденциальности» (Ignore the Privacy Levels)' + (priv ? '; ' + priv : '') + '. Флаг привязан к пользователю и сбрасывается при любом изменении кода — надёжнее FastCombine в макросе. Если в разделе «Глобальные → Конфиденциальность» выбрано «Всегда учитывать…», настройка книги не действует.'],
    ['Фоновая загрузка предпросмотра', 'Параметры запроса → Текущая книга → Загрузка данных → снять «Разрешить фоновую загрузку данных для предварительного просмотра» (Allow data previews to download in the background). При многих связанных запросах «Обновить всё» может пересчитывать и предпросмотры. Замерьте время до и после (PQ_RefreshAll выводит его).'],
    ['Промежуточные запросы — «Только подключение»', (stg.length ? 'Загружаются, хотя на них ссылаются другие: ' + stg.map(escHtml).join(', ') + '. ' : 'Промежуточных запросов, загружаемых на лист или в модель, не найдено. ') + 'Данные → Запросы и подключения → правый щелчок → Загрузить в… → «Только создать подключение». Экономится только их собственное вычисление и выгрузка: запросы, которые на них ссылаются, всё равно вычисляют их заново каждый раз.'],
    ['Тяжёлый запрос нужен нескольким таблицам', multi.length ? 'Вычисляются по нескольку раз за обновление: ' + multi.map(escHtml).join(', ') + '. Excel не делит результат между загружаемыми запросами, настройки этого не изменят — помогает перестройка: меньше загружаемых итогов, ранние фильтры или один раз загрузить промежуточный результат на лист и строить отчёты от этой таблицы.' : 'Повторных вычислений тяжёлых запросов не найдено.']
  ] : [
    ['Уровни конфиденциальности', 'Файл → Параметры и настройки → Параметры → Текущий файл → Конфиденциальность → «Игнорировать уровни конфиденциальности».'],
    ['Фоновые данные', 'Параметры → Текущий файл → Загрузка данных → снять «Разрешить загрузку предварительного просмотра данных в фоне»; там же — параллельная загрузка таблиц.']
  ];
  const html = '<h2>⚙ Настройки PQ и Excel</h2><p class="small muted">Мастер PQ работает в браузере и к Excel не подключается. Свойства, которые хранятся в файле, меняются здесь и записываются при сохранении книги; то, что задаётся только в Excel, — макросом или вручную.</p>' + (/^Демо-книга/.test(B.name) ? '<div class="note small">Это демо-книга: запросы «Продажи», «Курсы» и другие и их подключения выдуманы для примера. Откройте свою книгу — здесь будут её подключения.</div>' : '') +
    '<h3>1. В файле</h3>' + fileSec + '<h3>2. Макрос для Excel</h3>' + macroSec +
    '<h3>3. Вручную</h3><ol class="small">' + manual.map(([t, d]) => '<li><b>' + escHtml(t) + '.</b> ' + d + '</li>').join('') + '</ol><p class="small muted">Названия пунктов — по документации Microsoft; в вашей версии Excel они могут немного отличаться.</p>';
  const p = modal(html, [['ok', 'Готово', 'pri']], { wide: true });
  const refresh = () => {
    const n = Object.keys(S.bookEdits.conns).length, nm = PQX.macroExcl ? PQX.macroExcl.size : 0;
    if ($('#pqxPend')) $('#pqxPend').textContent = (n ? 'к записи в файл: ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'подключение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'подключения' : 'подключений') + ' — сохраните книгу' : '') + (nm ? (n ? '; ' : '') + 'через макрос PQ_Setup: ' + nm : '');
    if ($('#pqxCode')) $('#pqxCode').textContent = genPqMacro(pqxMacroOpts(false));
    if ($('#pqxFastNote')) $('#pqxFastNote').textContent = EXTERNAL_SRC.test(S.work) ? 'В книге есть веб-источники: без проверок уровней данные одних источников могут уйти в запросы к другим. Включайте, только если все источники — внутренние.' : 'Источники — файлы, книги и базы данных: проверки уровней конфиденциальности обычно только замедляют слияние разных источников.';
    $$('#modal .pqx-rec[data-rk]').forEach(b => { const x = b.parentNode.querySelector('input'); const want = rec[b.dataset.rk]; const okv = x.checked === want; b.className = 'pqx-rec small ' + (okv ? 'ok' : 'warn'); b.textContent = okv ? '✓' : 'рек.: ' + (want ? 'вкл' : 'выкл'); b.title = okv ? 'Как рекомендуется' : 'Рекомендуется ' + (want ? 'включить' : 'выключить') + ' — см. таблицу выше'; });
  };
  $$('#modal input[data-cid]').forEach(x => x.onchange = () => {
    const c = conns.find(cc => cc.id === x.dataset.cid); const k = x.dataset.k;
    if (k === 'excluded' && !c.hasX15){ if (x.checked) PQX.macroExcl.delete(c.id); else PQX.macroExcl.add(c.id); }
    else pqxSet(c, k, k === 'excluded' ? !x.checked : x.checked);
    refresh(); emitState('settings');
  });
  const setAll = (k, v) => { $$('#modal input[data-k="' + k + '"]').forEach(x => { if (x.checked !== v){ x.checked = v; x.onchange(); } }); };
  if ($('#pqxRec')) $('#pqxRec').onclick = () => { setAll('refreshOnLoad', rec.refreshOnLoad); setAll('background', rec.background); };
  if ($('#pqxReset')) $('#pqxReset').onclick = () => { S.bookEdits.conns = {}; PQX.macroExcl.clear(); $$('#modal input[data-cid]').forEach(x => { const c = conns.find(cc => cc.id === x.dataset.cid); x.checked = x.dataset.k === 'excluded' ? !c.excluded : c[x.dataset.k]; }); refresh(); emitState('settings'); };
  for (const [id, key] of [['#pqxRefresh', 'refresh'], ['#pqxTiming', 'timing'], ['#pqxFast', 'fastCombine']]) if ($(id)) $(id).onchange = e => { PQX[key] = e.target.checked; refresh(); };
  if ($('#pqxCopy')) $('#pqxCopy').onclick = async () => { await copyText(genPqMacro(pqxMacroOpts(false))); toast('Код модуля скопирован — вставьте его в редакторе VBA (Alt+F11 → Вставка → Модуль)', 'ok'); };
  if ($('#pqxDl')) $('#pqxDl').onclick = () => { const o = pqxMacroOpts(true); download('PQMaster.bas', new Blob([encodeCodePage(genPqMacro(o), o.codePage)], { type: 'text/plain' })); toast('Скачан PQMaster.bas (кодировка windows-' + o.codePage + ')', 'ok'); };
  refresh();
  await p;
}
$('#optSettings').onclick = openPqSettings;
registerView('optimizer', { render: renderOptimizer });
