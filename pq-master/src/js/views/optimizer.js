/* =====================================================================
   views/optimizer.js — визуализация советов оптимизатора и их применение.
   applyFinding(f) — одно исправление (одна запись в истории);
   applyAllSafeText(text) — все безопасные исправления подряд (чистая функция,
   используется кнопкой «Применить все безопасные» и прогнозом оценки).
   ===================================================================== */
const OPT = { safety: '', query: '', impact: '', potential: null, potentialFor: null };
function applyAllSafeText(text, meta){
  let t = text; const applied = [];
  for (let i = 0; i < 80; i++){
    const A = analyzeSection(t, meta || {}); const o = optimizeSection(t, A, lintSection(A));
    const f = o.findings.find(x => x.safety === 'safe' && x.fix);
    if (!f) break;
    let n; try { n = f.fix(t); } catch { break; }
    if (n === t || syntaxIssues(n).length > syntaxIssues(t).length) break;
    applied.push(f.fixLabel + ' · ' + f.query); t = n;
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
  const n = f.fix(S.work, findingOpts(id)); const c = compareSections(S.work, n);
  const parts = c.changed.map(x => '<h3>✎ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div>').concat(c.added.map(x => '<h3>＋ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff('', x.text)) + '</div>'), c.removed.map(x => '<h3>－ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, '')) + '</div>'));
  const r = await modal('<h2>' + escHtml(f.fixLabel) + '</h2><div class="small muted">' + escHtml(f.how || '') + '</div>' + parts.join(''), [['cancel', 'Закрыть'], ['go', 'Применить', 'pri']], { wide: true });
  if (r === 'go') applyFinding(id);
}
async function applyAllSafe(){
  if (!S.work) return;
  const r = applyAllSafeText(S.work, S.book.meta);
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
function renderOptimizer(){
  if (!S.opt) return;
  const O = S.opt;
  if (OPT.potentialFor !== S.work){ OPT.potentialFor = S.work; try { const r = applyAllSafeText(S.work, S.book.meta); const A = analyzeSection(r.text, S.book.meta); OPT.potential = r.applied.length ? optimizeSection(r.text, A, lintSection(A)).score : null; } catch { OPT.potential = null; } }
  const b = O.breakdown;
  $('#optScore').innerHTML = gaugeSvg(O.score, 120) + '<div class="score-txt"><b>Здоровье книги</b><div>' + O.findings.length + ' советов · исправимо автоматически: ' + b.fixable + '</div>' + (OPT.potential != null ? '<div>после безопасных исправлений: <b style="color:var(--ok)">' + OPT.potential + '</b></div>' : '') + '<div class="small muted" style="margin-top:4px">Оценка — эвристика по тексту кода: ошибки −12, предупреждения −5, заметки −2, советы −1 (с ограничением на повторы).</div></div>';
  $('#optApplySafe').disabled = !b.safeFixable; $('#optApplySafe').textContent = 'Применить все безопасные' + (b.safeFixable ? ' (' + b.safeFixable + ')' : '');
  const maxI = Math.max(1, ...Object.values(b.byImpact));
  const sevCol = { err: 'var(--bad)', warn: 'var(--warn)', info: 'var(--accent)', tip: 'var(--ok)' };
  $('#optBreakdown').innerHTML = '<h2>На что влияют советы</h2>' + Object.keys(IMPACT_LABEL).map(k => { const fs = O.findings.filter(f => (f.impact || []).includes(k)); const segs = ['err', 'warn', 'info', 'tip'].map(s => { const n = fs.filter(f => f.sev === s).length; return n ? '<i style="width:' + (n / maxI * 100) + '%;background:' + sevCol[s] + '" title="' + SEV_LABEL[s] + ': ' + n + '"></i>' : ''; }).join('');
    return '<div class="bd-row"><span>' + IMPACT_LABEL[k] + '</span><div class="bd-track">' + segs + '</div><b>' + fs.length + '</b></div>'; }).join('') +
    '<div class="chips" style="margin-top:10px">' + ['safe', 'check', 'manual'].map(s => '<span class="chip"><span class="safety ' + s + '">' + SAFETY_LABEL[s] + '</span> ' + (b.bySafety[s] || 0) + '</span>').join('') + ['err', 'warn', 'info', 'tip'].map(s => '<span class="chip"><span class="sev ' + s + '">' + SEV_LABEL[s] + '</span> ' + (b.bySev[s] || 0) + '</span>').join('') + '</div>';
  // карта тяжести
  const secs = diagSecondsMap(); const maxSec = Math.max(0, ...secs.values());
  $('#heatNote').textContent = secs.size ? 'Фиолетовая полоска — реальное время из загруженной диагностики' : 'Загрузите диагностику — на карте появятся реальные секунды';
  const heat = O.heat;
  $('#optHeat').innerHTML = heat.length ? heat.map(h => '<div class="heat-q"><span class="qn" data-q="' + escHtml(h.query) + '" title="' + escHtml(h.query) + '">' + escHtml(h.query) + '</span><div class="heat-strip">' + h.cells.map(c => { const sec = secs.get(h.query + '\u0001' + c.step); return '<div class="heat-cell' + (c.brk ? ' brk' : '') + '" data-q="' + escHtml(h.query) + '" data-step="' + escHtml(c.step) + '" style="background:' + heatColor(c.level) + (c.dead ? ';opacity:.45' : '') + '" title="' + escHtml(c.step + ' — ' + (c.why.join('; ') || 'лёгкий шаг') + (sec != null ? ' · ' + sec.toFixed(3) + ' с по диагностике' : '') + (c.dead ? ' · не используется' : '')) + '">' + (h.cells.length <= 8 ? escHtml(c.step.slice(0, 14)) : '') + (sec != null && maxSec ? '<span class="secs" style="width:' + (sec / maxSec * 100) + '%"></span>' : '') + '</div>'; }).join('') + '</div><span class="small muted">' + h.total + ' ед.</span></div>').join('') +
    '<div class="heat-legend">лёгкий <i style="background:var(--heat0)"></i><i style="background:var(--heat1)"></i><i style="background:var(--heat2)"></i><i style="background:var(--heat3)"></i><i style="background:var(--heat4)"></i><i style="background:var(--heat5)"></i> тяжёлый · <span style="box-shadow:inset 3px 0 0 var(--bad);padding:0 6px">красная кромка</span> — здесь прерывается свёртка</div>' : '<div class="muted small">Нет запросов</div>';
  $$('[data-step]', $('#optHeat')).forEach(x => x.onclick = () => openInEditor(x.dataset.q, x.dataset.step));
  $$('.qn[data-q]', $('#optHeat')).forEach(x => x.onclick = () => openInEditor(x.dataset.q));
  // фильтры
  const qs = $('#optQuery'); const cur = qs.value; qs.innerHTML = '<option value="">все запросы</option>' + [...new Set(O.findings.map(f => f.query))].map(q => '<option>' + escHtml(q) + '</option>').join(''); qs.value = cur;
  renderOptCards();
}
function renderOptCards(){
  const O = S.opt;
  const list = O.findings.filter(f => (!OPT.safety || f.safety === OPT.safety) && (!$('#optQuery').value || f.query === $('#optQuery').value) && (!$('#optImpact').value || (f.impact || []).includes($('#optImpact').value)));
  $('#optCards').innerHTML = list.length ? list.map(f => {
    const opts = (f.options || []).map(o => '<label class="small">' + escHtml(o.label) + ': <select data-fopt="' + escHtml(f.id) + '" data-k="' + o.key + '">' + o.values.map(([v, l]) => '<option value="' + v + '"' + (String(pqmSettings().csvEncoding) === v ? ' selected' : '') + '>' + escHtml(l) + '</option>').join('') + '</select></label>').join('');
    return '<div class="ocard ' + f.sev + '"><div class="oh"><span class="sev ' + f.sev + '">' + SEV_LABEL[f.sev] + '</span><span class="ot">' + escHtml(f.title) + '</span><span class="safety ' + f.safety + '">' + SAFETY_LABEL[f.safety] + '</span></div>' +
      '<div class="where"><button class="link" data-oq="' + escHtml(f.query) + '" data-os="' + escHtml(f.step && !f.step.includes(' + ') ? f.step : '') + '">' + escHtml(f.query) + (f.step ? ' › ' + escHtml(f.step) : '') + '</button> · ' + (f.impact || []).map(i => '<span class="imp">' + IMPACT_LABEL[i] + '</span>').join(' ') + '</div>' +
      (f.why && f.why !== f.title ? '<div class="why">' + escHtml(f.why) + '</div>' : '') + (f.how ? '<div class="fix">→ ' + escHtml(f.how) + '</div>' : '') +
      '<div class="oa">' + opts + (f.fix ? '<button class="btn sm" data-prev="' + escHtml(f.id) + '">Показать изменения</button><button class="btn sm pri" data-apply="' + escHtml(f.id) + '">' + escHtml(f.fixLabel || 'Применить') + '</button>' : '<span class="small muted">исправляется вручную</span>') + '</div></div>';
  }).join('') : '<div class="note ok">Под выбранный фильтр советов нет.</div>';
  $$('[data-apply]', $('#optCards')).forEach(b => b.onclick = () => applyFinding(b.dataset.apply));
  $$('[data-prev]', $('#optCards')).forEach(b => b.onclick = () => previewFinding(b.dataset.prev));
  $$('[data-oq]', $('#optCards')).forEach(b => b.onclick = () => openInEditor(b.dataset.oq, b.dataset.os || null));
}
$('#optSafety').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; OPT.safety = b.dataset.v; $$('#optSafety button').forEach(x => x.classList.toggle('on', x === b)); renderOptCards(); });
$('#optQuery').addEventListener('change', renderOptCards);
$('#optImpact').addEventListener('change', renderOptCards);
$('#optApplySafe').onclick = applyAllSafe;
$('#optReport').onclick = async () => {
  const t = '# Советы оптимизатора — ' + S.book.name + '\nОценка: ' + S.opt.score + '/100\n\n' + S.opt.findings.map(f => '- [' + SEV_LABEL[f.sev] + ', ' + SAFETY_LABEL[f.safety] + '] **' + f.query + (f.step ? ' › ' + f.step : '') + '**: ' + f.title + (f.how ? ' — ' + f.how : '')).join('\n');
  await copyText(t); toast('Отчёт скопирован (Markdown). Внимание: содержит реальные имена запросов.', 'ok');
};
registerView('optimizer', { render: renderOptimizer });
