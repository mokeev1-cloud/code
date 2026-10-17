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
registerView('optimizer', { render: renderOptimizer });
