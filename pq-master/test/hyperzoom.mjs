#!/usr/bin/env node
/*
  Гиперзум: сравнительный тест «логика Power Query (интерпретатор Мастера) ↔ настоящий DuckDB».
  node pq-master/test/hyperzoom.mjs      (нужны python3 и пакет duckdb: pip install duckdb==1.4.3)
  13 запросов с типичными операциями (типы, фильтры, слияния, группировки, сведение и отмена свёртки,
  «Заполнить вниз», поиск в справочнике, объединение…): значения шагов до перевода считает интерпретатор,
  они грузятся в DuckDB, затем выполняется переведённый SQL (hzQuerySql) и результат сверяется (hzCompare).
  Эталон — интерпретатор: расхождение — это баг перевода или интерпретатора. Код возврата 1 при расхождении.
*/
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = p => fs.readFileSync(path.join(ROOT, 'src/js', p), 'utf8');
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, crypto, performance, setTimeout, atob, btoa });
vm.runInContext(['core/zip-mashup.js', 'core/xlsx-data.js', 'm/lang.js', 'm/reference.js', 'm/interp.js', 'm/sql.js'].map(JS).join('\n') +
  '\n;globalThis.X = { analyzeSection, hzPlan, hzQuerySql, hzCompare, mRunSteps, MTab, MDate, force, mToText, HZ_MACROS, setData: v => { M_DATA = v; } };', ctx);
const X = ctx.X;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-'));
const RUN_PY = "import json, sys, duckdb, datetime\njob = json.load(open(sys.argv[1], encoding='utf8'))\ncon = duckdb.connect()\ncon.execute(job['macros'])\ndef conv(v, t):\n    if v is None: return None\n    if isinstance(v, dict) and 'err' in v: return None\n    if isinstance(v, dict) and 'd' in v: return datetime.datetime.fromisoformat(v['d'])\n    return v\nout = {}\nfor L in job['loads']:\n    cols = L['cols']; types = L['types']\n    con.execute('CREATE OR REPLACE TABLE ' + json.dumps(L['name'], ensure_ascii=False) + ' (' + ', '.join(json.dumps(c, ensure_ascii=False) + ' ' + t for c, t in zip(cols, types)) + ')')\n    if L['rows']:\n        con.executemany('INSERT INTO ' + json.dumps(L['name'], ensure_ascii=False) + ' VALUES (' + ','.join('?' * len(cols)) + ')', [[conv(v, t) for v, t in zip(r, types)] for r in L['rows']])\nfor name, sql in job['sqls']:\n    try:\n        con.execute(sql)\n        rel = con.execute('SELECT * FROM ' + json.dumps(name, ensure_ascii=False) + ' ORDER BY __r')\n        cols = [d[0] for d in rel.description]\n        rows = []\n        for r in rel.fetchall():\n            rr = []\n            for v in r:\n                if isinstance(v, (datetime.date, datetime.datetime)): rr.append({'d': v.isoformat()})\n                elif hasattr(v, 'is_finite'): rr.append(float(v))\n                else: rr.append(v)\n            rows.append(rr)\n        out[name] = {'cols': cols, 'rows': rows}\n    except Exception as e:\n        out[name] = {'error': str(e)[:400]}\njson.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, default=str)\n";
fs.writeFileSync(path.join(TMP, 'run.py'), RUN_PY);

const P = ['Дата', 'Счёт', 'Сумма', 'Контрагент', 'ЦФО', 'Теги'];
const prov = [];
const names = ['ООО Ромашка', ' ип иванов ', 'ООО Лютик', null, 'АО Василёк'];
for (let i = 0; i < 400; i++) prov.push([(1 + i % 28) + '.' + (1 + i % 12) + '.2024', String([90, 44, 26, 51, 60][i % 5]), (i % 7 === 0 ? '-' : '') + (i * 13 % 1000) + ',' + (i % 100), names[i % 5], i % 10 === 0 ? 'ЦФО-' + (i % 3) : null, i % 3 ? 'a;b;c' : 'x']);
const wb = [
  { name: 'Проводки', cols: P, rows: prov },
  { name: 'Маппинг', cols: ['Код', 'Статья', 'Группа'], rows: [[90, 'Выручка', 'Доходы'], [44, 'Аренда', 'Расходы'], [26, 'Зарплата', 'Расходы'], [60, 'Поставщики', null]] },
  { name: 'План', cols: ['Статья', 'Янв', 'Фев', 'Мар'], rows: [['Выручка', 100, 200, null], ['Аренда', -50, -50, -50], ['Зарплата', -10, null, -30]] }
];
const sec = `section Section1;
shared Порог = 100 meta [IsParameterQuery=true, Type="Number"];
shared Проводки = let
    Источник = Excel.CurrentWorkbook(){[Name="Проводки"]}[Content],
    Типы = Table.TransformColumnTypes(Источник, {{"Дата", type date}, {"Счёт", Int64.Type}, {"Сумма", type number}}),
    Заполнено = Table.FillDown(Типы, {"ЦФО"}),
    НеПустые = Table.SelectRows(Заполнено, each [Сумма] <> 0 and [Контрагент] <> null),
    Очищено = Table.TransformColumns(НеПустые, {{"Контрагент", each Text.Upper(Text.Trim(_)), type text}}),
    Месяц = Table.AddColumn(Очищено, "Месяц", each Date.StartOfMonth([Дата]), type date),
    Год = Table.AddColumn(Месяц, "Год", each Date.Year([Дата]), Int64.Type),
    Знак = Table.AddColumn(Год, "Знак", each if [Сумма] > Порог then "крупная" else if [Сумма] < 0 then "минус" else null),
    Округл = Table.AddColumn(Знак, "Округл", each Number.Round([Сумма] / 3, 2)),
    Замена = Table.ReplaceValue(Округл, "ООО", "О", Replacer.ReplaceText, {"Контрагент"}),
    Сорт = Table.Sort(Замена, {{"Дата", Order.Descending}, {"Счёт", Order.Ascending}})
in
    Сорт;
shared ОПиУ = let
    Слияние = Table.NestedJoin(Проводки, {"Счёт"}, Маппинг, {"Код"}, "М", JoinKind.LeftOuter),
    Развернуть = Table.ExpandTableColumn(Слияние, "М", {"Статья", "Группа"}, {"Статья", "Группа"}),
    Итоги = Table.Group(Развернуть, {"Группа", "Месяц"}, {{"Сумма", each List.Sum([Сумма]), type number}, {"Строк", each Table.RowCount(_), Int64.Type}, {"Средняя", each List.Average([Сумма])}, {"Первый", each List.First([Контрагент])}}),
    Сорт = Table.Sort(Итоги, {"Группа", "Месяц"})
in
    Сорт;
shared Маппинг = Excel.CurrentWorkbook(){[Name="Маппинг"]}[Content];
shared Нормализация = let
    Источник = Excel.CurrentWorkbook(){[Name="План"]}[Content],
    Длинная = Table.UnpivotOtherColumns(Источник, {"Статья"}, "Месяц", "План"),
    Назад = Table.Pivot(Длинная, List.Distinct(Длинная[Месяц]), "Месяц", "План", List.Sum)
in
    Назад;
shared Длинная = let
    Источник = Excel.CurrentWorkbook(){[Name="План"]}[Content],
    Длинная = Table.Unpivot(Источник, {"Янв", "Фев"}, "Месяц", "План")
in
    Длинная;
shared Дубли = let
    Источник = Проводки,
    ПоСчёту = Table.Distinct(Источник, {"Счёт"}),
    Колонки = Table.SelectColumns(ПоСчёту, {"Счёт", "Контрагент", "Сумма"}),
    Индекс = Table.AddIndexColumn(Колонки, "№", 1, 1),
    Все = Table.Distinct(Table.SelectColumns(Проводки, {"Счёт", "Год"}))
in
    Индекс;
shared Срез = let
    Первые = Table.FirstN(Проводки, 30),
    Пропуск = Table.Skip(Первые, 5),
    Последние = Table.LastN(Пропуск, 10),
    Переим = Table.RenameColumns(Последние, {{"Контрагент", "Партнёр"}, {"ЦФО", "Подразделение"}}),
    Удал = Table.RemoveColumns(Переим, {"Теги", "Округл"}),
    Порядок = Table.ReorderColumns(Удал, {"Сумма", "Счёт"}),
    Копия = Table.DuplicateColumn(Порядок, "Сумма", "Сумма2"),
    Обратно = Table.ReverseRows(Копия)
in
    Обратно;
shared Списки = let
    Коды = List.Buffer(Маппинг[Код]),
    ЕстьВСправочнике = Table.SelectRows(Проводки, each List.Contains(Коды, [Счёт])),
    Конкретные = Table.SelectRows(ЕстьВСправочнике, each List.Contains({90, 44}, [Счёт]) or Text.Contains([Контрагент], "ЛЮТ")),
    Поиск = Table.AddColumn(Конкретные, "Статья", each Маппинг{[Код = [Счёт]]}?[Статья]),
    Склейка = Table.AddColumn(Поиск, "Ключ", each Text.From([Счёт]) & "-" & Text.Start([Статья] ?? "?", 3))
in
    Склейка;
shared Разделение = let
    Источник = Table.SelectColumns(Проводки, {"Теги", "Счёт"}),
    Разд = Table.SplitColumn(Источник, "Теги", Splitter.SplitTextByDelimiter(";", QuoteStyle.Csv), {"Т1", "Т2", "Т3"})
in
    Разд;
shared Анти = let
    Слияние = Table.NestedJoin(Проводки, {"Счёт"}, Маппинг, {"Код"}, "М", JoinKind.LeftAnti),
    Развернуть = Table.ExpandTableColumn(Слияние, "М", {"Статья"})
in
    Развернуть;
shared Внутр = let
    Слияние = Table.NestedJoin(Маппинг, {"Код"}, Проводки, {"Счёт"}, "П", JoinKind.Inner),
    Агрег = Table.AggregateTableColumn(Слияние, "П", {{"Сумма", List.Sum, "Итого"}, {"Сумма", List.Count, "Число"}})
in
    Агрег;
shared Объединение = let
    Доп = Table.SelectRows(Проводки, each [Счёт] = 90),
    Вместе = Table.Combine({Маппинг, Доп}),
    Различных = Table.Group(Проводки, {"Счёт"}, {{"Контрагентов", each List.Count(List.Distinct([Контрагент]))}, {"Макс", each List.Max([Сумма])}})
in
    Вместе;
shared Итог = Table.Group(Проводки, {}, {{"Всего", each List.Sum([Сумма])}, {"Строк", each Table.RowCount(_)}});
`;

X.setData({ currentWorkbook: () => wb, file: () => null, folder: () => null });
const A = X.analyzeSection(sec, {}); const plan = X.hzPlan(A);
const done = new Map(), loads = [], sqls = [], mres = new Map();
const enc = v => { try { v = X.force(v); } catch { return { err: 1 }; } if (v instanceof X.MDate) return { d: new Date(v.ms).toISOString().slice(0, 19) }; if (v !== null && typeof v === 'object') return X.mToText(v); return v; };
const typeOf = (t, i) => { const ks = new Set(); for (const r of t.rows){ let v; try { v = X.force(r[i]); } catch { continue; } if (v === null) continue; ks.add(typeof v === 'number' ? 'DOUBLE' : typeof v === 'boolean' ? 'BOOLEAN' : v instanceof X.MDate ? (v.kind === 'date' ? 'DATE' : 'TIMESTAMP') : 'VARCHAR'); } return ks.size === 1 ? [...ks][0] : 'VARCHAR'; };
const toJ = (name, t) => ({ name, cols: t.cols, types: t.cols.map((_, i) => typeOf(t, i)), rows: t.rows.map(r => r.map((v, i) => { const e = enc(v); return typeOf(t, i) === 'VARCHAR' && typeof e === 'number' ? String(e) : e; })) });
for (const q of plan.queries){
  if (q.kind !== 'table') continue;
  const steps = X.mRunSteps(sec, q.name, { queries: done }); const fin = steps[steps.length - 1];
  if (fin.error){ console.log('ошибка интерпретатора', q.name, fin.error.message); continue; }
  done.set(q.name, fin.value); mres.set(q.name, fin.value);
  for (const m of q.mat){ const s = steps.find(x => x.name === m) || steps[steps.length - 1]; loads.push(toJ(q.name + ' · ' + m, s.value)); }
  sqls.push([q.name, X.hzQuerySql(plan, q)]);
}
fs.writeFileSync(path.join(TMP, 'job.json'), JSON.stringify({ macros: X.HZ_MACROS, loads, sqls }));
try { execFileSync('python3', ['-I', path.join(TMP, 'run.py'), path.join(TMP, 'job.json'), path.join(TMP, 'out.json')], { stdio: ['ignore', 'inherit', 'inherit'] }); }
catch (e){ console.log('Нужны python3 и пакет duckdb (pip install duckdb==1.4.3):', e.message); process.exit(2); }
const out = JSON.parse(fs.readFileSync(path.join(TMP, 'out.json'), 'utf8'));
let bad = 0;
for (const q of plan.queries){
  if (q.kind !== 'table' || !mres.has(q.name)) continue;
  const o = out[q.name];
  if (!o || o.error){ bad++; console.log('✗', q.name, 'ошибка SQL:', o && o.error); continue; }
  const b = new X.MTab(o.cols, o.rows.map(r => r.map(v => v && typeof v === 'object' && v.d ? new X.MDate(v.d.length > 10 && !v.d.endsWith('T00:00:00') ? 'datetime' : 'date', Date.parse(v.d + (v.d.length > 10 ? 'Z' : 'T00:00:00Z'))) : v)));
  const c = X.hzCompare(mres.get(q.name), b); if (!c.same) bad++;
  console.log(c.same ? '✓' : '✗', q.name, '·', c.note, '· шагов в SQL:', q.sqlSteps);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(bad ? 'Расхождений: ' + bad : 'Все запросы совпали (' + mres.size + ').');
process.exit(bad ? 1 : 0);
