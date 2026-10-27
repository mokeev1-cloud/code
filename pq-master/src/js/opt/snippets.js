/* =====================================================================
   opt/snippets.js — сниппеты и мастера: типовые запросы по форме.
   Каждый: { id, icon, title, desc, name (имя нового запроса), fields[], gen(v) → M-код }
   fields: { k, label, def, type?: 'text'|'number'|'date'|'select'|'query', opts? }
   Тип 'query' — выбор существующего запроса книги.
   ===================================================================== */
const snQ = s => mQuoteString(String(s));
const snQN = s => mQuoteName(String(s));
const snSplit = s => String(s).split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
const snList = s => '{' + snSplit(s).map(snQ).join(', ') + '}';
const SNIPPETS = [
  { id: 'folder-excel', icon: '📂', title: 'Объединить книги Excel из папки', desc: 'Все .xlsx папки → одна таблица; лист или таблица по имени, имя файла в столбце.', name: 'ОбъединённыеКниги',
    fields: [{ k: 'path', label: 'Путь к папке', def: 'C:\\Данные\\Отчёты' }, { k: 'ext', label: 'Расширение', def: '.xlsx' }, { k: 'item', label: 'Имя листа или таблицы', def: 'Лист1' }, { k: 'kind', label: 'Тип объекта', type: 'select', opts: [['Sheet', 'Лист'], ['Table', 'Таблица']], def: 'Sheet' }],
    gen: v => `let
    Источник = Folder.Files(${snQ(v.path)}),
    Отбор = Table.SelectRows(Источник, each Text.Lower([Extension]) = ${snQ(String(v.ext).toLowerCase())} and not Text.StartsWith([Name], "~$")),
    Данные = Table.AddColumn(Отбор, "Данные", each
        let
            Книга = Excel.Workbook([Content], null, true),
            Объект = Книга{[Item = ${snQ(v.item)}, Kind = ${snQ(v.kind)}]}?[Data]?
        in
            if Объект = null then #table({}, {}) else ${v.kind === 'Sheet' ? 'Table.PromoteHeaders(Объект, [PromoteAllScalars = true])' : 'Объект'}, type table),
    Нужное = Table.SelectColumns(Данные, {"Name", "Данные"}),
    Развёрнуто = Table.Combine(Table.TransformRows(Нужное, each Table.AddColumn([Данные], "Файл", (r) => [Name], type text)))
in
    Развёрнуто` },
  { id: 'folder-csv', icon: '🗂', title: 'Объединить CSV из папки', desc: 'Все CSV папки с явной кодировкой и разделителем.', name: 'ОбъединённыеCSV',
    fields: [{ k: 'path', label: 'Путь к папке', def: 'C:\\Данные\\CSV' }, { k: 'delim', label: 'Разделитель', def: ';' }, { k: 'enc', label: 'Кодировка', type: 'select', opts: [['65001', 'UTF-8'], ['1251', 'Windows-1251']], def: '65001' }],
    gen: v => `let
    Источник = Folder.Files(${snQ(v.path)}),
    Отбор = Table.SelectRows(Источник, each Text.Lower([Extension]) = ".csv"),
    Таблицы = Table.AddColumn(Отбор, "Данные", each Table.PromoteHeaders(Csv.Document([Content], [Delimiter = ${snQ(v.delim)}, Encoding = ${v.enc}, QuoteStyle = QuoteStyle.Csv]), [PromoteAllScalars = true]), type table),
    С_файлом = Table.TransformRows(Таблицы, each Table.AddColumn([Данные], "Файл", (r) => [Name], type text)),
    Объединено = Table.Combine(С_файлом)
in
    Объединено` },
  { id: 'calendar', icon: '📅', title: 'Календарь (таблица дат)', desc: 'Даты с годом, кварталом, месяцем, неделей, днём недели и признаком выходного.', name: 'Календарь',
    fields: [{ k: 'from', label: 'Начало', type: 'date', def: '2023-01-01' }, { k: 'to', label: 'Конец', type: 'date', def: '2025-12-31' }, { k: 'culture', label: 'Культура', def: 'ru-RU' }],
    gen: v => { const [y1, m1, d1] = String(v.from).split('-').map(Number), [y2, m2, d2] = String(v.to).split('-').map(Number); return `let
    Начало = #date(${y1}, ${m1}, ${d1}),
    Конец = #date(${y2}, ${m2}, ${d2}),
    Даты = List.Dates(Начало, Duration.Days(Конец - Начало) + 1, #duration(1, 0, 0, 0)),
    Таблица = Table.FromList(Даты, Splitter.SplitByNothing(), type table [Дата = date]),
    Год = Table.AddColumn(Таблица, "Год", each Date.Year([Дата]), Int64.Type),
    Квартал = Table.AddColumn(Год, "Квартал", each "Q" & Text.From(Date.QuarterOfYear([Дата])), type text),
    Месяц = Table.AddColumn(Квартал, "Месяц", each Date.Month([Дата]), Int64.Type),
    НазваниеМесяца = Table.AddColumn(Месяц, "Название месяца", each Date.MonthName([Дата], ${snQ(v.culture)}), type text),
    ГодМесяц = Table.AddColumn(НазваниеМесяца, "Год-месяц", each Date.ToText([Дата], [Format = "yyyy-MM"]), type text),
    Неделя = Table.AddColumn(ГодМесяц, "Неделя", each Date.WeekOfYear([Дата], Day.Monday), Int64.Type),
    ДеньНедели = Table.AddColumn(Неделя, "День недели", each Date.DayOfWeekName([Дата], ${snQ(v.culture)}), type text),
    Выходной = Table.AddColumn(ДеньНедели, "Выходной", each Date.DayOfWeek([Дата], Day.Monday) >= 5, type logical)
in
    Выходной`; } },
  { id: 'param', icon: '⚙', title: 'Параметр', desc: 'Запрос-параметр (текст, число или дата) — источник настроек для других запросов.', name: 'Параметр1',
    fields: [{ k: 'type', label: 'Тип', type: 'select', opts: [['Text', 'Текст'], ['Number', 'Число'], ['Date', 'Дата']], def: 'Text' }, { k: 'value', label: 'Значение', def: 'C:\\Данные' }],
    gen: v => { const val = v.type === 'Number' ? String(Number(String(v.value).replace(',', '.')) || 0) : v.type === 'Date' ? (() => { const [y, m, d] = String(v.value).split(/[-.]/).map(Number); return '#date(' + y + ', ' + m + ', ' + d + ')'; })() : snQ(v.value);
      return val + ' meta [IsParameterQuery = true, Type = "' + v.type + '", IsParameterQueryRequired = true]'; } },
  { id: 'unpivot', icon: '↯', title: 'Отменить свёртку (unpivot)', desc: 'Широкая таблица «месяцы в столбцах» → длинная «месяц-значение».', name: 'Длинная',
    fields: [{ k: 'src', label: 'Исходный запрос', type: 'query' }, { k: 'keys', label: 'Ключевые столбцы (через запятую)', def: 'Код, Название' }, { k: 'attr', label: 'Имя столбца атрибутов', def: 'Период' }, { k: 'val', label: 'Имя столбца значений', def: 'Значение' }],
    gen: v => `let
    Источник = ${snQN(v.src || 'Запрос1')},
    Длинная = Table.UnpivotOtherColumns(Источник, ${snList(v.keys)}, ${snQ(v.attr)}, ${snQ(v.val)})
in
    Длинная` },
  { id: 'merge', icon: '⋈', title: 'Слияние (подтянуть поля справочника)', desc: 'Левое внешнее объединение с разворачиванием нужных полей.', name: 'СоСправочником',
    fields: [{ k: 'left', label: 'Основной запрос', type: 'query' }, { k: 'right', label: 'Справочник', type: 'query' }, { k: 'key', label: 'Ключ (в обоих одинаковый)', def: 'Код' }, { k: 'cols', label: 'Поля справочника', def: 'Название, Группа' }],
    gen: v => `let
    Справочник = Table.Buffer(Table.Distinct(${snQN(v.right || 'Справочник')}, {${snQ(v.key)}})),
    Объединено = Table.NestedJoin(${snQN(v.left || 'Запрос1')}, {${snQ(v.key)}}, Справочник, {${snQ(v.key)}}, "Спр", JoinKind.LeftOuter),
    Развёрнуто = Table.ExpandTableColumn(Объединено, "Спр", ${snList(v.cols)}, {${snSplit(v.cols).map(c => snQ('Спр.' + c)).join(', ')}})
in
    Развёрнуто` },
  { id: 'group', icon: 'Σ', title: 'Группировка с суммой и количеством', desc: 'Итоги по ключам: сумма, количество строк, минимум и максимум.', name: 'Итоги',
    fields: [{ k: 'src', label: 'Исходный запрос', type: 'query' }, { k: 'keys', label: 'Группировать по', def: 'Регион' }, { k: 'sum', label: 'Суммировать столбец', def: 'Сумма' }],
    gen: v => `let
    Источник = ${snQN(v.src || 'Запрос1')},
    Итоги = Table.Group(Источник, ${snList(v.keys)}, {
        {"Сумма", each List.Sum(Table.Column(_, ${snQ(v.sum)})), type number},
        {"Строк", each Table.RowCount(_), Int64.Type},
        {"Мин", each List.Min(Table.Column(_, ${snQ(v.sum)})), type number},
        {"Макс", each List.Max(Table.Column(_, ${snQ(v.sum)})), type number}
    })
in
    Итоги` },
  { id: 'listbuffer', icon: '⚡', title: 'Фильтр по списку из другого запроса', desc: 'Правильно: список буферизуется один раз, а не для каждой строки.', name: 'Отфильтровано',
    fields: [{ k: 'src', label: 'Что фильтруем', type: 'query' }, { k: 'col', label: 'Столбец', def: 'Код' }, { k: 'lst', label: 'Запрос со списком', type: 'query' }, { k: 'lcol', label: 'Столбец списка', def: 'Код' }],
    gen: v => `let
    Список = List.Buffer(Table.Column(${snQN(v.lst || 'Список')}, ${snQ(v.lcol)})),
    Отфильтровано = Table.SelectRows(${snQN(v.src || 'Запрос1')}, each List.Contains(Список, Record.Field(_, ${snQ(v.col)})))
in
    Отфильтровано` },
  { id: 'safe-types', icon: '🛡', title: 'Безопасные типы с отчётом об ошибках', desc: 'Преобразует типы и выносит строки с ошибками в отдельный столбец для разбора.', name: 'ТипизированоБезопасно',
    fields: [{ k: 'src', label: 'Исходный запрос', type: 'query' }, { k: 'col', label: 'Столбец с числами-текстом', def: 'Сумма' }, { k: 'culture', label: 'Культура', def: 'ru-RU' }],
    gen: v => `let
    Источник = ${snQN(v.src || 'Запрос1')},
    Попытка = Table.AddColumn(Источник, "__число", each try Number.FromText(Text.From(Record.Field(_, ${snQ(v.col)})), ${snQ(v.culture)}), type record),
    Значение = Table.AddColumn(Попытка, ${snQ(v.col + '_число')}, each if [__число][HasError] then null else [__число][Value], type nullable number),
    Ошибка = Table.AddColumn(Значение, ${snQ(v.col + '_ошибка')}, each if [__число][HasError] then [__число][Error][Message] else null, type nullable text),
    Итог = Table.RemoveColumns(Ошибка, {"__число"})
in
    Итог` },
  { id: 'pagination', icon: '🔁', title: 'Пагинация Web API (List.Generate)', desc: 'Постранично забирает данные API, пока страницы не пустые. URL — через RelativePath.', name: 'ДанныеAPI',
    fields: [{ k: 'base', label: 'Базовый URL', def: 'https://api.example.com' }, { k: 'rel', label: 'Путь', def: 'v1/items' }, { k: 'page', label: 'Параметр страницы', def: 'page' }, { k: 'max', label: 'Максимум страниц', type: 'number', def: '100' }],
    gen: v => `let
    Страница = (n as number) => Json.Document(Web.Contents(${snQ(v.base)}, [RelativePath = ${snQ(v.rel)}, Query = [${v.page} = Text.From(n)]])),
    Страницы = List.Generate(
        () => [n = 1, Данные = Страница(1)],
        each [n] <= ${Number(v.max) || 100} and List.Count([Данные]) > 0,
        each [n = [n] + 1, Данные = Страница([n] + 1)],
        each [Данные]),
    Все = List.Combine(Страницы),
    Таблица = Table.FromRecords(Все)
in
    Таблица` },
  { id: 'incremental', icon: '⏱', title: 'Инкрементальное обновление (RangeStart/RangeEnd)', desc: 'Параметры дат и фильтр, который сворачивается к источнику. Для Power BI.', name: 'ФильтрПоДатам',
    fields: [{ k: 'src', label: 'Исходный запрос', type: 'query' }, { k: 'col', label: 'Столбец даты-времени', def: 'ДатаВремя' }],
    gen: v => `let
    Источник = ${snQN(v.src || 'Запрос1')},
    // создайте параметры RangeStart и RangeEnd (тип «дата/время») — сниппет «Параметр»
    Отбор = Table.SelectRows(Источник, each Record.Field(_, ${snQ(v.col)}) >= RangeStart and Record.Field(_, ${snQ(v.col)}) < RangeEnd)
in
    Отбор` },
  { id: 'clean-fn', icon: 'ƒ', title: 'Функция: очистка текста', desc: 'Убирает управляющие символы, лишние пробелы и неразрывные пробелы; пустое → null.', name: 'fnОчиститьТекст',
    fields: [],
    gen: () => `(текст as nullable text) as nullable text =>
let
    Без_служебных = if текст = null then null else Text.Clean(Text.Replace(текст, Character.FromNumber(160), " ")),
    Пробелы = if Без_служебных = null then null else Text.Combine(List.Select(Text.Split(Text.Trim(Без_служебных), " "), each _ <> ""), " "),
    Итог = if Пробелы = "" then null else Пробелы
in
    Итог` },
  { id: 'current-table', icon: '▦', title: 'Таблица из текущей книги', desc: 'Источник — умная таблица Excel этой же книги.', name: 'ИзТаблицы',
    fields: [{ k: 'tbl', label: 'Имя таблицы Excel', def: 'Таблица1' }],
    gen: v => `let
    Источник = Excel.CurrentWorkbook(){[Name = ${snQ(v.tbl)}]}[Content]
in
    Источник` },
  { id: 'error-log', icon: '🐞', title: 'Найти строки с ошибками', desc: 'Отладка: какие строки запроса дают ошибки и в каких столбцах.', name: 'СтрокиСОшибками',
    fields: [{ k: 'src', label: 'Запрос', type: 'query' }],
    gen: v => `let
    Источник = ${snQN(v.src || 'Запрос1')},
    СОшибками = Table.SelectRowsWithErrors(Источник),
    Номер = Table.AddIndexColumn(СОшибками, "№ строки", 1, 1, Int64.Type)
in
    Номер` }
];
