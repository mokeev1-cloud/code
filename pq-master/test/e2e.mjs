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
await page.click('#modal button[data-v=ok]'); await page.waitForTimeout(100);
check('Настройки PQ и Excel: снятый флажок «при открытии» ждёт записи и попадает в собранный файл; макрос показан', pqx.code && pqx.dirty && /сохраните/.test(pqx.pend) && pqx.onLoad === false && pqx.same, JSON.stringify(pqx));
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
