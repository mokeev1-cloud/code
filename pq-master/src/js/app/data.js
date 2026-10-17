/* =====================================================================
   app/data.js — данные на этом компьютере: таблицы открытой книги и прикреплённые выгрузки.
   Инвариант: необезличенные значения никуда не уходят. Вычисления (песочница, «Данные»)
   идут только в браузере; наружу — пакет для ИИ, папка обмена, буфер «для ИИ» — попадают
   только числа проверок, а gate() дополнительно ищет значения из данных в исходящем тексте
   (dataLeaks) и блокирует выпуск.
   Интерпретатор получает данные через M_DATA (m/interp.js): currentWorkbook(), file(путь), folder(путь).
   ===================================================================== */
const DATA = { limit: 200000, wb: null, wbFor: null, wbError: '', files: new Map(), folders: new Map(), selfBook: null, run: null, verify: null };
const normPath = p => String(p || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const pathBase = p => normPath(p).replace(/^.*\\/, '');
/** Файл с диска → { name, bytes, mtime, xlsx } (книги .xlsx/.xlsm разбираются сразу: Excel.Workbook синхронный) */
async function dataFile(f, bytes){
  const u8 = bytes || await readFileBytes(f); const out = { name: f.name, bytes: u8, mtime: f.lastModified || 0, xlsx: null, error: '' };
  if (/\.(xlsx|xlsm)$/i.test(f.name)){ try { out.xlsx = await readXlsxData(zipRead(u8), { maxRows: DATA.limit }); } catch (e){ out.error = e.message; } }
  return out;
}
/** Прикрепить файлы: к пути из кода (kind file/folder) или просто по имени (path пустой) */
async function attachFiles(list, path, kind){
  const fs = []; for (const f of list) fs.push(await dataFile(f));
  if (kind === 'folder') DATA.folders.set(normPath(path), fs.concat(DATA.folders.get(normPath(path)) || []).filter((x, i, a) => a.findIndex(y => y.name === x.name) === i));
  else for (const x of fs) DATA.files.set(kind === 'file' && path ? normPath(path) : 'name:' + x.name.toLowerCase(), x);
  dataChanged();
  return fs;
}
function detachData(key, folder){ (folder ? DATA.folders : DATA.files).delete(key); dataChanged(); }
/** Любое изменение данных или кода делает прежние результаты проверок неактуальными */
function dataChanged(){ DATA.run = null; DATA.verify = null; emitState('data'); }
/** Таблицы книги (ListObject и именованные диапазоны) — читаются один раз на версию файла */
async function dataPrepare(){
  const b = S.book;
  if (!b || b.family !== 'excel' || !b.zip){ DATA.wb = null; DATA.wbError = b && b.ext === 'xlsb' ? 'Книга .xlsb хранит листы в двоичном виде — её таблицы здесь не читаются. Сохраните копию как .xlsx или прикрепите выгрузки.' : ''; return; }
  const key = b.sha + ':' + DATA.limit;
  if (DATA.wbFor !== key){
    try { DATA.wb = await readXlsxData(b.zip, { only: 'objects', maxRows: DATA.limit }); DATA.wbError = ''; } catch (e){ DATA.wb = null; DATA.wbError = e.message; }
    DATA.wbFor = key; DATA.selfBook = null;
  }
  // запрос читает сам этот файл: Excel.Workbook(File.Contents("…\Книга.xlsx")) — нужен полный разбор листов
  if (!DATA.selfBook && /Excel\.Workbook\s*\(\s*File\.Contents/.test(S.work || '')){
    DATA.selfBook = { name: b.name, bytes: b.bytes, mtime: 0, xlsx: null };
    try { DATA.selfBook.xlsx = await readXlsxData(b.zip, { maxRows: DATA.limit }); } catch { /* Excel.Workbook сообщит */ }
  }
}
M_DATA = {
  currentWorkbook: () => DATA.wb ? DATA.wb.tables.concat(DATA.wb.names) : null,
  file(p){
    const n = normPath(p), base = pathBase(p);
    if (DATA.files.has(n)) return DATA.files.get(n);
    if (DATA.files.has('name:' + base)) return DATA.files.get('name:' + base);
    for (const fs of DATA.folders.values()){ const f = fs.find(x => x.name.toLowerCase() === base); if (f) return f; }
    if (DATA.selfBook && S.book && S.book.name.toLowerCase() === base) return DATA.selfBook;
    return null;
  },
  folder: p => DATA.folders.get(normPath(p)) || null
};
function dataSummaryText(){
  const t = DATA.wb ? DATA.wb.tables.length + DATA.wb.names.length : 0, f = DATA.files.size + [...DATA.folders.values()].reduce((s, x) => s + x.length, 0);
  return (t ? 'таблиц книги: ' + t : 'таблиц книги нет') + (f ? ', прикреплено файлов: ' + f : '');
}

/* ---- Защита от утечки: значения из данных в исходящем тексте ---- */
/** Строковые значения (≥ 4 символов) из таблиц книги, прикреплённых файлов и результатов проверок.
    Не считаются утечкой: заголовки столбцов и строки, которые уже есть в обезличенном коде. */
function dataValueSet(){
  const vals = new Set(), skip = new Set(); const CAP = 400000;
  const addRows = (cols, rows) => { for (const c of cols || []) skip.add(String(c)); for (const r of rows || []){ for (const v of r){ if (typeof v === 'string' && v.length >= 4 && v.length <= 400) vals.add(v.trim()); } if (vals.size > CAP) return; } };
  if (DATA.wb) for (const t of DATA.wb.tables.concat(DATA.wb.names)) addRows(t.cols, t.rows);
  const files = [...DATA.files.values(), ...[].concat(...DATA.folders.values())];
  for (const f of files){
    if (f.xlsx) for (const t of f.xlsx.sheets.concat(f.xlsx.tables)) addRows(t.cols, t.rows);
    else if (f.bytes && f.bytes.length < 50e6 && /\.(csv|txt|tsv)$/i.test(f.name)){   // первая строка — заголовки
      decodeBin(f.bytes).split(/\r?\n/).forEach((line, li) => { for (const cell of line.split(/[;,\t|]/)){ const v = cell.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim(); if (li === 0) skip.add(v); else if (v.length >= 4 && v.length <= 400) vals.add(v); } }); }
  }
  if (DATA.run) for (const q of DATA.run.queries) if (q.sample) addRows(q.sample.cols, q.sample.rows);
  if (S.anon && S.anon.out){ const re = /"((?:[^"]|"")*)"/g; let m; while ((m = re.exec(S.anon.out))) skip.add(m[1].replace(/""/g, '"')); }
  for (const s of skip) vals.delete(s);
  return vals;
}
/** Найденные в тексте значения из данных: строки в кавычках (JSON, M) и целые строки текста */
function dataLeaks(text){
  if (!DATA.wb && !DATA.files.size && !DATA.folders.size && !DATA.run) return [];
  const vals = dataValueSet(); if (!vals.size) return [];
  const out = []; const seen = new Set(); const hit = (v, s) => { if (vals.has(v) && !seen.has(v)){ seen.add(v); out.push({ sev: 'crit', label: 'значение из данных', match: v, s }); } };
  const re = /"((?:[^"\\\r\n]|\\.|"")*)"/g; let m;
  while ((m = re.exec(text))){ let v = m[1]; if (v.includes('\\')){ try { v = JSON.parse('"' + v + '"'); } catch { /* как есть */ } } hit(v.replace(/""/g, '"').trim(), m.index + 1); }
  let pos = 0; for (const line of text.split('\n')){ hit(line.trim(), pos); pos += line.length + 1; }
  return out;
}
onState(reason => { if (reason === 'book'){ DATA.wb = null; DATA.wbFor = null; DATA.selfBook = null; DATA.run = null; DATA.verify = null; } else if (reason === 'work'){ DATA.run = null; DATA.verify = null; } });
