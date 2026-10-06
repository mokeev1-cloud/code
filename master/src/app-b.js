/* ===== Часть B: дело, шаги 3–5 (готовность, внутри группы, внешние долги), шаблоны ===== */

/* ---------- дело ---------- */
function caseJson() {
  var c = S.case, p = {};
  BIND.forEach(function (b) { p[b[1]] = P[b[1]]; });
  c.params = Object.assign(c.params || {}, { p: p, pk: P.pk, statuses: P.statuses, accounts: P.accounts, accountsTouched: P.accountsTouched, lsts: P.lsts, manual: MANUAL, xman: XMAN });
  c.templates = {}; Object.keys(S.tpl).forEach(function (k) { c.templates[k] = { name: S.tpl[k].name, hash: S.tpl[k].hash }; });
  return c;
}
function caseFileName() { return 'Дело ' + (S.case.name || 'предпродажная подготовка') + ' ' + Engine.dateShort(new Date()) + '.json'; }
function saveCase() { save(JSON.stringify(caseJson(), null, 1), caseFileName(), 'application/json'); markDirty(false); toast('Дело сохранено. Положите файл рядом с данными — он понадобится при следующей загрузке.', 'ok', 5500); }
function loadCase(o, fileName) {
  S.case = Case.normalize(o); var p = (o.params || {});
  if (p.p) Object.keys(p.p).forEach(function (k) { if (['date', 'payDate', 'xdate', 'xpay'].indexOf(k) < 0 && k in P) P[k] = p.p[k]; });
  ['pk', 'statuses', 'accounts', 'lsts'].forEach(function (k) { if (p[k]) P[k] = p[k]; });
  P.accountsTouched = !!p.accountsTouched;
  Object.keys(p.manual || {}).forEach(function (k) { MANUAL[k] = Object.assign(MANUAL[k] || {}, p.manual[k]); });
  XMAN = Object.assign(XMAN, p.xman || {});
  if (!S.case.name && fileName) S.case.name = fileName.replace(/^Дело\s*/i, '').replace(/\s*\d{2}\.\d{2}\.\d{4}.*$/, '').replace(/\.json$/i, '').trim();
  S.pickUser = {}; S.pending = null; markDirty(false); toast('Дело загружено: документов ' + Object.keys(S.case.docs).length + ', выпусков ' + S.case.issues.length, 'ok');
}
function newCase() {
  if (S.dirty && !confirm('В деле есть несохраненные изменения. Начать новое дело без сохранения?')) return;
  S.case = Case.create(); S.pickUser = {}; markDirty(false); recomputeAll(); renderCase();
}
function renderCase() {
  var sm = Case.summary(S.case), c = S.case;
  $('caseName').textContent = 'Дело: ' + (c.name || (sm.total ? 'без названия' : 'новое'));
  $('caseInfo').innerHTML = sm.total || c.issues.length
    ? '<div class="stat"><b>' + sm.total + '</b><span>документов в деле</span></div><div class="stat"><b>' + (sm['подготовлен'] || 0) + '</b><span>подготовлено</span></div><div class="stat"><b>' + (sm['на подписи'] || 0) + '</b><span>на подписи</span></div><div class="stat"><b>' + (sm['подписан'] || 0) + '</b><span>подписано</span></div><div class="stat"><b>' + c.issues.length + '</b><span>выпусков</span></div>'
    : '<span class="muted">Дело пока пустое — оно появится после первого выпуска документов.</span>';
}
function stepFlags() {
  var sm = Case.summary(S.case), conflicts = S.reco ? S.reco.rows.filter(function (w) { return w.state === 'conflict' || w.state === 'goneSigned'; }).length : 0;
  return {
    1: !!(S.merged && S.reg && S.req), 2: ready() && pkgInns().length > 0, 3: !!S.liq, 4: !!(S.group && S.group.some(function (r) { return r.pl.cessions.length || r.pl.zachety.length; })),
    5: !!(S.exts && S.exts.some(function (e) { return e.pl.zachety.length + e.pl.cessions.length + e.pl.transfers.length; })), 6: sm.total > 0 && !conflicts, w6: conflicts > 0
  };
}
function renderChrome() {
  var f = stepFlags();
  [].forEach.call($('stepper').children, function (b) {
    var n = +b.dataset.step;
    b.classList.toggle('on', n === S.step); b.classList.toggle('done', n !== S.step && !!f[n] && !(n === 6 && f.w6)); b.classList.toggle('warn', n === 6 && f.w6 && n !== S.step);
  });
  renderCase();
  var nt = Object.keys(S.tpl).length;
  $('tplBadge').textContent = nt ? 'загружено ' + nt + ' из 5' : 'встроенные'; $('tplBadge').classList.toggle('on', nt > 0);
  $('bBack').style.visibility = S.step > 1 ? 'visible' : 'hidden';
  $('bNext').style.visibility = S.step < 6 ? 'visible' : 'hidden';
}
function renderAll() { renderVgo(); renderExt(); renderRelease(); renderChrome(); }
function go(n) {
  S.step = n;
  for (var i = 1; i <= 6; i++) $('s' + i).hidden = i !== n;
  window.scrollTo({ top: 0 });
  if (n === 3 && ready() && !S.liq) runLiq();
  renderChrome();
  var m = { 1: '', 2: 'Выберите организации пакета, Консолидатора и сроки', 3: 'Кто готов к ликвидации и что для этого сделать', 4: 'Зачеты и уступки внутри группы', 5: 'Что делать с долгами перед внешними контрагентами', 6: 'Сверка с делом, выпуск документов и контроль подписания' };
  $('dockMsg').innerHTML = m[n] || '';
}

/* ---------- шаг 3: готовность ---------- */
function runLiq() {
  if (!S.merged || !S.reg) { $('lMsg').innerHTML = '<span class="bad">Загрузите выгрузки и реестр ЮЛ.</span>'; return; }
  try {
    if (!$('lq').value.trim()) fillLiqList();
    S.liqOpts = { threshold: num(P.lthr), shipThreshold: num(P.lship), assignExternal: P.lassign, balanceDate: S.merged.date || new Date(), startDate: Engine.parseDate(P.lstart), blockRe: String(P.lblock || '').trim(), contracts: S.contracts };
    S.liq = EngineLiq.analyze($('lq').value, S.merged, S.reg, S.req || { byInn: {}, orgs: [] }, S.liqOpts);
    renderLiq(); $('lMsg').textContent = ''; renderChrome();
  } catch (e) { $('lMsg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
}
function fillLiqList() {
  if (!S.reg) return;
  var rows = (S.reg.all || []).filter(function (r) { return P.lsts[(r.status || '').toLowerCase()]; });
  $('lq').value = rows.map(function (r) { return r.name + (r.inn ? ' ' + r.inn : ''); }).join('\n');
  $('lCount').textContent = '— ' + rows.length;
}
function renderLiq() {
  var rows = S.liq.rows, cnt = { 'Можно': 0, 'Условно готово': 0, 'Пауза': 0, 'Не готово': 0, 'Нет данных': 0 };
  rows.forEach(function (r) { cnt[r.verdict]++; });
  var k = function (cls, l, v, s, vc) { return '<div class="kpi ' + cls + '"><div class="l">' + l + '</div><div class="v ' + (vc || '') + '">' + v + '</div><div class="l">' + s + '</div></div>'; };
  $('lKpis').innerHTML = k('g', 'Можно в ликвидацию', cnt['Можно'], 'расчетов нет', 'ok') + k('g', 'Условно готово', cnt['Условно готово'], 'после пакетов текущей датой, без подписей вне группы', 'ok') +
    k('a', 'Пауза', cnt['Пауза'], 'исполнение контрактов не передается') + k('w', 'Не готово', cnt['Не готово'], 'блокеры — в колонке «Причина»', 'bad') + k('n', 'Нет данных', cnt['Нет данных'], 'нет книги в выгрузках или ИНН') +
    k('b', 'Остатки на', Engine.dateShort(S.liqOpts.balanceDate), 'выгрузок: ' + S.merged.files.length);
  var cls = { 'Можно': 'v-ok', 'Условно готово': 'v-ok', 'Пауза': 'v-na', 'Не готово': 'v-no', 'Нет данных': 'v-na' };
  var n0 = function (x, own) { return own ? M(x) : ''; };
  $('lRows').innerHTML = rows.map(function (r, i) {
    return '<tr class="lr" data-i="' + i + '"><td>' + r.n + '</td><td><b>' + esc(r.name) + '</b>' + (r.inn ? '<br><span class="hint">' + r.inn + ' · ' + esc(r.status || '—') + (r.gk ? ' · ГК: ' + esc(r.gk) : '') + '</span>' : '') +
      (r.ambiguous ? '<br><span class="tag w">по названию «' + esc(r.input) + '» — проверьте</span>' : '') + '</td><td><span class="verdict ' + cls[r.verdict] + '">' + (r.verdict === 'Можно' ? 'Можно в ликвидацию' : r.verdict) + '</span></td>' +
      '<td class="num">' + n0(r.vgoDz, r.own) + '</td><td class="num">' + n0(r.vgoKz, r.own) + '</td><td class="num">' + n0(r.extDz, r.own) + '</td><td class="num">' + n0(r.extKz, r.own) + '</td><td class="num">' + n0(r.ship, r.own) + '</td>' +
      '<td>' + esc(r.trend) + '</td><td>' + esc(r.why) + '</td><td>' + esc(r.todo) + '</td><td>' + esc(r.term) + '</td></tr>';
  }).join('') || '<tr><td colspan="12" class="muted">Список пуст.</td></tr>';
  [].forEach.call($('lRows').querySelectorAll('tr.lr'), function (tr) {
    tr.onclick = function () {
      var nx = tr.nextElementSibling; if (nx && nx.classList.contains('det')) { nx.remove(); return; }
      var r = rows[+tr.dataset.i];
      var L = r.lines.filter(function (l) { return Math.abs(l.close) >= 0.005; }).sort(function (a, b) { return Math.abs(b.close) - Math.abs(a.close); });
      var html = '<b>План мероприятий:</b><table style="margin:4px 0 10px">' + (r.plan || []).map(function (s, q) { return '<tr><td>' + (q + 1) + '</td><td>' + esc(s.stage) + '</td><td>' + esc(s.what) + '</td><td class="hint">' + esc(s.where) + '</td><td>' + esc(s.when) + '</td><td class="' + (s.state === 'блокер' ? 'bad' : 'hint') + '">' + esc(s.state) + '</td></tr>'; }).join('') + '</table>' +
        '<b>Своя книга' + (r.file ? ' (' + esc(r.file) + ')' : '') + ':</b> ' + (L.length ? '' : 'нет данных') + '<table style="margin:4px 0 8px">' +
        L.map(function (l) { return '<tr><td>' + (l.vgo ? 'ВГО' : 'внешн.') + '</td><td>' + esc(l.cp) + ' <span class="hint">' + esc(l.cpinn || '') + (l.cpstatus ? ' · ' + esc(l.cpstatus) : '') + '</span></td><td>' + l.acc + '</td><td class="num">' + M(l.open) + '</td><td class="num">' + M(l.close) + '</td></tr>'; }).join('') + '</table>' +
        '<b>В книгах группы за ним:</b> ' + (r.mirror.length ? '' : 'нет') + '<table style="margin-top:4px">' + r.mirror.filter(function (m) { return Math.abs(m.close) >= 0.005; }).map(function (m) { return '<tr><td>' + esc(m.org) + '</td><td>' + m.acc + '</td><td class="num">' + M(m.open) + '</td><td class="num">' + M(m.close) + '</td></tr>'; }).join('') + '</table>';
      tr.insertAdjacentHTML('afterend', '<tr class="det"><td></td><td colspan="11">' + html + '</td></tr>');
    };
  });
  $('lX').disabled = !rows.length; $('lGk').disabled = !(S.contracts && S.reg);
}
function wireLiq() {
  $('lRun').onclick = runLiq;
  $('lFill').onclick = function () { fillLiqList(); runLiq(); };
  $('lX').onclick = function () { save(EngineLiq.buildXlsx(S.liq, S.liqOpts), 'Готовность ЮЛ к ликвидации на ' + Engine.dateShort(S.liqOpts.balanceDate) + '.xlsx', XLSX_MIME); };
  $('lGk').onclick = function () {
    if (!S.contracts || !S.reg) { $('lMsg').innerHTML = '<span class="bad">Нужны реестр ЮЛ и таблица «Недогруз».</span>'; return; }
    try {
      var rep = EngineLiq.govReport(S.contracts, S.reg, S.req || { byInn: {}, orgs: [] }, { date: new Date() }), cnt = {}; rep.rows.forEach(function (r) { cnt[r.gk] = (cnt[r.gk] || 0) + 1; });
      save(EngineLiq.buildGkXlsx(rep), 'Госконтракты по реестру ' + Engine.dateShort(new Date()) + '.xlsx', XLSX_MIME);
      $('lMsg').innerHTML = 'Госконтракты: ' + Object.keys(cnt).map(function (k) { return k + ' — ' + cnt[k]; }).join(', ') + '. Колонки «Госконтракты» и «Комментарий» скопируйте в реестр ЮЛ по ИНН.' + (rep.unmatched.length ? ' <span class="bad">Не найдены в реестре: ' + rep.unmatched.map(function (u) { return esc(u.org); }).join(', ') + '.</span>' : '');
    } catch (e) { $('lMsg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }
  };
}

/* ---------- шаги 4 и 5: расчеты ---------- */
var STATE_TAG = { 'new': ['b', 'новый'], same: ['n', 'без изм.'], changed: ['a', 'изменился'], conflict: ['w', 'расхождение'], gone: ['n', 'исчез'], goneSigned: ['w', 'исчез'], out: ['n', 'вне расчета'], 'void': ['n', 'аннулирован'] };
function stateMap() { var m = {}; if (S.reco) S.reco.rows.forEach(function (w) { m[w.id] = w.state; }); return m; }
function numTag(num, key, sm, extra) {
  var st = sm[key], t = st ? STATE_TAG[st] : null;
  return '<span class="tag ' + (t ? t[0] : 'n') + '" title="' + (t ? t[1] : '') + '">' + esc(num) + (extra || '') + (t && st !== 'same' ? ' · ' + t[1] : '') + '</span>';
}
function shortName(n) { return String(n).replace(/\s*(ООО|АО|ЗАО|ПАО)\s*$/, '').replace(/[«»"]/g, ''); }
function tabsHtml(list, sel) { return list.map(function (r) { return '<button type="button" data-o="' + r.o + '" class="' + (r.o === sel ? 'on' : '') + '">' + esc(shortName(r.name)) + '</button>'; }).join(''); }
function kpi(cls, l, v, s) { return '<div class="kpi ' + cls + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="l">' + s + '</div></div>'; }
function orgSelectHtml(sel) {
  var list = S.req ? S.req.orgs.filter(function (x) { return x['ИНН']; }).sort(function (a, b) { return a['Полное наименование'].localeCompare(b['Полное наименование'], 'ru'); }) : [];
  return '<option value="">— нет реквизитов —</option>' + list.map(function (x) { return '<option value="' + x['ИНН'] + '"' + (x['ИНН'] === sel ? ' selected' : '') + '>' + esc(Engine.quotes(x['Полное наименование'])) + ' · ' + x['ИНН'] + '</option>'; }).join('');
}
function renderVgo() {
  var none = function (t) { $('vTabs').innerHTML = ''; $('vKpis').innerHTML = ''; $('vRows').innerHTML = '<tr><td colspan="9" class="muted">' + t + '</td></tr>'; $('vX').disabled = $('vA').disabled = true; };
  if (!S.group) return none(ready() ? 'Выберите организации пакета на шаге «Параметры».' : 'Загрузите выгрузки, реквизиты и реестр, выберите Консолидатора и организации пакета.');
  if (!S.group.some(function (r) { return r.opts.orgInn === S.vSel; })) S.vSel = S.group[0].opts.orgInn;
  $('vTabs').innerHTML = tabsHtml(S.group.map(function (r) { return { o: r.opts.orgInn, name: r.data.org.name }; }), S.vSel);
  var r = S.group.filter(function (x) { return x.opts.orgInn === S.vSel; })[0], DATA = r.data, PLAN = r.pl, sm = stateMap();
  var kz = PLAN.cessions.filter(function (x) { return x.dir === 'КЗ'; }).length, dz = PLAN.cessions.length - kz;
  var miss = PLAN.cessions.filter(function (x) { return !x.cp.org; }).length + PLAN.zachety.filter(function (z) { return !z.cp.org; }).length;
  var diff = DATA.list.filter(function (c) { return c.include && c.mirror && Math.abs(c.net - c.mirror.net) > 0.01; }).length;
  $('vKpis').innerHTML = kpi('', 'Документов', PLAN.zachety.length + PLAN.cessions.length + (PLAN.zc ? 1 : 0), 'зачетов ' + PLAN.zachety.length + ', уступок ' + PLAN.cessions.length + (PLAN.zc ? ', ' + PLAN.zcNum : '') + (miss ? ' · <b class="bad">без реквизитов: ' + miss + '</b>' : '')) +
    kpi('b', 'Кредиторы уступают долг организации (' + kz + ')', mln(PLAN.kzNominal), 'цена ' + mln(PLAN.kzPrice)) + kpi('b', 'Организация уступает дебиторку (' + dz + ')', mln(PLAN.dzNominal), PLAN.zc ? 'зачет ' + PLAN.zcNum + ' ' + mln(PLAN.zc) : 'оплата деньгами') +
    kpi('g', 'Зачеты до уступки', mln(PLAN.zachetTotal), 'соглашений: ' + PLAN.zachety.length) + kpi(diff ? 'w' : 'n', 'Долг перед Консолидатором', mln(PLAN.finalDebt), 'собственный после зачета ' + mln(PLAN.own.kz) + (diff ? ' · <b class="bad">расхождений с книгами: ' + diff + '</b>' : ''));
  var docs = {};
  PLAN.zachety.forEach(function (z) { (docs[z.cp.id] = docs[z.cp.id] || []).push(numTag(z.num, z.key, sm, ' зачет ' + M(z.amount)) + (z.external ? ' <span class="hint">(в пакете другой организации)</span>' : '')); });
  PLAN.cessions.forEach(function (x) { (docs[x.cp.id] = docs[x.cp.id] || []).push(numTag(x.num, x.key, sm, (x.dir === 'КЗ' ? ' уступает контрагент ' : ' уступает организация ') + M(x.nominal)) + (x.external ? ' <span class="hint">(в пакете другой организации)</span>' : '')); });
  var showAll = $('vAll').checked, q = $('vFlt').value.trim().toLowerCase();
  var list = DATA.list.filter(function (c) { return (showAll || c.include) && !(q && (c.name + ' ' + c.inn).toLowerCase().indexOf(q) < 0); }).sort(function (a, b) { return (b.include - a.include) || (Math.abs(b.net) - Math.abs(a.net)); });
  $('vRows').innerHTML = list.map(function (c) {
    var accs = c.obligations.map(function (o) { return '<div class="acc">' + o.acc + ' ' + esc(o.kind.label) + ': ' + M(o.amount) + '</div>'; }).join('') + (c.excludedAcc ? '<div class="acc hint">не долг: ' + esc(c.excludedAcc) + '</div>' : '');
    var mir = c.mirror ? M(c.mirror.net) + (Math.abs(c.net - c.mirror.net) > 0.01 ? '<br><span class="tag w">расхождение ' + M(c.net - c.mirror.net) + '</span>' : '<br><span class="tag g">сходится</span>') : '<span class="hint">нет книги</span>';
    var d = (docs[c.id] || []).join(' ');
    if (c.inn === P.cessInn && c.include) d += ' <span class="tag b">остаток — долг перед Консолидатором</span>';
    if (!c.include && c.reason) d = '<span class="tag a">' + esc(c.reason) + '</span>';
    return '<tr class="' + (c.include ? '' : 'off') + (c.org ? '' : ' miss') + '" data-id="' + c.id + '"><td><input type="checkbox" data-f="inc"' + (c.include ? ' checked' : '') + (c.obligations.length ? '' : ' disabled') + '></td>' +
      '<td>' + esc(c.name) + '</td><td>' + esc(c.inn) + '</td><td>' + esc(c.status || '—') + '</td><td>' + accs + '</td><td class="num">' + M(c.net) + '</td><td class="num">' + mir + '</td>' +
      '<td class="req">' + (c.include ? '<select data-f="org">' + orgSelectHtml(c.org ? c.org['ИНН'] : '') + '</select>' : esc(c.org ? Engine.quotes(c.org['Полное наименование']) : '')) + '</td><td>' + d + '</td></tr>';
  }).join('') || '<tr><td colspan="9" class="muted">Нет строк.</td></tr>';
  $('vX').disabled = !(PLAN.cessions.length || PLAN.zachety.length); $('vA').disabled = !S.group.some(function (x) { return x.pl.cessions.length || x.pl.zachety.length; });
  $('vMsg').innerHTML = DATA.orgReq ? '' : '<span class="bad">У организации нет реквизитов в файле реквизитов.</span>';
}
function wireVgo() {
  $('vTabs').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.vSel = b.dataset.o; renderVgo(); } };
  $('vAll').onchange = renderVgo; $('vFlt').oninput = renderVgo;
  $('vRows').onchange = function (e) {
    var el = e.target, f = el.dataset.f; if (!f) return;
    var r = S.group.filter(function (x) { return x.opts.orgInn === S.vSel; })[0], tr = el.closest('tr'), c = r.data.list.filter(function (x) { return x.id === tr.dataset.id; })[0], key = hk(S.vSel + ':' + c.inn + ':' + c.name);
    MANUAL[key] = MANUAL[key] || {};
    if (f === 'inc') MANUAL[key].include = el.checked;
    if (f === 'org') MANUAL[key].org = el.value;
    S.pickUser = {}; recomputeAll();
  };
  $('vX').onclick = function () { var r = S.group.filter(function (x) { return x.opts.orgInn === S.vSel; })[0]; save(Engine2.buildXlsx(r.pl, r.data, r.opts), 'Уступки ВГО ' + shortName(r.data.org.name) + ' на ' + Engine.dateShort(r.opts.date) + '.xlsx', XLSX_MIME); };
  $('vA').onclick = function () {
    var act = S.group.filter(function (x) { return x.pl.cessions.length || x.pl.zachety.length; });
    save(EngineAcc.buildAccountantXlsx(act), 'Бухгалтеру ' + act.map(function (x) { return shortName(x.data.org.name); }).join(' и ') + ' ' + Engine.dateShort(act[0].opts.date) + '.xlsx', XLSX_MIME);
    toast('Это полная сводка по всему расчету. Проводки только по выпускаемым документам — на шаге 6.', '', 6000);
  };
}
function renderExt() {
  var none = function (t) { $('xTabs').innerHTML = ''; $('xKpis').innerHTML = ''; $('xRows').innerHTML = '<tr><td colspan="7" class="muted">' + t + '</td></tr>'; $('xX').disabled = true; };
  if (!S.exts || !S.exts.length) return none(ready() ? 'Выберите получателя внешних долгов на шаге «Параметры».' : 'Загрузите выгрузки, реестр и реквизиты.');
  if (!S.exts.some(function (e) { return e.opts.orgInn === S.xSel; })) S.xSel = S.exts[0].opts.orgInn;
  $('xTabs').innerHTML = tabsHtml(S.exts.map(function (e) { return { o: e.opts.orgInn, name: e.org.name }; }), S.xSel);
  var e = S.exts.filter(function (x) { return x.opts.orgInn === S.xSel; })[0], sm = stateMap(), doc = {};
  e.pl.zachety.forEach(function (z) { (doc[z.cp.id] = doc[z.cp.id] || []).push(numTag(z.num, z.key, sm, ' зачет ' + M(z.amount))); });
  e.pl.cessions.forEach(function (x) { (doc[x.cp.id] = doc[x.cp.id] || []).push(numTag(x.num, x.key, sm, ' уступка + ' + x.notice + ' уведомление')); });
  e.pl.transfers.forEach(function (x) { (doc[x.cp.id] = doc[x.cp.id] || []).push(numTag(x.num, x.key, sm, ' перевод долга')); });
  $('xRows').innerHTML = e.data.list.map(function (c) {
    return '<tr class="' + (c.include ? '' : 'off') + '" data-id="' + c.id + '"><td><input type="checkbox"' + (c.include ? ' checked' : '') + '></td><td>' + esc(c.name) + '</td><td>' + esc(c.inn) + '</td><td>' +
      c.obligations.map(function (o) { return '<div class="acc">' + o.acc + ' ' + esc(o.kind.label) + ': ' + M(o.amount) + '</div>'; }).join('') + '</td><td class="num">' + M(c.net) + '</td><td>' + (doc[c.id] || []).join(' ') + '</td><td class="hint">' + esc(c.reason || (c.org ? '' : 'нет реквизитов — поля пустые')) + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="muted">Внешних долгов нет.</td></tr>';
  $('xKpis').innerHTML = kpi('g', 'Зачетов с внешними', e.pl.zachety.length, mln(e.pl.zachetTotal)) + kpi('b', 'Уступок дебиторки (+ уведомления)', e.pl.cessions.length, mln(e.pl.dzTotal)) + kpi('a', 'Переводов долга', e.pl.transfers.length, mln(e.pl.kzTotal));
  $('xX').disabled = !(e.pl.zachety.length + e.pl.cessions.length + e.pl.transfers.length); $('xMsg').textContent = '';
}
function wireExt() {
  $('xTabs').onclick = function (e) { var b = e.target.closest('button'); if (b) { S.xSel = b.dataset.o; renderExt(); } };
  $('xRows').onchange = function (ev) {
    var el = ev.target; if (el.type !== 'checkbox') return;
    var e = S.exts.filter(function (x) { return x.opts.orgInn === S.xSel; })[0], c = e.data.list.filter(function (x) { return x.id === el.closest('tr').dataset.id; })[0];
    XMAN[hk(S.xSel + ':' + c.inn + ':' + c.name)] = el.checked; S.pickUser = {}; recomputeAll();
  };
  $('xX').onclick = function () { var e = S.exts.filter(function (x) { return x.opts.orgInn === S.xSel; })[0]; save(EngineExt.buildXlsx(e.pl, e.data, e.opts), 'Внешние долги ' + shortName(e.org.name) + ' ' + Engine.dateShort(e.opts.date) + '.xlsx', XLSX_MIME); };
}

/* ---------- шаблоны ---------- */
var PARTY_F = ['Наименование', 'ИНН', 'КПП', 'Адрес', 'Город', 'Вводная', 'Должность', 'Должность.Р', 'ФИО', 'ФИО.Р', 'Подпись', 'Дательный', 'Реквизиты', 'МП', 'Банк', 'БИК', 'Расчетный счет', 'Корр.счет'];
var T_ROLES = { cession: ['Цедент', 'Цессионарий', 'Должник'], cessionExt: ['Цедент', 'Цессионарий', 'Должник'], notice: ['Цедент', 'Цессионарий', 'Должник'], zachet: ['Сторона 1', 'Сторона 2'], transfer: ['Кредитор', 'Первоначальный должник', 'Новый должник'] };
var T_DOC = {
  cession: ['Номер', 'Дата', 'Дата.Прописью', 'Город', 'Сумма', 'Сумма.Прописью', 'Цена', 'Цена.Прописью', 'Порядок расчетов', 'Дата баланса', 'Итого', 'п.№', 'п.Основание', 'п.Содержание', 'п.Сумма'],
  notice: ['Исх. №', 'Номер договора', 'Дата', 'Сумма', 'Сумма.Прописью', 'Итого', 'п.№', 'п.Основание', 'п.Содержание', 'п.Сумма'],
  zachet: ['Номер', 'Дата', 'Дата.Прописью', 'Город', 'Дата баланса', 'Сумма', 'Сумма.Прописью', 'Остаток.Сторона 1', 'Остаток.Сторона 2', 'Итого1', 'Итого2', 'п1.№', 'п1.Основание', 'п1.Содержание', 'п1.Сумма', 'п2.№', 'п2.Основание', 'п2.Содержание', 'п2.Сумма'],
  transfer: ['Номер', 'Дата', 'Дата.Прописью', 'Город', 'Дата баланса', 'Сумма', 'Сумма.Прописью', 'Порядок расчетов', 'Итого', 'п.№', 'п.Основание', 'п.Содержание', 'п.Сумма']
};
T_DOC.cessionExt = T_DOC.cession;
var T_NEED = { cession: ['Номер', 'п.Сумма', 'Порядок расчетов'], cessionExt: ['Номер', 'п.Сумма', 'Порядок расчетов'], notice: ['Номер договора', 'п.Сумма'], zachet: ['Номер', 'п1.Сумма', 'п2.Сумма'], transfer: ['Номер', 'п.Сумма', 'Порядок расчетов'] };
var T_FLAGS = ['АВАНС', 'ЗАЙМ', 'АДРЕС'];
async function tplText(bytes) {
  var z = await JSZip.loadAsync(bytes), xml = await z.file('word/document.xml').async('string');
  return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
async function validateTemplate(kind, bytes) {
  var text = await tplText(bytes), problems = [], seen = {}, open = 0;
  var allowed = {}; (T_DOC[kind] || []).forEach(function (t) { allowed[t] = 1; });
  (T_ROLES[kind] || []).forEach(function (r) { PARTY_F.forEach(function (f) { allowed[r + '.' + f] = 1; }); });
  var re = /\{\{([^{}]*)\}\}/g, m;
  while ((m = re.exec(text))) {
    var name = m[1].replace(/\s+/g, ' ').trim(); seen[name] = 1;
    var c = name.match(/^если\s+(НЕ\s+)?(.+)$/i);
    if (c) { open++; if (T_FLAGS.indexOf(c[2].trim().toUpperCase()) < 0) problems.push('условие «' + name + '» неизвестно — блок будет скрыт'); continue; }
    if (/^\/если$/i.test(name)) { open--; continue; }
    if (!allowed[name]) problems.push('метка {{' + name + '}} неизвестна — в документе останется «______»');
  }
  if (open !== 0) problems.push('не сходятся {{если …}} и {{/если}}');
  (T_NEED[kind] || []).forEach(function (n) { if (!seen[n]) problems.push('в шаблоне нет метки {{' + n + '}}'); });
  return problems.filter(function (p, i, a) { return a.indexOf(p) === i; });
}
function idb() {   // IndexedDB может быть недоступна (приватный режим, запрет) — тогда шаблоны живут до закрытия вкладки
  return new Promise(function (res) {
    var t = setTimeout(function () { res(null); }, 2000);
    try { var rq = indexedDB.open('master-tpl', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('tpl', { keyPath: 'kind' }); }; rq.onsuccess = function () { clearTimeout(t); res(rq.result); }; rq.onerror = function () { clearTimeout(t); res(null); }; } catch (e) { clearTimeout(t); res(null); }
  });
}
async function tplPersist(kind, rec) {
  var db = await idb(); if (!db) return;
  await new Promise(function (res) { var tx = db.transaction('tpl', 'readwrite'), st = tx.objectStore('tpl'); if (rec) st.put(Object.assign({ kind: kind }, rec)); else st.delete(kind); tx.oncomplete = res; tx.onerror = res; });
}
async function tplRestore() {
  var db = await idb(); if (!db) return;
  await new Promise(function (res) {
    var rq = db.transaction('tpl').objectStore('tpl').getAll();
    rq.onsuccess = function () { (rq.result || []).forEach(function (r) { S.tpl[r.kind] = { name: r.name, bytes: new Uint8Array(r.bytes), hash: r.hash, ts: r.ts, problems: r.problems || [] }; }); res(); };
    rq.onerror = res;
  });
}
// отпечаток шаблона — по содержимому частей документа (текст и разметка), а не по байтам файла: пересохранение без правок отпечаток не меняет
async function contentHash(bytes) {
  var z = await JSZip.loadAsync(bytes), names = Object.keys(z.files).filter(function (n) { return /^word\/(document|header\d*|footer\d*|styles)\.xml$/.test(n); }).sort(), txt = '';
  for (var i = 0; i < names.length; i++) txt += names[i] + '\n' + await z.file(names[i]).async('string') + '\n';
  var b = new TextEncoder().encode(txt); return hashBytes(b);
}
function hashBytes(b) {
  var a = 0x811c9dc5, c = 0x9747b28c, h = function (x) { return ('00000000' + x.toString(16)).slice(-8); };
  for (var i = 0; i < b.length; i++) { a ^= b[i]; a = Math.imul(a, 16777619) >>> 0; c ^= (b[i] + i) & 0xffff; c = Math.imul(c, 2246822519) >>> 0; c ^= c >>> 13; }
  return h(a) + h(c);
}
async function addTemplate(name, bytes) {
  var kind = await EngineTpl.detect(name, bytes);
  if (!kind) { toast('Не удалось определить вид шаблона «' + name + '». Начните имя файла с номера: 1 — уступка (внутри группы), 2 — уступка (внешний должник), 3 — уведомление, 4 — зачет, 5 — перевод долга.', 'bad', 8000); return; }
  var problems = []; try { problems = await validateTemplate(kind, bytes); } catch (e) { toast('Файл «' + name + '» не похож на документ Word: ' + e.message, 'bad'); return; }
  var rec = { name: name, bytes: bytes, hash: await contentHash(bytes), ts: Date.now(), problems: problems };
  S.tpl[kind] = rec; tplPersist(kind, rec);
  toast('Шаблон «' + EngineTpl.KINDS[kind].file.replace(/\.docx$/, '') + '» обновлен' + (problems.length ? ' — есть замечания' : ''), problems.length ? '' : 'ok');
  renderTplPanel(); recomputeAll();
}
function tplDriftNote(kind) {
  var was = S.case.templates && S.case.templates[kind], cur = S.tpl[kind];
  if (!was) return '';
  if (!cur) return was.hash ? '<div class="small" style="color:var(--warn)">В деле зафиксирован загруженный шаблон «' + esc(was.name) + '», сейчас используется встроенный.</div>' : '';
  return was.hash !== cur.hash ? '<div class="small" style="color:var(--warn)">В деле зафиксирован другой файл («' + esc(was.name) + '») — выпущенные по нему документы будут помечены как устаревшие по шаблону.</div>' : '';
}
function renderTplPanel() {
  $('tplList').innerHTML = Object.keys(EngineTpl.KINDS).map(function (kind) {
    var k = EngineTpl.KINDS[kind], t = S.tpl[kind];
    return '<div class="tplrow" data-k="' + kind + '"><div class="top2"><div><div class="nm">' + esc(k.file.replace(/\.docx$/, '')) + '</div><div class="muted small">' + esc(k.title) + '</div></div>' +
      '<span class="tag ' + (t ? 'g' : 'n') + '">' + (t ? 'свой файл' : 'встроенный') + '</span></div>' +
      '<div class="st muted">' + (t ? esc(t.name) + ' · ' + new Date(t.ts).toLocaleString('ru-RU') + ' · отпечаток ' + t.hash.slice(0, 6) : 'используется встроенный текст') + '</div>' + tplDriftNote(kind) +
      (t && t.problems && t.problems.length ? '<div class="problems">' + t.problems.map(esc).map(function (p) { return '<div>⚠ ' + p + '</div>'; }).join('') + '</div>' : (t ? '<div class="small ok" style="margin-top:6px">✔ метки в порядке</div>' : '')) +
      '<div class="acts"><label class="btn ghost small filebtn">Загрузить .docx<input type="file" accept=".docx" data-up="' + kind + '" hidden></label><button class="btn ghost small" data-act="def" type="button">Скачать образец</button><button class="btn ghost small" data-act="sample" type="button">Пример на демо-данных</button>' + (t ? '<button class="btn ghost small" data-act="reset" type="button">Вернуть встроенный</button>' : '') + '</div></div>';
  }).join('');
  $('tplHelp').innerHTML = EngineTpl.TOKEN_HELP.map(function (h) { return '<p><b>' + esc(h[0]) + '</b><br><code style="white-space:normal;word-break:break-word">' + esc(h[1]) + '</code></p>'; }).join('');
}
async function sampleDoc(kind) {
  var d = EngineTest.dataset(), K = '1000000009', A = '1000000001', B = '1000000002', st = { 'транзит': 1, 'обнуляем': 1, 'обнуляем приоритет': 1 }, dt = new Date(), pay = addDays(dt, 60), templates = tplBytes(), pk;
  if (kind === 'zachet' || kind === 'cession') {
    var res = Engine2.runGroup(d.merged, d.req, d.reg, { statuses: st, cessionary: d.req.byInn[K], date: dt, payDate: pay, payDzByOffset: true }, [{ inn: A, prefix: 'А' }, { inn: B, prefix: 'Б' }]);
    pk = await Engine2.buildPackage(res[0].pl, res[0].data, Object.assign({}, res[0].opts, { templates: templates }));
  } else {
    var xo = { orgInn: A, recipient: d.req.byInn[K], date: dt, payDate: pay, threshold: 1, payByOffset: false, prefix: 'В', templates: templates };
    var data = EngineExt.prepare(d.merged, d.req, d.reg, xo); pk = await EngineExt.buildPackage(EngineExt.plan(data, xo), data, xo);
  }
  var doc = pk.docs.filter(function (x) { return x.kind === kind; })[0];
  if (!doc) throw new Error('на демо-данных нет документа такого вида');
  return { name: 'Пример ' + EngineTpl.KINDS[kind].title.split(' — ')[0] + '.docx', bytes: await pk.zip.file(doc.path).async('uint8array'), warnings: pk.warnings };
}
function wireTemplates() {
  var open = function (id, on) { $(id).hidden = !on; $('scrim').hidden = !($('tplPanel').hidden === false || $('helpPanel').hidden === false); };
  $('btnTpl').onclick = function () { renderTplPanel(); open('tplPanel', true); };
  $('tplClose').onclick = function () { open('tplPanel', false); };
  $('btnHelp').onclick = function () { if (!$('hView').innerHTML) $('hView').innerHTML = mdToHtml($('project-docs').textContent.trim()); open('helpPanel', true); };
  $('helpClose').onclick = function () { open('helpPanel', false); };
  $('scrim').onclick = function () { open('tplPanel', false); open('helpPanel', false); };
  var dz = $('tplDrop'); dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); };
  dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); [].slice.call(e.dataTransfer.files).filter(function (f) { return /\.docx$/i.test(f.name); }).forEach(function (f) { f.arrayBuffer().then(function (b) { addTemplate(f.name, new Uint8Array(b)); }); }); };
  dz.onclick = function () { $('tplPick').click(); };
  $('tplPick').onchange = function () { var fs = [].slice.call(this.files); this.value = ''; fs.forEach(function (f) { f.arrayBuffer().then(function (b) { addTemplate(f.name, new Uint8Array(b)); }); }); };
  $('tplList').onchange = function (e) { var el = e.target; if (el.dataset.up && el.files[0]) { var f = el.files[0]; f.arrayBuffer().then(function (b) { var bytes = new Uint8Array(b); EngineTpl.detect(f.name, bytes).then(function (k) { addTemplate(k === el.dataset.up ? f.name : (el.dataset.up === 'cession' ? '1 ' : el.dataset.up === 'cessionExt' ? '2 ' : el.dataset.up === 'notice' ? '3 ' : el.dataset.up === 'zachet' ? '4 ' : '5 ') + f.name, bytes); }); }); } };
  $('tplList').onclick = async function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return; var kind = b.closest('.tplrow').dataset.k;
    try {
      if (b.dataset.act === 'def') { var d = await EngineTpl.defaults()[kind]; save(new Blob([d], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), EngineTpl.KINDS[kind].file, ''); }
      if (b.dataset.act === 'sample') { var s = await sampleDoc(kind); save(new Blob([s.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), s.name, ''); if (s.warnings.length) toast(s.warnings[0], '', 7000); }
      if (b.dataset.act === 'reset') { delete S.tpl[kind]; await tplPersist(kind, null); renderTplPanel(); recomputeAll(); }
    } catch (err) { toast('Ошибка: ' + err.message, 'bad'); }
  };
  $('tplAll').onclick = async function () {
    var zip = new JSZip(), defs = EngineTpl.defaults();
    for (var k in EngineTpl.KINDS) zip.file(EngineTpl.KINDS[k].file, await defs[k]);
    save(await zip.generateAsync({ type: 'blob' }), 'Образцы шаблонов договоров.zip', 'application/zip');
  };
}
