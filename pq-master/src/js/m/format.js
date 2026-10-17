/* =====================================================================
   m/format.js — форматер M: только отступы, смысл кода не меняется.
   Правила: отступ строки = число открытых скобок ( [ { и блоков let/in.
   Строка, начинающаяся с закрывающей скобки или с «in», — на уровень выше.
   Строки внутри многострочных строк/комментариев не трогаются.
   Гарантия (проверяется самотестом): все значимые токены сохраняются,
   форматирование идемпотентно.
   Зависит от: lexM (m/lang.js).
   ===================================================================== */
function formatM(src, unit){
  unit = unit || '    ';
  const nl = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const starts = []; { let p = 0; for (const l of lines){ starts.push(p); p += l.length + (src.substr(p + l.length, 2) === '\r\n' ? 2 : 1); } }
  const toks = lexM(src);
  const lineOf = pos => { let lo = 0, hi = starts.length - 1; while (lo < hi){ const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const indent = new Array(lines.length).fill(null);   // null = не трогать
  const stack = [];                                      // '(' '[' '{' 'let' 'in'
  const popIn = () => { while (stack.length && stack[stack.length - 1] === 'in') stack.pop(); };
  let lastLine = -1;
  for (const t of toks){
    if (t.t === 'ws') continue;
    const li = lineOf(t.s);
    const first = li !== lastLine;
    // многострочный токен: строки после первой — не трогать
    if (t.t === 'str' || t.t === 'qid' || t.t === 'cmt'){ const le = lineOf(Math.max(t.s, t.e - 1)); for (let k = li + 1; k <= le; k++) indent[k] = null; }
    const v = t.v;
    if (first){
      let d;
      if (t.t === 'op' && (v === ')' || v === ']' || v === '}')){ popIn(); d = stack.length - 1; }
      else if (t.t === 'id' && v === 'in'){ popIn(); d = stack.length - 1; }
      else if (t.t === 'op' && (v === ',' || v === ';')){ popIn(); d = stack.length; }
      else d = stack.length;
      indent[li] = Math.max(0, d);
    }
    if (t.t === 'op'){
      if (v === '(' || v === '[' || v === '{') stack.push(v);
      else if (v === ')' || v === ']' || v === '}'){ popIn(); stack.pop(); }
      else if (v === ','){ popIn(); }
      else if (v === ';'){ while (stack.length && (stack[stack.length - 1] === 'in' || stack[stack.length - 1] === 'let')) stack.pop(); }
    } else if (t.t === 'id'){
      if (v === 'let') stack.push('let');
      else if (v === 'in'){ popIn(); if (stack[stack.length - 1] === 'let') stack[stack.length - 1] = 'in'; }
    }
    lastLine = lineOf(Math.max(t.s, t.e - 1));
    if (t.t !== 'str' && t.t !== 'qid' && t.t !== 'cmt') lastLine = li;
  }
  // строки, которые начинаются внутри многострочного токена, помечены null уже выше;
  // но если на такой строке после конца токена есть ещё токены, indent мог быть выставлен — сбросим
  const keepEnd = new Set();
  for (const t of toks){ if ((t.t === 'str' || t.t === 'qid' || t.t === 'cmt') && lineOf(t.e - 1) > lineOf(t.s)){ keepEnd.add(lineOf(t.s)); for (let k = lineOf(t.s) + 1; k <= lineOf(t.e - 1); k++) indent[k] = null; } }
  return lines.map((l, i) => {
    if (indent[i] == null) return l;
    let body = l.replace(/^[ \t]+/, ''); if (!keepEnd.has(i)) body = body.replace(/[ \t]+$/, '');
    return body ? unit.repeat(indent[i]) + body : '';
  }).join(nl);
}
/** Значимые токены текста (для проверки, что форматирование не изменило код) */
function sigTokens(src){ return lexM(src).filter(t => t.t !== 'ws').map(t => t.v); }
