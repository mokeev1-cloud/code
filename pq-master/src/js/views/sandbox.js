/* =====================================================================
   views/sandbox.js — песочница: вычисление выражений M и пошаговый прогон
   запроса с подменой шагов-источников образцами данных (всё локально).
   ===================================================================== */
const SB = { exprView: null, query: null, steps: new Map(), queries: new Map(), results: null, sel: null };
const SB_EXAMPLES = [
  ['Числа и текст', 'let\n    Цена = 1250.5,\n    Кол = 3,\n    Итого = Цена * Кол\nin\n    "Итого: " & Number.ToText(Итого, "N2", "ru-RU")'],
  ['Таблица и фильтр', 'let\n    Т = #table({"Регион", "Сумма"}, {{"Север", 100}, {"Юг", 250}, {"Север", 70}}),\n    Отбор = Table.SelectRows(Т, each [Сумма] > 80),\n    Итоги = Table.Group(Т, {"Регион"}, {{"Сумма", each List.Sum([Сумма]), type number}})\nin\n    Итоги'],
  ['Даты', 'let\n    Д = #date(2024, 1, 31),\n    След = Date.AddMonths(Д, 1)\nin\n    [Месяц = Date.MonthName(След, "ru-RU"), Дата = След, КонецКвартала = Date.EndOfQuarter(Д)]'],
  ['Разбор текста', 'let\n    Строка = "Иванов;Пётр;  Сергеевич ",\n    Части = List.Transform(Text.Split(Строка, ";"), Text.Trim)\nin\n    Text.Combine(Части, " ")'],
  ['try / otherwise', 'let\n    Значения = {"12,5", "abc", "7"},\n    Числа = List.Transform(Значения, each try Number.FromText(_, "ru-RU") otherwise null)\nin\n    Числа'],
  ['Округление (банковское!)', '{Number.Round(2.5), Number.Round(3.5), Number.Round(2.5, 0, RoundingMode.AwayFromZero)}']
];
$('#sbExamples').innerHTML = '<option value="">примеры…</option>' + SB_EXAMPLES.map((e, i) => '<option value="' + i + '">' + escHtml(e[0]) + '</option>').join('');
$('#sbExamples').onchange = () => { const e = SB_EXAMPLES[+$('#sbExamples').value]; if (e && SB.exprView) SB.exprView.dispatch({ changes: { from: 0, to: SB.exprView.state.doc.length, insert: e[1] } }); $('#sbExamples').value = ''; };
$('#sbMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; $$('#sbMode button').forEach(x => x.classList.toggle('on', x === b)); $('#sbExpr').classList.toggle('hidden', b.dataset.m !== 'expr'); $('#sbQuery').classList.toggle('hidden', b.dataset.m !== 'query'); if (b.dataset.m === 'query') renderSbQuery(); });
function sbEval(){
  const t0 = performance.now(); const text = SB.exprView.state.doc.toString();
  try { const v = mEval(text, S.work); $('#sbExprOut').innerHTML = mRender(v); }
  catch (e){ $('#sbExprOut').innerHTML = '<div class="note bad"><b>' + escHtml(e.reason || 'Ошибка') + '</b><br>' + escHtml(e.message || String(e)) + '</div>'; }
  $('#sbExprTime').textContent = (performance.now() - t0).toFixed(1) + ' мс';
}
$('#sbEval').onclick = () => sbEval();
function sbEnsureEditor(){
  if (SB.exprView) return;
  SB.exprView = makeMEditor($('#sbExprHost'), SB_EXAMPLES[1][1], { keys: [{ key: 'Mod-Enter', run: () => { sbEval(); return true; } }] });
}
async function sampleTableFromFile(){
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt,.tsv,.xlsx';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return res(null);
      try { const u8 = await readFileBytes(f); let rows; if (/\.xlsx$/i.test(f.name)){ const sh = await readXlsxSheets(u8, 5001); rows = sh[0] ? sh[0].rows : []; } else rows = parseCSV(decodeText(u8).text).rows.slice(0, 5001);
        res({ label: f.name + ' (' + Math.max(0, rows.length - 1) + ' стр.)', value: tableFromRows(rows) }); } catch (e){ toast(e.message, 'bad'); res(null); } };
    inp.click();
  });
}
function sbOverrideDialog(kind, name){
  const p = modal('<h2>Подменить ' + (kind === 'step' ? 'шаг' : 'запрос') + ' «' + escHtml(name) + '» данными</h2><p class="small muted">Данные остаются на этом компьютере. Числа и даты вида ГГГГ-ММ-ДД распознаются автоматически; первая строка — заголовки.</p>' +
    '<div class="seg" id="ovMode"><button data-m="file" class="on">Файл CSV / XLSX</button><button data-m="text">Ввести таблицу</button><button data-m="m">Выражение M</button></div>' +
    '<div id="ovFile" style="margin-top:10px"><button class="btn" id="ovPick">Выбрать файл…</button> <span id="ovPicked" class="small muted"></span></div>' +
    '<div id="ovText" class="hidden" style="margin-top:10px"><textarea id="ovCsv" rows="8" class="code" spellcheck="false" placeholder="Код;Регион;Сумма&#10;1;Север;100&#10;2;Юг;250"></textarea></div>' +
    '<div id="ovM" class="hidden" style="margin-top:10px"><textarea id="ovMText" rows="5" class="code" spellcheck="false">#table({"Код", "Сумма"}, {{1, 100}, {2, 250}})</textarea></div>', [['cancel', 'Отмена'], ['ok', 'Подменить', 'pri']]);
  let mode = 'file', picked = null;
  $('#ovMode').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; $$('#ovMode button').forEach(x => x.classList.toggle('on', x === b)); $('#ovFile').classList.toggle('hidden', mode !== 'file'); $('#ovText').classList.toggle('hidden', mode !== 'text'); $('#ovM').classList.toggle('hidden', mode !== 'm'); };
  $('#ovPick').onclick = async () => { picked = await sampleTableFromFile(); $('#ovPicked').textContent = picked ? picked.label : ''; };
  return p.then(r => {
    if (r !== 'ok') return null;
    try {
      if (mode === 'file') return picked;
      if (mode === 'text'){ const t = $('#ovCsv').value; if (!t.trim()) return null; const rows = parseCSV(t).rows.filter(x => x.some(v => v !== '')); return { label: 'введено вручную (' + Math.max(0, rows.length - 1) + ' стр.)', value: tableFromRows(rows) }; }
      const v = mEval($('#ovMText').value, null); return { label: 'выражение M', value: v };
    } catch (e){ toast(e.message, 'bad'); return null; }
  });
}
function renderSbQuery(){
  if (!S.A) return;
  const sel = $('#sbQSel'); const cur = SB.query && S.A.byName.has(SB.query) ? SB.query : (S.sel || (S.A.members[0] || {}).name);
  sel.innerHTML = S.A.members.filter(m => !m.isFn).map(m => '<option' + (m.name === cur ? ' selected' : '') + '>' + escHtml(m.name) + '</option>').join('');
  SB.query = sel.value;
  renderSbSteps();
}
function sbRun(){
  if (!S.A || !SB.query) return;
  const steps = new Map([...SB.steps].filter(([k]) => k.startsWith(SB.query + '\u0001')).map(([k, v]) => [k.split('\u0001')[1], v.value]));
  const queries = new Map([...SB.queries].map(([k, v]) => [k, v.value]));
  try { SB.results = mRunSteps(S.work, SB.query, { steps, queries }); }
  catch (e){ SB.results = [{ name: '(разбор)', error: e, ms: 0 }]; }
  SB.results.query = SB.query;
  const firstErr = SB.results.findIndex(r => r.error);
  SB.sel = firstErr >= 0 ? firstErr : SB.results.length - 1;
  renderSbSteps();
}
function renderSbSteps(){
  const res = SB.results && SB.results.query === SB.query ? SB.results : null;
  const m = S.A.byName.get(SB.query); if (!m){ $('#sbStepList').innerHTML = ''; return; }
  const ovs = [...SB.steps].filter(([k]) => k.startsWith(SB.query + '\u0001'));
  const qovs = [...SB.queries];
  let h = '<div class="card-h"><h2>Шаги</h2><span class="sp"></span><button class="btn sm" id="sbOvQ" title="Подменить данными другой запрос, на который ссылается этот">Подменить запрос…</button></div>';
  if (!res) h += '<div class="small muted">Нажмите «Прогнать». Шаги, которые обращаются к источникам, подмените образцом данных.</div>';
  else { const seen = new Set(); h += res.map((r, i) => { const inherited = r.error && seen.has(r.error); if (r.error) seen.add(r.error); const src = r.error && r.error.reason === 'DataSource.Error' && !inherited;
    return '<div class="step-item' + (i === SB.sel ? ' on' : '') + '" data-i="' + i + '" title="' + (inherited ? 'ошибка пришла из предыдущего шага' : '') + '"><span class="st">' + (r.overridden ? '📎' : inherited ? '↳' : r.error ? (src ? '🔌' : '✖') : '✔') + '</span><span' + (inherited ? ' class="muted"' : '') + '>' + escHtml(r.name) + '</span><span class="tm">' + (r.ms != null ? r.ms.toFixed(1) + ' мс' : '') + '</span>' + (!r.final && r.name !== '(разбор)' ? '<button class="btn sm' + (src ? ' pri' : '') + '" data-ov="' + escHtml(r.name) + '">' + (r.overridden ? 'изменить' : 'подменить') + '</button>' : '') + '</div>'; }).join(''); }
  if (ovs.length || qovs.length) h += '<h3>Подмены</h3>' + ovs.map(([k, v]) => '<div class="small row" style="margin:2px 0">📎 шаг <b>' + escHtml(k.split('\u0001')[1]) + '</b>: ' + escHtml(v.label) + ' <button class="link" data-unov="' + escHtml(k) + '">убрать</button></div>').join('') + qovs.map(([k, v]) => '<div class="small row" style="margin:2px 0">📎 запрос <b>' + escHtml(k) + '</b>: ' + escHtml(v.label) + ' <button class="link" data-unq="' + escHtml(k) + '">убрать</button></div>').join('');
  $('#sbStepList').innerHTML = h;
  $$('[data-i]', $('#sbStepList')).forEach(x => x.onclick = e => { if (e.target.closest('[data-ov]')) return; SB.sel = +x.dataset.i; renderSbSteps(); });
  $$('[data-ov]', $('#sbStepList')).forEach(b => b.onclick = async () => { const v = await sbOverrideDialog('step', b.dataset.ov); if (v){ SB.steps.set(SB.query + '\u0001' + b.dataset.ov, v); sbRun(); } });
  $$('[data-unov]', $('#sbStepList')).forEach(b => b.onclick = () => { SB.steps.delete(b.dataset.unov); sbRun(); });
  $$('[data-unq]', $('#sbStepList')).forEach(b => b.onclick = () => { SB.queries.delete(b.dataset.unq); sbRun(); });
  $('#sbOvQ').onclick = async () => {
    const opts = [...m.refs].filter(n => S.A.byName.has(n));
    if (!opts.length) return toast('Этот запрос не ссылается на другие запросы', 'warn');
    const r = await modal('<h2>Какой запрос подменить?</h2><select id="ovQ">' + opts.map(n => '<option>' + escHtml(n) + '</option>').join('') + '</select>', [['cancel', 'Отмена'], ['ok', 'Дальше', 'pri']]);
    if (r !== 'ok') return; const qn = $('#ovQ').value; const v = await sbOverrideDialog('query', qn); if (v){ SB.queries.set(qn, v); sbRun(); }
  };
  const out = $('#sbStepOut');
  if (!res || SB.sel == null || !res[SB.sel]){ out.innerHTML = '<div class="muted small">Здесь появится результат выбранного шага.</div>'; return; }
  const r = res[SB.sel];
  out.innerHTML = '<div class="card-h"><h2>' + escHtml(r.name) + '</h2>' + (r.overridden ? '<span class="badge vio">подменён образцом</span>' : '') + '<span class="sp"></span>' + (r.name !== '(разбор)' && !r.final ? '<button class="btn sm" data-goto="' + escHtml(r.name) + '">Открыть в редакторе</button>' : '') + '</div>' +
    (r.error ? '<div class="note ' + (r.error.reason === 'DataSource.Error' ? 'warn' : 'bad') + '"><b>' + escHtml(r.error.reason || 'Ошибка') + '</b><br>' + escHtml(r.error.message || String(r.error)) + (r.error.reason === 'DataSource.Error' ? '<div class="row"><button class="btn pri sm" data-ov2="' + escHtml(r.name) + '">Подменить образцом</button></div>' : '') + '</div>' : '<div class="sb-out">' + mRender(r.value) + '</div>');
  $$('[data-goto]', out).forEach(b => b.onclick = () => openInEditor(SB.query, b.dataset.goto));
  $$('[data-ov2]', out).forEach(b => b.onclick = async () => { const v = await sbOverrideDialog('step', b.dataset.ov2); if (v){ SB.steps.set(SB.query + '\u0001' + b.dataset.ov2, v); sbRun(); } });
}
$('#sbQSel').addEventListener('change', () => { SB.query = $('#sbQSel').value; SB.results = null; renderSbSteps(); });
$('#sbQRun').onclick = () => { SB.results = null; sbRun(); };
function sbRunQuery(name){
  $$('#sbMode button').forEach(x => x.classList.toggle('on', x.dataset.m === 'query'));
  $('#sbExpr').classList.add('hidden'); $('#sbQuery').classList.remove('hidden');
  SB.query = name; SB.results = null; renderSbQuery(); $('#sbQSel').value = name; sbRun();
}
registerView('sandbox', { render: () => { if (!$('#sbQuery').classList.contains('hidden')) renderSbQuery(); }, onShow: () => { sbEnsureEditor(); setTimeout(() => SB.exprView.requestMeasure(), 0); } });
