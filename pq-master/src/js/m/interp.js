/* =====================================================================
   m/interp.js — мини-интерпретатор M для песочницы.
   Поддерживается: let/in (ленивые), if, each, функции (x) =>, try/otherwise,
   error, записи, списки (в т. ч. {1..5}), таблицы, доступ [поле], {индекс},
   ?, операторы, #date/#datetime/#duration/#time/#table и ~200 функций
   библиотеки (Text, Number, List, Record, Table, Date, Duration, Logical…).
   Источники данных намеренно недоступны: шаг с источником подменяется
   образцом (mOverride). Это НЕ полноценный движок Power Query: нет свёртки,
   типы проверяются упрощённо, часть функций отсутствует (будет понятная ошибка).
   API: mParse(text) → AST; mEval(text, sectionText?) → значение;
        mRunSteps(sectionText, member, overrides) → результаты по шагам;
        mRender(value) → HTML.
   Зависит от: lexM, isSig, nameOf, M_KEYWORDS, SOURCE_FNS (m/lang.js), M_ENUMS (m/reference.js).
   ===================================================================== */
class MErr extends Error {
  constructor(reason, message, detail){ super(message); this.reason = reason || 'Expression.Error'; this.detail = detail == null ? null : detail; }
  get rec(){ return mkRec(['Reason', 'Message', 'Detail'], [this.reason, this.message, this.detail]); }
}
/** Любое исключение → ошибка M (name — встроенная функция, в которой оно возникло) */
function toMErr(e, name){
  if (e instanceof MErr){ if (name && e.message.startsWith('undefined: ')) e.message = name + e.message.slice(9); return e; }
  const msg = String(e && e.message || e);
  if (e instanceof RangeError && /call stack/i.test(msg)) return new MErr('Expression.Error', 'Слишком глубокая рекурсия (переполнение стека)');
  if (!name) return new MErr('Expression.Error', msg);
  return new MErr('Expression.Error', name + ': ' + (/\b(null|undefined)\b|is not iterable/.test(msg) ? 'аргумент равен null или пропущен, а функция ожидает значение' : 'недопустимое значение аргумента (' + msg + ')'));
}
class Thunk { constructor(f){ this.f = f; this.st = 0; this.v = undefined; this.e = null; } }
function force(x){
  if (!(x instanceof Thunk)) return x;
  if (x.st === 2) return x.v;
  if (x.st === 3) throw x.e;
  if (x.st === 1) throw new MErr('Expression.Error', 'Циклическая ссылка при вычислении');
  x.st = 1;
  try { x.v = x.f(); x.st = 2; return x.v; } catch (e){ x.st = 3; x.e = toMErr(e); throw x.e; }
}
class MRec { constructor(names, vals){ this.names = names; this.vals = vals; } get(n){ const i = this.names.indexOf(n); return i < 0 ? undefined : (this.vals[i] = force(this.vals[i])); } has(n){ return this.names.includes(n); } }
class MTab { constructor(cols, rows){ this.cols = cols; this.rows = rows; } }
class MFn { constructor(arity, call, name){ this.arity = arity; this.call = call; this.name = name || ''; } }
class MDate { constructor(kind, ms, tz){ this.kind = kind; this.ms = ms; this.tz = tz || 0; } }
class MDur { constructor(ms){ this.ms = ms; } }
class MType { constructor(name, nullable, cols){ this.name = name; this.nullable = !!nullable; this.cols = cols || null; } }
const mkRec = (names, vals) => new MRec(names.slice(), vals.slice());
const DAY = 86400000;

/* ---------- Парсер ---------- */
function mParse(text){
  const toks = lexM(text).filter(t => t.t !== 'ws' && t.t !== 'cmt');
  let i = 0;
  const peek = (k) => toks[i + (k || 0)];
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  const isK = (t, v) => t && t.t === 'id' && t.v === v;
  const fail = (msg) => { const t = toks[i]; throw new MErr('Expression.SyntaxError', msg + (t ? ' (около «' + t.v + '», символ ' + t.s + ')' : ' (в конце текста)')); };
  const expectOp = v => { if (!isOp(peek(), v)) fail('Ожидалось «' + v + '»'); i++; };
  const expectK = v => { if (!isK(peek(), v)) fail('Ожидалось «' + v + '»'); i++; };
  const matchClose = (open) => { let d = 0; for (let j = open; j < toks.length; j++){ const t = toks[j]; if (t.t === 'op'){ if ('([{'.includes(t.v)) d++; else if (')]}'.includes(t.v)){ d--; if (d === 0) return j; } } } return -1; };
  const isFuncLit = () => { if (!isOp(peek(), '(')) return false; const c = matchClose(i); if (c < 0) return false; const n = toks[c + 1]; if (isOp(n, '=>')) return true; if (isK(n, 'as')){ let j = c + 2; while (j < toks.length && !isOp(toks[j], '=>') && !isOp(toks[j], ',') && !isOp(toks[j], ')')) j++; return isOp(toks[j], '=>'); } return false; };
  const genName = () => { // обобщённый идентификатор: слова через пробел или #"…"
    const t = peek(); if (t && t.t === 'qid'){ i++; return nameOf(t); }
    const parts = []; while (peek() && (peek().t === 'id' || peek().t === 'num')){ parts.push(peek().v); i++; }
    if (!parts.length) fail('Ожидалось имя'); return parts.join(' ');
  };
  function parseType(){
    let nullable = false; if (isK(peek(), 'nullable')){ nullable = true; i++; }
    const t = peek();
    if (isOp(t, '[')){ const c = matchClose(i); i = c + 1; return new MType('record', nullable); }
    if (isOp(t, '{')){ const c = matchClose(i); i = c + 1; return new MType('list', nullable); }
    if (isK(t, 'table') && isOp(peek(1), '[')){ i++; const o = i; const c = matchClose(i); const cols = []; let d = 0, expect = true, cur = [];
      for (let j = o + 1; j < c; j++){ const x = toks[j]; if (x.t === 'op' && '([{'.includes(x.v)) d++; else if (x.t === 'op' && ')]}'.includes(x.v)) d--; else if (d === 0 && expect && (x.t === 'id' || x.t === 'qid')) cur.push(nameOf(x)); else if (d === 0 && x.t === 'op' && x.v === '='){ cols.push(cur.join(' ')); cur = []; expect = false; } else if (d === 0 && x.t === 'op' && x.v === ','){ expect = true; } }
      i = c + 1; return new MType('table', nullable, cols); }
    if (isK(t, 'function') && isOp(peek(1), '(')){ i++; i = matchClose(i) + 1; if (isK(peek(), 'as')){ i++; parseType(); } return new MType('function', nullable); }
    if (t && t.t === 'id'){ i++; return new MType(t.v.replace(/\.Type$/, '').toLowerCase(), nullable); }
    fail('Ожидался тип');
  }
  function parseExpr(){
    const t = peek(); if (!t) fail('Неожиданный конец выражения');
    if (isK(t, 'let')){ i++; const binds = [];
      for (;;){ const name = genName(); expectOp('='); const e = parseExpr(); binds.push([name, e]); if (isOp(peek(), ',')){ i++; continue; } break; }
      expectK('in'); return { k: 'let', binds, body: parseExpr() }; }
    if (isK(t, 'if')){ i++; const c = parseExpr(); expectK('then'); const a = parseExpr(); expectK('else'); return { k: 'if', c, a, b: parseExpr() }; }
    if (isK(t, 'each')){ i++; return { k: 'fn', params: [{ name: '_', optional: false }], body: parseExpr() }; }
    if (isK(t, 'try')){ i++; const e = parseExpr(); if (isK(peek(), 'otherwise')){ i++; return { k: 'try', e, o: parseExpr() }; } return { k: 'try', e, o: null }; }
    if (isK(t, 'error')){ i++; return { k: 'error', e: parseExpr() }; }
    if (isFuncLit()){ i++; const params = [];
      while (!isOp(peek(), ')')){ let optional = false; if (isK(peek(), 'optional')){ optional = true; i++; } const nt = peek(); if (!nt || !(nt.t === 'id' || nt.t === 'qid')) fail('Ожидалось имя параметра'); i++; if (isK(peek(), 'as')){ i++; parseType(); } params.push({ name: nameOf(nt), optional }); if (isOp(peek(), ',')) i++; }
      i++; if (isK(peek(), 'as')){ i++; parseType(); } expectOp('=>'); return { k: 'fn', params, body: parseExpr() }; }
    return parseBin(0);
  }
  const LEVELS = [['meta'], ['??'], ['or'], ['and'], ['as', 'is'], ['=', '<>'], ['<', '>', '<=', '>='], ['+', '-', '&'], ['*', '/']];
  function opAt(lv){ const t = peek(); if (!t) return null; for (const o of LEVELS[lv]){ if ((t.t === 'op' && t.v === o) || (t.t === 'id' && t.v === o)) return o; } return null; }
  function parseBin(lv){
    if (lv >= LEVELS.length) return parseUnary();
    let l = parseBin(lv + 1);
    for (;;){ const o = opAt(lv); if (!o) return l; i++;
      if (o === 'as' || o === 'is'){ l = { k: o, e: l, ty: parseType() }; continue; }
      const r = (o === 'meta' || o === '??') ? parseBin(lv) : parseBin(lv + 1);
      l = { k: 'bin', o, l, r }; }
  }
  function parseUnary(){
    const t = peek();
    if (isK(t, 'not')){ i++; return { k: 'not', e: parseUnary() }; }
    if (isOp(t, '-')){ i++; return { k: 'neg', e: parseUnary() }; }
    if (isOp(t, '+')){ i++; return parseUnary(); }
    if (isK(t, 'type')){ i++; return { k: 'const', v: parseType() }; }
    return parsePostfix(parsePrimary());
  }
  function parsePrimary(){
    const t = peek(); if (!t) fail('Неожиданный конец выражения');
    if (t.t === 'num'){ i++; return { k: 'const', v: /^0x/i.test(t.v) ? parseInt(t.v, 16) : Number(t.v) }; }
    if (t.t === 'str'){ i++; return { k: 'const', v: unescapeM(t.v.slice(1, -1)) }; }
    if (t.t === 'qid'){ i++; return { k: 'id', n: nameOf(t) }; }
    if (t.t === 'id'){
      if (t.v === 'true' || t.v === 'false'){ i++; return { k: 'const', v: t.v === 'true' }; }
      if (t.v === 'null'){ i++; return { k: 'const', v: null }; }
      if (M_KEYWORDS.has(t.v)) fail('Неожиданное ключевое слово «' + t.v + '»');
      i++; return { k: 'id', n: t.v };
    }
    if (isOp(t, '@')){ i++; const n = peek(); i++; return { k: 'id', n: nameOf(n) }; }
    if (isOp(t, '(')){ i++; const e = parseExpr(); expectOp(')'); return e; }
    if (isOp(t, '{')){ i++; const items = [];
      while (!isOp(peek(), '}')){ const a = parseExpr(); if (isOp(peek(), '..')){ i++; items.push({ k: 'range', a, b: parseExpr() }); } else items.push(a); if (isOp(peek(), ',')) i++; else if (!isOp(peek(), '}')) fail('Ожидалось «,» или «}»'); }
      i++; return { k: 'list', items }; }
    if (isOp(t, '[')){
      const c = matchClose(i); let d = 0, isRec = false;
      for (let j = i + 1; j < c; j++){ const x = toks[j]; if (x.t === 'op'){ if ('([{'.includes(x.v)) d++; else if (')]}'.includes(x.v)) d--; else if (d === 0 && x.v === '='){ isRec = true; break; } } }
      if (isRec || c === i + 1){ i++; const fields = [];
        while (!isOp(peek(), ']')){ const n = genName(); expectOp('='); fields.push([n, parseExpr()]); if (isOp(peek(), ',')) i++; else if (!isOp(peek(), ']')) fail('Ожидалось «,» или «]»'); }
        i++; return { k: 'rec', fields }; }
      return parsePostfixField({ k: 'id', n: '_' });
    }
    fail('Неожиданный символ «' + t.v + '»');
  }
  function parsePostfixField(base){
    i++; // '['
    if (isOp(peek(), '[')){ const names = []; while (isOp(peek(), '[')){ i++; names.push(genName()); expectOp(']'); if (isOp(peek(), ',')) i++; } expectOp(']'); let opt = false; if (isOp(peek(), '?')){ opt = true; i++; } return { k: 'proj', e: base, names, opt }; }
    const n = genName(); expectOp(']'); let opt = false; if (isOp(peek(), '?')){ opt = true; i++; }
    return { k: 'field', e: base, n, opt };
  }
  function parsePostfix(e){
    for (;;){
      const t = peek();
      if (isOp(t, '(')){ i++; const args = []; while (!isOp(peek(), ')')){ args.push(parseExpr()); if (isOp(peek(), ',')) i++; else if (!isOp(peek(), ')')) fail('Ожидалось «,» или «)»'); } i++; e = { k: 'call', f: e, args }; continue; }
      if (isOp(t, '[')){ e = parsePostfixField(e); continue; }
      if (isOp(t, '{')){ i++; const ix = parseExpr(); expectOp('}'); let opt = false; if (isOp(peek(), '?')){ opt = true; i++; } e = { k: 'item', e, ix, opt }; continue; }
      return e;
    }
  }
  const ast = parseExpr();
  if (i < toks.length && !(isOp(toks[i], ';') && i === toks.length - 1)) fail('Лишний текст после выражения');
  return ast;
}
function unescapeM(s){ return s.replace(/""/g, '"').replace(/#\(([^)]*)\)/g, (m, x) => x.split(',').map(c => { c = c.trim().toLowerCase(); if (c === 'cr') return '\r'; if (c === 'lf') return '\n'; if (c === 'tab') return '\t'; if (c === '#') return '#'; if (/^[0-9a-f]{4,8}$/i.test(c)) return String.fromCodePoint(parseInt(c, 16)); return m; }).join('')); }

/* ---------- Значения: сравнение, текст, типы ---------- */
function mTypeName(v){
  if (v === null) return 'null'; if (typeof v === 'boolean') return 'logical'; if (typeof v === 'number') return 'number'; if (typeof v === 'string') return 'text';
  if (Array.isArray(v)) return 'list'; if (v instanceof MRec) return 'record'; if (v instanceof MTab) return 'table'; if (v instanceof MFn) return 'function';
  if (v instanceof MDate) return v.kind; if (v instanceof MDur) return 'duration'; if (v instanceof MType) return 'type'; return 'any';
}
function mEquals(a, b){
  a = force(a); b = force(b);
  if (a === b) return true; if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (a instanceof MDate && b instanceof MDate) return a.kind === b.kind && a.ms === b.ms;
  if (a instanceof MDur && b instanceof MDur) return a.ms === b.ms;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => mEquals(x, b[i]));
  if (a instanceof MRec && b instanceof MRec) return a.names.length === b.names.length && a.names.every(n => b.has(n) && mEquals(a.get(n), b.get(n)));
  if (a instanceof MTab && b instanceof MTab) return a.cols.join('\u0001') === b.cols.join('\u0001') && a.rows.length === b.rows.length && a.rows.every((r, i) => r.every((x, j) => mEquals(x, b.rows[i][j])));
  return false;
}
function mCompare(a, b){
  a = force(a); b = force(b);
  if (a === null && b === null) return 0; if (a === null) return -1; if (b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  if (a instanceof MDate && b instanceof MDate) return a.ms - b.ms;
  if (a instanceof MDur && b instanceof MDur) return a.ms - b.ms;
  throw new MErr('Expression.Error', 'Нельзя сравнить ' + mTypeName(a) + ' и ' + mTypeName(b));
}
const pad2 = n => String(n).padStart(2, '0');
function mToText(v){
  v = force(v);
  if (v === null) return 'null'; if (typeof v === 'string') return v; if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(15));
  if (v instanceof MDate){ const d = new Date(v.ms); const dt = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); const tm = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
    return v.kind === 'date' ? dt : v.kind === 'time' ? tm : v.kind === 'datetimezone' ? dt + ' ' + tm + (v.tz >= 0 ? ' +' : ' -') + pad2(Math.abs(v.tz)) + ':00' : dt + ' ' + tm; }
  if (v instanceof MDur){ const s = Math.abs(v.ms) / 1000; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60; return (v.ms < 0 ? '-' : '') + d + '.' + pad2(h) + ':' + pad2(m) + ':' + pad2(Math.floor(sec)); }
  if (v instanceof MType) return 'type ' + v.name;
  if (Array.isArray(v)) return '{' + v.map(x => mLit(x)).join(', ') + '}';
  if (v instanceof MRec) return '[' + v.names.map(n => n + '=' + mLit(v.get(n))).join(', ') + ']';
  if (v instanceof MTab) return 'Table (' + v.rows.length + '×' + v.cols.length + ')';
  if (v instanceof MFn) return 'Function';
  return String(v);
}
function mLit(v){ v = force(v); return typeof v === 'string' ? '"' + v.replace(/"/g, '""') + '"' : mToText(v); }
function typeIs(v, ty){
  if (!(ty instanceof MType)) return false; const n = ty.name; const tn = mTypeName(v);
  if (v === null) return ty.nullable || n === 'any' || n === 'null' || n === 'nullable';
  if (n === 'any' || n === 'anynonnull') return true;
  if (['int64', 'int32', 'int16', 'int8', 'byte', 'number', 'decimal', 'double', 'single', 'currency', 'percentage'].includes(n)) return tn === 'number';
  return tn === n;
}

/* ---------- Вычисление ---------- */
class Env { constructor(vars, parent){ this.vars = vars; this.parent = parent; }
  lookup(n){ for (let e = this; e; e = e.parent){ if (e.vars.has(n)) return force(e.vars.get(n)); } return lookupGlobal(n); } }
function lookupGlobal(n){
  if (Object.prototype.hasOwnProperty.call(MLIB, n)) return MLIB[n];
  const dot = n.lastIndexOf('.');
  if (dot > 0){ const ns = n.slice(0, dot), m = n.slice(dot + 1);
    if (m === 'Type' && ['Int64','Int32','Int16','Int8','Byte','Currency','Percentage','Decimal','Double','Single','Number','Text','Date','DateTime','Logical'].includes(ns)) return new MType(ns.toLowerCase());
    if (M_ENUMS[ns] && M_ENUMS[ns].includes(m)) return ENUM_VALS[n] != null ? ENUM_VALS[n] : M_ENUMS[ns].indexOf(m); }
  if (SOURCE_FNS[n] || /^(Excel\.Workbook|Csv\.Document|Json\.Document|Xml\.(Tables|Document)|Web\.\w+|File\.\w+|Folder\.\w+|Odbc\.\w+|OleDb\.\w+|SharePoint\.\w+|Sql\.\w+|Lines\.FromBinary|Pdf\.Tables|Access\.Database)$/.test(n))
    return new MFn(-1, () => { throw new MErr('DataSource.Error', n + ': источники данных в песочнице недоступны. Подмените этот шаг образцом данных.'); }, n);
  throw new MErr('Expression.Error', 'Имя «' + n + '» не найдено' + (MSUGGEST(n) ? '. Возможно, ' + MSUGGEST(n) + '?' : '') + '.');
}
const ENUM_VALS = { 'JoinKind.Inner': 0, 'JoinKind.LeftOuter': 1, 'JoinKind.RightOuter': 2, 'JoinKind.FullOuter': 3, 'JoinKind.LeftAnti': 4, 'JoinKind.RightAnti': 5, 'Order.Ascending': 0, 'Order.Descending': 1, 'MissingField.Error': 0, 'MissingField.Ignore': 1, 'MissingField.UseNull': 2, 'Occurrence.First': 0, 'Occurrence.Last': 1, 'Occurrence.All': 2, 'RoundingMode.Up': 0, 'RoundingMode.Down': 1, 'RoundingMode.AwayFromZero': 2, 'RoundingMode.TowardZero': 3, 'RoundingMode.ToEven': 4, 'Day.Sunday': 0, 'Day.Monday': 1, 'Day.Tuesday': 2, 'Day.Wednesday': 3, 'Day.Thursday': 4, 'Day.Friday': 5, 'Day.Saturday': 6, 'QuoteStyle.None': 0, 'QuoteStyle.Csv': 1, 'ExtraValues.List': 0, 'ExtraValues.Error': 1, 'ExtraValues.Ignore': 2 };
function MSUGGEST(n){ const all = Object.keys(MLIB); const l = n.toLowerCase(); return all.find(x => x.toLowerCase() === l) || ''; }
function mkFn(params, body, env){
  return new MFn(params.length, (args) => {
    const vars = new Map();
    params.forEach((p, k) => { if (k >= args.length && !p.optional) throw new MErr('Expression.Error', 'Не передан обязательный аргумент «' + p.name + '»'); vars.set(p.name, k < args.length ? args[k] : null); });
    return evalNode(body, new Env(vars, env));
  });
}
function callFn(f, args){
  f = force(f);
  if (!(f instanceof MFn)) throw new MErr('Expression.Error', 'Значение не является функцией: ' + mToText(f).slice(0, 60));
  return f.call(args.map(force));
}
function evalNode(n, env){
  switch (n.k){
    case 'const': return n.v;
    case 'id': return env.lookup(n.n);
    case 'let': { const vars = new Map(); const e2 = new Env(vars, env); for (const [nm, ex] of n.binds) vars.set(nm, new Thunk(() => evalNode(ex, e2))); return evalNode(n.body, e2); }
    case 'if': { const c = evalNode(n.c, env); if (typeof c !== 'boolean') throw new MErr('Expression.Error', 'Условие if должно быть logical, получено ' + mTypeName(c)); return c ? evalNode(n.a, env) : evalNode(n.b, env); }
    case 'fn': return mkFn(n.params, n.body, env);
    case 'try': try { const v = force(evalNode(n.e, env)); return n.o ? v : mkRec(['HasError', 'Value'], [false, v]); }
      catch (e){ const er = e instanceof MErr ? e : new MErr('Expression.Error', String(e.message || e)); return n.o ? evalNode(n.o, env) : mkRec(['HasError', 'Error'], [true, er.rec]); }
    case 'error': { const v = evalNode(n.e, env); if (v instanceof MRec) throw new MErr(v.get('Reason') || 'Expression.Error', v.has('Message') ? v.get('Message') : '', v.has('Detail') ? v.get('Detail') : null); throw new MErr('Expression.Error', mToText(v)); }
    case 'not': { const v = evalNode(n.e, env); if (v === null) return null; if (typeof v !== 'boolean') throw new MErr('Expression.Error', 'not ожидает logical'); return !v; }
    case 'neg': { const v = evalNode(n.e, env); if (v === null) return null; if (typeof v === 'number') return -v; if (v instanceof MDur) return new MDur(-v.ms); throw new MErr('Expression.Error', 'Нельзя применить «-» к ' + mTypeName(v)); }
    case 'as': { const v = evalNode(n.e, env); if (!typeIs(v, n.ty)) throw new MErr('Expression.Error', 'Значение типа ' + mTypeName(v) + ' не является ' + n.ty.name); return v; }
    case 'is': return typeIs(evalNode(n.e, env), n.ty);
    case 'bin': return evalBin(n, env);
    case 'list': { const out = []; for (const it of n.items){ if (it.k === 'range'){ const a = evalNode(it.a, env), b = evalNode(it.b, env);
        if (typeof a === 'number' && typeof b === 'number'){ if (b - a > 1e6) throw new MErr('Expression.Error', 'Слишком большой диапазон'); for (let x = a; x <= b; x++) out.push(x); }
        else if (typeof a === 'string' && typeof b === 'string'){ for (let c = a.codePointAt(0); c <= b.codePointAt(0); c++) out.push(String.fromCodePoint(c)); }
        else throw new MErr('Expression.Error', 'Диапазон .. поддерживается для чисел и символов'); } else out.push(evalNode(it, env)); } return out; }
    case 'rec': { const names = [], vals = []; const vars = new Map(); const e2 = new Env(vars, env);
      for (const [nm, ex] of n.fields){ if (names.includes(nm)) throw new MErr('Expression.Error', 'Повтор поля «' + nm + '»'); const th = new Thunk(() => evalNode(ex, e2)); names.push(nm); vals.push(th); vars.set(nm, th); } return new MRec(names, vals); }
    case 'field': { const v = force(evalNode(n.e, env)); return fieldOf(v, n.n, n.opt); }
    case 'proj': { const v = force(evalNode(n.e, env));
      if (v instanceof MRec) return mkRec(n.names.filter(x => !n.opt || v.has(x)), n.names.filter(x => !n.opt || v.has(x)).map(x => fieldOf(v, x, n.opt)));
      if (v instanceof MTab) return selectCols(v, n.names, n.opt ? 1 : 0);
      throw new MErr('Expression.Error', 'Проекция [[…]] применима к записи или таблице'); }
    case 'item': { const v = force(evalNode(n.e, env)); const ix = force(evalNode(n.ix, env));
      if (Array.isArray(v)){ if (typeof ix !== 'number') throw new MErr('Expression.Error', 'Индекс списка должен быть числом'); if (ix < 0 || ix >= v.length){ if (n.opt) return null; throw new MErr('Expression.Error', 'В перечислении недостаточно элементов: индекс ' + ix + ', элементов ' + v.length); } return force(v[ix]); }
      if (v instanceof MTab){
        if (typeof ix === 'number'){ if (ix < 0 || ix >= v.rows.length){ if (n.opt) return null; throw new MErr('Expression.Error', 'В таблице нет строки ' + ix); } return rowRec(v, ix); }
        if (ix instanceof MRec){ const hits = []; v.rows.forEach((r, ri) => { if (ix.names.every(k => { const ci = v.cols.indexOf(k); return ci >= 0 && mEquals(r[ci], ix.get(k)); })) hits.push(ri); });
          if (hits.length === 1) return rowRec(v, hits[0]); if (n.opt && !hits.length) return null;
          throw new MErr('Expression.Error', hits.length ? 'Ключ совпал с несколькими строками таблицы' : 'Ключ не совпал ни с одной строкой таблицы'); } }
      throw new MErr('Expression.Error', 'Доступ {…} применим к списку или таблице, а не к ' + mTypeName(v)); }
    case 'call': { const f = evalNode(n.f, env); return callFn(f, n.args.map(a => evalNode(a, env))); }
  }
  throw new MErr('Expression.Error', 'Неизвестный узел ' + n.k);
}
function fieldOf(v, name, opt){
  if (v instanceof MRec){ if (!v.has(name)){ if (opt) return null; throw new MErr('Expression.Error', 'Поле «' + name + '» записи не найдено. Есть: ' + v.names.slice(0, 12).join(', ')); } return v.get(name); }
  if (v instanceof MTab){ const ci = v.cols.indexOf(name); if (ci < 0){ if (opt) return null; throw new MErr('Expression.Error', 'Столбец «' + name + '» таблицы не найден. Есть: ' + v.cols.slice(0, 12).join(', ')); } return v.rows.map(r => force(r[ci])); }
  if (v === null && opt) return null;
  throw new MErr('Expression.Error', 'Нельзя получить поле «' + name + '» у значения типа ' + mTypeName(v));
}
function evalBin(n, env){
  const o = n.o;
  if (o === 'and'){ const a = evalNode(n.l, env); if (a === false) return false; const b = evalNode(n.r, env); if (a === null || b === null) return a === null && b === false ? false : null; return a && b; }
  if (o === 'or'){ const a = evalNode(n.l, env); if (a === true) return true; const b = evalNode(n.r, env); if (a === null || b === null) return a === null && b === true ? true : null; return a || b; }
  if (o === '??'){ const a = evalNode(n.l, env); return a === null ? evalNode(n.r, env) : a; }
  if (o === 'meta') return evalNode(n.l, env);
  const a = force(evalNode(n.l, env)), b = force(evalNode(n.r, env));
  if (o === '=') return mEquals(a, b);
  if (o === '<>') return !mEquals(a, b);
  if (a === null || b === null) return null;
  if (o === '<' || o === '>' || o === '<=' || o === '>='){ const c = mCompare(a, b); return o === '<' ? c < 0 : o === '>' ? c > 0 : o === '<=' ? c <= 0 : c >= 0; }
  if (o === '&'){
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    if (a instanceof MRec && b instanceof MRec){ const names = a.names.slice(), vals = a.names.map(x => a.get(x)); b.names.forEach(x => { const k = names.indexOf(x); if (k >= 0) vals[k] = b.get(x); else { names.push(x); vals.push(b.get(x)); } }); return new MRec(names, vals); }
    if (a instanceof MTab && b instanceof MTab) return tableCombine([a, b]);
    if (a instanceof MDate && b instanceof MDate && a.kind === 'date' && b.kind === 'time') return new MDate('datetime', a.ms + b.ms);
    throw new MErr('Expression.Error', 'Оператор & нельзя применить к ' + mTypeName(a) + ' и ' + mTypeName(b) + (typeof a === 'string' || typeof b === 'string' ? '. Преобразуйте значение через Text.From()' : ''));
  }
  if (typeof a === 'number' && typeof b === 'number'){ if (o === '+') return a + b; if (o === '-') return a - b; if (o === '*') return a * b; if (o === '/') return a / b; }
  if (a instanceof MDate && b instanceof MDur){ if (o === '+') return new MDate(a.kind, a.ms + b.ms, a.tz); if (o === '-') return new MDate(a.kind, a.ms - b.ms, a.tz); }
  if (a instanceof MDur && b instanceof MDate && o === '+') return new MDate(b.kind, b.ms + a.ms, b.tz);
  if (a instanceof MDate && b instanceof MDate && o === '-') return new MDur(a.ms - b.ms);
  if (a instanceof MDur && b instanceof MDur){ if (o === '+') return new MDur(a.ms + b.ms); if (o === '-') return new MDur(a.ms - b.ms); }
  if (a instanceof MDur && typeof b === 'number'){ if (o === '*') return new MDur(a.ms * b); if (o === '/') return new MDur(a.ms / b); }
  throw new MErr('Expression.Error', 'Оператор ' + o + ' нельзя применить к ' + mTypeName(a) + ' и ' + mTypeName(b) + (typeof a === 'string' || typeof b === 'string' ? '. Для склейки текста используйте &, для чисел — Number.From()' : ''));
}

/* ---------- Таблицы ---------- */
function rowRec(t, i){ return new MRec(t.cols.slice(), t.rows[i].slice()); }
function tableFromRecords(recs, cols){
  recs = recs.map(force); cols = cols || [...new Set(recs.flatMap(r => r.names))];
  return new MTab(cols, recs.map(r => cols.map(c => r.has(c) ? r.get(c) : null)));
}
function colIdx(t, c, missing){ const i = t.cols.indexOf(c); if (i < 0 && !missing) throw new MErr('Expression.Error', 'Столбец «' + c + '» таблицы не найден. Есть: ' + t.cols.slice(0, 12).join(', ')); return i; }
function selectCols(t, cols, missing){ cols = [].concat(cols); const keep = cols.filter(c => t.cols.includes(c) || missing === 2); if (!missing) cols.forEach(c => colIdx(t, c)); return new MTab(keep, t.rows.map(r => keep.map(c => { const i = t.cols.indexOf(c); return i < 0 ? null : r[i]; }))); }
function tableCombine(ts){ const cols = [...new Set(ts.flatMap(t => t.cols))]; return new MTab(cols, ts.flatMap(t => t.rows.map(r => cols.map(c => { const i = t.cols.indexOf(c); return i < 0 ? null : r[i]; })))); }
function critKey(t, crit){
  // comparisonCriteria: "Кол", {"Кол", Order.Descending}, {{...}, {...}}, функция-ключ
  crit = force(crit);
  if (typeof crit === 'string') return [{ ci: colIdx(t, crit), desc: false }];
  if (crit instanceof MFn) return [{ fn: crit, desc: false }];
  if (Array.isArray(crit)){
    if (crit.length === 2 && typeof crit[0] === 'string' && typeof crit[1] === 'number') return [{ ci: colIdx(t, crit[0]), desc: crit[1] === 1 }];
    return crit.flatMap(c => critKey(t, c));
  }
  throw new MErr('Expression.Error', 'Неподдерживаемый критерий сортировки');
}
function sortRows(t, crit){
  const keys = critKey(t, crit);
  const idx = t.rows.map((_, i) => i);
  idx.sort((x, y) => { for (const k of keys){ const a = k.fn ? callFn(k.fn, [rowRec(t, x)]) : t.rows[x][k.ci], b = k.fn ? callFn(k.fn, [rowRec(t, y)]) : t.rows[y][k.ci]; const c = mCompare(a, b); if (c) return k.desc ? -c : c; } return x - y; });
  return new MTab(t.cols.slice(), idx.map(i => t.rows[i]));
}
function countOrCond(list, arg, fromEnd){
  arg = force(arg);
  if (typeof arg === 'number') return fromEnd ? list.slice(Math.max(0, list.length - arg)) : list.slice(0, arg);
  if (arg instanceof MFn){ const out = []; const src = fromEnd ? list.slice().reverse() : list; for (const x of src){ if (!callFn(arg, [x])) break; out.push(x); } return fromEnd ? out.reverse() : out; }
  return list;
}

/* ---------- Даты ---------- */
const mkDate = (y, m, d) => new MDate('date', Date.UTC(y, m - 1, d));
const dParts = v => { const d = new Date(v.ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000, dow: d.getUTCDay() }; };
function needDate(v, fn){ v = force(v); if (v === null) return null; if (!(v instanceof MDate)) throw new MErr('Expression.Error', fn + ': ожидалась дата, получено ' + mTypeName(v)); return v; }
function addMonths(v, n){ const p = dParts(v); const t = new Date(v.ms); const target = new Date(Date.UTC(p.y, p.m - 1 + n, 1, p.h, p.mi, Math.floor(p.s))); const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); target.setUTCDate(Math.min(p.d, dim)); void t; return new MDate(v.kind, target.getTime(), v.tz); }
function parseDateText(s, culture){
  s = String(s).trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/.exec(s))) return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), time: !!m[4] };
  if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))){
    const us = /^en-US$/i.test(culture || ''); const a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    return { y, mo: us ? a : b, d: us ? b : a, h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), time: !!m[4] };
  }
  throw new MErr('DataFormat.Error', 'Не удалось преобразовать в дату: «' + s + '»');
}
function numFromText(s, culture){
  s = String(s).trim().replace(/[\s ]/g, '');
  const ru = !culture || /^(ru|de|fr|uk|kk|be|es|it|pt|pl|cs)/i.test(culture);
  if (ru) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  if (/%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  const n = Number(s); if (s === '' || !isFinite(n)) throw new MErr('DataFormat.Error', 'Не удалось преобразовать в число: «' + s + '»'); return n;
}
function fmtNumber(n, fmt, culture){
  if (fmt == null) return mToText(n);
  const m = /^([NnFfPpDd])(\d*)$/.exec(fmt); const ru = !culture || /^ru/i.test(culture);
  if (m){ const k = m[1].toUpperCase(); const dg = m[2] === '' ? (k === 'D' ? 0 : 2) : +m[2]; let v = k === 'P' ? n * 100 : n;
    let s = k === 'D' ? String(Math.round(v)).padStart(dg, '0') : v.toFixed(dg);
    if (k === 'N' || k === 'P'){ const [ip, fp] = s.split('.'); s = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ru ? ' ' : ',') + (fp ? (ru ? ',' : '.') + fp : ''); }
    else if (ru) s = s.replace('.', ',');
    return k === 'P' ? s + ' %' : s; }
  return mToText(n);
}
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtDate(v, fmt, culture){
  if (!fmt) return mToText(v); const p = dParts(v); const en = /^en/i.test(culture || '');
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|mm|ss/g, t => ({ yyyy: p.y, yy: String(p.y).slice(-2), MMMM: (en ? MONTHS_EN : MONTHS_RU)[p.m - 1], MMM: (en ? MONTHS_EN : MONTHS_RU)[p.m - 1].slice(0, 3), MM: pad2(p.m), M: p.m, dddd: (en ? DOW_EN : DOW_RU)[p.dow], ddd: (en ? DOW_EN : DOW_RU)[p.dow].slice(0, 3), dd: pad2(p.d), d: p.d, HH: pad2(p.h), H: p.h, mm: pad2(p.mi), ss: pad2(Math.floor(p.s)) })[t]);
}
const optCulture = o => { o = force(o); return o instanceof MRec ? (o.has('Culture') ? o.get('Culture') : null) : o; };
const optFormat = o => { o = force(o); return o instanceof MRec ? (o.has('Format') ? o.get('Format') : null) : (typeof o === 'string' && !/^[a-z]{2}-[A-Z]{2}$/.test(o) ? o : null); };
const nn = f => (...a) => (force(a[0]) === null ? null : f(...a));
const txt = (v, fn) => { v = force(v); if (v === null) return null; if (typeof v !== 'string') throw new MErr('Expression.Error', fn + ': ожидался text, получено ' + mTypeName(v) + ' (' + mToText(v).slice(0, 30) + '). Используйте Text.From()'); return v; };
const num = (v, fn) => { v = force(v); if (typeof v !== 'number') throw new MErr('Expression.Error', fn + ': ожидалось число, получено ' + mTypeName(v)); return v; };
const lst = (v, fn) => { v = force(v); if (!Array.isArray(v)) throw new MErr('Expression.Error', fn + ': ожидался list, получено ' + mTypeName(v)); return v.map(force); };
const tab = (v, fn) => { v = force(v); if (!(v instanceof MTab)) throw new MErr('Expression.Error', fn + ': ожидалась table, получено ' + mTypeName(v)); return v; };
const rec = (v, fn) => { v = force(v); if (!(v instanceof MRec)) throw new MErr('Expression.Error', fn + ': ожидалась record, получено ' + mTypeName(v)); return v; };
const cmpOpt = c => { c = force(c); return c instanceof MFn && c.name === 'Comparer.OrdinalIgnoreCase' || (c instanceof MFn && /IgnoreCase/.test(c.name)); };
const lower = (s, ci) => ci ? s.toLowerCase() : s;
const roundHalfEven = (x, d) => { const f = Math.pow(10, d || 0); const v = x * f; const r = Math.round(v); const diff = Math.abs(v % 1); return (diff === 0.5 ? (r % 2 === 0 ? r : r - 1) : r) / f; };
const listStats = (l, fn) => { const v = lst(l, fn).filter(x => x !== null); return v; };
function colNamesOf(t, spec){ spec = force(spec); return typeof spec === 'string' ? [spec] : lst(spec, 'columns'); }

/* ---------- Библиотека ---------- */
const F = (name, arity, f) => new MFn(arity, args => f(...args), name);
const MLIB = {};
/** Встроенная функция. Внутренняя ошибка JS (null там, где нужен текст, недопустимое число…) становится
    понятной ошибкой M с именем функции; сообщения проверок типов без имени получают его здесь */
const def = (name, f, arity) => { MLIB[name] = F(name, arity == null ? f.length : arity, (...a) => { try { return f(...a); } catch (e){ throw toMErr(e, name); } }); };
// --- конструкторы
def('#date', (y, m, d) => mkDate(num(y), num(m), num(d)));
def('#datetime', (y, m, d, h, mi, s) => new MDate('datetime', Date.UTC(num(y), num(m) - 1, num(d), num(h), num(mi), 0) + num(s) * 1000));
def('#datetimezone', (y, m, d, h, mi, s, th, tm) => new MDate('datetimezone', Date.UTC(num(y), num(m) - 1, num(d), num(h), num(mi), 0) + num(s) * 1000, num(th)));
def('#time', (h, mi, s) => new MDate('time', (num(h) * 3600 + num(mi) * 60 + num(s)) * 1000));
def('#duration', (d, h, mi, s) => new MDur(((num(d) * 24 + num(h)) * 60 + num(mi)) * 60000 + num(s) * 1000));
def('#table', (cols, rows) => { cols = force(cols); rows = lst(rows, '#table').map(r => lst(r, '#table')); const names = cols instanceof MType ? (cols.cols || []) : typeof cols === 'number' ? Array.from({ length: cols }, (_, i) => 'Column' + (i + 1)) : lst(cols, '#table').map(String); rows.forEach(r => { if (r.length !== names.length) throw new MErr('Expression.Error', '#table: в строке ' + r.length + ' значений, а столбцов ' + names.length); }); return new MTab(names, rows); });
// --- Text
def('Text.From', (v, c) => { v = force(v); if (v === null) return null; const t = mToText(v); return typeof v === 'number' && force(c) && /^(ru|de|fr|uk|kk|be|es|it|pt|pl|cs)/i.test(force(c)) ? t.replace('.', ',') : t; });
def('Text.Length', nn(t => txt(t, 'Text.Length').length));
def('Text.Upper', nn(t => txt(t, 'Text.Upper').toUpperCase()));
def('Text.Lower', nn(t => txt(t, 'Text.Lower').toLowerCase()));
def('Text.Proper', nn(t => txt(t, 'Text.Proper').toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())));
def('Text.Trim', nn((t, ch) => { t = txt(t, 'Text.Trim'); ch = force(ch); if (ch == null) return t.trim(); const set = [].concat(ch); let a = 0, b = t.length; while (a < b && set.includes(t[a])) a++; while (b > a && set.includes(t[b - 1])) b--; return t.slice(a, b); }));
def('Text.TrimStart', nn(t => txt(t, 'Text.TrimStart').replace(/^\s+/, '')));
def('Text.TrimEnd', nn(t => txt(t, 'Text.TrimEnd').replace(/\s+$/, '')));
def('Text.Clean', nn(t => txt(t, 'Text.Clean').replace(/[\u0000-\u001F\u007F]/g, '')));
def('Text.Start', nn((t, n) => txt(t, 'Text.Start').slice(0, num(n))));
def('Text.End', nn((t, n) => { t = txt(t, 'Text.End'); return t.slice(Math.max(0, t.length - num(n))); }));
def('Text.Middle', nn((t, s, n) => { t = txt(t, 'Text.Middle'); s = num(s); n = force(n); if (s > t.length) throw new MErr('Expression.Error', 'Text.Middle: начало за пределами текста'); return n == null ? t.slice(s) : t.substr(s, n); }));
def('Text.Range', nn((t, s, n) => { t = txt(t, 'Text.Range'); s = num(s); n = force(n); if (s > t.length || (n != null && s + n > t.length)) throw new MErr('Expression.Error', 'Text.Range: диапазон за пределами текста'); return n == null ? t.slice(s) : t.substr(s, n); }));
def('Text.At', nn((t, i) => { t = txt(t, 'Text.At'); i = num(i); if (i >= t.length) throw new MErr('Expression.Error', 'Text.At: индекс за пределами'); return t[i]; }));
def('Text.Contains', nn((t, s, c) => lower(txt(t, 'Text.Contains'), cmpOpt(c)).includes(lower(txt(s, 'Text.Contains'), cmpOpt(c)))));
def('Text.StartsWith', nn((t, s, c) => lower(txt(t, 'Text.StartsWith'), cmpOpt(c)).startsWith(lower(txt(s, 'Text.StartsWith'), cmpOpt(c)))));
def('Text.EndsWith', nn((t, s, c) => lower(txt(t, 'Text.EndsWith'), cmpOpt(c)).endsWith(lower(txt(s, 'Text.EndsWith'), cmpOpt(c)))));
def('Text.PositionOf', (t, s, occ, c) => { t = lower(txt(t, 'Text.PositionOf'), cmpOpt(c)); s = lower(txt(s, 'Text.PositionOf'), cmpOpt(c)); occ = force(occ); if (occ === 1) return t.lastIndexOf(s); if (occ === 2){ const r = []; let p = t.indexOf(s); while (p >= 0){ r.push(p); p = t.indexOf(s, p + 1); } return r; } return t.indexOf(s); });
def('Text.Replace', nn((t, a, b) => txt(t, 'Text.Replace').split(txt(a, 'Text.Replace')).join(txt(b, 'Text.Replace'))));
def('Text.Remove', nn((t, ch) => { t = txt(t, 'Text.Remove'); const set = [].concat(force(ch)).map(force); return [...t].filter(c => !set.includes(c)).join(''); }));
def('Text.Select', nn((t, ch) => { t = txt(t, 'Text.Select'); const set = [].concat(force(ch)).map(force); return [...t].filter(c => set.includes(c)).join(''); }));
def('Text.Insert', nn((t, o, s) => { t = txt(t, 'Text.Insert'); return t.slice(0, num(o)) + txt(s) + t.slice(num(o)); }));
def('Text.Split', (t, sep) => txt(t, 'Text.Split').split(txt(sep, 'Text.Split')));
def('Text.SplitAny', (t, seps) => { t = txt(t, 'Text.SplitAny'); const s = [...txt(seps)]; const out = []; let cur = ''; for (const c of t){ if (s.includes(c)){ out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; });
def('Text.Combine', (l, sep) => lst(l, 'Text.Combine').filter(x => x !== null).map(x => txt(x, 'Text.Combine')).join(force(sep) == null ? '' : txt(sep)));
def('Text.PadStart', nn((t, n, c) => txt(t, 'Text.PadStart').padStart(num(n), force(c) == null ? ' ' : force(c))));
def('Text.PadEnd', nn((t, n, c) => txt(t, 'Text.PadEnd').padEnd(num(n), force(c) == null ? ' ' : force(c))));
def('Text.Repeat', nn((t, n) => txt(t, 'Text.Repeat').repeat(num(n))));
def('Text.Reverse', nn(t => [...txt(t, 'Text.Reverse')].reverse().join('')));
def('Text.ToList', t => [...txt(t, 'Text.ToList')]);
def('Text.Format', (f, args) => { f = txt(f, 'Text.Format'); args = force(args); return f.replace(/#\{(\d+)\}|#\[([^\]]+)\]/g, (m, i, k) => mToText(i != null ? force(args[+i]) : args.get(k))); });
def('Text.BeforeDelimiter', nn((t, d, ix) => { t = txt(t); d = txt(d); ix = force(ix) || 0; let p = -1; for (let k = 0; k <= ix; k++){ p = t.indexOf(d, p + 1); if (p < 0) return t; } return t.slice(0, p); }));
def('Text.AfterDelimiter', nn((t, d, ix) => { t = txt(t); d = txt(d); ix = force(ix) || 0; let p = -1; for (let k = 0; k <= ix; k++){ p = t.indexOf(d, p + 1); if (p < 0) return ''; } return t.slice(p + d.length); }));
def('Text.BetweenDelimiters', nn((t, a, b) => { t = txt(t); a = txt(a); b = txt(b); const p = t.indexOf(a); if (p < 0) return ''; const q = t.indexOf(b, p + a.length); return q < 0 ? t.slice(p + a.length) : t.slice(p + a.length, q); }));
def('Text.NewGuid', () => crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0'));
def('Character.FromNumber', nn(n => String.fromCodePoint(num(n))));
def('Character.ToNumber', nn(c => txt(c).codePointAt(0)));
// --- Number
def('Number.From', (v, c) => { v = force(v); if (v === null) return null; if (typeof v === 'number') return v; if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'string') return numFromText(v, force(c)); if (v instanceof MDate) return v.ms / DAY + 25569; if (v instanceof MDur) return v.ms / DAY; throw new MErr('Expression.Error', 'Number.From: нельзя преобразовать ' + mTypeName(v)); });
def('Number.FromText', nn((t, c) => numFromText(txt(t, 'Number.FromText'), force(c))));
def('Number.ToText', nn((n, f, c) => fmtNumber(num(n), force(f), force(c))));
def('Number.Round', nn((n, d, mode) => { n = num(n); d = force(d) || 0; mode = force(mode); const f = Math.pow(10, d); if (mode === 2) return Math.sign(n) * Math.round(Math.abs(n) * f) / f; if (mode === 0) return Math.ceil(n * f) / f; if (mode === 1) return Math.floor(n * f) / f; if (mode === 3) return Math.trunc(n * f) / f; return roundHalfEven(n, d); }));
def('Number.RoundUp', nn((n, d) => { const f = Math.pow(10, force(d) || 0); return Math.ceil(num(n) * f) / f; }));
def('Number.RoundDown', nn((n, d) => { const f = Math.pow(10, force(d) || 0); return Math.floor(num(n) * f) / f; }));
def('Number.RoundTowardZero', nn((n, d) => { const f = Math.pow(10, force(d) || 0); return Math.trunc(num(n) * f) / f; }));
def('Number.RoundAwayFromZero', nn((n, d) => { const f = Math.pow(10, force(d) || 0); n = num(n); return Math.sign(n) * Math.round(Math.abs(n) * f) / f; }));
def('Number.Abs', nn(n => Math.abs(num(n))));
def('Number.Sign', nn(n => Math.sign(num(n))));
def('Number.Mod', nn((a, b) => { a = num(a); b = num(b); return a - b * Math.trunc(a / b); }));
def('Number.IntegerDivide', nn((a, b) => Math.trunc(num(a) / num(b))));
def('Number.Power', nn((a, b) => Math.pow(num(a), num(b))));
def('Number.Sqrt', nn(a => Math.sqrt(num(a))));
def('Number.Ln', nn(a => Math.log(num(a))));
def('Number.Log10', nn(a => Math.log10(num(a))));
def('Number.Exp', nn(a => Math.exp(num(a))));
def('Number.IsNaN', a => Number.isNaN(num(a)));
def('Number.IsEven', a => num(a) % 2 === 0);
def('Number.IsOdd', a => Math.abs(num(a) % 2) === 1);
def('Number.Random', () => Math.random());
def('Number.RandomBetween', (a, b) => num(a) + Math.random() * (num(b) - num(a)));
def('Int64.From', (v, c) => { const n = MLIB['Number.From'].call([v, c]); return n === null ? null : roundHalfEven(n, 0); }, 1);
MLIB['Decimal.From'] = MLIB['Number.From']; MLIB['Double.From'] = MLIB['Number.From']; def('Currency.From', (v, c) => { const n = MLIB['Number.From'].call([v, c]); return n === null ? null : roundHalfEven(n, 4); }, 1);
def('Percentage.From', (v, c) => { v = force(v); if (typeof v === 'string' && /%\s*$/.test(v)) return numFromText(v.replace('%', ''), force(c)) / 100; return MLIB['Number.From'].call([v, c]); }, 1);
MLIB['Int32.From'] = MLIB['Int64.From'];
// --- Logical
def('Logical.From', v => { v = force(v); if (v === null) return null; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; if (typeof v === 'string'){ if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; } throw new MErr('DataFormat.Error', 'Logical.From: нельзя преобразовать «' + mToText(v) + '»'); });
MLIB['Logical.FromText'] = MLIB['Logical.From'];
def('Logical.ToText', v => force(v) === null ? null : (force(v) ? 'true' : 'false'));
// --- List
def('List.Count', l => lst(l, 'List.Count').length);
def('List.NonNullCount', l => lst(l).filter(x => x !== null).length);
def('List.Sum', l => { const v = listStats(l, 'List.Sum'); return v.length ? v.reduce((a, b) => a + num(b, 'List.Sum'), 0) : null; });
def('List.Product', l => { const v = listStats(l, 'List.Product'); return v.length ? v.reduce((a, b) => a * num(b), 1) : null; });
def('List.Average', l => { const v = listStats(l, 'List.Average'); return v.length ? v.reduce((a, b) => a + num(b), 0) / v.length : null; });
def('List.Min', (l, d) => { const v = listStats(l, 'List.Min'); return v.length ? v.reduce((a, b) => mCompare(a, b) <= 0 ? a : b) : (force(d) === undefined ? null : force(d)); });
def('List.Max', (l, d) => { const v = listStats(l, 'List.Max'); return v.length ? v.reduce((a, b) => mCompare(a, b) >= 0 ? a : b) : (force(d) === undefined ? null : force(d)); });
def('List.Median', l => { const v = listStats(l).sort(mCompare); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; });
def('List.Mode', l => { const v = lst(l); const c = new Map(); let best = null, bc = 0; for (const x of v){ const k = mLit(x); const n = (c.get(k) || 0) + 1; c.set(k, n); if (n > bc){ bc = n; best = x; } } return best; });
def('List.StandardDeviation', l => { const v = listStats(l).map(x => num(x)); if (v.length < 2) return null; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1)); });
def('List.First', (l, d) => { l = lst(l, 'List.First'); return l.length ? l[0] : (force(d) === undefined ? null : force(d)); });
def('List.Last', (l, d) => { l = lst(l, 'List.Last'); return l.length ? l[l.length - 1] : (force(d) === undefined ? null : force(d)); });
def('List.FirstN', (l, n) => countOrCond(lst(l), n, false));
def('List.LastN', (l, n) => countOrCond(lst(l), n == null ? 1 : n, true));
def('List.Skip', (l, n) => { l = lst(l); n = force(n); if (n == null) n = 1; return typeof n === 'number' ? l.slice(n) : l.slice(countOrCond(l, n, false).length); });
def('List.RemoveFirstN', (l, n) => MLIB['List.Skip'].call([l, n]));
def('List.RemoveLastN', (l, n) => { l = lst(l); n = force(n); if (n == null) n = 1; return typeof n === 'number' ? l.slice(0, Math.max(0, l.length - n)) : l.slice(0, l.length - countOrCond(l, n, true).length); });
def('List.Range', (l, o, c) => { l = lst(l); o = num(o); c = force(c); return c == null ? l.slice(o) : l.slice(o, o + c); });
def('List.Select', (l, f) => lst(l, 'List.Select').filter(x => callFn(f, [x]) === true));
def('List.Transform', (l, f) => lst(l, 'List.Transform').map(x => callFn(f, [x])));
def('List.TransformMany', (l, cf, rf) => lst(l).flatMap(x => lst(callFn(cf, [x])).map(y => callFn(rf, [x, y]))));
def('List.Accumulate', (l, seed, f) => lst(l, 'List.Accumulate').reduce((s, x) => callFn(f, [s, x]), force(seed)));
def('List.Generate', (init, cond, next, sel) => { const out = []; let s = callFn(init, []); let guard = 0; while (callFn(cond, [s]) === true){ out.push(force(sel) == null ? s : callFn(sel, [s])); s = callFn(next, [s]); if (++guard > 100000) throw new MErr('Expression.Error', 'List.Generate: более 100 000 шагов — похоже на бесконечный цикл'); } return out; });
def('List.Distinct', l => { const out = []; for (const x of lst(l, 'List.Distinct')) if (!out.some(y => mEquals(x, y))) out.push(x); return out; });
def('List.Sort', (l, c) => { l = lst(l, 'List.Sort'); c = force(c); const desc = c === 1; const f = c instanceof MFn ? c : null; return l.slice().sort((a, b) => f ? (f.arity === 1 ? mCompare(callFn(f, [a]), callFn(f, [b])) : callFn(f, [a, b])) : (desc ? -mCompare(a, b) : mCompare(a, b))); });
def('List.Reverse', l => lst(l).slice().reverse());
def('List.Contains', (l, v, c) => { const ci = cmpOpt(c); v = force(v); return lst(l, 'List.Contains').some(x => ci && typeof x === 'string' && typeof v === 'string' ? x.toLowerCase() === v.toLowerCase() : mEquals(x, v)); });
def('List.ContainsAny', (l, vs) => { l = lst(l); return lst(vs).some(v => l.some(x => mEquals(x, v))); });
def('List.ContainsAll', (l, vs) => { l = lst(l); return lst(vs).every(v => l.some(x => mEquals(x, v))); });
def('List.PositionOf', (l, v, occ) => { l = lst(l); v = force(v); occ = force(occ); if (occ === 2) return l.map((x, i) => mEquals(x, v) ? i : -1).filter(i => i >= 0); if (occ === 1){ for (let i = l.length - 1; i >= 0; i--) if (mEquals(l[i], v)) return i; return -1; } return l.findIndex(x => mEquals(x, v)); });
def('List.Combine', ls => lst(ls).flatMap(x => lst(x, 'List.Combine')));
def('List.Zip', ls => { ls = lst(ls).map(x => lst(x)); const n = Math.max(0, ...ls.map(x => x.length)); return Array.from({ length: n }, (_, i) => ls.map(x => i < x.length ? x[i] : null)); });
def('List.Numbers', (s, c, inc) => { s = num(s); c = num(c); inc = force(inc) == null ? 1 : num(inc); return Array.from({ length: c }, (_, i) => s + i * inc); });
def('List.Dates', (s, c, step) => { s = needDate(s, 'List.Dates'); step = force(step); return Array.from({ length: num(c) }, (_, i) => new MDate(s.kind, s.ms + i * step.ms)); });
MLIB['List.DateTimes'] = MLIB['List.Dates'];
def('List.Repeat', (l, n) => { l = lst(l); let o = []; for (let i = 0; i < num(n); i++) o = o.concat(l); return o; });
def('List.RemoveNulls', l => lst(l).filter(x => x !== null));
def('List.RemoveItems', (a, b) => { b = lst(b); return lst(a).filter(x => !b.some(y => mEquals(x, y))); });
def('List.InsertRange', (l, i, v) => { l = lst(l); return l.slice(0, num(i)).concat(lst(v), l.slice(num(i))); });
def('List.ReplaceValue', (l, a, b, r) => lst(l).map(x => callFn(r, [x, a, b])));
def('List.Union', ls => { const out = []; for (const l of lst(ls)) for (const x of lst(l)) if (!out.some(y => mEquals(x, y))) out.push(x); return out; });
def('List.Intersect', ls => { ls = lst(ls).map(x => lst(x)); if (!ls.length) return []; return MLIB['List.Distinct'].call([ls[0].filter(x => ls.every(l => l.some(y => mEquals(x, y))))]); });
def('List.Difference', (a, b) => { b = lst(b); return lst(a).filter(x => !b.some(y => mEquals(x, y))); });
def('List.IsEmpty', l => lst(l).length === 0);
def('List.AllTrue', l => lst(l).every(x => x === true));
def('List.AnyTrue', l => lst(l).some(x => x === true));
def('List.MatchesAll', (l, f) => lst(l).every(x => callFn(f, [x]) === true));
def('List.MatchesAny', (l, f) => lst(l).some(x => callFn(f, [x]) === true));
def('List.Buffer', l => lst(l, 'List.Buffer'));
def('List.Split', (l, n) => { l = lst(l); n = num(n); const o = []; for (let i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o; });
def('List.Alternate', (l, c, r, o) => { l = lst(l); c = num(c); r = force(r) == null ? 1 : num(r); o = force(o) || 0; return l.filter((_, i) => { if (i < o) return true; const k = (i - o) % (c + r); return k >= c; }); });
// --- Record
def('Record.Field', (r, f) => { r = rec(r, 'Record.Field'); f = txt(f); if (!r.has(f)) throw new MErr('Expression.Error', 'Поле «' + f + '» записи не найдено'); return r.get(f); });
def('Record.FieldOrDefault', (r, f, d) => { r = force(r); if (r === null) return force(d) === undefined ? null : force(d); r = rec(r); f = txt(f); return r.has(f) ? r.get(f) : (force(d) === undefined ? null : force(d)); });
def('Record.FieldNames', r => rec(r, 'Record.FieldNames').names.slice());
def('Record.FieldValues', r => { r = rec(r, 'Record.FieldValues'); return r.names.map(n => r.get(n)); });
def('Record.FieldCount', r => rec(r).names.length);
def('Record.HasFields', (r, f) => { r = rec(r); return [].concat(force(f)).map(force).every(x => r.has(x)); });
def('Record.AddField', (r, n, v) => { r = rec(r); n = txt(n); if (r.has(n)) throw new MErr('Expression.Error', 'Поле «' + n + '» уже есть'); return new MRec(r.names.concat([n]), r.names.map(x => r.get(x)).concat([force(v)])); });
def('Record.RemoveFields', (r, f, mf) => { r = rec(r); const fs = [].concat(force(f)).map(force); if (!force(mf)) fs.forEach(x => { if (!r.has(x)) throw new MErr('Expression.Error', 'Поле «' + x + '» не найдено'); }); const keep = r.names.filter(n => !fs.includes(n)); return new MRec(keep, keep.map(n => r.get(n))); });
def('Record.SelectFields', (r, f, mf) => { r = rec(r); const fs = [].concat(force(f)).map(force); const keep = fs.filter(x => r.has(x) || force(mf) === 2); if (!force(mf)) fs.forEach(x => { if (!r.has(x)) throw new MErr('Expression.Error', 'Поле «' + x + '» не найдено'); }); return new MRec(keep, keep.map(n => r.has(n) ? r.get(n) : null)); });
def('Record.RenameFields', (r, ren) => { r = rec(r); let pairs = lst(ren); if (pairs.length === 2 && typeof pairs[0] === 'string') pairs = [pairs]; const map = new Map(pairs.map(p => lst(p))); return new MRec(r.names.map(n => map.has(n) ? map.get(n) : n), r.names.map(n => r.get(n))); });
def('Record.TransformFields', (r, ops) => { r = rec(r); let pairs = lst(ops); if (pairs.length === 2 && typeof pairs[0] === 'string') pairs = [pairs]; const m = new Map(pairs.map(p => lst(p))); return new MRec(r.names.slice(), r.names.map(n => m.has(n) ? callFn(m.get(n), [r.get(n)]) : r.get(n))); });
def('Record.Combine', rs => lst(rs).reduce((a, b) => evalBin({ o: '&', l: { k: 'const', v: a }, r: { k: 'const', v: b } }, null), new MRec([], [])));
def('Record.FromList', (vals, names) => { vals = lst(vals); names = force(names); const ns = names instanceof MType ? names.cols : lst(names); return new MRec(ns, vals); });
def('Record.ToList', r => { r = rec(r); return r.names.map(n => r.get(n)); });
def('Record.ToTable', r => { r = rec(r); return new MTab(['Name', 'Value'], r.names.map(n => [n, r.get(n)])); });
def('Record.FromTable', t => { t = tab(t); const ni = colIdx(t, 'Name'), vi = colIdx(t, 'Value'); return new MRec(t.rows.map(r => r[ni]), t.rows.map(r => r[vi])); });
// --- Value / Type / Function / Error
def('Value.Type', v => new MType(mTypeName(force(v))));
def('Value.Is', (v, t) => typeIs(force(v), force(t)));
def('Value.As', (v, t) => { v = force(v); if (!typeIs(v, force(t))) throw new MErr('Expression.Error', 'Value.As: значение не того типа'); return v; });
def('Value.Equals', (a, b) => mEquals(a, b));
def('Value.Compare', (a, b) => Math.sign(mCompare(a, b)));
def('Value.Add', (a, b) => evalBin({ o: '+', l: { k: 'const', v: force(a) }, r: { k: 'const', v: force(b) } }, null));
def('Value.ReplaceType', (v, t) => { v = force(v); t = force(t); if (v instanceof MTab && t instanceof MType && t.cols && t.cols.length === v.cols.length) return new MTab(t.cols.slice(), v.rows); return v; });
def('Value.Metadata', () => new MRec([], []));
def('Value.RemoveMetadata', v => force(v));
def('Function.Invoke', (f, args) => callFn(f, lst(args)));
def('Error.Record', (r, m, d) => mkRec(['Reason', 'Message', 'Detail'], [force(r), force(m) === undefined ? null : force(m), force(d) === undefined ? null : force(d)]));
def('Expression.Constant', v => mLit(v));
def('Expression.Identifier', n => mQuoteName(txt(n)));
def('Comparer.OrdinalIgnoreCase', (a, b) => Math.sign(mCompare(String(force(a)).toLowerCase(), String(force(b)).toLowerCase())), 2);
def('Comparer.Ordinal', (a, b) => Math.sign(mCompare(a, b)), 2);
def('Replacer.ReplaceText', (v, a, b) => { v = force(v); return typeof v === 'string' ? v.split(txt(a)).join(txt(b)) : v; }, 3);
def('Replacer.ReplaceValue', (v, a, b) => mEquals(v, a) ? force(b) : force(v), 3);
def('Splitter.SplitTextByDelimiter', (d) => { d = txt(d); return F('Splitter', 1, t => force(t) === null ? [null] : txt(t).split(d)); });
def('Splitter.SplitTextByAnyDelimiter', (ds) => { ds = lst(ds).map(x => txt(x)); return F('Splitter', 1, t => { t = txt(t); if (t === null) return [null]; const re = new RegExp(ds.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')); return t.split(re); }); });
def('Splitter.SplitTextByPositions', (ps) => { ps = lst(ps); return F('Splitter', 1, t => { t = txt(t); return ps.map((p, i) => t.slice(p, i + 1 < ps.length ? ps[i + 1] : undefined)); }); });
def('Splitter.SplitTextByLengths', (ls) => { ls = lst(ls); return F('Splitter', 1, t => { t = txt(t); let p = 0; return ls.map(n => { const s = t.substr(p, n); p += n; return s; }); }); });
def('Combiner.CombineTextByDelimiter', (d) => { d = txt(d); return F('Combiner', 1, l => lst(l).filter(x => x !== null).map(x => mToText(x)).join(d)); });
// --- Date / DateTime / Duration
def('Date.From', (v, c) => { v = force(v); if (v === null) return null; if (v instanceof MDate){ const p = dParts(v); return mkDate(p.y, p.m, p.d); } if (typeof v === 'number') return new MDate('date', Math.floor(v - 25569) * DAY); if (typeof v === 'string'){ const p = parseDateText(v, force(c)); return mkDate(p.y, p.mo, p.d); } throw new MErr('Expression.Error', 'Date.From: нельзя преобразовать ' + mTypeName(v)); });
def('Date.FromText', (t, o) => { t = txt(t, 'Date.FromText'); if (t === null) return null; const p = parseDateText(t, optCulture(o)); return mkDate(p.y, p.mo, p.d); });
def('DateTime.From', (v, c) => { v = force(v); if (v === null) return null; if (v instanceof MDate) return new MDate('datetime', v.ms); if (typeof v === 'number') return new MDate('datetime', Math.round((v - 25569) * DAY)); const p = parseDateText(txt(v), force(c)); return new MDate('datetime', Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0) + p.s * 1000); });
def('DateTime.FromText', (t, o) => MLIB['DateTime.From'].call([t, optCulture(o)]), 2);
def('Date.ToText', (d, o, c) => { d = needDate(d, 'Date.ToText'); if (d === null) return null; return fmtDate(d, optFormat(o) || 'yyyy-MM-dd', optCulture(o) || force(c)); });
def('DateTime.ToText', (d, o, c) => { d = needDate(d, 'DateTime.ToText'); if (d === null) return null; return fmtDate(d, optFormat(o) || 'yyyy-MM-dd HH:mm:ss', optCulture(o) || force(c)); });
const dpart = (name, f) => def(name, v => { v = needDate(v, name); return v === null ? null : f(dParts(v), v); });
dpart('Date.Year', p => p.y); dpart('Date.Month', p => p.m); dpart('Date.Day', p => p.d);
dpart('Date.QuarterOfYear', p => Math.ceil(p.m / 3)); dpart('Date.DaysInMonth', p => new Date(Date.UTC(p.y, p.m, 0)).getUTCDate());
dpart('Date.IsLeapYear', p => (p.y % 4 === 0 && p.y % 100 !== 0) || p.y % 400 === 0);
dpart('Date.DayOfYear', (p, v) => Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / DAY) + 1);
dpart('Time.Hour', p => p.h); dpart('Time.Minute', p => p.mi); dpart('Time.Second', p => p.s);
dpart('DateTime.Date', p => mkDate(p.y, p.m, p.d)); dpart('DateTime.Time', (p, v) => new MDate('time', ((v.ms % DAY) + DAY) % DAY));
def('Date.DayOfWeek', (v, f) => { v = needDate(v, 'Date.DayOfWeek'); if (v === null) return null; const fd = force(f) == null ? 0 : force(f); return (dParts(v).dow - fd + 7) % 7; });
def('Date.DayOfWeekName', (v, c) => { v = needDate(v); return v === null ? null : (/^en/i.test(force(c) || '') ? DOW_EN : DOW_RU)[dParts(v).dow]; });
def('Date.MonthName', (v, c) => { v = needDate(v); return v === null ? null : (/^en/i.test(force(c) || '') ? MONTHS_EN : MONTHS_RU)[dParts(v).m - 1]; });
def('Date.WeekOfYear', (v, f) => { v = needDate(v); if (v === null) return null; const p = dParts(v); const fd = force(f) == null ? 0 : force(f); const jan1 = new Date(Date.UTC(p.y, 0, 1)).getUTCDay(); const off = (jan1 - fd + 7) % 7; return Math.floor((MLIB['Date.DayOfYear'].call([v]) - 1 + off) / 7) + 1; });
def('Date.AddDays', (v, n) => { v = needDate(v); return v === null ? null : new MDate(v.kind, v.ms + num(n) * DAY, v.tz); });
def('Date.AddWeeks', (v, n) => { v = needDate(v); return v === null ? null : new MDate(v.kind, v.ms + num(n) * 7 * DAY, v.tz); });
def('Date.AddMonths', (v, n) => { v = needDate(v); return v === null ? null : addMonths(v, num(n)); });
def('Date.AddQuarters', (v, n) => { v = needDate(v); return v === null ? null : addMonths(v, num(n) * 3); });
def('Date.AddYears', (v, n) => { v = needDate(v); return v === null ? null : addMonths(v, num(n) * 12); });
const dstart = (name, f) => def(name, (v, x) => { v = needDate(v, name); if (v === null) return null; const p = dParts(v); const r = f(p, force(x)); return new MDate(v.kind, r, v.tz); });
dstart('Date.StartOfMonth', p => Date.UTC(p.y, p.m - 1, 1)); dstart('Date.EndOfMonth', p => Date.UTC(p.y, p.m, 0));
dstart('Date.StartOfYear', p => Date.UTC(p.y, 0, 1)); dstart('Date.EndOfYear', p => Date.UTC(p.y, 11, 31));
dstart('Date.StartOfQuarter', p => Date.UTC(p.y, Math.floor((p.m - 1) / 3) * 3, 1)); dstart('Date.EndOfQuarter', p => Date.UTC(p.y, Math.floor((p.m - 1) / 3) * 3 + 3, 0));
dstart('Date.StartOfWeek', (p, fd) => Date.UTC(p.y, p.m - 1, p.d) - ((p.dow - (fd == null ? 0 : fd) + 7) % 7) * DAY);
dstart('Date.EndOfWeek', (p, fd) => Date.UTC(p.y, p.m - 1, p.d) + (6 - (p.dow - (fd == null ? 0 : fd) + 7) % 7) * DAY);
dstart('Date.StartOfDay', p => Date.UTC(p.y, p.m - 1, p.d));
def('Date.ToRecord', v => { const p = dParts(needDate(v)); return mkRec(['Year', 'Month', 'Day'], [p.y, p.m, p.d]); });
def('DateTime.LocalNow', () => { const d = new Date(); return new MDate('datetime', Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())); });
MLIB['DateTime.FixedLocalNow'] = MLIB['DateTime.LocalNow'];
def('DateTimeZone.UtcNow', () => new MDate('datetimezone', Date.now(), 0));
def('Duration.From', v => { v = force(v); if (v === null) return null; if (v instanceof MDur) return v; if (typeof v === 'number') return new MDur(v * DAY); throw new MErr('Expression.Error', 'Duration.From: нельзя преобразовать'); });
const dur = (name, f) => def(name, v => { v = force(v); if (v === null) return null; if (!(v instanceof MDur)) throw new MErr('Expression.Error', name + ': ожидалась duration'); return f(v.ms); });
dur('Duration.Days', ms => Math.trunc(ms / DAY)); dur('Duration.Hours', ms => Math.trunc(ms % DAY / 3600000)); dur('Duration.Minutes', ms => Math.trunc(ms % 3600000 / 60000)); dur('Duration.Seconds', ms => ms % 60000 / 1000);
dur('Duration.TotalDays', ms => ms / DAY); dur('Duration.TotalHours', ms => ms / 3600000); dur('Duration.TotalMinutes', ms => ms / 60000); dur('Duration.TotalSeconds', ms => ms / 1000);
// --- Table
def('Table.FromRecords', (rs, cols) => { cols = force(cols); return tableFromRecords(lst(rs, 'Table.FromRecords').map(r => rec(r)), cols == null ? null : (cols instanceof MType ? cols.cols : lst(cols))); });
def('Table.FromRows', (rows, cols) => { rows = lst(rows).map(r => lst(r)); cols = force(cols); const n = rows.length ? rows[0].length : 0; const names = cols == null ? Array.from({ length: n }, (_, i) => 'Column' + (i + 1)) : cols instanceof MType ? cols.cols : lst(cols); return new MTab(names, rows); });
def('Table.FromColumns', (cs, cols) => { cs = lst(cs).map(c => lst(c)); cols = force(cols); const names = cols == null ? cs.map((_, i) => 'Column' + (i + 1)) : lst(cols); const n = Math.max(0, ...cs.map(c => c.length)); return new MTab(names, Array.from({ length: n }, (_, i) => cs.map(c => i < c.length ? c[i] : null))); });
def('Table.FromList', (l, sp, cols) => { l = lst(l); sp = force(sp); const rows = l.map(x => sp ? lst(callFn(sp, [x])) : (Array.isArray(x) ? x : [x])); cols = force(cols); const n = Math.max(1, ...rows.map(r => r.length)); const names = cols == null ? Array.from({ length: n }, (_, i) => 'Column' + (i + 1)) : typeof cols === 'number' ? Array.from({ length: cols }, (_, i) => 'Column' + (i + 1)) : cols instanceof MType ? cols.cols : lst(cols); return new MTab(names, rows.map(r => names.map((_, i) => i < r.length ? r[i] : null))); });
def('Splitter.SplitByNothing', () => F('Splitter', 1, v => [force(v)]), 0);
def('Table.ToRecords', t => { t = tab(t); return t.rows.map((_, i) => rowRec(t, i)); });
def('Table.ToRows', t => tab(t).rows.map(r => r.slice()));
def('Table.ToColumns', t => { t = tab(t); return t.cols.map((_, i) => t.rows.map(r => r[i])); });
def('Table.RowCount', t => tab(t, 'Table.RowCount').rows.length);
def('Table.ColumnCount', t => tab(t).cols.length);
def('Table.ColumnNames', t => tab(t, 'Table.ColumnNames').cols.slice());
def('Table.Column', (t, c) => { t = tab(t); const i = colIdx(t, txt(c)); return t.rows.map(r => r[i]); });
def('Table.HasColumns', (t, c) => { t = tab(t); return [].concat(force(c)).map(force).every(x => t.cols.includes(x)); });
def('Table.IsEmpty', t => tab(t).rows.length === 0);
def('Table.First', (t, d) => { t = tab(t); return t.rows.length ? rowRec(t, 0) : (force(d) === undefined ? null : force(d)); });
def('Table.Last', (t, d) => { t = tab(t); return t.rows.length ? rowRec(t, t.rows.length - 1) : (force(d) === undefined ? null : force(d)); });
def('Table.SelectRows', (t, f) => { t = tab(t, 'Table.SelectRows'); return new MTab(t.cols.slice(), t.rows.filter((r, i) => { const v = callFn(f, [rowRec(t, i)]); if (v !== true && v !== false && v !== null) throw new MErr('Expression.Error', 'Условие Table.SelectRows вернуло ' + mTypeName(v) + ', а не logical'); return v === true; })); });
def('Table.SelectColumns', (t, c, mf) => selectCols(tab(t, 'Table.SelectColumns'), colNamesOf(t, c), force(mf) || 0));
def('Table.RemoveColumns', (t, c, mf) => { t = tab(t, 'Table.RemoveColumns'); const cs = colNamesOf(t, c); if (!force(mf)) cs.forEach(x => colIdx(t, x)); const keep = t.cols.filter(x => !cs.includes(x)); return selectCols(t, keep, 0); });
def('Table.ReorderColumns', (t, c, mf) => { t = tab(t); const cs = colNamesOf(t, c).filter(x => t.cols.includes(x) || !force(mf)); cs.forEach(x => colIdx(t, x)); const pos = t.cols.map((x, i) => cs.includes(x) ? i : -1).filter(i => i >= 0); const order = t.cols.slice(); pos.forEach((p, k) => { order[p] = cs[k]; }); return selectCols(t, order, 0); });
def('Table.RenameColumns', (t, ren, mf) => { t = tab(t, 'Table.RenameColumns'); let pairs = lst(ren); if (pairs.length === 2 && typeof pairs[0] === 'string') pairs = [pairs]; const cols = t.cols.slice(); for (const p of pairs){ const [a, b] = lst(p); const i = cols.indexOf(a); if (i < 0){ if (!force(mf)) throw new MErr('Expression.Error', 'Столбец «' + a + '» таблицы не найден. Есть: ' + cols.slice(0, 12).join(', ')); continue; } cols[i] = b; } if (new Set(cols).size !== cols.length) throw new MErr('Expression.Error', 'После переименования имена столбцов повторяются'); return new MTab(cols, t.rows); });
def('Table.AddColumn', (t, name, f) => { t = tab(t, 'Table.AddColumn'); name = txt(name); if (t.cols.includes(name)) throw new MErr('Expression.Error', 'Столбец «' + name + '» уже существует'); return new MTab(t.cols.concat([name]), t.rows.map((r, i) => r.concat([callFn(f, [rowRec(t, i)])]))); });
def('Table.AddIndexColumn', (t, name, s, inc) => { t = tab(t); s = force(s) == null ? 0 : num(s); inc = force(inc) == null ? 1 : num(inc); return new MTab(t.cols.concat([txt(name)]), t.rows.map((r, i) => r.concat([s + i * inc]))); });
def('Table.DuplicateColumn', (t, c, n) => { t = tab(t); const i = colIdx(t, txt(c)); return new MTab(t.cols.concat([txt(n)]), t.rows.map(r => r.concat([r[i]]))); });
def('Table.TransformColumns', (t, ops, def0, mf) => { t = tab(t, 'Table.TransformColumns'); let pairs = lst(ops); if (pairs.length >= 2 && typeof pairs[0] === 'string') pairs = [pairs]; const m = new Map(); for (const p of pairs){ const pp = lst(p); if (colIdx(t, pp[0], force(mf)) >= 0) m.set(pp[0], pp[1]); } const df = force(def0); return new MTab(t.cols.slice(), t.rows.map(r => r.map((v, i) => m.has(t.cols[i]) ? callFn(m.get(t.cols[i]), [v]) : df ? callFn(df, [v]) : v))); });
def('Table.TransformColumnTypes', (t, ops, culture) => { t = tab(t, 'Table.TransformColumnTypes'); let pairs = lst(ops); if (pairs.length === 2 && typeof pairs[0] === 'string') pairs = [pairs]; const cu = force(culture); const m = new Map(pairs.map(p => { const pp = lst(p); colIdx(t, pp[0]); return [pp[0], force(pp[1])]; }));
  const conv = (v, ty) => { if (v === null) return null; const n = ty.name; try {
    if (['number', 'int64', 'int32', 'decimal', 'double', 'currency', 'percentage'].includes(n)){ const x = typeof v === 'string' ? numFromText(v, cu) : MLIB['Number.From'].call([v]); return n === 'int64' || n === 'int32' ? roundHalfEven(x, 0) : n === 'currency' ? roundHalfEven(x, 4) : x; }
    if (n === 'text') return mToText(v); if (n === 'date') return MLIB['Date.From'].call([v, cu]); if (n === 'datetime') return MLIB['DateTime.From'].call([v, cu]); if (n === 'logical') return MLIB['Logical.From'].call([v]); return v;
  } catch (e){ return new Thunk(() => { throw e; }); } };
  return new MTab(t.cols.slice(), t.rows.map(r => r.map((v, i) => m.has(t.cols[i]) ? conv(force(v), m.get(t.cols[i])) : v))); });
def('Table.Sort', (t, c) => sortRows(tab(t, 'Table.Sort'), c));
def('Table.Distinct', (t, c) => { t = tab(t, 'Table.Distinct'); c = force(c); const ix = c == null ? t.cols.map((_, i) => i) : colNamesOf(t, c).map(x => colIdx(t, x)); const out = []; for (const r of t.rows) if (!out.some(o => ix.every(i => mEquals(o[i], r[i])))) out.push(r); return new MTab(t.cols.slice(), out); });
def('Table.FirstN', (t, n) => { t = tab(t); n = force(n); if (typeof n === 'number') return new MTab(t.cols.slice(), t.rows.slice(0, n)); const out = []; for (let i = 0; i < t.rows.length; i++){ if (callFn(n, [rowRec(t, i)]) !== true) break; out.push(t.rows[i]); } return new MTab(t.cols.slice(), out); });
def('Table.LastN', (t, n) => { t = tab(t); return new MTab(t.cols.slice(), t.rows.slice(Math.max(0, t.rows.length - num(n)))); });
def('Table.Skip', (t, n) => { t = tab(t); n = force(n); if (n == null) n = 1; if (typeof n === 'number') return new MTab(t.cols.slice(), t.rows.slice(n)); let k = 0; while (k < t.rows.length && callFn(n, [rowRec(t, k)]) === true) k++; return new MTab(t.cols.slice(), t.rows.slice(k)); });
MLIB['Table.RemoveFirstN'] = MLIB['Table.Skip'];
def('Table.RemoveLastN', (t, n) => { t = tab(t); n = force(n) == null ? 1 : num(n); return new MTab(t.cols.slice(), t.rows.slice(0, Math.max(0, t.rows.length - n))); });
def('Table.Range', (t, o, c) => { t = tab(t); o = num(o); c = force(c); return new MTab(t.cols.slice(), c == null ? t.rows.slice(o) : t.rows.slice(o, o + c)); });
def('Table.RemoveRows', (t, o, c) => { t = tab(t); o = num(o); c = force(c) == null ? 1 : num(c); return new MTab(t.cols.slice(), t.rows.filter((_, i) => i < o || i >= o + c)); });
def('Table.ReverseRows', t => { t = tab(t); return new MTab(t.cols.slice(), t.rows.slice().reverse()); });
def('Table.Repeat', (t, n) => { t = tab(t); let rows = []; for (let i = 0; i < num(n); i++) rows = rows.concat(t.rows); return new MTab(t.cols.slice(), rows); });
def('Table.Buffer', t => tab(t, 'Table.Buffer'));
def('Table.StopFolding', t => tab(t));
def('Table.Combine', ts => tableCombine(lst(ts, 'Table.Combine').map(x => tab(x, 'Table.Combine'))));
def('Table.PromoteHeaders', t => { t = tab(t); if (!t.rows.length) return t; const h = t.rows[0].map((x, i) => x === null || x === '' ? 'Column' + (i + 1) : mToText(x)); return new MTab(h, t.rows.slice(1)); });
def('Table.DemoteHeaders', t => { t = tab(t); return new MTab(t.cols.map((_, i) => 'Column' + (i + 1)), [t.cols.slice()].concat(t.rows)); });
def('Table.Transpose', t => { t = tab(t); const rows = t.cols.map((_, i) => t.rows.map(r => r[i])); return new MTab(t.rows.map((_, i) => 'Column' + (i + 1)), rows); });
def('Table.FillDown', (t, c) => { t = tab(t); const ix = colNamesOf(t, c).map(x => colIdx(t, x)); const last = {}; return new MTab(t.cols.slice(), t.rows.map(r => r.map((v, i) => { if (!ix.includes(i)) return v; v = force(v); if (v === null) return last[i] === undefined ? null : last[i]; last[i] = v; return v; }))); });
def('Table.FillUp', (t, c) => { t = tab(t); const rev = MLIB['Table.FillDown'].call([new MTab(t.cols, t.rows.slice().reverse()), c]); return new MTab(rev.cols, rev.rows.reverse()); });
def('Table.ReplaceValue', (t, a, b, r, cols) => { t = tab(t); const ix = colNamesOf(t, cols).map(x => colIdx(t, x)); return new MTab(t.cols.slice(), t.rows.map((row, ri) => { const rr = rowRec(t, ri); const av = force(a) instanceof MFn ? callFn(a, [rr]) : force(a); const bv = force(b) instanceof MFn ? callFn(b, [rr]) : force(b); return row.map((v, i) => ix.includes(i) ? callFn(r, [v, av, bv]) : v); })); });
def('Table.ReplaceErrorValues', (t, reps) => { t = tab(t); let pairs = lst(reps); if (pairs.length === 2 && typeof pairs[0] === 'string') pairs = [pairs]; const m = new Map(pairs.map(p => lst(p))); return new MTab(t.cols.slice(), t.rows.map(r => r.map((v, i) => { if (!m.has(t.cols[i])) return v; try { return force(v); } catch { return m.get(t.cols[i]); } }))); });
def('Table.RemoveRowsWithErrors', (t, c) => { t = tab(t); const ix = force(c) == null ? t.cols.map((_, i) => i) : colNamesOf(t, c).map(x => colIdx(t, x)); return new MTab(t.cols.slice(), t.rows.filter(r => ix.every(i => { try { force(r[i]); return true; } catch { return false; } }))); });
def('Table.SelectRowsWithErrors', (t, c) => { t = tab(t); const ix = force(c) == null ? t.cols.map((_, i) => i) : colNamesOf(t, c).map(x => colIdx(t, x)); return new MTab(t.cols.slice(), t.rows.filter(r => ix.some(i => { try { force(r[i]); return false; } catch { return true; } }))); });
def('Table.Group', (t, keys, aggs) => { t = tab(t, 'Table.Group'); const ks = colNamesOf(t, keys); const ki = ks.map(k => colIdx(t, k)); let ag = lst(aggs); if (ag.length && typeof ag[0] === 'string') ag = [ag]; ag = ag.map(a => lst(a));
  const groups = []; for (const r of t.rows){ let g = groups.find(x => ki.every((i, k) => mEquals(x.key[k], r[i]))); if (!g){ g = { key: ki.map(i => r[i]), rows: [] }; groups.push(g); } g.rows.push(r); }
  return new MTab(ks.concat(ag.map(a => a[0])), groups.map(g => g.key.concat(ag.map(a => callFn(a[1], [new MTab(t.cols.slice(), g.rows)]))))); });
def('Table.UnpivotOtherColumns', (t, keep, an, vn) => { t = tab(t); const k = colNamesOf(t, keep); const other = t.cols.filter(c => !k.includes(c)); const ki = k.map(c => colIdx(t, c)); const rows = []; for (const r of t.rows) for (const c of other){ const v = force(r[t.cols.indexOf(c)]); if (v !== null) rows.push(ki.map(i => r[i]).concat([c, v])); } return new MTab(k.concat([txt(an), txt(vn)]), rows); });
def('Table.Unpivot', (t, piv, an, vn) => { t = tab(t); const p = colNamesOf(t, piv); return MLIB['Table.UnpivotOtherColumns'].call([t, t.cols.filter(c => !p.includes(c)), an, vn]); });
def('Table.Pivot', (t, vals, an, vn, agg) => { t = tab(t); vals = lst(vals).map(x => mToText(x)); const ai = colIdx(t, txt(an)), vi = colIdx(t, txt(vn)); const keyCols = t.cols.filter((_, i) => i !== ai && i !== vi); const kix = keyCols.map(c => t.cols.indexOf(c)); const groups = [];
  for (const r of t.rows){ let g = groups.find(x => kix.every((i, k) => mEquals(x.key[k], r[i]))); if (!g){ g = { key: kix.map(i => r[i]), cells: new Map() }; groups.push(g); } const a = mToText(r[ai]); if (!g.cells.has(a)) g.cells.set(a, []); g.cells.get(a).push(r[vi]); }
  return new MTab(keyCols.concat(vals), groups.map(g => g.key.concat(vals.map(v => { const c = g.cells.get(v); if (!c) return null; if (force(agg)) return callFn(agg, [c]); if (c.length > 1) return new Thunk(() => { throw new MErr('Expression.Error', 'Table.Pivot: несколько значений без функции агрегирования'); }); return c[0]; })))); });
def('Table.NestedJoin', (a, ka, b, kb, name, kind) => { a = tab(a, 'Table.NestedJoin'); b = tab(b, 'Table.NestedJoin'); const ia = colNamesOf(a, ka).map(c => colIdx(a, c)), ib = colNamesOf(b, kb).map(c => colIdx(b, c)); kind = force(kind) == null ? 1 : force(kind);
  const match = r => b.rows.filter(s => ia.every((i, k) => mEquals(r[i], s[ib[k]])));
  const rows = []; const usedB = new Set();
  for (const r of a.rows){ const m = match(r); m.forEach(s => usedB.add(s)); if (kind === 0 && !m.length) continue; if (kind === 4 && m.length) continue; if (kind === 5) continue; rows.push(r.concat([new MTab(b.cols.slice(), m)])); }
  if (kind === 2 || kind === 3 || kind === 5) for (const s of b.rows) if (!usedB.has(s)) rows.push(a.cols.map(() => null).concat([new MTab(b.cols.slice(), [s])]));
  return new MTab(a.cols.concat([txt(name)]), rows); });
def('Table.Join', (a, ka, b, kb, kind) => { a = tab(a); b = tab(b); const dup = a.cols.filter(c => b.cols.includes(c)); if (dup.length) throw new MErr('Expression.Error', 'Table.Join: одинаковые имена столбцов (' + dup.join(', ') + ') — переименуйте или используйте NestedJoin'); const nj = MLIB['Table.NestedJoin'].call([a, ka, b, kb, '__j', kind]); return MLIB['Table.ExpandTableColumn'].call([nj, '__j', b.cols]); });
def('Table.ExpandTableColumn', (t, c, names, newNames) => { t = tab(t, 'Table.ExpandTableColumn'); const ci = colIdx(t, txt(c)); names = lst(names); const nn2 = force(newNames) == null ? names : lst(newNames);
  const cols = t.cols.slice(); cols.splice(ci, 1, ...nn2); const out = [];
  for (const r of t.rows){ const sub = force(r[ci]); const put = vals => { const x = r.slice(); x.splice(ci, 1, ...vals); out.push(x); };
    if (sub === null || !tab(sub).rows.length){ put(names.map(() => null)); continue; }
    for (const s2 of sub.rows) put(names.map(n => { const k = sub.cols.indexOf(n); return k < 0 ? null : s2[k]; })); }
  return new MTab(cols, out); });
def('Table.ExpandRecordColumn', (t, c, names, newNames) => { t = tab(t); const ci = colIdx(t, txt(c)); names = lst(names); const nn2 = force(newNames) == null ? names : lst(newNames); const cols = t.cols.slice(); cols.splice(ci, 1, ...nn2); return new MTab(cols, t.rows.map(r => { const rv = force(r[ci]); const vals = names.map(n => rv === null ? null : (rec(rv).has(n) ? rv.get(n) : null)); const x = r.slice(); x.splice(ci, 1, ...vals); return x; })); });
def('Table.ExpandListColumn', (t, c) => { t = tab(t); const ci = colIdx(t, txt(c)); const out = []; for (const r of t.rows){ const l = force(r[ci]); if (l === null || !l.length){ const x = r.slice(); x[ci] = null; out.push(x); continue; } for (const v of lst(l)){ const x = r.slice(); x[ci] = v; out.push(x); } } return new MTab(t.cols.slice(), out); });
def('Table.SplitColumn', (t, c, sp, names) => { t = tab(t); const ci = colIdx(t, txt(c)); const parts = t.rows.map(r => lst(callFn(sp, [r[ci]]))); names = force(names); const n = typeof names === 'number' ? names : names == null ? Math.max(1, ...parts.map(p => p.length)) : lst(names).length; const nm = Array.isArray(names) ? names.map(force) : Array.from({ length: n }, (_, i) => t.cols[ci] + '.' + (i + 1)); const cols = t.cols.slice(); cols.splice(ci, 1, ...nm); return new MTab(cols, t.rows.map((r, k) => { const x = r.slice(); x.splice(ci, 1, ...nm.map((_, i) => i < parts[k].length ? parts[k][i] : null)); return x; })); });
def('Table.CombineColumns', (t, cs, comb, name) => { t = tab(t); cs = lst(cs); const ix = cs.map(c => colIdx(t, c)); const first = Math.min(...ix); const cols = t.cols.filter((_, i) => !ix.includes(i)); cols.splice(first, 0, txt(name)); return new MTab(cols, t.rows.map(r => { const v = callFn(comb, [ix.map(i => r[i])]); const x = r.filter((_, i) => !ix.includes(i)); x.splice(first, 0, v); return x; })); });
def('Table.TransformRows', (t, f) => { t = tab(t); return t.rows.map((_, i) => callFn(f, [rowRec(t, i)])); });
def('Table.Max', (t, c, d) => { t = tab(t); if (!t.rows.length) return force(d) === undefined ? null : force(d); const s = sortRows(t, [force(c), 1]); return rowRec(s, 0); });
def('Table.Min', (t, c, d) => { t = tab(t); if (!t.rows.length) return force(d) === undefined ? null : force(d); const s = sortRows(t, [force(c), 0]); return rowRec(s, 0); });
def('Table.Contains', (t, r) => { t = tab(t); r = rec(r); return t.rows.some(row => r.names.every(n => { const i = t.cols.indexOf(n); return i >= 0 && mEquals(row[i], r.get(n)); })); });
def('Table.PrefixColumns', (t, p) => { t = tab(t); p = txt(p); return new MTab(t.cols.map(c => p + '.' + c), t.rows); });
def('Table.TransformColumnNames', (t, f) => { t = tab(t); return new MTab(t.cols.map(c => callFn(f, [c])), t.rows); });
def('Table.InsertRows', (t, o, rs) => { t = tab(t); const ins = lst(rs).map(r => t.cols.map(c => rec(r).has(c) ? r.get(c) : null)); const rows = t.rows.slice(); rows.splice(num(o), 0, ...ins); return new MTab(t.cols.slice(), rows); });
def('Table.Schema', t => { t = tab(t); return new MTab(['Name', 'Position', 'TypeName'], t.cols.map((c, i) => { const ts = new Set(t.rows.map(r => { try { return mTypeName(force(r[i])); } catch { return 'error'; } }).filter(x => x !== 'null')); return [c, i, ts.size === 1 ? [...ts][0] : 'any']; })); });
def('Table.Profile', t => { t = tab(t); return new MTab(['Column', 'Min', 'Max', 'Count', 'NullCount', 'DistinctCount'], t.cols.map((c, i) => { const v = t.rows.map(r => { try { return force(r[i]); } catch { return null; } }); const nnv = v.filter(x => x !== null); let mn = null, mx = null; try { mn = nnv.length ? nnv.reduce((a, b) => mCompare(a, b) <= 0 ? a : b) : null; mx = nnv.length ? nnv.reduce((a, b) => mCompare(a, b) >= 0 ? a : b) : null; } catch { /* разнотипные */ } return [c, mn, mx, v.length, v.length - nnv.length, MLIB['List.Distinct'].call([nnv]).length]; })); });
def('Table.Keys', () => []);
def('Table.AddKey', t => tab(t));
// синонимы и константы

/* ---------- Публичное API ---------- */
function sectionEnv(sectionText, overrides){
  const vars = new Map(); const env = new Env(vars, null);
  if (sectionText){
    for (const m of parseSection(sectionText).members){
      const exprText = sectionText.slice(m.exprStart, m.exprEnd);
      if (overrides && overrides.queries && overrides.queries.has(m.name)){ const ov = overrides.queries.get(m.name); vars.set(m.name, new Thunk(() => ov)); continue; }
      vars.set(m.name, new Thunk(() => evalNode(mParse(exprText), env)));
    }
  }
  return env;
}
function deepForce(v, depth){
  v = force(v); depth = depth || 0; if (depth > 3) return v;
  if (Array.isArray(v)) v.forEach((x, i) => { try { v[i] = deepForce(x, depth + 1); } catch (e){ v[i] = new Thunk(() => { throw e; }); } });
  return v;
}
function mEval(text, sectionText){
  const env = sectionEnv(sectionText);
  try { return deepForce(evalNode(mParse(text), env)); } catch (e){ throw toMErr(e); }
}
/** Пошаговый прогон запроса: результат каждого шага let или ошибка */
function mRunSteps(sectionText, member, overrides){
  overrides = overrides || {};
  const sec = parseSection(sectionText); const m = sec.members.find(x => x.name === member);
  if (!m) throw new MErr('Expression.Error', 'Запрос «' + member + '» не найден');
  const env = sectionEnv(sectionText, overrides);
  const exprText = sectionText.slice(m.exprStart, m.exprEnd);
  const ast = mParse(exprText);
  const out = [];
  if (ast.k !== 'let'){
    const t0 = performance.now(); let value, error = null; try { value = deepForce(evalNode(ast, env)); } catch (e){ error = toMErr(e); }
    out.push({ name: '(результат)', value, error, ms: performance.now() - t0 }); return out;
  }
  const vars = new Map(); const e2 = new Env(vars, env);
  for (const [nm, ex] of ast.binds){ const ov = overrides.steps && overrides.steps.get(nm); vars.set(nm, ov !== undefined ? new Thunk(() => ov) : new Thunk(() => evalNode(ex, e2))); }
  for (const [nm] of ast.binds){
    const t0 = performance.now(); let value, error = null;
    try { value = deepForce(force(vars.get(nm))); } catch (e){ error = toMErr(e); }
    out.push({ name: nm, value, error, ms: performance.now() - t0, overridden: !!(overrides.steps && overrides.steps.has(nm)) });
  }
  const t0 = performance.now(); let fv, fe = null; try { fv = deepForce(evalNode(ast.body, e2)); } catch (e){ fe = toMErr(e); }
  out.push({ name: 'in → результат', value: fv, error: fe, ms: performance.now() - t0, final: true });
  return out;
}
/** Таблица из строк CSV/XLSX (первая строка — заголовки), числа распознаются */
function tableFromRows(rows){
  const H = (rows[0] || []).map((h, i) => String(h || 'Column' + (i + 1)));
  const conv = v => { if (v == null || v === '') return null; const s = String(v); if (/^-?\d+([.,]\d+)?$/.test(s.trim())) return Number(s.replace(',', '.')); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return mkDate(y, m, d); } return s; };
  return new MTab(H, rows.slice(1).map(r => H.map((_, i) => conv(r[i]))));
}
function mRender(v, depth){
  depth = depth || 0;
  try { v = force(v); } catch (e){ return '<span class="val-err">⚠ ' + escHtml(e.message || String(e)) + '</span>'; }
  const cell = x => { try { x = force(x); } catch (e){ return '<td class="val-err" title="' + escHtml(e.message || '') + '">Error</td>'; } if (x === null) return '<td class="val-null">null</td>'; if (typeof x === 'number') return '<td class="num">' + escHtml(mToText(x)) + '</td>'; if (x instanceof MTab) return '<td class="val-null">Table</td>'; if (x instanceof MRec) return '<td class="val-null">Record</td>'; if (Array.isArray(x)) return '<td class="val-null">List</td>'; if (x instanceof MFn) return '<td class="val-null">Function</td>'; return '<td>' + escHtml(mToText(x)) + '</td>'; };
  if (v instanceof MTab){ const max = 200; return '<div class="val-type">table · ' + v.rows.length + ' строк × ' + v.cols.length + ' столбцов' + (v.rows.length > max ? ' (показаны первые ' + max + ')' : '') + '</div><table class="val-table"><tr><th>#</th>' + v.cols.map(c => '<th>' + escHtml(c) + '</th>').join('') + '</tr>' + v.rows.slice(0, max).map((r, i) => '<tr><td class="val-null">' + (i + 1) + '</td>' + r.map(cell).join('') + '</tr>').join('') + '</table>'; }
  if (v instanceof MRec) return '<div class="val-type">record · ' + v.names.length + ' полей</div><table class="val-table">' + v.names.map((n, i) => { let x; try { x = v.get(n); } catch (e){ return '<tr><th>' + escHtml(n) + '</th><td class="val-err">' + escHtml(e.message) + '</td></tr>'; } return '<tr><th>' + escHtml(n) + '</th>' + (depth < 1 && (x instanceof MTab || x instanceof MRec || Array.isArray(x)) ? '<td>' + mRender(x, depth + 1) + '</td>' : cell(x)) + '</tr>'; }).join('') + '</table>';
  if (Array.isArray(v)) return '<div class="val-type">list · ' + v.length + ' элементов</div><table class="val-table">' + v.slice(0, 500).map((x, i) => '<tr><td class="val-null">' + i + '</td>' + (depth < 1 && (force(x) instanceof MTab || force(x) instanceof MRec) ? '<td>' + mRender(x, depth + 1) + '</td>' : cell(x)) + '</tr>').join('') + '</table>';
  if (v instanceof MFn) return '<div class="val-type">function</div><code>' + escHtml(v.name || 'function') + (v.arity >= 0 ? ' (' + v.arity + ' арг.)' : '') + '</code>';
  return '<div class="val-type">' + mTypeName(v) + '</div><pre class="code">' + escHtml(mLit(v)) + '</pre>';
}
