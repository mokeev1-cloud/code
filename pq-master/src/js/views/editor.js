/* =====================================================================
   views/editor.js — умный редактор M на CodeMirror 6 (vendor, window.CM).
   Редактируется выражение одного запроса (как в «Расширенном редакторе»).
   «Применить» записывает его в рабочую версию через setWork().
   Возможности: подсветка M, автодополнение (функции, перечисления, запросы,
   шаги, столбцы), подсказка сигнатуры, справка по наведению, проблемы
   (синтаксис + линтер) прямо в коде, сворачивание, поиск (Ctrl+F),
   структура шагов с картой тяжести, полоса потока шагов.
   Общий конструктор makeMEditor() используется и песочницей.
   ===================================================================== */
const ED = { query: null, base: '', view: null, A2: null, m2: null, exprBase: 0, sideTab: 'steps', cursorFn: null };

/* ---- Язык M для CodeMirror ---- */
function readMString(stream, st){ while (!stream.eol()){ const ch = stream.next(); if (ch === '"'){ if (stream.peek() === '"'){ stream.next(); continue; } const m = st.mode; st.mode = null; return m === 'qid' ? 'qid' : 'string'; } } return st.mode === 'qid' ? 'qid' : 'string'; }
const M_STREAM = {
  name: 'powerquery-m',
  startState: () => ({ mode: null }),
  copyState: s => ({ mode: s.mode }),
  token(stream, st){
    if (st.mode === 'cmt'){ if (stream.skipTo('*/')){ stream.pos += 2; st.mode = null; } else stream.skipToEnd(); return 'comment'; }
    if (st.mode === 'str' || st.mode === 'qid') return readMString(stream, st);
    if (stream.eatSpace()) return null;
    if (stream.match('//')){ stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')){ st.mode = 'cmt'; if (stream.skipTo('*/')){ stream.pos += 2; st.mode = null; } else stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^⟦[A-Z]+_\d+⟧/)) return 'tok';
    if (stream.match('#"')){ st.mode = 'qid'; return readMString(stream, st); }
    if (stream.peek() === '"'){ stream.next(); st.mode = 'str'; return readMString(stream, st); }
    if (stream.match(/^#(datetimezone|datetime|date|duration|time|table|binary|infinity|nan|sections|shared)\b/)) return 'hash';
    if (stream.match(/^(0[xX][0-9a-fA-F]+|(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?)/)) return 'number';
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*(\.[\p{L}_][\p{L}\p{N}_]*)*/u)){
      const w = stream.current();
      if (M_KEYWORDS.has(w)) return 'keyword';
      if (M_TYPES.includes(w) || /^[A-Z]\w*\.Type$/.test(w)) return 'typeName';
      if (stream.match(/^\s*\(/, false)) return 'fn';
      return 'variableName';
    }
    if (stream.match(/^(=>|<=|>=|<>|\.\.\.|\.\.|\?\?|[-+*/&=<>?@!])/)) return 'operator';
    stream.next(); return null;
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{', '"'] } }
};
let _mLang = null, _mHl = null;
function mLanguage(){
  if (_mLang) return _mLang;
  const T = CM.tags;
  _mLang = CM.StreamLanguage.define(Object.assign({}, M_STREAM, { tokenTable: { fn: T.function(T.variableName), qid: T.special(T.string), hash: T.processingInstruction, tok: T.special(T.variableName) } }));
  _mHl = CM.HighlightStyle.define([
    { tag: T.keyword, class: 'tok-kw' }, { tag: T.string, class: 'tok-str' }, { tag: T.number, class: 'tok-num' }, { tag: T.comment, class: 'tok-cmt' },
    { tag: T.operator, class: 'tok-op' }, { tag: T.typeName, class: 'tok-type' }, { tag: T.function(T.variableName), class: 'tok-fn' },
    { tag: T.special(T.string), class: 'tok-qid' }, { tag: T.processingInstruction, class: 'tok-hash' }, { tag: T.special(T.variableName), class: 'tok-pq-token' }
  ]);
  return _mLang;
}
/* сворачивание по отступам */
const mFold = () => CM.foldService.of((state, from) => {
  const line = state.doc.lineAt(from); const ind = /^\s*/.exec(line.text)[0].length; if (!line.text.trim()) return null;
  let end = null;
  for (let n = line.number + 1; n <= state.doc.lines; n++){ const l = state.doc.line(n); if (!l.text.trim()) continue; const i = /^\s*/.exec(l.text)[0].length; if (i > ind) end = l.to; else break; }
  return end && end > line.to ? { from: line.to, to: end } : null;
});

/* ---- Автодополнение ---- */
function columnCandidates(){
  const s = new Set();
  if (S.A) for (const m of S.A.members) if (Array.isArray(m.load.columns)) m.load.columns.forEach(c => s.add(String(c)));
  if (S.anon && S.anon.colNames) S.anon.colNames.forEach(c => s.add(c));
  return [...s];
}
function refInfoDom(f){ const d = document.createElement('div'); d.innerHTML = '<div class="mono" style="margin-bottom:6px">' + escHtml(refSignature(f)) + '</div><div>' + escHtml(f.desc) + '</div>' + (f.example ? '<div class="mono muted" style="margin-top:6px">' + escHtml(f.example) + '</div>' : ''); return d; }
function mCompletion(ctx){
  const w = ctx.matchBefore(/[#\p{L}_][\p{L}\p{N}_.]*/u);
  const from = w ? w.from : ctx.pos;
  const prev = ctx.state.doc.sliceString(Math.max(0, from - 1), from);
  if (!w && !ctx.explicit && prev !== '[') return null;
  if (prev === '['){
    const cols = columnCandidates();
    return cols.length ? { from, options: cols.map(c => ({ label: c, type: 'property', detail: 'столбец', apply: /^[\p{L}_][\p{L}\p{N}_ ]*$/u.test(c) ? c : '#"' + c.replace(/"/g, '""') + '"' })), validFor: /^[\p{L}\p{N}_ ]*$/u } : null;
  }
  const opts = [];
  for (const k of M_KEYWORDS) opts.push({ label: k, type: 'keyword', boost: -1 });
  for (const t of M_TYPES) opts.push({ label: t, type: 'type', detail: 'тип', boost: -2 });
  for (const f of M_REF.values()) opts.push({ label: f.name, type: 'function', detail: f.ret, info: () => refInfoDom(f), apply: (view, c, a, b) => { view.dispatch({ changes: { from: a, to: b, insert: f.name + '()' }, selection: { anchor: a + f.name.length + 1 } }); } });
  for (const k of Object.keys(MLIB)) if (!M_REF.has(k) && !k.startsWith('#')) opts.push({ label: k, type: 'function', detail: 'песочница', boost: -3 });
  for (const [ns, vals] of Object.entries(M_ENUMS)) for (const v of vals) opts.push({ label: ns + '.' + v, type: 'enum', detail: 'константа' });
  for (const h of ['#date', '#datetime', '#datetimezone', '#duration', '#time', '#table']) opts.push({ label: h, type: 'keyword', detail: 'конструктор', apply: (view, c, a, b) => view.dispatch({ changes: { from: a, to: b, insert: h + '()' }, selection: { anchor: a + h.length + 1 } }) });
  if (S.A) for (const m of S.A.members) if (m.name !== ED.query) opts.push({ label: m.name, type: 'variable', detail: m.isParam ? 'параметр' : m.isFn ? 'функция-запрос' : 'запрос', boost: 2, apply: mQuoteName(m.name) });
  if (ED.m2 && ED.m2.steps) for (const s of ED.m2.steps.steps) opts.push({ label: s.name, type: 'variable', detail: 'шаг', boost: 3, apply: mQuoteName(s.name) });
  return { from, options: opts, validFor: /^[#\p{L}\p{N}_.]*$/u };
}
/* ---- Подсказка сигнатуры ---- */
function callAtPos(doc, pos){
  const startAt = Math.max(0, pos - 4000); const slice = doc.sliceString(startAt, pos);
  const toks = lexM(slice).filter(t => t.t !== 'ws' && t.t !== 'cmt'); let depth = 0, commas = 0;
  for (let i = toks.length - 1; i >= 0; i--){
    const t = toks[i]; if (t.t !== 'op') continue;
    if (')]}'.includes(t.v)) depth++;
    else if ('([{'.includes(t.v)){
      if (depth > 0){ depth--; continue; }
      if (t.v === '('){ const p = toks[i - 1]; if (p && p.t === 'id' && M_REF.has(p.v)) return { fn: M_REF.get(p.v), arg: commas, pos: startAt + p.s }; return null; }
      commas = 0;
    } else if (t.v === ',' && depth === 0) commas++;
  }
  return null;
}
function sigTooltip(state){
  const r = callAtPos(state.doc, state.selection.main.head); if (!r) return null;
  return { pos: state.selection.main.head, above: true, strictSide: true, arrow: false, create: () => {
    const d = document.createElement('div'); d.className = 'sig-tip';
    const f = r.fn; const ps = f.params.map((p, i) => '<span class="' + (i === r.arg ? 'cur' : '') + '">' + (p.optional ? 'optional ' : '') + escHtml(p.name) + ' as ' + escHtml(p.type) + '</span>').join(', ');
    d.innerHTML = escHtml(f.name) + '(' + ps + ') → ' + escHtml(f.ret) + '<div class="d">' + escHtml(f.desc) + '</div>';
    return { dom: d };
  } };
}
let _sigField = null;
function sigField(){ if (!_sigField) _sigField = CM.StateField.define({ create: s => sigTooltip(s), update: (v, tr) => (tr.docChanged || tr.selection) ? sigTooltip(tr.state) : v, provide: f => CM.showTooltip.from(f) }); return _sigField; }
function wordAt(doc, pos){
  const line = doc.lineAt(pos); const t = line.text; let a = pos - line.from, b = a;
  const re = /[\p{L}\p{N}_.#]/u; while (a > 0 && re.test(t[a - 1])) a--; while (b < t.length && re.test(t[b])) b++;
  return { word: t.slice(a, b).replace(/\.$/, ''), from: line.from + a, to: line.from + b };
}
const mHover = () => CM.hoverTooltip((view, pos) => {
  const w = wordAt(view.state.doc, pos); const f = M_REF.get(w.word);
  if (!f) return null;
  return { pos: w.from, end: w.to, above: true, create: () => { const d = document.createElement('div'); d.className = 'hover-doc'; d.appendChild(refInfoDom(f)); return { dom: d }; } };
});

/** Универсальный конструктор редактора M */
function makeMEditor(host, doc, opts){
  opts = opts || {};
  mLanguage();
  const ext = [
    CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(), CM.history(), CM.foldGutter(), CM.drawSelection(), CM.dropCursor(),
    CM.EditorState.allowMultipleSelections.of(true), CM.indentOnInput(), CM.syntaxHighlighting(_mHl), CM.bracketMatching(), CM.closeBrackets(),
    CM.autocompletion({ override: [mCompletion], maxRenderedOptions: 80, icons: false }), CM.rectangularSelection(), CM.crosshairCursor(), CM.highlightActiveLine(), CM.highlightSelectionMatches(),
    CM.keymap.of([].concat(opts.keys || [], CM.closeBracketsKeymap, CM.defaultKeymap, CM.searchKeymap, CM.historyKeymap, CM.completionKeymap, CM.lintKeymap, [CM.indentWithTab])),
    _mLang, CM.indentUnit.of('    '), sigField(), mHover(), mFold(), CM.tooltips({ parent: document.body }),
    CM.EditorView.updateListener.of(u => { if (opts.onUpdate) opts.onUpdate(u); })
  ];
  if (opts.lint) ext.push(CM.linter(opts.lint, { delay: 450 }), CM.lintGutter());
  if (opts.wrap) ext.push(CM.EditorView.lineWrapping);
  const v = new CM.EditorView({ state: CM.EditorState.create({ doc, extensions: ext }), parent: host });
  v.dom.style.fontSize = pqmSettings().editorFont + 'px';
  return v;
}
function applyEditorFont(){ $$('.cm-editor').forEach(e => { e.style.fontSize = pqmSettings().editorFont + 'px'; }); }

/* ---- Анализ текста редактора в контексте книги ---- */
function edAnalyze(text){
  try {
    const m = S.A.byName.get(ED.query);
    const temp = S.work.slice(0, m.exprStart) + ' ' + safeExprEnd(text) + S.work.slice(m.exprEnd);   // позиции текста редактора = позиции в temp − exprBase
    const A2 = analyzeSection(temp, S.book.meta); const m2 = A2.byName.get(ED.query);
    ED.A2 = A2; ED.m2 = m2; ED.exprBase = m.exprStart + 1;
    ED.lint2 = lintSection(A2).filter(l => l.query === ED.query);
    ED.heat2 = heatMap(A2).find(h => h.query === ED.query);
  } catch (e){ ED.A2 = null; ED.m2 = null; ED.lint2 = []; ED.heat2 = null; }
}
function edLint(view){
  const text = view.state.doc.toString(); const out = []; const len = text.length;
  try { mParse(text); } catch (e){ const m = /символ (\d+)/.exec(e.message || ''); const p = m ? Math.min(+m[1], len) : len; out.push({ from: Math.max(0, p - 1), to: Math.min(len, p + 1), severity: 'error', message: 'Синтаксис: ' + e.message }); }
  edAnalyze(text);
  if (ED.m2){
    for (const l of ED.lint2){
      const st = l.step && ED.m2.steps ? ED.m2.steps.steps.find(s => s.name === l.step) : null;
      let from = 0, to = Math.min(len, (text.indexOf('\n') + 1 || len + 1) - 1);
      if (st){ from = st.s - ED.exprBase; to = st.nameE - ED.exprBase; }
      if (from < 0 || to > len || from >= to){ from = 0; to = Math.min(len, 3); }
      out.push({ from, to, severity: l.sev === 'err' ? 'error' : l.sev === 'warn' ? 'warning' : 'info', message: l.msg + (l.fix ? '\n→ ' + l.fix : '') });
    }
  }
  setTimeout(() => { renderEdSide(); renderEdFlow(); edDataSchedule(); }, 0);
  return out;
}

/* ---- Вид ---- */
function edCurrentText(){ return ED.view ? ED.view.state.doc.toString() : ''; }
const edDirty = () => !!ED.view && edCurrentText() !== ED.base;
function edLoad(name){
  if (!S.A || !S.A.byName.has(name)) return;
  const m = S.A.byName.get(name); ED.query = name; S.sel = name;
  ED.base = S.work.slice(m.exprStart, m.exprEnd).replace(/^[ \t]*\r?\n?/, '').replace(/\r\n/g, '\n');
  ED.baseRaw = S.work.slice(m.exprStart, m.exprEnd);
  if (!ED.view) ED.view = makeMEditor($('#edHost'), ED.base, { lint: edLint, keys: [{ key: 'Mod-Enter', run: () => { edApply(); return true; } }, { key: 'Shift-Alt-f', run: () => { edFormat(); return true; } }], onUpdate: u => { if (u.docChanged) $('#edDirty').classList.toggle('hidden', !edDirty()); if (u.selectionSet || u.docChanged) edCursorChanged(); } });
  else ED.view.dispatch({ changes: { from: 0, to: ED.view.state.doc.length, insert: ED.base }, selection: { anchor: 0 }, scrollIntoView: true });
  $('#edTitle').textContent = name; $('#edTitle').title = name;
  $('#edDirty').classList.add('hidden');
  edAnalyze(ED.base); renderEdList(); renderEdSide(); renderEdFlow(); EDD.step = null; edDataSchedule();
}
async function edConfirmLeave(){
  if (!edDirty()) return true;
  const r = await modal('<h2>Правки в «' + escHtml(ED.query) + '» не применены</h2><p>Применить их к рабочей версии перед переходом?</p>', [['cancel', 'Остаться'], ['drop', 'Отбросить', 'danger'], ['apply', 'Применить', 'pri']]);
  if (r === 'apply') return edApply();
  return r === 'drop';
}
function toSectionText(edText){ return /\r\n/.test(S.work) ? edText.replace(/\r?\n/g, '\r\n') : edText; }
async function edApply(){
  if (!edDirty()) return true;
  const text = edCurrentText();
  try { mParse(text); } catch (e){ const r = await modal('<h2>В коде синтаксическая ошибка</h2><p>' + escHtml(e.message) + '</p><p>Power Query не сможет выполнить такой запрос. Применить всё равно?</p>', [['cancel', 'Исправить', 'pri'], ['go', 'Применить', 'danger']]); if (r !== 'go') return false; }
  const lead = (/^[ \t]*\r?\n?/.exec(ED.baseRaw) || [''])[0];
  const nl = /\r\n/.test(S.work) ? '\r\n' : '\n';
  const nw = S.work.slice(0, S.A.byName.get(ED.query).exprStart) + lead + safeExprEnd(toSectionText(text), nl) + S.work.slice(S.A.byName.get(ED.query).exprEnd);
  setWork(nw, 'editor', 'Правка «' + ED.query + '»');
  ED.base = text; ED.baseRaw = lead + safeExprEnd(toSectionText(text), nl); $('#edDirty').classList.add('hidden');
  if (ED.baseRaw !== lead + toSectionText(text)) edLoad(ED.query);
  toast('Применено к рабочей версии', 'ok', 2000);
  return true;
}
function edFormat(){
  const t = edCurrentText(); const f = formatM(t);
  if (f !== t) ED.view.dispatch({ changes: { from: 0, to: t.length, insert: f } });
  else toast('Код уже отформатирован', 'ok', 1500);
}
function formatAllQueries(){
  if (!S.work) return;
  const sec = parseSection(S.work); let o = S.work;
  for (const m of sec.members.slice().reverse()){ const ex = o.slice(m.exprStart, m.exprEnd); const f = formatM(ex); if (f !== ex) o = o.slice(0, m.exprStart) + f + o.slice(m.exprEnd); }
  if (setWork(o, 'refactor', 'Форматирование всех запросов')) toast('Отформатировано', 'ok'); else toast('Всё уже отформатировано', 'ok');
}
function edCursorChanged(){
  clearTimeout(edCursorChanged._t);
  edCursorChanged._t = setTimeout(() => {
    if (!ED.view) return; const w = wordAt(ED.view.state.doc, ED.view.state.selection.main.head).word;
    const call = callAtPos(ED.view.state.doc, ED.view.state.selection.main.head);
    const fn = M_REF.has(w) ? w : call ? call.fn.name : null;
    if (fn !== ED.cursorFn){ ED.cursorFn = fn; if (ED.sideTab === 'doc') renderEdSide(); }
    const st = edStepAtCursor(); const sn = st ? st.name : null; if (sn !== EDD.step){ EDD.step = sn; edDataRender(); }
  }, 150);
}
function editorWordAtCursor(){ return ED.view ? (ED.cursorFn || wordAt(ED.view.state.doc, ED.view.state.selection.main.head).word) : null; }
function edGotoStep(name){
  if (!ED.m2 || !ED.m2.steps) return; const s = ED.m2.steps.steps.find(x => x.name === name); if (!s) return;
  const a = s.s - ED.exprBase, b = s.nameE - ED.exprBase;
  ED.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true }); ED.view.focus();
}
function edStepAtCursor(){
  if (!ED.m2 || !ED.m2.steps) return null; const p = ED.view.state.selection.main.head + ED.exprBase;
  return ED.m2.steps.steps.find(s => p >= s.s && p <= s.exprE) || null;
}
function renderEdList(){
  if (!S.A) return; const f = ($('#edFilter').value || '').toLowerCase();
  $('#edQList').innerHTML = S.A.members.filter(m => !f || m.name.toLowerCase().includes(f)).map(m => {
    const lc = S.lint.filter(l => l.query === m.name && (l.sev === 'err' || l.sev === 'warn')).length;
    return '<li data-q="' + escHtml(m.name) + '" class="' + (m.name === ED.query ? 'on' : '') + '" title="' + escHtml(m.name) + '"><span class="nm">' + escHtml(m.name) + '</span><span class="ic">' + (m.isParam ? '⚙' : m.isFn ? 'ƒ' : '') + (m.hasSource ? '🔌' : '') + (m.load.sheet ? '▦' : '') + (m.load.model ? '◈' : '') + (lc ? ' ⚠' + lc : '') + '</span></li>';
  }).join('');
}
function renderEdSide(){
  const box = $('#edSide'); if (!box) return;
  $$('#edSideTabs button').forEach(b => b.classList.toggle('on', b.dataset.s === ED.sideTab));
  if (ED.sideTab === 'steps'){
    if (!ED.m2){ box.innerHTML = '<div class="muted small">Код не разобран — проверьте синтаксис.</div>'; return; }
    if (!ED.m2.steps){ box.innerHTML = '<div class="muted small">Выражение без let…in — шагов нет.</div>'; return; }
    const heat = new Map((ED.heat2 ? ED.heat2.cells : []).map(c => [c.step, c]));
    box.innerHTML = '<div class="small muted" style="margin-bottom:6px">Клик — к шагу. Цвет — оценка тяжести' + (EDD.on ? ', число — строк на данных' : '') + '.</div>' + ED.m2.steps.steps.map((s, i) => { const h = heat.get(s.name) || { level: 0, why: [] }; return '<div class="outline-step' + (s.dead ? ' dead' : '') + '" data-step="' + escHtml(s.name) + '" title="' + escHtml((h.why.join(', ') || 'лёгкий шаг') + (s.dead ? ' · не используется' : '')) + '"><span class="no">' + (i + 1) + '</span><span class="heat" style="background:' + heatColor(h.level) + '"></span><span class="nm">' + escHtml(s.name) + '</span>' + edStepBadge(s.name) + '<span class="fn">' + escHtml(s.fn) + '</span></div>'; }).join('') +
      (ED.m2.load && Array.isArray(ED.m2.load.columns) ? '<h3>Столбцы результата</h3><div class="small">' + ED.m2.load.columns.map(c => '<span class="chip">' + escHtml(String(c)) + '</span>').join(' ') + '</div>' : '') +
      '<h3>Связи</h3><div class="small">Использует: ' + ([...ED.m2.refs].map(n => '<button class="link" data-openq="' + escHtml(n) + '">' + escHtml(n) + '</button>').join(', ') || '—') + '<br>Используется в: ' + (ED.m2.usedBy.map(n => '<button class="link" data-openq="' + escHtml(n) + '">' + escHtml(n) + '</button>').join(', ') || '—') + '</div>';
  } else if (ED.sideTab === 'doc'){
    const f = ED.cursorFn && M_REF.get(ED.cursorFn);
    box.innerHTML = f ? '<h2>' + escHtml(f.name) + '</h2><div class="sig">' + escHtml(refSignature(f)) + '</div><p>' + escHtml(f.desc) + '</p>' + (f.example ? '<h3>Пример</h3><pre class="code wrap">' + highlightM(f.example) + '</pre>' : '') + '<div class="row"><button class="btn sm" data-ref="' + escHtml(f.name) + '">Открыть в справочнике</button></div>' : '<div class="muted small">Поставьте курсор на функцию или внутрь её скобок — здесь появится справка. <kbd>F1</kbd> открывает справочник.</div>';
  } else {
    const L = ED.lint2 || [];
    box.innerHTML = L.length ? L.map(l => '<div class="ocard ' + l.sev + '" style="margin-bottom:8px;padding:8px 10px"><div class="where">' + (l.step ? '<button class="link" data-step="' + escHtml(l.step) + '">' + escHtml(l.step) + '</button>' : 'весь запрос') + ' · <span class="sev ' + l.sev + '">' + SEV_LABEL[l.sev] + '</span></div><div class="why">' + escHtml(l.msg) + '</div><div class="fix">' + escHtml(l.fix) + '</div></div>').join('') + '<button class="btn sm" data-go="optimizer">Все советы в оптимизаторе</button>' : '<div class="note ok small">Замечаний нет.</div>';
  }
  $$('[data-step]', box).forEach(x => x.onclick = () => edGotoStep(x.dataset.step));
  $$('[data-openq]', box).forEach(x => x.onclick = () => openInEditor(x.dataset.openq));
  $$('[data-ref]', box).forEach(x => x.onclick = () => openReference(x.dataset.ref));
  $$('[data-go]', box).forEach(x => x.onclick = () => showView(x.dataset.go));
}
function renderEdFlow(){
  const box = $('#edFlow'); if (!box) return;
  if (!ED.m2 || !ED.m2.steps){ box.innerHTML = '<span class="small muted">Поток шагов появится для запросов вида let…in.</span>'; return; }
  const heat = new Map((ED.heat2 ? ED.heat2.cells : []).map(c => [c.step, c]));
  box.innerHTML = ED.m2.steps.steps.map((s, i) => { const h = heat.get(s.name) || { level: 0, brk: false }; return (i ? '<span class="flow-arrow">→</span>' : '') + '<span class="flow-step' + (s.dead ? ' dead' : '') + (h.brk ? ' brk' : '') + '" data-step="' + escHtml(s.name) + '" style="box-shadow:inset 0 -3px 0 ' + heatColor(h.level) + '" title="' + escHtml((h.why || []).join(', ')) + '"><span>' + escHtml(s.name) + '</span><span class="fn">' + escHtml(s.fn || '—') + edStepBadge(s.name, true) + '</span></span>'; }).join('');
  $$('[data-step]', box).forEach(x => x.onclick = () => edGotoStep(x.dataset.step));
}
$('#edSideTabs').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b){ ED.sideTab = b.dataset.s; renderEdSide(); } });
$('#edFilter').addEventListener('input', renderEdList);
$('#edQList').addEventListener('click', async e => { const li = e.target.closest('[data-q]'); if (!li || li.dataset.q === ED.query) return; if (await edConfirmLeave()) edLoad(li.dataset.q); });
$('#edApply').onclick = edApply;
$('#edRevert').onclick = () => { if (ED.query) edLoad(ED.query); };
$('#edFormat').onclick = edFormat;
$('#edRun').onclick = async () => { if (await edConfirmLeave()){ showView('sandbox'); sbRunQuery(ED.query); } };
$('#edSnippet').onclick = () => { S.snipTarget = 'editor'; showView('snippets'); };
$('#edNew').onclick = () => newQueryDialog();
$$('[data-menu]').forEach(b => b.onclick = e => { e.stopPropagation(); const m = $('#' + b.dataset.menu); const on = !m.classList.contains('on'); $$('.menu.on').forEach(x => x.classList.remove('on')); m.classList.toggle('on', on); });
document.addEventListener('click', () => $$('.menu.on').forEach(x => x.classList.remove('on')));
async function newQueryDialog(){
  if (!S.work) return toast('Сначала откройте книгу', 'warn');
  if (!(await edConfirmLeave())) return;
  const name = await askText('Новый запрос', 'Имя запроса', freeQueryName(S.work, 'Запрос'));
  if (!name) return;
  try { setWork(addQuery(S.work, name, 'let\n    Источник = #table({"Столбец1"}, {{1}})\nin\n    Источник'), 'refactor', 'Новый запрос «' + name + '»'); openInEditor(name); } catch (e){ toast(e.message, 'bad'); }
}
$('#edRefMenu').addEventListener('click', async e => {
  const b = e.target.closest('[data-ref]'); if (!b || !ED.query) return;
  const act = b.dataset.ref;
  if (!(await edConfirmLeave())) return;
  const q = ED.query; const m = S.A.byName.get(q);
  try {
    if (act === 'renameStep'){
      const st = edStepAtCursor(); if (!st) return toast('Поставьте курсор на шаг', 'warn');
      const nn = await askText('Переименовать шаг', 'Новое имя шага «' + st.name + '»', st.name); if (!nn || nn === st.name) return;
      setWork(renameStep(S.work, q, st.name, nn), 'refactor', 'Шаг «' + st.name + '» → «' + nn + '»'); edLoad(q); edGotoStep(nn.trim());
    } else if (act === 'renameQuery'){
      const warn = (m.load.sheet || m.load.model) ? '<b style="color:var(--warn)">Запрос загружается на лист или в модель: в Excel связь с таблицей держится на имени запроса — после переименования таблица перестанет обновляться.</b>' : 'Все ссылки в других запросах будут обновлены.';
      const nn = await askText('Переименовать запрос', 'Новое имя «' + q + '»', q, warn); if (!nn || nn === q) return;
      setWork(renameQuery(S.work, q, nn), 'refactor', 'Запрос «' + q + '» → «' + nn + '»'); openInEditor(nn.trim());
    } else if (act === 'extract'){
      const st = edStepAtCursor(); if (!st) return toast('Поставьте курсор на последний шаг, который нужно вынести', 'warn');
      const nn = await askText('Вынести шаги в новый запрос', 'Шаги от начала до «' + st.name + '» станут новым запросом. Имя:', freeQueryName(S.work, q + '_База'), 'Удобно для промежуточных запросов: тяжёлый источник читается в одном месте, а ветки строятся от него.'); if (!nn) return;
      setWork(extractSteps(S.work, q, st.name, nn), 'refactor', 'Шаги «' + q + '» вынесены в «' + nn + '»'); edLoad(q);
    } else if (act === 'toFunction'){
      const sel = ED.view.state.selection.main; if (sel.empty) return toast('Выделите литерал (текст или число), который станет параметром', 'warn');
      const nn = await askText('Сделать функцией', 'Имя параметра функции', 'параметр', 'Запрос станет функцией. Если он загружается на лист, загрузка перестанет работать — обычно функцию вызывают из другого запроса.'); if (!nn) return;
      const lead = (/^[ \t]*\r?\n?/.exec(ED.baseRaw) || [''])[0].length;
      const a = m.exprStart + lead + toSectionText(edCurrentText().slice(0, sel.from)).length, bb = m.exprStart + lead + toSectionText(edCurrentText().slice(0, sel.to)).length;
      setWork(toFunction(S.work, q, a, bb, nn), 'refactor', '«' + q + '» → функция'); edLoad(q);
    } else if (act === 'duplicate'){
      const nn = await askText('Дублировать запрос', 'Имя копии', freeQueryName(S.work, q + ' (копия)')); if (!nn) return;
      setWork(duplicateQuery(S.work, q, nn), 'refactor', 'Копия «' + q + '»'); openInEditor(nn.trim());
    } else if (act === 'delete'){
      const used = m.usedBy.length ? '<p class="note bad small">На него ссылаются: ' + m.usedBy.map(escHtml).join(', ') + ' — они перестанут работать.</p>' : '';
      const r = await modal('<h2>Удалить запрос «' + escHtml(q) + '»?</h2>' + used + ((m.load.sheet || m.load.model) ? '<p class="small">Таблица на листе останется, но перестанет обновляться.</p>' : '') + '<p class="small muted">Удаление можно отменить в «Истории правок».</p>', [['cancel', 'Отмена', 'pri'], ['go', 'Удалить', 'danger']]);
      if (r !== 'go') return; setWork(deleteQuery(S.work, q), 'refactor', 'Удалён «' + q + '»'); ED.query = null; renderEditor('work');
    }
  } catch (err){ toast(err.message, 'bad', 7000); }
});
async function openInEditor(name, step){
  showView('editor');
  if (ED.query !== name && !(await edConfirmLeave())) return;
  edLoad(name); if (step) setTimeout(() => edGotoStep(step), 30);
}
function renderEditor(reason){
  if (!S.A) return;
  if (!ED.query || !S.A.byName.has(ED.query)) { const first = S.sel && S.A.byName.has(S.sel) ? S.sel : (S.A.members[0] || {}).name; if (first) edLoad(first); return; }
  if (reason === 'work' || reason === 'book' || reason === 'show'){
    const m = S.A.byName.get(ED.query); const nowRaw = S.work.slice(m.exprStart, m.exprEnd);
    if (nowRaw !== ED.baseRaw && !edDirty()) edLoad(ED.query); else { renderEdList(); edAnalyze(edCurrentText()); renderEdSide(); renderEdFlow(); }
  } else renderEdList();
}
/* ---- Живые данные: шаг под курсором вычисляется на таблицах книги и выгрузках (только в браузере) ----
   Вычисляется текст редактора, даже не применённый; запросы, на которые он ссылается, — по рабочей
   версии один раз (кэш по версии кода и данных). Долгий прогон (> 3 с) переводит панель в ручной режим. */
const EDD = { on: pqmSettings().edData !== false, res: null, key: null, step: null, busy: false, manual: false, ms: 0, up: new Map(), upKey: null, prof: new WeakMap() };
function edDataSchedule(){ clearTimeout(EDD.t); if (EDD.on && !EDD.manual) EDD.t = setTimeout(() => edDataRun(false), 600); else edDataRender(); }
/** Результаты запросов, от которых зависит текущий (рабочая версия; из «Проверки на данных», если она свежая) */
function edUpstream(m){
  const key = S.work + '\u0001' + DATA.ver + '\u0001' + DATA.limit;
  if (EDD.upKey !== key){ EDD.up = new Map(); EDD.upKey = key; }
  if (dataRunValid()) for (const q of DATA.run.queries) if (q.value != null && !EDD.up.has(q.name)) EDD.up.set(q.name, q.value);
  const need = new Set(); const walk = n => { const x = S.A.byName.get(n); if (!x) return; for (const r of x.refs) if (r !== m.name && !need.has(r) && S.A.byName.has(r)){ need.add(r); walk(r); } }; walk(m.name);
  for (const x of dataOrder([...need].map(n => S.A.byName.get(n)).filter(x => !x.isFn && !x.isParam))) if (!EDD.up.has(x.name)){ const r = dataRunQuery(S.work, x.name, EDD.up); if (r.value != null) EDD.up.set(x.name, r.value); }
  return EDD.up;
}
async function edDataRun(force){
  if (!EDD.on || !ED.query || !S.A || EDD.busy) return;
  const m = S.A.byName.get(ED.query); if (!m || m.isFn) { EDD.res = null; edDataRender(); return; }
  const temp = S.work.slice(0, m.exprStart) + ' ' + safeExprEnd(edCurrentText()) + S.work.slice(m.exprEnd);
  const key = temp + '\u0001' + ED.query + '\u0001' + DATA.ver + '\u0001' + DATA.limit;
  if (!force && EDD.key === key){ edDataRender(); return; }
  EDD.busy = true; edDataRender();
  try {
    await dataPrepare();
    const t0 = performance.now(); const up = edUpstream(m);
    const t1 = performance.now(); EDD.res = dataRunQuery(temp, ED.query, up); EDD.key = key;
    EDD.ms = performance.now() - t1; EDD.upMs = t1 - t0; EDD.manual = EDD.ms > 3000;
  } catch (e){ EDD.res = { error: { reason: e.reason || 'Error', message: e.message }, steps: [], joins: [] }; }
  finally { EDD.busy = false; }
  edDataRender(); renderEdSide(); renderEdFlow();
}
/** Строк на шаге (бейдж в списке шагов и в потоке) */
function edStepBadge(name, small){
  if (!EDD.on || !EDD.res || EDD.key == null) return '';
  const st = EDD.res.steps.find(x => x.name === name); if (!st) return '';
  if (st.error) return '<span class="rows bad" title="' + escHtml(st.error.message) + '">' + (st.error.need ? '🔌' : '✖') + '</span>';
  return st.rows != null ? '<span class="rows' + (small ? ' sm' : '') + '" title="строк × столбцов на данных">' + fmtN(st.rows) + (small ? '' : ' × ' + st.cols) + '</span>' : '';
}
function edProfile(t){ let p = EDD.prof.get(t); if (!p){ p = tableProfile(t); EDD.prof.set(t, p); } return p; }
function edDataRender(){
  const box = $('#edData'); if (!box) return;
  box.classList.toggle('hidden', !EDD.on); $('#edDataBtn').classList.toggle('on', EDD.on);
  if (!EDD.on) return;
  const r = EDD.res; const stale = EDD.busy || !r || EDD.key == null;
  const pick = r && r.steps.length ? (r.steps.find(x => x.name === EDD.step) || r.steps[r.steps.length - 1]) : null;
  let h = '<div class="edd-h"><b>' + (pick ? escHtml(pick.name === 'in → результат' ? 'Результат запроса' : 'Шаг «' + pick.name + '»') : 'Данные') + '</b>';
  if (EDD.busy) h += '<span class="small muted">⏳ вычисление…</span>';
  else if (pick && !pick.error && pick.rows != null) h += '<span class="chip">' + fmtN(pick.rows) + ' строк × ' + pick.cols + ' столбцов</span><span class="small muted">' + (pick.ms || 0).toFixed(0) + ' мс · запрос ' + (EDD.ms / 1000).toFixed(2).replace('.', ',') + ' с</span>';
  h += '<span class="sp"></span>' + (EDD.manual ? '<span class="small muted">долгий прогон — обновление вручную</span>' : '') + '<button class="btn sm' + (hideVals() ? ' on' : '') + '" id="eddHide" title="Скрыть значения на экране (для демонстрации): одинаковые значения — одинаковый код. Вычисления — на реальных данных">' + (hideVals() ? '🙈 скрыты' : '👁 значения') + '</button><button class="btn sm" id="eddRefresh" title="Пересчитать (данные и текст редактора)">↻</button><button class="btn sm" id="eddGoData" title="Раздел «Проверка на данных»: источники, проверки">Источники…</button></div>';
  if (!pick){ h += '<div class="small muted pad">' + (stale ? 'Данные шага под курсором появятся здесь.' : 'Нет шагов для показа.') + '</div>'; box.innerHTML = h; edDataWire(); return; }
  if (pick.error){
    const need = pick.error.need;
    h += '<div class="note ' + (pick.error.reason === 'DataSource.Error' ? 'warn' : 'bad') + ' small"><b>' + escHtml(pick.error.reason) + '</b> ' + escHtml(pick.error.message) +
      (need && need.kind !== 'workbook' ? ' <button class="btn sm pri" data-eattach="' + escHtml(need.kind) + '" data-path="' + escHtml(need.path) + '">' + (need.kind === 'folder' ? 'Прикрепить файлы папки…' : 'Прикрепить файл…') + '</button>' : '') +
      (pick.error.reason === 'DataSource.Error' && (!need || need.kind === 'workbook') ? ' <span class="muted">База или веб недоступны без сети — подмените шаг выгрузкой в «Песочнице».</span>' : '') + '</div>';
    box.innerHTML = h; edDataWire(); return;
  }
  // инсайты шага: слияния и рост строк
  const ins = [];
  for (const j of (r.joins || []).filter(j => j.step === pick.name)){
    if (j.dupKeys) ins.push(['warn', 'дубли ключей справа: ' + fmtN(j.dupKeys) + ' (' + fmtN(j.dupRows) + ' строк) — строки размножатся']);
    if (j.miss) ins.push([j.miss / j.left > 0.05 ? 'warn' : 'info', 'без пары: ' + fmtN(j.miss) + ' из ' + fmtN(j.left) + ' (' + pct(j.miss, j.left) + ')']);
    if (j.typeA && j.typeB && j.typeA !== j.typeB) ins.push(['warn', 'типы ключей: ' + j.typeA + ' ↔ ' + j.typeB]);
  }
  const i = r.steps.indexOf(pick); const prev = r.steps.slice(0, i).reverse().find(x => x.rows != null);
  if (prev && pick.rows != null && prev.rows !== pick.rows) ins.push([pick.rows > prev.rows * 1.5 && prev.rows >= 100 ? 'warn' : 'info', 'строк: ' + fmtN(prev.rows) + ' → ' + fmtN(pick.rows)]);
  if (ins.length) h += '<div class="edd-ins">' + ins.map(([sv, t]) => '<span class="pqx-rec ' + (sv === 'warn' ? 'warn' : 'ok') + '">' + escHtml(t) + '</span>').join(' ') + '</div>';
  const v = pick.value;
  if (v instanceof MTab){
    const prof = edProfile(v); const COLS = 40, ROWS = 50;
    h += '<div class="edd-table"><table class="val-table"><tr><th></th>' + v.cols.slice(0, COLS).map((c, k) => { const p = prof[k]; return '<th title="' + escHtml(c + '\nтипы: ' + p.types + '\nпустых: ' + pct(p.nulls, p.rows) + '\nразличных: ' + fmtN(p.distinct) + (p.errs ? '\nошибок: ' + p.errs : '') + (p.txtNum ? '\nчисла-текстом: ' + p.txtNum : '') + (p.spaces ? '\nпробелы по краям: ' + p.spaces : '')) + '">' + escHtml(c) + '<div class="ct">' + escHtml(p.types.split(',')[0]) + (p.nulls ? ' · ∅' + pct(p.nulls, p.rows) : '') + (p.errs ? ' · <b class="bad">⚠' + p.errs + '</b>' : '') + '</div></th>'; }).join('') + (v.cols.length > COLS ? '<th>… ещё ' + (v.cols.length - COLS) + '</th>' : '') + '</tr>' +
      v.rows.slice(0, ROWS).map((row, ri) => '<tr><td class="val-null">' + (ri + 1) + '</td>' + row.slice(0, COLS).map(x => { try { x = force(x); } catch (e){ return '<td class="val-err" title="' + escHtml(e.message || '') + '">Error</td>'; } return x === null ? '<td class="val-null">null</td>' : typeof x === 'number' ? '<td class="num">' + escHtml(dispVal(x)) + '</td>' : x instanceof MTab ? '<td class="val-null">[Table ' + x.rows.length + ']</td>' : x instanceof MRec ? '<td class="val-null">[Record]</td>' : Array.isArray(x) ? '<td class="val-null">[List ' + x.length + ']</td>' : '<td>' + escHtml(dispVal(x).slice(0, 200)) + '</td>'; }).join('') + '</tr>').join('') + '</table></div>' +
      (v.rows.length > ROWS ? '<div class="small muted pad">показаны первые ' + ROWS + ' из ' + fmtN(v.rows.length) + ' строк</div>' : '');
  } else h += '<div class="sb-out">' + mRender(v) + '</div>';
  box.innerHTML = h; edDataWire();
}
function edDataWire(){
  if ($('#eddRefresh')) $('#eddRefresh').onclick = () => { EDD.manual = false; EDD.key = null; EDD.upKey = null; edDataRun(true); };
  if ($('#eddGoData')) $('#eddGoData').onclick = () => showView('data');
  if ($('#eddHide')) $('#eddHide').onclick = () => { saveSettings({ hideValues: !hideVals() }); emitState('settings'); edDataRender(); };
  $$('[data-eattach]', $('#edData')).forEach(b => b.onclick = async () => { const folder = b.dataset.eattach === 'folder'; const fs = await pickFiles(folder); if (!fs.length) return; await attachFiles(fs, b.dataset.path, folder ? 'folder' : 'file'); EDD.key = null; edDataRun(true); });
}
$('#edDataBtn').onclick = () => { EDD.on = !EDD.on; saveSettings({ edData: EDD.on }); EDD.manual = false; if (EDD.on) edDataRun(true); else { edDataRender(); renderEdSide(); renderEdFlow(); } };
onState(reason => { if (reason === 'data' || reason === 'work' || reason === 'book'){ EDD.key = null; EDD.upKey = null; if (curView === 'editor') edDataSchedule(); } });
registerView('editor', { render: renderEditor, onShow: () => setTimeout(() => ED.view && ED.view.requestMeasure(), 0), alwaysRender: true });
