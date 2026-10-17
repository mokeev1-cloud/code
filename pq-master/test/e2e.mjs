#!/usr/bin/env node
/*
  Сквозной прогон «Мастера PQ» в headless Chromium.
  node pq-master/test/e2e.mjs [папка-для-скриншотов]
  Требуется playwright-core (npm i playwright-core) и Chromium.
  Путь к Chromium: переменная CHROMIUM или /opt/pw-browsers/chromium-NNNN/chrome-linux/chrome.
  Проверяет: нет ошибок и сетевых запросов, самотест проходит целиком, основные сценарии UI,
  собранная книга читается Python zipfile (если есть python3).
*/
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'pq-master', 'test', 'out'));
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROMIUM || (() => { const base = '/opt/pw-browsers'; try { const d = fs.readdirSync(base).find(x => /^chromium-\d+/.test(x)); return d ? path.join(base, d, 'chrome-linux', 'chrome') : undefined; } catch { return undefined; } })();
const browser = await chromium.launch({ executablePath: exe, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
page.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) problems.push('СЕТЬ: ' + r.url()); });
let failed = 0; const check = (name, cond, detail) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!cond) failed++; };
const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });

await page.goto('file://' + path.join(ROOT, 'pq-master.html'));
await page.waitForTimeout(300);
await shot('01-welcome');
check('Загрузка без ошибок', !problems.length, problems.join(' | '));

// самотест
const st = await page.evaluate(async () => { const r = await runSelfTest(); return { passed: r.passed, total: r.total, bad: r.R.filter(x => !x.pass).map(x => x.name + ' :: ' + x.detail) }; });
check('Самотест ' + st.passed + '/' + st.total, st.passed === st.total, st.bad.join(' || '));

// демо-книга
await page.click('#homeDemo'); await page.waitForSelector('#homeBook:not(.hidden)');
await shot('02-overview');
const score0 = await page.evaluate(() => S.opt.score);
check('Обзор: книга открыта, оценка посчитана', score0 > 0 && score0 < 100, 'оценка ' + score0);

// редактор: автодополнение и применение
await page.click('[data-view=editor]'); await page.waitForSelector('.cm-editor');
await page.click('#edQList li[data-q="Курсы"]'); await page.waitForTimeout(200);
await page.click('.cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('// проверка Table.Sel');
await page.keyboard.press('Control+Space'); await page.waitForTimeout(300);
const ac = await page.$$eval('.cm-tooltip-autocomplete li', l => l.slice(0, 5).map(x => x.textContent));
check('Редактор: автодополнение предлагает функции', ac.some(x => /Table\.Select/.test(x)), ac.join(', '));
await page.keyboard.press('Escape');
await shot('03-editor');
await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
const histLen = await page.evaluate(() => S.hist.length);
check('Редактор: Ctrl+Enter применяет правку (история)', histLen === 2, 'записей ' + histLen);

// подсказка сигнатуры
await page.keyboard.press('Enter'); await page.keyboard.type('x = Table.AddColumn(t, "a", ');
await page.waitForTimeout(200);
const sig = await page.$eval('.sig-tip', e => e.textContent).catch(() => '');
check('Редактор: подсказка сигнатуры с текущим аргументом', /columnGenerator/.test(sig), sig.slice(0, 80));
await page.click('#edRevert');

// оптимизатор
await page.click('[data-view=optimizer]'); await page.waitForTimeout(300); await shot('04-optimizer');
await page.click('#optApplySafe'); await page.waitForSelector('#modal button[data-v=go]'); await page.click('#modal button[data-v=go]'); await page.waitForTimeout(400);
const score1 = await page.evaluate(() => S.opt.score);
check('Оптимизатор: «все безопасные» повышают оценку', score1 > score0, score0 + ' → ' + score1);
await shot('05-optimizer-after');

// граф, песочница
await page.click('[data-view=graph]'); await page.waitForTimeout(200); await shot('06-graph');
await page.click('[data-view=sandbox]'); await page.waitForTimeout(200);
await page.click('#sbEval'); await page.waitForTimeout(200);
const sbOut = await page.$eval('#sbExprOut', e => e.textContent);
check('Песочница: выражение вычисляется', /Север/.test(sbOut), sbOut.slice(0, 80));
await shot('07-sandbox');
await page.click('#sbMode [data-m=query]'); await page.waitForTimeout(100);
await page.selectOption('#sbQSel', 'Продажи'); await page.click('#sbQRun'); await page.waitForTimeout(200);
const srcErr = await page.$eval('#sbStepOut', e => e.textContent);
check('Песочница: шаг-источник просит подмену образцом', /DataSource\.Error/.test(srcErr));
await shot('08-sandbox-steps');

// палитра
await page.keyboard.press('Control+k'); await page.keyboard.type('?Text.Pad'); await page.waitForTimeout(150);
const pal = await page.$$eval('.pal-item .lbl', l => l.map(x => x.textContent));
check('Палитра: поиск функций', pal.some(x => /Text\.PadStart/.test(x)), pal.slice(0, 3).join(', '));
await shot('09-palette'); await page.keyboard.press('Escape');

// сохранить копию → проверка Python
const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { window.showSaveFilePicker = undefined; delete window.showSaveFilePicker; return saveCopy(); })]);
const saved = path.join(OUT, 'saved.xlsx'); await dl.saveAs(saved);
check('Сохранение копии: имя файла', /_исправлено\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
try {
  const py = execFileSync('python3', ['-I', '-c', 'import zipfile,sys,base64,struct,io\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None\nraw=z.read("customXml/item1.xml")[2:].decode("utf-16le")\nb=base64.b64decode(raw.split(">",2)[2].split("<")[0]);n=struct.unpack("<I",b[4:8])[0]\np=zipfile.ZipFile(io.BytesIO(b[8:8+n]));assert p.testzip() is None\nprint(len(p.read("Formulas/Section1.m")))', saved]).toString().trim();
  const workLen = await page.evaluate(() => new TextEncoder().encode(S.work).length);
  check('Сохранённая книга читается Python zipfile, Section1.m = рабочей версии', +py === workLen, py + ' / ' + workLen + ' байт');
} catch (e){ console.log('SKIP python-проверка: ' + e.message.split('\n')[0]); }

// обезличивание, документация, история, справка
await page.click('[data-view=anon]'); await page.waitForTimeout(300); await shot('10-anon');
const leaks = await page.evaluate(() => S.scan.filter(f => f.sev === 'crit').length);
check('Обезличивание: сканер без критичных находок', leaks === 0, String(leaks));
await page.click('[data-view=docs]'); await page.waitForTimeout(300); await shot('11-docs');
await page.click('[data-view=history]'); await page.waitForTimeout(200); await shot('12-history');
await page.click('[data-view=reference]'); await page.waitForTimeout(200); await shot('13-reference');
await page.click('[data-view=snippets]'); await page.click('[data-sn=calendar]'); await page.waitForTimeout(200); await shot('14-snippets');
await page.click('[data-view=help]'); await page.click('#helpTabs [data-h=dev]'); await page.waitForTimeout(200);
const dev = await page.$eval('#helpDev', e => e.textContent);
check('Справка для разработчика встроена и отрисована', /Карта модулей/.test(dev));
const devBtns = await page.$$eval('#helpDev [data-devfile]', l => l.map(b => b.dataset.devfile));
check('Файлы разработки встроены: сборщик, тесты, точка входа CodeMirror', ['build.mjs', 'test/e2e.mjs', 'test/stress.mjs', 'vendor/codemirror.entry.js'].every(f => devBtns.includes(f)), devBtns.join(', '));
await shot('15-help-dev');
// темы: меню в верхней панели
for (const th of ['dark', 'calm', 'fun']){
  await page.click('#tbTheme'); await page.click('#themeMenu [data-theme-id=' + th + ']'); await page.waitForTimeout(150);
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Тема «' + th + '» включается из меню', cur === th, String(cur));
  await page.click('[data-view=home]'); await page.waitForTimeout(150); await shot('16-' + th + '-home');
  await page.click('[data-view=optimizer]'); await page.waitForTimeout(200); await shot('17-' + th + '-optimizer');
  await page.click('[data-view=editor]'); await page.waitForTimeout(200); await shot('18-' + th + '-editor');
}
await page.evaluate(() => setTheme('system'));   // дальше — скриншоты в обычной теме
// книга с макросом обновления и подключениями: факты на обзоре и карточка «Как обновляется книга»
await page.evaluate(async () => {
  const src = 'Attribute VB_Name = "Module1"\nSub Обновить()\n    ActiveWorkbook.RefreshAll\n    ActiveWorkbook.RefreshAll\nEnd Sub';
  const conn = '<connections><connection id="1" name="Запрос — Продажи" type="5" background="1" refreshOnLoad="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Продажи" command="SELECT * FROM [Продажи]"/></connection></connections>';
  await openFromBytes('macro.xlsm', await makeTestBook([['xl/vbaProject.bin', makeTestVba(src, 1251)], ['xl/connections.xml', conn]]));
});
await page.click('[data-view=home]'); await page.waitForTimeout(150);
const facts = await page.$eval('#homeFacts', e => e.textContent);
check('Обзор: макросы и подключения книги', /Module1\.Обновить/.test(facts) && /при открытии: 1/.test(facts), facts.replace(/\s+/g, ' ').slice(0, 160));
await page.click('[data-view=optimizer]'); await page.waitForTimeout(250);
const book = await page.$eval('#optBook', e => e.classList.contains('hidden') ? '' : e.textContent);
check('Оптимизатор: «Как обновляется книга» — двойной RefreshAll и обновление при открытии', /обновляются 2 раза/.test(book) && /при открытии/.test(book), book.slice(0, 120));
await shot('19-book-refresh');
// «Настройки PQ и Excel»: флажок подключения → правка к записи, макрос в окне, сборка с правкой
await page.click('#optSettings'); await page.waitForTimeout(200);
await page.click('#modal input[data-k="refreshOnLoad"]'); await page.waitForTimeout(100);
const pqx = await page.evaluate(async () => {
  const code = $('#pqxCode').textContent; const dirty = isDirty(); const pend = $('#pqxPend').textContent;
  const re = await loadBookFromBytes('macro.xlsm', await buildVerified());
  return { code: /Public Sub PQ_RefreshAll\(\)/.test(code) && /Public Sub PQ_TimeQueries\(\)/.test(code), dirty, pend, onLoad: re.conns[0].refreshOnLoad, same: re.origSection === S.work };
});
await shot('20-pq-settings');
const recBefore = await page.$$eval('#modal .pqx-rec[data-rk].warn', xs => xs.length);
await page.evaluate(() => { $('#modal input[data-k="refreshOnLoad"]').click(); });   // вернуть «как в файле» для этой строки
await page.click('#pqxRec'); await page.waitForTimeout(100);
const recAfter = await page.$$eval('#modal .pqx-rec[data-rk]', xs => xs.map(x => x.className + ':' + x.textContent));
check('Настройки PQ и Excel: рекомендации у флажков, «Применить рекомендуемое» приводит их к рекомендуемым', recAfter.length >= 2 && recAfter.every(x => /\bok\b/.test(x)) && !(await page.$eval('#modal input[data-k="refreshOnLoad"]', x => x.checked)), recBefore + ' → ' + recAfter.join(' | '));
await page.click('#modal button[data-v=ok]'); await page.waitForTimeout(100);
check('Настройки PQ и Excel: снятый флажок «при открытии» ждёт записи и попадает в собранный файл; макрос показан', pqx.code && pqx.dirty && /сохраните/.test(pqx.pend) && pqx.onLoad === false && pqx.same, JSON.stringify(pqx));
// «Проверка на данных»: маппинг — таблица книги, проводки — выгрузка CSV (cp1251); всё в браузере, наружу — только числа
const dres = await page.evaluate(async () => {
  const xz = zipRead(await makeTestXlsx({ sheets: [{ name: 'Справочники', rows: [['Код', 'Статья', 'ЦФО'], [90, 'Выручка', 'Продажи'], [44, 'Аренда', 'АХО'], [44, 'Аренда (дубль)', 'АХО'], [26, 'Зарплата', 'АУП']] }],
    tables: [{ sheet: 'Справочники', name: 'Маппинг', ref: 'A1:C5', cols: ['Код', 'Статья', 'ЦФО'] }] }));
  const extra = []; for (const e of xz.entries) extra.push([e.name, await zipEntryBytes(e)]);
  const sec = ['section Section1;', 'shared Маппинг = Excel.CurrentWorkbook(){[Name="Маппинг"]}[Content];',
    'shared Проводки = let', '    Источник = Csv.Document(File.Contents("C:\\Выгрузки\\Проводки.csv"), [Delimiter = ";", Encoding = 1251]),', '    Заголовки = Table.PromoteHeaders(Источник),',
    '    Типы = Table.TransformColumnTypes(Заголовки, {{"Счёт", Int64.Type}, {"Сумма", type number}}),', '    Статья = Table.AddColumn(Типы, "Статья", each Маппинг{[Код = [Счёт]]}[Статья])', 'in', '    Статья;',
    'shared ОПиУ = let', '    Слияние = Table.NestedJoin(Проводки, {"Счёт"}, Маппинг, {"Код"}, "М", JoinKind.LeftOuter),', '    Развернуть = Table.ExpandTableColumn(Слияние, "М", {"ЦФО"}),',
    '    Итоги = Table.Group(Развернуть, {"ЦФО"}, {{"Сумма", each List.Sum([Сумма]), type number}})', 'in', '    Итоги;', ''].join('\r\n');
  await openFromBytes('Учёт.xlsx', await makeTestBook(extra, sec));
  const csv = encodeCodePage('Дата;Счёт;Сумма;Контрагент\r\n2024-01-10;90;1000;ООО Ромашка-Север\r\n2024-01-11;44;-300;ИП Иванов Пётр\r\n2024-01-12;26;-500;Сотрудники отдела\r\n2024-01-13;51;-50;Банк Альфа-Восток\r\n', 1251);
  await attachFiles([new File([csv], 'Проводки.csv')], 'C:\\Выгрузки\\Проводки.csv', 'file');
  showView('data'); await dataRunAll();
  const titles = DATA.run.findings.map(f => f.title); const sums = DATA.run.findings.filter(f => /Контрольная/.test(f.title)).map(f => f.q + ': ' + f.text.slice(0, 40));
  const pkg = JSON.stringify(buildPackage()); const prompt = buildPromptText(buildPackage());
  return { titles, sums, queries: DATA.run.queries.map(q => q.name + ':' + (q.error ? q.error.reason : (q.steps[q.steps.length - 1].rows))), verify: DATA.verify ? [...DATA.verify.items.values()].map(v => v.rule + '=' + v.same) : [],
    pkgHasData: /Ромашка|Иванов|Альфа-Восток|Сотрудники отдела/.test(pkg + prompt), pkgChecks: !!JSON.parse(pkg).dataChecks, leaks: dataLeaks(pkg).length, leakTest: dataLeaks('{"x":"ИП Иванов Пётр"}').length };
});
await page.waitForTimeout(200); await shot('21-data-check');
check('Проверка на данных: запросы вычислены на таблице книги и выгрузке CSV; найдены дубли ключей, строки без пары и ошибки поиска', dres.queries.every(q => !/Error/.test(q)) && dres.titles.includes('Дубли ключей в присоединяемой таблице') && dres.titles.includes('Строки без пары при слиянии') && dres.titles.includes('Ошибки в ячейках результата'), dres.queries.join(' | ') + ' / ' + dres.titles.join(', '));
check('Проверка на данных: контрольная сумма — только там, где слияние задвоило строки (ключи и смена типа не считаются)', dres.sums.length === 1 && /^ОПиУ: «Сумма»/.test(dres.sums[0]), dres.sums.join(' | '));
check('Проверка на данных: исправления оптимизатора сверены до и после', dres.verify.length > 0, dres.verify.join(', '));
check('Пакет для ИИ: только числа проверки — значений из данных нет, защита находит их в исходящем тексте', dres.pkgChecks && !dres.pkgHasData && dres.leaks === 0 && dres.leakTest === 1, JSON.stringify(dres));
// редактор: живые данные шага под курсором, строки на шагах, пересчёт непринятой правки
await page.evaluate(() => { saveSettings({ edData: true }); EDD.on = true; openInEditor('ОПиУ'); });
await page.waitForTimeout(1500);
await page.evaluate(() => { const t = ED.view.state.doc.toString(); const p = t.indexOf('Слияние') + 2; ED.view.dispatch({ selection: { anchor: p } }); });
await page.waitForTimeout(500);
const ed1 = await page.evaluate(() => ({ pane: $('#edData').textContent, badges: $$('#edSide .outline-step .rows').map(x => x.textContent), flow: $$('#edFlow .rows').length }));
await shot('22-editor-data');
await page.evaluate(() => { const t = ED.view.state.doc.toString(); const p = t.indexOf('JoinKind.LeftOuter'); ED.view.dispatch({ changes: { from: p, to: p + 'JoinKind.LeftOuter'.length, insert: 'JoinKind.Inner' } }); });
await page.waitForTimeout(1800);
const ed2 = await page.evaluate(() => $$('#edSide .outline-step .rows').map(x => x.textContent));
check('Редактор: живые данные шага — строки × столбцы, превью, дубли ключей и строки без пары на шаге слияния', /Шаг «Слияние»/.test(ed1.pane) && /4 строк × 6 столбцов/.test(ed1.pane) && /дубли ключей справа/.test(ed1.pane) && /без пары: 1 из 4/.test(ed1.pane) && ed1.badges.length === 3 && ed1.flow === 3, JSON.stringify(ed1).slice(0, 300));
check('Редактор: непринятая правка пересчитывается на данных (LeftOuter → Inner: 4 → 3 строки)', ed2[0] === '3 × 6' && ed2[2] === '3 × 2', ed2.join(' | '));
await page.evaluate(() => edLoad('ОПиУ'));
// ответ ИИ: сверка изменённого запроса на данных до принятия, затем «Принять и править»
await page.click('[data-view=ai]'); await page.waitForTimeout(150);
await page.fill('#aiText', '```m\nshared ОПиУ = let\n    Слияние = Table.NestedJoin(Проводки, {"Счёт"}, Table.Distinct(Маппинг, {"Код"}), {"Код"}, "М", JoinKind.LeftOuter),\n    Развернуть = Table.ExpandTableColumn(Слияние, "М", {"ЦФО"}),\n    Итоги = Table.Group(Развернуть, {"ЦФО"}, {{"Сумма", each List.Sum([Сумма]), type number}})\nin\n    Итоги;\n```');
await page.click('#checkBtn'); await page.waitForTimeout(300);
await page.click('#aiVerifyBtn'); await page.waitForTimeout(1500);
const aiv = await page.$eval('[data-aiv="ОПиУ"]', e => e.textContent).catch(() => '');
await shot('23-ai-verify');
await page.click('#acceptEditBtn'); await page.waitForTimeout(800);
const afterAccept = await page.evaluate(() => ({ view: curView, q: ED.query, dirty: isDirty() }));
check('Ответ ИИ: правка сверена на данных до принятия (дубль убран — результат изменился), «Принять и править» открывает редактор', /результат изменился/.test(aiv) && afterAccept.view === 'editor' && afterAccept.q === 'ОПиУ' && afterAccept.dirty, aiv + ' / ' + JSON.stringify(afterAccept));
// карта модели: плитки, поток источники → запросы → лист, объём, скорость, ускорение
await page.evaluate(() => dataRunAll());
await page.click('[data-view=model]'); await page.waitForTimeout(400);
const mdl = await page.evaluate(() => ({ tiles: $$('#mdlTiles .tile').map(t => t.textContent), nodes: $$('#mdlFlow .fnode').map(g => g.dataset.id), edges: $$('#mdlFlow .fedge').length, vol: $$('#mdlVol .hb').length, speed: $$('#mdlSpeed .hb').length, sp: $$('#mdlSpeedup .dr').map(d => d.textContent) }));
await shot('25-model-map');
await page.evaluate(() => setTheme('dark')); await page.waitForTimeout(200); await shot('26-model-map-dark'); await page.evaluate(() => setTheme('system'));
check('Карта модели: плитки, поток (таблица книги и файл → запросы → лист), объём, скорость и оценка ускорения', mdl.tiles.length === 6 && mdl.nodes.includes('s:wb:Маппинг') && mdl.nodes.some(n => /^s:f:/.test(n)) && mdl.nodes.includes('q:ОПиУ') && mdl.edges >= 4 && mdl.vol >= 3 && mdl.speed >= 3 && mdl.sp.length >= 1 && /×/.test(mdl.sp[0]), JSON.stringify(mdl).slice(0, 400));
// показ значений скрыт (демонстрация экрана): вычисления те же, на экране — коды
await page.evaluate(() => { saveSettings({ hideValues: true }); edDataRender(); });
const hid = await page.$eval('#edData', e => e.textContent);
await page.evaluate(() => { saveSettings({ hideValues: false }); edDataRender(); });
check('Скрытые значения: в панели данных нет текста и сумм из данных, строки и столбцы видны', !/Ромашка|Иванов|1000/.test(hid) && /▒/.test(hid) && /строк × /.test(hid), hid.slice(0, 160));
// пакет для ИИ — проверка глазами: разделы, сканер, ровно тот текст, что уйдёт
await page.evaluate(() => dataRunAll());   // после принятия ответа ИИ код изменился — прежняя проверка устарела
await page.click('[data-view=anon]'); await page.waitForTimeout(300);
await page.click('#viewPkg'); await page.waitForTimeout(400);
const rev = await page.evaluate(() => ({ head: $('#modal .chips').textContent, parts: $$('#modal [data-pk]').map(b => b.dataset.pk) }));
await shot('24-package-review');
await page.click('#pkTabs [data-t=json]'); await page.waitForTimeout(150);
const revJson = await page.$eval('#pkBody', e => e.textContent);
await page.click('#modal button[data-v=cancel]');
check('Пакет для ИИ — проверка глазами: разделы с пояснениями, сканер чист, значений из данных 0, JSON целиком', /сканер: чисто/.test(rev.head) && /значений из данных: 0/.test(rev.head) && rev.parts.includes('section') && rev.parts.includes('dataChecks') && /"dataChecks"/.test(revJson) && !/Ромашка|Иванов/.test(revJson), JSON.stringify(rev).slice(0, 300));
// подсказки разделов
await page.evaluate(() => resetHints()); await page.click('[data-view=graph]'); await page.waitForTimeout(150);
const hint = await page.$eval('#view-graph .hintbar', e => e.textContent).catch(() => '');
check('Подсказка раздела показывается', hint.length > 20, hint.slice(0, 60));
await page.click('#view-graph .hintbar button'); await page.waitForTimeout(100);
check('«Понятно» скрывает подсказку', !(await page.$('#view-graph .hintbar')));

// запись в оригинал: OPFS даёт такие же FileSystemFileHandle, как диалог «Открыть» (нужен http-источник)
{
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(path.join(ROOT, 'pq-master.html'))); }).listen(0);
  const p2 = await ctx.newPage(); p2.on('pageerror', e => problems.push('pageerror(http): ' + e.message));
  await p2.goto('http://127.0.0.1:' + srv.address().port + '/');
  const ev = fn => p2.evaluate(fn);
  const clickModal = async (v) => { await p2.waitForSelector('#modalBg.on', { timeout: 3000 }); const t = await p2.$eval('#modal', e => e.innerText); await p2.click('#modal button[data-v=' + v + ']'); return t; };
  await ev(async () => { saveSettings({ backupOnSave: false }); const root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('book.xlsx', { create: true }); const w = await h.createWritable(); await w.write(await makeTestBook()); await w.close(); window.__h = h; await openFromHandle(h, true); setWork(applyAllSafeText(S.work, S.book.meta).text, 'optimizer', 'e2e'); });
  const pr = ev(() => saveToOriginal()); await clickModal('go'); await pr;
  const saved1 = await ev(async () => { const f = await window.__h.getFile(); const re = await loadBookFromBytes('x', new Uint8Array(await f.arrayBuffer())); return re.origSection === S.work && !isDirty(); });
  check('В оригинал: файл перезаписан, перечитан и совпадает с рабочей версией', saved1);
  await ev(async () => { setWork(S.work + '\r\n// ещё\r\n', 'editor', 'e2e 2'); const w = await window.__h.createWritable(); await w.write(await makeTestBook()); await w.close(); });
  const pr2 = ev(() => saveToOriginal()); await clickModal('go'); const warn = await clickModal('ok'); await pr2;
  const untouched = await ev(async () => { const f = await window.__h.getFile(); return (await loadBookFromBytes('x', new Uint8Array(await f.arrayBuffer()))).origSection === TEST_SECTION; });
  check('В оригинал: если файл изменился на диске — запись блокируется', /изменился/.test(warn) && untouched);
  await p2.close(); srv.close();
}

check('Итог: нет ошибок консоли и сетевых запросов', !problems.length, problems.join(' | '));
await browser.close();
console.log(failed ? '\nПРОВАЛЕНО проверок: ' + failed : '\nВсе проверки пройдены. Скриншоты: ' + OUT);
process.exit(failed ? 1 : 0);
