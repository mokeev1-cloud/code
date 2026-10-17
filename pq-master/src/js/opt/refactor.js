/* =====================================================================
   opt/refactor.js — рефакторинг M-кода. Все функции чистые: принимают текст
   Section1.m и возвращают новый текст; при недопустимой операции бросают
   Error с понятным сообщением. Применять через setWork(…, 'refactor', …).
   Зависит от: m/lang.js (lexM, structure, parseSection, isName, nameOf, mQuoteName),
               opt/optimizer.js (lineIndentAt).
   ===================================================================== */
function memberOf(text, name){ const m = parseSection(text).members.find(x => x.name === name); if (!m) throw new Error('Запрос «' + name + '» не найден'); return m; }
function nameTokensIn(text, a, b, name){
  const toks = lexM(text); const st = structure(toks); const out = [];
  for (let i = 0; i < toks.length; i++){ const t = toks[i]; if (t.s < a || t.e > b) continue; if (isSig(t) && isName(t) && !st.fieldTok.has(i) && nameOf(t) === name) out.push(t); }
  return out;
}
function replaceTokens(text, toks, repl){ let o = text; for (const t of toks.slice().sort((x, y) => y.s - x.s)) o = o.slice(0, t.s) + repl + o.slice(t.e); return o; }
function validName(n){ if (!n || !n.trim()) throw new Error('Пустое имя'); if (/[\r\n]/.test(n)) throw new Error('Имя не может содержать перевод строки'); return n.trim(); }

function renameStep(text, member, oldName, newName){
  newName = validName(newName); const m = memberOf(text, member);
  const A = analyzeSection(text, {}); const mm = A.byName.get(member);
  if (!mm.steps || !mm.steps.steps.some(s => s.name === oldName)) throw new Error('Шаг «' + oldName + '» не найден в запросе «' + member + '»');
  if (mm.steps.steps.some(s => s.name === newName)) throw new Error('Шаг «' + newName + '» уже есть');
  const toks = nameTokensIn(text, m.exprStart, m.exprEnd, oldName);
  return replaceTokens(text, toks, mQuoteName(newName));
}
function renameQuery(text, oldName, newName){
  newName = validName(newName);
  const sec = parseSection(text);
  if (!sec.members.some(x => x.name === oldName)) throw new Error('Запрос «' + oldName + '» не найден');
  if (sec.members.some(x => x.name === newName)) throw new Error('Запрос «' + newName + '» уже есть');
  return replaceTokens(text, nameTokensIn(text, 0, text.length, oldName), mQuoteName(newName));
}
function extractSteps(text, member, uptoStep, newQuery){
  newQuery = validName(newQuery);
  const A = analyzeSection(text, {}); const m = A.byName.get(member);
  if (!m || !m.steps) throw new Error('Запрос «' + member + '» не состоит из шагов let…in');
  if (A.byName.has(newQuery)) throw new Error('Запрос «' + newQuery + '» уже есть');
  const steps = m.steps.steps; const k = steps.findIndex(s => s.name === uptoStep);
  if (k < 0) throw new Error('Шаг «' + uptoStep + '» не найден');
  const moved = new Set(steps.slice(0, k).map(s => s.name));
  for (const s of steps.slice(k + 1)) for (const r of s.refs) if (moved.has(r)) throw new Error('Шаг «' + s.name + '» ссылается на «' + r + '», который уйдёт в новый запрос. Выносить можно только цепочку, на которую дальше ссылается лишь последний вынесенный шаг.');
  for (const r of m.steps.finalRefs) if (moved.has(r)) throw new Error('Результат запроса ссылается на выносимый шаг «' + r + '».');
  const nl = /\r\n/.test(text) ? '\r\n' : '\n'; const ind = lineIndentAt(text, steps[0].s) || '    ';
  const body = text.slice(steps[0].s, steps[k].exprE);
  const last = steps[k];
  const newMember = 'shared ' + mQuoteName(newQuery) + ' = let' + nl + ind + body + nl + 'in' + nl + ind + mQuoteName(last.name) + ';';
  let out = text.slice(0, steps[0].s) + mQuoteName(last.name) + ' = ' + mQuoteName(newQuery) + text.slice(steps[k].exprE);
  // новый запрос — перед исходным, чтобы читалось сверху вниз
  const mm = parseSection(out).members.find(x => x.name === member);
  out = out.slice(0, mm.start) + newMember + nl + nl + out.slice(mm.start);
  return out;
}
function toFunction(text, member, selStart, selEnd, param){
  param = validName(param); const m = memberOf(text, member);
  if (selStart < m.exprStart || selEnd > m.exprEnd || selEnd <= selStart) throw new Error('Выделите литерал внутри кода этого запроса');
  const sel = text.slice(selStart, selEnd);
  const tk = lexM(sel).filter(isSig);
  const ty = tk.length === 1 && tk[0].t === 'str' ? 'text' : tk.length === 1 && tk[0].t === 'num' ? 'number' : 'any';
  if (/^\s*\((?:[^()]|\([^()]*\))*\)\s*(as\s+[\w.]+\s*)?=>/.test(text.slice(m.exprStart, m.exprEnd))) throw new Error('Запрос уже является функцией');
  const expr = text.slice(m.exprStart, selStart) + mQuoteName(param) + text.slice(selEnd, m.exprEnd);
  const lead = (/^\s*/.exec(expr) || [''])[0];
  return text.slice(0, m.exprStart) + ' (' + mQuoteName(param) + ' as ' + ty + ') =>' + (lead.includes('\n') ? lead : ' ') + expr.slice(lead.length) + text.slice(m.exprEnd);
}
function duplicateQuery(text, name, newName){
  newName = validName(newName); const m = memberOf(text, name);
  if (parseSection(text).members.some(x => x.name === newName)) throw new Error('Запрос «' + newName + '» уже есть');
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  return text.replace(/\s*$/, '') + nl + nl + 'shared ' + mQuoteName(newName) + ' =' + text.slice(m.exprStart, m.exprEnd) + ';' + nl;
}
function deleteQuery(text, name){
  const m = memberOf(text, name); let e = m.end; const after = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?/.exec(text.slice(e)); if (after) e += after[0].length;
  return text.slice(0, m.start) + text.slice(e);
}
function addQuery(text, name, expr){
  name = validName(name);
  if (parseSection(text).members.some(x => x.name === name)) throw new Error('Запрос «' + name + '» уже есть');
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  expr = safeExprEnd(expr.replace(/\r?\n/g, nl).replace(/;\s*$/, ''), nl);
  return text.replace(/\s*$/, '') + nl + nl + 'shared ' + mQuoteName(name) + ' = ' + expr.replace(/^\s+/, '') + ';' + nl;
}
function replaceMemberExpr(text, name, expr){
  const m = memberOf(text, name); const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  expr = safeExprEnd(expr.replace(/\r?\n/g, nl).replace(/;\s*$/, ''), nl);
  return text.slice(0, m.exprStart) + (/^\s/.test(expr) ? expr : ' ' + expr) + text.slice(m.exprEnd);
}
function freeQueryName(text, base){ const names = new Set(parseSection(text).members.map(m => m.name)); let n = base, k = 2; while (names.has(n)) n = base + ' (' + k++ + ')'; return n; }
