/* =====================================================================
   app/storage.js — настройки (localStorage), недавние файлы (IndexedDB),
   открытие книг и сохранение (копия / в оригинал с резервной копией).
   Приватность: в IndexedDB хранятся ТОЛЬКО ссылки на файлы (FileSystemFileHandle),
   имя, размер и дата — содержимое книг в браузер не копируется. Список
   очищается кнопкой «Очистить список» или в настройках.
   ===================================================================== */
const SETTINGS_DEF = { theme: 'system', rememberRecent: true, backupOnSave: true, cultureLocale: 'ru-RU', csvEncoding: 65001, editorFont: 13.5, sbCollapsed: false };
let _settings = null;
function pqmSettings(){
  if (_settings) return _settings;
  let s = {}; try { s = JSON.parse(localStorage.getItem('pqm-settings') || '{}'); } catch { /* приватный режим */ }
  _settings = Object.assign({}, SETTINGS_DEF, s); return _settings;
}
function saveSettings(patch){ Object.assign(pqmSettings(), patch); try { localStorage.setItem('pqm-settings', JSON.stringify(_settings)); } catch { /* не критично */ } }

/* ---- IndexedDB: недавние файлы ---- */
const HAS_FSA = 'showOpenFilePicker' in window;
function idbOpen(){
  return new Promise((res, rej) => {
    let r; try { r = indexedDB.open('pq-master', 1); } catch (e){ rej(e); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('recent')) r.result.createObjectStore('recent', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbTx(mode, fn){
  const db = await idbOpen();
  return new Promise((res, rej) => { const tx = db.transaction('recent', mode); const st = tx.objectStore('recent'); const out = fn(st); tx.oncomplete = () => { db.close(); res(out && out.result !== undefined ? out.result : out); }; tx.onerror = () => { db.close(); rej(tx.error); }; });
}
async function recentList(){ try { const all = await idbTx('readonly', st => st.getAll()); return (all || []).sort((a, b) => b.lastOpened - a.lastOpened); } catch { return []; } }
async function recentPut(handle, book){
  if (!pqmSettings().rememberRecent || !handle) return;
  try {
    const list = await recentList(); let id = null;
    for (const e of list){ try { if (e.handle && await e.handle.isSameEntry(handle)){ id = e.id; break; } } catch { /* недоступна */ } }
    const entry = { id: id || 'r' + Date.now() + Math.random().toString(36).slice(2, 6), handle, name: book.name, size: book.bytes ? book.bytes.length : 0, queries: S.A ? S.A.members.length : 0, family: book.family, lastOpened: Date.now() };
    await idbTx('readwrite', st => st.put(entry));
    const extra = (await recentList()).slice(15); for (const e of extra) await recentDelete(e.id);
  } catch (e){ console.warn('recent', e); }
}
async function recentDelete(id){ try { await idbTx('readwrite', st => st.delete(id)); } catch { /* нет IDB */ } }
async function recentClear(){ try { await idbTx('readwrite', st => st.clear()); } catch { /* нет IDB */ } }

/* ---- Открытие ---- */
async function confirmDiscard(){
  if (!isDirty()) return true;
  const r = await modal('<h2>Несохранённые изменения</h2><p>В рабочей версии «' + escHtml(S.book.name) + '» есть изменения, которые не записаны в файл. Открыть другую книгу и потерять их?</p>', [['cancel', 'Отмена', 'pri'], ['go', 'Открыть без сохранения', 'danger']]);
  return r === 'go';
}
async function openBookDialog(){
  if (!(await confirmDiscard())) return;
  if (HAS_FSA){
    try {
      const [h] = await window.showOpenFilePicker({ id: 'pqm-open', types: [{ description: 'Книги Excel и Power BI', accept: { 'application/octet-stream': ['.xlsx', '.xlsm', '.xlsb', '.pbix', '.pbit'] } }, { description: 'M-код', accept: { 'text/plain': ['.m', '.pq', '.txt'] } }] });
      await openFromHandle(h, true);
    } catch (e){ if (e.name !== 'AbortError') toast(e.message, 'bad'); }
  } else $('#fileOpen').click();
}
async function openFromHandle(h, skipConfirm){
  if (!skipConfirm && !(await confirmDiscard())) return;
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted'){ if ((await h.requestPermission({ mode: 'read' })) !== 'granted'){ toast('Нет разрешения на чтение файла', 'warn'); return; } }
    const f = await h.getFile();
    await openFromBytes(f.name, new Uint8Array(await f.arrayBuffer()), h);
  } catch (e){ console.error(e); await modal('<h2>Не удалось открыть файл</h2><p>' + escHtml(e.message || String(e)) + '</p><p class="small muted">Если файл переместили или переименовали, удалите его из списка недавних.</p>'); }
}
async function openFromFile(f, handle){ await openFromBytes(f.name, await readFileBytes(f), handle || null); }
async function openFromBytes(name, u8, handle){
  try {
    const book = await loadBookFromBytes(name, u8);
    book.handle = handle || null;
    setBook(book);
    if (handle) recentPut(handle, book);
  } catch (err){
    console.error(err);
    await modal('<h2>' + (err.noMashup ? 'Запросов Power Query нет' : 'Не удалось прочитать файл') + '</h2><p>' + escHtml(err.message || String(err)) + '</p>');
  }
}
/** Обработчик drop: берёт FileSystemHandle, если браузер его даёт (Chrome/Edge) — тогда работает «В оригинал» и «Недавние» */
async function handleDrop(e){
  const items = e.dataTransfer && e.dataTransfer.items ? [...e.dataTransfer.items] : [];
  const it = items.find(x => x.kind === 'file');
  if (!it){ return; }
  if (!(await confirmDiscard())) return;
  let h = null; try { if (it.getAsFileSystemHandle) h = await it.getAsFileSystemHandle(); } catch { /* нет поддержки */ }
  if (h && h.kind === 'file') return openFromHandle(h, true);
  const f = it.getAsFile(); if (f) return openFromFile(f);
}
function setBook(book){
  S.dict = new TokenDict(); S.dictSource = 'новый для «' + book.name + '»';
  initBookState(book);
  toast('Открыто: ' + book.name + ' — запросов: ' + S.A.members.length, 'ok');
  showView(S.lastView && S.lastView !== 'home' ? S.lastView : 'home');
}
async function closeBook(){ if (!(await confirmDiscard())) return; closeBookState(); showView('home'); }

/* ---- Сохранение ---- */
const bookBase = () => S.book.name.replace(/\.[^.]+$/, '');
const bookExt = () => (/\.[^.]+$/.exec(S.book.name) || ['.xlsx'])[0];
/** Правки флагов подключений совпадают с тем, что прочитано из файла */
function connEditsHold(book, edits){
  for (const [id, e] of Object.entries((edits && edits.conns) || {})){
    const c = (book.conns || []).find(x => x.id === id); if (!c) return false;
    for (const k of Object.keys(e)) if (c[k] !== !!e[k]) return false;
  }
  return true;
}
async function buildVerified(){
  const bytes = await buildBookWithSection(S.book, S.work, S.bookEdits);
  const re = await loadBookFromBytes(S.book.name, bytes);
  if (re.origSection !== S.work) throw new Error('Контрольное чтение собранного файла не совпало с рабочей версией — сохранение отменено.');
  if (!connEditsHold(re, S.bookEdits)) throw new Error('Контрольное чтение: свойства подключений в собранном файле не совпали с выбранными — сохранение отменено.');
  return bytes;
}
async function confirmPbi(){
  if (S.book.family !== 'pbi') return true;
  return (await modal('<h2>Экспериментальная запись Power BI</h2><p>Microsoft не поддерживает изменение .pbix/.pbit сторонними средствами. Будет удалена часть SecurityBindings (иначе Power BI отвергнет файл). Если Power BI Desktop не откроет результат — скопируйте код запросов в Расширенный редактор.</p>', [['cancel', 'Отмена'], ['go', 'Продолжить', 'pri']])) === 'go';
}
/** Правка кода сбрасывает в Excel флаг «игнорировать уровни конфиденциальности» книги (MS-QDEFF 2.6: Permission Bindings) */
const privacyResetNote = () => S.book && S.book.privacy && S.book.privacy.firewall === false && S.work !== S.book.origSection
  ? 'Для этой книги было выбрано «игнорировать уровни конфиденциальности». После изменения кода Excel сбросит эту настройку — включите её снова (Параметры запроса → Текущая книга → Конфиденциальность) или задайте ThisWorkbook.Queries.FastCombine = True в макросе обновления.' : '';
async function saveCopy(){
  if (!S.book) return;
  try {
    if (S.book.container === 'text'){ const name = 'Section1.m'; download(name, S.work, 'text/plain;charset=utf-8'); toast('Скачан Section1.m — вставьте код запросов в Расширенный редактор', 'ok'); return; }
    if (!(await confirmPbi())) return;
    const bytes = await buildVerified();
    const name = bookBase() + '_исправлено' + bookExt();
    if ('showSaveFilePicker' in window){
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, startIn: S.book.handle || 'documents', id: 'pqm-save', types: [{ description: 'Книга', accept: { 'application/octet-stream': [bookExt()] } }] });
        const w = await h.createWritable(); await w.write(bytes); await w.close();
        toast('Копия сохранена: ' + h.name + '. Откройте её в Excel → «Данные» → «Обновить всё».', 'ok', 7000);
        if (privacyResetNote()) toast(privacyResetNote(), 'warn', 15000);
      } catch (e){ if (e.name === 'AbortError') return; throw e; }
    } else { download(name, new Blob([bytes])); toast('Копия скачана: ' + name, 'ok'); if (privacyResetNote()) toast(privacyResetNote(), 'warn', 15000); }
    S.lastCopy = new Date(); emitState('saved');
  } catch (e){ console.error(e); toast('Сохранение: ' + e.message, 'bad'); }
}
async function saveToOriginal(){
  if (!S.book) return;
  if (S.book.container === 'text') return toast('Источник — вставленный текст, исходного файла нет. Используйте «Сохранить копию».', 'warn');
  if (!S.book.handle) return modal('<h2>Нет доступа к исходному файлу</h2><p>Книга открыта так, что браузер не дал ссылку на сам файл (выбор через старый диалог или браузер без File System Access). Откройте её кнопкой <b>«Открыть»</b> или перетаскиванием в Chrome/Edge — тогда запись в оригинал станет доступна. Пока можно «Сохранить копию».</p>');
  if (!isDirty()) return toast('Рабочая версия совпадает с файлом — записывать нечего', 'warn');
  const backup = pqmSettings().backupOnSave;
  const ok = await modal('<h2>Записать изменения в «' + escHtml(S.book.name) + '»?</h2><ul><li><b>Закройте книгу в Excel</b> — иначе Windows не даст её перезаписать.</li>' + (privacyResetNote() ? '<li>' + escHtml(privacyResetNote()) + '</li>' : '') + (backup ? '<li>Сначала будет сохранена <b>резервная копия</b> исходного файла (вы выберете место, по умолчанию — рядом с книгой).</li>' : '<li class="warn">Резервная копия отключена в настройках.</li>') + '<li>После записи файл будет перечитан и сверен с рабочей версией.</li><li>Excel может заново спросить уровни конфиденциальности источников.</li></ul>', [['cancel', 'Отмена'], ['go', 'Записать', 'pri']]);
  if (ok !== 'go') return;
  if (!(await confirmPbi())) return;
  const h = S.book.handle;
  try {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Нет разрешения на запись', 'warn');
    const disk = new Uint8Array(await (await h.getFile()).arrayBuffer());
    if (sha256(disk) !== S.book.sha){
      return modal('<h2>Файл на диске изменился</h2><p>После открытия книгу кто-то сохранил (например, Excel). Перезапись затёрла бы эти изменения. Сохраните копию или откройте файл заново и перенесите правки (раздел «История» хранит все версии кода).</p>');
    }
    const bytes = await buildVerified();
    if (backup){
      try {
        const bh = await window.showSaveFilePicker({ suggestedName: bookBase() + '.backup-' + stamp() + bookExt(), startIn: h, id: 'pqm-backup' });
        const bw = await bh.createWritable(); await bw.write(disk); await bw.close();
      } catch (e){
        if (e.name !== 'AbortError') throw e;
        const r = await modal('<h2>Резервная копия не создана</h2><p>Вы отменили выбор места для резервной копии. Записать в оригинал без неё?</p>', [['cancel', 'Отмена', 'pri'], ['go', 'Записать без копии', 'danger']]);
        if (r !== 'go') return;
      }
    }
    try { const w = await h.createWritable(); await w.write(bytes); await w.close(); }
    catch (e){ throw new Error((/NoModification|InvalidState|NotReadable|NotAllowed/.test(e.name) ? 'Файл занят или защищён от записи — закройте книгу в Excel и повторите. ' : '') + '(' + e.name + ': ' + e.message + ')'); }
    const check = new Uint8Array(await (await h.getFile()).arrayBuffer());
    const re = await loadBookFromBytes(S.book.name, check);
    if (re.origSection !== S.work || !connEditsHold(re, S.bookEdits)) throw new Error('После записи файл прочитан, но код или свойства подключений не совпали с рабочей версией. Восстановите файл из резервной копии.');
    re.handle = h; S.book = re; S.saved = S.work; S.bookEdits = { conns: {} };
    S.hist.push({ t: new Date(), src: 'save', label: 'Записано в «' + re.name + '»', text: S.work }); S.histPos = S.hist.length - 1;
    emitState('saved'); recentPut(h, re);
    toast('Записано в оригинал и проверено. Откройте книгу → «Данные» → «Обновить всё».', 'ok', 8000);
  } catch (e){ console.error(e); modal('<h2>Запись не выполнена</h2><p>' + escHtml(e.message || String(e)) + '</p>'); }
}
