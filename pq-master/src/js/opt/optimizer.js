/* =====================================================================
   opt/optimizer.js — продвинутый оптимизатор: советы с автоисправлением,
   оценка «здоровья» книги, карта тяжести шагов.
   optimizeSection(text, A, lint) → { findings, score, breakdown, heat }
   Каждый совет: { id, rule, sev, impact[], safety, query, step, title, why, how,
                   fix?(text, opts) → новый текст, fixLabel, options?, local }
     safety: 'safe'   — исправление не меняет результат запроса;
             'check'  — почти наверняка верно, но проверьте результат;
             'manual' — только совет, автоисправления нет.
   Исправления — чистые функции над текстом Section1.m; применять через
   applyFinding() (views/optimizer.js), который пересчитывает анализ.
   Зависит от: m/lang.js, opt/lint.js (callArgs, paramCandidates, applyParameterize…).
   ===================================================================== */
const IMPACT_LABEL = { speed: 'скорость', reliability: 'надёжность', portability: 'переносимость', clarity: 'читаемость' };
const SAFETY_LABEL = { safe: 'безопасно', check: 'проверьте результат', manual: 'вручную' };
const SEV_W = { err: 12, warn: 5, info: 2, tip: 1 };
// правила, чьи исправления меняют другие запросы или добавляют/удаляют запросы
const NONLOCAL_FIX_RULES = new Set(['hardcoded', 'orphan', 'shared-source']);

const rng = (text, s, e, repl) => text.slice(0, s) + repl + text.slice(e);
function lineIndentAt(text, pos){ const ls = text.lastIndexOf('\n', pos - 1) + 1; return (/^[ \t]*/.exec(text.slice(ls, pos)) || [''])[0]; }
/** Описание вызова функции по индексу токена-имени; null, если скобка вызова не закрыта */
function callInfo(A, fnTi){
  const { toks, st } = A; const open = st.sig[st.pos.get(fnTi) + 1]; const close = st.match.get(open);
  if (close == null || !toks[open] || toks[open].v !== '(') return null;
  const args = callArgs(toks, st, open);
  const argRange = i => { const a = args[i]; if (!a || !a.length) return null; return { s: toks[a[0]].s, e: toks[a[a.length - 1]].e }; };
  return { open, close, args, argRange, argText: i => { const r = argRange(i); return r ? A.text.slice(r.s, r.e) : null; }, s: toks[fnTi].s, e: toks[close].e };
}
/** Если выражение шага — ровно один вызов fn(...), вернуть его callInfo */
function stepSingleCall(A, step, fn){
  const { toks, st } = A; const sig = []; for (let i = step.tokS; i < step.tokE; i++) if (isSig(toks[i])) sig.push(i);
  if (sig.length < 3 || toks[sig[0]].v !== fn || toks[sig[1]].v !== '(') return null;
  if (st.match.get(sig[1]) !== sig[sig.length - 1]) return null;
  return callInfo(A, sig[0]);
}
function stepRemoveRange(steps, idx){
  const s = steps[idx];
  if (idx < steps.length - 1) return { s: s.s, e: steps[idx + 1].s };
  if (idx > 0) return { s: steps[idx - 1].exprE, e: s.exprE };
  return null;
}
function uniqueStepName(m, base){ const names = new Set(m.steps ? m.steps.steps.map(s => s.name) : []); let n = base, k = 2; while (names.has(n)) n = base + k++; return n; }
function uniqueQueryName(A, base){ let n = base, k = 2; while (A.byName.has(n)) n = base + '_' + k++; return n; }
const listItems = t => { t = t.trim(); if (!/^\{[\s\S]*\}$/.test(t)) return null; const inner = t.slice(1, -1).trim(); return inner; };
function pairFirstStrings(listText){ const out = []; const re = /\{\s*"((?:[^"]|"")*)"/g; let m; while ((m = re.exec(listText))) out.push(m[1]); return out; }
function pairSecondStrings(listText){ const out = []; const re = /\{\s*"(?:[^"]|"")*"\s*,\s*"((?:[^"]|"")*)"\s*\}/g; let m; while ((m = re.exec(listText))) out.push(m[1]); return out; }

function inferColumnType(genText){
  const g = genText.trim().replace(/^each\s+/, '');
  if (/^Text\.|^Date\.(ToText|MonthName|DayOfWeekName)|^Number\.ToText/.test(g) || /^if\b[\s\S]*\bthen\s+"[^"]*"\s+else\s+("[^"]*"|null)\s*$/.test(g) || (/&/.test(g) && /"/.test(g) && !/\b(Number|Date|List)\.\w+/.test(g))) return 'type text';
  if (/^(Date|Time)\.(Year|Month|Day|QuarterOfYear|WeekOfYear|DayOfWeek|DayOfYear|Hour|Minute|DaysInMonth)\b/.test(g)) return 'Int64.Type';
  if (/^Date\.(From|AddDays|AddMonths|AddYears|AddWeeks|AddQuarters|StartOf\w+|EndOf\w+|FromText)\b|^DateTime\.Date\b/.test(g)) return 'type date';
  if (/^(Number\.|List\.(Sum|Count|Average|Min|Max|NonNullCount)\b|Duration\.Total|Table\.RowCount)/.test(g)) return 'type number';
  if (/^(\[[^\]]+\]|\d+(\.\d+)?)(\s*[-+*/]\s*(\[[^\]]+\]|\d+(\.\d+)?))+$/.test(g)) return 'type number';
  if (/^(Text\.(Contains|StartsWith|EndsWith)|List\.Contains)\b/.test(g)) return 'type logical';
  return null;
}

function optimizeSection(text, A, lint){
  const F = []; const add = f => { f.id = f.rule + '|' + f.query + '|' + (f.step || '') + '|' + (f.key || ''); F.push(f); };
  const byQ = n => A.byName.get(n);
  const locale = (typeof pqmSettings === 'function' && pqmSettings().cultureLocale) || 'ru-RU';
  // кандидаты в параметры и существующие параметры-строки считаются один раз на книгу (иначе O(запросов²))
  let candByQ = null, paramByLit = null;
  const candidatesOf = q => { if (!candByQ){ candByQ = new Map(); for (const c of paramCandidates(A)){ if (!candByQ.has(c.member)) candByQ.set(c.member, []); candByQ.get(c.member).push(c); } } return candByQ.get(q) || []; };
  const paramWithValue = v => { if (!paramByLit){ paramByLit = new Map(); for (const x of A.members){ if (!x.isParam) continue; const mm = /^\s*("(?:[^"]|"")*")\s+meta/.exec(text.slice(x.exprStart, x.exprEnd)); if (mm && !paramByLit.has(mm[1])) paramByLit.set(mm[1], x.name); } } return paramByLit.get(mQuoteString(v)); };
  // --- советы на основе линтера (с исправлениями, где возможно)
  for (const l of lint){
    const m = byQ(l.query); const steps = m && m.steps ? m.steps.steps : null;
    const step = steps && l.step ? steps.find(s => s.name === l.step) : null;
    const base = { sev: l.sev, query: l.query, step: l.step, title: l.msg, why: l.msg, how: l.fix, rule: l.rule };
    switch (l.rule){
      case 'dead-step': {
        const idx = steps ? steps.indexOf(step) : -1; const r = idx >= 0 ? stepRemoveRange(steps, idx) : null;
        add(Object.assign(base, { title: 'Неиспользуемый шаг «' + l.step + '»', impact: ['clarity', 'speed'], safety: r ? 'safe' : 'manual', fixLabel: 'Удалить шаг', fix: r ? t => rng(t, r.s, r.e, '') : null })); break; }
      case 'buffer-last': {
        const ci = step && stepSingleCall(A, step, 'Table.Buffer');
        add(Object.assign(base, { title: 'Table.Buffer в последнем шаге бесполезен', impact: ['speed'], safety: ci && ci.args.length === 1 ? 'safe' : 'manual', fixLabel: 'Убрать Table.Buffer', fix: ci && ci.args.length === 1 ? t => rng(t, ci.s, ci.e, ci.argText(0)) : null })); break; }
      case 'culture': {
        const call = m.calls.find(c => LOCALE_FNS.includes(c.fn) && stepOfToken(m, c.i) === step && (callInfo(A, c.i) || { args: [] }).args.length === 1);
        const ci = call && callInfo(A, call.i); const arg = /FromText$/.test(call ? call.fn : '') && !/^Number/.test(call.fn) ? '[Culture="' + locale + '"]' : '"' + locale + '"';
        add(Object.assign(base, { title: (call ? call.fn : 'Преобразование') + ' без культуры', impact: ['reliability', 'portability'], safety: ci ? 'check' : 'manual', fixLabel: 'Добавить культуру ' + locale, fix: ci ? t => rng(t, A.toks[ci.close].s, A.toks[ci.close].s, ', ' + arg) : null })); break; }
      case 'types-culture': {
        const call = m.calls.find(c => c.fn === 'Table.TransformColumnTypes' && stepOfToken(m, c.i) === step);
        const ci = call && callInfo(A, call.i);
        add(Object.assign(base, { title: 'Типы текстового источника без культуры', impact: ['reliability', 'portability'], safety: ci && ci.args.length === 2 ? 'check' : 'manual', fixLabel: 'Добавить культуру ' + locale, fix: ci && ci.args.length === 2 ? t => rng(t, A.toks[ci.close].s, A.toks[ci.close].s, ', "' + locale + '"') : null })); break; }
      case 'csv-encoding': {
        const call = m.calls.find(c => c.fn === 'Csv.Document' && stepOfToken(m, c.i) === step); const ci = call && callInfo(A, call.i);
        let fix = null;
        if (ci && ci.args.length === 1) fix = (t, o) => rng(t, A.toks[ci.close].s, A.toks[ci.close].s, ', [Encoding=' + ((o && o.enc) || 65001) + ']');
        else if (ci && ci.args.length >= 2 && /^\[/.test(ci.argText(1).trim()) && !/Encoding\s*=/.test(ci.argText(1))){ const r = ci.argRange(1); fix = (t, o) => rng(t, r.s + 1, r.s + 1, 'Encoding=' + ((o && o.enc) || 65001) + ', '); }
        add(Object.assign(base, { title: 'CSV без явной кодировки', impact: ['reliability'], safety: fix ? 'check' : 'manual', fixLabel: 'Указать кодировку', fix, options: fix ? [{ key: 'enc', label: 'Кодировка', values: [['65001', 'UTF-8 (65001)'], ['1251', 'Windows-1251']] }] : null })); break; }
      case 'addcolumn-type': {
        const call = m.calls.find(c => c.fn === 'Table.AddColumn' && stepOfToken(m, c.i) === step); const ci = call && callInfo(A, call.i);
        const ty = ci && ci.args.length === 3 ? inferColumnType(ci.argText(2)) : null;
        add(Object.assign(base, { title: 'Новый столбец без типа (any)', impact: ['reliability', 'speed'], safety: ty ? 'check' : 'manual', fixLabel: ty ? 'Указать ' + ty : '', fix: ty ? t => rng(t, A.toks[ci.close].s, A.toks[ci.close].s, ', ' + ty) : null, how: ty ? 'Тип выведен из выражения: ' + ty + '. ' + l.fix : l.fix })); break; }
      case 'sort-distinct': {
        const idx = steps.indexOf(step); let sortStep = null; for (let k = idx - 1; k >= 0; k--) if (steps[k].fns.includes('Table.Sort')){ sortStep = steps[k]; break; }
        const ok = sortStep && !/^\s*Table\.Buffer\(/.test(text.slice(sortStep.exprS, sortStep.exprE));
        add(Object.assign(base, { title: 'Сортировка перед удалением дублей без Table.Buffer', impact: ['reliability'], safety: ok ? 'check' : 'manual', fixLabel: 'Обернуть «' + (sortStep ? sortStep.name : '') + '» в Table.Buffer', fix: ok ? t => rng(t, sortStep.exprS, sortStep.exprE, 'Table.Buffer(' + text.slice(sortStep.exprS, sortStep.exprE) + ')') : null })); break; }
      case 'list-buffer': {
        let fix = null; const nmMatch = /«([^»]+)»/.exec(l.msg); const listName = nmMatch ? nmMatch[1] : null;
        if (step && listName && steps){
          const newName = uniqueStepName(m, listName + '_буфер');
          const reps = [];
          for (let i = step.tokS; i < step.tokE; i++){ const tk = A.toks[i]; if (tk.v !== 'List.Contains') continue; const ci = callInfo(A, i); const a0 = ci && ci.args[0]; if (a0 && a0.length === 1 && isName(A.toks[a0[0]]) && nameOf(A.toks[a0[0]]) === listName) reps.push(A.toks[a0[0]]); }
          if (reps.length){ const ind = lineIndentAt(text, step.s); fix = t => { let o = t; for (const r of reps.slice().sort((a, b) => b.s - a.s)) o = rng(o, r.s, r.e, mQuoteName(newName)); return rng(o, step.s, step.s, mQuoteName(newName) + ' = List.Buffer(' + mQuoteName(listName) + '),' + (text.includes('\r\n') ? '\r\n' : '\n') + ind); }; }
        }
        add(Object.assign(base, { title: 'Список в фильтре вычисляется для каждой строки', impact: ['speed'], safety: fix ? 'safe' : 'manual', fixLabel: 'Добавить шаг с List.Buffer', fix })); break; }
      case 'hardcoded': {
        const cand = candidatesOf(l.query);
        const used = new Set(A.members.map(x => x.name)); const seen = new Map();
        for (const c of cand) if (!seen.has(c.value)) seen.set(c.value, paramWithValue(c.value) || suggestParamName(c.role, c.value, used));
        const picks = [...seen.entries()].map(([value, name]) => ({ value, name }));
        add(Object.assign(base, { title: 'Захардкожены источники (' + picks.length + ')', impact: ['portability', 'clarity'], safety: picks.length ? 'safe' : 'manual', fixLabel: 'Вынести в параметры: ' + picks.map(p => p.name).join(', '),
          fix: picks.length ? t => { const AA = analyzeSection(t, {}); const exist = picks.filter(p => AA.byName.has(p.name)); const fresh = picks.filter(p => !AA.byName.has(p.name));
            let o = t; if (exist.length){ const cc = paramCandidates(AA).filter(c => c.member === l.query && exist.some(p => p.value === c.value)).sort((a, b) => b.s - a.s); for (const c of cc) o = rng(o, c.s, c.e, mQuoteName(exist.find(p => p.value === c.value).name)); }
            if (fresh.length) o = applyParameterize(o, analyzeSection(o, {}), fresh); return o; } : null })); break; }
      case 'orphan': {
        const fix = m ? t => { let e = m.end; const after = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(t.slice(e)); if (after) e += after[0].length; return rng(t, m.start, e, ''); } : null;
        add(Object.assign(base, { title: 'Запрос никем не используется и не загружается', impact: ['clarity', 'speed'], safety: fix ? 'check' : 'manual', fixLabel: 'Удалить запрос', fix })); break; }
      case 'web-concat': {
        const call = m.calls.find(c => c.fn === 'Web.Contents' && stepOfToken(m, c.i) === step); const ci = call && callInfo(A, call.i);
        let fix = null;
        if (ci && ci.args.length === 1){ const a0 = ci.args[0]; const t0 = A.toks[a0[0]]; const nx = a0.length > 2 ? A.toks[a0[1]] : null;
          if (t0.t === 'str' && nx && nx.v === '&'){ const url = strValue(t0); const mm = /^(https?:\/\/[^/?#]+)\/?([^?#]*)$/.exec(url);
            if (mm){ const restR = { s: A.toks[a0[2]].s, e: A.toks[a0[a0.length - 1]].e }; const rest = text.slice(restR.s, restR.e); const rel = mm[2];
              const r = ci.argRange(0); fix = t => rng(t, r.s, r.e, mQuoteString(mm[1]) + ', [RelativePath=' + (rel ? mQuoteString(rel) + ' & ' : '') + rest + ']'); } } }
        add(Object.assign(base, { title: 'URL собирается конкатенацией', impact: ['portability'], safety: fix ? 'check' : 'manual', fixLabel: 'Перенести изменяемую часть в RelativePath', fix })); break; }
      case 'fold-move': add(Object.assign(base, { title: 'Фильтры после точки разрыва свёртки', impact: ['speed'], safety: 'manual' })); break;
      case 'folding': add(Object.assign(base, { title: 'Прерывается свёртка запроса', impact: ['speed'], safety: 'manual' })); break;
      case 'firewall': add(Object.assign(base, { title: 'Риск Formula.Firewall', impact: ['reliability'], safety: 'manual' })); break;
      case 'dynamic-source': add(Object.assign(base, { title: 'Динамический источник данных', impact: ['reliability', 'portability'], safety: 'manual' })); break;
      case 'per-row-call': add(Object.assign(base, { title: 'HTTP-запрос на каждую строку', impact: ['speed'], safety: 'manual' })); break;
      case 'multi-eval': add(Object.assign(base, { title: 'Тяжёлый запрос используется многократно', impact: ['speed'], safety: 'manual' })); break;
      case 'hardcoded-types': add(Object.assign(base, { title: 'Хрупкий шаг типов', impact: ['reliability'], safety: 'manual' })); break;
      case 'try-null': add(Object.assign(base, { title: 'Ошибки скрываются через otherwise null', impact: ['reliability'], safety: 'manual' })); break;
      case 'load-errors': add(Object.assign(base, { title: 'Ошибки при последней загрузке', impact: ['reliability'], safety: 'manual' })); break;
      case 'in-not-last': add(Object.assign(base, { title: 'Результат — не последний шаг', impact: ['clarity'], safety: 'manual' })); break;
      case 'repeated-source': break; // заменено собственным правилом shared-source ниже
      default: add(Object.assign(base, { impact: ['clarity'], safety: 'manual' }));
    }
  }
  // --- собственные правила оптимизатора: слияние соседних однотипных шагов
  const MERGE = {
    'Table.SelectRows': (a, b) => { const ca = a.argText(1).trim(), cb = b.argText(1).trim(); if (!/^each\s/.test(ca) || !/^each\s/.test(cb)) return null; return 'each (' + ca.replace(/^each\s+/, '') + ') and (' + cb.replace(/^each\s+/, '') + ')'; },
    'Table.RemoveColumns': (a, b) => { const la = listItems(a.argText(1)), lb = listItems(b.argText(1)); return la != null && lb != null ? '{' + la + ', ' + lb + '}' : null; },
    'Table.TransformColumnTypes': (a, b) => { const la = listItems(a.argText(1)), lb = listItems(b.argText(1)); if (la == null || lb == null) return null; const ka = pairFirstStrings(la), kb = pairFirstStrings(lb); if (ka.some(x => kb.includes(x))) return null; return '{' + la + ', ' + lb + '}'; },
    'Table.RenameColumns': (a, b) => { const la = listItems(a.argText(1)), lb = listItems(b.argText(1)); if (la == null || lb == null) return null; const newA = pairSecondStrings(la), oldA = pairFirstStrings(la), oldB = pairFirstStrings(lb); if (oldB.some(x => newA.includes(x) || oldA.includes(x))) return null; return '{' + la + ', ' + lb + '}'; }
  };
  for (const m of A.members){
    if (!m.steps) continue; const steps = m.steps.steps;
    for (let i = 0; i + 1 < steps.length; i++){
      const a = steps[i], b = steps[i + 1];
      for (const fn of Object.keys(MERGE)){
        const ca = stepSingleCall(A, a, fn), cb = stepSingleCall(A, b, fn);
        if (!ca || !cb || ca.args.length !== 2 || cb.args.length !== 2) continue;
        const b0 = cb.args[0]; if (b0.length !== 1 || !isName(A.toks[b0[0]]) || nameOf(A.toks[b0[0]]) !== a.name) continue;
        const usedElsewhere = steps.some(s => s !== b && s.refs.has(a.name)) || m.steps.finalRefs.has(a.name); if (usedElsewhere) continue;
        const merged = MERGE[fn](ca, cb); if (merged == null) continue;
        const newB = fn + '(' + ca.argText(0) + ', ' + merged + ')';
        const short = fn.replace('Table.', '');
        add({ rule: 'merge-' + short, key: a.name, sev: 'tip', query: m.name, step: a.name + ' + ' + b.name, impact: ['speed', 'clarity'], safety: 'safe',
          title: 'Два шага ' + short + ' подряд можно объединить', why: 'Шаги «' + a.name + '» и «' + b.name + '» делают одно и то же действие последовательно. Один шаг читается проще, а при свёртке даёт один оператор вместо двух.',
          how: 'Объединить в «' + b.name + '», шаг «' + a.name + '» удалить.', fixLabel: 'Объединить шаги',
          fix: t => { let o = rng(t, b.exprS, b.exprE, newB); return rng(o, a.s, b.s, ''); } });
        break;
      }
    }
    // Excel.Workbook(File.Contents(...)) без delayTypes
    for (const c of m.calls){
      if (c.fn !== 'Excel.Workbook') continue; const ci = callInfo(A, c.i);
      if (!ci || ci.args.length !== 1) continue; const step = stepOfToken(m, c.i);
      add({ rule: 'excel-delay', key: String(c.i), sev: 'tip', query: m.name, step: step ? step.name : '', impact: ['speed'], safety: 'check',
        title: 'Excel.Workbook без delayTypes', why: 'Без третьего аргумента Power Query определяет типы всех столбцов всех листов при открытии книги — это медленно на больших файлах.',
        how: 'Добавить «, null, true» и задавать типы явно в своих шагах. Проверьте, что следующие шаги не полагаются на автоматические типы.', fixLabel: 'Добавить null, true',
        fix: t => rng(t, A.toks[ci.close].s, A.toks[ci.close].s, ', null, true') });
    }
  }
  // общий источник в нескольких запросах → промежуточный запрос
  const groups = new Map();
  for (const m of A.members){ if (m.isParam) continue; for (const c of m.calls){ if (!EXTERNAL_SOURCES.has(c.fn)) continue; const ci = callInfo(A, c.i); if (!ci) continue; const key = text.slice(ci.s, ci.e).replace(/\s+/g, ' '); if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ m, ci, c }); } }
  for (const [key, occ] of groups){
    const qs = [...new Set(occ.map(o => o.m.name))]; if (qs.length < 2) continue;
    const fn = occ[0].c.fn; const newName = uniqueQueryName(A, 'Источник_' + fn.split('.')[0]);
    add({ rule: 'shared-source', key, sev: 'info', query: qs[0], step: '', impact: ['clarity', 'speed'], safety: 'check',
      title: 'Один и тот же источник в ' + qs.length + ' запросах', why: 'Вызов ' + key.slice(0, 120) + ' повторяется в запросах: ' + qs.join(', ') + '. Подключение в одном месте проще поддерживать, а уровни конфиденциальности задаются один раз.',
      how: 'Создать промежуточный запрос «' + newName + '» и сослаться на него. Проверьте, что не появилась ошибка Formula.Firewall.', fixLabel: 'Создать «' + newName + '»',
      fix: t => { let o = t; for (const x of occ.slice().sort((p, q) => q.ci.s - p.ci.s)) o = rng(o, x.ci.s, x.ci.e, mQuoteName(newName)); const nl = /\r\n/.test(t) ? '\r\n' : '\n'; return o.replace(/\s*$/, '') + nl + nl + 'shared ' + mQuoteName(newName) + ' = ' + text.slice(occ[0].ci.s, occ[0].ci.e) + ';' + nl; } });
  }
  // local — исправление меняет текст только внутри своего запроса (такие можно применять пачкой)
  for (const f of F) f.local = !!f.fix && !NONLOCAL_FIX_RULES.has(f.rule);
  // оценка
  const perRuleQ = new Map(); let pen = 0;
  for (const f of F){ const k = f.rule + '|' + f.query; const used = perRuleQ.get(k) || 0; const w = SEV_W[f.sev] || 1; const cap = w * 2; const take = Math.max(0, Math.min(w, cap - used)); perRuleQ.set(k, used + take); pen += take; }
  const score = Math.max(0, Math.round(100 - pen));
  const breakdown = { bySev: {}, byImpact: {}, bySafety: {}, fixable: F.filter(f => f.fix).length, safeFixable: F.filter(f => f.fix && f.safety === 'safe').length };
  for (const f of F){ breakdown.bySev[f.sev] = (breakdown.bySev[f.sev] || 0) + 1; breakdown.bySafety[f.safety] = (breakdown.bySafety[f.safety] || 0) + 1; for (const i of f.impact || []) breakdown.byImpact[i] = (breakdown.byImpact[i] || 0) + 1; }
  const ord = { err: 0, warn: 1, info: 2, tip: 3 };
  F.sort((a, b) => ord[a.sev] - ord[b.sev] || (a.fix ? 0 : 1) - (b.fix ? 0 : 1) || a.query.localeCompare(b.query));
  return { findings: F, score, breakdown, heat: heatMap(A), srcText: text };
}

/* ---- Карта тяжести: оценка «стоимости» шагов без выполнения ---- */
const HEAVY = { 'Table.NestedJoin': 2.5, 'Table.Join': 2.5, 'Table.FuzzyNestedJoin': 3.5, 'Table.Group': 1.5, 'Table.Sort': 1.5, 'Table.Distinct': 1.5, 'Table.Pivot': 2, 'Table.Unpivot': 1.2, 'Table.UnpivotOtherColumns': 1.2, 'Table.ExpandTableColumn': 1, 'Table.Buffer': 1, 'List.Buffer': 0.5, 'Table.AddColumn': 0.5, 'Table.TransformColumns': 0.5, 'Table.Combine': 1, 'Table.AddIndexColumn': 0.6, 'List.Generate': 1.5, 'List.Accumulate': 1.5, 'Table.FillDown': 0.4 };
function listArgBuffered(A, m, ti){ const ci = callInfo(A, ti); const a0 = ci && ci.args[0]; return !!a0 && a0.length === 1 && isName(A.toks[a0[0]]) && isBufferedList(A, m, nameOf(A.toks[a0[0]])); }
function heatMap(A){
  const out = [];
  for (const m of A.members){
    if (m.isParam) continue;
    const foldable = m.sources.some(s => FOLDABLE_SOURCES.has(s));
    const steps = m.steps ? m.steps.steps : [{ name: '(выражение)', fns: m.calls.map(c => c.fn), tokS: m.tokStart, tokE: m.tokEnd, dead: false }];
    let broken = false; const cells = [];
    for (const s of steps){
      let c = 0.4; const why = [];
      const ext = s.fns.filter(f => EXTERNAL_SOURCES.has(f));
      if (ext.length){ c += FOLDABLE_SOURCES.has(ext[0]) ? 1.5 : 2.5; why.push('чтение источника ' + ext[0]); }
      const txt = A.text.slice(A.toks[s.tokS] ? A.toks[s.tokS].s : 0, A.toks[s.tokE - 1] ? A.toks[s.tokE - 1].e : 0);
      if (foldable && !broken && (s.fns.some(f => FOLD_BREAKERS.has(f)) || (s.fns.includes('Value.NativeQuery') && !/EnableFolding\s*=\s*true/i.test(txt)) || (ext.length && /\[\s*Query\s*=/.test(txt)))){ broken = true; s._brk = true; why.push('здесь прерывается свёртка'); }
      for (const f of s.fns) if (HEAVY[f]){ c += HEAVY[f] * (broken && foldable ? 1.4 : 1); why.push(f); }
      if (broken && foldable && !s._brk){ c += 0.8; why.push('выполняется локально (после разрыва свёртки)'); }
      for (let i = s.tokS; i < s.tokE; i++){ const t = A.toks[i]; if (t.t === 'id' && (t.v === 'Web.Contents' || t.v === 'OData.Feed') && isInsideEach(A.toks, A.st, i)){ c += 4; why.push('HTTP-запрос на каждую строку'); break; } if (t.t === 'id' && (t.v === 'Excel.Workbook' || t.v === 'Csv.Document') && isInsideEach(A.toks, A.st, i)){ c += 2.5; why.push('разбор файла на каждую строку (объединение папки)'); break; } if (t.v === 'List.Contains' && isInsideEach(A.toks, A.st, i) && !s.fns.includes('List.Buffer') && !listArgBuffered(A, m, i)){ c += 1.2; why.push('List.Contains внутри each'); break; } }
      cells.push({ step: s.name, level: Math.min(5, Math.round(c)), cost: +c.toFixed(1), why, brk: !!s._brk, dead: !!s.dead });
      delete s._brk;
    }
    out.push({ query: m.name, cells, total: +cells.reduce((a, x) => a + x.cost, 0).toFixed(1), foldable });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}
