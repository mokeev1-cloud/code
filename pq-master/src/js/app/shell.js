/* =====================================================================
   app/shell.js — оболочка: навигация, виды, верхняя панель, строка состояния,
   палитра команд (Ctrl+K), горячие клавиши, настройки, тема.
   Виды регистрируются через registerView(id, { render(reason), onShow() }).
   render вызывается для активного вида при каждом emitState; неактивные
   помечаются «устаревшими» и перерисовываются при показе.
   ===================================================================== */
const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>', code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6.5l9 4.5M7.5 17.5l9-4.5"/>', play: '<path d="M6 4l14 8-14 8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', book: '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-5a3 3 0 00-3 3"/><path d="M20 4v14h-6"/>',
  puzzle: '<path d="M10 3h4v3a2 2 0 104 0V3h3v7h-3a2 2 0 100 4h3v7h-7v-3a2 2 0 10-4 0v3H3v-7h3a2 2 0 100-4H3V3z"/>', doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  diff: '<path d="M6 3v12M3 6h6M15 18h6M18 9v12"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/>', shield: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 016 6v4"/>', robot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17h.01"/>', check: '<path d="M4 12l5 5L20 6"/>', map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>'
};
const icon = n => '<svg viewBox="0 0 24 24">' + (ICONS[n] || '') + '</svg>';
const NAV = [
  { g: 'Книга' },
  { id: 'home', icon: 'home', label: 'Обзор', hk: 'Alt+1' },
  { id: 'model', icon: 'map', label: 'Карта модели' },
  { id: 'data', icon: 'table', label: 'Проверка на данных', cnt: () => dataRunValid() ? DATA.run.findings.filter(f => f.sev !== 'info').length : 0 },
  { id: 'optimizer', icon: 'bolt', label: 'Оптимизатор', hk: 'Alt+3', cnt: () => S.opt ? S.opt.findings.filter(f => f.sev === 'err' || f.sev === 'warn').length : 0, cls: () => S.opt && S.opt.findings.some(f => f.sev === 'err') ? 'bad' : 'warn' },
  { id: 'editor', icon: 'code', label: 'Редактор', hk: 'Alt+2', cnt: () => S.A ? S.A.members.length : 0 },
  { id: 'sandbox', icon: 'play', label: 'Песочница', hk: 'Alt+5' },
  { id: 'graph', icon: 'graph', label: 'Граф и параметры', hk: 'Alt+4' },
  { id: 'history', icon: 'clock', label: 'История правок', cnt: () => Math.max(0, S.hist.length - 1) },
  { g: 'Инструменты' },
  { id: 'reference', icon: 'book', label: 'Справочник M' },
  { id: 'snippets', icon: 'puzzle', label: 'Сниппеты и мастера' },
  { id: 'docs', icon: 'doc', label: 'Документация книги' },
  { id: 'compare', icon: 'diff', label: 'Сравнение версий' },
  { g: 'NDA и ИИ' },
  { id: 'anon', icon: 'shield', label: 'Обезличивание', hk: 'Alt+6' },
  { id: 'diag', icon: 'pulse', label: 'Диагностика' },
  { id: 'ai', icon: 'reply', label: 'Ответ ИИ' },
  { id: 'agent', icon: 'robot', label: 'Агент (Claude Code)' },
  { g: 'Справка' },
  { id: 'help', icon: 'help', label: 'Справка', hk: 'F1' },
  { id: 'selftest', icon: 'check', label: 'Самотест' }
];
const VIEWS = {}; const _stale = new Set();
function registerView(id, v){ VIEWS[id] = v; }
let curView = 'home';
function showView(id){
  if (!VIEWS[id] && !document.getElementById('view-' + id)) return;
  curView = id; S.lastView = id;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + id));
  renderNav();
  renderHint(id);
  const v = VIEWS[id]; if (v){ if (v.onShow) v.onShow(); if (_stale.has(id) || v.alwaysRender){ _stale.delete(id); if (v.render) v.render('show'); } }
  $('#main').scrollTop = 0;
}
function renderNav(){
  $('#sidebar').innerHTML = NAV.map(n => n.g ? '<div class="nav-group">' + n.g + '</div>' :
    '<button class="nav-item' + (n.id === curView ? ' on' : '') + '" data-view="' + n.id + '" title="' + n.label + (n.hk ? ' (' + n.hk + ')' : '') + '">' + icon(n.icon) + '<span>' + n.label + '</span>' + (n.cnt && n.cnt() ? '<b class="cnt ' + (n.cls ? n.cls() : '') + '">' + n.cnt() + '</b>' : '') + (n.hk ? '<span class="hk">' + n.hk + '</span>' : '') + '</button>').join('');
}
$('#sidebar').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b){ showView(b.dataset.view); if (innerWidth < 860) $('#app').classList.remove('sb-open'); } });
$('#sbToggle').onclick = () => { if (innerWidth < 860){ $('#app').classList.toggle('sb-open'); return; } const c = !$('#app').classList.contains('sb-collapsed'); $('#app').classList.toggle('sb-collapsed', c); saveSettings({ sbCollapsed: c }); };

/* ---- реакция на изменения состояния ---- */
onState(reason => {
  document.body.classList.toggle('nobook', !S.book);
  renderTopbar(); renderStatus(); renderNav();
  for (const id of Object.keys(VIEWS)){ if (id === curView){ if (VIEWS[id].render) VIEWS[id].render(reason); } else _stale.add(id); }
});
function renderTopbar(){
  const chip = $('#bookChip'); chip.classList.toggle('open', !!S.book); chip.classList.toggle('dirty', isDirty());
  $('#bookName').textContent = S.book ? S.book.name + (isDirty() ? ' • изменено' : '') : 'книга не открыта';
  chip.title = S.book ? (isDirty() ? 'Есть изменения, не записанные в файл' : 'Рабочая версия совпадает с файлом') : '';
  $('#tbSave').disabled = !S.book; $('#tbSaveOrig').disabled = !S.book || !S.book.handle || S.book.container === 'text';
  $('#tbSaveOrig').title = S.book && !S.book.handle ? 'Откройте книгу кнопкой «Открыть» или перетаскиванием в Chrome/Edge, чтобы записывать в оригинал' : 'Записать в исходный файл, предварительно сделав резервную копию (Ctrl+Shift+S)';
  $('#tbUndo').disabled = !canUndo(); $('#tbRedo').disabled = !canRedo();
  if (canUndo()) $('#tbUndo').title = 'Отменить: ' + S.hist[S.histPos].label + ' (Ctrl+Alt+Z)';
  document.title = S.book ? (isDirty() ? '• ' : '') + S.book.name + ' — Мастер PQ' : 'Мастер PQ';
}
function renderStatus(){
  const parts = [];
  if (S.book){
    const e = S.lint.filter(l => l.sev === 'err').length, w = S.lint.filter(l => l.sev === 'warn').length;
    parts.push('<span>' + escHtml(S.book.name) + '</span>', '<span>запросов: <b>' + S.A.members.length + '</b></span>',
      '<button class="st-btn" data-go="optimizer">оценка <b>' + (S.opt ? S.opt.score : '—') + '</b> · ошибок ' + e + ' · предупреждений ' + w + '</button>',
      '<button class="st-btn" data-go="history">' + (isDirty() ? '<b style="color:var(--warn)">● не записано в файл</b>' : 'сохранено') + ' · правок: ' + Math.max(0, S.hist.length - 1) + '</button>');
    if (S.lastCopy) parts.push('<span>копия: ' + fmtTime(S.lastCopy) + '</span>');
  } else parts.push('<span>Книга не открыта</span>');
  parts.push('<span class="sp"></span><span>🔒 сеть запрещена CSP</span><button class="st-btn" data-cmd="palette">Ctrl+K — команды</button>');
  $('#statusbar').innerHTML = parts.join('');
}
$('#statusbar').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showView(b.dataset.go); if (e.target.closest('[data-cmd=palette]')) openPalette(); });

/* ---- верхняя панель ---- */
$('#tbOpen').onclick = openBookDialog;
$('#tbSave').onclick = saveCopy;
$('#tbSaveOrig').onclick = saveToOriginal;
$('#tbUndo').onclick = () => histGo(S.histPos - 1);
$('#tbRedo').onclick = () => histGo(S.histPos + 1);
$('#tbPalette').onclick = () => openPalette();
$('#tbSettings').onclick = openSettings;
const THEMES = [['system', 'Как в системе', 'linear-gradient(135deg,#fff 50%,#1a1e26 50%)'], ['light', 'Классика', 'linear-gradient(135deg,#2f6fde,#7b2fb5)'], ['calm', 'Спокойная', 'linear-gradient(135deg,#f6f6f5,#2b2b2b)'], ['dark', 'Тёмная', 'linear-gradient(135deg,#12151b,#6a9dff)'], ['fun', 'Весёлая', 'linear-gradient(135deg,#ff7a1a,#1e9bff)']];
function applyTheme(){ const t = pqmSettings().theme; if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; }
function setTheme(t){ saveSettings({ theme: t }); applyTheme(); renderThemeMenu(); }
function renderThemeMenu(){ const cur = pqmSettings().theme; $('#themeMenu').innerHTML = THEMES.map(([id, label, sw]) => '<button data-theme-id="' + id + '"><span class="swatch" style="background:' + sw + '"></span>' + label + (id === cur ? ' ✓' : '') + '</button>').join(''); }
$('#tbTheme').onclick = e => { e.stopPropagation(); renderThemeMenu(); const m = $('#themeMenu'); const on = !m.classList.contains('on'); $$('.menu.on').forEach(x => x.classList.remove('on')); m.classList.toggle('on', on); };
$('#themeMenu').addEventListener('click', e => { const b = e.target.closest('[data-theme-id]'); if (b){ setTheme(b.dataset.themeId); $('#themeMenu').classList.remove('on'); } });
$('#fileOpen').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFromFile(f); });
window.addEventListener('dragover', e => { if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault(); });
window.addEventListener('drop', e => { if (e.target.closest && e.target.closest('.drop')) return; e.preventDefault(); if (curView === 'diag'){ addDiagFiles([...e.dataTransfer.files]); return; } handleDrop(e); });
window.addEventListener('beforeunload', e => { if (isDirty()){ e.preventDefault(); e.returnValue = ''; } });

async function openSettings(){
  const s = pqmSettings();
  const p = modal('<h2>Настройки</h2><div class="form-grid">' +
    '<span>Тема</span><select id="stTheme">' + THEMES.map(([id, l]) => '<option value="' + id + '">' + l + '</option>').join('') + '</select>' +
    '<span>Подсказки</span><label><input type="checkbox" id="stHints"> показывать подсказки в разделах</label>' +
    '<span>Культура для исправлений</span><select id="stCulture">' + ['ru-RU', 'en-US', 'de-DE', 'kk-KZ', 'uk-UA', 'be-BY'].map(c => '<option>' + c + '</option>').join('') + '</select>' +
    '<span>Кодировка CSV по умолчанию</span><select id="stEnc"><option value="65001">UTF-8 (65001)</option><option value="1251">Windows-1251</option></select>' +
    '<span>Шрифт редактора, px</span><input type="number" id="stFont" min="10" max="22" step="0.5" style="width:90px">' +
    '<span>Недавние файлы</span><label><input type="checkbox" id="stRecent"> запоминать (только ссылки на файлы, без содержимого)</label>' +
    '<span>Запись в оригинал</span><label><input type="checkbox" id="stBackup"> сначала сохранять резервную копию</label>' +
    '</div><div class="row"><button class="btn danger" id="stClearRecent">Очистить список недавних</button><button class="btn danger" id="stReset">Сбросить все настройки</button></div>', [['cancel', 'Отмена'], ['ok', 'Сохранить', 'pri']]);
  $('#stTheme').value = s.theme; $('#stCulture').value = s.cultureLocale; $('#stEnc').value = String(s.csvEncoding); $('#stFont').value = s.editorFont; $('#stRecent').checked = s.rememberRecent; $('#stBackup').checked = s.backupOnSave; $('#stHints').checked = s.hints !== false;
  $('#stClearRecent').onclick = async () => { await recentClear(); toast('Список недавних файлов очищен', 'ok'); if (VIEWS.home) VIEWS.home.render('recent'); };
  $('#stReset').onclick = () => { try { localStorage.removeItem('pqm-settings'); } catch { /* нет */ } _settings = null; applyTheme(); toast('Настройки сброшены'); };
  if ((await p) !== 'ok') return;
  saveSettings({ theme: $('#stTheme').value, cultureLocale: $('#stCulture').value, csvEncoding: +$('#stEnc').value, editorFont: +$('#stFont').value || 13.5, rememberRecent: $('#stRecent').checked, backupOnSave: $('#stBackup').checked, hints: $('#stHints').checked });
  if ($('#stHints').checked) resetHints(); renderHint(curView);
  if (!$('#stRecent').checked) await recentClear();
  applyTheme(); if (typeof applyEditorFont === 'function') applyEditorFont();
  if (S.work){ reanalyze(); emitState('settings'); }
  toast('Настройки сохранены', 'ok');
}

/* ---- Палитра команд ---- */
function commands(){
  const C = [];
  const c = (label, run, opts) => C.push(Object.assign({ kind: 'команда', label, run }, opts || {}));
  c('Открыть книгу…', openBookDialog, { hk: 'Ctrl+O' });
  c('Открыть демо-книгу', openDemo);
  if (S.book){
    c('Сохранить копию книги', saveCopy, { hk: 'Ctrl+S' });
    c('Записать в оригинал (с резервной копией)', saveToOriginal, { hk: 'Ctrl+Shift+S' });
    if (canUndo()) c('Отменить: ' + S.hist[S.histPos].label, () => histGo(S.histPos - 1), { hk: 'Ctrl+Alt+Z' });
    if (canRedo()) c('Вернуть изменение', () => histGo(S.histPos + 1), { hk: 'Ctrl+Alt+Y' });
    c('Применить все безопасные исправления оптимизатора', applyAllSafe);
    c('⚡ Ускорить книгу (мастер)', () => openSpeedup());
    if (SPD.last) c('Отчёт об ускорении (последний)', showSpeedReport);
    c('Проверить запросы на данных (локально)', () => { showView('data'); dataRunAll(); });
    if (S.book.family !== 'text') c('Оптимизировать настройки PQ и Excel (подключения, макрос, параметры)', () => { showView('optimizer'); openPqSettings(); });
    c('Форматировать все запросы', formatAllQueries);
    c('Новый запрос…', () => { showView('editor'); newQueryDialog(); });
    c('Обезличенный код → в буфер обмена', () => { showView('anon'); $('#copyAnon').click(); });
    c('Пакет для ИИ (.json)', () => { showView('anon'); $('#dlPkg').click(); });
    c('Документация книги (HTML)', () => { showView('docs'); $('#docHtml').click(); });
    c('Закрыть книгу', closeBook);
  }
  for (const [id, l] of THEMES) c('Тема: ' + l, () => setTheme(id));
  c('Показать подсказки разделов снова', () => { saveSettings({ hints: true }); resetHints(); renderHint(curView); });
  c('Настройки', openSettings);
  c('Запустить самотест', () => { showView('selftest'); $('#runSelfTest').click(); });
  for (const n of NAV) if (n.id) c('Перейти: ' + n.label, () => showView(n.id), { kind: 'раздел', hk: n.hk });
  return C;
}
function paletteItems(q){
  const items = [];
  const mode = q[0] === '>' ? 'cmd' : q[0] === '@' ? 'step' : q[0] === '?' ? 'fn' : 'all';
  const text = mode === 'all' ? q : q.slice(1);
  if (mode === 'all' || mode === 'cmd') items.push(...commands());
  if (S.A && (mode === 'all')) for (const m of S.A.members) items.push({ kind: 'запрос', label: m.name, sub: (m.isParam ? 'параметр' : m.isFn ? 'функция' : (m.sources[0] || '')) + (m.steps ? ' · ' + m.steps.steps.length + ' шагов' : ''), run: () => openInEditor(m.name) });
  if (S.A && (mode === 'all' || mode === 'step')) for (const m of S.A.members) if (m.steps) for (const s of m.steps.steps) items.push({ kind: 'шаг', label: s.name, sub: m.name + ' · ' + s.fn, run: () => openInEditor(m.name, s.name) });
  if (mode === 'all' || mode === 'fn') for (const f of M_REF.values()) items.push({ kind: 'функция', label: f.name, sub: f.desc, run: () => openReference(f.name) });
  if (mode === 'all') for (const sn of SNIPPETS) items.push({ kind: 'сниппет', label: sn.title, sub: sn.desc, run: () => { showView('snippets'); selectSnippet(sn.id); } });
  if (!text.trim()) return items.filter(x => x.kind === 'команда' || x.kind === 'раздел' || (mode !== 'all' && true)).slice(0, 60);
  const scored = [];
  for (const it of items){ const sc = fuzzyScore(text, it.label); if (sc > 0) scored.push([sc + (it.kind === 'команда' ? 5 : it.kind === 'запрос' ? 4 : 0), it]); else if (it.sub && it.sub.toLowerCase().includes(text.toLowerCase())) scored.push([1, it]); }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 80).map(x => x[1]);
}
function fuzzyScore(q, s){
  q = q.toLowerCase(); s = s.toLowerCase(); if (!q) return 1;
  const p = s.indexOf(q); if (p >= 0) return 100 - p + (p === 0 ? 50 : 0);
  let i = 0, score = 0, last = -1;
  for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]){ score += k === last + 1 ? 3 : 1; last = k; i++; }
  return i === q.length ? score : 0;
}
function fuzzyMark(q, s){
  const l = s.toLowerCase(), qq = q.toLowerCase().replace(/^[>@?]/, ''); const p = l.indexOf(qq);
  if (qq && p >= 0) return escHtml(s.slice(0, p)) + '<mark>' + escHtml(s.slice(p, p + qq.length)) + '</mark>' + escHtml(s.slice(p + qq.length));
  return escHtml(s);
}
let palItems = [], palSel = 0;
function openPalette(prefix){
  $('#paletteBg').classList.add('on'); const inp = $('#paletteInput'); inp.value = prefix || ''; inp.focus(); renderPalette();
}
function closePalette(){ $('#paletteBg').classList.remove('on'); }
function renderPalette(){
  const q = $('#paletteInput').value; palItems = paletteItems(q); palSel = 0; drawPalette(q);
}
function drawPalette(q){
  $('#paletteList').innerHTML = palItems.length ? palItems.map((it, i) => '<div class="pal-item' + (i === palSel ? ' on' : '') + '" data-i="' + i + '"><span class="kind">' + it.kind + '</span><span class="lbl">' + fuzzyMark(q, it.label) + '</span>' + (it.sub ? '<span class="sub">' + escHtml(it.sub) + '</span>' : '') + (it.hk ? '<kbd>' + it.hk + '</kbd>' : '') + '</div>').join('') : '<div class="pal-item muted">Ничего не найдено</div>';
  const on = $('#paletteList .pal-item.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
$('#paletteInput').addEventListener('input', renderPalette);
$('#paletteInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown'){ palSel = Math.min(palItems.length - 1, palSel + 1); drawPalette($('#paletteInput').value); e.preventDefault(); }
  else if (e.key === 'ArrowUp'){ palSel = Math.max(0, palSel - 1); drawPalette($('#paletteInput').value); e.preventDefault(); }
  else if (e.key === 'Enter'){ const it = palItems[palSel]; closePalette(); if (it) it.run(); e.preventDefault(); }
  else if (e.key === 'Escape'){ closePalette(); }
});
$('#paletteList').addEventListener('click', e => { const d = e.target.closest('[data-i]'); if (!d) return; const it = palItems[+d.dataset.i]; closePalette(); if (it) it.run(); });
$('#paletteBg').addEventListener('click', e => { if (e.target.id === 'paletteBg') closePalette(); });

/* ---- Горячие клавиши ---- */
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'k'){ e.preventDefault(); openPalette(); return; }
  if (ctrl && !e.shiftKey && !e.altKey && (k === 'o' || k === 'щ')){ e.preventDefault(); openBookDialog(); return; }
  if (ctrl && !e.altKey && (k === 's' || k === 'ы')){ e.preventDefault(); if (e.shiftKey) saveToOriginal(); else saveCopy(); return; }
  if (ctrl && e.altKey && (k === 'z' || k === 'я')){ e.preventDefault(); if (canUndo()) histGo(S.histPos - 1); return; }
  if (ctrl && e.altKey && (k === 'y' || k === 'н')){ e.preventDefault(); if (canRedo()) histGo(S.histPos + 1); return; }
  if (e.altKey && !ctrl && /^[1-6]$/.test(e.key)){ e.preventDefault(); const ids = ['home', 'editor', 'optimizer', 'graph', 'sandbox', 'anon']; showView(ids[+e.key - 1]); return; }
  if (e.key === 'F1'){ e.preventDefault(); if (curView === 'editor' && typeof editorWordAtCursor === 'function'){ const w = editorWordAtCursor(); if (w && M_REF.has(w)) return openReference(w); } showView('help'); }
});
