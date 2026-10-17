/* =====================================================================
   core/vba.js — чтение исходного кода макросов VBA из xl/vbaProject.bin (.xlsm/.xlsb).
   Нужно только для советов об обновлении запросов макросами; код макросов никуда не
   выгружается и не попадает в пакеты для ИИ (может содержать пароли и пути).
   Форматы: MS-CFB (составной файл OLE) → хранилище VBA → поток dir (MS-OVBA, сжат) →
   имена модулей и смещения исходного текста → сжатый исходный текст в потоке модуля.
   readVbaProject(u8) → { modules: [{ name, stream, code }], codePage } или бросает Error.
   ===================================================================== */
/** MS-CFB: дерево каталога и чтение потоков по пути вида 'VBA/dir' */
function cfbOpen(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (u8.length < 512 || SIG.some((b, i) => u8[i] !== b)) throw new Error('vbaProject.bin: не составной файл OLE');
  const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true), difatStart = dv.getUint32(68, true);
  const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
  if (secSize !== 512 && secSize !== 4096 || miniSize !== 64) throw new Error('vbaProject.bin: неверный размер сектора');
  const nSec = Math.ceil(u8.length / secSize);   // все счётчики и номера секторов ограничены размером файла
  if (nFat > nSec) throw new Error('vbaProject.bin: повреждён заголовок');
  const secOff = s => (s + 1) * secSize;
  const u32 = off => (off + 4 <= u8.length ? dv.getUint32(off, true) : FREE);
  // DIFAT: 109 записей в заголовке + цепочка секторов DIFAT
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++){ const s = u32(76 + i * 4); if (s !== FREE && s < nSec) fatSecs.push(s); }
  for (let s = difatStart, guard = 0; s !== END && s !== FREE && s < nSec && fatSecs.length < nFat && guard < nSec; guard++){
    const per = secSize / 4 - 1; for (let i = 0; i < per && fatSecs.length < nFat; i++){ const v = u32(secOff(s) + i * 4); if (v !== FREE && v < nSec) fatSecs.push(v); }
    s = u32(secOff(s) + per * 4);
  }
  const fat = []; for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(u32(secOff(s) + i * 4));
  const chain = (start, table, limit) => { const out = []; const seen = new Set(); for (let s = start; s !== END && s !== FREE && s < table.length && !seen.has(s) && out.length < limit; s = table[s]){ seen.add(s); out.push(s); } return out; };
  const readBig = (start, size) => { if (size > u8.length) throw new Error('vbaProject.bin: неверный размер потока'); const out = new Uint8Array(size); let p = 0; for (const s of chain(start, fat, Math.ceil(size / secSize) + 1)){ const o = secOff(s); const n = Math.min(secSize, size - p); if (n <= 0) break; out.set(u8.subarray(o, o + n), p); p += n; } if (p < size) throw new Error('vbaProject.bin: поток обрезан'); return out; };
  // каталог
  const dirBytes = (() => { const secs = chain(dirStart, fat, nSec); const out = new Uint8Array(secs.length * secSize); secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize)); return out; })();
  const ddv = new DataView(dirBytes.buffer);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128){
    const nl = ddv.getUint16(off + 64, true); const type = dirBytes[off + 66];
    let name = ''; for (let i = 0; i + 1 < Math.min(nl, 64) - 1; i += 2) name += String.fromCharCode(ddv.getUint16(off + i, true));
    entries.push({ name, type, left: ddv.getUint32(off + 68, true), right: ddv.getUint32(off + 72, true), child: ddv.getUint32(off + 76, true), start: ddv.getUint32(off + 116, true), size: ddv.getUint32(off + 120, true) });
  }
  const root = entries[0]; if (!root || root.type !== 5) throw new Error('vbaProject.bin: нет корневого каталога');
  // мини-поток и мини-FAT
  const miniStream = root.size ? readBig(root.start, root.size) : new Uint8Array(0);
  const miniFat = []; for (const s of chain(miniFatStart, fat, nSec)) for (let i = 0; i < secSize / 4; i++) miniFat.push(u32(secOff(s) + i * 4));
  const readMini = (start, size) => { if (size > miniStream.length) throw new Error('vbaProject.bin: неверный размер потока'); const out = new Uint8Array(size); let p = 0; for (const s of chain(start, miniFat, Math.ceil(size / miniSize) + 1)){ const o = s * miniSize; const n = Math.min(miniSize, size - p); if (n <= 0) break; out.set(miniStream.subarray(o, o + n), p); p += n; } if (p < size) throw new Error('vbaProject.bin: мини-поток обрезан'); return out; };
  const children = idx => { const out = []; const walk = (i, depth) => { if (i === FREE || i >= entries.length || depth > 64) return; const e = entries[i]; walk(e.left, depth + 1); out.push(e); walk(e.right, depth + 1); }; walk(entries[idx].child, 0); return out; };
  const find = path => { let idx = 0; for (const part of path.split('/')){ const c = children(idx).find(e => e.name.toUpperCase() === part.toUpperCase()); if (!c) return null; idx = entries.indexOf(c); } return entries[idx]; };
  return {
    has: path => !!find(path),
    read(path){ const e = find(path); if (!e || e.type !== 2) throw new Error('vbaProject.bin: нет потока ' + path); return e.size < miniCutoff ? readMini(e.start, e.size) : readBig(e.start, e.size); },
    list: path => { const e = path ? find(path) : entries[0]; return e ? children(entries.indexOf(e)).map(x => x.name) : []; }
  };
}
/** MS-OVBA 2.4.1: распаковка CompressedContainer */
function ovbaDecompress(src){
  if (!src.length || src[0] !== 1) throw new Error('VBA: неверная сигнатура сжатого потока');
  const out = []; let p = 1;
  while (p + 2 <= src.length){
    const hdr = src[p] | (src[p + 1] << 8); const size = (hdr & 0x0FFF) + 3; const compressed = hdr >> 15;
    const end = Math.min(src.length, p + size); p += 2;
    const chunkStart = out.length;
    if (!compressed){ for (let i = 0; i < 4096 && p < end; i++) out.push(src[p++]); p = end; continue; }
    while (p < end){
      const flags = src[p++];
      for (let bit = 0; bit < 8 && p < end; bit++){
        if (!(flags & (1 << bit))){ if (out.length - chunkStart >= 4096) throw new Error('VBA: повреждённый сжатый поток'); out.push(src[p++]); continue; }
        if (p + 2 > end) { p = end; break; }
        const tok = src[p] | (src[p + 1] << 8); p += 2;
        const diff = out.length - chunkStart; let bc = 4; while ((1 << bc) < diff) bc++;
        const lenMask = 0xFFFF >> bc; const len = (tok & lenMask) + 3; const off = (tok >> (16 - bc)) + 1;
        const from = out.length - off; if (from < chunkStart) throw new Error('VBA: повреждённый сжатый поток');
        if (out.length - chunkStart + len > 4096) throw new Error('VBA: повреждённый сжатый поток');   // распакованный кусок — не больше 4096 байт
        for (let i = 0; i < len; i++) out.push(out[from + i]);
      }
    }
  }
  return Uint8Array.from(out);
}
function readVbaProject(u8){
  const cf = cfbOpen(u8);
  const dirPath = cf.has('VBA/dir') ? 'VBA/dir' : cf.has('_VBA_PROJECT_CUR/VBA/dir') ? '_VBA_PROJECT_CUR/VBA/dir' : null;
  if (!dirPath) throw new Error('vbaProject.bin: нет хранилища VBA');
  const base = dirPath.slice(0, -3);
  const dir = ovbaDecompress(cf.read(dirPath)); const dv = new DataView(dir.buffer);
  let codePage = 1252; const mods = []; let cur = null;
  const mbcs = b => { try { return new TextDecoder('windows-' + codePage).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } };
  for (let p = 0; p + 6 <= dir.length;){
    const id = dv.getUint16(p, true); let size = dv.getUint32(p + 2, true); p += 6;
    if (id === 0x0009) size = 6;   // PROJECTVERSION: поле размера = 4, а данных 6 (MS-OVBA 2.3.4.2.1.11)
    if (p + size > dir.length) break;
    const data = dir.subarray(p, p + size); p += size;
    if (id === 0x0003 && size === 2) codePage = data[0] | (data[1] << 8);
    else if (id === 0x0019){ cur = { name: mbcs(data), stream: '', offset: 0 }; }
    else if (id === 0x0047 && cur){ let s = ''; for (let i = 0; i + 1 < data.length; i += 2) s += String.fromCharCode(data[i] | (data[i + 1] << 8)); if (s) cur.name = s; }
    else if (id === 0x001A && cur) cur.stream = mbcs(data);
    else if (id === 0x0031 && cur && size === 4) cur.offset = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    else if (id === 0x002B && cur){ mods.push(cur); cur = null; }
  }
  const modules = [];
  for (const m of mods){
    try { const raw = cf.read(base + (m.stream || m.name)); modules.push({ name: m.name, stream: m.stream, code: mbcs(ovbaDecompress(raw.subarray(m.offset))) }); }
    catch (e){ modules.push({ name: m.name, stream: m.stream, code: '', error: e.message }); }
  }
  return { modules, codePage };
}

/* ---- Подключения книги (xl/connections.xml): свойства обновления запросов Power Query ---- */
function xmlUnescape(s){ return String(s).replace(/&(quot|amp|lt|gt|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" })[e.toLowerCase()] || (e[1].toLowerCase() === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)))); }
function xmlAttrs(s){ const o = {}; const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m; while ((m = re.exec(s))) o[m[1]] = xmlUnescape(m[3] != null ? m[3] : m[4]); return o; }
/** [{ name, query, background, refreshOnLoad, mashup, … }] — только свойства подключений, без данных */
function parseConnections(xml){
  const out = []; const re = /<connection\b([^>]*?)(?:\/>|>([\s\S]*?)<\/connection>)/g; let m;
  const flag = v => v === '1' || v === 'true';
  while ((m = re.exec(xml))){
    const a = xmlAttrs(m[1]); const inner = m[2] || '';
    const db = /<dbPr\b([^>]*?)\/?>/.exec(inner); const d = db ? xmlAttrs(db[1]) : {};
    const cs = d.connection || ''; const loc = /(?:^|;)\s*Location\s*=\s*(?:"((?:[^"]|"")*)"|([^;]*))/i.exec(cs);
    const x15 = /<\w+:connection\b([^>]*?)\/?>/.exec(inner); const xa = x15 ? xmlAttrs(x15[1]) : {};   // MS-XLSX: x15:connection model / excludeFromRefreshAll
    out.push({ id: a.id, name: a.name || '', background: flag(a.background), refreshOnLoad: flag(a.refreshOnLoad), saveData: flag(a.saveData), deleted: flag(a.deleted), model: flag(xa.model), excluded: flag(xa.excludeFromRefreshAll),
      mashup: /Microsoft\.Mashup\.OleDb/i.test(cs), query: loc ? (loc[1] != null ? loc[1].replace(/""/g, '"') : loc[2].trim()) : null });
  }
  return out;
}

/* ---- Макросы, которые обновляют запросы ---- */
/** Процедуры VBA с операторами обновления: [{ module, proc, line, kind, text }]; комментарии и строки учитываются */
function vbaRefreshCalls(modules){
  const out = [];
  for (const md of modules || []){
    const lines = String(md.code || '').split(/\r\n|\r|\n/); let proc = null; const loopVar = new Map();   // переменная цикла For Each → что перебирается
    for (let i = 0; i < lines.length; i++){
      let l = lines[i]; const ln = i + 1;
      while (/\s_$/.test(l) && i + 1 < lines.length) l = l.slice(0, -1) + ' ' + lines[++i].trim();   // перенос строки « _»
      // убрать комментарий: ' вне строковых литералов, Rem в начале оператора
      let code = '', q = false; for (const ch of l){ if (ch === '"') q = !q; if (ch === "'" && !q) break; code += ch; }
      if (/^\s*Rem\b/i.test(code) || /^\s*Attribute\s/i.test(code)) continue;
      const pm = /^\s*(?:(?:Public|Private|Friend)\s+)?(?:Static\s+)?(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+([^\s(]+)/i.exec(code);
      if (pm){ proc = pm[1]; continue; }
      if (/^\s*End\s+(Sub|Function|Property)\b/i.test(code)){ proc = null; continue; }
      const t = code.trim(); if (!t) continue;
      const fe = /^For\s+Each\s+(\w+)\s+In\s+(.+)$/i.exec(t);
      if (fe){ loopVar.set(fe[1].toLowerCase(), /PivotCaches|PivotTables/i.test(fe[2]) ? 'pivot' : /\.Queries\b/i.test(fe[2]) ? 'query' : /Connections/i.test(fe[2]) ? 'conn' : /ListObjects|QueryTables/i.test(fe[2]) ? 'table' : 'other'); continue; }
      const obj = (/^(\w+)\./.exec(t) || [])[1]; const via = obj ? loopVar.get(obj.toLowerCase()) : null;
      const add = kind => out.push({ module: md.name, proc: proc || '(вне процедур)', line: ln, kind, text: t.length > 140 ? t.slice(0, 140) + '…' : t });
      if (/(^|[.\s])RefreshAll\b/i.test(t)) add('refreshAll');
      else if (/\.Model\.Refresh\b/i.test(t)) add('modelRefresh');
      else if (/\.Queries\s*\([^)]*\)\s*\.Refresh\b/i.test(t) || (via === 'query' && /\.Refresh\b/i.test(t))) add('queryRefresh');
      else if (/\bBackgroundQuery\s*=\s*False\b/i.test(t)) add('bgOff');
      else if ((via === 'pivot' || /PivotCaches?\b|\.PivotCache\b|\.RefreshTable\b/i.test(t)) && /\.Refresh(Table)?\b/i.test(t)) add('pivot');
      else if (/\.Refresh\b/i.test(t)){ add(/\.Refresh\s*\(?\s*(BackgroundQuery\s*:=\s*)?False\b/i.test(t) ? 'refreshSync' : 'refresh'); }
      if (/\bCalculateUntilAsyncQueriesDone\b/i.test(t)) add('waitAsync');
    }
  }
  return out;
}
/** Советы уровня книги об обновлении: макросы + свойства подключений.
    → [{ sev, key, title, text, how }]; формулировки — по проверенным фактам (DEV.md, «Обновление книги») */
function bookRefreshIssues(book){
  const out = []; const add = (sev, key, title, text, how) => out.push({ sev, key, title, text, how: how || '' });
  const pl = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const where = xs => (xs.length > 1 ? 'строки ' : 'строка ') + xs.map(x => x.line).join(', ');
  if (book && book.vba && book.vba.error) add('info', 'vba-unreadable', 'Макросы не прочитаны', 'Файл макросов не удалось разобрать: ' + book.vba.error + '. Советы по макросам недоступны.');
  const calls = vbaRefreshCalls(book && book.vba ? book.vba.modules : []);
  const procs = new Map(); for (const c of calls){ const k = c.module + '.' + c.proc; if (!procs.has(k)) procs.set(k, []); procs.get(k).push(c); }
  for (const [name, cs] of procs){
    const all = cs.filter(c => c.kind === 'refreshAll'), first = all.length ? all[0].line : Infinity;
    const single = cs.filter(c => c.kind === 'refresh' || c.kind === 'refreshSync' || c.kind === 'queryRefresh'), piv = cs.filter(c => c.kind === 'pivot' && c.line > first);
    const model = cs.filter(c => c.kind === 'modelRefresh'), qAsync = cs.filter(c => c.kind === 'queryRefresh');
    const sync = cs.filter(c => c.kind === 'bgOff' || c.kind === 'refreshSync');
    if (all.length >= 2) add('warn', 'macro-refreshall-twice', 'Все запросы обновляются ' + all.length + ' ' + pl(all.length, 'раз', 'раза', 'раз'), 'Процедура «' + name + '» вызывает RefreshAll ' + all.length + ' ' + pl(all.length, 'раз', 'раза', 'раз') + ' (' + where(all) + '): каждый запрос книги вычисляется заново при каждом вызове — время обновления умножается.',
      'Повторный RefreshAll обычно ставят, чтобы сводные увидели свежие данные после фонового обновления запросов. Вместо этого отключите фоновое обновление у подключений Power Query (BackgroundQuery = False — тогда RefreshAll дождётся запросов) и при необходимости обновите после него только сводные (PivotCache.Refresh). Application.CalculateUntilAsyncQueriesDone тоже ждёт фоновые запросы, но, по отзывам, не всегда надёжно.');
    if (all.length && single.length) add('warn', 'macro-refresh-again', 'Таблицы обновляются дважды', 'В процедуре «' + name + '» есть и RefreshAll (' + where(all) + '), и отдельные обновления подключений или таблиц (' + where(single) + '): RefreshAll уже обновляет все подключения, поэтому эти запросы вычисляются ещё раз — неважно, до или после него.',
      'Оставьте что-то одно: RefreshAll или обновление нужных таблиц по одной (если важен порядок).');
    if (all.length && model.length) add('warn', 'macro-model-twice', 'Модель данных обновляется дважды', 'Процедура «' + name + '» вызывает и RefreshAll, и Model.Refresh (' + where(model) + '): Model.Refresh заново обновляет все источники модели данных, которые RefreshAll уже обновил.',
      'Оставьте один из вызовов.');
    if (all.length && piv.length) add('info', 'macro-pivot-again', 'Сводные обновляются отдельно', 'В процедуре «' + name + '» после RefreshAll отдельно обновляются сводные (' + where(piv) + '). RefreshAll обновляет и их — это ещё один проход.',
      'Отдельное обновление сводных нужно, только если запросы обновляются в фоне и сводные успевают обновиться раньше данных. Тогда лучше отключить фоновое обновление у подключений Power Query — а отдельное обновление сводных убрать.');
    if (qAsync.length) add('info', 'macro-query-async', 'Запрос обновляется асинхронно', 'Процедура «' + name + '» обновляет запрос через Queries(…).Refresh (' + where(qAsync) + '). По отзывам практиков, такой вызов не ждёт окончания обновления — следующие шаги макроса могут выполниться на старых данных, и тогда появляются лишние «страховочные» обновления.',
      'Надёжнее обновлять таблицу, в которую загружен запрос: ListObjects(…).QueryTable.Refresh BackgroundQuery:=False.');
    if (sync.length) add('info', 'macro-sync', 'Синхронное обновление в макросе', 'Процедура «' + name + '» обновляет запросы синхронно (BackgroundQuery = False, ' + where(sync) + '). Пока идёт обновление, Excel не отвечает — это штатное поведение, а не зависание. Так же ведут себя загрузки в модель данных: в фоне они не выполняются вообще. Такую строку часто оставляет запись макроса.',
      'Часового обновления синхронный режим не объясняет: время уходит на сами запросы — ускоряйте их (советы оптимизатора). Чтобы видеть ход работы, обновляйте таблицы по одной и выводите шаг в Application.StatusBar.');
    if (/\.(Workbook_Open|Auto_Open)$/i.test(name) && (all.length || single.length || model.length)) add('info', 'macro-on-open', 'Обновление при каждом открытии', 'Процедура «' + name + '» обновляет запросы при открытии книги: открытие длится столько же, сколько обновление.',
      'Если свежие данные не нужны сразу при открытии, запускайте обновление кнопкой или отдельным макросом.');
  }
  const fast = (book && book.vba ? book.vba.modules : []).some(m => /\.FastCombine\s*=\s*True\b/i.test(m.code || ''));
  if (calls.some(c => c.kind === 'refreshAll' || c.kind === 'refresh' || c.kind === 'refreshSync') && !fast)
    add('info', 'macro-fastcombine', 'Уровни конфиденциальности в макросе обновления', 'Макрос обновляет запросы, а проверки уровней конфиденциальности (Formula.Firewall) остаются включёнными. Флаг книги «игнорировать уровни» действует только для пользователя, который её сохранил, и сбрасывается при изменении кода.',
      'Если все источники — внутренние данные компании, добавьте в макрос перед обновлением строку ThisWorkbook.Queries.FastCombine = True (Excel 2016+): она действует для любого пользователя на время работы с книгой. Сравните время обновления до и после.');
  const pq = (book && book.conns || []).filter(c => c.mashup && !c.deleted);
  const props = 'свойствах подключения (Данные → Запросы и подключения → правый щелчок по запросу → Свойства; вкладка «Использование» / Usage — названия пунктов в русском Excel могут отличаться)';
  const onLoad = pq.filter(c => c.refreshOnLoad);
  if (onLoad.length) add('info', 'conn-refresh-on-open', 'Подключения обновляются при открытии', 'У ' + onLoad.length + ' ' + pl(onLoad.length, 'подключения', 'подключений', 'подключений') + ' включено обновление при открытии файла: ' + onLoad.map(c => c.query || c.name).join(', ') + '.',
    'Если данные не нужны свежими в момент открытия, снимите «Refresh data when opening the file» в ' + props + '.');
  const fg = pq.filter(c => !c.background && !c.model);
  if (fg.length) add('info', 'conn-sync', 'Подключения обновляются синхронно', 'У ' + fg.length + ' ' + pl(fg.length, 'подключения', 'подключений', 'подключений') + ' Power Query выключено фоновое обновление (' + fg.map(c => c.query || c.name).join(', ') + '): «Обновить всё» блокирует Excel до конца обновления даже без макроса. Это не ошибка и само по себе обновление не удлиняет.',
    'Если нужно работать в Excel во время обновления, включите «Enable background refresh» в ' + props + '.');
  const excl = pq.filter(c => c.excluded);
  if (pq.length >= 3) add('info', 'conn-refresh-all', excl.length ? 'Часть запросов исключена из «Обновить всё»' : 'Все запросы участвуют в «Обновить всё»', (excl.length ? 'Из «Обновить всё» исключены: ' + excl.map(c => c.query || c.name).join(', ') + '. Остальные ' : 'Все ') + (pq.length - excl.length) + ' ' + pl(pq.length - excl.length, 'запрос', 'запроса', 'запросов') + ' Power Query обновляются при каждом «Обновить всё».',
    'Запросы со справочниками и архивами, которые не меняются, можно исключить: снимите «Refresh this connection on Refresh All» в ' + props + '. Обновляйте их вручную, когда данные действительно изменились.');
  return out;
}
