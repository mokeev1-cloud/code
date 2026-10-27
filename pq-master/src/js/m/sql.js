/* =====================================================================
   m/sql.js — «Гиперзум»: перевод запросов Power Query (M) в SQL для DuckDB.
   Power Query остаётся источником истины: запросы правят как привыкли, перевод строится заново.
   Каждый шаг let…in становится CTE с тем же именем, что в «Примененных шагах», и комментарием:
   какая команда Power Query → какая конструкция SQL. Порядок строк Power Query хранит служебный
   столбец __r (номер строки): по нему работают «Удалить дубликаты», «Заполнить вниз», индекс,
   «Сохранить первые строки», и в нём же итоговый порядок.
   Классы шагов: sql — переведён; source — источник, который комплект читает сам (CSV, лист, таблица
   книги); loader — внешний источник (1С OData, SQL-сервер, веб, папка) — нужен загрузчик комплекта;
   helper — список или значение, подставляется в другие шаги; manual — не переводится (причина
   простыми словами), в браузере его считает интерпретатор Мастера, для комплекта — перевести вручную
   или через Claude (обезличенно).
   API: hzPlan(A, opts) → план; hzQuerySql(plan, q, mode) → текст SQL запроса; HZ_MACROS; HZ_OPS.
   Чистые функции: ни DOM, ни данных — только код книги (значения путей — через интерпретатор).
   ===================================================================== */
const HZ_R = '__r';
const hzQ = n => '"' + String(n).replace(/"/g, '""') + '"';
const hzS = s => "'" + String(s).replace(/'/g, "''") + "'";
class HzNo extends Error {}
const hzNo = msg => { throw new HzNo(msg); };

/* Словарь «команда Power Query → SQL»: функция|команда на ленте PQ|конструкция SQL|пояснение для новичка в SQL */
const HZ_OPS_SRC = `Table.SelectRows|Фильтр строк|WHERE|оставляет только строки, где условие истинно
Table.AddColumn|Добавить столбец → Настраиваемый столбец|выражение в SELECT|новый столбец считается по каждой строке
Table.TransformColumnTypes|Изменить тип|pq_num / pq_date / pq_text|помощники повторяют правила Power Query для культуры ru-RU (запятая в числах, даты дд.мм.гггг)
Table.TransformColumns|Преобразовать (Формат, Извлечь, Округлить…)|SELECT * REPLACE|столбец заменяется результатом функции
Table.RenameColumns|Переименовать|SELECT * RENAME|меняет только имя столбца
Table.RemoveColumns|Удалить столбцы|SELECT * EXCLUDE|все столбцы, кроме перечисленных
Table.SelectColumns|Выбрать столбцы / Удалить другие столбцы|SELECT список|только перечисленные столбцы
Table.ReorderColumns|Переместить столбцы|SELECT в нужном порядке|меняет порядок столбцов
Table.Distinct|Удалить дубликаты|GROUP BY ALL / QUALIFY|остаётся первая строка каждого набора значений
Table.Sort|Сортировка|ORDER BY|порядок строк; равные остаются в прежнем порядке
Table.Group|Группировать по|GROUP BY|одна строка на каждый ключ, агрегаты — sum, count, min, max…
Table.NestedJoin|Объединить запросы|JOIN|слияние с другой таблицей по ключу (вместе с «Развернуть» — один JOIN)
Table.ExpandTableColumn|Развернуть столбец|JOIN … столбцы справа|столбцы присоединённой таблицы
Table.AggregateTableColumn|Развернуть → Агрегировать|JOIN к GROUP BY|итоги по присоединённой таблице
Table.Join|Объединить (плоское)|JOIN|слияние без вложенной таблицы
Table.Combine|Добавить запросы|UNION ALL BY NAME|строки таблиц одна под другой, столбцы — по именам
Table.UnpivotOtherColumns|Отменить свёртку других столбцов|UNPIVOT|широкая таблица → длинная: столбцы становятся строками «Атрибут / Значение»
Table.Unpivot|Отменить свёртку столбцов|UNPIVOT|выбранные столбцы становятся строками
Table.Pivot|Столбец сведения|PIVOT|значения атрибута становятся столбцами
Table.FillDown|Заполнить вниз|last_value … IGNORE NULLS|пустая ячейка получает значение сверху
Table.FillUp|Заполнить вверх|first_value … IGNORE NULLS|пустая ячейка получает значение снизу
Table.ReplaceValue|Замена значений|CASE / replace|точное значение или часть текста
Table.AddIndexColumn|Столбец индекса|row_number()|номер строки по порядку
Table.DuplicateColumn|Дублировать столбец|копия в SELECT|тот же столбец под новым именем
Table.FirstN|Сохранить первые строки|QUALIFY row_number()|первые N строк
Table.Skip|Удалить первые строки|QUALIFY row_number()|без первых N строк
Table.RemoveFirstN|Удалить первые строки|QUALIFY row_number()|без первых N строк
Table.LastN|Сохранить последние строки|QUALIFY row_number()|последние N строк
Table.RemoveLastN|Удалить последние строки|QUALIFY row_number()|без последних N строк
Table.Range|Сохранить диапазон строк|QUALIFY row_number()|строки с M по N
Table.ReverseRows|Обратный порядок строк|ORDER BY … DESC|последняя строка становится первой
Table.SplitColumn|Разделить столбец по разделителю|string_split|части текста — в новые столбцы
Table.ReplaceErrorValues|Заменить ошибки|COALESCE|в DuckDB ошибок в ячейках нет — неудачное преобразование даёт пусто
Table.RemoveRowsWithErrors|Удалить ошибки|—|в DuckDB ошибок в ячейках нет
Table.Buffer|Буферизация|не нужна|DuckDB вычисляет каждый шаг один раз
Table.PromoteHeaders|Использовать первую строку в качестве заголовков|header = true|в чтении файла
Excel.CurrentWorkbook|Из таблицы/диапазона|read_xlsx|таблица этой книги
Csv.Document|Из текстового/CSV-файла|read_csv|файл читается напрямую
Excel.Workbook|Из книги Excel|read_xlsx|лист другой книги
Folder.Files|Из папки|read_csv('папка/*.csv')|все файлы папки сразу
OData.Feed|Из канала OData (1С)|загрузчик комплекта|PowerShell выгружает данные 1С в CSV
Sql.Database|Из базы SQL Server|загрузчик комплекта|PowerShell выгружает таблицу или запрос в CSV`;
const HZ_OPS = new Map(HZ_OPS_SRC.split('\n').map(l => { const [fn, ui, sql, note] = l.split('|'); return [fn, { ui, sql, note }]; }));

/* Помощники SQL: преобразования типов по правилам интерпретатора Мастера (культура ru-RU по умолчанию).
   typeof(x) вычисляется при разборе запроса, поэтому лишние ветви не стоят ничего; CAST(x AS VARCHAR)
   в каждой ветви — чтобы макрос подходил к столбцу любого типа. */
const HZ_NBSP = ' ';
const HZ_NUMERIC = "(typeof(x) IN ('DOUBLE','FLOAT','BIGINT','INTEGER','HUGEINT','SMALLINT','TINYINT','UBIGINT','UINTEGER') OR typeof(x) LIKE 'DECIMAL%')";
const HZ_DFMT = c => (c === 'en' ? ["'%m/%d/%Y'", "'%m/%d/%Y %H:%M:%S'", "'%m/%d/%Y %H:%M'"] : ["'%d.%m.%Y'", "'%d.%m.%Y %H:%M:%S'", "'%d.%m.%Y %H:%M'", "'%d/%m/%Y'", "'%d-%m-%Y'", "'%d.%m.%y'"]).concat(["'%Y-%m-%d'", "'%Y-%m-%d %H:%M:%S'", "'%Y-%m-%d %H:%M'", "'%Y-%m-%dT%H:%M:%S'"]).join(', ');
const HZ_MACROS = [
  '-- Помощники «Гиперзума»: преобразования типов как в Power Query. Ошибка преобразования даёт пустое значение (NULL).',
  "CREATE OR REPLACE MACRO pq_num(x) AS CASE WHEN typeof(x) = 'VARCHAR' THEN TRY_CAST(replace(replace(regexp_replace(CAST(x AS VARCHAR), '[\\s" + HZ_NBSP + "]', '', 'g'), '.', ''), ',', '.') AS DOUBLE) ELSE TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) END;",
  "CREATE OR REPLACE MACRO pq_num_en(x) AS CASE WHEN typeof(x) = 'VARCHAR' THEN TRY_CAST(replace(regexp_replace(CAST(x AS VARCHAR), '[\\s" + HZ_NBSP + "]', '', 'g'), ',', '') AS DOUBLE) ELSE TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) END;",
  "CREATE OR REPLACE MACRO pq_text(x) AS CASE WHEN x IS NULL THEN NULL WHEN typeof(x) IN ('DOUBLE','FLOAT') AND TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) = trunc(TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE)) AND abs(TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE)) < 1e15 THEN CAST(CAST(TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) AS BIGINT) AS VARCHAR) ELSE CAST(x AS VARCHAR) END;",
  "CREATE OR REPLACE MACRO pq_text_ru(x) AS CASE WHEN " + HZ_NUMERIC + " THEN replace(pq_text(x), '.', ',') ELSE pq_text(x) END;",
  ...['', '_en'].map(sfx => "CREATE OR REPLACE MACRO pq_date" + sfx + "(x) AS CASE WHEN x IS NULL THEN NULL WHEN typeof(x) = 'DATE' THEN TRY_CAST(CAST(x AS VARCHAR) AS DATE) WHEN typeof(x) LIKE 'TIMESTAMP%' THEN CAST(TRY_CAST(CAST(x AS VARCHAR) AS TIMESTAMP) AS DATE) WHEN " + HZ_NUMERIC + " THEN DATE '1899-12-30' + CAST(floor(TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE)) AS INTEGER) ELSE CAST(try_strptime(trim(CAST(x AS VARCHAR)), [" + HZ_DFMT(sfx ? 'en' : 'ru') + "]) AS DATE) END;"),
  ...['', '_en'].map(sfx => "CREATE OR REPLACE MACRO pq_datetime" + sfx + "(x) AS CASE WHEN x IS NULL THEN NULL WHEN typeof(x) = 'DATE' OR typeof(x) LIKE 'TIMESTAMP%' THEN TRY_CAST(CAST(x AS VARCHAR) AS TIMESTAMP) WHEN " + HZ_NUMERIC + " THEN TIMESTAMP '1899-12-30 00:00:00' + to_milliseconds(CAST(round(TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) * 86400000) AS BIGINT)) ELSE try_strptime(trim(CAST(x AS VARCHAR)), [" + HZ_DFMT(sfx ? 'en' : 'ru') + "]) END;"),
  "CREATE OR REPLACE MACRO pq_bool(x) AS CASE WHEN x IS NULL THEN NULL WHEN typeof(x) = 'BOOLEAN' THEN TRY_CAST(CAST(x AS VARCHAR) AS BOOLEAN) WHEN typeof(x) = 'VARCHAR' THEN (CASE lower(trim(CAST(x AS VARCHAR))) WHEN 'true' THEN true WHEN 'false' THEN false END) ELSE TRY_CAST(CAST(x AS VARCHAR) AS DOUBLE) <> 0 END;"
].join('\n');

/* ---------- Выражения (внутри each, условий фильтра, новых столбцов) ---------- */
const hzLit = v => {
  if (v === null) return 'NULL'; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number'){ if (!isFinite(v)) hzNo('бесконечность или NaN'); return String(v); }
  if (typeof v === 'string') return hzS(v);
  if (v instanceof MDate){ const t = mToText(v); return v.kind === 'date' ? "DATE '" + t + "'" : v.kind === 'datetime' ? "TIMESTAMP '" + t + "'" : hzNo('значение «' + v.kind + '»'); }
  if (v instanceof MDur) return 'to_milliseconds(' + v.ms + ')';
  hzNo('значение типа ' + mTypeName(v));
};
const hzConst = n => n && n.k === 'const' ? n.v : n && n.k === 'neg' && n.e.k === 'const' && typeof n.e.v === 'number' ? -n.e.v : undefined;
const hzStr = (n, what) => { const v = hzConst(n); if (typeof v !== 'string') hzNo((what || 'имя столбца') + ' задано не строкой, а выражением'); return v; };
const hzStrList = (n, what) => { if (n && n.k === 'const' && typeof n.v === 'string') return [n.v]; if (!n || n.k !== 'list') hzNo((what || 'список столбцов') + ' задан выражением, а не списком'); return n.items.map(x => hzStr(x, what)); };
const hzEnum = (n, fallback) => { if (!n) return fallback; const c = hzConst(n); if (c === null) return fallback; if (typeof c === 'number') return c; if (n.k === 'id' && typeof ENUM_VALS[n.n] === 'number') return ENUM_VALS[n.n]; hzNo('параметр задан выражением'); };
const hzCulture = n => { const c = n ? hzConst(n) : null; if (c === undefined) hzNo('культура задана выражением'); return !c || /^(ru|de|fr|uk|kk|be|es|it|pt|pl|cs)/i.test(c) ? '' : '_en'; };
const HZ_DOW = { 'Day.Sunday': 0, 'Day.Monday': 1 };
const HZ_TYPES = { number: 'num', decimal: 'num', double: 'num', single: 'num', percentage: 'num', int64: 'int', int32: 'int', int16: 'int', int8: 'int', byte: 'int', currency: 'cur', text: 'text', date: 'date', datetime: 'datetime', logical: 'bool', any: 'any' };
function hzTypeOf(n){
  if (n && n.k === 'const' && n.v instanceof MType) return n.v.name;
  if (n && n.k === 'id'){ const m = /^(Int64|Int32|Int16|Int8|Byte|Currency|Percentage|Decimal|Double|Single|Number|Text|Date|DateTime|Logical)\.Type$/.exec(n.n); if (m) return m[1].toLowerCase(); }
  hzNo('тип задан выражением');
}
/** Преобразование типа значения (SQL-выражение) — как Table.TransformColumnTypes */
function hzConv(x, ty, cu, cx){
  const k = HZ_TYPES[ty]; if (!k) hzNo('тип «' + ty + '» (время, длительность, запись…)');
  if (k === 'any') return x;
  if (k === 'num') return 'pq_num' + cu + '(' + x + ')';
  if (k === 'int') return 'round_even(pq_num' + cu + '(' + x + '), 0)';
  if (k === 'cur') return 'round_even(pq_num' + cu + '(' + x + '), 4)';
  if (k === 'text'){ cx.risk('text'); return 'pq_text(' + x + ')'; }
  if (k === 'date') return 'pq_date' + cu + '(' + x + ')';
  if (k === 'datetime') return 'pq_datetime' + cu + '(' + x + ')';
  return 'pq_bool(' + x + ')';
}
const HZ_AGG = { 'List.Sum': 'sum', 'List.Average': 'avg', 'List.Min': 'min', 'List.Max': 'max', 'List.Median': 'median', 'List.StandardDeviation': 'stddev_samp', 'List.NonNullCount': 'count', 'List.Count': 'count(*)', 'List.First': 'first', 'List.Last': 'last', 'List.Product': 'product', 'List.Mode': 'mode' };
const HZ_LISTFN = { 'List.Sum': 'list_sum', 'List.Min': 'list_min', 'List.Max': 'list_max', 'List.Average': 'list_avg', 'List.Count': 'len', 'List.NonNullCount': 'list_count' };
const hzRound = (x, d, mode) => { const f = d === '0' ? '' : ', ' + d; const p = 'power(10, ' + d + ')';
  return mode === 0 ? (d === '0' ? 'ceil(' + x + ')' : 'ceil(' + x + ' * ' + p + ') / ' + p) : mode === 1 ? (d === '0' ? 'floor(' + x + ')' : 'floor(' + x + ' * ' + p + ') / ' + p) : mode === 2 ? 'round(' + x + f + ')' : mode === 3 ? (d === '0' ? 'trunc(' + x + ')' : 'trunc(' + x + ' * ' + p + ') / ' + p) : 'round_even(' + x + (d === '0' ? ', 0' : f) + ')'; };
/** Скалярные функции: имя → (a — SQL аргументов, n — узлы, cx) => SQL */
const HZ_FN = {
  'Text.Upper': a => 'upper(' + a[0] + ')', 'Text.Lower': a => 'lower(' + a[0] + ')', 'Text.Proper': a => 'list_aggregate(list_transform(string_split(lower(' + a[0] + "), ' '), w -> upper(left(w, 1)) || substr(w, 2)), 'string_agg', ' ')",
  'Text.Trim': (a, n) => n.length > 1 ? hzNo('Text.Trim с набором символов') : "trim(" + a[0] + ")", 'Text.TrimStart': a => 'ltrim(' + a[0] + ')', 'Text.TrimEnd': a => 'rtrim(' + a[0] + ')',
  'Text.Clean': a => "regexp_replace(" + a[0] + ", '[\\x00-\\x1F\\x7F]', '', 'g')",
  'Text.Length': a => 'length(' + a[0] + ')', 'Text.Start': a => 'left(' + a[0] + ', ' + a[1] + ')', 'Text.End': a => 'right(' + a[0] + ', ' + a[1] + ')',
  'Text.Middle': (a, n) => 'substr(' + a[0] + ', (' + a[1] + ') + 1' + (n.length > 2 ? ', ' + a[2] : '') + ')', 'Text.Range': (a, n) => 'substr(' + a[0] + ', (' + a[1] + ') + 1' + (n.length > 2 ? ', ' + a[2] : '') + ')',
  'Text.Contains': (a, n) => hzIgnoreCase(n[2]) ? 'contains(lower(' + a[0] + '), lower(' + a[1] + '))' : 'contains(' + a[0] + ', ' + a[1] + ')',
  'Text.StartsWith': (a, n) => hzIgnoreCase(n[2]) ? 'starts_with(lower(' + a[0] + '), lower(' + a[1] + '))' : 'starts_with(' + a[0] + ', ' + a[1] + ')',
  'Text.EndsWith': (a, n) => hzIgnoreCase(n[2]) ? 'ends_with(lower(' + a[0] + '), lower(' + a[1] + '))' : 'ends_with(' + a[0] + ', ' + a[1] + ')',
  'Text.Replace': a => 'replace(' + a[0] + ', ' + a[1] + ', ' + a[2] + ')', 'Text.Repeat': a => 'repeat(' + a[0] + ', ' + a[1] + ')', 'Text.Reverse': a => 'reverse(' + a[0] + ')',
  'Text.PadStart': (a, n) => 'lpad(' + a[0] + ', ' + a[1] + ', ' + (n.length > 2 ? a[2] : "' '") + ')', 'Text.PadEnd': (a, n) => 'rpad(' + a[0] + ', ' + a[1] + ', ' + (n.length > 2 ? a[2] : "' '") + ')',
  'Text.PositionOf': (a, n) => n.length > 2 ? hzNo('Text.PositionOf с вхождением') : '(strpos(' + a[0] + ', ' + a[1] + ') - 1)',
  'Text.BeforeDelimiter': (a, n) => n.length > 2 ? hzNo('Text.BeforeDelimiter с номером вхождения') : 'CASE WHEN strpos(' + a[0] + ', ' + a[1] + ') > 0 THEN split_part(' + a[0] + ', ' + a[1] + ', 1) ELSE ' + a[0] + ' END',
  'Text.AfterDelimiter': (a, n) => n.length > 2 ? hzNo('Text.AfterDelimiter с номером вхождения') : "CASE WHEN strpos(" + a[0] + ', ' + a[1] + ') > 0 THEN substr(' + a[0] + ', strpos(' + a[0] + ', ' + a[1] + ') + length(' + a[1] + ")) ELSE '' END",
  'Text.Combine': (a, n, cx) => { const l = hzListItems(n[0], cx); return 'concat_ws(' + (n.length > 1 ? a[1] : "''") + ', ' + l.join(', ') + ')'; },
  'Text.From': (a, n) => n.length > 1 && hzCulture(n[1]) === '' && hzConst(n[1]) ? 'pq_text_ru(' + a[0] + ')' : 'pq_text(' + a[0] + ')',
  'Text.ToText': a => 'pq_text(' + a[0] + ')', 'Number.ToText': (a, n) => n.length > 1 ? hzNo('Number.ToText с форматом') : 'pq_text(' + a[0] + ')',
  'Number.From': (a, n) => 'pq_num' + (n.length > 1 ? hzCulture(n[1]) : '') + '(' + a[0] + ')', 'Number.FromText': (a, n) => 'pq_num' + (n.length > 1 ? hzCulture(n[1]) : '') + '(' + a[0] + ')',
  'Int64.From': a => 'round_even(pq_num(' + a[0] + '), 0)', 'Currency.From': a => 'round_even(pq_num(' + a[0] + '), 4)', 'Decimal.From': a => 'pq_num(' + a[0] + ')', 'Logical.From': a => 'pq_bool(' + a[0] + ')',
  'Number.Round': (a, n) => hzRound(a[0], n.length > 1 && hzConst(n[1]) !== null ? a[1] : '0', hzEnum(n[2], 4)),
  'Number.RoundUp': (a, n) => hzRound(a[0], n.length > 1 ? a[1] : '0', 0), 'Number.RoundDown': (a, n) => hzRound(a[0], n.length > 1 ? a[1] : '0', 1), 'Number.RoundTowardZero': (a, n) => hzRound(a[0], n.length > 1 ? a[1] : '0', 3), 'Number.RoundAwayFromZero': (a, n) => hzRound(a[0], n.length > 1 ? a[1] : '0', 2),
  'Number.Abs': a => 'abs(' + a[0] + ')', 'Number.Sign': a => 'sign(' + a[0] + ')', 'Number.Power': a => 'power(' + a[0] + ', ' + a[1] + ')', 'Number.Sqrt': a => 'sqrt(' + a[0] + ')',
  'Number.IntegerDivide': a => 'trunc((' + a[0] + ') / (' + a[1] + '))', 'Number.Mod': a => '((' + a[0] + ') - (' + a[1] + ') * trunc((' + a[0] + ') / (' + a[1] + ')))',
  'Date.From': (a, n) => 'pq_date' + (n.length > 1 ? hzCulture(n[1]) : '') + '(' + a[0] + ')', 'Date.FromText': (a, n) => 'pq_date' + (n.length > 1 ? hzCulture(n[1]) : '') + '(' + a[0] + ')',
  'DateTime.From': (a, n) => 'pq_datetime' + (n.length > 1 ? hzCulture(n[1]) : '') + '(' + a[0] + ')', 'DateTime.Date': a => 'CAST(' + a[0] + ' AS DATE)',
  'Date.Year': a => 'year(' + a[0] + ')', 'Date.Month': a => 'month(' + a[0] + ')', 'Date.Day': a => 'day(' + a[0] + ')', 'Date.QuarterOfYear': a => 'quarter(' + a[0] + ')',
  'Date.DayOfYear': a => 'dayofyear(' + a[0] + ')', 'Date.DaysInMonth': a => 'day(last_day(' + a[0] + '))',
  'Date.DayOfWeek': (a, n) => { const f = n.length > 1 ? (n[1].k === 'id' && HZ_DOW[n[1].n] != null ? HZ_DOW[n[1].n] : hzNo('Date.DayOfWeek с первым днём, кроме воскресенья и понедельника')) : 0; return f === 1 ? '((dayofweek(' + a[0] + ') + 6) % 7)' : 'dayofweek(' + a[0] + ')'; },
  'Date.StartOfMonth': a => "date_trunc('month', " + a[0] + ')', 'Date.StartOfYear': a => "date_trunc('year', " + a[0] + ')', 'Date.StartOfQuarter': a => "date_trunc('quarter', " + a[0] + ')',
  'Date.EndOfMonth': a => 'last_day(' + a[0] + ')', 'Date.EndOfYear': a => "CAST(date_trunc('year', " + a[0] + ") + INTERVAL 1 YEAR - INTERVAL 1 DAY AS DATE)",
  'Date.AddDays': a => '(' + a[0] + ' + to_days(CAST(' + a[1] + ' AS INTEGER)))', 'Date.AddMonths': a => '(' + a[0] + ' + to_months(CAST(' + a[1] + ' AS INTEGER)))', 'Date.AddYears': a => '(' + a[0] + ' + to_years(CAST(' + a[1] + ' AS INTEGER)))',
  'Date.ToText': (a, n) => { const o = n.length > 1 ? hzConst(n[1]) : null; if (o != null && typeof o !== 'string') hzNo('Date.ToText с записью параметров'); const f = hzDateFmt(o || 'yyyy-MM-dd'); return 'strftime(' + a[0] + ', ' + hzS(f) + ')'; },
  'DateTime.LocalNow': (a, n, cx) => { cx.risk('now'); return 'current_localtimestamp()'; }, 'DateTime.FixedLocalNow': (a, n, cx) => { cx.risk('now'); return 'current_localtimestamp()'; },
  'Date.IsInCurrentMonth': (a, n, cx) => { cx.risk('now'); return "(date_trunc('month', " + a[0] + ") = date_trunc('month', current_date))"; },
  '#date': a => 'make_date(CAST(' + a[0] + ' AS BIGINT), CAST(' + a[1] + ' AS BIGINT), CAST(' + a[2] + ' AS BIGINT))',
  '#datetime': a => 'make_timestamp(CAST(' + a[0] + ' AS BIGINT), CAST(' + a[1] + ' AS BIGINT), CAST(' + a[2] + ' AS BIGINT), CAST(' + a[3] + ' AS BIGINT), CAST(' + a[4] + ' AS BIGINT), CAST(' + a[5] + ' AS DOUBLE))',
  '#duration': a => 'to_milliseconds(CAST(round(((' + a[0] + ') * 86400 + (' + a[1] + ') * 3600 + (' + a[2] + ') * 60 + (' + a[3] + ')) * 1000) AS BIGINT))',
  'List.Contains': (a, n, cx) => 'COALESCE(' + a[1] + ' IN ' + hzListSql(n[0], cx) + ', FALSE)',
  'List.ContainsAny': (a, n, cx) => 'len(list_intersect(' + hzListArr(n[0], cx) + ', ' + hzListArr(n[1], cx) + ')) > 0',
  'Value.Is': hzNoFn('Value.Is'), 'Record.Field': (a, n, cx) => { if (n[0].k === 'id' && n[0].n === cx.rowVar) return cx.col(hzStr(n[1])); return hzNo('Record.Field не по текущей строке'); }
};
function hzNoFn(name){ return () => hzNo(name + ' — нет прямого аналога'); }
function hzIgnoreCase(n){ return !!(n && n.k === 'id' && /IgnoreCase/.test(n.n)); }
function hzDateFmt(f){ if (/MMM|ddd/.test(f)) hzNo('формат даты с названиями месяцев или дней (зависит от культуры)'); return f.replace(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss/g, t => ({ yyyy: '%Y', yy: '%y', MM: '%m', M: '%-m', dd: '%d', d: '%-d', HH: '%H', H: '%-H', mm: '%M', ss: '%S' })[t]); }
/** Список значений для IN: литерал {…}, столбец таблицы (Т[Столбец], Table.Column), шаг-список */
function hzListSql(n, cx){
  n = hzUnwrapList(n, cx);
  if (n.k === 'list') return '(' + hzListItems(n, cx).join(', ') + ')';
  if (n.k === 'field' && n.e.k !== 'item'){ const t = cx.st.tref(n.e); return '(SELECT ' + hzQ(n.n) + ' FROM ' + t + ')'; }
  if (n.k === 'call' && n.f.k === 'id' && n.f.n === 'Table.Column'){ const t = cx.st.tref(n.args[0]); return '(SELECT ' + hzQ(hzStr(n.args[1])) + ' FROM ' + t + ')'; }
  hzNo('список задан выражением, которое не переводится');
}
function hzListArr(n, cx){ n = hzUnwrapList(n, cx); if (n.k === 'list') return '[' + hzListItems(n, cx).join(', ') + ']'; const s = hzListSql(n, cx); return '(SELECT list(x) FROM ' + s.replace(/^\(SELECT (.*) FROM (.*)\)$/, '(SELECT $1 AS x FROM $2)') + ')'; }
function hzUnwrapList(n, cx){
  for (let i = 0; i < 6; i++){
    if (n.k === 'call' && n.f.k === 'id' && ['List.Buffer', 'List.Distinct'].includes(n.f.n) && n.args.length === 1){ n = n.args[0]; continue; }
    if (n.k === 'id' && cx.st.helpers.has(n.n)){ n = cx.st.helpers.get(n.n); continue; }
    break;
  }
  return n;
}
function hzListItems(n, cx){ n = hzUnwrapList(n, cx); if (n.k !== 'list') hzNo('список задан выражением'); if (n.items.some(x => x.k === 'range')) hzNo('диапазон {a..b}'); return n.items.map(x => hzExpr(x, cx)); }
/** Поиск в таблице для каждой строки: Т{[Ключ = [Столбец]]}[Значение] → подзапрос (DuckDB превращает его в хеш-соединение) */
function hzLookup(item, field, opt, cx){
  if (item.ix.k !== 'rec') hzNo('доступ к строке по номеру');
  const t = cx.st.tref(item.e); const al = 's' + (++cx.st.alias);
  const conds = item.ix.fields.map(([k, v]) => al + '.' + hzQ(k) + ' IS NOT DISTINCT FROM ' + hzExpr(v, cx));
  cx.risk(opt ? 'lookup-opt' : 'lookup');
  return '(SELECT CASE WHEN count(*) = 1 THEN any_value(' + al + '.' + hzQ(field) + ') END FROM ' + t + ' AS ' + al + ' WHERE ' + conds.join(' AND ') + ')';
}
function hzExpr(n, cx){
  switch (n.k){
    case 'const': return hzLit(n.v);
    case 'id': {
      if (n.n === cx.cellVar) return cx.cell;
      if (cx.st.helpers.has(n.n) && !cx.st.inHelper.has(n.n)){ cx.st.inHelper.add(n.n); try { return '(' + hzExpr(cx.st.helpers.get(n.n), cx) + ')'; } finally { cx.st.inHelper.delete(n.n); } }
      const p = cx.st.plan.params.get(n.n); if (p !== undefined) return hzLit(p);
      if (n.n in ENUM_VALS) return String(ENUM_VALS[n.n]);
      return hzNo('имя «' + n.n + '» (шаг-таблица, функция или запрос) внутри выражения');
    }
    case 'field': {
      if (n.e.k === 'id' && n.e.n === cx.rowVar && cx.row) return cx.col(n.n);
      if (n.e.k === 'item') return hzLookup(n.e, n.n, n.opt || n.e.opt, cx);
      return hzNo('поле записи');
    }
    case 'bin': {
      if (n.o === 'meta') return hzExpr(n.l, cx);
      const l = hzExpr(n.l, cx), r = hzExpr(n.r, cx);
      switch (n.o){
        case '=': return '(' + l + ' IS NOT DISTINCT FROM ' + r + ')';
        case '<>': return '(' + l + ' IS DISTINCT FROM ' + r + ')';
        case 'and': return '(' + l + ' AND ' + r + ')'; case 'or': return '(' + l + ' OR ' + r + ')';
        case '&': return '(' + l + ' || ' + r + ')'; case '??': return 'COALESCE(' + l + ', ' + r + ')';
        case '+': case '-': case '*': case '/': case '<': case '>': case '<=': case '>=': return '(' + l + ' ' + n.o + ' ' + r + ')';
      }
      return hzNo('оператор «' + n.o + '»');
    }
    case 'not': return '(NOT ' + hzExpr(n.e, cx) + ')';
    case 'neg': return '(-' + hzExpr(n.e, cx) + ')';
    case 'if': return '(CASE WHEN ' + hzExpr(n.c, cx) + ' THEN ' + hzExpr(n.a, cx) + ' ELSE ' + hzExpr(n.b, cx) + ' END)';
    case 'try': { if (!n.o) return hzNo('try без otherwise'); const o = hzConst(n.o); cx.risk('try'); return o === null ? hzExpr(n.e, cx) : 'COALESCE(' + hzExpr(n.e, cx) + ', ' + hzExpr(n.o, cx) + ')'; }
    case 'call': {
      if (n.f.k !== 'id') return hzNo('вызов вычисляемой функции');
      const fn = n.f.n;
      if (cx.group){
        if (fn === 'Table.RowCount' && n.args.length === 1 && n.args[0].k === 'id' && n.args[0].n === cx.rowVar) return 'count(*)';
        if (fn === 'List.Count' && n.args[0] && n.args[0].k === 'call' && n.args[0].f.n === 'List.Distinct'){ cx.risk('distinct-null'); return 'count(DISTINCT ' + hzGroupCol(n.args[0].args[0], cx) + ')'; }
        if (HZ_AGG[fn]){ if (n.args.length !== 1) hzNo(fn + ' с параметрами'); const c = hzGroupCol(n.args[0], cx); const g = HZ_AGG[fn];
          return g === 'count(*)' ? 'count(*)' : g === 'first' ? 'arg_min_null(' + c + ', t.' + HZ_R + ')' : g === 'last' ? 'arg_max_null(' + c + ', t.' + HZ_R + ')' : g + '(' + c + ')'; }
      }
      if (cx.row && HZ_LISTFN[fn] && n.args.length === 1 && hzUnwrapList(n.args[0], cx).k === 'list') return HZ_LISTFN[fn] + '(' + hzListArr(n.args[0], cx) + ')';
      const f = HZ_FN[fn]; if (!f) return hzNo(HZ_OPS.has(fn) ? fn + ' внутри выражения' : 'функция ' + fn);
      // первый аргумент List.Contains / Text.Combine — список, его переводит сама функция
      const a = fn === 'List.ContainsAny' ? [] : n.args.map((x, i) => i === 0 && (fn === 'List.Contains' || fn === 'Text.Combine') ? null : hzExpr(x, cx));
      return f(a, n.args, cx);
    }
    case 'list': return hzNo('список внутри выражения');
    case 'rec': return hzNo('запись внутри выражения');
    case 'fn': return hzNo('функция внутри выражения');
    case 'item': return hzNo('элемент списка или таблицы по номеру');
    case 'as': case 'is': return hzNo('проверка типа');
  }
  return hzNo('конструкция «' + n.k + '»');
}
/** Столбец внутри агрегата группировки: [Столбец] */
function hzGroupCol(n, cx){ if (n.k === 'field' && n.e.k === 'id' && n.e.n === cx.rowVar) return 't.' + hzQ(n.n); return hzNo('агрегат не по столбцу группы'); }
/** Функция одного аргумента (each …, (x) => …, Text.Trim) применённая к SQL-значению x */
function hzApply(fnNode, x, cx){
  if (fnNode.k === 'fn'){ if (fnNode.params.length !== 1) hzNo('функция с несколькими параметрами'); return hzExpr(fnNode.body, Object.assign({}, cx, { row: false, cellVar: fnNode.params[0].name, cell: x })); }
  if (fnNode.k === 'id' && HZ_FN[fnNode.n]) return HZ_FN[fnNode.n]([x], [{ k: 'id', n: '·' }], cx);
  if (fnNode.k === 'id' && fnNode.n.endsWith('.Type')) return x;
  return hzNo('преобразование задано выражением');
}
/** Тело each по строке: [Столбец] → t."Столбец" */
function hzRowFn(fnNode, cx){
  if (fnNode.k !== 'fn' || fnNode.params.length !== 1) hzNo('условие или формула задана не через each');
  return hzExpr(fnNode.body, Object.assign({}, cx, { row: true, rowVar: fnNode.params[0].name, cellVar: null }));
}

/* ---------- Табличные шаги: имя функции → (аргументы, cx, имя шага) => SELECT … ---------- */
const hzFrom = (n, cx) => cx.st.tref(n) + ' AS t';
const hzCols = cs => cs.map(hzQ).join(', ');
function hzJoinKind(n){ const k = hzEnum(n, 1); if (![0, 1, 2, 3, 4, 5].includes(k)) hzNo('вид соединения'); return k; }
const HZ_JOIN = ['JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ANTI JOIN'];
const hzOn = (lk, rk) => { if (lk.length !== rk.length) hzNo('разное число ключей слева и справа'); return lk.map((k, i) => 'l.' + hzQ(k) + ' IS NOT DISTINCT FROM r.' + hzQ(rk[i])).join(' AND '); };
function hzSortItems(n, cx){
  const one = x => { if (x.k === 'fn') return { e: hzRowFn(x, cx), desc: false }; if (x.k === 'list' && x.items.length === 2){ const f = x.items[0]; const e = f.k === 'fn' ? hzRowFn(f, cx) : 't.' + hzQ(hzStr(f)); return { e, desc: hzEnum(x.items[1], 0) === 1 }; } return { e: 't.' + hzQ(hzStr(x)), desc: false }; };
  if (n.k === 'list' && n.items.length === 2 && hzConst(n.items[0]) !== undefined && typeof hzConst(n.items[0]) === 'string' && (n.items[1].k === 'id' || typeof hzConst(n.items[1]) === 'number')) return [one(n)];
  return n.k === 'list' ? n.items.map(one) : [one(n)];
}
const hzRowCut = (cond, desc) => 'SELECT * FROM ' + '%FROM%' + ' QUALIFY ' + cond.replace('%RN%', 'row_number() OVER (ORDER BY t.' + HZ_R + (desc ? ' DESC' : '') + ')');
const hzCnt = (n, cx, dflt) => n == null || hzConst(n) === null ? String(dflt) : n.k === 'fn' ? hzNo('условие вместо числа строк') : hzExpr(n, cx);
const HZ_T = {
  'Table.SelectRows': (a, cx) => 'SELECT t.* FROM ' + hzFrom(a[0], cx) + ' WHERE ' + hzRowFn(a[1], cx),
  'Table.AddColumn': (a, cx) => 'SELECT t.*, ' + hzRowFn(a[2], cx) + ' AS ' + hzQ(hzStr(a[1])) + ' FROM ' + hzFrom(a[0], cx),
  'Table.TransformColumns': (a, cx) => {
    if (a[2] && hzConst(a[2]) !== null) hzNo('преобразование «для остальных столбцов»'); if (a[3]) cx.risk('missing');
    let ops = a[1].k === 'list' && a[1].items.length && hzConst(a[1].items[0]) !== undefined ? [a[1]] : a[1].k === 'list' ? a[1].items : hzNo('список преобразований задан выражением');
    return 'SELECT * REPLACE (' + ops.map(o => { if (o.k !== 'list' || o.items.length < 2) hzNo('преобразование задано выражением'); const c = hzStr(o.items[0]); return hzApply(o.items[1], 't.' + hzQ(c), cx) + ' AS ' + hzQ(c); }).join(', ') + ') FROM ' + hzFrom(a[0], cx);
  },
  'Table.TransformColumnTypes': (a, cx) => {
    const cu = hzCulture(a[2]); let ops = a[1].k === 'list' && a[1].items.length === 2 && hzConst(a[1].items[0]) !== undefined ? [a[1]] : a[1].k === 'list' ? a[1].items : hzNo('список типов задан выражением');
    return 'SELECT * REPLACE (' + ops.map(o => { const c = hzStr(o.items[0]); return hzConv('t.' + hzQ(c), hzTypeOf(o.items[1]), cu, cx) + ' AS ' + hzQ(c); }).join(', ') + ') FROM ' + hzFrom(a[0], cx);
  },
  'Table.RenameColumns': (a, cx) => {
    if (a[2]) cx.risk('missing'); const ops = a[1].k === 'list' && a[1].items.length === 2 && hzConst(a[1].items[0]) !== undefined ? [a[1]] : a[1].k === 'list' ? a[1].items : hzNo('список переименований задан выражением');
    return 'SELECT * RENAME (' + ops.map(o => { if (o.k !== 'list') hzNo('переименование задано выражением'); return hzQ(hzStr(o.items[0])) + ' AS ' + hzQ(hzStr(o.items[1])); }).join(', ') + ') FROM ' + hzFrom(a[0], cx);
  },
  'Table.RemoveColumns': (a, cx) => { if (a[2]) cx.risk('missing'); const cs = hzStrList(a[1]).filter(c => !cx.st.ghost.has(c)); return 'SELECT *' + (cs.length ? ' EXCLUDE (' + hzCols(cs) + ')' : '') + ' FROM ' + hzFrom(a[0], cx); },
  'Table.SelectColumns': (a, cx) => { if (a[2]) cx.risk('missing'); const cs = hzStrList(a[1]); cs.forEach(c => cx.ghostCheck(c)); return 'SELECT ' + hzCols(cs) + ', ' + HZ_R + ' FROM ' + hzFrom(a[0], cx); },
  'Table.ReorderColumns': (a, cx) => { const cs = hzStrList(a[1]); cs.forEach(c => cx.ghostCheck(c)); return 'SELECT ' + hzCols(cs) + ', * EXCLUDE (' + hzCols(cs) + ') FROM ' + hzFrom(a[0], cx); },
  'Table.DuplicateColumn': (a, cx) => 'SELECT t.*, t.' + hzQ(hzStr(a[1])) + ' AS ' + hzQ(hzStr(a[2])) + ' FROM ' + hzFrom(a[0], cx),
  'Table.Distinct': (a, cx) => {
    if (!a[1] || hzConst(a[1]) === null) return 'SELECT * EXCLUDE (' + HZ_R + '), min(' + HZ_R + ') AS ' + HZ_R + ' FROM ' + hzFrom(a[0], cx) + ' GROUP BY ALL';
    const cs = hzStrList(a[1]); return 'SELECT t.* FROM ' + hzFrom(a[0], cx) + ' QUALIFY row_number() OVER (PARTITION BY ' + cs.map(c => 't.' + hzQ(c)).join(', ') + ' ORDER BY t.' + HZ_R + ') = 1';
  },
  'Table.Sort': (a, cx) => { const it = hzSortItems(a[1], cx); return 'SELECT * REPLACE (row_number() OVER (ORDER BY ' + it.map(x => x.e + (x.desc ? ' DESC NULLS LAST' : ' ASC NULLS FIRST')).join(', ') + ', t.' + HZ_R + ') AS ' + HZ_R + ') FROM ' + hzFrom(a[0], cx); },
  'Table.FirstN': (a, cx) => hzRowCut('%RN% <= ' + hzCnt(a[1], cx, 1)).replace('%FROM%', hzFrom(a[0], cx)),
  'Table.Skip': (a, cx) => hzRowCut('%RN% > ' + hzCnt(a[1], cx, 1)).replace('%FROM%', hzFrom(a[0], cx)),
  'Table.LastN': (a, cx) => hzRowCut('%RN% <= ' + hzCnt(a[1], cx, 1), true).replace('%FROM%', hzFrom(a[0], cx)),
  'Table.RemoveLastN': (a, cx) => hzRowCut('%RN% > ' + hzCnt(a[1], cx, 1), true).replace('%FROM%', hzFrom(a[0], cx)),
  'Table.Range': (a, cx) => { const o = hzCnt(a[1], cx, 0); return hzRowCut('%RN% > ' + o + (a[2] ? ' AND %RN% <= ' + o + ' + ' + hzCnt(a[2], cx, 0) : '')).replace(/%RN%/g, 'row_number() OVER (ORDER BY t.' + HZ_R + ')').replace('%FROM%', hzFrom(a[0], cx)); },
  'Table.ReverseRows': (a, cx) => 'SELECT * REPLACE (-' + HZ_R + ' AS ' + HZ_R + ') FROM ' + hzFrom(a[0], cx),
  'Table.AddIndexColumn': (a, cx) => { const s = hzCnt(a[2], cx, 0), i = hzCnt(a[3], cx, 1); return 'SELECT t.*, (row_number() OVER (ORDER BY t.' + HZ_R + ') - 1) * ' + i + ' + ' + s + ' AS ' + hzQ(hzStr(a[1])) + ' FROM ' + hzFrom(a[0], cx); },
  'Table.FillDown': (a, cx) => 'SELECT * REPLACE (' + hzStrList(a[1]).map(c => 'last_value(t.' + hzQ(c) + ' IGNORE NULLS) OVER (ORDER BY t.' + HZ_R + ' ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ' + hzQ(c)).join(', ') + ') FROM ' + hzFrom(a[0], cx),
  'Table.FillUp': (a, cx) => 'SELECT * REPLACE (' + hzStrList(a[1]).map(c => 'first_value(t.' + hzQ(c) + ' IGNORE NULLS) OVER (ORDER BY t.' + HZ_R + ' ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS ' + hzQ(c)).join(', ') + ') FROM ' + hzFrom(a[0], cx),
  'Table.ReplaceValue': (a, cx) => {
    const v = n => n.k === 'fn' ? hzRowFn(n, cx) : hzExpr(n, Object.assign({}, cx, { row: false }));
    const old = v(a[1]), nw = v(a[2]); const r = a[3] && a[3].k === 'id' ? a[3].n : hzNo('способ замены задан выражением');
    if (r !== 'Replacer.ReplaceValue' && r !== 'Replacer.ReplaceText') hzNo('способ замены ' + r);
    return 'SELECT * REPLACE (' + hzStrList(a[4]).map(c => { const x = 't.' + hzQ(c); return (r === 'Replacer.ReplaceText' ? 'replace(' + x + ', ' + old + ', ' + nw + ')' : 'CASE WHEN ' + x + ' IS NOT DISTINCT FROM ' + old + ' THEN ' + nw + ' ELSE ' + x + ' END') + ' AS ' + hzQ(c); }).join(', ') + ') FROM ' + hzFrom(a[0], cx);
  },
  'Table.ReplaceErrorValues': (a, cx) => { cx.risk('errors'); const ops = a[1].k === 'list' && a[1].items.length === 2 && typeof hzConst(a[1].items[0]) === 'string' ? [a[1]] : a[1].k === 'list' ? a[1].items : hzNo('список замен задан выражением'); return 'SELECT * REPLACE (' + ops.map(o => { const c = hzStr(o.items[0]); return 'COALESCE(t.' + hzQ(c) + ', ' + hzExpr(o.items[1], cx) + ') AS ' + hzQ(c); }).join(', ') + ') FROM ' + hzFrom(a[0], cx); },
  'Table.RemoveRowsWithErrors': (a, cx) => { cx.risk('errors'); return 'SELECT * FROM ' + hzFrom(a[0], cx); },
  'Table.Buffer': (a, cx) => 'SELECT * FROM ' + hzFrom(a[0], cx), 'Table.StopFolding': (a, cx) => 'SELECT * FROM ' + hzFrom(a[0], cx),
  'Table.Group': (a, cx) => {
    if (a[3] && hzEnum(a[3], 1) !== 1) hzNo('группировка GroupKind.Local (соседние строки)'); if (a[4]) hzNo('группировка со своим сравнением ключей');
    const ks = a[1].k === 'list' && !a[1].items.length ? [] : hzStrList(a[1], 'ключи группировки');
    const specs = a[2].k === 'list' && a[2].items.length && typeof hzConst(a[2].items[0]) === 'string' ? [a[2]] : a[2].k === 'list' ? a[2].items : hzNo('агрегаты заданы выражением');
    const aggs = specs.map(s => { if (s.k !== 'list' || s.items.length < 2) hzNo('агрегат задан выражением'); const name = hzStr(s.items[0]); const f = s.items[1];
      let e; if (f.k === 'fn'){ if (f.params.length !== 1) hzNo('агрегат с несколькими параметрами'); e = hzExpr(f.body, Object.assign({}, cx, { group: true, row: false, rowVar: f.params[0].name, cellVar: null })); }
      else if (f.k === 'id' && f.n === 'Table.RowCount') e = 'count(*)'; else hzNo('агрегат «' + (f.n || f.k) + '»');
      return e + ' AS ' + hzQ(name); });
    return 'SELECT ' + ks.map(k => 't.' + hzQ(k) + ' AS ' + hzQ(k)).concat(aggs, [(ks.length ? 'min(t.' + HZ_R + ')' : '1') + ' AS ' + HZ_R]).join(', ') + ' FROM ' + hzFrom(a[0], cx) + (ks.length ? ' GROUP BY ' + ks.map(k => 't.' + hzQ(k)).join(', ') : '');
  },
  'Table.NestedJoin': (a, cx, name) => {
    if (a[6]) hzNo('слияние с нечётким или своим сравнением ключей');
    const J = { l: cx.st.tref(a[0]), r: cx.st.tref(a[2]), lk: hzStrList(a[1], 'ключи'), rk: hzStrList(a[3], 'ключи'), col: hzStr(a[4], 'имя нового столбца'), kind: hzJoinKind(a[5]) };
    hzOn(J.lk, J.rk); cx.st.nested.set(name, J); cx.st.ghost.add(J.col);
    const cons = cx.st.consumers(name);
    if (cons.length && cons.every(c => c.k === 'call' && c.f.k === 'id' && ['Table.ExpandTableColumn', 'Table.AggregateTableColumn'].includes(c.f.n) && c.args[0].k === 'id' && c.args[0].n === name)) return null;   // слито со следующим шагом
    if (J.kind === 1) return 'SELECT * FROM ' + J.l;
    if (J.kind === 0 || J.kind === 4) return 'SELECT l.* FROM ' + J.l + ' AS l WHERE ' + (J.kind === 4 ? 'NOT ' : '') + 'EXISTS (SELECT 1 FROM ' + J.r + ' AS r WHERE ' + hzOn(J.lk, J.rk) + ')';
    return hzNo('правое или полное слияние без развёртывания');
  },
  'Table.ExpandTableColumn': (a, cx) => {
    const J = a[0].k === 'id' && cx.st.nested.get(a[0].n); if (!J || hzStr(a[1]) !== J.col) hzNo('развёртывание столбца, полученного не слиянием');
    const names = hzStrList(a[2]), nn = a[3] && hzConst(a[3]) !== null ? hzStrList(a[3]) : names; if (nn.length !== names.length) hzNo('разное число столбцов и новых имён');
    if (J.kind === 5) hzNo('слияние «только справа» (RightAnti)');
    const cols = names.map((c, i) => (J.kind === 4 ? 'NULL' : 'r.' + hzQ(c)) + ' AS ' + hzQ(nn[i]));
    return 'SELECT l.* EXCLUDE (' + HZ_R + ')' + (cols.length ? ', ' + cols.join(', ') : '') + ', row_number() OVER (ORDER BY l.' + HZ_R + ' NULLS LAST' + (J.kind === 4 ? '' : ', r.' + HZ_R) + ') AS ' + HZ_R + ' FROM ' + J.l + ' AS l ' + HZ_JOIN[J.kind] + ' ' + J.r + ' AS r ON ' + hzOn(J.lk, J.rk);
  },
  'Table.AggregateTableColumn': (a, cx) => {
    const J = a[0].k === 'id' && cx.st.nested.get(a[0].n); if (!J || hzStr(a[1]) !== J.col) hzNo('агрегирование столбца, полученного не слиянием');
    if (![0, 1].includes(J.kind)) hzNo('агрегирование при правом/полном/анти-слиянии');
    const specs = a[2].k === 'list' && a[2].items.length === 3 && typeof hzConst(a[2].items[0]) === 'string' ? [a[2]] : a[2].k === 'list' ? a[2].items : hzNo('агрегаты заданы выражением');
    const AG = { 'List.Sum': 'sum', 'List.Min': 'min', 'List.Max': 'max', 'List.Average': 'avg', 'List.Count': 'count', 'List.NonNullCount': 'count' };
    const parts = specs.map(s => { const c = hzStr(s.items[0]), f = s.items[1], nm = hzStr(s.items[2]); if (f.k !== 'id' || !AG[f.n]) hzNo('агрегат ' + (f.n || 'выражением')); return { sql: (f.n === 'List.Count' ? 'count(*)' : AG[f.n] + '(r.' + hzQ(c) + ')') + ' AS ' + hzQ(nm), nm, cnt: AG[f.n] === 'count' }; });
    const on = J.lk.map((k, i) => 'l.' + hzQ(k) + ' IS NOT DISTINCT FROM g.' + hzQ('__k' + i)).join(' AND ');
    return 'SELECT l.*, ' + parts.map(p => (p.cnt ? 'COALESCE(g.' + hzQ(p.nm) + ', 0)' : 'g.' + hzQ(p.nm)) + ' AS ' + hzQ(p.nm)).join(', ') + ' FROM ' + J.l + ' AS l ' + (J.kind === 0 ? 'JOIN' : 'LEFT JOIN') + ' (SELECT ' + J.rk.map((k, i) => 'r.' + hzQ(k) + ' AS ' + hzQ('__k' + i)).join(', ') + ', ' + parts.map(p => p.sql).join(', ') + ' FROM ' + J.r + ' AS r GROUP BY ALL) AS g ON ' + on;
  },
  'Table.Join': (a, cx) => {
    const k = hzJoinKind(a[4]); if (k > 3) hzNo('анти-соединение Table.Join'); if (a[5] || a[6]) hzNo('Table.Join с алгоритмом или сравнением ключей');
    return 'SELECT l.* EXCLUDE (' + HZ_R + '), r.* EXCLUDE (' + HZ_R + '), row_number() OVER (ORDER BY l.' + HZ_R + ' NULLS LAST, r.' + HZ_R + ') AS ' + HZ_R + ' FROM ' + cx.st.tref(a[0]) + ' AS l ' + HZ_JOIN[k] + ' ' + cx.st.tref(a[2]) + ' AS r ON ' + hzOn(hzStrList(a[1], 'ключи'), hzStrList(a[3], 'ключи'));
  },
  'Table.Combine': (a, cx) => {
    if (a[0].k !== 'list') hzNo('список таблиц задан выражением (например, файлы папки)'); if (a[1]) hzNo('Table.Combine со списком столбцов');
    return 'SELECT * EXCLUDE (__s, ' + HZ_R + '), row_number() OVER (ORDER BY __s, ' + HZ_R + ') AS ' + HZ_R + ' FROM (' + a[0].items.map((x, i) => 'SELECT *, ' + (i + 1) + ' AS __s FROM ' + cx.st.tref(x)).join(' UNION ALL BY NAME ') + ')';
  },
  'Table.UnpivotOtherColumns': (a, cx) => { cx.risk('unpivot'); const keep = hzStrList(a[1]); return hzUnpivot(cx.st.tref(a[0]), 'COLUMNS(* EXCLUDE (' + hzCols(keep.concat(['__r0'])) + '))', hzStr(a[2]), hzStr(a[3])); },
  'Table.Unpivot': (a, cx) => { cx.risk('unpivot'); return hzUnpivot(cx.st.tref(a[0]), hzCols(hzStrList(a[1])), hzStr(a[2]), hzStr(a[3])); },
  'Table.Pivot': (a, cx) => {
    const an = hzStr(a[2]), vn = hzStr(a[3]); const AG = { 'List.Sum': 'sum', 'List.Count': 'count', 'List.Min': 'min', 'List.Max': 'max', 'List.Average': 'avg', 'List.NonNullCount': 'count' };
    let ag = 'first'; if (a[4] && hzConst(a[4]) !== null){ if (a[4].k !== 'id' || !AG[a[4].n]) hzNo('агрегат сведения ' + (a[4].n || 'выражением')); ag = AG[a[4].n]; } else cx.risk('pivot-first');
    let vals = ''; const v = a[1]; if (v.k === 'list') vals = ' IN (' + v.items.map(x => hzS(String(hzConst(x)))).join(', ') + ')'; else if (!(v.k === 'call' && v.f.n === 'List.Distinct')) cx.risk('pivot-vals');
    cx.risk('order');
    return 'SELECT *, row_number() OVER () AS ' + HZ_R + ' FROM (PIVOT (SELECT * EXCLUDE (' + HZ_R + ') FROM ' + cx.st.tref(a[0]) + ') ON ' + hzQ(an) + vals + ' USING ' + ag + '(' + hzQ(vn) + '))';
  },
  'Table.SplitColumn': (a, cx) => {
    const c = hzStr(a[1]); const sp = a[2]; if (!(sp.k === 'call' && sp.f.k === 'id' && sp.f.n === 'Splitter.SplitTextByDelimiter')) hzNo('разделение не по разделителю (по позициям, длинам, регистру…)');
    const sep = hzStr(sp.args[0], 'разделитель'); if (sp.args[1]) cx.risk('split-quote');
    const n = a[3]; const names = n && typeof hzConst(n) === 'number' ? Array.from({ length: hzConst(n) }, (_, i) => c + '.' + (i + 1)) : n ? hzStrList(n) : hzNo('разделение без списка новых столбцов');
    if (a[4] || a[5]) hzNo('разделение с параметрами по умолчанию / лишними значениями');
    const x = 't.' + hzQ(c); const parts = 'string_split(' + x + ', ' + hzS(sep) + ')';
    return 'SELECT t.* EXCLUDE (' + hzQ(c) + '), ' + names.map((nm, i) => 'CASE WHEN len(' + parts + ') >= ' + (i + 1) + ' THEN ' + parts + '[' + (i + 1) + '] END AS ' + hzQ(nm)).join(', ') + ' FROM ' + hzFrom(a[0], cx);
  }
};
HZ_T['Table.RemoveFirstN'] = HZ_T['Table.Skip'];
function hzUnpivot(src, on, an, vn){
  return 'SELECT * EXCLUDE (__r0), row_number() OVER (ORDER BY __r0) AS ' + HZ_R + ' FROM (UNPIVOT (SELECT * RENAME (' + HZ_R + ' AS __r0) FROM ' + src + ') ON ' + on + ' INTO NAME ' + hzQ(an) + ' VALUE ' + hzQ(vn) + ')';
}
const HZ_RISKS = {
  text: 'Число → текст: дробная часть пишется через точку («1.5»), а Power Query в русской культуре пишет «1,5». Если текст потом сравнивается или выводится — сверьте.',
  now: 'Текущая дата и время: результат зависит от момента запуска — при сверке может отличаться.',
  lookup: 'Поиск Т{[Ключ = …]}[Поле]: если ключ не найден или найдено несколько строк, в Power Query ячейка получает ошибку, в DuckDB — пусто (тихо). Поэтому проверьте дубли ключей справочника — «Проверка на данных» их показывает.',
  'lookup-opt': 'Поиск с «?»: ключ не найден — пусто, как в Power Query.',
  try: 'try … otherwise: в DuckDB нет ошибок в ячейках — значение по умолчанию подставится и вместо пустого.',
  errors: 'Ошибки в ячейках: в DuckDB неудачное преобразование даёт пусто, поэтому «Удалить/Заменить ошибки» действуют на пустые значения.',
  'distinct-null': 'Подсчёт различных значений: Power Query считает пустое отдельным значением, DuckDB — нет.',
  unpivot: 'Отмена свёртки: столбцы разных типов DuckDB приводит к общему типу (обычно к тексту); пустые значения пропускаются, как в Power Query.',
  'pivot-first': 'Сведение без агрегата: при нескольких значениях Power Query выдаёт ошибку, DuckDB берёт первое.',
  'pivot-vals': 'Сведение по списку, заданному выражением: DuckDB берёт все значения атрибута.',
  order: 'Порядок строк может отличаться — на итоги и суммы не влияет.',
  missing: 'Пропуск отсутствующих столбцов (MissingField): если столбца нет, DuckDB остановится с ошибкой — проверьте имена.',
  'split-quote': 'Разделение с учётом кавычек: DuckDB режет по разделителю и внутри кавычек.',
  'no-names': 'Файл без заголовков: имена столбцов Column1, Column2… задайте в комплекте, если их нет в данных проверки.'
};

/* ---------- Источники ---------- */
const HZ_ENC = { 1251: 'windows-1251', 866: 'cp866', 20866: 'koi8-r', 21866: 'koi8-u', 28595: 'iso-8859-5', 65001: 'utf-8', 1200: 'utf-16' };
/** Шаг-источник → описание чтения: { kind, stage: 'bin'|'nav'|'table', … } или null — это не источник */
function hzSource(n, st){
  if (n.k === 'id' && st.readers.has(n.n)) return st.readers.get(n.n);
  if (n.k === 'call' && n.f.k === 'id'){
    const fn = n.f.n, a = n.args;
    if (fn === 'Table.Buffer' && a.length === 1){ const b = hzSource(a[0], st); return b && b.stage === 'table' ? b : null; }
    if (fn === 'Excel.CurrentWorkbook') return { kind: 'wb', stage: 'nav' };
    if (fn === 'File.Contents') return { kind: 'file', path: String(st.val(a[0])), stage: 'bin' };
    if (fn === 'Csv.Document'){
      const b = hzSource(a[0], st); if (!b || b.kind !== 'file') return { kind: 'other', fn, stage: 'table', loader: true, note: 'CSV не из файла' };
      let o = a[1] ? st.val(a[1]) : null; let delim = a[2] ? st.val(a[2]) : null, enc = a[4] ? st.val(a[4]) : null, cols = null;
      if (o instanceof MRec){ const g = k => o.has(k) ? o.get(k) : null; delim = g('Delimiter'); enc = g('Encoding'); cols = g('Columns'); } else cols = o;
      return { kind: 'csv', path: b.path, delim: typeof delim === 'string' && delim ? delim : ',', enc: enc == null ? 65001 : enc, ncols: typeof cols === 'number' ? cols : Array.isArray(cols) ? cols.length : null, names: Array.isArray(cols) ? cols.map(String) : null, header: false, skip: 0, stage: 'table' };
    }
    if (fn === 'Excel.Workbook'){ const b = hzSource(a[0], st); if (!b || b.kind !== 'file') return null; return { kind: 'xlsx', path: b.path, headers: a[2] ? st.val(a[2]) === true : false, stage: 'nav' }; }
    if (fn === 'Folder.Files' || fn === 'Folder.Contents') return { kind: 'folder', path: String(st.val(a[0])), stage: 'table', loader: true };
    if (fn === 'OData.Feed') return { kind: 'odata', url: String(st.val(a[0])), stage: 'nav', loader: true };
    if (fn === 'Sql.Database'){ const o = a[2] ? st.val(a[2]) : null; const qy = o instanceof MRec && o.has('Query') ? o.get('Query') : null; return { kind: 'sqldb', server: String(st.val(a[0])), db: String(st.val(a[1])), query: qy, stage: qy ? 'table' : 'nav', loader: true }; }
    if (fn === 'Value.NativeQuery'){ const b = hzSource(a[0], st); return { kind: 'sqldb', server: b && b.server, db: b && b.db, query: String(st.val(a[1])), stage: 'table', loader: true }; }
    if (fn === 'Table.PromoteHeaders'){ const b = hzSource(a[0], st); return b && b.stage === 'table' && (b.kind === 'csv' || b.kind === 'xlsx') && !b.header ? Object.assign({}, b, { header: true }) : null; }
    if ((fn === 'Table.Skip' || fn === 'Table.RemoveFirstN')){ const b = hzSource(a[0], st); const k = a[1] ? hzConst(a[1]) : 1; return b && b.kind === 'csv' && !b.header && typeof k === 'number' ? Object.assign({}, b, { skip: b.skip + k }) : null; }
    if (EXTERNAL_SOURCES.has(fn) || fn === 'Json.Document' || fn === 'Xml.Tables' || fn === 'Web.Page') return { kind: 'other', fn, stage: 'table', loader: true };
    return null;
  }
  if (n.k === 'field' && n.e.k === 'item' && n.e.ix.k === 'rec'){
    const b = hzSource(n.e.e, st); if (!b || b.stage !== 'nav') return null;
    const f = {}; for (const [k, v] of n.e.ix.fields) f[k] = st.val(v);
    if (b.kind === 'wb') return { kind: 'wb', table: String(f.Name), stage: 'table' };
    if (b.kind === 'xlsx') return { kind: 'xlsx', path: b.path, sheet: String(f.Item || f.Name), objKind: f.Kind || 'Sheet', header: b.headers, stage: 'table' };
    if (b.kind === 'odata') return { kind: 'odata', url: b.url, entity: String(f.Name), stage: 'table', loader: true };
    if (b.kind === 'sqldb') return Object.assign({}, b, { schema: f.Schema || 'dbo', table: String(f.Item || f.Name), stage: 'table' });
  }
  return null;
}
const HZ_TABLE_NOT = new Set(['Table.RowCount', 'Table.ColumnCount', 'Table.ColumnNames', 'Table.Column', 'Table.ToList', 'Table.ToRows', 'Table.ToRecords', 'Table.IsEmpty', 'Table.First', 'Table.Last', 'Table.Max', 'Table.Min', 'Table.Contains', 'Table.PositionOf', 'Table.Schema', 'Table.Profile', 'Table.MatchesAnyRows', 'Table.MatchesAllRows']);
/** Шаг — не таблица (список, число, текст, дата): подставляется в выражения других шагов */
function hzIsHelper(n){
  if (n.k === 'const' || n.k === 'list' || n.k === 'neg') return true;
  if (n.k === 'field' && n.e.k === 'id') return true;   // Запрос[Столбец]
  if (n.k === 'bin' && n.o !== 'meta') return true;
  if (n.k === 'call' && n.f.k === 'id'){ const f = n.f.n; return /^(List|Text|Number|Date|DateTime|Duration|Logical|Int64|Value)\./.test(f) || HZ_TABLE_NOT.has(f); }
  return false;
}
const hzIsTableCall = n => (n.k === 'call' && n.f.k === 'id' && /^Table\./.test(n.f.n) && !HZ_TABLE_NOT.has(n.f.n)) || (n.k === 'const' && false);
function hzIds(n, acc){ if (!n || typeof n !== 'object') return acc; if (Array.isArray(n)){ n.forEach(x => hzIds(x, acc)); return acc; } if (n.k === 'id') acc.add(n.n); for (const k in n) if (k !== 'k' && n[k] && typeof n[k] === 'object') hzIds(n[k], acc); return acc; }
function hzHash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/* ---------- План переноса книги ---------- */
const HZ_KIND = { sql: 'перенесён', source: 'источник', loader: 'загрузчик', helper: 'значение', manual: 'вручную', claude: 'перевод Claude' };
/** Порядок: сначала запросы, на которые ссылаются другие */
function hzOrder(members){
  const by = new Map(members.map(m => [m.name, m])); const out = [], seen = new Set();
  const visit = (m, stack) => { if (seen.has(m.name) || stack.has(m.name)) return; stack.add(m.name); for (const r of m.refs) if (by.has(r)) visit(by.get(r), stack); seen.add(m.name); out.push(m); };
  for (const m of members) visit(m, new Set());
  return out;
}
/** Имя CTE шага: как в «Примененных шагах»; совпадает с именем запроса — с пометкой «(шаг)» */
const hzCte = (step, names) => names.has(step) ? step + ' (шаг)' : step;
const hzMatName = (q, step) => q + ' · ' + step;
/** opts: { over: Map(«запрос\u0001шаг» → { sql, hash }) — ручные переводы шагов } */
function hzPlan(A, opts){
  opts = opts || {};
  const plan = { queries: [], byName: new Map(), params: new Map(), over: opts.over || new Map(), text: A.text };
  const env = sectionEnv(A.text);
  for (const m of A.members) if (m.isParam){ try { let ast = mParse(A.text.slice(m.exprStart, m.exprEnd)); const v = deepForce(evalNode(ast, env)); if (v === null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof MDate) plan.params.set(m.name, v); } catch { /* параметр-выражение — вручную */ } }
  const qnames = new Set(A.members.map(m => m.name));
  for (const m of hzOrder(A.members)){ const q = hzQueryPlan(A, m, plan, env, qnames); plan.queries.push(q); plan.byName.set(q.name, q); }
  plan.dims = new Set(plan.queries.flatMap(q => [...(q.rightRefs || [])]));   // справочники: правая сторона слияний и поиска
  const all = plan.queries.flatMap(q => q.steps.filter(s => s.kind !== 'helper'));
  const c = k => all.filter(s => s.kind === k).length;
  plan.stats = { steps: all.length, sql: c('sql') + c('claude'), source: c('source'), loader: c('loader'), manual: c('manual'), queries: plan.queries.filter(q => q.kind === 'table').length };
  plan.stats.pct = all.length ? Math.round((plan.stats.sql + plan.stats.source) / all.length * 100) : 0;
  plan.stats.pctWithLoaders = all.length ? Math.round((plan.stats.sql + plan.stats.source + plan.stats.loader) / all.length * 100) : 0;
  return plan;
}
function hzQueryPlan(A, m, plan, env, qnames){
  const q = { name: m.name, kind: 'table', rightRefs: new Set(), steps: [], deps: new Set(), load: m.load, out: !m.usedBy.length || !!(m.load && (m.load.sheet || m.load.model)), boundary: -1, mat: [], final: null, status: '', reason: '', risks: new Set(), kitReady: false };
  if (m.isFn){ q.kind = 'fn'; q.status = 'manual'; q.reason = 'функция — вызывается из других запросов; такие вызовы переносятся вручную'; return q; }
  if (m.isParam){ q.kind = 'param'; q.status = plan.params.has(m.name) ? 'param' : 'manual'; q.reason = plan.params.has(m.name) ? 'параметр — подставляется в SQL значением' : 'параметр-выражение'; return q; }
  let ast; try { ast = mParse(A.text.slice(m.exprStart, m.exprEnd)); } catch (e){ q.status = 'manual'; q.reason = 'код не разбирается: ' + e.message; return q; }
  if (ast.k === 'bin' && ast.o === 'meta') ast = ast.l;
  let binds = ast.k === 'let' ? ast.binds.slice() : [[m.name, ast]];
  let fin = ast.k !== 'let' ? m.name : ast.body.k === 'id' && binds.some(b => b[0] === ast.body.n) ? ast.body.n : null;
  if (!fin){ binds.push(['(результат)', ast.body]); fin = '(результат)'; }
  const stepNames = new Set(binds.map(b => b[0]));
  const deadSteps = new Set((m.steps ? m.steps.steps : []).filter(x => x.dead).map(x => x.name));
  const vars = new Map(); const e2 = new Env(vars, env); for (const [nm, ex] of binds) vars.set(nm, new Thunk(() => evalNode(ex, e2)));
  const st = {
    q, plan, helpers: new Map(), inHelper: new Set(), readers: new Map(), tables: new Set(), nested: new Map(), ghost: new Set(), alias: 0, refs: null,
    val(node){ try { return deepForce(evalNode(node, e2)); } catch (e){ return hzNo('значение не вычисляется (' + (e.message || e) + ')'); } },
    tref(node){
      if (node.k === 'call' && node.f.k === 'id' && ['Table.Buffer', 'Table.StopFolding'].includes(node.f.n) && node.args.length === 1) return st.tref(node.args[0]);
      if (node.k === 'id'){
        if (stepNames.has(node.n)){ if (!st.tables.has(node.n)) hzNo('шаг «' + node.n + '» — не таблица'); st.refs.add(node.n); return hzQ(hzCte(node.n, qnames)); }
        const dm = A.byName.get(node.n); if (dm && !dm.isFn && !dm.isParam && dm.name !== m.name){ q.deps.add(node.n); return hzQ(node.n); }
      }
      // вложенный вызов: Table.Distinct(Table.SelectColumns(…)) — подзапрос
      if (node.k === 'call' && node.f.k === 'id' && HZ_T[node.f.n] && !['Table.NestedJoin', 'Table.ExpandTableColumn', 'Table.AggregateTableColumn'].includes(node.f.n)) return '(' + HZ_T[node.f.n](node.args, st.cx, null) + ')';
      return hzNo('таблица задана выражением');
    },
    consumers(name){ return binds.filter(([nm, ex]) => nm !== name && hzIds(ex, new Set()).has(name)).map(b => b[1]); }
  };
  // кто справочник: правая таблица NestedJoin/Join, таблица поиска Т{[…]}, список List.Contains — через шаги-буферы до запроса
  const bnode = new Map(binds);
  const resolve = (n, depth) => { if (!n || depth > 8) return; if (n.k === 'id'){ if (bnode.has(n.n)) return resolve(bnode.get(n.n), depth + 1); if (A.byName.has(n.n)) q.rightRefs.add(n.n); return; }
    if (n.k === 'call' && n.f.k === 'id' && /^(Table|List)\.(Buffer|Distinct|StopFolding)$/.test(n.f.n)) return resolve(n.args[0], depth + 1); if (n.k === 'field') return resolve(n.e, depth + 1); };
  const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk);
    if (n.k === 'call' && n.f.k === 'id'){ if (['Table.NestedJoin', 'Table.Join'].includes(n.f.n)) resolve(n.args[2], 0); if (n.f.n === 'List.Contains') resolve(n.args[0], 0); }
    if (n.k === 'item' && n.ix && n.ix.k === 'rec') resolve(n.e, 0);
    for (const k in n) if (k !== 'k' && n[k] && typeof n[k] === 'object') walk(n[k]); };
  binds.forEach(([, node]) => walk(node));
  binds.forEach(([name, node], idx) => {
    const fn = node.k === 'call' && node.f.k === 'id' ? node.f.n : node.k === 'field' && node.e.k === 'item' ? '(навигация)' : node.k === 'id' ? '(ссылка)' : null;
    const s = { name, cte: hzCte(name, qnames), fn, op: HZ_OPS.get(fn) || null, kind: '', sql: null, reason: '', risks: [], refs: new Set(), hash: hzHash(JSON.stringify(node)), idx };
    const risks = new Set(); st.refs = s.refs;
    const cx = st.cx = { st, row: false, group: false, rowVar: '_', cellVar: null, risk: k => risks.add(k), col: c => { if (st.ghost.has(c)) hzNo('вложенная таблица «' + c + '» используется не только для развёртывания'); return 't.' + hzQ(c); } };
    cx.ghostCheck = c => { if (st.ghost.has(c)) hzNo('вложенная таблица «' + c + '» в списке столбцов'); };
    const ov = plan.over.get(m.name + '\u0001' + name);
    try {
      if (ov && ov.hash === s.hash){ s.kind = 'claude'; s.sql = ov.sql; for (const r of stepNames) if (r !== name && new RegExp('"' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(ov.sql)) s.refs.add(r); st.tables.add(name); }
      else {
        const r = hzSource(node, st);
        if (r){ st.readers.set(name, r); if (r.stage === 'table') st.tables.add(name); s.kind = r.loader ? 'loader' : 'source'; s.reader = r; if (r.kind === 'csv' && !r.header && !r.names) risks.add('no-names'); s.op = HZ_OPS.get(({ wb: 'Excel.CurrentWorkbook', csv: 'Csv.Document', xlsx: 'Excel.Workbook', folder: 'Folder.Files', odata: 'OData.Feed', sqldb: 'Sql.Database' })[r.kind]) || s.op; }
        else if (hzIsHelper(node)){ st.helpers.set(name, node); s.kind = 'helper'; }
        else if (node.k === 'id'){ s.sql = 'SELECT * FROM ' + hzFrom(node, cx); s.kind = 'sql'; st.tables.add(name); }
        else {
          if (!fn || !HZ_T[fn]) hzNo(fn ? (HZ_OPS.has(fn) ? fn + ' в таком виде' : 'функция ' + fn + ' не переводится') : 'выражение не переводится');
          s.sql = HZ_T[fn](node.args, cx, name); s.kind = 'sql'; if (s.sql === null) s.fused = true; st.tables.add(name);
        }
      }
    } catch (e){
      if (!(e instanceof HzNo) && !(e instanceof MErr)) console.error(e);
      s.kind = 'manual'; s.reason = e.message; s.sql = null;
      if (hzIsTableCall(node) || node.k === 'field' || node.k === 'item' || (node.k === 'call' && !hzIsHelper(node))) st.tables.add(name);
    }
    s.risks = [...risks]; risks.forEach(k => q.risks.add(k));
    s.dead = deadSteps.has(name) && name !== fin;   // шаг, на который никто не ссылается, — не переводится и не считается
    if (s.dead) s.kind = 'helper';
    q.steps.push(s);
  });
  // граница: последний шаг, который не переведён в SQL; всё до неё (что нужно дальше) — готовые таблицы
  const counted = q.steps.filter(s => s.kind !== 'helper');
  q.boundary = Math.max(-1, ...q.steps.filter(s => ['source', 'loader', 'manual'].includes(s.kind)).map(s => s.idx));
  const finStep = q.steps.find(s => s.name === fin);
  const need = new Set(); if (q.boundary >= 0 && (finStep.idx <= q.boundary || q.steps.slice(q.boundary + 1).some(s => s.kind === 'sql' || s.kind === 'claude'))) need.add(q.steps[q.boundary].name);
  for (const s of q.steps.slice(q.boundary + 1)) for (const r of s.refs){ const t = q.steps.find(x => x.name === r); if (t && t.idx <= q.boundary) need.add(r); }
  if (finStep.idx <= q.boundary) need.add(fin);
  q.mat = q.steps.filter(s => need.has(s.name)).map(s => s.name);
  q.final = fin;
  // перевод держится на шагах после границы; шаги до неё в браузере считает интерпретатор
  const after = q.steps.slice(q.boundary + 1).filter(s => s.kind !== 'helper');
  q.sqlSteps = after.length;
  q.status = counted.every(s => s.kind === 'sql' || s.kind === 'claude' || s.kind === 'source') ? 'auto' : counted.some(s => s.kind === 'manual') ? (after.length ? 'partial' : 'manual') : 'loader';
  q.kitReady = q.mat.every(n => { const s = q.steps.find(x => x.name === n); return s.reader && s.reader.stage === 'table'; }) && !q.steps.some(s => s.kind === 'manual' && s.idx > q.boundary);
  q.manualSteps = q.steps.filter(s => s.kind === 'manual');
  q.gain = hzGain(q);
  return q;
}
/** Ожидаемый выигрыш по операциям запроса (до замера) */
function hzGain(q){
  const fns = new Set(q.steps.map(s => s.fn)); const has = re => [...fns].some(f => f && re.test(f));
  if (q.risks.has('lookup') || q.risks.has('lookup-opt')) return { level: 3, text: '×100 и больше: поиск для каждой строки становится хеш-соединением' };
  if (has(/NestedJoin|Join|Group|Pivot|Unpivot|Distinct|Combine/)) return { level: 2, text: '×10–50: слияния, группировки и свёртки — сильная сторона DuckDB' };
  if (q.steps.some(s => s.kind === 'sql')) return { level: 1, text: '×3–10: фильтры, типы и столбцы' };
  return { level: 0, text: 'выигрыш даст только загрузка (источник)' };
}
/** Части SQL запроса: CTE на каждый шаг после границы (с комментарием «команда PQ → SQL») и готовые таблицы до неё */
function hzQueryParts(plan, q){
  const qn = new Set(plan.queries.map(x => x.name)); const ctes = [];
  for (const s of q.steps){
    if (q.mat.includes(s.name)){ ctes.push({ step: s.name, name: hzQ(hzCte(s.name, qn)), body: 'SELECT *, CAST(rowid + 1 AS DOUBLE) AS ' + HZ_R + ' FROM ' + hzQ(hzMatName(q.name, s.name)), comment: ['-- Шаг «' + s.name + '» — готовая таблица (' + (s.kind === 'manual' ? 'вручную: ' + s.reason : HZ_KIND[s.kind]) + '); __r — номер строки, хранит порядок Power Query'] }); continue; }
    if (s.idx <= q.boundary || s.kind === 'helper' || !s.sql){ if (s.fused) ctes.push({ step: s.name, fused: true, comment: ['-- Шаг «' + s.name + '» · ' + (s.op ? s.op.ui : s.fn) + ' — выполняется вместе со следующим шагом одним JOIN'] }); continue; }
    const c = ['-- Шаг «' + s.name + '»' + (s.kind === 'claude' ? ' · перевод вручную / Claude' : s.op ? ' · Power Query: ' + s.op.ui + ' → SQL: ' + s.op.sql : '')];
    for (const r of s.risks) c.push('--   ⚠ ' + HZ_RISKS[r]);
    ctes.push({ step: s.name, name: hzQ(s.cte), body: s.sql, comment: c });
  }
  return { ctes, final: hzQ(hzCte(q.final, qn)) };
}
/** WITH … для первых k CTE (k — до какого шага включительно) */
function hzWith(parts, upto){ const real = parts.ctes.filter(c => !c.fused); const cut = upto == null ? real : real.slice(0, upto + 1); return 'WITH ' + cut.map(c => c.name + ' AS (' + c.body + ')').join(', '); }
/** Текст SQL запроса. Один и тот же текст выполняется в браузере (на таблицах из интерпретатора)
    и в комплекте (на таблицах, прочитанных из файлов). */
function hzQuerySql(plan, q){
  if (q.kind !== 'table' || !q.final) return '';
  const P = hzQueryParts(plan, q); const L = [];
  L.push('-- ══ Запрос «' + q.name + '» ══  шагов: ' + q.steps.length + ', в SQL: ' + q.sqlSteps + (q.mat.length ? ', готовые таблицы: ' + q.mat.length : ''));
  if (q.mat.length) L.push('-- Таблицы «' + q.name + ' · …» — результат шагов до перевода: в браузере их считает Мастер, в комплекте — читает из источника.');
  L.push('CREATE OR REPLACE TABLE ' + hzQ(q.name) + ' AS', 'WITH');
  const real = P.ctes.filter(c => !c.fused); const last = real[real.length - 1];
  for (const c of P.ctes){ L.push(...c.comment.map(x => '  ' + x)); if (!c.fused) L.push('  ' + c.name + ' AS (' + c.body + ')' + (c === last ? '' : ',')); }
  L.push('SELECT * FROM ' + P.final + ';');
  return L.join('\n');
}
/* ---------- Сверка результатов Power Query (интерпретатор) и DuckDB ---------- */
/** Ключ значения для сверки: числа — до 10 значащих цифр (порядок сложения в SQL другой), дата и дата-время в полночь равны */
function hzKey(v){
  try { v = force(v); } catch { return 'n'; }   // ошибка ячейки Power Query = пусто в DuckDB (число таких ячеек — errA)
  if (v === null) return 'n'; const t = typeof v;
  if (t === 'number') return 'd' + (Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(10)); if (t === 'string') return 's' + v; if (t === 'boolean') return v ? 'T' : 'F';
  if (v instanceof MDate) return 'D' + v.ms; return 'x' + mToText(v);
}
/** a — результат Power Query, b — DuckDB. Столбцы по именам, строки как мультимножество; где именно расходится — по столбцам */
function hzCompare(a, b){
  const ca = a.cols.filter(c => c !== HZ_R), cb = b.cols.filter(c => c !== HZ_R);
  const r = { rowsA: a.rows.length, rowsB: b.rows.length, miss: ca.filter(c => !cb.includes(c)), extra: cb.filter(c => !ca.includes(c)), colsDiff: [], errA: 0, same: false, exact: false, lost: 0, added: 0 };
  const cols = ca.filter(c => cb.includes(c)); const ia = cols.map(c => a.cols.indexOf(c)), ib = cols.map(c => b.cols.indexOf(c));
  for (const row of a.rows) for (const i of ia){ try { force(row[i]); } catch { r.errA++; } }
  // столбец, который DuckDB хранит текстом (в Power Query там смешанные типы), сравнивается как текст
  const txt = ib.map(i => { let any = false; for (const row of b.rows){ const v = row[i]; if (v === null || v === undefined) continue; if (typeof v !== 'string') return false; any = true; } return any; });
  const keyA = (row, j) => { if (!txt[j]) return hzKey(row[ia[j]]); let v; try { v = force(row[ia[j]]); } catch { return 'n'; } return v === null ? 'n' : 's' + (typeof v === 'string' ? v : mToText(v)); };
  const kA = a.rows.map(row => ia.map((_, j) => keyA(row, j)).join('\u0001')), kB = b.rows.map(row => ib.map(i => hzKey(row[i])).join('\u0001'));
  const cnt = new Map(); for (const k of kA) cnt.set(k, (cnt.get(k) || 0) + 1);
  for (const k of kB){ const c = cnt.get(k); if (c) cnt.set(k, c - 1); else r.added++; }
  for (const c of cnt.values()) r.lost += c;
  cols.forEach((c, j) => { const m = new Map(); for (const row of a.rows){ const k = keyA(row, j); m.set(k, (m.get(k) || 0) + 1); } let d = 0; for (const row of b.rows){ const k = hzKey(row[ib[j]]); const x = m.get(k); if (x) m.set(k, x - 1); else d++; } if (d) r.colsDiff.push(c); });
  r.same = !r.miss.length && !r.extra.length && !r.lost && !r.added;
  r.exact = r.same && kA.every((k, i) => k === kB[i]);
  r.note = r.same ? (r.exact ? 'совпадает полностью' : 'совпадает (другой порядок строк)') : r.miss.length || r.extra.length ? 'другие столбцы' + (r.miss.length ? ': нет «' + r.miss.join('», «') + '»' : '') + (r.extra.length ? ': лишние «' + r.extra.join('», «') + '»' : '') : 'строк в PQ ' + r.rowsA + ', в DuckDB ' + r.rowsB + ' · не совпало ' + r.lost + (r.colsDiff.length ? ' · расходятся столбцы: «' + r.colsDiff.join('», «') + '»' : '');
  return r;
}
