/* =====================================================================
   app/state.js — глобальное состояние S, рабочая версия кода и история правок.
   Любое изменение кода книги идёт ТОЛЬКО через setWork(text, src, label):
   так оно попадает в историю, пересчитывается анализ и обновляются все виды.
   Подписка на изменения: onState(fn) — fn(reason) вызывается после пересчёта.
   ===================================================================== */
const S = {
  book: null,            // загруженная книга (см. core/zip-mashup.js loadBookFromBytes)
  work: null,            // рабочая версия Section1.m (текст)
  saved: null,           // текст, который сейчас лежит в файле (для индикатора «изменено»)
  A: null,               // анализ рабочей версии (m/lang.js analyzeSection)
  lint: [],              // замечания линтера (opt/lint.js)
  opt: null,             // результат оптимизатора (opt/optimizer.js)
  cfg: defaultConfig(),  // настройки обезличивания (nda/anon.js)
  dict: new TokenDict(), dictSource: 'новый',
  anon: null, scan: null, sel: null,
  diag: [], samples: [], dateShift: 0, numSalt: '',
  aiNew: null,           // проверенный ответ ИИ, ожидающий «Принять»
  cmpA: null, cmpB: null,
  exch: null, inbox: [], seenIn: new Set(), audit: [], outLog: [],
  hist: [], histPos: -1   // история правок рабочей версии
};
S.dateShift = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 700) - 350;
S.numSalt = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16)).join('');

const _listeners = [];
function onState(fn){ _listeners.push(fn); }
function emitState(reason){ for (const f of _listeners){ try { f(reason); } catch (e){ console.error(e); } } }

/** Пересчитать анализ, линтер и оптимизатор для текущей рабочей версии */
function reanalyze(){
  if (!S.work){ S.A = null; S.lint = []; S.opt = null; return; }
  S.A = analyzeSection(S.work, S.book ? S.book.meta : {});
  S.lint = lintSection(S.A);
  S.opt = optimizeSection(S.work, S.A, S.lint);
  if (!S.sel || !S.A.byName.has(S.sel)) S.sel = S.A.members[0] ? S.A.members[0].name : null;
}
const HIST_SRC = { open: 'открыто', editor: 'редактор', optimizer: 'оптимизатор', ai: 'ответ ИИ', param: 'параметризатор', refactor: 'рефакторинг', snippet: 'сниппет', undo: 'откат', save: 'сохранено' };
/** Единственная точка изменения рабочей версии */
function setWork(text, src, label){
  if (text === S.work) return false;
  S.hist = S.hist.slice(0, S.histPos + 1);
  S.hist.push({ t: new Date(), src, label: label || HIST_SRC[src] || src, text });
  if (S.hist.length > 200) S.hist.shift();
  S.histPos = S.hist.length - 1;
  S.work = text;
  reanalyze(); emitState('work');
  return true;
}
function histGo(pos){
  if (pos < 0 || pos >= S.hist.length) return;
  S.histPos = pos; S.work = S.hist[pos].text; reanalyze(); emitState('work');
}
const canUndo = () => S.histPos > 0;
const canRedo = () => S.histPos >= 0 && S.histPos < S.hist.length - 1;
const isDirty = () => !!S.book && S.work !== S.saved;
function initBookState(book){
  S.book = book; S.work = book.origSection; S.saved = book.origSection; S.sel = null; S.aiNew = null;
  S.hist = [{ t: new Date(), src: 'open', label: 'Открыта «' + book.name + '»', text: book.origSection }]; S.histPos = 0;
  reanalyze(); emitState('book');
}
function closeBookState(){
  S.book = null; S.work = null; S.saved = null; S.A = null; S.lint = []; S.opt = null; S.anon = null; S.scan = null; S.hist = []; S.histPos = -1;
  emitState('book');
}
