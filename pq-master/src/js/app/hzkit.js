/* =====================================================================
   app/hzkit.js — «Гиперзум»: комплект для настоящего DuckDB и витрины.
   Комплект — папка с SQL (тот же текст, что проверен в браузере), скриптами PowerShell (встроены в
   Windows) и инструкцией. Нужен один файл duckdb.exe. Обновление — «Обновить.bat» или по расписанию;
   журнал каждого запуска — в «журнал\», его читает раздел «Обслуживание».
   Витрина (HTML) — итоговые таблицы с графиками для руководителя; рисуется одной функцией
   hzVitrinaRender и в Мастере (предпросмотр), и в файле витрины.
   Приватность: комплект и витрины содержат пути и данные компании — создаются только по явному
   действию пользователя и только на этом компьютере (скачивание / запись в выбранную папку).
   API: hzKitFiles(plan, o) → [{ path, text }]; hzVitrinaHtml(data | null); hzVitrinaRender(root, data);
        hzExcelSection(plan, types, kitDir) → текст Section1 для Excel-витрины.
   ===================================================================== */
const HZ_SAFE = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'запрос';
const hzPs = s => "'" + String(s).replace(/'/g, "''") + "'";
const HZ_BOM = '﻿';
/** Запросы, которые комплект может считать: перевод есть, источники читаются, зависимости тоже готовы */
function hzKitQueries(plan){
  const ok = new Map();
  for (const q of plan.queries){
    if (q.kind !== 'table'){ ok.set(q.name, q.kind === 'param'); continue; }
    const srcOk = q.mat.every(n => { const s = q.steps.find(x => x.name === n); return s.reader && s.reader.stage === 'table' && ['wb', 'csv', 'xlsx', 'folder', 'odata', 'sqldb'].includes(s.reader.kind); });
    ok.set(q.name, srcOk && q.kitReady && [...q.deps].every(d => ok.get(d)));
  }
  return ok;
}
const hzColLetter = c => { let s = ''; c++; while (c > 0){ const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
/** SQL чтения источника для готовой таблицы «Запрос · Шаг» и (если нужно) задача подготовки для PowerShell */
function hzReader(q, s, o){
  const r = s.reader; const out = hzQ(hzMatName(q.name, s.name)); const file = HZ_SAFE(q.name + ' · ' + s.name);
  const tbl = sql => 'CREATE OR REPLACE TABLE ' + out + ' AS ' + sql + ';';
  if (r.kind === 'csv'){
    const utf = !r.enc || r.enc === 65001; const path = utf ? r.path : 'кэш/' + file + '.csv';
    const names = r.header ? '' : r.names ? ', names = [' + r.names.map(hzS).join(', ') + ']' : r.ncols ? ', names = [' + Array.from({ length: r.ncols }, (_, i) => hzS('Column' + (i + 1))).join(', ') + ']' : '';
    return { sql: tbl("SELECT * FROM read_csv(" + hzS(path) + ", delim = " + hzS(r.delim) + ", header = " + (r.header ? 'true' : 'false') + (r.skip ? ', skip = ' + r.skip : '') + names + ", all_varchar = true, nullstr = '\\x01', quote = '\"', escape = '\"', null_padding = true, strict_mode = false)"),
      prep: utf ? null : { kind: 'recode', src: r.path, dst: path, cp: r.enc }, note: 'CSV-файл' + (utf ? '' : ' (кодировка ' + (HZ_ENC[r.enc] || r.enc) + ' → UTF-8 перед чтением)') };
  }
  if (r.kind === 'xlsx') return { sql: tbl('SELECT * FROM read_xlsx(' + hzS(r.path) + ', sheet = ' + hzS(r.sheet) + ', header = ' + (r.header ? 'true' : 'false') + ', stop_at_empty = true)'), ext: 'excel', note: 'лист книги Excel' + (r.objKind !== 'Sheet' ? ' (⚠ объект «' + r.objKind + '» читается как лист — проверьте)' : '') };
  if (r.kind === 'wb'){
    const w = o.wb && o.wb.get(r.table);
    const rng = w && w.range ? hzColLetter(w.range.c0) + (w.range.r0 + 1) + ':' + hzColLetter(w.range.c1) + '1048576' : null;
    return { sql: tbl('SELECT * FROM read_xlsx(' + hzS(o.bookPath || 'КНИГА.xlsx') + (w ? ', sheet = ' + hzS(w.sheet) : '') + (rng ? ', range = ' + hzS(rng) : '') + ', header = true, stop_at_empty = true)'), ext: 'excel', note: 'таблица «' + r.table + '» этой книги' + (w ? ' (лист «' + w.sheet + '»)' : ' (⚠ лист не найден — откройте «Проверку на данных» и пересоздайте комплект)') };
  }
  if (r.kind === 'folder'){
    const delim = (/Delimiter\s*=\s*"([^"]+)"/.exec(plan_text(o)) || [, ';'])[1];
    return { sql: tbl("SELECT * FROM read_csv(" + hzS(r.path.replace(/[\\/]+$/, '') + '/*.csv') + ", delim = " + hzS(delim) + ", header = true, union_by_name = true, all_varchar = true, nullstr = '\\x01')"), note: '⚠ все CSV папки одной таблицей — сверьте с объединением файлов в Power Query (кодировка, заголовки, фильтр по имени файла)' };
  }
  if (r.kind === 'odata'){ const path = 'данные/' + file + '.csv'; return { sql: tbl('SELECT * FROM read_csv(' + hzS(path) + ', header = true)'), prep: { kind: 'odata', url: r.url, entity: r.entity, dst: path }, note: '1С OData: «' + r.entity + '» — загрузчик PowerShell' }; }
  if (r.kind === 'sqldb'){ const path = 'данные/' + file + '.csv'; return { sql: tbl('SELECT * FROM read_csv(' + hzS(path) + ', header = true)'), prep: { kind: 'sql', server: r.server, db: r.db, query: r.query || 'SELECT * FROM [' + (r.schema || 'dbo') + '].[' + r.table + ']', dst: path }, note: 'SQL Server «' + r.server + '» — загрузчик PowerShell' }; }
  return null;
}
function plan_text(o){ return o.text || ''; }
/** Эталон для сверки при первом запуске: строки и суммы числовых столбцов итоговых запросов (из «Проверки на данных») */
function hzEtalon(plan, run){
  const rows = [];
  if (!run) return rows;
  for (const q of plan.queries){
    if (!q.out || q.kind !== 'table') continue; const r = run.queries.find(x => x.name === q.name); if (!r || !(r.value instanceof MTab)) continue;
    rows.push([q.name, 'строк', r.value.rows.length]);
    r.value.cols.forEach((c, i) => { let s = 0, n = 0, other = 0; for (const row of r.value.rows){ let v; try { v = force(row[i]); } catch { other++; continue; } if (typeof v === 'number'){ s += v; n++; } else if (v !== null) other++; } if (n && !other) rows.push([q.name, 'сумма «' + c + '»', s]); });
  }
  return rows;
}
/** Все файлы комплекта. o: { book, bookPath, kitDir, wb: Map(таблица → {sheet, range}), run (DATA.run), schedule ('06:30' или ''), types: Map(запрос → [[столбец, тип DuckDB]]), now } */
function hzKitFiles(plan, o){
  const files = []; const add = (path, text) => files.push({ path, text });
  const ok = hzKitQueries(plan); const outs = plan.queries.filter(q => q.kind === 'table' && q.out && ok.get(q.name));
  const prep = []; const src = []; const exts = new Set(); const qfiles = []; let k = 0;
  for (const q of plan.queries){
    if (q.kind !== 'table' || !ok.get(q.name)) continue;
    for (const n of q.mat){ const s = q.steps.find(x => x.name === n); const r = hzReader(q, s, Object.assign({ text: plan.text }, o)); src.push('-- «' + q.name + '», шаг «' + s.name + '»: ' + r.note + (s.op ? ' (Power Query: ' + s.op.ui + ')' : '') + '\n' + r.sql); if (r.prep) prep.push(Object.assign({ name: q.name + ' · ' + s.name }, r.prep)); if (r.ext) exts.add(r.ext); }
    const f = 'sql/20_' + String(++k).padStart(2, '0') + ' ' + HZ_SAFE(q.name) + '.sql'; qfiles.push([q.name, f]);
    add(f, '-- Создано Мастером PQ (Гиперзум) ' + o.now + '. Не правьте вручную: измените запрос в Power Query и пересоздайте комплект.\n-- Этот же текст проверен в браузере: результат совпал с Power Query (см. «Гиперзум → В браузере»).\n\n' + hzQuerySql(plan, q) + '\n');
  }
  add('sql/00_помощники.sql', '-- Создано Мастером PQ (Гиперзум) ' + o.now + '\n-- Помощники преобразования типов (как в Power Query) и настройки DuckDB.\nSET preserve_insertion_order = true;\n' + (exts.has('excel') ? 'LOAD excel;\n' : '') + HZ_MACROS + '\n');
  add('sql/10_источники.sql', '-- Источники: каждая таблица «Запрос · Шаг» — результат шагов Power Query до перевода в SQL.\n-- Пути — как в запросах книги. Поменялся путь — исправьте запрос в Power Query и пересоздайте комплект.\n\n' + (src.join('\n\n') || '-- источников нет') + '\n');
  const copy = outs.map(q => { const fn = HZ_SAFE(q.name); return '-- «' + q.name + '»\nCOPY (SELECT * EXCLUDE (' + HZ_R + ') FROM ' + hzQ(q.name) + ' ORDER BY ' + HZ_R + ") TO 'витрина/данные/" + fn + ".csv' (HEADER, DELIMITER ',');\nCOPY (SELECT * EXCLUDE (" + HZ_R + ') FROM ' + hzQ(q.name) + ' ORDER BY ' + HZ_R + " LIMIT 50000) TO 'витрина/html/" + fn + ".csv' (HEADER, DELIMITER ',');"; });
  const counts = plan.queries.filter(q => q.kind === 'table' && ok.get(q.name)).map(q => 'SELECT ' + hzS(q.name) + ' AS запрос, count(*) AS строк FROM ' + hzQ(q.name));
  add('sql/90_витрины.sql', '-- Итоговые таблицы → CSV для Excel-витрины (полностью) и HTML-витрины (до 50 000 строк).\n' + copy.join('\n') + '\n-- Строки по запросам — для журнала\nCOPY (' + (counts.join(' UNION ALL ') || "SELECT '' AS запрос, 0 AS строк") + ") TO 'журнал/строки.csv' (HEADER, DELIMITER ';');\n");
  const et = hzEtalon(plan, o.run).filter(([qn]) => ok.get(qn));
  if (et.length){
    const fact = et.map(([qn, m]) => m === 'строк' ? 'SELECT ' + hzS(qn) + ', ' + hzS(m) + ', CAST(count(*) AS DOUBLE) FROM ' + hzQ(qn) : 'SELECT ' + hzS(qn) + ', ' + hzS(m) + ', CAST(sum(' + hzQ(m.slice(8, -1)) + ') AS DOUBLE) FROM ' + hzQ(qn));
    add('sql/95_сверка.sql', '-- Сверка с Power Query: строки и суммы итоговых запросов на момент создания комплекта (данные из «Проверки на данных»).\n-- Имеет смысл при первом запуске на тех же исходных данных; дальше данные меняются — расхождения ожидаемы.\nCREATE OR REPLACE TABLE _эталон AS SELECT * FROM (VALUES ' + et.map(([qn, m, v]) => '(' + hzS(qn) + ', ' + hzS(m) + ', ' + (isFinite(v) ? v : 0) + ')').join(', ') + ') AS v(запрос, показатель, power_query);\n' +
      'CREATE OR REPLACE TABLE _сверка AS SELECT e.запрос, e.показатель, e.power_query, f.duckdb, abs(e.power_query - f.duckdb) <= 1e-6 * greatest(1, abs(e.power_query)) AS совпало FROM _эталон e LEFT JOIN (' + fact.join(' UNION ALL ') + ') AS f(запрос, показатель, duckdb) USING (запрос, показатель);\n' +
      "COPY _сверка TO 'журнал/сверка.csv' (HEADER, DELIMITER ';');\n");
  }
  const sqlOrder = ['sql/00_помощники.sql', 'sql/10_источники.sql', ...qfiles.map(x => x[1]), 'sql/90_витрины.sql'].concat(et.length ? ['sql/95_сверка.sql'] : []);
  add('scripts/refresh.ps1', HZ_BOM + hzRefreshPs(prep, sqlOrder, qfiles, o));
  add('scripts/setup.ps1', HZ_BOM + hzSetupPs(exts, o));
  add('Обновить.bat', '@echo off\r\nchcp 65001 >nul\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\refresh.ps1"\r\npause\r\n');
  add('Установить.bat', '@echo off\r\nchcp 65001 >nul\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\setup.ps1"\r\npause\r\n');
  add('Открыть витрину.bat', '@echo off\r\nstart "" "%~dp0витрина\\Витрина.html"\r\n');
  add('витрина/шаблон.html', hzVitrinaHtml(null, o.book));
  const man = { generator: 'Мастер PQ — Гиперзум', created: o.now, book: o.book, kitDir: o.kitDir || '', duckdb: 'duckdb.exe (1.4 или новее)',
    queries: plan.queries.filter(q => q.kind === 'table').map(q => ({ name: q.name, kit: !!ok.get(q.name), out: q.out, status: q.status, file: (qfiles.find(x => x[0] === q.name) || [])[1] || null, steps: q.steps.length, manual: q.manualSteps.map(s => s.name + ': ' + s.reason) })),
    loaders: prep.map(p => ({ name: p.name, kind: p.kind })), stats: plan.stats };
  add('manifest.json', JSON.stringify(man, null, 2));
  add('ПРОЧТИ МЕНЯ.txt', HZ_BOM + hzReadme(plan, ok, prep, exts, o).replace(/\n/g, '\r\n'));
  return files;
}
function hzRefreshPs(prep, sqlOrder, qfiles, o){
  const L = [
    '# Гиперзум: обновление данных. Создано Мастером PQ ' + o.now + ' для книги «' + o.book + '».',
    '# Не правьте вручную — измените запросы в Power Query и пересоздайте комплект в Мастере.',
    "$ErrorActionPreference = 'Stop'",
    '$Root = Split-Path -Parent $PSScriptRoot; Set-Location $Root',
    "$Duck = Join-Path $Root 'duckdb.exe'",
    "if (-not (Test-Path $Duck)) { $c = Get-Command duckdb -ErrorAction SilentlyContinue; if ($c) { $Duck = $c.Source } else { Write-Host 'Нет duckdb.exe: положите его в папку комплекта (см. ПРОЧТИ МЕНЯ.txt).' -ForegroundColor Red; exit 2 } }",
    "$Db = Join-Path $Root 'база.duckdb'",
    "foreach ($d in 'журнал','данные','кэш','витрина\\данные','витрина\\html') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }",
    '$Run = [ordered]@{ start = (Get-Date).ToString(\'s\'); steps = @(); status = \'ok\'; error = \'\'; seconds = 0 }',
    '$All = [Diagnostics.Stopwatch]::StartNew()',
    'function Step($Name, [scriptblock]$Body) {',
    '  Write-Host ("→ " + $Name) -NoNewline; $t = [Diagnostics.Stopwatch]::StartNew()',
    '  try { & $Body; $Run.steps += [ordered]@{ name = $Name; ms = $t.ElapsedMilliseconds; ok = $true }; Write-Host ("  " + [math]::Round($t.Elapsed.TotalSeconds, 1) + " с") -ForegroundColor Green }',
    '  catch { $Run.steps += [ordered]@{ name = $Name; ms = $t.ElapsedMilliseconds; ok = $false; error = "$_" }; Write-Host "  ошибка" -ForegroundColor Red; throw }',
    '}',
    'function Sql($File) { $out = & $Duck $Db -bail -f $File 2>&1; if ($LASTEXITCODE -ne 0) { throw (($out | Out-String).Trim()) } }',
    "function Csv($v) { if ($null -eq $v -or $v -is [DBNull]) { return '' }; if ($v -is [datetime]) { return $v.ToString('yyyy-MM-ddTHH:mm:ss') }; $s = [Convert]::ToString($v, [Globalization.CultureInfo]::InvariantCulture); if ($s -match '[\",\\r\\n]') { return '\"' + $s.Replace('\"', '\"\"') + '\"' }; return $s }",
    'function Recode($Src, $Dst, $Cp) { $r = New-Object IO.StreamReader($Src, [Text.Encoding]::GetEncoding($Cp)); $w = New-Object IO.StreamWriter((Join-Path $Root $Dst), $false, (New-Object Text.UTF8Encoding $false)); try { while (($l = $r.ReadLine()) -ne $null) { $w.WriteLine($l) } } finally { $r.Close(); $w.Close() } }',
    '# 1С OData: логин и пароль спрашиваются один раз и хранятся зашифрованными для этого пользователя Windows (журнал\\*.cred)',
    'function Cred($Key) { $f = Join-Path $Root (\'журнал\\\' + $Key + \'.cred\'); if (Test-Path $f) { return Import-Clixml $f }; $c = Get-Credential -Message (\'Логин 1С для \' + $Key); $c | Export-Clixml $f; return $c }',
    'function Load-OData($Url, $Entity, $Dst) {',
    "  $cred = Cred (($Url -replace '[^\\w]', '_')); $base = $Url.TrimEnd('/') + '/' + $Entity; $skip = 0; $page = 5000; $cols = $null",
    '  $w = New-Object IO.StreamWriter((Join-Path $Root $Dst), $false, (New-Object Text.UTF8Encoding $false))',
    '  try { do {',
    "    $r = Invoke-RestMethod -Uri ($base + '?$format=json&$top=' + $page + '&$skip=' + $skip) -Credential $cred -UseBasicParsing; $rows = @($r.value)",
    "    foreach ($row in $rows) { if (-not $cols) { $cols = @($row.PSObject.Properties | Where-Object { $_.Name -notmatch '@|_Key$|Navigation' -and ($_.Value -isnot [array]) -and ($_.Value -isnot [psobject] -or $_.Value -is [string]) } | ForEach-Object { $_.Name }); $w.WriteLine((($cols | ForEach-Object { Csv $_ }) -join ',')) }; $w.WriteLine((($cols | ForEach-Object { Csv $row.$_ }) -join ',')) }",
    '    $skip += $page } while ($rows.Count -eq $page) } finally { $w.Close() }',
    '}',
    'function Load-Sql($Server, $Database, $Query, $Dst) {',
    '  $cn = New-Object System.Data.SqlClient.SqlConnection("Server=$Server;Database=$Database;Integrated Security=True"); $cn.Open()',
    '  $w = New-Object IO.StreamWriter((Join-Path $Root $Dst), $false, (New-Object Text.UTF8Encoding $false))',
    '  try { $cmd = $cn.CreateCommand(); $cmd.CommandText = $Query; $cmd.CommandTimeout = 0; $rd = $cmd.ExecuteReader()',
    "    $w.WriteLine(((0..($rd.FieldCount - 1) | ForEach-Object { Csv $rd.GetName($_) }) -join ','))",
    "    while ($rd.Read()) { $w.WriteLine(((0..($rd.FieldCount - 1) | ForEach-Object { Csv $rd.GetValue($_) }) -join ',')) } } finally { $w.Close(); $cn.Close() }",
    '}',
    'try {'
  ];
  for (const p of prep){
    if (p.kind === 'recode') L.push('  Step ' + hzPs('Перекодировка: ' + p.name) + ' { Recode ' + hzPs(p.src) + ' ' + hzPs(p.dst) + ' ' + p.cp + ' }');
    if (p.kind === 'odata') L.push('  Step ' + hzPs('1С OData: ' + p.name) + ' { Load-OData ' + hzPs(p.url) + ' ' + hzPs(p.entity) + ' ' + hzPs(p.dst) + ' }');
    if (p.kind === 'sql') L.push('  Step ' + hzPs('SQL Server: ' + p.name) + ' { Load-Sql ' + hzPs(p.server) + ' ' + hzPs(p.db) + ' ' + hzPs(p.query) + ' ' + hzPs(p.dst) + ' }');
  }
  const label = f => { const q = qfiles.find(x => x[1] === f); return q ? 'Запрос «' + q[0] + '»' : ({ 'sql/00_помощники.sql': 'Помощники', 'sql/10_источники.sql': 'Чтение источников', 'sql/90_витрины.sql': 'Выгрузка витрин', 'sql/95_сверка.sql': 'Сверка с Power Query' })[f] || f; };
  for (const f of sqlOrder) L.push('  Step ' + hzPs(label(f)) + ' { Sql ' + hzPs(f) + ' }');
  L.push(
    "  Step 'HTML-витрина' {",
    "    $t = [IO.File]::ReadAllText((Join-Path $Root 'витрина\\шаблон.html'), [Text.Encoding]::UTF8)",
    "    $tabs = @(Get-ChildItem (Join-Path $Root 'витрина\\html') -Filter *.csv | ForEach-Object { [ordered]@{ name = $_.BaseName; csv = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) } })",
    "    $json = (ConvertTo-Json -Compress -Depth 4 ([ordered]@{ built = (Get-Date).ToString('dd.MM.yyyy HH:mm'); tables = $tabs })).Replace('</', '<\\/')",
    "    [IO.File]::WriteAllText((Join-Path $Root 'витрина\\Витрина.html'), $t.Replace('__PQM_DATA__', $json), (New-Object Text.UTF8Encoding $false))",
    '  }',
    '} catch { $Run.status = \'error\'; $Run.error = "$_" }',
    '$Run.seconds = [math]::Round($All.Elapsed.TotalSeconds, 1)',
    "$line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ';' + $Run.seconds.ToString([Globalization.CultureInfo]::InvariantCulture) + ';' + $Run.status + ';' + ($Run.error -replace '[;\\r\\n]', ' ')",
    "$log = Join-Path $Root 'журнал\\журнал.csv'; if (-not (Test-Path $log)) { [IO.File]::WriteAllText($log, \"время;секунд;статус;ошибка`r`n\", (New-Object Text.UTF8Encoding $true)) }",
    '[IO.File]::AppendAllText($log, $line + "`r`n", (New-Object Text.UTF8Encoding $false))',
    "[IO.File]::WriteAllText((Join-Path $Root 'журнал\\последний.json'), (ConvertTo-Json -Depth 5 $Run), (New-Object Text.UTF8Encoding $false))",
    "if ($Run.status -eq 'ok') { Write-Host ('Готово за ' + $Run.seconds + ' с. Витрина: витрина\\Витрина.html') -ForegroundColor Green; exit 0 } else { Write-Host ('Ошибка: ' + $Run.error) -ForegroundColor Red; Write-Host 'Подробности — журнал\\последний.json; откройте его в Мастере PQ → Гиперзум → Обслуживание.'; exit 1 }"
  );
  return L.join('\r\n') + '\r\n';
}
function hzSetupPs(exts, o){
  return [
    '# Гиперзум: установка. Создано Мастером PQ ' + o.now + '.',
    "$ErrorActionPreference = 'Stop'",
    '$Root = Split-Path -Parent $PSScriptRoot; Set-Location $Root',
    "$Duck = Join-Path $Root 'duckdb.exe'",
    "if (-not (Test-Path $Duck)) { Write-Host 'Нет duckdb.exe в папке комплекта.' -ForegroundColor Red; Write-Host 'Скачайте DuckDB CLI для Windows (файл duckdb_cli-windows-amd64.zip) с сайта duckdb.org — раздел Installation,'; Write-Host 'распакуйте duckdb.exe в эту папку и запустите «Установить.bat» ещё раз. Если скачивать нельзя — попросите ИТ.'; exit 2 }",
    "& $Duck -c \"SELECT 'DuckDB ' || version() AS проверка\"; if ($LASTEXITCODE -ne 0) { Write-Host 'duckdb.exe не запускается (антивирус или политика ИТ).' -ForegroundColor Red; exit 2 }",
    exts.has('excel') ? "Write-Host 'Расширение excel (чтение .xlsx; нужен интернет один раз)…'; & $Duck -c 'INSTALL excel; LOAD excel;'; if ($LASTEXITCODE -ne 0) { Write-Host 'Не удалось установить excel: без интернета скачайте файл excel.duckdb_extension на другом компьютере и выполните duckdb.exe -c \"INSTALL ''путь\\excel.duckdb_extension''\"' -ForegroundColor Yellow }" : '',
    "foreach ($d in 'журнал','данные','кэш','витрина\\данные','витрина\\html') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }",
    o.schedule ? "$a = Read-Host 'Обновлять каждый день в " + o.schedule + "? (д/н)'; if ($a -match '^[дДyY]') { $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File \"' + (Join-Path $PSScriptRoot 'refresh.ps1') + '\"') -WorkingDirectory $Root; $tr = New-ScheduledTaskTrigger -Daily -At " + hzPs(o.schedule) + "; Register-ScheduledTask -TaskName " + hzPs('Гиперзум — ' + HZ_SAFE(o.book)) + " -Action $act -Trigger $tr -Description 'Мастер PQ: обновление данных DuckDB' -Force | Out-Null; Write-Host 'Задание в Планировщике Windows создано.' -ForegroundColor Green }" : '',
    "Write-Host 'Первое обновление…'; & (Join-Path $PSScriptRoot 'refresh.ps1')"
  ].filter(Boolean).join('\r\n') + '\r\n';
}
function hzReadme(plan, ok, prep, exts, o){
  const qs = plan.queries.filter(q => q.kind === 'table');
  const ready = qs.filter(q => ok.get(q.name)), wait = qs.filter(q => !ok.get(q.name));
  return [
    'ГИПЕРЗУМ — расчёт запросов Power Query в DuckDB',
    'Книга: ' + o.book + ' · комплект создан Мастером PQ ' + o.now,
    '',
    'ЧТО ЭТО',
    'Те же запросы, что в Power Query, переведены в SQL и считаются программой DuckDB — быстрее в десятки раз.',
    'Power Query остаётся источником истины: запросы правите в Excel как обычно, затем пересоздаёте комплект в Мастере PQ.',
    'Каждый SQL-файл содержит те же шаги, что «Примененные шаги» в Power Query, с подписями: какая команда → какая конструкция SQL.',
    '',
    'ЧТО НУЖНО',
    '1. duckdb.exe — один файл (DuckDB CLI для Windows, бесплатно, лицензия MIT): duckdb.org → Installation → Windows → CLI.',
    '   Положите duckdb.exe в эту папку. Если скачивать программы нельзя — попросите ИТ.',
    exts.has('excel') ? '2. Расширение excel для чтения .xlsx — «Установить.bat» поставит его сам (нужен интернет один раз).' : '2. Больше ничего: PowerShell уже есть в Windows.',
    '',
    'УСТАНОВКА',
    '1. Распакуйте комплект в папку' + (o.kitDir ? ': ' + o.kitDir + ' (этот путь записан в Excel-витрину)' : '') + '.',
    '2. Положите туда duckdb.exe.',
    '3. Запустите «Установить.bat»: проверка DuckDB, ' + (exts.has('excel') ? 'расширение excel, ' : '') + (o.schedule ? 'расписание (каждый день в ' + o.schedule + '), ' : '') + 'первое обновление.',
    '',
    'КАЖДЫЙ ДЕНЬ',
    '• «Обновить.bat» — пересчитать всё (или ждите расписания).',
    '• «Открыть витрину.bat» — итоговые таблицы с графиками для руководителя.',
    '• Excel-витрина (если скачали её в Мастере) — копия книги, где запросы читают готовые таблицы из папки «витрина\\данные»: «Обновить всё» занимает секунды.',
    '',
    'ЕСЛИ ЧТО-ТО НЕ ТАК',
    '• Журнал каждого запуска — «журнал\\журнал.csv», подробности последнего — «журнал\\последний.json».',
    '• Откройте Мастер PQ → Гиперзум → Обслуживание → «Открыть журнал»: история, время по запросам, подсказки по ошибкам.',
    '• Резерв всегда есть: исходная книга с Power Query работает как раньше.',
    '',
    'ЗАПРОСЫ',
    ...ready.map(q => '✓ «' + q.name + '» — ' + (q.out ? 'итоговый' : 'промежуточный') + ', шагов ' + q.steps.length),
    ...wait.map(q => '… «' + q.name + '» — пока не в комплекте: ' + (q.manualSteps.length ? q.manualSteps.map(s => '«' + s.name + '» (' + s.reason + ')').join('; ') : 'зависит от непереведённого запроса') + '. Переведите в Мастере (Гиперзум → Оценка → «Задача для Claude») и пересоздайте комплект.'),
    prep.length ? '' : null, prep.length ? 'ЗАГРУЗЧИКИ' : null,
    ...prep.map(p => '• ' + p.name + ': ' + ({ recode: 'перекодировка ' + p.src + ' в UTF-8', odata: '1С OData ' + p.url + ' / ' + p.entity + ' (логин спросят при первом запуске и сохранят зашифрованным для вашей учётной записи Windows)', sql: 'SQL Server ' + p.server + ' (вход Windows)' })[p.kind]),
    '',
    'ВАЖНО О ДАННЫХ',
    'Комплект содержит пути к файлам и базам компании, а после запуска — сами данные (база.duckdb, витрины).',
    'Храните его там же, где книгу; не пересылайте наружу. В сеть обращаются только загрузчики — к вашим же 1С и SQL Server — и «Установить.bat» один раз за расширением excel.'
  ].filter(x => x !== null).join('\n') + '\n';
}

/* ---------- Витрина для руководителя ---------- */
const HZ_VZ_CSS = `.vz{--vz-bg:#f6f7fb;--vz-card:#fff;--vz-ink:#1d2433;--vz-mut:#6b7385;--vz-line:#e3e6ee;--vz-1:#3b6fe0;--vz-2:#e0803b;--vz-pos:#1f9d6b;--vz-neg:#d1495b;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--vz-ink);background:var(--vz-bg)}
@media (prefers-color-scheme:dark){.vz{--vz-bg:#14171f;--vz-card:#1c2030;--vz-ink:#e8ebf3;--vz-mut:#9aa3b5;--vz-line:#2c3245;--vz-1:#6f98ff;--vz-2:#f2a35e;--vz-pos:#45c491;--vz-neg:#f0707f}}
.vz *{box-sizing:border-box}.vz svg,.vz svg *{stroke:none}.vz svg line{stroke:currentColor}.vz svg text{font-weight:400}.vz-wrap{max-width:1200px;margin:0 auto;padding:20px 16px}.vz h1{font-size:22px;margin:0 0 2px}.vz .vz-sub{color:var(--vz-mut);margin-bottom:16px}
.vz-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-bottom:16px}.vz-tile{background:var(--vz-card);border:1px solid var(--vz-line);border-radius:10px;padding:12px 14px}.vz-tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.vz-tile span{color:var(--vz-mut);font-size:12px}
.vz-sec{background:var(--vz-card);border:1px solid var(--vz-line);border-radius:12px;padding:14px 16px;margin-bottom:16px}.vz-sec h2{font-size:17px;margin:0 0 8px}.vz-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-bottom:10px}
.vz-chart h3{font-size:13px;color:var(--vz-mut);font-weight:600;margin:0 0 4px}.vz svg{width:100%;height:auto;display:block}.vz svg text{fill:var(--vz-mut);font-size:11px}.vz svg .v{fill:var(--vz-ink)}
.vz-tools{display:flex;gap:8px;align-items:center;margin:6px 0}.vz-tools input{flex:1;max-width:320px;padding:6px 10px;border:1px solid var(--vz-line);border-radius:8px;background:var(--vz-bg);color:var(--vz-ink)}.vz-tools span{color:var(--vz-mut);font-size:12px}
.vz-tbl{overflow:auto;max-height:480px;border:1px solid var(--vz-line);border-radius:8px}.vz table{border-collapse:collapse;width:100%;font-size:13px}.vz th,.vz td{padding:5px 9px;border-bottom:1px solid var(--vz-line);white-space:nowrap;text-align:left}.vz th{position:sticky;top:0;background:var(--vz-card);cursor:pointer;user-select:none}.vz td.vz-n,.vz th.vz-n{text-align:right;font-variant-numeric:tabular-nums;color:inherit}.vz tr.vz-tot td{font-weight:700;background:var(--vz-bg)}.vz td.vz-neg{color:var(--vz-neg)}`;
/** Рисует витрину: плитки-итоги, по каждой таблице — динамика по датам, крупнейшие категории, таблица с поиском и итогами.
    data: { title, built, tables: [{ name, csv }] | [{ name, cols, rows }] } — функция самодостаточна (копируется в файл витрины). */
function hzVitrinaRender(root, data){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (v, d) => v == null || v === '' ? '' : typeof v === 'number' ? v.toLocaleString('ru-RU', { maximumFractionDigits: d == null ? 2 : d }) : String(v);
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const dt = v => { const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(v == null ? '' : String(v)); return m ? m[3] + '.' + m[2] + '.' + m[1] + (m[4] && !/^ 00:00(:00)?$/.test(m[4]) ? m[4] : '') : fmt(v); };
  const mon = k => { const m = /^(\d{4})-(\d{2})/.exec(k); return m ? MON[+m[2] - 1] + ' ' + m[1].slice(2) : k; };
  const big = v => { const a = Math.abs(v); return a >= 1e9 ? fmt(v / 1e9, 1) + ' млрд' : a >= 1e6 ? fmt(v / 1e6, 1) + ' млн' : a >= 1e4 ? fmt(v / 1e3, 1) + ' тыс' : fmt(v, 0); };
  const parseCsv = t => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < t.length; i++){ const ch = t[i]; if (q){ if (ch === '"'){ if (t[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; continue; } if (ch === '"' && cur === '') q = true; else if (ch === ','){ row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; } if (cur !== '' || row.length){ row.push(cur); rows.push(row); } return rows; };
  const reNum = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/, reDate = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
  const tables = (data.tables || []).map(t => {
    let cols, rows; if (t.csv != null){ const r = parseCsv(t.csv.replace(/^﻿/, '')); cols = r[0] || []; rows = r.slice(1); } else { cols = t.cols; rows = t.rows; }
    const kinds = cols.map((_, i) => { let num = 0, dt = 0, filled = 0; for (const r of rows){ const v = r[i]; if (v == null || v === '') continue; filled++; if (typeof v === 'number' || reNum.test(v)) num++; else if (v instanceof Date || reDate.test(v)) dt++; } return !filled ? 't' : num === filled ? 'n' : dt === filled ? 'd' : 't'; });
    rows = rows.map(r => r.map((v, i) => v === '' || v == null ? null : kinds[i] === 'n' ? +v : v));
    return { name: t.name, cols, rows, kinds };
  });
  const tiles = []; const secs = [];
  tables.forEach((t, ti) => {
    const nums = t.cols.map((c, i) => i).filter(i => t.kinds[i] === 'n' && !/^(год|месяц|№|код|id|номер|индекс|счёт|счет)/i.test(t.cols[i]));
    const sums = nums.map(i => t.rows.reduce((s, r) => s + (r[i] || 0), 0));
    const main = nums.length ? nums[sums.map(Math.abs).indexOf(Math.max(...sums.map(Math.abs)))] : -1;
    tiles.push('<div class="vz-tile"><span>' + esc(t.name) + '</span><b>' + (main >= 0 ? big(sums[nums.indexOf(main)]) : fmt(t.rows.length, 0)) + '</b><span>' + (main >= 0 ? esc(t.cols[main]) + ' · ' : '') + fmt(t.rows.length, 0) + ' строк</span></div>');
    const charts = [];
    const di = t.kinds.indexOf('d'); const ci = t.kinds.findIndex((k, i) => k === 't' && new Set(t.rows.map(r => r[i])).size <= 400 && new Set(t.rows.map(r => r[i])).size > 1);
    if (main >= 0 && di >= 0){
      const by = new Map(); for (const r of t.rows){ const k = String(r[di] || '').slice(0, 7); if (!k) continue; by.set(k, (by.get(k) || 0) + (r[main] || 0)); }
      const ks = [...by.keys()].sort(); if (ks.length >= 2){ const vs = ks.map(k => by.get(k)); const W = 560, H = 200, P = 34; const mx = Math.max(...vs, 0), mn = Math.min(...vs, 0); const y = v => H - 22 - (v - mn) / ((mx - mn) || 1) * (H - 40); const bw = (W - P) / ks.length;
        charts.push('<div class="vz-chart"><h3>' + esc(t.cols[main]) + ' по месяцам</h3><svg viewBox="0 0 ' + W + ' ' + H + '"><line x1="' + P + '" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="currentColor" opacity=".25"/>' + ks.map((k, i) => { const v = vs[i], x = P + i * bw + bw * 0.15, yy = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0))); return '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="var(' + (v < 0 ? '--vz-neg' : '--vz-1') + ')"><title>' + esc(mon(k)) + ': ' + fmt(v) + '</title></rect>' + (ks.length <= 18 ? '<text x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(mon(k)) + '</text>' : ''); }).join('') + '<text x="2" y="12">' + esc(big(mx)) + '</text><text x="2" y="' + (H - 24) + '">' + esc(big(mn)) + '</text></svg></div>'); }
    }
    if (main >= 0 && ci >= 0){
      const by = new Map(); for (const r of t.rows){ const k = r[ci] == null ? '(пусто)' : String(r[ci]); by.set(k, (by.get(k) || 0) + (r[main] || 0)); }
      const top = [...by].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10); const mx = Math.max(...top.map(x => Math.abs(x[1])), 1); const W = 560, row = 22, H = top.length * row + 6, L = 170;
      charts.push('<div class="vz-chart"><h3>' + esc(t.cols[main]) + ' по «' + esc(t.cols[ci]) + '» — крупнейшие</h3><svg viewBox="0 0 ' + W + ' ' + H + '">' + top.map(([k, v], i) => { const w = Math.abs(v) / mx * (W - L - 90); return '<text x="' + (L - 6) + '" y="' + (i * row + 15) + '" text-anchor="end">' + esc(k.length > 26 ? k.slice(0, 25) + '…' : k) + '</text><rect x="' + L + '" y="' + (i * row + 4) + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + (row - 8) + '" rx="3" fill="var(' + (v < 0 ? '--vz-neg' : '--vz-2') + ')"><title>' + esc(k) + ': ' + fmt(v) + '</title></rect><text class="v" x="' + (L + w + 6).toFixed(1) + '" y="' + (i * row + 15) + '">' + esc(big(v)) + '</text>'; }).join('') + '</svg></div>');
    }
    secs.push('<section class="vz-sec" data-t="' + ti + '"><h2>' + esc(t.name) + '</h2>' + (charts.length ? '<div class="vz-charts">' + charts.join('') + '</div>' : '') + '<div class="vz-tools"><input type="search" placeholder="Поиск по таблице…" data-q="' + ti + '"><span data-c="' + ti + '"></span></div><div class="vz-tbl" data-tb="' + ti + '"></div></section>');
  });
  root.innerHTML = '<div class="vz-wrap"><h1>' + esc(data.title || 'Витрина') + '</h1><div class="vz-sub">Обновлено: ' + esc(data.built || '') + ' · данные посчитаны DuckDB (Гиперзум, Мастер PQ)</div><div class="vz-tiles">' + tiles.join('') + '</div>' + secs.join('') + '</div>';
  const state = tables.map(() => ({ q: '', sort: -1, desc: false }));
  const draw = ti => {
    const t = tables[ti], s = state[ti]; let rows = t.rows;
    if (s.q){ const q = s.q.toLowerCase(); rows = rows.filter(r => r.some(v => v != null && String(v).toLowerCase().includes(q))); }
    if (s.sort >= 0){ const i = s.sort, d = s.desc ? -1 : 1; rows = rows.slice().sort((a, b) => a[i] == null ? 1 : b[i] == null ? -1 : (a[i] < b[i] ? -d : a[i] > b[i] ? d : 0)); }
    const show = rows.slice(0, 300); const tot = t.cols.map((_, i) => t.kinds[i] === 'n' ? rows.reduce((x, r) => x + (r[i] || 0), 0) : null);
    root.querySelector('[data-tb="' + ti + '"]').innerHTML = '<table><tr>' + t.cols.map((c, i) => '<th class="' + (t.kinds[i] === 'n' ? 'vz-n' : '') + '" data-s="' + i + '">' + esc(c) + (s.sort === i ? (s.desc ? ' ▼' : ' ▲') : '') + '</th>').join('') + '</tr>' +
      show.map(r => '<tr>' + r.map((v, i) => '<td class="' + (t.kinds[i] === 'n' ? 'vz-n' + (v < 0 ? ' vz-neg' : '') : '') + '">' + esc(t.kinds[i] === 'd' ? dt(v) : fmt(v)) + '</td>').join('') + '</tr>').join('') +
      (tot.some(x => x != null) ? '<tr class="vz-tot">' + tot.map((v, i) => '<td class="' + (v != null ? 'vz-n' : '') + '">' + (i === 0 && v == null ? 'Итого' : esc(fmt(v))) + '</td>').join('') + '</tr>' : '') + '</table>';
    root.querySelector('[data-c="' + ti + '"]').textContent = 'строк: ' + rows.length.toLocaleString('ru-RU') + (rows.length > show.length ? ' (показаны первые ' + show.length + ')' : '');
    root.querySelectorAll('[data-tb="' + ti + '"] th').forEach(th => { th.onclick = () => { const i = +th.dataset.s; s.desc = s.sort === i ? !s.desc : false; s.sort = i; draw(ti); }; });
  };
  tables.forEach((_, ti) => { draw(ti); root.querySelector('[data-q="' + ti + '"]').oninput = e => { state[ti].q = e.target.value; draw(ti); }; });
}
/** Файл витрины: data — готовые данные (скачать сейчас) или null — шаблон с меткой __PQM_DATA__ для обновления комплектом */
function hzVitrinaHtml(data, title){
  const LT = '<'; const json = data ? JSON.stringify(data).replace(/</g, '\\u003c') : '__PQM_DATA__';
  return LT + '!doctype html>\n' + LT + 'html lang="ru">' + LT + 'head>' + LT + 'meta charset="utf-8">' + LT + 'meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:">' + LT + 'meta name="viewport" content="width=device-width, initial-scale=1">' +
    LT + 'title>' + escHtml('Витрина — ' + (title || '')) + LT + '/title>' + LT + 'style>body{margin:0}' + HZ_VZ_CSS + LT + '/style>' + LT + '/head>' + LT + 'body class="vz">' + LT + 'div id="root">' + LT + '/div>' +
    LT + 'script type="application/json" id="pqm-v-data">' + json + LT + '/script>' + LT + 'script>' + hzVitrinaRender.toString() + '\nconst d = JSON.parse(document.getElementById("pqm-v-data").textContent); d.title = d.title || ' + JSON.stringify('Витрина — ' + (title || '')) + '; hzVitrinaRender(document.getElementById("root"), d);' + LT + '/script>' + LT + '/body>' + LT + '/html>\n';
}

/* ---------- Excel-витрина: копия книги, где итоговые запросы читают готовые CSV из комплекта ---------- */
const HZ_MTYPE = ty => /^DATE$/.test(ty) ? 'type date' : /^TIMESTAMP/.test(ty) ? 'type datetime' : /^(BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER)/.test(ty) ? 'Int64.Type' : /^(DOUBLE|FLOAT|DECIMAL)/.test(ty) ? 'type number' : ty === 'BOOLEAN' ? 'type logical' : 'type text';
function hzExcelSection(plan, types, kitDir){
  const sec = parseSection(plan.text); let text = plan.text; const dir = String(kitDir || '').replace(/[\\/]+$/, '');
  const reps = [];
  for (const m of sec.members){
    const q = plan.byName.get(m.name); const ty = types.get(m.name); if (!q || !q.out || !ty) continue;
    const path = dir + '\\витрина\\данные\\' + HZ_SAFE(m.name) + '.csv';
    const code = ' let\r\n    // Гиперзум: данные считает DuckDB (комплект «' + dir + '»). Исходный запрос — в книге-оригинале.\r\n' +
      '    Источник = Csv.Document(File.Contents(' + mQuoteString(path) + '), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),\r\n' +
      '    Заголовки = Table.PromoteHeaders(Источник, [PromoteAllScalars = true]),\r\n' +
      '    Типы = Table.TransformColumnTypes(Заголовки, {' + ty.filter(([c]) => c !== HZ_R).map(([c, t]) => '{' + mQuoteString(c) + ', ' + HZ_MTYPE(t) + '}').join(', ') + '}, "en-US")\r\nin\r\n    Типы';
    reps.push([m.exprStart, m.exprEnd, code]);
  }
  for (const [a, b, c] of reps.sort((x, y) => y[0] - x[0])) text = text.slice(0, a) + c + text.slice(b);
  return { text, count: reps.length };
}
