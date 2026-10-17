/* =====================================================================
   app/selftest.js — встроенный самотест. Создаёт тестовую книгу в памяти и
   прогоняет её через все модули. Глобальное состояние S сохраняется и
   восстанавливается, так что тест безопасно запускать при открытой книге.
   runSelfTest() → { R: [{name, pass, detail}], passed, total, ms }
   ===================================================================== */
const TEST_SECTION = [
  'section Section1;',
  '',
  'shared ПараметрОтчёт = "Квартальный" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];',
  '',
  'shared Продажи = let',
  '    // источник: \\\\fileserver01\\finance$\\выгрузки, ответственный ivanov@company.ru',
  '    Источник = Sql.Database("sql-prod-01.corp.local", "SalesDB", [Query="SELECT * FROM dbo.Orders WHERE Region = \'North\' AND Amount > 1500"]),',
  '    Фильтр = Table.SelectRows(Источник, each [Region] = "North" and [Amount] > 2500),',
  '    Даты = Table.SelectRows(Фильтр, each [OrderDate] >= #date(2023, 1, 15)),',
  '    Сортировка = Table.Sort(Даты, {{"OrderDate", Order.Descending}}),',
  '    БезДублей = Table.Distinct(Сортировка, {"Код"}),',
  '    Первые = Table.FirstN(БезДублей, 100)',
  'in',
  '    Первые;',
  '',
  'shared Файлы = let',
  '    Источник = Folder.Files("\\\\fileserver01\\finance$\\Отчёты\\2024"),',
  '    План = Csv.Document(File.Contents("C:\\Users\\ivanov\\Documents\\план.csv"), [Delimiter=";", Encoding=1251]),',
  '    Заголовки = Table.PromoteHeaders(План, [PromoteAllScalars=true])',
  'in',
  '    Заголовки;',
  '',
  'shared Курсы = let',
  '    Источник = Json.Document(Web.Contents("https://api.example-bank.ru/v1/rates?apikey=SECRETKEY123", [Headers=[Authorization="Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"]])),',
  '    Почта = "analyst@company.ru",',
  '    Шлюз = "10.20.30.40",',
  '    Сумма = Number.FromText("12345,67")',
  'in',
  '    Источник;',
  '',
  'shared Кадры = Odbc.Query("Driver={SQL Server};Server=10.1.2.3;Database=HR;UID=svc_user;PWD=P@ssw0rd!", "SELECT name FROM staff WHERE dept = \'IT\' AND salary > 99000");',
  '',
  'shared #"Локальная таблица" = let',
  '    Источник = Excel.CurrentWorkbook(){[Name="ТаблицаПлан"]}[Content],',
  '    Лист = Excel.Workbook(File.Contents("D:\\Отчёты\\ООО Ромашка\\бюджет.xlsx"), null, true){[Item="Бюджет 2024",Kind="Sheet"]}[Data],',
  '    Объединено = Table.NestedJoin(Источник, {"Код"}, Продажи, {"Код"}, "Продажи", JoinKind.LeftOuter),',
  '    Тип = Table.AddColumn(Объединено, "Отчёт", each ПараметрОтчёт & " ООО Ромашка")',
  'in',
  '    Тип;',
  ''
].join('\r\n');
const TEST_SECRETS = ['sql-prod-01.corp.local', 'SalesDB', 'fileserver01', 'C:\\Users\\ivanov', 'SECRETKEY123', 'eyJhbGciOiJIUzI1NiJ9', 'analyst@company.ru', 'ivanov@company.ru', '10.20.30.40', '10.1.2.3', 'svc_user', 'P@ssw0rd!', "'North'", '"North"', 'ООО Ромашка', 'D:\\Отчёты'];

async function makeTestBook(){
  const x = s => te.encode(s);
  const ctPkg = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>';
  const pkgXml = '<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Version>2.141.0</Version><MinVersion>2.21.0</MinVersion><Culture>ru-RU</Culture></Package>';
  const parts = [];
  parts.push(await zipFinalizeNew(zipNewEntry('[Content_Types].xml', x(ctPkg), true)));
  parts.push(await zipFinalizeNew(zipNewEntry('Config/Package.xml', x(pkgXml), true)));
  parts.push(await zipFinalizeNew(zipNewEntry('Formulas/Section1.m', x(TEST_SECTION), true)));
  const partsZip = zipWrite(parts);
  const perm = encodeText('<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled></PermissionList>', 'utf-8', true);
  const item = (n, entries) => '<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/' + encodeURIComponent(n) + '</ItemPath></ItemLocation><StableEntries>' + entries.map(([t, v]) => '<Entry Type="' + t + '" Value="' + v.replace(/"/g, '&quot;') + '" />').join('') + '</StableEntries></Item>';
  const metaXml = '<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items><Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries /></Item>' +
    item('Продажи', [['FillEnabled', 'l1'], ['FillCount', 'l120'], ['FillErrorCount', 'l0'], ['FillColumnNames', 's["Код","OrderDate","Region","Amount"]'], ['FillTarget', 'sПродажи'], ['ResultType', 'sTable']]) +
    item('Файлы', [['FillEnabled', 'l0'], ['FillToDataModelEnabled', 'l0']]) +
    item('Локальная таблица', [['FillEnabled', 'l1'], ['FillCount', 'l7'], ['FillErrorCount', 'l2']]) + '</Items></LocalPackageMetadataFile>';
  const mx = encodeText(metaXml, 'utf-8', true);
  const meta = concatBytes([u32le(0), u32le(mx.length), mx, u32le(0)]);
  const bind = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 255);
  const dm = concatBytes([u32le(0), u32le(partsZip.length), partsZip, u32le(perm.length), perm, u32le(meta.length), meta, u32le(bind.length), bind]);
  const itemXml = encodeText('<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">' + b64encode(dm) + '</DataMashup>', 'utf-16le', true);
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Секретные данные листа — не должны читаться</t></is></c></row></sheetData></worksheet>'],
    ['customXml/item1.xml', itemXml],
    ['customXml/itemProps1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{4D7B2F3C-0000-4000-8000-000000000001}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>'],
    ['customXml/_rels/item1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>']
  ];
  const ents = [];
  for (const [n, c] of files) ents.push(await zipFinalizeNew(zipNewEntry(n, typeof c === 'string' ? x(c) : c, true)));
  return zipWrite(ents);
}
async function makeTestPbit(){
  const schema = { name: 'test', compatibilityLevel: 1550, model: { tables: [{ name: 'Факт', partitions: [{ name: 'Факт-1', mode: 'import', source: { type: 'm', expression: ['let', '    Источник = Sql.Database("pbi-srv.corp.local", "DWH")', 'in', '    Источник'] } }] }], expressions: [{ name: 'ПутьКПапке', kind: 'm', expression: '"C:\\\\Data" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]' }] } };
  const ents = [await zipFinalizeNew(zipNewEntry('DataModelSchema', encodeText(JSON.stringify(schema, null, 2), 'utf-16le', false), true)), await zipFinalizeNew(zipNewEntry('Version', encodeText('1.28', 'utf-16le', false), false)), await zipFinalizeNew(zipNewEntry('SecurityBindings', new Uint8Array([1, 2, 3]), false))];
  return zipWrite(ents);
}
async function runSelfTest(){
  const R = []; const ok = (name, pass, detail) => R.push({ name, pass: !!pass, detail: detail || '' });
  const t0 = performance.now();
  try {
    const bytes = await makeTestBook();
    const book = await loadBookFromBytes('самотест.xlsx', bytes);
    ok('Извлечение: DataMashup найден в customXml/item1.xml (UTF-16 с BOM), Section1.m прочитан', book.container === 'excel' && book.itemEnc === 'utf-16le' && book.itemBom && book.origSection === TEST_SECTION);
    const A = analyzeSection(book.origSection, book.meta);
    ok('Разбор: 6 запросов, параметр, шаги, зависимости, метаданные загрузки', A.members.length === 6 && A.byName.get('ПараметрОтчёт').isParam && A.byName.get('Продажи').steps.steps.length === 6 && A.byName.get('Локальная таблица').refs.has('Продажи') && A.byName.get('Продажи').load.rows === 120, 'запросов: ' + A.members.length);
    ok('Метаданные: столбцы результата (FillColumnNames) прочитаны без чтения листов', JSON.stringify(A.byName.get('Продажи').load.columns) === '["Код","OrderDate","Region","Amount"]');

    const cfg = defaultConfig(); cfg.blacklist = ['ООО Ромашка']; const dict = new TokenDict();
    const an = anonymizeM(book.origSection, cfg, dict);
    const leaked = TEST_SECRETS.filter(s => an.out.includes(s));
    ok('Обезличивание по умолчанию: ни одно из ' + TEST_SECRETS.length + ' секретных значений не осталось открытым', !leaked.length, leaked.length ? 'осталось: ' + leaked.join(', ') : 'замен: ' + an.spans.length);
    const cfgOff = defaultConfig(); cfgOff.cats.CONN = false; cfgOff.cats.URL = false; cfgOff.cats.SRV = false; const dOff = new TokenDict();
    const anOff = anonymizeM(book.origSection, cfgOff, dOff);
    ok('Секреты при выключенных CONN/URL/SRV: пароль, логин ODBC, apikey и Bearer-токен всё равно заменены (SECRET)', ['P@ssw0rd!', 'svc_user', 'SECRETKEY123'].every(v => (dOff.byRaw.get(v) || {}).cat === 'SECRET') && dOff.entries.some(e => e.cat === 'SECRET' && e.value.includes('eyJhbGciOiJIUzI1NiJ9')) && !/P@ssw0rd|svc_user|SECRETKEY123|eyJhbG/.test(anOff.out), dOff.entries.filter(e => e.cat === 'SECRET').map(e => e.value).join(' | '));
    ok('Строка подключения целиком (CONN включена) и Authorization-заголовок — секреты не видны', (dict.entries.find(e => e.value.includes('PWD=')) || {}).cat === 'CONN' && dict.entries.some(e => e.cat === 'SECRET' && e.value.includes('Bearer')));
    ok('Одно значение — одна метка: North в SQL-тексте и в фильтре M', (() => { const t = dict.byRaw.get('North'); return t && an.out.split(t.token).length - 1 === 2; })(), 'North → ' + ((dict.byRaw.get('North') || {}).token || '—'));
    ok('Позиции и размеры не тронуты (Table.FirstN 100, Encoding 1251), числа в фильтрах заменены', /Table\.FirstN\(БезДублей, 100\)/.test(an.out) && /Encoding=1251/.test(an.out) && !/> 2500/.test(an.out));
    const sc = scanLeaks(an.out, cfg, dict).filter(f => f.sev === 'crit');
    ok('Сканер: критичных находок в обезличенном тексте нет', !sc.length, sc.map(f => f.match).join(', '));
    const rt = restoreTokens(an.out, dict);
    ok('Обратная подстановка без изменений = оригинал побайтно', rt.out === book.origSection && !rt.unknown.length);

    const nb = await buildBookWithSection(book, rt.out);
    const book2 = await loadBookFromBytes('самотест_исправлено.xlsx', nb);
    ok('Сборка копии: Section1.m после пересборки совпадает побайтно', bytesEqual(encodeText(book2.origSection, book2.secEnc, book2.secBom), encodeText(book.origSection, book.secEnc, book.secBom)));
    ok('Сборка копии: Permissions, Metadata, PermissionBindings перенесены без изменений', bytesEqual(book2.dm.tail, book.dm.tail) && book2.dm.version === book.dm.version);
    let same = true, crcOk = true;
    for (const e of book.zip.entries){ if (e.name === 'customXml/item1.xml') continue; const e2 = zipFind(book2.zip, e.name); if (!e2 || !bytesEqual(e2.raw, e.raw)) same = false; }
    for (const e of book2.zip.entries){ const d = await zipEntryBytes(e); if (crc32(d) !== e.crc || d.length !== e.usize) crcOk = false; }
    ok('Сборка копии: остальные части книги скопированы побайтно, CRC32 всех частей верны', same && crcOk && book2.zip.entries.length === book.zip.entries.length);
    ok('Сборка копии: кодировка customXml сохранена (UTF-16LE + BOM)', book2.itemEnc === 'utf-16le' && book2.itemBom);

    const cfgAll = defaultConfig(); for (const c of CATS) cfgAll.cats[c.id] = true; cfgAll.blacklist = ['ООО Ромашка'];
    const dAll = new TokenDict(); const anAll = anonymizeM(book.origSection, cfgAll, dAll);
    const names = ['Продажи', 'Файлы', 'Курсы', 'Кадры', 'Локальная таблица', 'Region', 'Amount', 'ТаблицаПлан', 'Бюджет 2024'];
    ok('Все категории (запросы, столбцы, листы, таблицы, SQL, комментарии): имена скрыты', names.every(n => !anAll.out.includes(n)), names.filter(n => anAll.out.includes(n)).join(', '));
    ok('Все категории: обратная подстановка = оригинал побайтно', restoreTokens(anAll.out, dAll).out === book.origSection);

    // патч от «ИИ»: изменён один запрос
    const tokNum = dict.byRaw.get('2500').token;
    const pSec = parseSection(an.out); const pm = pSec.members.find(m => m.name === 'Продажи');
    const newExpr = an.out.slice(pm.exprStart, pm.exprEnd).replace('Первые = Table.FirstN(БезДублей, 100)', 'Буфер = Table.Buffer(БезДублей),\r\n    Первые = Table.FirstN(Буфер, 100)');
    const patch = { protocol: PROTOCOL, kind: 'patch', members: { 'Продажи': newExpr } };
    const rp = restoreTokens(patch.members['Продажи'], dict);
    const merged = mergeIntoBase(book.origSection, [{ name: 'Продажи', expr: rp.out }], new Set(), false);
    const cmp = compareSections(book.origSection, merged);
    ok('Патч ИИ: изменён ровно один запрос, реальные значения восстановлены', cmp.changed.length === 1 && cmp.changed[0].name === 'Продажи' && !cmp.added.length && !cmp.removed.length && merged.includes('sql-prod-01.corp.local') && merged.includes('Table.Buffer(БезДублей)') && !merged.includes(tokNum));
    const unk = restoreTokens('x = "⟦PATH_999⟧", y = [[SRV_1]], z = ⟦ num_2 ⟧', dict);
    ok('Проверка меток: неизвестная метка и искажённые метки обнаружены', unk.unknown.length === 1 && unk.nearMiss.length === 2, 'неизвестных: ' + unk.unknown.length + ', искажённых: ' + unk.nearMiss.length);
    const nl = newLiterals(book.origSection, merged.replace('Table.FirstN(Буфер, 100)', 'Table.FirstN(Буфер, 50)').replace('"SalesDB"', '"C:\\\\temp\\\\x.csv"'));
    ok('Новые литералы в ответе ИИ обнаруживаются (число и путь)', nl.some(x => x.v === '50') && nl.some(x => x.risky));

    // диагностика тем же словарём
    const csv = 'Id;Query;Step;Resource;Data Source Query;Start Time;End Time;Exclusive Duration;Row Count\r\n1;Продажи;Источник;sql-prod-01.corp.local;SELECT * FROM t WHERE x = \'secret value\';2024-05-01 10:00:00.000;2024-05-01 10:00:02.500;00:00:02.5000000;120\r\n2;Курсы;Источник;https://api.example-bank.ru/v1/rates;;2024-05-01 10:00:02.500;2024-05-01 10:00:03.000;00:00:00.5000000;5\r\n';
    const p = parseCSV(csv); const t = mkDiagTable('diag.csv', p.rows, p.delim);
    const at = anonymizeTable(p.rows, t.modes, cfg, dict);
    const flat = at.map(r => r.join(';')).join('\n');
    ok('Диагностика: сервер получил ту же метку, что и в коде; время, длительность и строки сохранены', flat.includes(dict.byRaw.get('sql-prod-01.corp.local').token) && !flat.includes('sql-prod-01') && !flat.includes('secret value') && flat.includes('00:00:02.5000000') && flat.includes(';120') && !flat.includes('api.example-bank.ru'), 'режимы: ' + t.modes.join(','));
    const tr = anonymizeTrace('DataMashup.Trace Information: 24579 : {"Start":"2024-05-01T10:00:00","Action":"Engine/IO/Db/Sql/Request","ResourcePath":"sql-prod-01.corp.local;SalesDB","UserName":"CORP\\\\ivanov","HostProcessId":"1234"}', cfg, dict);
    ok('Трассировка: ресурс и пользователь обезличены, служебные поля сохранены', !/sql-prod-01|SalesDB|ivanov/.test(tr) && tr.includes('"HostProcessId":"1234"') && tr.includes('Engine/IO/Db/Sql/Request'), tr.slice(0, 160));

    // линтер и параметризатор
    const L = lintSection(A); const has = (r, q) => L.some(l => l.rule === r && (!q || l.query === q));
    ok('Линтер: Formula.Firewall для «Локальная таблица», свёртка и Sort→Distinct для «Продажи», культура для «Курсы»', has('firewall', 'Локальная таблица') && has('folding', 'Продажи') && has('sort-distinct', 'Продажи') && has('culture', 'Курсы') && has('load-errors', 'Локальная таблица'), L.map(l => l.rule + ':' + l.query).join(', '));
    const cand = paramCandidates(A);
    const ps = applyParameterize(book.origSection, A, [{ value: 'sql-prod-01.corp.local', name: 'Сервер' }]);
    const A2 = analyzeSection(ps, {});
    ok('Параметризатор: сервер вынесен в параметр, ссылка подставлена', A2.byName.get('Сервер') && A2.byName.get('Сервер').isParam && /Sql\.Database\(Сервер, "SalesDB"/.test(ps) && !paramCandidates(A2).some(c => c.value === 'sql-prod-01.corp.local'), 'кандидатов было: ' + cand.length);

    // Power BI .pbit (DataModelSchema)
    const pb = await loadBookFromBytes('тест.pbit', await makeTestPbit());
    const pa = anonymizeM(pb.origSection, cfg, new TokenDict());
    const npb = await buildBookWithSection(pb, pb.origSection.replace('"DWH")', '"DWH"),\r\n    Фильтр = Table.FirstN(Источник, 10)').replace('in\n    Источник', 'in\n    Фильтр'));
    const pb2 = await loadBookFromBytes('тест.pbit', npb);
    ok('Power BI .pbit: чтение DataModelSchema, обезличивание, экспериментальная сборка (SecurityBindings удалён)', pb.container === 'pbi-schema' && parseSection(pb.origSection).members.length === 2 && !pa.out.includes('pbi-srv') && /Фильтр = Table\.FirstN/.test(pb2.origSection) && !zipFind(pb2.zip, 'SecurityBindings'));

    // нет DataMashup
    let noMash = false; try { const ents = [await zipFinalizeNew(zipNewEntry('xl/workbook.xml', te.encode('<workbook/>'), true))]; await loadBookFromBytes('пусто.xlsx', zipWrite(ents)); } catch (err){ noMash = !!err.noMashup; }
    ok('Книга без Power Query: понятное сообщение', noMash);
    const badBytes = (await makeTestBook()).slice(); const badItem = zipFind(zipRead(badBytes), 'customXml/item1.xml'); badItem.raw[badItem.raw.length >> 1] ^= 0x20;
    let badMsg = ''; try { await loadBookFromBytes('битая.xlsx', badBytes); } catch (err){ badMsg = err.constructor === Error ? err.message : 'не Error: ' + err; }
    ok('Повреждённая часть книги: понятное сообщение, а не внутренняя ошибка', /поврежд/i.test(badMsg), badMsg.slice(0, 90));
    ok('Содержимое листов не читается: текст ячеек тестовой книги не встречается в модели', !JSON.stringify({ s: book.origSection, w: book.warnings, m: book.meta }).includes('Секретные данные листа'));

    // ---------- форматер ----------
    const messy = 'let\n  a = 1,\n        b = {1,\n2},\n c = let x = 1 in x\n   in\n c';
    const fm = formatM(messy), fs = formatM(TEST_SECTION);
    const mixed = 'let\r\n  a = "x\ny",\r\n    b = 1 // заметка   \r\nin\r\n  a & "', fmx = formatM(mixed);
    ok('Форматер: переводы строк внутри строк и незакрытая строка не меняются', /"x\ny"/.test(fmx) && fmx.endsWith('& "') && JSON.stringify(sigTokens(fmx)) === JSON.stringify(sigTokens(mixed)), JSON.stringify(fmx));
    ok('Форматер: значимые токены не меняются, повторное форматирование ничего не меняет', JSON.stringify(sigTokens(fm)) === JSON.stringify(sigTokens(messy)) && formatM(fm) === fm && JSON.stringify(sigTokens(fs)) === JSON.stringify(sigTokens(TEST_SECTION)) && formatM(fs) === fs, fm.replace(/\n/g, '⏎'));
    // ---------- оптимизатор ----------
    const O = optimizeSection(book.origSection, A, lintSection(A));
    const rules = new Set(O.findings.map(f => f.rule));
    ok('Оптимизатор: находит неиспользуемые шаги, слияние SelectRows, Firewall, культуру; оценка 0–100', rules.has('dead-step') && rules.has('merge-SelectRows') && rules.has('firewall') && rules.has('culture') && O.score >= 0 && O.score <= 100 && O.heat.length > 0, [...rules].join(', ') + ' · оценка ' + O.score);
    let fixBad = [];
    for (const f of O.findings.filter(x => x.fix)){ try { const n = f.fix(book.origSection, {}); if (syntaxIssues(n).length || parseSection(n).members.length < A.members.length - 1) fixBad.push(f.rule); } catch (e){ fixBad.push(f.rule + ': ' + e.message); } }
    ok('Оптимизатор: каждое из ' + O.findings.filter(x => x.fix).length + ' автоисправлений даёт синтаксически корректный код', !fixBad.length, fixBad.join('; '));
    const safe = applyAllSafeText(book.origSection, book.meta);
    const A3 = analyzeSection(safe.text, book.meta); const O3 = optimizeSection(safe.text, A3, lintSection(A3));
    ok('Оптимизатор: «все безопасные» применены, оценка выросла, неиспользуемых шагов не осталось', safe.applied.length > 0 && O3.score > O.score && !lintSection(A3).some(l => l.rule === 'dead-step') && /each \(\[Region\] = "North" and \[Amount\] > 2500\) and \(\[OrderDate\] >= #date\(2023, 1, 15\)\)/.test(safe.text), safe.applied.length + ' исправлений · ' + O.score + ' → ' + O3.score);
    const dP = new TokenDict(); const anP = anonymizeM(safe.text, defaultConfig(), dP);
    ok('Значения параметров обезличиваются по месту использования (сервер, база, путь)', !/sql-prod-01|SalesDB|fileserver01|ivanov/.test(anP.out) && (dP.byRaw.get('SalesDB') || {}).cat === 'DB' && (dP.byRaw.get('sql-prod-01.corp.local') || {}).cat === 'SRV', dP.entries.map(e => e.cat + ':' + e.value).slice(0, 8).join(' | '));
    const semSrc = 'section S;\r\n\r\nshared Т = let\r\n    Исх = #table({"x", "y"}, {{1, "a"}, {2, "a"}, {3, "b"}, {4, "a"}}),\r\n    Ф1 = Table.SelectRows(Исх, each [x] > 1),\r\n    Ф2 = Table.SelectRows(Ф1, each [y] = "a"),\r\n    Уд1 = Table.RemoveColumns(Ф2, {"y"}),\r\n    Мусор = 42,\r\n    Типы = Table.TransformColumnTypes(Уд1, {{"x", Int64.Type}})\r\nin\r\n    Типы;\r\n\r\nshared Список = {"a", "b"};\r\n\r\nshared Т2 = let\r\n    Исх = #table({"k"}, {{"a"}, {"c"}}),\r\n    Отбор = Table.SelectRows(Исх, each List.Contains(Список, [k]))\r\nin\r\n    Отбор;\r\n';
    const semAfter = applyAllSafeText(semSrc, {}).text;
    const ev = (sec, q) => mLit(mEval('Table.ToRows(' + q + ')', sec));
    ok('Оптимизатор: безопасные исправления не меняют результат (проверено песочницей)', semAfter !== semSrc && ev(semSrc, 'Т') === ev(semAfter, 'Т') && ev(semSrc, 'Т2') === ev(semAfter, 'Т2') && /List\.Buffer\(Список\)/.test(semAfter) && !/Мусор/.test(semAfter), ev(semAfter, 'Т') + ' · ' + ev(semAfter, 'Т2'));
    const semAll = applyAllSafeText(semSrc, {}); const A4 = analyzeSection(semAll.text, {});
    ok('Оптимизатор: «все безопасные» сходятся — буферизованный список не буферизуется повторно', semAll.applied.length <= 5 && !/_буфер_буфер/.test(semAll.text) && !lintSection(A4).some(l => l.rule === 'list-buffer'), semAll.applied.length + ' исправлений');
    const broken = ['section S;\r\nshared A = let\r\n    x = Table.SelectRows(t, each [a] = 1,\r\n    = 2\r\nin\r\n    x;', 'shared B = let a = Sql.Database("s", "d"', 'section S; shared C = let x = List.Contains(L, [k]), in', 'let ( = 1, x = Excel.Workbook(File.Contents("p") in x'];
    const crash = []; for (const b of broken){ try { const Ab = analyzeSection(b, {}); optimizeSection(b, Ab, lintSection(Ab)); formatM(b); } catch (e){ crash.push(e.message); } }
    ok('Анализ, линтер и оптимизатор не падают на незаконченном коде', !crash.length, crash.join(' | '));
    const viaUse = ['section S;', 'shared Q1 = let', '    Сервер = "SRVBARE77",', '    База = "DBBARE77",', '    Пароль = "Pw77!x",', '    Источник = Sql.Database(Сервер, База),', '    Odbc1 = Odbc.DataSource("dsn=x;pwd=" & Пароль)', 'in', '    Источник;',
      'shared F = (cfg as record) => Sql.Database(cfg[Server], cfg[Database]);', 'shared Q2 = F([Server = "SRVREC77", Database = "DBREC77"]);',
      'shared Q3 = Web.Contents("https://api.example.com", [RelativePath = "clients/Ромашка77/orders", Query = [client = "Клиент77"]]);', ''].join('\r\n');
    const dUse = new TokenDict(); const anUse = anonymizeM(viaUse, defaultConfig(), dUse);
    const leftUse = ['SRVBARE77', 'DBBARE77', 'Pw77!x', 'SRVREC77', 'DBREC77', 'Ромашка77', 'Клиент77'].filter(x => anUse.out.includes(x));
    ok('Обезличивание по месту использования: сервер и пароль в переменных шагов, запись-настройка, RelativePath, Query=[…]', !leftUse.length && restoreTokens(anUse.out, dUse).out === viaUse, leftUse.length ? 'осталось: ' + leftUse.join(', ') : '');
    const preTok = 'section S;\r\nshared A = "⟦UNC_1⟧ и \\\\srv01\\share";';
    const dPre = new TokenDict(); const anPre = anonymizeM(preTok, defaultConfig(), dPre);
    ok('Текст, похожий на метку ⟦…⟧, в исходнике: новые метки с ним не совпадают, обратная подстановка побайтна', restoreTokens(anPre.out, dPre).out === preTok && dPre.size === 1 && !dPre.byToken.has('⟦UNC_1⟧'), anPre.out);
    // ---------- справочники и повторные вычисления (пример: учёт на выгрузках, маппинг статей и ЦФО) ----------
    const ua = ['section S;',
      'shared Маппинг = #table({"Счёт", "Статья"}, {{"60", "Поставщики"}, {"62", "Покупатели"}, {"51", "Банк"}});',
      'shared ЦФО = #table({"Подразделение", "ЦФО"}, {{"Отдел А", "ЦФО-1"}, {"Отдел Б", "ЦФО-2"}});',
      'shared Проекты = #table({"Код", "Проект"}, {{"P1", "Стройка"}, {"P2", "Ремонт"}});',
      'shared Выгрузки = #table({"Дт", "Кт", "Подразделение", "Код", "Дата", "Сумма"}, {{"60", "51", "Отдел А", "P1", 3, 100}, {"62", "60", "Отдел Б", "P2", 1, 250}, {"51", "62", "Отдел А", "P1", 2, 40}, {"60", "99", "Отдел Б", "P2", 4, 7}});',
      'shared Проводки = let', '    Источник = Выгрузки,',
      '    Статья = Table.AddColumn(Источник, "Статья", each Маппинг{[Счёт = [Дт]]}?[Статья]),',
      '    ЦФО1 = Table.AddColumn(Статья, "ЦФО", each Table.SelectRows(ЦФО, (r) => r[Подразделение] = [Подразделение]){0}?[ЦФО], type text),',
      '    Отбор = Table.SelectRows(ЦФО1, each List.Contains(Маппинг[Счёт], [Кт])),',
      '    Сорт = Table.Sort(Отбор, {{"Дата", Order.Ascending}}),',
      '    С_проектом = Table.NestedJoin(Сорт, {"Код"}, Проекты, {"Код"}, "П", JoinKind.LeftOuter)', 'in', '    С_проектом;',
      'shared ОПиУ = Table.Group(Проводки, {"Статья"}, {{"Сумма", each List.Sum([Сумма]), type number}});',
      'shared ДДС = Table.Group(Проводки, {"ЦФО"}, {{"Сумма", each List.Sum([Сумма]), type number}});', ''].join('\r\n');
    const uaFile = ua.replace('shared Выгрузки = #table(', 'shared Выгрузки = let Ф = Folder.Files("C:\\Выгрузки"), К = Table.AddColumn(Ф, "Д", each Excel.Workbook([Content])), Т = #table(').replace(/(\{"60", "99", "Отдел Б", "P2", 4, 7\}\}\));/, '$1 in Т;');
    const uaA = analyzeSection(uaFile, {}); const uaO = optimizeSection(uaFile, uaA, lintSection(uaA)); const uaR = uaO.findings.map(f => f.rule);
    ok('Справочники и повторные вычисления: поиск в справочнике для каждой строки, списки в each, буфер слияния, повторное чтение источника, разбор файлов папки, настройки',
      uaR.filter(r => r === 'row-lookup').length === 2 && ['list-buffer', 'join-buffer', 'multi-eval', 'folder-combine', 'excel-settings', 'useless-sort'].every(r => uaR.includes(r)), uaR.join(', '));
    const uaEv = sec => ['Проводки', 'ОПиУ', 'ДДС'].map(q => mLit(mEval('Table.ToRows(Table.RemoveColumns(' + q + ', {"П"}, MissingField.Ignore))', sec))).join(' | ');
    const uaBase = uaEv(ua); const uaA2 = analyzeSection(ua, {}); const uaBad = [];
    for (const f of optimizeSection(ua, uaA2, lintSection(uaA2)).findings.filter(f => f.fix && ['row-lookup', 'list-buffer', 'join-buffer'].includes(f.rule)))
      for (const method of f.options ? ['merge', 'buffer'] : ['']){ const n = f.fix(ua, { method }); if (syntaxIssues(n).length || uaEv(n) !== uaBase) uaBad.push(f.rule + (method ? ':' + method : '')); }
    let uaT = ua; for (let i = 0; i < 10; i++){ const AA = analyzeSection(uaT, {}); const f = optimizeSection(uaT, AA, lintSection(AA)).findings.find(x => x.fix && ['row-lookup', 'list-buffer', 'join-buffer'].includes(x.rule)); if (!f) break; uaT = f.fix(uaT, { method: 'merge' }); }
    ok('Ускорения поиска в справочниках (слияние, буферы) не меняют итоговые таблицы — проверено песочницей', !uaBad.length && uaEv(uaT) === uaBase && /Table\.NestedJoin\(Источник, \{"Дт"\}, Table\.Distinct\(Маппинг/.test(uaT), uaBad.join(', ') || uaBase.slice(0, 80));
    const uaH = ua.replace('each Маппинг{[', 'each Table.Buffer(Маппинг){['); const uaHs = applyAllSafeText(uaH, {});
    ok('Буфер внутри each выносится в отдельный шаг безопасно — отчёты те же', uaHs.applied.some(x => /Вынести буфер/.test(x)) && !/each Table\.Buffer/.test(uaHs.text) && uaEv(uaHs.text) === uaBase, uaHs.applied.join(' · '));
    const lr = (lines) => { const t = ['section S;', ...lines, ''].join('\r\n'); return lintSection(analyzeSection(t, {})).map(l => l.rule); };
    const lr1 = lr(['shared Q = let', '    И = Csv.Document(File.Contents("a.csv")),', '    Н = Table.AddColumn(И, "Доля", each [Сумма] / 100),', '    Ф = Table.SelectRows(Н, each [Год] = 2024),', '    У = Table.RemoveColumns(Ф, {"Комментарий"})', 'in', '    У;']);
    const lr2 = lr(['shared Q = let', '    И = Csv.Document(File.Contents("a.csv")),', '    Н = Table.AddColumn(И, "Доля", each [Сумма] / 100),', '    Т = Table.TransformColumnTypes(Н, {{"Год", Int64.Type}}),', '    Ф = Table.SelectRows(Т, (r) => List.Contains(Record.FieldValues(r), 2024))', 'in', '    Ф;']);
    ok('Поздние фильтры и столбцы: совет есть, где перенос не меняет результат, и нет, где меняет', lr1.includes('late-filter') && lr1.includes('late-columns') && !lr2.includes('late-filter'), lr1.join(',') + ' / ' + lr2.join(','));
    // ---------- рефакторинг ----------
    const r1 = renameStep(semSrc, 'Т', 'Ф1', 'Больше единицы');
    const r2 = renameQuery(r1, 'Список', 'Коды');
    const r3 = extractSteps(r2, 'Т', 'Ф2', 'Т_База');
    const r4 = duplicateQuery(r3, 'Т2', 'Т2 копия');
    ok('Рефакторинг: переименование шага и запроса, вынос шагов, дублирование — результат тот же', /#"Больше единицы"/.test(r1) && /List\.Contains\(Коды/.test(r2) && /shared Т_База = let/.test(r3) && ev(r3, 'Т') === ev(semSrc, 'Т') && ev(r4, '#"Т2 копия"') === ev(semSrc, 'Т2'));
    const mT = parseSection(semSrc).members.find(m => m.name === 'Т'); const lit = semSrc.indexOf('"a"}, {2', mT.exprStart) ;
    const pos42 = semSrc.indexOf('42'); const r5 = toFunction(semSrc, 'Т', pos42, pos42 + 2, 'n');
    ok('Рефакторинг: литерал → параметр функции; удаление запроса', /shared Т = \(n as number\) =>/.test(r5) && mLit(mEval('Table.RowCount(Т(42))', r5)) === '2' && !parseSection(deleteQuery(semSrc, 'Т2')).members.some(m => m.name === 'Т2') && lit > 0);
    const withCmt = replaceMemberExpr(semSrc, 'Список', '{"a", "b"} // комментарий в конце');
    const withCmt2 = mergeIntoBase(semSrc, [{ name: 'Список', expr: ' {"a"} // хвост' }], new Set(), false);
    ok('Комментарий «//» в конце запроса не съедает «;» (запросы не склеиваются)', parseSection(withCmt).members.length === 3 && parseSection(withCmt2).members.length === 3 && mLit(mEval('Список', withCmt)) === '{"a", "b"}');
    let renameErr = false; try { renameQuery(semSrc, 'Т', 'Т2'); } catch { renameErr = true; }
    ok('Рефакторинг: конфликт имён отклоняется понятной ошибкой', renameErr);
    // ---------- сниппеты ----------
    const snipBad = [];
    for (const sn of SNIPPETS){ const v = Object.fromEntries(sn.fields.map(f => [f.k, f.type === 'select' ? f.opts[0][0] : f.def || 'Запрос1'])); try { const code = sn.gen(v); mParse(code); if (syntaxIssues(code).length) snipBad.push(sn.id); } catch (e){ snipBad.push(sn.id + ': ' + e.message); } }
    const cal = SNIPPETS.find(x => x.id === 'calendar').gen({ from: '2024-02-27', to: '2024-03-02', culture: 'ru-RU' });
    ok('Сниппеты: все ' + SNIPPETS.length + ' шаблонов дают разбираемый код; календарь вычисляется (5 дней, 29 февраля)', !snipBad.length && mLit(mEval('Table.RowCount(' + cal + ')')) === '5' && /2024-02-29/.test(mLit(mEval('Table.Column(' + cal + ', "Дата")'))), snipBad.join('; '));
    // ---------- интерпретатор ----------
    const IC = [['List.Sum({1..10})', '55'], ['Text.Proper("иван петров")', '"Иван Петров"'], ['Number.Round(2.5)', '2'], ['Date.AddMonths(#date(2024,1,31), 1)', '2024-02-29'], ['try error "x" otherwise "y"', '"y"'], ['Table.Group(#table({"k","v"},{{"a",1},{"b",2},{"a",3}}), {"k"}, {{"s", each List.Sum([v])}})[s]', '{4, 2}'], ['Table.ExpandTableColumn(Table.NestedJoin(#table({"k"},{{1},{2}}), {"k"}, #table({"k","n"},{{1,"x"}}), {"k"}, "j", JoinKind.LeftOuter), "j", {"n"})[n]', '{"x", null}'], ['List.Generate(() => 1, each _ < 4, each _ + 1)', '{1, 2, 3}']];
    const icBad = IC.filter(([e, r]) => { try { return mLit(mEval(e)) !== r; } catch { return true; } }).map(x => x[0]);
    let dsErr = ''; try { mEval('Sql.Database("s", "d")'); } catch (e){ dsErr = e.reason; }
    const steps = mRunSteps(book.origSection, 'Продажи', { steps: new Map([['Источник', tableFromRows([['Region', 'Amount', 'OrderDate', 'Код'], ['North', '3000', '2023-06-01', '1'], ['South', '9000', '2023-06-01', '2'], ['North', '100', '2023-06-01', '3']])]]) });
    ok('Песочница: ' + IC.length + ' выражений, источники недоступны, пошаговый прогон запроса на образце', !icBad.length && dsErr === 'DataSource.Error' && !steps.some(s => s.error) && mToText(steps[steps.length - 1].value) === 'Table (1×4)', icBad.join(' | ') + ' · ' + steps.map(s => s.name + (s.error ? '✖' : '✔')).join(' '));
    const errOf = x => { try { mEval(x, null); return 'нет ошибки'; } catch (e){ return (e instanceof MErr ? '' : 'не MErr: ') + e.message; } };
    const e1 = errOf('Text.Split(null, ",")'), e2 = errOf('Text.Start("abc")'), e3 = errOf('let f = (n) => @f(n + 1) in f(1)');
    ok('Песочница: ошибки встроенных функций и рекурсии — понятные ошибки M с именем функции', /^Text\.Split: /.test(e1) && /^Text\.Start: /.test(e2) && /рекурсия/.test(e3) && mLit(mEval('try Text.Split(null, ",") otherwise "ok"', null)) === '"ok"', [e1, e2, e3].join(' | '));
    // ---------- справочник ----------
    ok('Справочник: ' + M_REF.size + ' функций, сигнатуры разобраны', M_REF.size > 300 && M_REF.get('Table.AddColumn').params.length === 4 && M_REF.get('Table.AddColumn').params[3].optional);
    // ---------- состояние, история, документация (с сохранением и восстановлением S) ----------
    const keep = {}; for (const k of ['book', 'work', 'saved', 'A', 'lint', 'opt', 'sel', 'hist', 'histPos', 'anon', 'scan', '_anonKey', 'dict', 'dictSource', 'cfg']) keep[k] = S[k];
    const quiet = _listeners.splice(0, _listeners.length);
    try {
      S.dict = new TokenDict(); S.cfg = defaultConfig(); S.cfg.blacklist = ['ООО Ромашка'];
      initBookState(book);
      const t2 = safe.text.replace(/\s*$/, '') + '\r\n// правка\r\n';
      setWork(safe.text, 'optimizer', 'тест'); setWork(t2, 'refactor', 'тест 2');
      const okHist = S.hist.length === 3 && isDirty() && (histGo(0), S.work === book.origSection && !isDirty()) && (histGo(2), S.work === t2);
      ok('История правок: записи, откат и возврат, индикатор «изменено»', okHist);
      const docA = genBookDoc({ anon: true, code: true }); const docF = genBookDoc({ anon: false, code: true });
      const leakD = TEST_SECRETS.filter(x => docA.full.includes(x.replace(/\\/g, '\\')) || docA.md.includes(x));
      ok('Документация книги: обезличенная версия без секретов, полная — с кодом', !leakD.length && docF.full.includes('sql-prod-01.corp.local') && /<svg/.test(docA.full), leakD.join(', '));
      const pkg = buildPackage(); const pkgText = stringsOf(pkg).join('\n');
      ok('Пакет для ИИ: секретов нет, сканер чист', !TEST_SECRETS.some(x => pkgText.includes(x)) && !scanLeaks(pkgText, S.cfg, S.dict).some(f => f.sev === 'crit'));
      const ans = checkAiAnswer(book.origSection, '```m\nshared Продажи = let\n    Источник = Sql.Database("⟦SRV_1⟧", "⟦DB_1⟧"),\n    Итог = Table.FirstN(Источник, 5)\nin\n    Итог;\n```', S.dict, {});
      ok('Ответ ИИ: метки восстановлены, запрос заменён, остальные сохранены', !ans.errors.length && ans.newSection.includes('Sql.Database("sql-prod-01.corp.local", "SalesDB")') && compareSections(book.origSection, ans.newSection).changed.length === 1, ans.errors.join('; '));
    } finally { Object.assign(S, keep); _listeners.push(...quiet); }
    // ---------- IndexedDB ----------
    let idbOk = false; try { await idbTx('readwrite', st => st.put({ id: '__selftest', name: 'x', lastOpened: 0 })); idbOk = (await recentList()).some(e => e.id === '__selftest'); await recentDelete('__selftest'); idbOk = idbOk && !(await recentList()).some(e => e.id === '__selftest'); } catch (e){ idbOk = 'нет IndexedDB: ' + e.message; }
    ok('Недавние файлы: IndexedDB доступна, запись и удаление работают', idbOk === true, idbOk === true ? '' : String(idbOk));
  } catch (err){ console.error(err); ok('Исключение во время самотеста', false, err.stack || String(err)); }
  const passed = R.filter(r => r.pass).length;
  return { R, passed, total: R.length, ms: Math.round(performance.now() - t0) };
}
async function runSelfTestUI(){
  $('#selfTestBox').innerHTML = '<div class="card">Выполняется…</div>';
  const res = await runSelfTest(); window.__pqmSelfTest = res;
  $('#selfTestBox').innerHTML = '<div class="card"><div class="note ' + (res.passed === res.total ? 'ok' : 'bad') + '"><b>' + (res.passed === res.total ? '✔ Все проверки пройдены' : '⛔ Есть ошибки') + ':</b> ' + res.passed + ' из ' + res.total + ' · ' + res.ms + ' мс</div><table class="t">' + res.R.map(r => '<tr><td class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✔' : '✘') + '</td><td>' + escHtml(r.name) + (r.detail ? '<div class="small muted mono">' + escHtml(r.detail) + '</div>' : '') + '</td></tr>').join('') + '</table></div>';
  emitState('selftest');
}
$('#runSelfTest').onclick = runSelfTestUI;
$('#dlTestBook').onclick = async () => download('pq-master_тестовая_книга.xlsx', new Blob([await makeTestBook()]));
registerView('selftest', { render: () => {} });
