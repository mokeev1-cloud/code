/* =====================================================================
   views/home.js — «Обзор»: приветствие (недавние файлы, демо) или панель книги.
   ===================================================================== */
async function renderRecent(){
  const box = $('#recentList');
  if (!HAS_FSA){ box.innerHTML = ''; $('#recentNote').textContent = 'Список недавних работает в Chrome и Edge: браузер хранит ссылку на файл, а не его содержимое.'; return; }
  if (!pqmSettings().rememberRecent){ box.innerHTML = '<div class="small muted">Запоминание выключено в настройках.</div>'; $('#recentNote').textContent = ''; return; }
  const list = await recentList();
  box.innerHTML = list.length ? list.map(e => '<div class="recent" data-rid="' + e.id + '" title="Открыть"><div class="ic">' + escHtml((e.name.split('.').pop() || '').toUpperCase().slice(0, 4)) + '</div><div><div class="nm">' + escHtml(e.name) + '</div><div class="meta">' + fmtDateTime(new Date(e.lastOpened)) + (e.size ? ' · ' + fmtBytes(e.size) : '') + (e.queries ? ' · запросов: ' + e.queries : '') + '</div></div><button class="iconbtn x" data-rdel="' + e.id + '" title="Убрать из списка">✕</button></div>').join('') : '<div class="small muted">Пока пусто. Откройте книгу кнопкой «Открыть» или перетаскиванием — она появится здесь.</div>';
  $('#recentNote').textContent = list.length ? 'Хранятся только ссылки на файлы на диске — содержимое книг в браузер не копируется.' : '';
  $$('[data-rid]', box).forEach(el => el.onclick = async e => {
    if (e.target.closest('[data-rdel]')){ await recentDelete(e.target.closest('[data-rdel]').dataset.rdel); renderRecent(); return; }
    const ent = list.find(x => x.id === el.dataset.rid); if (ent) openFromHandle(ent.handle);
  });
}
$('#recentClear').onclick = async () => { await recentClear(); renderRecent(); toast('Список недавних очищен', 'ok'); };
$('#homeOpen').onclick = openBookDialog;
$('#homePaste').onclick = () => { $('#pasteBox').classList.toggle('hidden'); $('#pasteText').focus(); };
$('#homeDemo').onclick = openDemo;
$('#homeClose').onclick = closeBook;
wireDrop($('#homeDrop'), handleDrop);
$('#pasteGo').onclick = async () => {
  const t = $('#pasteText').value; if (!t.trim()) return toast('Вставьте код', 'warn');
  if (!(await confirmDiscard())) return;
  setBook(loadBookFromText('M-код', t.replace(/\r?\n/g, '\r\n'), $('#pasteName').value.trim() || 'Запрос1'));
};
/** Демо-книга: выдуманные запросы (TEST_SECTION самотеста) и два подключения — чтобы были видны все разделы */
const DEMO_CONNS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  [['1', 'Продажи', ' background="1" refreshOnLoad="1"'], ['2', 'Локальная таблица', '']].map(([id, q, a]) => '<connection id="' + id + '" keepAlive="1" name="Запрос — ' + q + '" description="Соединение с запросом «' + q + '» в книге." type="5" refreshedVersion="8"' + a + ' saveData="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=&quot;' + q + '&quot;;Extended Properties=&quot;&quot;" command="SELECT * FROM [' + q + ']"/><extLst><ext uri="{DE250136-89BD-433C-8126-D09CA5730AF9}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:connection id=""/></ext></extLst></connection>').join('') + '</connections>';
async function openDemo(){ if (!(await confirmDiscard())) return; await openFromBytes('Демо-книга.xlsx', await makeTestBook([['xl/connections.xml', DEMO_CONNS]]), null); }

function renderHome(){
  $('#homeEmpty').classList.toggle('hidden', !!S.book); $('#homeBook').classList.toggle('hidden', !S.book);
  if (!S.book){ renderRecent(); return; }
  const b = S.book, A = S.A, O = S.opt;
  $('#homeTitle').textContent = b.name;
  const e = S.lint.filter(l => l.sev === 'err').length, w = S.lint.filter(l => l.sev === 'warn').length;
  $('#homeScore').innerHTML = gaugeSvg(O.score) + '<div class="score-txt"><b>Здоровье книги</b><div>ошибок: ' + e + ' · предупреждений: ' + w + ' · советов: ' + O.findings.length + '</div><div>автоисправимо: <b>' + O.breakdown.fixable + '</b> (безопасно: ' + O.breakdown.safeFixable + ')</div><div class="row"><button class="btn pri sm" data-go="optimizer">Оптимизатор</button>' + (O.breakdown.safeFixable ? '<button class="btn sm" id="homeSafe">Применить безопасные (' + O.breakdown.safeFixable + ')</button>' : '') + '</div></div>';
  const fam = { excel: 'Книга Excel', pbi: 'Power BI', text: 'M-код текстом' }[b.family];
  const dmi = b.dm ? b.dm.info : null;
  const srcs = [...new Set(A.members.flatMap(m => m.sources))];
  $('#homeFacts').innerHTML = '<h2>Книга</h2><div class="kv">' +
    '<span>Формат</span><span>' + fam + ' (.' + escHtml(b.ext) + ')' + (b.container === 'pbi-schema' ? ' · DataModelSchema' : '') + '</span>' +
    (b.bytes ? '<span>Размер</span><span>' + fmtBytes(b.bytes.length) + ' · SHA-256 <span class="mono small">' + b.sha.slice(0, 12) + '…</span></span>' : '') +
    (dmi ? '<span>DataMashup</span><span class="small">версия ' + dmi.version + ' · код ' + fmtBytes(dmi.partsLen) + (dmi.metaLen != null ? ' · метаданные ' + fmtBytes(dmi.metaLen) : '') + '</span>' : '') +
    '<span>Запросы</span><span>' + A.members.length + ' · загружаются: ' + A.members.filter(m => m.load.sheet || m.load.model).length + ' · параметры: ' + A.members.filter(m => m.isParam).length + ' · функции: ' + A.members.filter(m => m.isFn).length + '</span>' +
    '<span>Источники</span><span>' + (srcs.length ? srcs.map(x => '<span class="badge">' + escHtml(x) + '</span>').join(' ') : '—') + '</span>' +
    refreshFacts(b) +
    '<span>Запись</span><span>' + (b.handle ? '<span class="badge ok">можно «В оригинал»</span>' : b.container === 'text' ? 'текст — только копия кода' : '<span class="badge">только копия</span>') + '</span></div>' +
    (b.warnings || []).map(x => '<div class="note warn small">' + escHtml(x) + '</div>').join('');
  const next = [];
  if (bookRefreshIssues(b).some(i => i.sev === 'warn')) next.push(['bolt', 'Макрос обновляет запросы повторно — посмотреть', 'optimizer']);
  if (O.breakdown.safeFixable) next.push(['bolt', 'Применить ' + O.breakdown.safeFixable + ' безопасных исправлений', 'safe']);
  if (S.opt.findings.some(f => f.rule === 'hardcoded')) next.push(['graph', 'Вынести захардкоженные пути и серверы в параметры', 'graph']);
  if (S.lint.some(l => l.rule === 'firewall' || l.rule === 'folding')) next.push(['bolt', 'Разобрать риски свёртки и Formula.Firewall', 'optimizer']);
  if (isDirty()) next.push(['code', 'Сохранить изменения: копия (Ctrl+S) или в оригинал', 'save']);
  next.push(['play', 'Прогнать запрос пошагово на образце данных', 'sandbox']);
  next.push(['shield', 'Подготовить обезличенный код для внешнего ИИ', 'anon']);
  $('#homeNext').innerHTML = '<h2>Что дальше</h2><ul class="next-list">' + next.map(([ic, t, act]) => '<li>' + icon(ic) + '<button class="link" data-act="' + act + '">' + escHtml(t) + '</button></li>').join('') + '</ul>';
  renderQueryTable();
  $$('[data-go]', $('#homeBook')).forEach(x => x.onclick = () => showView(x.dataset.go));
  if ($('#homeSafe')) $('#homeSafe').onclick = applyAllSafe;
  $$('[data-act]', $('#homeNext')).forEach(x => x.onclick = () => { const a = x.dataset.act; if (a === 'safe') applyAllSafe(); else if (a === 'save') saveCopy(); else showView(a); });
}
function renderQueryTable(){
  const f = ($('#homeFilter').value || '').toLowerCase(); const heat = new Map(S.opt.heat.map(h => [h.query, h]));
  const rows = S.A.members.filter(m => !f || m.name.toLowerCase().includes(f)).map(m => {
    const L = m.load; const lints = S.lint.filter(l => l.query === m.name); const er = lints.filter(l => l.sev === 'err').length, wr = lints.filter(l => l.sev === 'warn').length;
    const h = heat.get(m.name);
    const spark = h ? '<div class="heat-strip" style="height:14px;width:140px">' + h.cells.map(c => '<div class="heat-cell" style="background:' + heatColor(c.level) + '" title="' + escHtml(c.step + ': ' + (c.why.join(', ') || 'лёгкий шаг')) + '"></div>').join('') + '</div>' : '';
    return '<tr class="click" data-q="' + escHtml(m.name) + '"><td><b>' + escHtml(m.name) + '</b></td><td>' + (m.isParam ? 'параметр' : m.isFn ? 'функция' : 'запрос') + '</td><td>' + (L.sheet ? '▦ лист ' : '') + (L.model ? '◈ модель' : '') + (!L.sheet && !L.model ? '<span class="muted">подключение</span>' : '') + '</td><td>' + (L.rows != null ? L.rows : '') + '</td><td>' + (L.errors ? '<span class="badge bad">' + L.errors + '</span>' : '') + '</td><td class="small">' + escHtml([...new Set(m.sources)].join(', ')) + '</td><td>' + (m.steps ? m.steps.steps.length : '') + '</td><td>' + (er ? '<span class="sev err">' + er + '</span> ' : '') + (wr ? '<span class="sev warn">' + wr + '</span>' : '') + '</td><td>' + spark + '</td></tr>';
  }).join('');
  $('#queryTable').innerHTML = '<table class="t"><tr><th>Запрос</th><th>Тип</th><th>Загрузка</th><th>Строк</th><th>Ошибок</th><th>Источники</th><th>Шагов</th><th>Замечания</th><th>Тяжесть шагов</th></tr>' + rows + '</table>';
  $$('tr[data-q]', $('#queryTable')).forEach(tr => tr.onclick = () => openInEditor(tr.dataset.q));
}
$('#homeFilter').addEventListener('input', () => S.book && renderQueryTable());
registerView('home', { render: renderHome, alwaysRender: true });
/** Строки «Макросы» и «Подключения» для фактов о книге */
function refreshFacts(b){
  let h = '';
  if (b.vba){ const calls = vbaRefreshCalls(b.vba.modules); const procs = [...new Set(calls.map(c => c.module + '.' + c.proc))];
    h += '<span>Макросы</span><span>' + (b.vba.error ? '<span class="badge warn">не прочитаны</span>' : b.vba.modules.length + ' модулей' + (procs.length ? ' · обновляют запросы: ' + procs.map(x => '<span class="badge">' + escHtml(x) + '</span>').join(' ') : ' · запросы не обновляют')) + '</span>'; }
  if (b.privacy && b.privacy.firewall != null) h += '<span>Конфиденциальность</span><span>' + (b.privacy.firewall ? 'уровни конфиденциальности учитываются (по умолчанию)' : '<span class="badge warn">для книги выбрано «игнорировать»</span> <span class="small muted">действует только для сохранившего пользователя; сбросится после изменения кода</span>') + '</span>';
  const pq = (b.conns || []).filter(c => c.mashup && !c.deleted);
  if (pq.length){ const onl = pq.filter(c => c.refreshOnLoad).length, bg = pq.filter(c => c.background).length;
    h += '<span>Подключения</span><span>' + pq.length + ' Power Query · фоновое обновление: ' + bg + (onl ? ' · <span class="badge warn">при открытии: ' + onl + '</span>' : '') + '</span>'; }
  return h;
}
