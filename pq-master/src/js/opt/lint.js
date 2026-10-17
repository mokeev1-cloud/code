/* =====================================================================
   Линтер / оптимизатор, параметризатор, diff
   ===================================================================== */
const FOLD_BREAKERS = new Set(['Table.Buffer','List.Buffer','Table.AddIndexColumn','Table.FromRows','Table.FromRecords','Table.FromList','Table.FromColumns','Table.TransformRows','Table.SplitColumn','Table.FillDown','Table.FillUp','Table.ReplaceErrorValues','Table.PromoteHeaders','Table.DemoteHeaders','Table.Transpose','Table.ReverseRows','Table.Repeat','Table.AlternateRows','List.Generate','List.Accumulate','Table.RemoveRowsWithErrors','Table.InsertRows','Table.Profile','Table.Partition','Table.FuzzyNestedJoin','Table.FuzzyJoin','Table.AddFuzzyClusterColumn','Table.StopFolding','Table.ToRows','Table.ToRecords','Table.ToList']);
const LOCALE_FNS = ['Date.FromText','DateTime.FromText','DateTimeZone.FromText','Number.FromText','Currency.From','Time.FromText','Duration.FromText','Percentage.From'];

function callArgs(toks, st, openTi){
  const close = st.match.get(openTi); if (close == null) return [];
  const args = [[]]; let d = 0;
  for (let k = st.pos.get(openTi) + 1; k < st.sig.length && st.sig[k] < close; k++){
    const ti = st.sig[k], t = toks[ti];
    if (t.t === 'op'){ if ('([{'.includes(t.v)) d++; else if (')]}'.includes(t.v)) d--; else if (t.v === ',' && d === 0){ args.push([]); continue; } }
    args[args.length - 1].push(ti);
  }
  return args[0].length || args.length > 1 ? args : [];
}
function stepOfToken(m, ti){ if (!m.steps) return null; return m.steps.steps.find(s => ti >= s.tokS && ti < s.tokE) || null; }

function lintSection(A){
  const out = []; const { toks, st, members, byName } = A;
  const add = (sev, rule, q, step, msg, fix) => { const o = { sev, rule, query: q, step: step || '', msg, fix: fix || '' }; out.push(o); return o; };
  const srcKeys = new Map(); const reads = refreshReads(A);
  for (const m of members){
    const S = m.steps;
    if (m.load.errors > 0) add('err', 'load-errors', m.name, '', 'При последней загрузке в результате было ошибок: ' + m.load.errors + '.', 'Откройте запрос и найдите строки с ошибками (Главная → Сохранить строки → Сохранить ошибки).');
    if (S){
      for (const s of S.steps) if (s.dead) add('warn', 'dead-step', m.name, s.name, 'Шаг не участвует в результате запроса.', 'Удалите шаг или проверьте, не ссылается ли следующий шаг по ошибке на более ранний.');
      if (!S.lastIsFinal && S.steps.length) add('info', 'in-not-last', m.name, '', 'Выражение после in ссылается не на последний шаг.', 'Обычно это след отладки: последние шаги не попадают в результат.');
    }
    // источники, свёртка
    const foldSrc = m.sources.filter(s => FOLDABLE_SOURCES.has(s));
    if (S && foldSrc.length){
      let brk = null;
      for (const s of S.steps){
        const txt = A.text.slice(s.exprS, s.exprE);
        if (s.fns.includes('Value.NativeQuery') && !/EnableFolding\s*=\s*true/i.test(txt)){ brk = { s, why: 'Value.NativeQuery без [EnableFolding=true]' }; break; }
        if (s.fns.some(f => FOLDABLE_SOURCES.has(f)) && /\[\s*Query\s*=/.test(txt)){ brk = { s, why: 'собственный SQL в параметре Query источника' }; break; }
        const b = s.fns.find(f => FOLD_BREAKERS.has(f)); if (b){ brk = { s, why: b }; break; }
      }
      if (brk){
        add('warn', 'folding', m.name, brk.s.name, 'Свёртка запроса (query folding), вероятно, прерывается здесь: ' + brk.why + '. Всё после этого шага Power Query выполняет сам, вытягивая данные из ' + foldSrc[0] + '.', 'Перенесите фильтры, выбор столбцов и группировку выше этого шага. Проверить точно: правый клик по шагу → «Просмотреть собственный запрос».');
        const idx = S.steps.indexOf(brk.s);
        const movable = S.steps.slice(idx + 1).filter(s => s.fns.some(x => ['Table.SelectRows','Table.SelectColumns','Table.RemoveColumns','Table.Group','Table.Distinct','Table.FirstN'].includes(x)));
        if (movable.length){
          const atSource = brk.s.fns.some(f => FOLDABLE_SOURCES.has(f)) || brk.why.startsWith('Value.NativeQuery');
          add('tip', 'fold-move', m.name, movable.map(s => s.name).join(', '), 'Шаги ' + movable.map(s => '«' + s.name + '»').join(', ') + ' идут после точки разрыва свёртки и выполняются локально.',
            atSource ? 'Перенесите эти условия в сам SQL-текст или замените его на Value.NativeQuery(…, [EnableFolding=true]) — тогда фильтры уйдут на сервер.' : 'Если логика позволяет, поднимите их выше шага «' + brk.s.name + '» — фильтрация уйдёт на сервер.');
        }
      }
    }
    // Table.Buffer
    if (S){
      const finals = S.finalRefs;
      for (const s of S.steps){
        if (!s.fns.includes('Table.Buffer')) continue;
        if (finals.has(s.name)) add('tip', 'buffer-last', m.name, s.name, 'Table.Buffer в последнем шаге почти всегда бесполезен: результат и так материализуется при загрузке.', 'Уберите Table.Buffer или перенесите его туда, где таблица многократно читается (внутри each, перед объединением).');
      }
    }
    // Formula.Firewall и динамические источники
    const refQ = [...m.refs].map(n => byName.get(n)).filter(x => x && !x.isParam && !x.isFn);
    if (m.sources.length && refQ.length) add('warn', 'firewall', m.name, '', 'Запрос сам обращается к источнику (' + [...new Set(m.sources)].join(', ') + ') и одновременно ссылается на другие запросы (' + refQ.map(x => x.name).join(', ') + '). Это классический сценарий ошибки Formula.Firewall («Запрос ссылается на другие запросы или шаги…»).', 'Разделите: источник — в отдельный промежуточный запрос, объединение — в третий. Либо задайте уровни конфиденциальности источников.');
    for (const c of m.calls){
      if (!DATA_SOURCES.has(c.fn)) continue;
      const k = st.pos.get(c.i); const open = st.sig[k + 1];
      const args = callArgs(toks, st, open);
      const dyn = new Set(); let concat = false;
      for (const a of args) for (const ti of a){ const t = toks[ti]; if (isName(t) && !st.fieldTok.has(ti) && byName.has(nameOf(t))){ const q = byName.get(nameOf(t)); if (!q.isParam && !q.isFn && q.name !== m.name) dyn.add(q.name); } if (t.v === '&') concat = true; }
      const step = stepOfToken(m, c.i);
      if (dyn.size) add('warn', 'dynamic-source', m.name, step && step.name, c.fn + ' получает адрес из данных другого запроса (' + [...dyn].join(', ') + '). Это динамический источник: частая причина Formula.Firewall, и в Power BI Service такой запрос не обновится.', 'Если адрес — настройка, сделайте его запросом-параметром. Для Web.Contents используйте постоянный базовый URL и [RelativePath=…, Query=…].');
      else if (concat && c.fn === 'Web.Contents' && !/RelativePath/.test(A.text.slice(toks[open].s, toks[st.match.get(open)].e))) add('info', 'web-concat', m.name, step && step.name, 'URL в Web.Contents собирается конкатенацией строк.', 'Вынесите изменяемую часть в [RelativePath=…] и [Query=[…]] — так Power BI Service сможет обновлять запрос, а кэш будет работать точнее.');
      if (c.fn === 'Csv.Document'){
        const t = A.text.slice(toks[open].s, toks[st.match.get(open)].e);
        if (!/Encoding\s*=/.test(t) && !/,\s*\d+\s*,/.test(t)) add('warn', 'csv-encoding', m.name, step && step.name, 'Csv.Document без явной кодировки (Encoding).', 'Укажите [Encoding=65001] для UTF-8 или [Encoding=1251] для Windows-1251, иначе кириллица может стать «кракозябрами» на другом компьютере.');
      }
      // повторные чтения одного и того же источника
      const a0 = args[0] || []; const lit = a0.length === 1 && toks[a0[0]].t === 'str' ? toks[a0[0]].v : a0.length === 1 && isName(toks[a0[0]]) ? nameOf(toks[a0[0]]) : null;
      if (lit && EXTERNAL_SOURCES.has(c.fn)){ const key = c.fn + '(' + lit + ')'; if (!srcKeys.has(key)) srcKeys.set(key, new Set()); srcKeys.get(key).add(m.name); }
    }
    // культура, типы, ловушки
    for (const c of m.calls){
      const k = st.pos.get(c.i); const open = st.sig[k + 1]; const args = callArgs(toks, st, open); const step = stepOfToken(m, c.i);
      if (LOCALE_FNS.includes(c.fn) && args.length === 1) add('warn', 'culture', m.name, step && step.name, c.fn + ' без указания культуры: результат зависит от региональных настроек компьютера.', 'Добавьте культуру: ' + c.fn + '(x, [Culture="ru-RU"]) (или "ru-RU" вторым аргументом в старых версиях).');
      if (c.fn === 'Table.AddColumn' && args.length === 3) add('tip', 'addcolumn-type', m.name, step && step.name, 'Table.AddColumn без 4-го аргумента — столбец получит тип any.', 'Укажите тип: Table.AddColumn(t, "Имя", each …, type number). Это убирает лишний шаг «Изменённый тип» и помогает свёртке.');
      if (c.fn === 'Table.TransformColumnTypes' && args.length === 2 && m.sources.some(s => ['Csv.Document','Web.Contents','File.Contents','Lines.FromBinary'].includes(s))) add('info', 'types-culture', m.name, step && step.name, 'Преобразование типов текстового источника без культуры.', 'Для дат и дробных чисел из текста добавьте третий аргумент: Table.TransformColumnTypes(t, {…}, "ru-RU").');
      // справочник в слиянии: если он — отдельный запрос (маппинг из таблицы Excel и т. п.), буфер избавляет от его повторных вычислений
      if ((c.fn === 'Table.NestedJoin' || c.fn === 'Table.Join') && args.length >= 4){
        const r = args[2]; const q = r && r.length === 1 && isName(toks[r[0]]) ? byName.get(nameOf(toks[r[0]])) : null;
        if (q && q !== m && !q.isFn && !q.isParam && !m.sources.some(x => FOLDABLE_SOURCES.has(x)) && !q.sources.some(x => FOLDABLE_SOURCES.has(x)) && !isBuffered(A, m, q.name, 'Table'))
          add('tip', 'join-buffer', m.name, step && step.name, 'Справочник «' + q.name + '» в ' + c.fn + ' не буферизован: при слиянии он может вычисляться заново.', 'Оберните его в Table.Buffer(…) прямо в слиянии. Часто ускоряет слияние с маппингом; если время не изменится — отмените.').data = { name: q.name, s: toks[r[0]].s, e: toks[r[0]].e };
      }
      if ((c.fn === 'Web.Contents' || c.fn === 'OData.Feed') && isInsideEach(toks, st, c.i)) add('warn', 'per-row-call', m.name, step && step.name, c.fn + ' внутри each: по отдельному HTTP-запросу на каждую строку.', 'Сгруппируйте запросы (пакетный API, фильтр на сервере) или кэшируйте результат через Table.Buffer.');
    }
    // поиск в справочнике / списке внутри each — для каждой строки заново
    const groups = new Map();
    for (const h of rowLookups(A, m)){ const key = h.kind + '\u0001' + (h.step ? h.step.name : '') + '\u0001' + (h.kind === 'list' ? h.expr.replace(/\s+/g, '') : h.name); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(h); }
    for (const hs of groups.values()){
      const h = hs[0], more = hs.length > 1 ? ' и ещё ' + (hs.length - 1) : '', occ = hs.map(x => ({ s: x.s, e: x.e }));
      if (h.kind === 'hoist') add('warn', 'buffer-in-each', m.name, h.step && h.step.name, h.how + ' стоит внутри функции, которая вызывается для каждой строки: справочник буферизуется заново на каждой строке — это медленнее, чем без буфера.', 'Вынесите буфер в отдельный шаг перед этим — он вычислится один раз.').data = { kind: h.fn.split('.')[0], expr: h.expr, occ };
      else if (h.kind === 'list') add('tip', 'list-buffer', m.name, h.step && h.step.name, 'Список «' + h.expr + '» внутри each (' + h.how + more + ') вычисляется заново для каждой строки.', 'Вычислите его один раз отдельным шагом: Список = List.Buffer(…).').data = { expr: h.expr, occ };
      else if (h.buffered) add('tip', 'row-lookup', m.name, h.step && h.step.name, 'Поиск в буферизованном справочнике «' + h.name + '» для каждой строки (' + h.how + more + '): справочник уже в памяти, но для каждой строки он просматривается целиком.', 'На больших таблицах слияние (Table.NestedJoin) быстрее ещё в разы: оно сопоставляет ключи за один проход.').data = { name: h.name, occ, buffered: true };
      else add('warn', 'row-lookup', m.name, h.step && h.step.name, 'Поиск в справочнике «' + h.name + '» для каждой строки (' + h.how + more + '). На больших таблицах это одна из главных причин долгого обновления: справочник просматривается заново для каждой строки.', 'Замените поиск одним слиянием со справочником (Table.NestedJoin) или хотя бы вычислите справочник один раз: Table.Buffer.').data = { name: h.name, occ };
    }
    // объединение файлов папки
    if (m.sources.some(x => FOLDER_SOURCES.has(x))){
      const perFile = m.calls.find(c => (c.fn === 'Excel.Workbook' || c.fn === 'Csv.Document') && isInsideEach(toks, st, c.i)) || m.calls.find(c => { const q = byName.get(c.fn); return q && q.isFn && isInsideEach(toks, st, c.i); });
      if (perFile){ const step = stepOfToken(m, perFile.i);
        add('warn', 'folder-combine', m.name, step && step.name, 'Каждый файл папки разбирается при каждом обновлении (' + perFile.fn + ' для каждого файла) — обычно самое долгое место таких запросов.',
          'Отберите файлы до разбора: по [Extension], по [Name] (без временных «~$…»), по периоду в [Date modified]. Excel.Workbook(…, null, true) — без определения типов по всем листам. Сразу после разбора оставьте только нужные столбцы и строки. Если источник файлов умеет отдавать CSV, Csv.Document разбирает его в разы быстрее .xlsx. Файлы за закрытые периоды сведите в один архивный, а заново обрабатывайте только текущие.'); }
    }
    if (m.sources.includes('SharePoint.Files')){ const c = m.calls.find(x => x.fn === 'SharePoint.Files'); const step = stepOfToken(m, c.i);
      add('info', 'sharepoint-files', m.name, step && step.name, 'SharePoint.Files перечисляет все файлы сайта, а уже потом из них отбираются нужные. На больших сайтах одно это занимает минуты.', 'Для конкретной папки или файла используйте SharePoint.Contents(сайт){[Name="Shared Documents"]}[Content]{[Name="Папка"]}[Content] — навигация по папкам без перечисления всего сайта.'); }
    for (const c of m.calls){
      if (c.fn !== 'Table.Group' && c.fn !== 'Table.ExpandTableColumn') continue;
      const args = callArgs(toks, st, st.sig[st.pos.get(c.i) + 1]); const step = stepOfToken(m, c.i);
      if (c.fn === 'Table.Group'){ const a = args[2] || []; if (a.some((ti, i) => toks[ti].v === 'each' && toks[a[i + 1]] && toks[a[i + 1]].v === '_' && toks[a[i + 2]] && [',', '}', 'type'].includes(toks[a[i + 2]].v)))
        add('tip', 'group-all-rows', m.name, step && step.name, 'Группировка с агрегатом «Все строки» (each _) хранит целую таблицу для каждой группы.', 'Если дальше эти таблицы снова раскрываются или из них берётся одно значение — посчитайте нужное сразу в агрегате (List.Sum([Сумма]), Table.Max(_, "Дата") и т. п.): меньше памяти и проходов.'); }
      else { const n = (args[2] || []).filter(ti => toks[ti].t === 'str').length;
        if (n >= 15) add('tip', 'expand-many', m.name, step && step.name, 'После слияния раскрывается ' + n + ' столбцов.', 'Оставьте только действительно нужные — каждый лишний столбец проходит через все следующие шаги и загрузку.'); }
    }
    if (S && !m.sources.some(x => FOLDABLE_SOURCES.has(x))) lateReduce(A, m, add);
    if (S){
      for (const s of S.steps){
        if (!s.fns.includes('Table.AddColumn') && !s.fns.includes('Table.TransformColumns')) continue;
        const tx = A.text.slice(s.exprS, s.exprE); const n = (tx.match(/\belse\s+if\b/g) || []).length;
        const lit = (tx.match(/(\]\s*(=|<>)\s*"|Text\.(Contains|StartsWith|EndsWith)\s*\()/g) || []).length;
        if (n >= 4 && lit >= 5) add('tip', 'manual-mapping', m.name, s.name, 'Разметка задана в коде: ' + (n + 1) + ' условий if … else if подряд.', 'Перенесите соответствия в таблицу-справочник (значение → категория) и подключайте её слиянием: разметку можно править без правки кода, а на больших таблицах слияние быстрее цепочки условий для каждой строки.');
      }
      for (const s of S.steps){
        if (s.fn !== 'Table.Sort' || S.finalRefs.has(s.name)) continue;
        const users = S.steps.filter(x => x.refs.has(s.name));
        const u = users.length === 1 ? users[0].fns.find(f => f === 'Table.NestedJoin' || f === 'Table.Join' || f === 'Table.Sort') : null;
        if (u) add('tip', 'useless-sort', m.name, s.name, 'Сортировка «' + s.name + '» сразу уходит в ' + u + ' («' + users[0].name + '»): ' + (u === 'Table.Sort' ? 'следующая сортировка всё равно переупорядочит строки' : 'порядок строк после слияния не гарантирован') + '. Это лишний проход по всей таблице.', 'Уберите эту сортировку и сортируйте один раз в конце — если порядок вообще нужен (для модели данных и сводных он не нужен).');
      }
    }
    if (S){
      let sortStep = null;
      for (const s of S.steps){
        if (s.fns.includes('Table.Sort')) sortStep = s;
        else if (sortStep && (s.fns.includes('Table.Distinct') || s.fns.includes('Table.Group'))){
          add('warn', 'sort-distinct', m.name, s.name, 'После сортировки («' + sortStep.name + '») идёт ' + (s.fns.includes('Table.Distinct') ? 'Table.Distinct' : 'Table.Group') + ': Power Query не гарантирует, что останется «первая» строка в порядке сортировки.', 'Оберните отсортированную таблицу в Table.Buffer перед удалением дубликатов или выбирайте строку явно (Table.Max/Table.Min в группировке).');
          sortStep = null;
        }
        if (s.fns.includes('Table.Buffer')) sortStep = null;
      }
      for (let i = 1; i < S.steps.length; i++){
        const s = S.steps[i], p = S.steps[i - 1];
        if (s.fn === 'Table.TransformColumnTypes' && p.fns.includes('Table.PromoteHeaders')){
          const n = (A.text.slice(s.exprS, s.exprE).match(/\{\s*"/g) || []).length;
          if (n >= 6) add('info', 'hardcoded-types', m.name, s.name, 'Автоматический шаг типов сразу после заголовков перечисляет ' + n + ' столбцов поимённо: запрос сломается, если в источнике переименуют или уберут столбец.', 'Оставьте только нужные столбцы (Table.SelectColumns с MissingField.Ignore) или задавайте типы для действительно нужных полей.');
        }
      }
    }
    const tryN = (A.text.slice(m.exprStart, m.exprEnd).match(/\btry\b[\s\S]{0,200}?\botherwise\s+null\b/g) || []).length;
    if (tryN) add('info', 'try-null', m.name, '', 'try … otherwise null встречается ' + tryN + ' раз: ошибки молча превращаются в пустые значения.', 'Для отладки временно уберите otherwise или выводите текст ошибки: try x otherwise [Error=…].');
    const loadKnown = m.meta && (m.meta.FillEnabled != null || m.meta.FillToDataModelEnabled != null);
    if (loadKnown && !m.load.sheet && !m.load.model && !m.usedBy.length && !m.isParam && !m.isFn) add('info', 'orphan', m.name, '', 'Запрос не загружается и никем не используется.', 'Если он не нужен — удалите, это ускорит «Обновить всё».');
    const rd = reads.get(m.name);
    const heavy = m.hasSource || rowLookups(A, m).some(h => h.kind === 'table' || h.kind === 'hoist') || m.calls.some(c => HEAVY_STEP_FNS.has(c.fn));
    if (heavy && !m.isParam && !m.isFn && rd && rd.length >= 2) add('warn', 'multi-eval', m.name, '', 'При «Обновить всё» этот ' + (m.hasSource ? 'запрос с внешним источником' : 'тяжёлый запрос') + ' вычисляется ≈' + rd.length + ' раз — отдельно для каждой загружаемой таблицы, которая от него зависит: ' + rd.join(', ') + '. Excel не делит результат между ними, Table.Buffer тут не поможет — он действует только внутри одного запроса.', 'Оставьте загружаемыми только итоговые таблицы, промежуточные — «Только подключение»; объедините расчёты на одних данных в меньшее число загружаемых запросов; или загрузите тяжёлый промежуточный результат один раз на лист и стройте отчёты от этой таблицы (Excel.CurrentWorkbook). Фильтруйте и убирайте лишние столбцы как можно раньше.');
  }
  // настройки Excel, которые не задаются кодом M, — один совет на книгу с файлами или смешанными источниками
  const kinds = new Set(); let fileQ = null;
  for (const m of members) for (const x of m.sources){ kinds.add(x === 'Excel.CurrentWorkbook' ? 'book' : FILE_SOURCES.has(x) ? 'file' : FOLDABLE_SOURCES.has(x) ? 'db' : 'other'); if (!fileQ && FILE_SOURCES.has(x)) fileQ = m; }
  const anySrc = members.find(x => x.sources.length);
  if (anySrc && (fileQ || kinds.size >= 2 || A.family === 'pbi')){
    const xl = 'Excel — Данные → Получить данные → Параметры запроса: Текущая книга → Конфиденциальность — вариант, при котором уровни конфиденциальности игнорируются; Текущая книга → Загрузка данных — отключите фоновую загрузку предварительного просмотра; в свойствах загружаемых запросов (Запросы и подключения → правый щелчок → Свойства) включите быструю загрузку данных; промежуточные запросы — «Только создать подключение».';
    const bi = 'Power BI Desktop — Файл → Параметры и настройки → Параметры: Текущий файл → Конфиденциальность — игнорировать уровни конфиденциальности; Текущий файл → Загрузка данных — отключите фоновую загрузку предварительного просмотра и автоматические дату и время (скрытые таблицы дат для каждого столбца дат), включите параллельную загрузку таблиц; у промежуточных запросов снимите «Включить загрузку».';
    add('info', 'excel-settings', (fileQ || anySrc).name, '', 'Настройки, которые ускоряют обновление и не задаются кодом M.',
      (A.family === 'pbi' ? bi : A.family === 'excel' ? xl : xl + ' ' + bi) + ' Игнорировать уровни конфиденциальности стоит, только если все источники — внутренние данные: так исчезают проверки Formula.Firewall при смешивании источников.');
  }
  for (const [key, qs] of srcKeys) if (qs.size >= 2) add('info', 'repeated-source', [...qs][0], '', 'Источник ' + key + ' читается в ' + qs.size + ' запросах: ' + [...qs].join(', ') + '.', 'Вынесите подключение в один промежуточный запрос (без загрузки) и ссылайтесь на него — проще поддерживать и легче управлять уровнями конфиденциальности.');
  const cand = paramCandidates(A);
  const perQ = {}; for (const c of cand) (perQ[c.member] = perQ[c.member] || new Set()).add(c.value);
  for (const [q, v] of Object.entries(perQ)) add('tip', 'hardcoded', q, '', 'Захардкожено значений источника: ' + v.size + ' (пути, серверы, URL).', 'Вынесите их в параметры — раздел «Параметризатор» ниже.');
  const ord = { err: 0, warn: 1, info: 2, tip: 3 };
  out.sort((a, b) => ord[a.sev] - ord[b.sev] || a.query.localeCompare(b.query));
  return out;
}
/** Шаг (или запрос) с таким именем уже целиком Table.Buffer(…) / List.Buffer(…) — повторно буферизовать нечего */
function isBuffered(A, m, name, kind){
  const s = m.steps && m.steps.steps.find(x => x.name === name); const q = !s && A.byName.get(name);
  const src = s ? A.text.slice(s.exprS, s.exprE) : q ? A.text.slice(q.exprStart, q.exprEnd) : '';
  return new RegExp('^\\s*' + kind + '\\.Buffer\\s*\\([\\s\\S]*\\)\\s*$').test(src);
}
const isBufferedList = (A, m, name) => isBuffered(A, m, name, 'List');

/* ---- Поиск в справочнике на каждую строку (маппинг, классификаторы, коды…) ---- */
// функции, чей аргумент-функция вызывается для каждой строки / элемента / группы: индексы таких аргументов
const PER_ROW_ARGS = { 'Table.AddColumn': [2], 'Table.SelectRows': [1], 'Table.TransformColumns': [1], 'Table.TransformRows': [1], 'Table.ReplaceValue': [1, 2], 'Table.Group': [2], 'Table.CombineColumns': [2], 'List.Transform': [1], 'List.Select': [1], 'List.Accumulate': [2] };
const TABLE_LOOKUP_FNS = new Set(['Table.SelectRows', 'Table.Contains', 'Table.ContainsAny', 'Table.ContainsAll', 'Table.MatchesAnyRows', 'Table.MatchesAllRows', 'Table.PositionOf', 'Table.PositionOfAny', 'Table.FindText']);
const LIST_SCAN_FNS = new Set(['List.Contains', 'List.ContainsAny', 'List.ContainsAll', 'List.PositionOf', 'List.PositionOfAny', 'List.Select', 'List.FindText', 'List.MatchesAny', 'List.MatchesAll', 'List.Accumulate', 'List.Transform', 'List.Sum', 'List.Count', 'List.Max', 'List.Min', 'List.First', 'List.Last']);
const HEAVY_STEP_FNS = new Set(['Table.NestedJoin', 'Table.Join', 'Table.Group', 'Table.Pivot', 'Table.Unpivot', 'Table.UnpivotOtherColumns', 'Table.Sort', 'Table.Distinct', 'Table.Combine', 'Table.FuzzyNestedJoin']);
const FOLDER_SOURCES = new Set(['Folder.Files', 'Folder.Contents', 'SharePoint.Files', 'SharePoint.Contents']);
const FILE_SOURCES = new Set([...FOLDER_SOURCES, 'File.Contents']);
/** Обращения к справочникам (другим запросам и шагам) внутри функций, вызываемых для каждой строки:
    kind 'table' — Справочник{[Ключ = …]}, Table.SelectRows(Справочник, …) и т. п.;
    kind 'list'  — List.Contains(Справочник[Столбец], …), List.Contains(Список, …) и т. п. */
function rowLookups(A, m){
  if (m._lookups) return m._lookups;
  const { toks, st } = A; const out = []; const seen = new Set();
  const stepNames = new Set(m.steps ? m.steps.steps.map(s => s.name) : []);
  const known = n => stepNames.has(n) || (A.byName.has(n) && n !== m.name && !A.byName.get(n).isFn && !A.byName.get(n).isParam);
  for (const c of m.calls){
    const idxs = PER_ROW_ARGS[c.fn]; if (!idxs) continue;
    const args = callArgs(toks, st, st.sig[st.pos.get(c.i) + 1]);
    for (const ai of idxs){
      const a = args[ai]; if (!a || !a.some(ti => toks[ti].v === 'each' || toks[ti].v === '=>')) continue;
      // параметры лямбд внутри аргумента — это строки и элементы, а не справочники
      const params = new Set(['_']);
      for (const ti of a){
        if (toks[ti].v !== '=>') continue;
        let k = st.pos.get(ti) - 1; while (k >= 0 && toks[st.sig[k]].v !== ')' && st.pos.get(ti) - k < 6) k--;
        const cl = st.sig[k]; const op = k >= 0 && toks[cl].v === ')' ? st.match.get(cl) : null; if (op == null) continue;
        let expect = true;
        for (let j = st.pos.get(op) + 1; j < k; j++){ const t = toks[st.sig[j]]; if (t.v === ','){ expect = true; continue; } if (t.v === 'optional') continue; if (expect && isName(t)){ params.add(nameOf(t)); expect = false; } }
      }
      for (let p = 0; p < a.length; p++){
        const ti = a[p], t = toks[ti];
        // Table.Buffer(Справочник) / List.Buffer(…) прямо внутри each — буферизация повторяется для каждой строки
        if (t.t === 'id' && (t.v === 'Table.Buffer' || t.v === 'List.Buffer') && toks[a[p + 1]] && toks[a[p + 1]].v === '(' && toks[a[p + 3]] && toks[a[p + 3]].v === ')' && isName(toks[a[p + 2]])){
          const n = nameOf(toks[a[p + 2]]);
          if (!params.has(n) && known(n) && !seen.has(t.s)){ seen.add(t.s); out.push({ kind: 'hoist', fn: t.v, name: n, expr: toks[a[p + 2]].v, how: t.v + '(' + toks[a[p + 2]].v + ')', s: t.s, e: toks[a[p + 3]].e, step: stepOfToken(m, ti) }); }
          p += 3; continue;
        }
        if (!isName(t) || st.fieldTok.has(ti)) continue;
        const n = nameOf(t); if (params.has(n) || !known(n)) continue;
        const nx = toks[a[p + 1]], nx2 = toks[a[p + 2]], pv = toks[a[p - 1]], pv2 = toks[a[p - 2]];
        const firstArgOf = set => pv && pv.v === '(' && pv2 && pv2.t === 'id' && set.has(pv2.v);
        const endsArg = x => x && (x.v === ',' || x.v === ')');
        let hit = null;
        if (nx && nx.v === '{' && nx2 && nx2.v === '[') hit = { kind: 'table', how: t.v + '{[…]}', s: t.s, e: t.e, buffered: isBuffered(A, m, n, 'Table') };
        else if (firstArgOf(TABLE_LOOKUP_FNS) && endsArg(nx)) hit = { kind: 'table', how: pv2.v + '(' + t.v + ', …)', s: t.s, e: t.e, buffered: isBuffered(A, m, n, 'Table') };
        else if (firstArgOf(LIST_SCAN_FNS)){
          if (endsArg(nx)){ if (!isBuffered(A, m, n, 'List')) hit = { kind: 'list', expr: t.v, how: pv2.v + '(' + t.v + ', …)', s: t.s, e: t.e }; }
          else if (nx && nx.v === '[' && st.brKind.get(a[p + 1]) === 'access' && st.match.has(a[p + 1])){
            const cl = st.match.get(a[p + 1]); if (endsArg(toks[st.sig[st.pos.get(cl) + 1]])){ const expr = A.text.slice(t.s, toks[cl].e); hit = { kind: 'list', expr, how: pv2.v + '(' + expr + ', …)', s: t.s, e: toks[cl].e }; }
          }
        }
        if (hit && !seen.has(hit.s)){ seen.add(hit.s); hit.name = n; hit.step = stepOfToken(m, ti); out.push(hit); }
      }
    }
  }
  return (m._lookups = out);
}
/* ---- Поздний фильтр / позднее удаление столбцов (для источников без свёртки) ---- */
// шаги, через которые фильтр по «чужим» столбцам и удаление «чужих» столбцов можно поднять без изменения результата
const COMMUTE_FNS = new Set(['Table.SelectRows', 'Table.AddColumn', 'Table.NestedJoin', 'Table.Join', 'Table.ExpandTableColumn', 'Table.Sort', 'Table.TransformColumnTypes', 'Table.TransformColumns', 'Table.ReplaceValue', 'Table.RenameColumns', 'Table.ReorderColumns', 'Table.RemoveColumns', 'Table.DuplicateColumn', 'Table.Buffer']);
const HEAVY_PASS = new Set(['Table.AddColumn', 'Table.NestedJoin', 'Table.Join', 'Table.ExpandTableColumn', 'Table.Sort', 'Table.TransformColumns', 'Table.ReplaceValue']);
/** Имена, которые упоминает фрагмент: поля в [ ] и строковые литералы (консервативно — всё, что может быть именем столбца) */
function mentionedNames(A, ta, tb, known){
  const { toks, st } = A; const out = new Set(); const decl = new Set(); let whole = false;
  // объявления параметров лямбд (…) => — сами по себе не обращения к столбцам
  for (let i = ta; i < tb; i++){
    if (toks[i].v !== '=>') continue;
    let k = st.pos.get(i) - 1; while (k >= 0 && toks[st.sig[k]].v !== ')' && st.pos.get(i) - k < 6) k--;
    if (k < 0 || toks[st.sig[k]].v !== ')') continue;
    for (let j = st.pos.get(st.match.get(st.sig[k])) + 1; j < k; j++){ const pv = toks[st.sig[j - 1]]; if (isName(toks[st.sig[j]]) && (pv.v === '(' || pv.v === ',' || pv.v === 'optional')) decl.add(st.sig[j]); }
  }
  for (let i = ta; i < tb; i++){
    const t = toks[i]; if (!isSig(t) || decl.has(i)) continue;
    const nx = toks[st.sig[st.pos.get(i) + 1]], pv = toks[st.sig[st.pos.get(i) - 1]];
    if (t.t === 'str') out.add(strValue(t));
    else if (t.v === '[' && st.brKind.get(i) === 'access' && st.match.has(i)){ const raw = A.text.slice(t.e, toks[st.match.get(i)].s).trim(); const q = /^#"((?:[^"]|"")*)"$/.exec(raw); out.add(q ? q[1].replace(/""/g, '"') : raw); }
    // строка целиком: _ или имя (параметр, переменная) без [поле] — Record.FieldValues(r) и т. п. зависят от всех столбцов
    else if (t.v === '_'){ if (!nx || nx.v !== '[') whole = true; }
    else if (isName(t) && !st.fieldTok.has(i) && !t.v.includes('.') && t.v !== 'optional' && !known.has(nameOf(t)) && !(pv && ['as', 'type', 'nullable'].includes(pv.v)) && !(nx && ['[', '(', '='].includes(nx.v))) whole = true;
  }
  return { names: out, whole };
}
function lateReduce(A, m, add){
  const steps = m.steps.steps; const byN = new Map(steps.map(s => [s.name, s]));
  const known = new Set([...byN.keys(), ...A.byName.keys()]);
  const users = n => steps.filter(x => x.refs.has(n));
  // шаг — ровно один вызов fn(…): его аргументы, иначе null
  const callOf = s => { const t0 = A.toks[s.tokS]; if (!t0 || t0.v !== s.fn) return null; const op = A.st.sig[A.st.pos.get(s.tokS) + 1]; const cl = A.st.match.get(op); if (cl == null || cl !== s.tokE - 1) return null; return callArgs(A.toks, A.st, op); };
  for (let f = 1; f < steps.length; f++){
    const F = steps[f]; if (F.fn !== 'Table.SelectRows' && F.fn !== 'Table.RemoveColumns') continue;
    const args = callOf(F); if (!args || args.length < 2 || args[0].length !== 1) continue;
    if (F.fn === 'Table.RemoveColumns' && !args[1].every(ti => A.toks[ti].t === 'str' || ['{', '}', ','].includes(A.toks[ti].v))) continue;   // только явный список
    const src = byN.get(nameOf(A.toks[args[0][0]])); if (!src) continue;
    const own = mentionedNames(A, args[1][0], args[1][args[1].length - 1] + 1, known); if (own.whole || !own.names.size) continue;
    const passed = []; let cur = src;
    while (cur && COMMUTE_FNS.has(cur.fn) && users(cur.name).length === 1){
      const ca = callOf(cur); if (!ca || !ca.length || ca[0].length !== 1) break;
      const prev = byN.get(nameOf(A.toks[ca[0][0]])); if (!prev) break;
      const touched = mentionedNames(A, ca.slice(1).flat()[0] ?? cur.tokS, cur.tokE, known); if (touched.whole || [...own.names].some(n => touched.names.has(n))) break;
      passed.push(cur); cur = prev;
    }
    const heavy = passed.filter(x => HEAVY_PASS.has(x.fn)); if (!heavy.length) continue;
    const list = (passed.length > 1 ? 'шагов ' : 'шага ') + passed.slice().reverse().map(x => '«' + x.name + '»').join(', ');
    if (F.fn === 'Table.SelectRows') add('tip', 'late-filter', m.name, F.name, 'Фильтр «' + F.name + '» не зависит от ' + list + ' — его можно поднять выше.', 'Перенесите фильтр сразу после шага «' + cur.name + '»: через слияния, новые столбцы и сортировки пройдёт меньше строк. Результат не изменится — шаги между ними не трогают столбцы условия.');
    else add('tip', 'late-columns', m.name, F.name, 'Столбцы удаляются в шаге «' + F.name + '», хотя до этого они не нужны: их не используют ' + list.replace(/^шаг(ов|а) /, passed.length > 1 ? 'шаги ' : 'шаг ') + '.', 'Удаляйте их сразу после шага «' + cur.name + '»: слияния, новые столбцы и сортировки будут обрабатывать меньше данных.');
  }
}
/** Сколько раз запрос вычисляется при «Обновить всё»: имена загружаемых запросов, которые от него зависят.
    Без метаданных загрузки (голый M) загружаемыми считаются запросы, на которые никто не ссылается. */
function refreshReads(A){
  if (A._reads) return A._reads;
  const metaKnown = A.members.some(x => x.meta && (x.meta.FillEnabled != null || x.meta.FillToDataModelEnabled != null));
  const res = new Map();
  for (const L of A.members){
    if (L.isParam || L.isFn || !(metaKnown ? (L.load.sheet || L.load.model) : !L.usedBy.length)) continue;
    const seen = new Set(), stack = [L.name];
    while (stack.length){ const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); const q = A.byName.get(n); if (q) stack.push(...q.refs); }
    for (const n of seen){ if (!res.has(n)) res.set(n, []); res.get(n).push(L.name); }
  }
  return (A._reads = res);
}
function isInsideEach(toks, st, ti){
  // грубая проверка: между ближайшим незакрытым "(" и токеном встречается each
  let d = 0;
  for (let k = st.pos.get(ti) - 1; k >= 0; k--){
    const t = toks[st.sig[k]];
    if (t.t === 'op'){ if (')]}'.includes(t.v)) d++; else if ('([{'.includes(t.v)){ if (d === 0) { /* продолжаем наружу */ } else d--; } }
    if (t.t === 'id' && t.v === 'each' && d === 0) return true;
    if (t.t === 'id' && (t.v === 'let' || t.v === 'shared')) return false;
    if (t.v === ';') return false;
  }
  return false;
}

/* ---- Параметризатор ---- */
function paramCandidates(A){
  const { toks, st } = A; const out = [];
  for (const m of A.members){
    if (m.isParam) continue;
    for (const c of m.calls){
      const roles = SOURCE_FNS[c.fn]; if (!roles || !roles.length) continue;
      const open = st.sig[st.pos.get(c.i) + 1];
      const args = callArgs(toks, st, open);
      args.forEach((a, i) => {
        const role = roles[i]; if (!role || !['SRV','DB','URL','PATH'].includes(role)) return;
        if (a.length !== 1 || toks[a[0]].t !== 'str') return;
        const t = toks[a[0]]; const value = strValue(t); if (!value.trim()) return;
        const w = wholeCategory(t.v.slice(1, -1));
        out.push({ member: m.name, fn: c.fn, role: role === 'PATH' && w === 'URL' ? 'URL' : role, value, ti: a[0], s: t.s, e: t.e });
      });
    }
  }
  return out;
}
function suggestParamName(role, value, used){
  const base = { SRV: 'Сервер', DB: 'База', URL: 'АдресURL', PATH: /\.[A-Za-z0-9]{2,5}$/.test(value) ? 'ПутьКФайлу' : 'ПутьКПапке' }[role] || 'Параметр';
  let n = base, i = 2; while (used.has(n)) n = base + '_' + i++;
  used.add(n); return n;
}
function applyParameterize(text, A, picks){
  // picks: [{value, name}]
  const byVal = new Map(picks.map(p => [p.value, p.name]));
  const cand = paramCandidates(A).filter(c => byVal.has(c.value)).sort((a, b) => b.s - a.s);
  let out = text;
  for (const c of cand) out = out.slice(0, c.s) + mQuoteName(byVal.get(c.value)) + out.slice(c.e);
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  let tail = '';
  for (const p of picks) tail += nl + 'shared ' + mQuoteName(p.name) + ' = ' + mQuoteString(p.value) + ' meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true];' + nl;
  out = out.replace(/\s*$/, '') + nl + tail;
  return out;
}

/* ---- Diff по строкам (LCS с обрезкой общих начала/конца) ---- */
function lineDiff(a, b){
  const A = a.split(/\r?\n/), B = b.split(/\r?\n/);
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push([' ', A[i]]);
  if (a2.length * b2.length > 4e6){ a2.forEach(x => ops.push(['-', x])); b2.forEach(x => ops.push(['+', x])); }
  else {
    const n = a2.length, m = b2.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m){ if (a2[i] === b2[j]){ ops.push([' ', a2[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
  }
  for (let i = A.length - suf; i < A.length; i++) ops.push([' ', A[i]]);
  return ops;
}
function diffHtml(ops, ctx){
  ctx = ctx == null ? 3 : ctx;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o[0] !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true; });
  let h = '', skipped = 0;
  ops.forEach((o, i) => {
    if (!keep[i]){ skipped++; return; }
    if (skipped){ h += '<div class="h">… ' + skipped + ' без изменений</div>'; skipped = 0; }
    h += '<div class="' + (o[0] === '+' ? 'a' : o[0] === '-' ? 'd' : '') + '">' + escHtml(o[0] + ' ' + o[1]) + '</div>';
  });
  if (skipped) h += '<div class="h">… ' + skipped + ' без изменений</div>';
  return h || '<div class="h">нет различий</div>';
}
function compareSections(oldText, newText){
  const o = parseSection(oldText).members, n = parseSection(newText).members;
  const om = new Map(o.map(m => [m.name, oldText.slice(m.start, m.end)])), nm = new Map(n.map(m => [m.name, newText.slice(m.start, m.end)]));
  const res = { added: [], removed: [], changed: [], same: [] };
  for (const [k, v] of nm){ if (!om.has(k)) res.added.push({ name: k, text: v }); else if (om.get(k) !== v) res.changed.push({ name: k, old: om.get(k), text: v }); else res.same.push({ name: k }); }
  for (const [k, v] of om) if (!nm.has(k)) res.removed.push({ name: k, old: v });
  return res;
}
/** Литералы (строки/числа), которых не было в старом тексте */
function newLiterals(oldText, newText){
  const lits = t => { const s = new Set(); for (const x of lexM(t)) if (x.t === 'str' || x.t === 'num') s.add(x.v); return s; };
  const o = lits(oldText); const out = [];
  for (const x of lexM(newText)) if ((x.t === 'str' || x.t === 'num') && !o.has(x.v) && x.v !== '""'){ const w = x.t === 'str' ? wholeCategory(x.v.slice(1, -1)) : null; out.push({ v: x.v, kind: w || (x.t === 'num' ? 'число' : 'текст'), risky: !!w || /[\\/]|@/.test(x.v) }); }
  const seen = new Set(); return out.filter(x => !seen.has(x.v) && seen.add(x.v));
}
