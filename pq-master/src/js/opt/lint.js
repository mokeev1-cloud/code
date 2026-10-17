/* =====================================================================
   Линтер / оптимизатор, параметризатор, diff
   ===================================================================== */
const FOLD_BREAKERS = new Set(['Table.Buffer','List.Buffer','Table.AddIndexColumn','Table.FromRows','Table.FromRecords','Table.FromList','Table.FromColumns','Table.TransformRows','Table.SplitColumn','Table.FillDown','Table.FillUp','Table.ReplaceErrorValues','Table.PromoteHeaders','Table.DemoteHeaders','Table.Transpose','Table.ReverseRows','Table.Repeat','Table.AlternateRows','List.Generate','List.Accumulate','Table.RemoveRowsWithErrors','Table.InsertRows','Table.Profile','Table.Partition','Table.FuzzyNestedJoin','Table.FuzzyJoin','Table.AddFuzzyClusterColumn','Table.StopFolding','Table.ToRows','Table.ToRecords','Table.ToList']);
const FOLDABLE_OPS = new Set(['Table.SelectRows','Table.SelectColumns','Table.RemoveColumns','Table.Group','Table.Sort','Table.Distinct','Table.FirstN','Table.RenameColumns','Table.TransformColumnTypes','Table.NestedJoin','Table.Join','Table.ExpandTableColumn','Table.AddColumn','Table.Skip','Table.RowCount','Table.ReorderColumns']);
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
  const add = (sev, rule, q, step, msg, fix) => out.push({ sev, rule, query: q, step: step || '', msg, fix: fix || '' });
  const srcKeys = new Map();
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
      if (c.fn === 'Table.SelectRows'){
        const body = args[1] || [];
        for (const ti of body){ const t = toks[ti]; if (t.v === 'List.Contains'){ const kk = st.pos.get(ti); const op = st.sig[kk + 1]; const la = callArgs(toks, st, op)[0] || []; if (la.length === 1 && isName(toks[la[0]]) && !isBufferedList(A, m, nameOf(toks[la[0]]))) add('tip', 'list-buffer', m.name, step && step.name, 'List.Contains по списку «' + nameOf(toks[la[0]]) + '» внутри each вычисляет список заново для каждой строки.', 'Сделайте отдельный шаг Список = List.Buffer(…) и используйте его в фильтре.'); } }
      }
      if ((c.fn === 'Web.Contents' || c.fn === 'OData.Feed') && isInsideEach(toks, st, c.i)) add('warn', 'per-row-call', m.name, step && step.name, c.fn + ' внутри each: по отдельному HTTP-запросу на каждую строку.', 'Сгруппируйте запросы (пакетный API, фильтр на сервере) или кэшируйте результат через Table.Buffer.');
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
    if (m.hasSource && m.usedBy.length >= 2 && !m.isParam) add('info', 'multi-eval', m.name, '', 'На запрос с внешним источником ссылаются ' + m.usedBy.length + ' других (' + m.usedBy.join(', ') + '). При обновлении он может вычисляться отдельно для каждого.', 'Если источник тяжёлый: загрузите его один раз (в модель или на лист) и стройте остальное от загруженного; либо фильтруйте как можно раньше, чтобы повторное чтение было дешёвым.');
  }
  for (const [key, qs] of srcKeys) if (qs.size >= 2) add('info', 'repeated-source', [...qs][0], '', 'Источник ' + key + ' читается в ' + qs.size + ' запросах: ' + [...qs].join(', ') + '.', 'Вынесите подключение в один промежуточный запрос (без загрузки) и ссылайтесь на него — проще поддерживать и легче управлять уровнями конфиденциальности.');
  const cand = paramCandidates(A);
  const perQ = {}; for (const c of cand) (perQ[c.member] = perQ[c.member] || new Set()).add(c.value);
  for (const [q, v] of Object.entries(perQ)) add('tip', 'hardcoded', q, '', 'Захардкожено значений источника: ' + v.size + ' (пути, серверы, URL).', 'Вынесите их в параметры — раздел «Параметризатор» ниже.');
  const ord = { err: 0, warn: 1, info: 2, tip: 3 };
  out.sort((a, b) => ord[a.sev] - ord[b.sev] || a.query.localeCompare(b.query));
  return out;
}
/** Шаг (или запрос) с таким именем уже целиком List.Buffer(…) — повторно буферизовать нечего */
function isBufferedList(A, m, name){
  const s = m.steps && m.steps.steps.find(x => x.name === name); const q = !s && A.byName.get(name);
  const src = s ? A.text.slice(s.exprS, s.exprE) : q ? A.text.slice(q.exprStart, q.exprEnd) : '';
  return /^\s*List\.Buffer\s*\([\s\S]*\)\s*$/.test(src);
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
