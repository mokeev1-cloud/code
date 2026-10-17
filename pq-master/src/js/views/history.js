/* =====================================================================
   views/history.js — лента версий рабочей версии с diff и откатом.
   ===================================================================== */
let HIST_SEL = null;
const HIST_ICON = { open: '📂', editor: '✎', optimizer: '⚡', ai: '🤖', param: '⚙', refactor: '🔧', snippet: '🧩', undo: '↶', save: '💾' };
function renderHistory(){
  if (!S.book) return;
  if (HIST_SEL == null || HIST_SEL >= S.hist.length) HIST_SEL = S.histPos;
  $('#histList').innerHTML = S.hist.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => '<div class="hi' + (i === HIST_SEL ? ' on' : '') + (i === S.histPos ? ' cur' : '') + '" data-h="' + i + '"><span>' + (HIST_ICON[h.src] || '•') + '</span><div style="flex:1"><div>' + escHtml(h.label) + '</div><div class="small muted">' + fmtTime(h.t) + ' · <span class="src">' + escHtml(HIST_SRC[h.src] || h.src) + '</span>' + (i === S.histPos ? ' · <b>текущая</b>' : '') + (i > S.histPos ? ' · отменено' : '') + '</div></div></div>').join('');
  $$('[data-h]', $('#histList')).forEach(x => x.onclick = () => { HIST_SEL = +x.dataset.h; renderHistory(); });
  const cur = S.hist[HIST_SEL], prev = S.hist[HIST_SEL - 1];
  if (!cur){ $('#histDiff').innerHTML = ''; return; }
  const c = prev ? compareSections(prev.text, cur.text) : null;
  $('#histDiff').innerHTML = '<div class="card-h"><h2>' + escHtml(cur.label) + '</h2><span class="sp"></span>' + (HIST_SEL !== S.histPos ? '<button class="btn pri" id="histGo">Вернуться к этой версии</button>' : '<span class="badge acc">текущая версия</span>') + '<button class="btn" id="histVsCur" title="Сравнить эту версию с текущей">Сравнить с текущей</button></div>' +
    (c ? (c.changed.length + c.added.length + c.removed.length ? c.changed.map(x => '<h3>✎ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div>').join('') + c.added.map(x => '<h3>＋ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff('', x.text)) + '</div>').join('') + c.removed.map(x => '<h3>－ ' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, '')) + '</div>').join('') : '<div class="muted small">Изменений в коде нет.</div>') : '<div class="muted small">Исходная версия книги.</div>');
  if ($('#histGo')) $('#histGo').onclick = () => histGo(HIST_SEL);
  $('#histVsCur').onclick = () => { const a = cur.text, b = S.work; const cc = compareSections(a, b); modal('<h2>Эта версия → текущая</h2>' + (cc.changed.map(x => '<h3>' + escHtml(x.name) + '</h3><div class="diff">' + diffHtml(lineDiff(x.old, x.text)) + '</div>').join('') + cc.added.map(x => '<h3>＋ ' + escHtml(x.name) + '</h3>').join('') + cc.removed.map(x => '<h3>－ ' + escHtml(x.name) + '</h3>').join('') || '<p>Различий нет.</p>'), null, { wide: true }); };
}
registerView('history', { render: () => { HIST_SEL = null; renderHistory(); } });
