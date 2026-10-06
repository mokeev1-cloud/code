/* Сквозная проверка в настоящем браузере: node master/tests/e2e.js  (нужен playwright; путь можно задать PLAYWRIGHT_PATH) */
const path = require('path'), fs = require('fs'), os = require('os');
const PW = [process.env.PLAYWRIGHT_PATH, '/opt/node-tools/node_modules/playwright', 'playwright'].filter(Boolean).find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
const { chromium } = require(PW);
const HTML = 'file://' + path.join(__dirname, '..', 'master.html'), TPL = path.join(__dirname, '..', 'templates');
const JSZip = require(path.join(__dirname, '..', 'src', 'lib', 'lib-jszip.js'));
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'OK   ' : 'FAIL ') + n + (i ? '  — ' + i : '')); if (!c) fails++; };
(async () => {
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const out = path.join(os.tmpdir(), 'master-e2e'); fs.mkdirSync(out, { recursive: true });
  const download = async (action) => { const [d] = await Promise.all([p.waitForEvent('download'), action()]); const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); return f; };
  const zipFiles = async f => { const z = await JSZip.loadAsync(fs.readFileSync(f)); return z; };

  await p.goto(HTML); await p.click('#btnDemo'); await p.waitForTimeout(400);
  // загрузка 5 шаблонов Word
  await p.click('#btnTpl'); await p.waitForTimeout(200);
  // имена с кириллицей headless-Chromium в песочнице не открывает (не вина приложения) — кладем копии с ASCII-именами; вид шаблона определяется по номеру
  const fl = fs.readdirSync(TPL).map(n => { const t = path.join(out, n.slice(0, 1) + ' tpl.docx'); fs.copyFileSync(path.join(TPL, n), t); return t; });
  const editTpl = async (src, from, to, dest) => { const z = await JSZip.loadAsync(fs.readFileSync(src)); let x = await z.file('word/document.xml').async('string'); if (!x.includes(from)) throw new Error('нет фразы ' + from); z.file('word/document.xml', x.replace(from, to)); fs.writeFileSync(dest, await z.generateAsync({ type: 'nodebuffer' })); };
  const t1 = fl.find(f => /1 tpl/.test(f)); await editTpl(t1, '1.7. Цедент гарантирует', '1.7. ПРАВКА-ЮРИСТА: Цедент гарантирует', t1);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#tplDrop')]); await fc.setFiles(fl); await p.waitForTimeout(1200);
  ok('все 5 шаблонов распознаны', (await p.textContent('#tplBadge')).includes('5 из 5'), await p.textContent('#tplBadge'));
  const probs = await p.$$eval('.tplrow .problems', e => e.map(x => x.textContent)); ok('в шаблонах юристов нет замечаний по меткам', probs.length === 0, probs.join(' | '));
  await p.click('#tplClose');
  // шаг 6: первый выпуск
  await p.click('#stepper button[data-step="6"]'); await p.waitForTimeout(400);
  const nNew = await p.$$eval('#rRows tr.st-new', e => e.length); ok('первый выпуск: все операции «новые»', nNew > 5, nNew);
  const prefixes = await p.$$eval('#rRows .docnum', e => e.map(x => x.childNodes[0].textContent.trim()));
  ok('номера уникальны (префиксы организаций различаются)', new Set(prefixes).size === prefixes.length, prefixes.join(' '));
  const zip1 = await download(() => p.click('#rIssue')); const z1 = await zipFiles(zip1); const names1 = Object.keys(z1.files).filter(n => !z1.files[n].dir);
  ok('в архиве документы по контрагентам, реестр, памятка, дело', names1.some(n => /Документы на подпись\/.+\/.+\.docx$/.test(n)) && names1.some(n => /Реестр документов\.xlsx$/.test(n)) && names1.some(n => /Памятка/.test(n)) && names1.some(n => /\.json$/.test(n)), names1.length + ' файлов');
  const docxN = names1.filter(n => /\.docx$/.test(n)).length; ok('docx столько же, сколько операций (+уведомления)', docxN >= nNew, docxN + ' docx / ' + nNew);
  const cessDocs = names1.filter(n => /\/О[АБ]-Ц-0\d.*\.docx$/.test(n)); let withEdit = 0;
  for (const n of cessDocs) { const xx = await JSZip.loadAsync(await z1.file(n).async('uint8array')); if ((await xx.file('word/document.xml').async('string')).includes('ПРАВКА-ЮРИСТА')) withEdit++; }
  ok('правка юриста в шаблоне попала во все договоры уступки', cessDocs.length > 0 && withEdit === cessDocs.length, withEdit + ' из ' + cessDocs.length);
  const sample = names1.find(n => /\/Консолидатор.*\/.*Ц-.*\.docx$/.test(n) || /Ц-0\d.*\.docx$/.test(n));
  const x = await JSZip.loadAsync(await z1.file(sample).async('uint8array')); const dx = await x.file('word/document.xml').async('string');
  ok('в договоре нет незаполненных меток', !/\{\{/.test(dx), sample);
  ok('в договоре есть сумма прописью и реквизиты', /рубл/.test(dx) && /Примерн/.test(dx));
  await p.waitForTimeout(500);
  ok('после выпуска операции «без изменений», в деле документы', (await p.$$eval('#rRows tr.st-same', e => e.length)) === nNew);
  const dirty = await p.$eval('#caseBox', e => e.classList.contains('dirty')); ok('индикатор несохраненного дела горит', dirty);
  const caseFile = await download(() => p.click('#rSave')); const caseText = fs.readFileSync(caseFile, 'utf8'), cj = JSON.parse(caseText);
  ok('файл дела содержит документы и шаблоны', Object.keys(cj.docs).length === nNew && Object.keys(cj.templates).length === 5, Object.keys(cj.docs).length + ' док.');

  // юристы обновили шаблон после выпуска → неподписанные договоры уступки помечаются, остальные нет
  const t1v2 = path.join(out, '1 tpl.docx'); await editTpl(t1, 'ПРАВКА-ЮРИСТА: Цедент', 'ПРАВКА-ЮРИСТА-2: Цедент', t1v2);
  await p.click('#btnTpl'); await p.setInputFiles('#tplPick', t1v2); await p.waitForTimeout(500); await p.click('#tplClose'); await p.waitForTimeout(200);
  const tc = await p.evaluate(() => S.reco.rows.filter(w => w.state === 'changed').map(w => w.op.num + ':' + w.reasons.join('/')));
  ok('обновление шаблона помечает договоры уступки как «изменился: обновлен шаблон»', tc.length === 4 && tc.every(t => /обновлен шаблон/.test(t)) && !tc.some(t => /ЗЦ|-З-/.test(t)), tc.join(' ; '));
  await editTpl(t1v2, 'ПРАВКА-ЮРИСТА-2: Цедент', 'ПРАВКА-ЮРИСТА: Цедент', t1v2);
  await p.click('#btnTpl'); await p.setInputFiles('#tplPick', t1v2); await p.waitForTimeout(500); await p.click('#tplClose'); await p.waitForTimeout(200);
  ok('возврат прежнего файла шаблона снимает пометки', (await p.evaluate(() => S.reco.counts.changed)) === 0);
  // статусы через интерфейс: Ц-01 подписан, Ц-03 на подписи
  const rowSel = num => `#rRows tr:has(.docnum:text-is("${num}")) select[data-st], #rRows tr:has(.docnum:has-text("${num}")) select[data-st]`;
  const keyOf = num => p.evaluate(n => Object.keys(S.case.docs).filter(k => S.case.docs[k].num === n)[0], num);
  await p.selectOption(`#rRows select[data-st="${await keyOf('ОА-Ц-01')}"]`, 'подписан'); await p.waitForTimeout(150);
  await p.selectOption(`#rRows select[data-st="${await keyOf('ОА-Ц-03')}"]`, 'на подписи'); await p.waitForTimeout(150);
  // «новые данные»: меняем суммы у контрагентов и пересчитываем
  await p.evaluate(() => { S.merged.byInn['1000000001'].cps.forEach(cp => { if (cp.inn === '1000000004') { cp.acc['60'] = -260; cp.det['60'][3] = -260; } if (cp.inn === '1000000003') { cp.acc['62'] = 400; cp.det['62'][3] = 400; } }); recomputeAll(); });
  await p.waitForTimeout(300);
  const cnt = await p.evaluate(() => S.reco.counts); ok('после изменения данных: подписанный — «расхождение», неподписанные — «изменился»', cnt.conflict === 1 && cnt.changed >= 2, JSON.stringify(cnt));
  const keep = await p.evaluate(() => S.reco.rows.filter(w => w.op && w.rec && w.rec.num !== w.op.num).length); ok('номера не съехали', keep === 0);
  await p.screenshot({ path: path.join(out, 'step6-changes.png') });
  const why = await p.$$eval('#rRows .why', e => e.map(x => x.textContent).filter(t => /сумма/.test(t))); ok('причина изменения показана текстом', why.length > 0, why[0]);
  ok('для расхождения предложены кнопки решения', (await p.$$eval('#rRows tr.st-conflict [data-act]', e => e.map(x => x.dataset.act))).join() === 'accept,replace');
  ok('конфликтный документ не отмечен для выпуска', (await p.$$eval('#rRows tr.st-conflict input[data-pick]', e => e.length)) === 0);
  const zip2 = await download(() => p.click('#rIssue')); const z2 = await zipFiles(zip2); const n2 = Object.keys(z2.files).filter(n => /\.docx$/.test(n));
  ok('второй выпуск: только изменившиеся документы, в имени «_ред2»; подписанный не затронут', n2.length > 0 && n2.length < docxN && n2.every(n => /_ред2/.test(n)) && !n2.some(n => /ОА-Ц-01/.test(n)), n2.map(n => n.split('/').pop()).join(' ; '));
  const memo = await z2.file(Object.keys(z2.files).find(n => /Памятка/.test(n))).async('string'); ok('памятка называет перевыпуск', /ПЕРЕВЫПУЩЕНЫ/.test(memo));
  const accx = Object.keys(z2.files).find(n => /Бухгалтеру/.test(n)); ok('проводки бухгалтеру — только по выпускаемым документам', !!accx);
  // решение по конфликту: заменить новым документом (диалог подтверждения)
  p.once('dialog', d => d.accept());
  await p.click('#rRows tr.st-conflict [data-act="replace"]'); await p.waitForTimeout(400);
  const rep = await p.evaluate(() => ({ old: S.case.docs['Ц|1000000004|1000000001'], nw: S.reco.rows.filter(w => w.op && w.op.key === 'Ц|1000000004|1000000001')[0] }));
  ok('старый подписанный аннулирован, новая операция получила новый номер', rep.old.status === 'аннулирован' && rep.nw.state === 'new' && rep.nw.op.num !== rep.old.num, rep.old.num + ' → ' + rep.nw.op.num);
  const zip3 = await download(() => p.click('#rIssue')); const z3 = await zipFiles(zip3); const n3 = Object.keys(z3.files).filter(n => /\.docx$/.test(n)).map(n => n.split('/').pop());
  ok('третий выпуск: новый номер без «_ред» + ЗЦ в ред. 3 (в нем изменился перечень уступок)', n3.length === 2 && n3.some(n => /ОА-Ц-04/.test(n) && !/_ред/.test(n)) && n3.some(n => /ОА-ЗЦ-01_ред3/.test(n)), n3.join(' ; '));
  const hist = await p.evaluate(() => S.case.docs['Ц|1000000004|1000000001'].replaces); ok('в новой записи указано, что она заменяет прежний номер', !!hist, hist);
  // перезагрузка: данные + дело
  const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(e.message)); await p2.goto(HTML); await p2.click('#btnDemo'); await p2.waitForTimeout(300);
  const caseAscii = path.join(out, 'case.json'); fs.writeFileSync(caseAscii, caseText);
  const [fc2] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('#btnPick')]); await fc2.setFiles(caseAscii); await p2.waitForTimeout(500);
  console.log('   файлы во второй сессии:', JSON.stringify(await p2.evaluate(() => S.files.map(f => f.name + ':' + f.kind + ':' + f.note))));
  const cs = await p2.evaluate(() => Case.summary(S.case)); ok('дело загружается в новой сессии', cs.total === nNew, JSON.stringify(cs));
  await p2.click('#stepper button[data-step="6"]'); await p2.waitForTimeout(300);
  ok('в новой сессии на тех же данных — «без изменений»', (await p2.$$eval('#rRows tr.st-same', e => e.length)) === nNew);
  await p2.screenshot({ path: path.join(out, 'step6-reloaded.png') });
  // только дело, без данных: реестр виден и статусы можно менять
  const p3 = await ctx.newPage(); p3.on('pageerror', e => errs.push(e.message)); await p3.goto(HTML); await p3.setInputFiles('#pickAny', caseAscii); await p3.waitForTimeout(500);
  await p3.click('#stepper button[data-step="6"]'); await p3.waitForTimeout(300);
  const outRows = await p3.$$eval('#rRows tr.st-out, #rRows tr.st-void', e => e.length); ok('дело без данных: реестр показан целиком', outRows === nNew, outRows + ' из ' + nNew);
  const sel3 = await p3.$$('#rRows select[data-st]'); await sel3[0].selectOption('подписан'); await p3.waitForTimeout(200);
  ok('в режиме «только реестр» статус меняется, дело становится «несохраненным»', await p3.$eval('#caseBox', e => e.classList.contains('dirty')));
  await p3.screenshot({ path: path.join(out, 'step6-registry-only.png') });
  ok('нет ошибок в консоли', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(fails ? '\nПРОВАЛОВ: ' + fails : '\nсквозная проверка пройдена'); process.exit(fails ? 1 : 0);
})();
