/* ===== Часть C: шаг 6 — выпуск и контроль подписания, справка, запуск ===== */
var FILTERS = [['all', 'Все'], ['new', 'Новые'], ['changed', 'Изменились'], ['conflict', 'Нужно решение'], ['same', 'Без изменений'], ['gone', 'Исчезли'], ['out', 'Вне расчета'], ['void', 'Аннулированы']];
var ORDER = { conflict: 0, goneSigned: 1, changed: 2, 'new': 3, gone: 4, same: 5, out: 6, 'void': 7 };
var SEL_CLASS = { 'подготовлен': '', 'на подписи': 's-на-подписи', 'подписан': 's-подписан', 'аннулирован': 's-аннулирован' };
function passFilter(w) {
  var f = S.filter;
  if (f === 'conflict') { if (w.state !== 'conflict' && w.state !== 'goneSigned') return false; }
  else if (f === 'gone') { if (w.state !== 'gone' && w.state !== 'goneSigned') return false; }
  else if (f !== 'all' && w.state !== f) return false;
  if (S.flt) { var src = w.op || w.rec, t = (src.num + ' ' + src.counterparty + ' ' + src.orgName + ' ' + src.title).toLowerCase(); if (t.indexOf(S.flt) < 0) return false; }
  return true;
}
function rowHtml(w) {
  var src = w.op || w.rec, rec = w.rec, t = STATE_TAG[w.state], sel = '';
  var chk = w.op && (w.state === 'new' || w.state === 'changed' || w.state === 'same') ? '<input type="checkbox" data-pick="' + esc(w.id) + '"' + (S.pick[w.id] ? ' checked' : '') + ' title="Включить в выпуск">' : '';
  var why = w.reasons.map(function (r) { return '<div>' + esc(r) + '</div>'; }).join('') + w.notes.map(function (r) { return '<div class="muted">' + esc(r) + '</div>'; }).join('');
  var act = '';
  if (w.state === 'conflict') act = '<div class="act"><button class="btn small ghost" data-act="accept" data-k="' + esc(w.id) + '" type="button" title="Документ остается в силе, расхождение запоминается">Принять как есть</button><button class="btn small" data-act="replace" data-k="' + esc(w.id) + '" type="button" title="Старый документ аннулируется, выпускается новый с новым номером">Заменить новым документом</button></div>';
  if (w.state === 'gone') act = '<div class="act"><button class="btn small" data-act="void" data-k="' + esc(w.id) + '" type="button">Аннулировать (не подписывать)</button><button class="btn small ghost" data-act="keep" data-k="' + esc(w.id) + '" type="button">Оставить</button></div>';
  if (w.state === 'goneSigned') act = '<div class="act"><button class="btn small ghost" data-act="keep" data-k="' + esc(w.id) + '" type="button">Оставить в силе</button><button class="btn small" data-act="void" data-k="' + esc(w.id) + '" type="button" title="Для подписанного документа нужен документ о расторжении — шаблона для него нет">Отметить аннулированным</button></div>';
  if (rec && rec.status === 'аннулирован') sel = '<span class="tag n">аннулирован</span>' + (rec.voidDate ? '<div class="hint">' + esc(rec.voidDate) + '</div>' : '');
  else if (rec) sel = '<select class="stsel ' + (SEL_CLASS[rec.status] || '') + '" data-st="' + esc(rec.key) + '">' + Case.STATUSES.map(function (s) { return '<option' + (s === rec.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
    (rec.signedDate && rec.status === 'подписан' ? '<div class="hint">' + esc(rec.signedDate) + '</div>' : '') + (rec.sentDate && rec.status === 'на подписи' ? '<div class="hint">с ' + esc(rec.sentDate) + '</div>' : '');
  else sel = '<span class="muted small">не выпущен</span>';
  var hist = rec ? (rec.history || []).slice(-4).map(function (h) { return '<div>' + esc(h.ts.slice(0, 16).replace('T', ' ')) + ' — ' + esc(h.text) + '</div>'; }).join('') : '';
  var dtl = '<div class="dtl" id="d_' + esc(w.id).replace(/[^\w]/g, '_') + '">' +
    (src.parties || []).map(function (p) { return '<div><b>' + esc(p.role) + ':</b> ' + esc(p.name) + (p.inn ? ' · ИНН ' + esc(p.inn) : '') + (p.reqFp === 'нет' ? ' <b class="bad">— нет реквизитов</b>' : '') + '</div>'; }).join('') +
    (src.detail || []).map(function (x) { return '<div>• ' + esc(x) + '</div>'; }).join('') + (src.payText ? '<div>Цена: ' + esc(src.payText) + '</div>' : '') +
    (rec ? '<div>Редакция ' + rec.rev + (rec.docDate ? ' · документ от ' + esc(rec.docDate) : '') + (rec.replaces ? ' · заменяет ' + esc(rec.replaces) : '') + '</div>' : '') + (hist ? '<div style="margin-top:4px"><b>История:</b></div>' + hist : '') + '</div>';
  var amt = w.op ? M(w.op.amount) : M(rec.amount);
  return '<tr class="st-' + w.state + '" data-k="' + esc(w.id) + '"><td>' + chk + '</td><td class="docnum">' + esc(src.num) + (rec && rec.rev > 1 ? ' <small>ред. ' + rec.rev + (w.state === 'changed' ? ' → ' + (rec.rev + 1) : '') + '</small>' : (w.state === 'changed' ? ' <small>→ ред. 2</small>' : '')) + '<br><small>' + esc(src.family) + '</small></td>' +
    '<td><b>' + esc(src.title) + '</b><br><span class="hint">' + esc(shortName(src.orgName)) + ' ↔ ' + esc(src.counterparty) + '</span> <a href="#" class="more hint" data-more="' + esc(w.id) + '">детали</a>' + dtl + '</td>' +
    '<td class="num">' + amt + (w.op && rec && w.op.amount !== rec.amount ? '<br><span class="hint">было ' + M(rec.amount) + '</span>' : '') + '</td><td><span class="tag ' + t[0] + '">' + ({ 'new': 'Новый', same: 'Без изменений', changed: 'Изменился', conflict: 'Расхождение', gone: 'Исчез', goneSigned: 'Исчез, подписан', out: 'Вне расчета', 'void': 'Аннулирован' })[w.state] + '</span></td>' +
    '<td class="why">' + (why || '<span class="muted">—</span>') + act + '</td><td>' + sel + '</td></tr>';
}
function renderRelease() {
  var sm = Case.summary(S.case);
  $('flow').innerHTML = '<span>подготовлено ' + (sm['подготовлен'] || 0) + '</span><em>→</em><span>на подписи ' + (sm['на подписи'] || 0) + '</span><em>→</em><span class="on">подписано ' + (sm['подписан'] || 0) + '</span>';
  $('histCard').hidden = !S.case.issues.length;
  $('hist').className = 'hist'; $('hist').innerHTML = S.case.issues.slice().reverse().map(function (i) { return '<div><b>Выпуск №' + i.n + '</b> <small>' + esc(i.ts.slice(0, 16).replace('T', ' ')) + ' · документы от ' + esc(i.docDate || '—') + '</small> — новых ' + i.created + ', перевыпущено ' + i.reissued + (i.repeated ? ', повторно ' + i.repeated : '') + '<br><small>' + esc(i.nums.join(', ')) + '</small></div>'; }).join('');
  if (!S.reco) {
    $('rKpis').innerHTML = ''; $('rFilter').innerHTML = ''; $('rRows').innerHTML = '<tr><td colspan="7" class="muted">Нет данных для сверки: загрузите данные, выберите Консолидатора и организации пакета. Если загружено дело — его реестр появится здесь.</td></tr>';
    $('rIssue').disabled = true; $('rAcc').disabled = true; $('issueSum').textContent = 'Нет расчета.'; $('issueWarn').hidden = true; return;
  }
  var c = S.reco.counts;
  $('rKpis').innerHTML = kpi('b', 'Новые', c['new'], 'будут созданы с новыми номерами') + kpi('a', 'Изменились', c.changed, 'перевыпуск: тот же номер, новая редакция') + kpi(c.conflict + c.goneSigned ? 'w' : 'n', 'Расхождение с подписанным', c.conflict + c.goneSigned, 'нужно ваше решение') + kpi('n', 'Без изменений', c.same, 'остаются как есть') + kpi('n', 'Исчезли', c.gone, 'по данным больше не нужны');
  var cnt = { all: S.reco.rows.length, 'new': c['new'], changed: c.changed, conflict: c.conflict + c.goneSigned, same: c.same, gone: c.gone + c.goneSigned, out: c.out, 'void': c['void'] };
  $('rFilter').innerHTML = FILTERS.filter(function (f) { return cnt[f[0]] || f[0] === 'all' || f[0] === S.filter; }).map(function (f) { return '<label><input type="radio" name="rf" value="' + f[0] + '"' + (S.filter === f[0] ? ' checked' : '') + '> ' + f[1] + ' ' + cnt[f[0]] + '</label>'; }).join('');
  var rows = S.reco.rows.filter(passFilter).sort(function (a, b) { return (ORDER[a.state] - ORDER[b.state]) || String((a.op || a.rec).num).localeCompare(String((b.op || b.rec).num), 'ru', { numeric: true }); });
  $('rRows').innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="7" class="muted">' + (S.reco.rows.length ? 'Нет документов по выбранному фильтру.' : 'По текущим данным документов нет.') + '</td></tr>';
  updateIssue();
}
function prefixDup() {
  var seen = {}, dup = {}; pkgInns().forEach(function (i) { var p = prefixOf(i); if (seen[p]) dup[p] = 1; seen[p] = 1; });
  return Object.keys(dup);
}
function preflight(picks) {
  var w = [], noReq = {};
  var pd = prefixDup(); if (pd.length) w.push('БЛОКЕР: у нескольких организаций пакета одинаковый префикс (' + pd.join(', ') + ') — номера документов пересекутся. Измените префикс на шаге «Параметры».');
  picks.forEach(function (x) { x.op.parties.forEach(function (p) { if (p.reqFp === 'нет') noReq[p.name || p.inn] = 1; }); });
  if (Object.keys(noReq).length) w.push('Нет реквизитов у: ' + Object.keys(noReq).join(', ') + ' — поля в документах останутся пустыми.');
  var open = S.reco.counts.conflict + S.reco.counts.goneSigned;
  if (open) w.push('Не решено расхождений с подписанным: ' + open + '. Эти документы в выпуск не попадут.');
  var used = {}; picks.forEach(function (x) { x.op.kinds.forEach(function (k) { used[k] = 1; }); });
  Object.keys(used).forEach(function (k) { if (S.tpl[k] && S.tpl[k].problems && S.tpl[k].problems.length) w.push('Шаблон «' + EngineTpl.KINDS[k].file.replace(/\.docx$/, '') + '» с замечаниями: ' + S.tpl[k].problems[0] + (S.tpl[k].problems.length > 1 ? ' (+' + (S.tpl[k].problems.length - 1) + ')' : '')); });
  var ds = {}; picks.forEach(function (x) { ds[dateOfRow(x)] = 1; });
  if (Object.keys(ds).length > 1) w.push('Документы будут датированы по-разному: ' + Object.keys(ds).sort().map(function (d) { return Engine.dateShort(Engine.parseDate(d)); }).join(', ') + ' — перевыпуск сохраняет дату прежней редакции (можно отключить в параметрах).');
  var zc = picks.filter(function (x) { return x.op.type === 'зц'; })[0];
  if (zc && picks.some(function (x) { return x.op.type !== 'зц' && x.op.family === 'ВГО' && dateOfRow(x) !== dateOfRow(zc); })) w.push('Соглашение о зачете цены датировано иначе, чем договоры уступки, на которые оно ссылается.');
  return w;
}
function dateOfRow(w) { return P.keepDates && w.rec && w.rec.docDate && w.state !== 'new' ? w.rec.docDate : (w.op.family === 'Внешние' ? P.xdate : P.date); }
function updateIssue() {
  var picks = S.reco.rows.filter(function (w) { return w.op && S.pick[w.id]; });
  var nNew = picks.filter(function (w) { return w.state === 'new'; }).length, nCh = picks.filter(function (w) { return w.state === 'changed'; }).length, nRe = picks.length - nNew - nCh;
  var n = (S.case.issues.length ? S.case.issues[S.case.issues.length - 1].n : 0) + 1;
  $('issueSum').innerHTML = picks.length ? 'Выпуск №<b>' + n + '</b>: новых <b>' + nNew + '</b>, перевыпуск <b>' + nCh + '</b>' + (nRe ? ', повторно <b>' + nRe + '</b>' : '') + ' · на сумму ' + M(picks.reduce(function (t, w) { return t + w.op.amount; }, 0)) : 'Отметьте документы в таблице — сюда попадет то, что нужно отправить на подпись.';
  $('rIssue').disabled = !picks.length || prefixDup().length; $('rIssue').textContent = picks.length ? 'Собрать выпуск №' + n + ' (zip)' : 'Собрать выпуск (zip)';
  var w = preflight(picks); $('issueWarn').hidden = !w.length; $('issueWarn').innerHTML = w.map(function (x) { return '<div>⚠ ' + esc(x) + '</div>'; }).join('');
  $('rAcc').disabled = !picks.some(function (x) { return x.op.family === 'ВГО'; });
}

async function issue() {
  var picks = S.reco.rows.filter(function (w) { return w.op && S.pick[w.id]; });
  if (!picks.length) return;
  var btn = $('rIssue'); btn.disabled = true; btn.textContent = 'Собираю документы…';
  try {
    var n = (S.case.issues.length ? S.case.issues[S.case.issues.length - 1].n : 0) + 1, root = 'Выпуск ' + n + ' от ' + Engine.dateShort(new Date());
    var revOf = {}, opByNum = {}, templates = tplBytes(), warn = [], byCp = $('rByCp').checked, zip = new JSZip();
    picks.forEach(function (w) { revOf[w.op.num] = w.state === 'changed' ? (w.rec.rev || 1) + 1 : (w.rec ? w.rec.rev || 1 : 1); opByNum[w.op.num] = w.op; });
    var dates = []; picks.forEach(function (w) { var d = dateOfRow(w); if (dates.indexOf(d) < 0) dates.push(d); });
    var collect = async function (pk, orgName) {
      for (var i = 0; i < pk.docs.length; i++) {
        var d = pk.docs[i], op = opByNum[d.num], bytes = await pk.zip.file(d.path).async('uint8array'), parts = d.path.split('/'), base = parts.pop();
        var dir = byCp ? Engine.safeName(op.counterparty || 'без контрагента') : parts.join('/');
        zip.file(root + '/Документы на подпись/' + Engine.safeName(shortName(orgName)) + '/' + dir + '/' + base, bytes);
      }
      pk.warnings.forEach(function (x) { if (warn.indexOf(x) < 0) warn.push(x); });
    };
    for (var di = 0; di < dates.length; di++) {
      var dt = Engine.parseDate(dates[di]), only = {};
      picks.forEach(function (w) { if (dateOfRow(w) === dates[di]) only[w.op.num] = true; });
      var common = { date: dt, templates: templates, only: only, revOf: function (x) { return revOf[x] || 1; } };
      for (var g = 0; g < S.group.length; g++) await collect(await Engine2.buildPackage(S.group[g].pl, S.group[g].data, Object.assign({}, S.group[g].opts, common)), S.group[g].data.org.name);
      for (var x = 0; x < S.exts.length; x++) await collect(await EngineExt.buildPackage(S.exts[x].pl, S.exts[x].data, Object.assign({}, S.exts[x].opts, common)), S.exts[x].org.name);
    }
    // бухгалтеру — проводки только по выпускаемым документам ВГО
    var vgo = picks.filter(function (w) { return w.op.family === 'ВГО'; }), accOnly = {}, notes = {};
    vgo.forEach(function (w) { accOnly[w.op.num] = true; if (w.state === 'changed') notes[w.op.num] = 'перевыпуск, ред. ' + revOf[w.op.num] + ': если прежняя редакция уже проведена — сторнировать и провести заново'; });
    var memo = memoText(n, picks, revOf, warn);
    var reco = S.reco;
    Case.commit(S.case, reco, { pick: S.pick, dateOf: function (w) { return Engine.parseDate(dateOfRow(w)); }, docDate: Engine.parseDate(P.date), payDate: Engine.parseDate(P.payDate), orgInns: pkgInns() });
    zip.file(root + '/Реестр документов.xlsx', Case.buildRegistryXlsx(S.case, reco));
    if (vgo.length) zip.file(root + '/Бухгалтеру — проводки по выпуску ' + n + '.xlsx', EngineAcc.buildAccountantXlsx(S.group.filter(function (r) { return r.pl.cessions.length || r.pl.zachety.length; }), { only: accOnly, notes: notes }));
    zip.file(root + '/Памятка по выпуску.txt', memo);
    var cj = JSON.stringify(caseJson(), null, 1); zip.file(root + '/' + caseFileName(), cj);
    save(await zip.generateAsync({ type: 'blob' }), root + '.zip', 'application/zip');
    markDirty(true); S.pickUser = {};
    toast('Выпуск №' + n + ' собран: документов ' + picks.length + '. Файл дела обновлен — сохраните его.', 'ok', 7000);
    S.lastIssue = n; recomputeAll();
  } catch (e) { console.error(e); toast('Не удалось собрать выпуск: ' + e.message, 'bad', 9000); }
  btn.disabled = false; updateIssue();
}
function memoText(n, picks, revOf, warn) {
  var L = ['ВЫПУСК №' + n + ' от ' + Engine.dateShort(new Date()), ''], by = function (st) { return picks.filter(function (w) { return w.state === st; }); };
  var line = function (w) { return '  • ' + w.op.num + (revOf[w.op.num] > 1 ? ' (ред. ' + revOf[w.op.num] + ')' : '') + ' — ' + w.op.title + ': ' + shortName(w.op.orgName) + ' ↔ ' + w.op.counterparty + ', ' + M(w.op.amount) + ' руб.'; };
  if (by('new').length) { L.push('НОВЫЕ — отправить на подпись:'); by('new').forEach(function (w) { L.push(line(w)); }); L.push(''); }
  if (by('changed').length) {
    L.push('ПЕРЕВЫПУЩЕНЫ — прежнюю редакцию не подписывать, у контрагентов отозвать и заменить новой:');
    by('changed').forEach(function (w) { L.push(line(w)); w.reasons.forEach(function (r) { L.push('      – ' + r); }); }); L.push('');
  }
  if (by('same').length) { L.push('ВЫГРУЖЕНЫ ПОВТОРНО (без изменений):'); by('same').forEach(function (w) { L.push(line(w)); }); L.push(''); }
  if (warn.length) { L.push('ЗАМЕЧАНИЯ:'); warn.forEach(function (x) { L.push('  • ' + x); }); L.push(''); }
  L.push('Статусы документов ведите в «Мастере» (шаг 6) и сохраняйте файл дела после каждого изменения.');
  return L.join('\r\n');
}

function wireRelease() {
  $('rFilter').onchange = function (e) { if (e.target.name === 'rf') { S.filter = e.target.value; renderRelease(); } };
  $('rFlt').oninput = function () { S.flt = this.value.trim().toLowerCase(); renderRelease(); };
  $('rRows').onchange = function (e) {
    var el = e.target;
    if (el.dataset.pick !== undefined) { S.pickUser[el.dataset.pick] = el.checked; S.pick[el.dataset.pick] = el.checked; updateIssue(); }
    if (el.dataset.st) { Case.setStatus(S.case, el.dataset.st, el.value); markDirty(true); recomputeAll(); }
  };
  $('rRows').onclick = function (e) {
    var more = e.target.closest('[data-more]');
    if (more) { e.preventDefault(); var d = more.parentNode.querySelector('.dtl'); d.classList.toggle('on'); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var k = b.dataset.k, w = S.reco.rows.filter(function (x) { return x.id === k; })[0], a = b.dataset.act;
    if (a === 'accept') Case.accept(S.case, k, w.op.fp);
    if (a === 'replace') { if (!confirm('Подписанный документ ' + w.rec.num + ' будет помечен аннулированным, а вместо него выпущен новый документ с новым номером.\n\nДля юридического прекращения подписанного документа может понадобиться отдельное соглашение (шаблона для него нет). Продолжить?')) return; Case.voidDoc(S.case, k, 'заменяется: данные изменились после подписания', true); }
    if (a === 'void') { if (w.state === 'goneSigned' && !confirm('Документ ' + w.rec.num + ' подписан. Пометить аннулированным? Для расторжения может понадобиться отдельный документ.')) return; Case.voidDoc(S.case, k, 'документ больше не нужен по данным'); }
    if (a === 'keep') Case.ackGone(S.case, k);
    markDirty(true); S.pickUser = {}; recomputeAll();
  };
  $('rIssue').onclick = issue;
  $('rReg').onclick = function () { save(Case.buildRegistryXlsx(S.case, S.reco), 'Реестр документов ' + Engine.dateShort(new Date()) + '.xlsx', XLSX_MIME); };
  $('rSave').onclick = saveCase; $('btnSaveCase').onclick = saveCase;
  $('rAcc').onclick = function () {
    var picks = S.reco.rows.filter(function (w) { return w.op && S.pick[w.id] && w.op.family === 'ВГО'; }), only = {}, notes = {};
    picks.forEach(function (w) { only[w.op.num] = true; if (w.state === 'changed') notes[w.op.num] = 'перевыпуск, ред. ' + ((w.rec.rev || 1) + 1) + ': если прежняя редакция уже проведена — сторнировать'; });
    save(EngineAcc.buildAccountantXlsx(S.group.filter(function (r) { return r.pl.cessions.length || r.pl.zachety.length; }), { only: only, notes: notes }), 'Бухгалтеру — проводки по отмеченным документам.xlsx', XLSX_MIME);
  };
  $('caseName').onclick = function () { var v = prompt('Название дела (попадет в имя файла):', S.case.name || ''); if (v !== null) { S.case.name = v.trim(); markDirty(true); renderCase(); } };
  $('caseFile').onchange = function () { var f = this.files[0]; if (f) ingestFiles([f]); this.value = ''; };
  $('btnNewCase').onclick = newCase;
  $('cBackup').onchange = function () { try { if (this.checked) { backup(); } else localStorage.removeItem('master-case-backup'); } catch (e) { } };
}

/* ---------- справка ---------- */
function mdToHtml(md) {
  var e = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var inline = function (t) { return e(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); };
  var lines = md.split(/\r?\n/), out = [], i = 0;
  while (i < lines.length) {
    var l = lines[i];
    if (/^```/.test(l)) { var code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push('<pre>' + e(code.join('\n')) + '</pre>'); continue; }
    var h = l.match(/^(#{1,4})\s+(.*)/); if (h) { out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
    if (/^\|/.test(l)) {
      var rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      var cells = function (r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
      var body = rows.filter(function (r, k) { return k !== 1 || !/^\|[\s:|-]+\|$/.test(r); });
      out.push('<table><tr>' + cells(body[0]).map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr>' + body.slice(1).map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>');
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      var ordered = /^\s*\d+\./.test(l), items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      out.push((ordered ? '<ol>' : '<ul>') + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + (ordered ? '</ol>' : '</ul>')); continue;
    }
    if (!l.trim()) { i++; continue; }
    var para = []; while (i < lines.length && lines[i].trim() && !/^(#|\||```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push('<p>' + inline(para.join(' ')) + '</p>');
  }
  return out.join('\n');
}
function wireHelp() {
  $('hTest').onclick = function () {
    $('hMsg').textContent = 'Проверяю…';
    EngineTest.run().then(function (res) {
      var bad = res.filter(function (x) { return !x.ok; }).length;
      $('hMsg').innerHTML = bad ? '<span class="bad">Провалов: ' + bad + '</span>' : '<span class="ok">Все проверки пройдены (' + res.length + ')</span>';
      $('hRes').innerHTML = '<table class="grid" style="margin-bottom:12px">' + res.map(function (x) { return '<tr><td class="' + (x.ok ? 'ok' : 'bad') + '">' + (x.ok ? 'OK' : 'ОШИБКА') + '</td><td>' + esc(x.test) + '</td><td class="hint">' + esc(x.info || '') + '</td></tr>'; }).join('') + '</table>';
    });
  };
  $('hMd').onclick = function () { save($('project-docs').textContent.trim(), 'Мастер предпродажной подготовки — документация.md', 'text/markdown'); };
}

/* ---------- файлы: перетаскивание ---------- */
function wireDrop() {
  var d = $('uni');
  d.onclick = function (e) { if (!e.target.closest('button')) $('pickAny').click(); };
  d.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('pickAny').click(); } };
  $('btnPick').onclick = function (e) { e.stopPropagation(); $('pickAny').click(); };
  $('btnDemo').onclick = function (e) { e.stopPropagation(); loadDemo(); };
  $('pickAny').onchange = function (e) { ingestFiles(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (e.target.closest && e.target.closest('#uni')) d.classList.add('over'); }); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) d.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); d.classList.remove('over');
    if (e.target.closest && e.target.closest('#tplDrop')) return;
    if (e.dataTransfer && e.dataTransfer.files.length) { if (S.step !== 1) go(1); ingestFiles(e.dataTransfer.files); }
  });
}
function loadDemo() {
  var d = EngineTest.dataset();
  S.books = []; S.merged = d.merged; S.merged._filled = true; S.reg = d.reg; S.req = d.req; S.demo = true; S.liq = null;
  P.cessInn = ''; P.rcpInn = ''; P.pk = {}; P.xthr = '1'; P.lthr = '10'; P.lship = '1'; toDom();   // суммы в демо-наборе — единицы и сотни рублей
  logFile('Демо-данные', 'демо', false, 'выдуманные организации — для знакомства с инструментом');
  afterIngest(); toast('Загружены выдуманные демо-данные. Идите по шагам →', 'ok');
}

/* ---------- запуск ---------- */
function boot() {
  hydrate(); wireParams(); wireLiq(); wireVgo(); wireExt(); wireTemplates(); wireRelease(); wireHelp(); wireDrop();
  $('stepper').onclick = function (e) { var b = e.target.closest('button'); if (b) go(+b.dataset.step); };
  $('bBack').onclick = function () { go(Math.max(1, S.step - 1)); };
  $('bNext').onclick = function () { go(Math.min(6, S.step + 1)); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('tplPanel').hidden = true; $('helpPanel').hidden = true; $('scrim').hidden = true; } });
  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  toDom(); renderParams(); renderCoverage(); renderFiles();
  try { if (localStorage.getItem('master-case-backup')) { var bk = JSON.parse(localStorage.getItem('master-case-backup')); $('cBackup').checked = true; if (bk && bk.docs && Object.keys(bk.docs).length && !Object.keys(S.case.docs).length) { S.case = Case.normalize(bk); toast('Дело восстановлено из копии в браузере: документов ' + Object.keys(bk.docs).length, 'ok', 6000); } } } catch (e) { }
  tplRestore().then(function () { renderChrome(); if (S.merged) recomputeAll(); });
  go(1); renderAll();
}
boot();
