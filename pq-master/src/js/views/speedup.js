/* =====================================================================
   views/speedup.js — «⚡ Ускорить книгу»: всё автоматическое — одной кнопкой, остальное — в отчёт.
   1) ускорения кода, проверенные на данных (результат до и после совпал) — DATA.verify;
   2) безопасные исправления кода (applyAllSafeText);
   3) рекомендуемые флажки подключений в файле (S.bookEdits, запишутся при сохранении);
   4) макрос PQMaster (по желанию).
   Итог — «Отчёт об ускорении»: было → стало, что сделано и почему быстрее, что осталось вручную,
   как проверить. Отчёт — внутренний документ (настоящие имена запросов), наружу не уходит.
   ===================================================================== */
const SPD = { last: null };
/** Пояснение для отчёта: первая фраза, не длиннее ~260 символов */
const spdShort = t => { t = String(t || ''); if (t.length <= 260) return t; const cut = t.slice(0, 260); const p = cut.lastIndexOf('. '); return (p > 80 ? cut.slice(0, p + 1) : cut + '…'); };
const SPD_WHY = {
  'row-lookup': 'поиск в справочнике для каждой строки заменён одним слиянием',
  'join-buffer': 'справочник в слиянии вычисляется один раз',
  'list-buffer': 'список больше не пересобирается для каждой строки',
  'buffer-in-each': 'буфер справочника создаётся один раз, а не на каждой строке'
};
/** Рекомендуемые флажки подключений: «при открытии» — выкл; фоновое — выкл при сводных, иначе вкл */
function pqxRecommendedEdits(){
  const B = S.book; if (!B || B.family !== 'excel' || !B.conns) return [];
  const recBg = !(B.pivots > 0); const out = [];
  for (const c of B.conns.filter(x => x.mashup && !x.deleted)){
    if (pqxVal(c, 'refreshOnLoad')) out.push({ c, k: 'refreshOnLoad', to: false, what: 'не обновлять при открытии', why: 'открытие книги не ждёт часового обновления' });
    if (!c.model && pqxVal(c, 'background') !== recBg) out.push({ c, k: 'background', to: recBg, what: recBg ? 'фоновое обновление' : 'синхронное обновление', why: recBg ? 'в Excel можно работать во время обновления' : 'сводные обновятся после данных — хватит одного «Обновить всё»' });
  }
  return out;
}
function spdPlan(){
  const ver = DATA.verify && DATA.verify.forWork === S.work ? [...DATA.verify.items].filter(([, v]) => v.safety !== 'safe' && v.results.some(r => r.same)).map(([id, v]) => Object.assign({ id }, v)) : [];
  const safe = OPT.potentialFor === S.work && OPT.safeResult ? OPT.safeResult : applyAllSafeText(S.work, S.book.meta);
  return { ver, safe, conns: pqxRecommendedEdits(), sp: mdlSpeedups(), runOk: dataRunValid(), unverified: (S.opt.findings || []).filter(f => f.fix && f.safety === 'check' && !(DATA.verify && DATA.verify.forWork === S.work && DATA.verify.items.has(f.id))).length };
}
async function openSpeedup(){
  if (!S.book || !S.A) return toast('Откройте книгу', 'warn');
  const P = spdPlan(); const xl = S.book.family === 'excel';
  const tb = P.sp.reduce((a, x) => a + x.before, 0);
  const row = (id, on, title, sub, dis) => '<label class="spd-row' + (dis ? ' dis' : '') + '"><input type="checkbox" id="' + id + '"' + (on && !dis ? ' checked' : '') + (dis ? ' disabled' : '') + '><span><b>' + title + '</b><br><span class="small muted">' + sub + '</span></span></label>';
  const html = '<h2>⚡ Ускорить книгу</h2><p class="small muted">Мастер сделает всё, что можно сделать автоматически без риска изменить результат, а остальное соберёт в отчёт с инструкциями. Каждое изменение попадает в «Историю правок» и отменяется одним шагом; в файл — только при сохранении (с резервной копией).</p>' +
    (tb ? '<div class="note small">Сейчас тяжёлые места требуют ≈ <b>' + fmtBig(tb) + '</b> операций Power Query (оценка по объёмам ваших данных) — см. «Карту модели».</div>' : '') +
    row('spdVer', true, 'Ускорения кода, проверенные на ваших данных: ' + P.ver.length, P.ver.length ? P.ver.map(v => escHtml(v.title + ' — ' + v.query)).slice(0, 6).join('<br>') : P.runOk ? 'нет ускорений, у которых результат на данных совпал' : 'сначала посчитайте на данных — тогда мастер применит и замену поиска для каждой строки на слияние, если результат тот же', !P.ver.length) +
    (!P.runOk && P.unverified ? '<div class="row" style="margin:4px 0 8px 30px"><button class="btn sm pri" id="spdRunData">▶ Посчитать на данных и вернуться</button><span class="small muted">' + P.unverified + ' ускорений ждут проверки</span></div>' : '') +
    row('spdSafe', true, 'Безопасные исправления кода: ' + P.safe.applied.length, P.safe.applied.length ? P.safe.applied.slice(0, 6).map(escHtml).join('<br>') + (P.safe.applied.length > 6 ? '<br>…и ещё ' + (P.safe.applied.length - 6) : '') : 'нечего исправлять', !P.safe.applied.length) +
    (xl ? row('spdConn', true, 'Настройки подключений в файле: ' + P.conns.length, P.conns.length ? P.conns.slice(0, 6).map(e => escHtml((e.c.query || e.c.name) + ': ' + e.what)).join('<br>') : 'уже как рекомендуется', !P.conns.length) : '') +
    (xl ? row('spdMacro', false, 'Скачать макрос PQMaster', 'одно «Обновить всё» с замером времени и замер каждого запроса — чтобы сравнить «до» и «после» в Excel') : '') +
    '<p class="small muted">Дальше — отчёт: что сделано и почему быстрее, что осталось сделать вручную (перестройка запросов, настройки Excel), как проверить результат.</p>';
  const p = modal(html, [['cancel', 'Отмена'], ['go', '⚡ Ускорить', 'pri']], { wide: true });
  if ($('#spdRunData')) $('#spdRunData').onclick = async () => { $('#modal button[data-v=cancel]').click(); showView('model'); await dataRunAll(); openSpeedup(); };
  const r = await p; if (r !== 'go') return;
  await runSpeedup(P, { ver: $('#spdVer') && $('#spdVer').checked, safe: $('#spdSafe') && $('#spdSafe').checked, conn: $('#spdConn') && $('#spdConn').checked, macro: $('#spdMacro') && $('#spdMacro').checked });
}
async function runSpeedup(P, o){
  const before = { score: S.opt.score, sp: P.sp, work: S.work, ver: DATA.verify && DATA.verify.forWork === S.work ? DATA.verify.items : null };   // сверка сбрасывается после правки кода — снимок
  let text = S.work; const done = []; const meta = S.book.meta;
  if (o.ver) for (const v of P.ver){
    try {
      const A = analyzeSection(text, meta); const F = optimizeSection(text, A, lintSection(A)).findings.find(x => x.id === v.id); if (!F || !F.fix) continue;
      const rr = v.results.find(x => x.same); const t2 = F.fix(text, rr.o || {}); if (syntaxIssues(t2).length) continue;
      text = t2; done.push({ where: F.query + (F.step ? ' › ' + F.step : ''), what: F.title + (rr.label ? ' (' + rr.label + ')' : ''), why: F.rule === 'row-lookup' && rr.o && rr.o.method === 'buffer' ? 'справочник вычисляется один раз и хранится в памяти (слияние на этих данных дало бы другой результат — проверьте дубли ключей)' : SPD_WHY[F.rule] || spdShort(F.how), check: '✓ на ваших данных результат тот же' + (rr.msBefore != null && rr.msAfter != null && rr.msBefore > 5 ? ' · в браузере ' + fmtSec(rr.msBefore / 1000) + ' → ' + fmtSec(rr.msAfter / 1000) : '') });
    } catch (e){ console.warn(e); }
  }
  if (o.safe){ const sr = applyAllSafeText(text, meta); text = sr.text; for (const a of sr.applied) done.push({ where: '', what: a, why: '', check: 'безопасно — результат не меняется' }); }
  if (text !== S.work) setWork(text, 'optimizer', 'Мастер ускорения: ' + done.length + ' ' + plural(done.length, 'исправление', 'исправления', 'исправлений'));
  const conns = []; if (o.conn) for (const e of P.conns){ pqxSet(e.c, e.k, e.to); conns.push({ where: e.c.query || e.c.name, what: e.what, why: e.why }); }
  if (conns.length) emitState('settings');
  if (o.macro){ const mo = pqxMacroOpts(true); download('PQMaster.bas', new Blob([encodeCodePage(genPqMacro(mo), mo.codePage)], { type: 'text/plain' })); }
  SPD.last = spdReport(before, done, conns, !!o.macro);
  showSpeedReport();
}
/** Данные отчёта: было → стало, сделано, осталось, как проверить */
function spdReport(before, done, conns, macro){
  const spBefore = before.sp, fixedIds = new Set(); const now = new Set((S.opt.findings || []).map(f => f.id));
  for (const x of spBefore) if (!now.has(x.f.id)) fixedIds.add(x.f.id);
  const opsBefore = spBefore.reduce((a, x) => a + x.before, 0), opsAfter = spBefore.reduce((a, x) => a + (fixedIds.has(x.f.id) ? x.after : x.before), 0);
  const manual = (S.opt.findings || []).filter(f => (f.impact || []).includes('speed') && f.rule !== 'excel-settings' && (f.sev === 'warn' || f.sev === 'err' || f.rule === 'multi-eval')).map(f => ({ where: f.query + (f.step ? ' › ' + f.step : ''), what: f.title, how: spdShort(f.how), fix: !!f.fix }));   // настройки Excel — отдельным чек-листом ниже
  // тяжёлые места, которые не исправлены автоматически, — первыми: в них основной резерв ускорения
  const ver = before.ver; const left = spBefore.filter(x => now.has(x.f.id));   // совет остался — место не исправлено (или исправлено буфером, без слияния)
  manual.unshift(...left.map(x => { const v = ver && ver.get(x.f.id); return { where: x.f.query + (x.f.step ? ' › ' + x.f.step : ''), what: 'Тяжёлое место: ' + x.how + ' — до ×' + fmtBig(Math.round(x.k)) + ' меньше операций', how: x.f.rule === 'multi-eval' ? spdShort(x.f.how) : v && !v.same ? 'Автоматически не исправлено: на ваших данных результат после слияния другой — обычно из-за дублей ключей в справочнике («Проверка на данных» покажет их). Уберите дубли или решите, какую строку брать, затем примените совет в «Оптимизаторе».' : 'Не проверено на данных — посчитайте на данных и запустите мастер снова или примените совет в «Оптимизаторе» и сверьте результат.' }; }));
  for (let i = manual.length - 1; i >= left.length; i--) if (left.some(x => x.f.query + (x.f.step ? ' › ' + x.f.step : '') === manual[i].where && x.f.title === manual[i].what)) manual.splice(i, 1);
  const stg = (S.lint || []).filter(f => f.rule === 'loaded-staging').map(f => f.query);
  const excel = S.book.family === 'excel' ? [
    ['Уровни конфиденциальности', 'если все источники внутренние: в макросе ThisWorkbook.Queries.FastCombine = True (действует для любого пользователя) или Параметры запроса → Текущая книга → Конфиденциальность → «Игнорировать уровни».'],
    ['Фоновый предпросмотр', 'Параметры запроса → Текущая книга → Загрузка данных → снять «Разрешить фоновую загрузку данных для предварительного просмотра».'],
    stg.length ? ['«Только подключение» для промежуточных', stg.join(', ') + ': Данные → Запросы и подключения → правый щелчок → Загрузить в… → «Только создать подключение».'] : null
  ].filter(Boolean) : [];
  return { book: S.book.name, date: new Date(), scoreBefore: before.score, scoreAfter: S.opt.score, opsBefore, opsAfter, done, conns, macro, manual, excel, dataOk: !!spBefore.length };
}
function spdReportBody(R){
  const k = R.opsAfter ? R.opsBefore / R.opsAfter : 1;
  const tile = (l, v, s) => '<div class="rt"><div class="rl">' + l + '</div><div class="rv">' + v + '</div><div class="rs">' + s + '</div></div>';
  const tbl = (head, rows) => rows.length ? '<table><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>' : '';
  return '<header><div class="rk">Отчёт об ускорении обновления</div><h1>' + escHtml(R.book) + '</h1><div class="rd">' + R.date.toLocaleString('ru-RU') + ' · Мастер PQ</div></header>' +
    '<div class="rtiles">' + tile('Операций Power Query в тяжёлых местах', R.opsBefore ? fmtBig(R.opsBefore) + ' → ' + fmtBig(R.opsAfter) : '—', R.opsBefore ? (k >= 1.5 ? 'меньше в ×' + fmtBig(Math.round(k)) + ' (оценка по объёмам данных)' : 'тяжёлые места остались — см. «Осталось сделать»') : 'нет оценки: проверка на данных не запускалась') +
      tile('Здоровье кода', R.scoreBefore + ' → ' + R.scoreAfter, 'из 100, по советам оптимизатора') + tile('Сделано автоматически', R.done.length + R.conns.length, 'исправлений кода: ' + R.done.length + ' · настроек: ' + R.conns.length) + '</div>' +
    '<h2>Что сделано</h2>' + (R.done.length ? tbl(['Где', 'Что', 'Почему быстрее', 'Проверка'], R.done.map(d => [escHtml(d.where || '—'), escHtml(d.what), escHtml(d.why || '—'), escHtml(d.check)])) : '<p class="muted">Код не менялся.</p>') +
    (R.conns.length ? '<h3>Настройки подключений (запишутся в файл при сохранении)</h3>' + tbl(['Подключение', 'Что', 'Зачем'], R.conns.map(c => [escHtml(c.where), escHtml(c.what), escHtml(c.why)])) : '') +
    (R.macro ? '<p>Скачан макрос <b>PQMaster.bas</b>: Alt+F11 → Файл → Импорт файла; запуск — PQ_RefreshAll (одно «Обновить всё» с замером времени), PQ_TimeQueries (время каждого запроса).</p>' : '') +
    '<h2>Осталось сделать вручную</h2>' + (R.manual.length || R.excel.length ? '<ol>' + R.manual.slice(0, 15).map(m => '<li><b>' + escHtml(m.what) + '</b> <span class="muted">— ' + escHtml(m.where) + '</span>' + (m.how ? '<br>' + escHtml(m.how) : '') + '</li>').join('') + R.excel.map(([t, d]) => '<li><b>' + escHtml(t) + '</b><br>' + escHtml(d) + '</li>').join('') + '</ol>' : '<p class="muted">Ничего — всё, что нашёл анализ, сделано.</p>') +
    '<h2>Как проверить результат</h2><ol><li>Сохраните книгу: копию (Ctrl+S) или в оригинал с резервной копией (Ctrl+Shift+S).</li><li>Откройте её в Excel и запустите «Данные → Обновить всё» или макрос PQ_RefreshAll — он покажет время.</li><li>Сравните с прежним временем. Подробно по запросам — PQ_TimeQueries или диагностика Power Query (раздел «Диагностика»).</li><li>Если что-то пошло не так — «История правок» в Мастере PQ или резервная копия файла.</li></ol>' +
    '<p class="note">Оценка операций — не секунды: она показывает, во сколько раз меньше работы у движка Power Query на ваших объёмах. Реальное время зависит от источников (1С, базы, файлы) и машины. Отчёт содержит настоящие имена запросов — это внутренний документ, ИИ его не передавайте.</p>';
}
const SPD_CSS = 'body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1b2130;background:#f4f5f8;margin:0;padding:28px}main{max-width:980px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 3px 12px rgba(20,30,50,.08)}' + SPD_INNER_CSS();
function SPD_INNER_CSS(){ return '.spd-report header{border-bottom:1px solid #dde1e8;padding-bottom:12px;margin-bottom:16px}.spd-report .rk{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#2f6fde;font-weight:600}.spd-report h1{margin:4px 0 2px;font-size:24px}.spd-report .rd,.spd-report .muted{color:#667085}.spd-report h2{font-size:17px;margin:22px 0 8px}.spd-report h3{font-size:14px;margin:16px 0 6px}.spd-report .rtiles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.spd-report .rt{border:1px solid #dde1e8;border-radius:10px;padding:12px 14px}.spd-report .rl{font-size:12px;color:#667085}.spd-report .rv{font-size:24px;font-weight:700;margin:4px 0;color:#2f6fde}.spd-report .rs{font-size:12px;color:#667085}.spd-report table{border-collapse:collapse;width:100%;font-size:13px}.spd-report th,.spd-report td{border-bottom:1px solid #e7eaf0;padding:6px 8px;text-align:left;vertical-align:top}.spd-report th{color:#667085;font-weight:600}.spd-report ol{padding-left:20px}.spd-report li{margin:6px 0}.spd-report .note{background:#f0f2f6;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#475467;margin-top:20px}'; }
function showSpeedReport(){
  const R = SPD.last; if (!R) return toast('Отчёта пока нет — запустите «⚡ Ускорить книгу»', 'warn');
  const p = modal('<div class="spd-report">' + spdReportBody(R) + '</div>', [['close', 'Закрыть'], ['dl', '⬇ Скачать отчёт (HTML)'], ['save', 'Сохранить книгу (копия)', 'pri']], { wide: true });
  p.then(r => {
    if (r === 'dl') download('Отчёт об ускорении — ' + R.book.replace(/\.[^.]+$/, '') + '.html', '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Отчёт об ускорении — ' + escHtml(R.book) + '</title><style>' + SPD_CSS + '</style></head><body><main class="spd-report">' + spdReportBody(R) + '</main></body></html>', 'text/html;charset=utf-8');
    if (r === 'save') saveCopy();
  });
}
$('#mdlSpeed1').onclick = openSpeedup;
$('#optSpeedup').onclick = openSpeedup;
