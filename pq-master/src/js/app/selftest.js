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

/** extra — дополнительные части [имя, содержимое] (одноимённые заменяют стандартные), section — свой Section1.m */
async function makeTestBook(extra, section){
  const x = s => te.encode(s);
  const ctPkg = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>';
  const pkgXml = '<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Version>2.141.0</Version><MinVersion>2.21.0</MinVersion><Culture>ru-RU</Culture></Package>';
  const parts = [];
  parts.push(await zipFinalizeNew(zipNewEntry('[Content_Types].xml', x(ctPkg), true)));
  parts.push(await zipFinalizeNew(zipNewEntry('Config/Package.xml', x(pkgXml), true)));
  parts.push(await zipFinalizeNew(zipNewEntry('Formulas/Section1.m', x(section || TEST_SECTION), true)));
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
  const ex = new Map((extra || []).map(([n, c]) => [n, c]));
  for (const [n, c] of files.map(([n, c]) => [n, ex.has(n) ? ex.get(n) : c]).concat((extra || []).filter(([n]) => !files.some(f => f[0] === n)))) ents.push(await zipFinalizeNew(zipNewEntry(n, typeof c === 'string' ? x(c) : c, true)));
  return zipWrite(ents);
}
/** Тестовая книга .xlsx с данными: листы { name, rows } (строки, числа, даты {d:'ГГГГ-ММ-ДД'}), таблицы { sheet, name, ref, cols, totals }
    и именованные диапазоны { name, ref } — для проверок Excel.CurrentWorkbook и Excel.Workbook */
async function makeTestXlsx(spec){
  const x = s => te.encode(s); const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const ss = []; const ssi = v => { let i = ss.indexOf(v); if (i < 0){ ss.push(v); i = ss.length - 1; } return i; };
  const colL = i => { let s = ''; i++; while (i){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const serial = d => (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000) + 25569;
  const files = [];
  const sheetXml = rows => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>' +
    rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => { const ref = colL(ci) + (ri + 1); if (v == null) return ''; if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>'; if (typeof v === 'object') return '<c r="' + ref + '" s="1"><v>' + serial(v.d) + '</v></c>'; return '<c r="' + ref + '" t="s"><v>' + ssi(v) + '</v></c>'; }).join('') + '</row>').join('') + '</sheetData><tableParts count="0"/></worksheet>';
  let tn = 0;
  spec.sheets.forEach((sh, i) => {
    const tabs = (spec.tables || []).filter(t => t.sheet === sh.name);
    let xml = sheetXml(sh.rows);
    if (tabs.length){ xml = xml.replace('<tableParts count="0"/>', '<tableParts count="' + tabs.length + '">' + tabs.map((_, k) => '<tablePart r:id="rT' + k + '"/>').join('') + '</tableParts>');
      files.push(['xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + tabs.map((t, k) => '<Relationship Id="rT' + k + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table' + (tn + k + 1) + '.xml"/>').join('') + '</Relationships>']);
      tabs.forEach((t, k) => files.push(['xl/tables/table' + (tn + k + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="' + (tn + k + 1) + '" name="Table' + (tn + k + 1) + '" displayName="' + esc(t.name) + '" ref="' + t.ref + '"' + (t.totals ? ' totalsRowCount="1"' : '') + '><tableColumns count="' + t.cols.length + '">' + t.cols.map((c, j) => '<tableColumn id="' + (j + 1) + '" name="' + esc(c) + '"/>').join('') + '</tableColumns></table>']));
      tn += tabs.length; }
    files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', xml]);
  });
  files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + spec.sheets.map((sh, i) => '<sheet name="' + esc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
    ((spec.names || []).length ? '<definedNames>' + spec.names.map(n => '<definedName name="' + esc(n.name) + '">' + esc(n.ref) + '</definedName>').join('') + '<definedName name="_xlnm._FilterDatabase" hidden="1">Лист1!$A$1:$B$2</definedName></definedNames>' : '') + '</workbook>']);
  files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + spec.sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>']);
  files.push(['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>']);
  files.push(['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ss.map(v => '<si><t xml:space="preserve">' + esc(v) + '</t></si>').join('') + '</sst>']);
  const ents = []; for (const [n, c] of files) ents.push(await zipFinalizeNew(zipNewEntry(n, x(c), true)));
  return zipWrite(ents);
}
/** Тестовый xl/vbaProject.bin: составной файл OLE v3 (сектор 512, мини-сектор 64) с хранилищем VBA,
    потоком dir и модулем Module1 в кодировке codePage; сжатие MS-OVBA — только литералы */
function makeTestVba(source, codePage){
  const enc = str => encodeCodePage(str, codePage);
  const pack = bytes => { const body = []; for (let i = 0; i < bytes.length; i += 8){ body.push(0); for (let j = i; j < Math.min(i + 8, bytes.length); j++) body.push(bytes[j]); } const h = (body.length - 1) | (3 << 12) | (1 << 15); return Uint8Array.from([1, h & 255, h >> 8, ...body]); };
  const rec = (id, data) => concatBytes([Uint8Array.of(id & 255, id >> 8), u32le(data.length), data]);
  const dir = pack(concatBytes([rec(0x0003, Uint8Array.of(codePage & 255, codePage >> 8)), rec(0x0019, enc('Module1')), rec(0x001A, enc('Module1')), rec(0x0031, u32le(0)), rec(0x002B, new Uint8Array(0))]));
  const mod = pack(enc(source.replace(/\r?\n/g, '\r\n')));
  const pad = (b, n) => concatBytes([b, new Uint8Array((n - b.length % n) % n)]);
  const mini = concatBytes([pad(dir, 64), pad(mod, 64)]); const dirMini = Math.ceil(dir.length / 64), modMini = Math.ceil(mod.length / 64);
  const miniFat = []; for (let i = 0; i < dirMini + modMini; i++) miniFat.push(i === dirMini - 1 || i === dirMini + modMini - 1 ? 0xFFFFFFFE : i + 1);
  const miniSecs = Math.ceil(mini.length / 512); const S_MF = miniSecs, S_DIR = miniSecs + 1, S_FAT = miniSecs + 2;
  const fat = []; for (let i = 0; i < miniSecs; i++) fat.push(i === miniSecs - 1 ? 0xFFFFFFFE : i + 1); fat.push(0xFFFFFFFE, 0xFFFFFFFE, 0xFFFFFFFD);
  const words = (arr, n) => { const b = new Uint8Array(n); const dv = new DataView(b.buffer); for (let i = 0; i < n / 4; i++) dv.setUint32(i * 4, i < arr.length ? arr[i] : 0xFFFFFFFF, true); return b; };
  const ent = (name, type, left, right, child, start, size) => { const e = new Uint8Array(128); const dv = new DataView(e.buffer); [...name].forEach((ch, i) => dv.setUint16(i * 2, ch.charCodeAt(0), true)); dv.setUint16(64, name ? (name.length + 1) * 2 : 0, true); e[66] = type; e[67] = 1; dv.setUint32(68, left, true); dv.setUint32(72, right, true); dv.setUint32(76, child, true); dv.setUint32(116, start, true); dv.setUint32(120, size, true); return e; };
  const F = 0xFFFFFFFF;
  const dirSec = concatBytes([ent('Root Entry', 5, F, F, 1, 0, mini.length), ent('VBA', 1, F, F, 2, 0, 0), ent('dir', 2, F, 3, F, 0, dir.length), ent('Module1', 2, F, F, F, dirMini, mod.length)]);
  const hdr = new Uint8Array(512); const hv = new DataView(hdr.buffer);
  hdr.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]); hv.setUint16(24, 0x3E, true); hv.setUint16(26, 3, true); hv.setUint16(28, 0xFFFE, true); hv.setUint16(30, 9, true); hv.setUint16(32, 6, true);
  hv.setUint32(44, 1, true); hv.setUint32(48, S_DIR, true); hv.setUint32(56, 4096, true); hv.setUint32(60, S_MF, true); hv.setUint32(64, 1, true); hv.setUint32(68, 0xFFFFFFFE, true);
  for (let i = 0; i < 109; i++) hv.setUint32(76 + i * 4, i === 0 ? S_FAT : F, true);
  return concatBytes([hdr, pad(mini, 512), words(miniFat, 512), dirSec, words(fat, 512)]);
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
    ok('Модель книги хранит только код и метаданные: текст ячеек листа в неё не попадает (данные — отдельно, локально)', !JSON.stringify({ s: book.origSection, w: book.warnings, m: book.meta }).includes('Секретные данные листа'));

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
    const od1 = lr(['shared Q = let', '    И = OData.Feed("http://srv/base/odata/standard.odata/AccumulationRegister_Продажи", null, [Implementation = "2.0"]),', '    Т = Table.TransformColumnTypes(И, {{"Сумма", type number}})', 'in', '    Т;']);
    const od2 = lr(['shared Q = let', '    И = OData.Feed("http://srv/base/odata/standard.odata/AccumulationRegister_Продажи", null, [Implementation = "2.0"]),', '    П = Table.SelectColumns(И, {"Period", "Сумма"}),', '    Ф = Table.SelectRows(П, each [Period] >= #datetime(2024, 1, 1, 0, 0, 0))', 'in', '    Ф;']);
    ok('OData / 1С: совет загрузить только нужные поля и строки — есть без отбора и нет, когда отбор сразу после источника', od1.includes('odata-load-all') && !od2.includes('odata-load-all'), od1.join(',') + ' / ' + od2.join(','));
    // ---------- как обновляется книга: макросы и подключения ----------
    const vbaSrc = 'Attribute VB_Name = "Module1"\n\' Обновление отчёта\nSub ОбновитьВсё()\n    ThisWorkbook.Connections("Запрос — Продажи").OLEDBConnection.BackgroundQuery = False\n    ActiveWorkbook.RefreshAll\n    Sheets("Отчёт").ListObjects(1).QueryTable.Refresh BackgroundQuery:=False\n    ThisWorkbook.RefreshAll \' ещё раз\n    For Each pc In ThisWorkbook.PivotCaches\n        pc.Refresh\n    Next\nEnd Sub';
    const connXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" keepAlive="1" name="Запрос — Продажи" type="5" refreshedVersion="8" background="1" saveData="1" refreshOnLoad="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Продажи;Extended Properties=&quot;&quot;" command="SELECT * FROM [Продажи]"/></connection></connections>';
    const xlsm = await loadBookFromBytes('макрос.xlsm', await makeTestBook([['xl/vbaProject.bin', makeTestVba(vbaSrc, 1251)], ['xl/connections.xml', connXml]]));
    const bri = bookRefreshIssues(xlsm).map(i => i.key);
    const pp = parsePermissions('<PermissionList xmlns:xsi="x"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>false</FirewallEnabled><WorkbookGroupType xsi:nil="true" /></PermissionList>');
    ok('Флаг «игнорировать уровни конфиденциальности» книги читается из Permissions (MS-QDEFF)', pp.firewall === false && xlsm.privacy && xlsm.privacy.firewall === true, JSON.stringify(pp) + ' / ' + JSON.stringify(xlsm.privacy));
    ok('Макросы и подключения: VBA (кодовая страница 1251) прочитан, найдены двойной RefreshAll, повторное обновление, сводные, синхронное обновление, обновление при открытии',
      xlsm.vba && xlsm.vba.modules[0] && /ОбновитьВсё/.test(xlsm.vba.modules[0].code) && xlsm.conns.length === 1 && xlsm.conns[0].query === 'Продажи' && ['macro-refreshall-twice', 'macro-refresh-again', 'macro-pivot-again', 'macro-sync', 'conn-refresh-on-open'].every(k => bri.includes(k)), bri.join(', ') + (xlsm.vba && xlsm.vba.error ? ' · ' + xlsm.vba.error : ''));
    // ---------- настройки PQ и Excel: флаги подключений в файле, генерируемый макрос ----------
    const x15 = (id, ex) => '<extLst><ext uri="{DE250136-89BD-433C-8126-D09CA5730AF9}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:connection id=""' + (ex ? ' excludeFromRefreshAll="1"' : '') + '/></ext></extLst>';
    const cx2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="Запрос — Продажи" type="5" refreshedVersion="8" background="1" saveData="1" refreshOnLoad="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Продажи"/>' + x15('1', false) + '</connection><connection id="2" name="Запрос — Курсы" type="5" refreshedVersion="8" saveData="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Курсы"/>' + x15('2', true) + '</connection><connection id="3" name="Запрос — Старый" type="5" refreshOnLoad="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Location=Старый"/></connection></connections>';
    const ed = { '1': { refreshOnLoad: false, excluded: true, background: false }, '2': { excluded: false, background: true }, '3': { refreshOnLoad: false, excluded: true } };
    const cx3 = applyConnEdits(cx2, ed); const pc3 = parseConnections(cx3);
    const strip = t => t.replace(/\s+(refreshOnLoad|background|excludeFromRefreshAll)="[^"]*"/g, '');
    ok('Флаги подключений: «при открытии», «фоновое», «Обновить всё» меняются, остальной текст connections.xml — байт в байт; без x15:connection флаг исключения не пишется',
      !pc3[0].refreshOnLoad && pc3[0].excluded && !pc3[0].background && !pc3[1].excluded && pc3[1].background && !pc3[2].refreshOnLoad && !pc3[2].excluded && !/excludeFromRefreshAll/.test(cx3.split('id="3"')[1]) && strip(cx3) === strip(cx2) && applyConnEdits(cx2, {}) === cx2, JSON.stringify(pc3.map(c => [c.refreshOnLoad, c.excluded, c.background])));
    const bk2 = await loadBookFromBytes('настройки.xlsx', await makeTestBook([['xl/connections.xml', cx2]]));
    const out2 = await buildBookWithSection(bk2, bk2.origSection, { conns: { '1': { refreshOnLoad: false } } }); const re2 = await loadBookFromBytes('настройки.xlsx', out2);
    const sameItem = bytesEqual(await zipEntryBytes(zipFind(re2.zip, bk2.itemEntry.name)), await zipEntryBytes(bk2.itemEntry));
    const out3 = await buildBookWithSection(bk2, bk2.origSection + '\r\n'); const re3 = await loadBookFromBytes('настройки.xlsx', out3);
    ok('Код не менялся — DataMashup переносится байт в байт (флаг конфиденциальности книги сохраняется), правка подключений проверяется перечитыванием',
      sameItem && re2.origSection === bk2.origSection && !re2.conns[0].refreshOnLoad && re2.conns[1].excluded && re3.conns[0].refreshOnLoad && re3.origSection === bk2.origSection + '\r\n', 'item ' + sameItem);
    const mac = genPqMacro({ refresh: true, timing: true, fastCombine: true, setup: { exclude: ['Запрос — Курсы', 'Q "x" 漢'] }, codePage: 1251, forFile: true });
    const macLines = mac.split('\r\n'); const cnt = re => macLines.filter(l => re.test(l)).length;
    const macBack = new TextDecoder('windows-1251').decode(encodeCodePage(mac, 1251));
    ok('Макрос PQMaster: процедуры закрыты, CRLF, имена подключений в кавычках (символы вне cp1251 — через ChrW), текст кодируется в cp1251 без потерь',
      /^Attribute VB_Name = "PQMaster"\r\n/.test(mac) && !/[^\r]\n/.test(mac) && cnt(/^(Public |Private )?Sub /) === cnt(/^End Sub$/) && cnt(/^(Public |Private )?Function /) === cnt(/^End Function$/) && cnt(/^\s*For (Each )?/) === cnt(/^\s*Next\b/) &&
      mac.includes('Case "Запрос — Курсы": cn.RefreshWithRefreshAll = False') && mac.includes('Case "Q ""x"" " & ChrW(28450): cn.RefreshWithRefreshAll = False') && /FastCombine = True/.test(mac) && macBack === mac && !/Attribute/.test(genPqMacro({ codePage: 1251 })), macLines.filter(l => /Case/.test(l)).join(' | '));
    // ---------- данные на этом компьютере: таблицы книги, выгрузки, соединения, защита от утечки ----------
    const keepData = { wb: DATA.wb, wbFor: DATA.wbFor, files: DATA.files, folders: DATA.folders, run: DATA.run, verify: DATA.verify, selfBook: DATA.selfBook };
    try {
      const dx = await makeTestXlsx({ sheets: [
        { name: 'Справочники', rows: [['Код', 'Статья', 'ЦФО'], [101, 'Выручка', 'Продажи'], [102, 'Аренда', 'АХО'], [102, 'Аренда дубль', 'АХО'], ['Итого', null, null], [], ['Дата', 'Курс'], [{ d: '2024-03-31' }, 92.5]] },
        { name: 'Пусто', rows: [] }],
        tables: [{ sheet: 'Справочники', name: 'Маппинг', ref: 'A1:C5', cols: ['Код', 'Статья', 'ЦФО'], totals: true }], names: [{ name: 'Курсы', ref: 'Справочники!$A$7:$B$8' }] });
      const xd = await readXlsxData(zipRead(dx), {});
      const mp = xd.tables.find(t => t.name === 'Маппинг'), kr = xd.names.find(n => n.name === 'Курсы');
      ok('Таблицы книги: таблица Excel (без строки итогов), именованный диапазон, дата по формату ячейки, используемый диапазон листа',
        mp && mp.rows.length === 3 && mp.cols.join() === 'Код,Статья,ЦФО' && mp.rows[2][1] === 'Аренда дубль' && kr && kr.rows[1][0].kind === 'date' && xd.sheets[0].rows.length === 8 && xd.sheets[1].rows.length === 0 && !xd.names.some(n => /_xlnm/.test(n.name)), JSON.stringify(mp && mp.rows));
      DATA.wb = { tables: xd.tables, names: xd.names, sheets: [] }; DATA.files = new Map(); DATA.folders = new Map(); DATA.run = null;
      const cw = mEval('let М = Excel.CurrentWorkbook(){[Name="Маппинг"]}[Content], К = Excel.CurrentWorkbook(){[Name="Курсы"]}[Content] in [Строк = Table.RowCount(М), Итог = List.Sum(М[Код]), Дата = Date.ToText(Table.PromoteHeaders(К){0}[Дата], "dd.MM.yyyy")]', '');
      ok('Excel.CurrentWorkbook: запрос вычисляется на таблицах книги', cw.get('Строк') === 3 && cw.get('Итог') === 305 && cw.get('Дата') === '31.03.2024', mLit(cw));
      const csv1251 = encodeCodePage('Счёт;Сумма;Контрагент\r\n90.01;1 000,50;"ООО ""Ромашка-Север"""\r\n62;-200;ИП Иванов\r\n', 1251);
      DATA.files.set(normPath('C:\\Выгрузки\\ОСВ.csv'), { name: 'ОСВ.csv', bytes: csv1251, mtime: 0 });
      DATA.folders.set(normPath('D:\\Банк\\'), [{ name: 'выписка1.csv', bytes: te.encode('a,b\n1,2\n'), mtime: 0 }, { name: 'выписка2.csv', bytes: te.encode('a,b\n3,4\n'), mtime: 0 }]);
      DATA.files.set('name:справочник.xlsx', { name: 'Справочник.xlsx', bytes: dx, mtime: 0, xlsx: xd });
      const fc = mEval('let Т = Table.PromoteHeaders(Csv.Document(File.Contents("c:/выгрузки/осв.csv"), [Delimiter = ";", Encoding = 1251])), П = Folder.Files("D:\\Банк"), Ф = Table.AddColumn(П, "Д", each Table.PromoteHeaders(Csv.Document([Content]))), Р = Table.Combine(Ф[Д]), К = Excel.Workbook(File.Contents("\\\\srv\\share\\Справочник.xlsx"), true){[Item="Справочники", Kind="Sheet"]}[Data] in [Контрагент = Т{0}[Контрагент], Строк = Table.RowCount(Т), Банк = List.Sum(List.Transform(Р[a], Number.From)), Статья = К{0}[Статья]]', '');
      let needErr = null; try { mEval('File.Contents("C:\\нет\\файла.csv")', ''); } catch (e){ needErr = e; }
      ok('Выгрузки на этом компьютере: CSV в cp1251 (кавычки), файлы папки, книга XLSX по имени; чего нет — DataSource.Error с путём',
        fc.get('Контрагент') === 'ООО "Ромашка-Север"' && fc.get('Строк') === 2 && fc.get('Банк') === 4 && fc.get('Статья') === 'Выручка' && needErr && needErr.reason === 'DataSource.Error' && needErr.need && needErr.need.path === 'C:\\нет\\файла.csv', mLit(fc) + ' / ' + (needErr && needErr.message));
      // соединение на хеше = перебору; трассировка: дубли ключей, строки без пары, разные типы
      const jl = []; M_TRACE = { join: j => jl.push(j) };
      let jv; try { jv = mEval('let Л = #table({"Код","Сумма"}, {{101, 10}, {102, 20}, {"101", 5}, {null, 1}, {103, 7}}), П = Excel.CurrentWorkbook(){[Name="Маппинг"]}[Content], С = Table.NestedJoin(Л, {"Код"}, П, {"Код"}, "М", JoinKind.LeftOuter), Р = Table.ExpandTableColumn(С, "М", {"Статья"}) in [Строк = Table.RowCount(Р), Сумма = List.Sum(Р[Сумма]), Без = Table.RowCount(Table.SelectRows(Р, each [Статья] = null)), Г = Table.RowCount(Table.Group(Р, {"Код"}, {{"Н", Table.RowCount}})), Р1 = Р{0}[Статья]]', ''); jv.names.forEach(n => jv.get(n)); } finally { M_TRACE = null; }   // поля записи ленивые — вычислить при включённой трассировке
      const j0 = jl[0] || {};
      ok('Слияние и группировка по хешу: результат как у перебора; на данных видны дубли ключей и строки без пары',
        jv.get('Строк') === 6 && jv.get('Сумма') === 63 && jv.get('Без') === 3 && jv.get('Г') === 5 && jv.get('Р1') === 'Выручка' && j0.dupKeys === 1 && j0.dupRows === 2 && j0.miss === 3 && j0.left === 5, mLit(jv) + ' / ' + JSON.stringify(j0));
      const lk = mEval('let П = Excel.CurrentWorkbook(){[Name="Маппинг"]}[Content] in {П{[Код=101]}[Статья], try П{[Код=102]}[Статья] otherwise "дубль", П{[Код=999]}?}', '');
      ok('Поиск в справочнике Т{[Код=…]} по индексу: найдено, дубль ключа — ошибка, нет ключа с ? — null', lk[0] === 'Выручка' && lk[1] === 'дубль' && lk[2] === null, mLit(lk));
      const leaks = dataLeaks('{"query":"⟦Q_1⟧","note":"ООО \\"Ромашка-Север\\"","col":"Контрагент"}\nАренда дубль\n');
      ok('Защита от утечки: значения из данных в исходящем тексте найдены (JSON и строки), заголовки столбцов — нет',
        leaks.some(l => l.match === 'ООО "Ромашка-Север"') && leaks.some(l => l.match === 'Аренда дубль') && !leaks.some(l => l.match === 'Контрагент') && !dataLeaks('{"rows": 3, "q": "⟦Q_1⟧"}').length, leaks.map(l => l.match).join(' | '));
      const T1 = mEval('#table({"a","b"}, {{1,"x"},{2,"y"}})', ''), T2 = mEval('#table({"b","a"}, {{"y",2},{"x",1}})', ''), T3 = mEval('#table({"a","b"}, {{1,"x"},{2,"y"},{2,"y"}})', '');
      const c1 = tableCompare(T1, T1), c2 = tableCompare(T1, T2), c3 = tableCompare(T1, T3);
      ok('Сверка результатов до и после исправления: полностью / другой порядок / отличается', c1.same && c1.exact && c2.same && !c2.exact && !c3.same && /появилось 1/.test(c3.note), [c1, c2, c3].map(c => JSON.stringify(c)).join(' '));
      // регрессии ревью: правое соединение, дата со временем, таблица при лимите строк, cp866, CSV с кавычками в защите от утечки
      const ro = mEval('Table.RowCount(Table.NestedJoin(#table({"k"}, {{1}, {2}}), {"k"}, #table({"k"}, {{1}, {3}}), {"k"}, "R", JoinKind.RightOuter))', '');
      const dt = xlsxValueToM({ xd: 45000.75, kind: 'date' }), old = xlsxValueToM({ xd: 1, kind: 'date' });
      const xd5 = await readXlsxData(zipRead(dx), { maxRows: 3 }); const mp5 = xd5.tables.find(t => t.name === 'Маппинг');
      DATA.files.set(normPath('C:\\к.txt'), { name: 'к.txt', bytes: Uint8Array.of(0x8F, 0xE0, 0xA8, 0xA2, 0xA5, 0xE2), mtime: 0 });
      const k866 = mEval('Text.FromBinary(File.Contents("C:\\к.txt"), 866)', '');
      DATA.files.set('name:квоты.csv', { name: 'квоты.csv', bytes: te.encode('Имя;Сумма\r\n"Ромашка, ООО";10\r\n'), mtime: 0 });
      ok('Регрессии: RightOuter без лишних строк, дата с временем — тот же день, 1 января 1900, таблица не дополняется пустыми строками при лимите, cp866, значение CSV с запятой в кавычках',
        ro === 2 && mToText(dt) === '2023-03-15' && mToText(old) === '1900-01-01' && mp5 && mp5.rows.length === 2 && k866 === 'Привет' && dataLeaks('{"x":"Ромашка, ООО"}').length === 1, [ro, mToText(dt), mToText(old), mp5 && mp5.rows.length, k866].join(' | '));
    } finally { Object.assign(DATA, keepData); M_TRACE = null; }
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
    const e1 = errOf('Text.Split(null, ",")'), e2 = errOf('Text.Start("abc")'), e3 = errOf('let f = (n) => @f(n + 1) in f(1)'), e4 = errOf('List.Split({1, 2, 3}, 0)'), e5 = errOf('List.Numbers(1, 1e9)');
    ok('Песочница: ошибки встроенных функций, рекурсия, нулевой размер страницы и огромные списки — понятные ошибки M, без зависаний', /^Text\.Split: /.test(e1) && /^Text\.Start: /.test(e2) && /рекурсия/.test(e3) && /^List\.Split: /.test(e4) && /^List\.Numbers: /.test(e5) && mLit(mEval('try Text.Split(null, ",") otherwise "ok"', null)) === '"ok"', [e1, e2, e3, e4, e5].join(' | '));
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
