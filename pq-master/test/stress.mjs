#!/usr/bin/env node
/*
  Стресс-проверки ядра «Мастера PQ» в Node.js, без браузера и зависимостей.
  node pq-master/test/stress.mjs [итераций=2000] [зерно=1]

  1. Фаззинг M-кода: случайно испорченные варианты тестовых запросов. Анализ, линтер, оптимизатор,
     подсветка, форматер не должны падать; лексер — терять символы; форматер — менять значимые
     токены и должен быть идемпотентен; обезличивание → обратная подстановка — побайтно;
     автоисправления на синтаксически целом коде не должны ломать скобки.
  2. Утечки: секреты в типичных конструкциях M (литералы, параметры, переменные шагов, записи-
     настройки, строки подключения, заголовки, SQL, комментарии) не проходят в обезличенный текст.
  3. Библиотека интерпретатора: каждая функция с аргументами неподходящих типов — только ошибки M
     (MErr) с именем функции, никаких внутренних ошибок JS и зависаний.
  4. Повреждённые .xlsx: чтение без зависаний, только понятные сообщения (класс Error).
  5. Скорость на большой книге (~3800 строк): время анализа, оптимизатора, «всех безопасных».
  Код возврата 1, если найдено хоть одно нарушение в пп. 1–4.
*/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = p => fs.readFileSync(path.join(ROOT, 'src/js', p), 'utf8');
const ITER = +(process.argv[2] || 2000);
let seed = +(process.argv[3] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const grab = (src, re) => { const m = re.exec(src); if (!m) throw new Error('не найдено в исходниках: ' + re); return m[0]; };

// ядро без DOM + чистые функции из видов (syntaxIssues, applyAllSafeText) и тестовая книга из самотеста
const CORE = ['core/zip-mashup.js', 'core/vba.js', 'core/xlsx-data.js', 'm/lang.js', 'm/format.js', 'm/reference.js', 'm/interp.js', 'nda/anon.js', 'nda/diag.js', 'opt/lint.js', 'opt/optimizer.js', 'opt/refactor.js', 'opt/snippets.js'];
const selftest = JS('app/selftest.js');
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Blob, Response, crypto, performance, setTimeout, atob, btoa });
vm.runInContext(CORE.map(JS).join('\n') + '\n' +
  grab(JS('views/ai.js'), /function syntaxIssues[\s\S]*?\n}\n/) +
  grab(JS('views/optimizer.js'), /function applyAllSafeText[\s\S]*?\n}\n/) +
  grab(selftest, /const TEST_SECTION = \[[\s\S]*?\]\.join\([^)]*\);/) + '\n' +
  grab(selftest, /async function makeTestBook[\s\S]*?\n}\n/) +
  grab(selftest, /function makeTestVba[\s\S]*?\n}\n/) +
  grab(selftest, /async function makeTestXlsx[\s\S]*?\n}\n/) +
  '\nglobalThis.api = { TEST_SECTION, lexM, analyzeSection, lintSection, optimizeSection, highlightM, formatM, sigTokens, anonymizeM, restoreTokens, scanLeaks, TokenDict, defaultConfig, applyAllSafeText, syntaxIssues, MLIB, mEval, MErr, makeTestBook, makeTestVba, readVbaProject, vbaRefreshCalls, bookRefreshIssues, loadBookFromBytes, buildBookWithSection, makeTestXlsx, readXlsxData, zipRead, mHashKey, mEquals, MTab, MDate, force, setTrace: t => { M_TRACE = t; } };', ctx, { filename: 'pq-core.js' });
const a = ctx.api;
const semSrc = eval(grab(selftest, /const semSrc = '[^\n]*';/).replace(/^const semSrc = /, '').replace(/;$/, ''));
const uaSrc = eval(grab(selftest, /const ua = \[[\s\S]*?\]\.join\('\\r\\n'\);/).replace(/^const ua = /, '').replace(/;$/, ''));   // сценарий учёта на выгрузках
let violations = 0;
const report = (title, fails, total) => {
  console.log((fails.size ? '✗ ' : '✓ ') + title + ' — ' + total + (fails.size ? ', нарушений: ' + [...fails.values()].reduce((s, v) => s + v.n, 0) : ', нарушений нет'));
  for (const [k, v] of fails){ violations += v.n; console.log('   • ' + k + ' ×' + v.n + (v.detail ? '\n     ' + v.detail : '') + '\n     вход: ' + JSON.stringify(v.input.length > 300 ? v.input.slice(0, 300) + '…' : v.input)); }
};
const failer = () => { const m = new Map(); return [m, (kind, input, detail) => { if (!m.has(kind)) m.set(kind, { n: 0, input, detail: detail ? String(detail).split('\n').slice(0, 2).join(' | ') : '' }); m.get(kind).n++; }]; };

// ---------- 1. фаззинг M-кода ----------
{
  const BITS = ['{[Счёт = [Дт]]}', '(r) => r[Код] = [Код]', '{0}?', 'Маппинг[Счёт]', '"', '""', '#"', '//', '/*', '*/', '(', ')', '[', ']', '{', '}', ',', ';', '=', ' each ', ' let ', ' in ', '\n', '\r\n', '\t', '   ', ' // c  ', '"x\ny"', 'é', '😀', '⟦TXT_1⟧', '⟦UNC_1⟧', '⟦', '⟧', '#date(2020,1,1)', 'shared X = 1;', '\\', '..', '=>', '0x1F', '1e5', '.5',
    'Table.SelectRows(', 'List.Contains(Список, [k])', 'Sql.Database("a","b")', 'password=x', '\u2028', '\u00A0', '\uFEFF', ' meta [IsParameterQuery=true]'];
  const bases = [a.TEST_SECTION, semSrc, uaSrc, a.TEST_SECTION.replace(/\r\n/g, '\n')];
  const mutate = s => { for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++){ const p = Math.floor(rnd() * (s.length + 1)), r = rnd();
    if (r < 0.15) s = s.slice(0, p);
    else if (r < 0.4) s = s.slice(0, p) + s.slice(Math.min(s.length, p + Math.floor(rnd() * 40)));
    else if (r < 0.55){ const q = Math.min(s.length, p + Math.floor(rnd() * 80)); s = s.slice(0, q) + s.slice(p, q) + s.slice(q); }
    else s = s.slice(0, p) + pick(BITS) + s.slice(p); } return s; };
  const cfgAll = () => { const c = a.defaultConfig(); for (const k of Object.keys(c.cats)) c.cats[k] = true; return c; };
  const [F, fail] = failer();
  for (let it = 0; it < ITER; it++){
    const src = mutate(pick(bases));
    try { if (a.lexM(src).map(t => t.v).join('') !== src) fail('лексер теряет символы', src); } catch (e){ fail('lexM бросает', src, e.stack); continue; }
    let A, O; try { A = a.analyzeSection(src, {}); O = a.optimizeSection(src, A, a.lintSection(A)); a.highlightM(src); } catch (e){ fail('анализ/линтер/оптимизатор бросает', src, e.stack); continue; }
    try { const f = a.formatM(src); if (JSON.stringify(a.sigTokens(f)) !== JSON.stringify(a.sigTokens(src))) fail('форматер меняет значимые токены', src); else if (a.formatM(f) !== f) fail('форматер не идемпотентен', src); } catch (e){ fail('formatM бросает', src, e.stack); }
    for (const cfg of [a.defaultConfig(), cfgAll()]){ try { const d = new a.TokenDict(); const an = a.anonymizeM(src, cfg, d); if (a.restoreTokens(an.out, d).out !== src) fail('обезличивание → подстановка не побайтно', src); a.scanLeaks(an.out, cfg, d); } catch (e){ fail('обезличивание бросает', src, e.stack); } }
    if (!a.syntaxIssues(src).length) for (const f of O.findings) if (f.fix){ try { if (a.syntaxIssues(f.fix(src)).length) fail('исправление ломает синтаксис: ' + f.rule, src); } catch (e){ fail('исправление бросает: ' + f.rule, src, e.stack); } }
  }
  report('Фаззинг M-кода', F, ITER + ' вариантов');
}

// ---------- 2. утечки ----------
{
  const id = () => Math.floor(rnd() * 1e9).toString(36).toUpperCase();
  const CASES = {
    'Sql.Database, FQDN': S => `shared Q = Sql.Database("${S.fq}", "${S.db}");`,
    'Sql.Database, короткое имя': S => `shared Q = Sql.Database("${S.bare}", "${S.db}");`,
    'параметры с meta': S => `shared P1 = "${S.bare}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];\r\nshared P2 = "${S.db}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];\r\nshared Q = Sql.Database(P1, P2);`,
    'запросы-строки без meta': S => `shared Сервер = "${S.bare}";\r\nshared База = "${S.db}";\r\nshared Q = Sql.Database(Сервер, База);`,
    'переменные шагов': S => `shared Q = let\r\n    Сервер = "${S.bare}",\r\n    База = "${S.db}",\r\n    Источник = Sql.Database(Сервер, База)\r\nin\r\n    Источник;`,
    'запись-настройка в функцию': S => `shared F = (cfg as record) => Sql.Database(cfg[Server], cfg[Database]);\r\nshared Q = F([Server = "${S.bare}", Database = "${S.db}"]);`,
    'строка подключения ODBC': S => `shared Q = Odbc.Query("Driver={SQL Server};Server=${S.bare};Database=${S.db};UID=${S.user};PWD=${S.pw}", "SELECT 1");`,
    'DSN с паролем': S => `shared Q = Odbc.DataSource("dsn=${S.bare};uid=${S.user};pwd=${S.pw}", [HierarchicalNavigation=true]);`,
    'пароль в переменной шага': S => `shared Q = let\r\n    Password = "${S.pw}",\r\n    x = Odbc.DataSource("dsn=x;pwd=" & Password)\r\nin\r\n    x;`,
    'токен в переменной (по имени)': S => `shared Q = let\r\n    Токен = "${S.key}",\r\n    r = Web.Contents("https://${S.host}", [Headers=[Authorization="Bearer " & Токен]])\r\nin\r\n    r;`,
    'ключ в URL': S => `shared Q = Web.Contents("https://${S.host}/v1/data?apikey=${S.key}");`,
    'заголовок Bearer': S => `shared Q = Web.Contents("https://${S.host}/v1", [Headers=[Authorization="Bearer ${S.key}"]]);`,
    'заголовок X-Api-Key': S => `shared Q = Web.Contents("https://${S.host}/v1", [Headers=[#"X-Api-Key"="${S.key}"]]);`,
    'Query=[…]': S => `shared Q = Web.Contents("https://${S.host}/v1", [Query=[apikey="${S.key}", client="${S.client}"]]);`,
    'RelativePath': S => `shared Q = Web.Contents("https://${S.host}", [RelativePath="clients/${S.client}/orders"]);`,
    'URL конкатенацией': S => `shared Q = Web.Contents("https://${S.host}/api/" & "items?token=${S.key}");`,
    'локальный путь': S => `shared Q = Excel.Workbook(File.Contents("C:\\Users\\${S.user}\\Docs\\${S.client}.xlsx"), null, true);`,
    'UNC': S => `shared Q = Folder.Files("\\\\${S.bare}\\share$\\${S.client}");`,
    'путь и файл в переменных': S => `shared Q = let\r\n    Папка = "D:\\Отчёты\\",\r\n    Файл = "${S.client}.xlsx",\r\n    Источник = Excel.Workbook(File.Contents(Папка & Файл))\r\nin\r\n    Источник;`,
    'SharePoint': S => `shared Q = SharePoint.Files("https://${S.tenant}.sharepoint.com/sites/${S.client}", [ApiVersion = 15]);`,
    'литерал в SQL': S => `shared Q = Value.NativeQuery(Sql.Database("${S.fq}", "${S.db}"), "SELECT * FROM dbo.Orders WHERE Client = '${S.client}'");`,
    'фильтр по тексту': S => `shared Q = let\r\n    t = #table({"Client"}, {{"a"}}),\r\n    f = Table.SelectRows(t, each [Client] = "${S.client}")\r\nin\r\n    f;`,
    'e-mail в комментарии': S => `shared Q = let\r\n    // ответственный: ${S.email}\r\n    x = 1\r\nin\r\n    x;`,
    'IP вместо сервера': S => `shared Q = Sql.Database("${S.ip}", "${S.db}");`,
    'OData с ключом': S => `shared Q = OData.Feed("https://${S.host}/odata/", null, [Headers=[apikey="${S.key}"]]);`
  };
  const [F, fail] = failer(); const per = Math.max(5, Math.round(ITER / 100));
  for (const [name, gen] of Object.entries(CASES)) for (let i = 0; i < per; i++){
    const S = { fq: 'sqlx' + id().toLowerCase() + '.corp.local', bare: 'SRVX' + id(), db: 'DBX' + id(), user: 'usrx' + id().toLowerCase(), pw: 'Pw' + id() + '!x', host: 'apix' + id().toLowerCase() + '.example.com', key: 'K' + id() + id(), client: 'Клиент' + id(), email: 'm' + id().toLowerCase() + '@firm.ru', ip: '10.' + (1 + Math.floor(rnd() * 250)) + '.' + Math.floor(rnd() * 250) + '.' + (1 + Math.floor(rnd() * 250)), tenant: 'tn' + id().toLowerCase() };
    const src = 'section Section1;\r\n\r\n' + gen(S) + '\r\n'; const d = new a.TokenDict(); const an = a.anonymizeM(src, a.defaultConfig(), d);
    const hit = Object.entries(S).filter(([, v]) => src.includes(v) && an.out.includes(v)).map(([k]) => k);
    if (hit.length) fail(name + ': ' + hit.join(', '), an.out);
    if (a.restoreTokens(an.out, d).out !== src) fail(name + ': подстановка не побайтно', src);
  }
  report('Утечки при обезличивании', F, Object.keys(CASES).length + ' конструкций × ' + per);
}

// ---------- 3. библиотека интерпретатора ----------
{
  const ARGS = ['null', '1', '-2.5', '"abc"', '""', '{1, 2, 3}', '{}', '[a = 1]', '#table({"a"}, {{1}, {2}})', '#date(2024, 2, 29)', '#duration(1, 2, 3, 4)', 'true', '(x) => x', 'each _', '{"a", "b"}', '#datetime(2024,1,1,10,0,0)', 'type text', '"a,b;c"', '0'];
  const [F, fail] = failer(); let calls = 0;
  for (const fn of Object.keys(a.MLIB)) for (let n = 0; n <= 4; n++) for (let r = 0; r < (n ? 8 : 1); r++){
    const expr = fn + '(' + Array.from({ length: n }, () => pick(ARGS)).join(', ') + ')'; calls++;
    try { ctx.__e = expr; vm.runInContext('api.mEval(__e, null)', ctx, { timeout: 2000 }); }
    catch (e){ const msg = String(e && e.message || e);
      if (/timed out/.test(msg)) fail('зависание', expr);
      else if (!(e instanceof a.MErr)) fail('не ошибка M: ' + (e && e.constructor && e.constructor.name), expr, msg);
      else if (/^undefined:/.test(msg)) fail('сообщение без имени функции', expr, msg); }
  }
  report('Библиотека интерпретатора', F, Object.keys(a.MLIB).length + ' функций, ' + calls + ' вызовов');
}

// ---------- 4. повреждённые книги ----------
{
  const good = await a.makeTestBook(); const [F, fail] = failer(); const n = Math.max(200, Math.round(ITER / 2));
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('ТАЙМАУТ')), ms))]);
  for (let it = 0; it < n; it++){
    let b = good.slice(); for (let i = 0, k = 1 + Math.floor(rnd() * 6); i < k; i++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    if (rnd() < 0.1) b = b.slice(0, Math.floor(rnd() * b.length));
    try { const bk = await timeout(a.loadBookFromBytes('t.xlsx', b), 5000); await timeout(a.buildBookWithSection(bk, bk.origSection + '\r\n'), 5000); }
    catch (e){ if (/ТАЙМАУТ/.test(e.message)) fail('зависание', '(байты)'); else if (e.constructor.name !== 'Error') fail('внутренняя ошибка ' + e.constructor.name, '(байты)', e.message); }
  }
  report('Повреждённые книги', F, n + ' файлов');
}

// ---------- 4б. повреждённые макросы (xl/vbaProject.bin) ----------
{
  const good = a.makeTestVba('Attribute VB_Name = "Module1"\nSub Обновить()\n    ActiveWorkbook.RefreshAll\n    ActiveWorkbook.RefreshAll\nEnd Sub', 1251);
  const base = a.readVbaProject(good); const [F, fail] = failer(); const n = Math.max(500, ITER);
  if (!base.modules.length || !/Обновить/.test(base.modules[0].code)) fail('исходный тестовый проект не читается', '(байты)');
  for (let it = 0; it < n; it++){
    const b = good.slice(); for (let i = 0, k = 1 + Math.floor(rnd() * 8); i < k; i++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    const t0 = performance.now();
    try { const v = a.readVbaProject(b); a.bookRefreshIssues({ vba: v }); } catch (e){ if (e.constructor.name !== 'Error') fail('внутренняя ошибка ' + e.constructor.name, '(байты)', e.message); }
    if (performance.now() - t0 > 2000) fail('чтение дольше 2 с', '(байты)');
  }
  report('Повреждённые макросы', F, n + ' файлов');
}

// ---------- 4в. повреждённые данные книги (листы, таблицы, общие строки) ----------
{
  const good = await a.makeTestXlsx({ sheets: [{ name: 'Л', rows: [['Код', 'Имя', 'Дата'], [1, 'а', { d: '2024-01-01' }], [2, 'б', { d: '2024-02-01' }]] }], tables: [{ sheet: 'Л', name: 'Т', ref: 'A1:C3', cols: ['Код', 'Имя', 'Дата'] }], names: [{ name: 'Н', ref: 'Л!$A$1:$B$2' }] });
  const base = await a.readXlsxData(a.zipRead(good), {}); const [F, fail] = failer(); const n = Math.max(300, ITER / 2);
  if (base.tables[0].rows.length !== 2 || base.names[0].rows.length !== 2) fail('исходная книга читается неверно', '(байты)');
  const z = a.zipRead(good); const parts = await Promise.all(z.entries.map(async e => [e.name, new TextDecoder().decode(await ctx.zipEntryBytes(e))]));
  for (let it = 0; it < n; it++){
    // портим XML: вырезаем, дублируем или заменяем кусок текста в одной из частей
    const [name, text] = parts[Math.floor(rnd() * parts.length)]; const i = Math.floor(rnd() * text.length), len = 1 + Math.floor(rnd() * 40);
    const bad = rnd() < 0.4 ? text.slice(0, i) + text.slice(i + len) : rnd() < 0.5 ? text.slice(0, i) + text.slice(i, i + len).repeat(3) + text.slice(i) : text.slice(0, i) + '<c r="ZZZ9999999"><v>' + rnd() + '</v></c>' + text.slice(i);
    const ents = []; for (const [nm, t] of parts) ents.push(await ctx.zipFinalizeNew(ctx.zipNewEntry(nm, new TextEncoder().encode(nm === name ? bad : t), true)));
    const t0 = performance.now();
    try { await a.readXlsxData(a.zipRead(ctx.zipWrite(ents)), { maxRows: 1000 }); } catch (e){ if (e.constructor.name !== 'Error') fail('внутренняя ошибка ' + e.constructor.name, name, e.message); }
    if (performance.now() - t0 > 2000) fail('чтение дольше 2 с', name);
  }
  report('Повреждённые данные книги', F, n + ' файлов');
}

// ---------- 4г. соединения, группировки, Distinct по хешу = перебору ----------
{
  const [F, fail] = failer(); const n = Math.max(300, ITER / 2);
  const dom = [null, 1, 2, 3, 1.5, '1', '2', 'a', 'A', true, false, -0, 0];
  const pick = () => dom[Math.floor(rnd() * dom.length)];
  const tbl = (rows, cols) => new a.MTab(cols, Array.from({ length: rows }, () => cols.map(() => pick())));
  const naiveJoin = (L, R, kind) => { const out = []; const used = new Set(); for (const r of L.rows){ const m = R.rows.filter(s => a.mEquals(r[0], s[0]) && a.mEquals(r[1], s[1])); m.forEach(x => used.add(x)); if (kind === 0 && !m.length) continue; if (kind === 4 && m.length) continue; out.push(r.map(String).join('|') + '#' + m.length); } if (kind === 3) for (const s of R.rows) if (!used.has(s)) out.push('null|null|null#1'); return out.sort().join(';'); };
  for (let it = 0; it < n; it++){
    const L = tbl(Math.floor(rnd() * 30), ['k1', 'k2', 'v']), R = tbl(Math.floor(rnd() * 30), ['k1', 'k2', 'w']); const kind = [0, 1, 3, 4][Math.floor(rnd() * 4)];
    const got = a.MLIB['Table.NestedJoin'].call([L, ['k1', 'k2'], R, ['k1', 'k2'], 'J', kind]);
    const g = got.rows.map(r => r.slice(0, 3).map(x => String(a.force(x))).join('|') + '#' + a.force(r[3]).rows.length).sort().join(';');
    if (g !== naiveJoin(L, R, kind)) fail('NestedJoin по хешу ≠ перебору (вид ' + kind + ')', JSON.stringify([L.rows, R.rows]));
    const grp = a.MLIB['Table.Group'].call([L, ['k1', 'k2'], [['n', a.MLIB['Table.RowCount']]]]);
    const keys = []; for (const r of L.rows) if (!keys.some(k => a.mEquals(k[0], r[0]) && a.mEquals(k[1], r[1]))) keys.push(r);
    if (grp.rows.length !== keys.length || grp.rows.reduce((s2, r) => s2 + a.force(r[2]), 0) !== L.rows.length) fail('Table.Group по хешу ≠ перебору', JSON.stringify(L.rows));
    if (a.MLIB['Table.Distinct'].call([L, ['k1', 'k2']]).rows.length !== keys.length) fail('Table.Distinct по хешу ≠ перебору', JSON.stringify(L.rows));
  }
  report('Соединения и группировки по хешу', F, n + ' пар таблиц');
}

// ---------- 5. скорость ----------
{
  const body = a.TEST_SECTION.replace(/^section Section1;\s*/, ''); const names = [...body.matchAll(/shared\s+(#"[^"]+"|[\p{L}_][\p{L}\p{N}_]*)\s*=/gu)].map(m => m[1]);
  let big = 'section Section1;\r\n\r\n';
  for (let i = 0; i < 100; i++){ let b = body; for (const nm of names){ const bare = nm.startsWith('#"') ? nm.slice(2, -1) : nm; b = b.split(nm).join('#"' + bare + ' ' + i + '"'); } big += b + '\r\n'; }
  const t = (label, fn) => { const s = performance.now(); const r = fn(); console.log('   ' + label.padEnd(30) + (performance.now() - s).toFixed(0).padStart(6) + ' мс'); return r; };
  console.log('⏱ Скорость: книга ' + big.split('\n').length + ' строк');
  const A = t('analyzeSection', () => a.analyzeSection(big, {}));
  const L = t('lintSection', () => a.lintSection(A));
  t('optimizeSection', () => a.optimizeSection(big, A, L));
  t('anonymizeM', () => a.anonymizeM(big, a.defaultConfig(), new a.TokenDict()));
  t('formatM', () => a.formatM(big));
  const r = t('applyAllSafeText', () => a.applyAllSafeText(big, {}));
  console.log('   (безопасных исправлений: ' + r.applied.length + ')');
  // вычисления на данных: 100 тыс. проводок, справочник 10 тыс. строк
  const N = 100000, M = 10000;
  const rows = []; for (let i = 0; i < N; i++) rows.push([i % (M + 500), (i * 7919) % 100000 / 7]);
  const map = []; for (let i = 0; i < M; i++) map.push([i, 'Статья ' + i]);
  const P = new a.MTab(['Счёт', 'Сумма'], rows), S2 = new a.MTab(['Код', 'Статья'], map);
  t('NestedJoin 100 тыс. × 10 тыс.', () => a.MLIB['Table.NestedJoin'].call([P, ['Счёт'], S2, ['Код'], 'М', 1]).rows.length);
  t('Group 100 тыс. → 10,5 тыс.', () => a.MLIB['Table.Group'].call([P, ['Счёт'], [['n', a.MLIB['Table.RowCount']]]]).rows.length);
  t('Поиск Т{[Код=…]} ×100 тыс.', () => { const rec = a.mEval('[Код = 0]', ''); let hit = 0; for (let i = 0; i < N; i++){ rec.vals[0] = i % M; hit += ctx.tableKeyHits(S2, rec).length; } return hit; });
}
console.log(violations ? '\nНАРУШЕНИЙ: ' + violations : '\nВсе стресс-проверки пройдены.');
process.exit(violations ? 1 : 0);
