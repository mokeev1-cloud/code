/* =====================================================================
   Мастер PQ — ядро: байты, кодировки, SHA-256, CRC32, ZIP, DataMashup
   Никаких сетевых вызовов: fetch/XHR/WebSocket не используются, а CSP
   (connect-src 'none') запретил бы их в любом случае.
   ===================================================================== */
const PQM_VERSION = '1.0';
const PROTOCOL = 'pq-master/1';

const te = new TextEncoder();
const td8 = new TextDecoder('utf-8');
const td16le = new TextDecoder('utf-16le');
const td16be = new TextDecoder('utf-16be');

function concatBytes(arrs){
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0;
  for (const a of arrs){ out.set(a, o); o += a.length; }
  return out;
}
function bytesEqual(a, b){
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function u32le(n){ const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
function hasPrefix(u8, pre){ if (u8.length < pre.length) return false; for (let i = 0; i < pre.length; i++) if (u8[i] !== pre[i]) return false; return true; }

/* ---- Текст с определением кодировки по BOM ---- */
function decodeText(u8, hint){
  if (hasPrefix(u8, [0xEF,0xBB,0xBF])) return { text: td8.decode(u8.subarray(3)), enc: 'utf-8', bom: true };
  if (hasPrefix(u8, [0xFF,0xFE])) return { text: td16le.decode(u8.subarray(2)), enc: 'utf-16le', bom: true };
  if (hasPrefix(u8, [0xFE,0xFF])) return { text: td16be.decode(u8.subarray(2)), enc: 'utf-16be', bom: true };
  if (hint === 'utf-16le' || (u8.length > 3 && u8[1] === 0 && u8[3] === 0 && u8[0] !== 0)) return { text: td16le.decode(u8), enc: 'utf-16le', bom: false };
  return { text: td8.decode(u8), enc: 'utf-8', bom: false };
}
function encodeText(text, enc, bom){
  if (enc === 'utf-8'){ const b = te.encode(text); return bom ? concatBytes([new Uint8Array([0xEF,0xBB,0xBF]), b]) : b; }
  const le = enc === 'utf-16le';
  const out = new Uint8Array(text.length * 2 + (bom ? 2 : 0)); let o = 0;
  if (bom){ out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF; o = 2; }
  for (let i = 0; i < text.length; i++){
    const c = text.charCodeAt(i);
    if (le){ out[o++] = c & 255; out[o++] = c >> 8; } else { out[o++] = c >> 8; out[o++] = c & 255; }
  }
  return out;
}
function b64decode(s){
  s = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(s); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function b64encode(u8){
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

/* ---- SHA-256 (своя реализация: crypto.subtle недоступен в части контекстов file://) ---- */
const SHA_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function sha256(data){
  const u8 = typeof data === 'string' ? te.encode(data) : data;
  const len = u8.length, bitLen = len * 8;
  const padLen = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(padLen); m.set(u8); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0); dv.setUint32(padLen - 8, Math.floor(bitLen / 4294967296));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64){
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++){
      const a = W[i-15], b = W[i-2];
      const s0 = ((a>>>7)|(a<<25)) ^ ((a>>>18)|(a<<14)) ^ (a>>>3);
      const s1 = ((b>>>17)|(b<<15)) ^ ((b>>>19)|(b<<13)) ^ (b>>>10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++){
      const S1 = ((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + W[i]) | 0;
      const S0 = ((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]+=a;H[1]+=b;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h;
  }
  return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
}

/* ---- CRC32 ---- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/* ---- Deflate через встроенные потоки браузера (без библиотек и без сети) ---- */
async function streamBytes(u8, ts){
  const s = new Blob([u8]).stream().pipeThrough(ts);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const inflateRaw = u8 => streamBytes(u8, new DecompressionStream('deflate-raw'));
const deflateRaw = u8 => streamBytes(u8, new CompressionStream('deflate-raw'));

/* ---- ZIP: чтение по центральному каталогу, запись с побайтным копированием неизменённых записей ---- */
function zipRead(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не ZIP-контейнер (не найден конец центрального каталога). Файл повреждён или это не книга Office.');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64 не поддерживается (файл больше 4 ГБ или > 65535 частей).');
  const comment = u8.slice(eocd + 22, eocd + 22 + dv.getUint16(eocd + 20, true));
  const entries = []; let p = cdOff;
  for (let k = 0; k < count; k++){
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Повреждён центральный каталог ZIP.');
    const e = {
      verMade: dv.getUint16(p + 4, true), verNeed: dv.getUint16(p + 6, true), flags: dv.getUint16(p + 8, true),
      method: dv.getUint16(p + 10, true), time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      intAttr: dv.getUint16(p + 36, true), extAttr: dv.getUint32(p + 38, true), lho: dv.getUint32(p + 42, true)
    };
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    if (e.csize === 0xFFFFFFFF || e.usize === 0xFFFFFFFF || e.lho === 0xFFFFFFFF) throw new Error('ZIP64 не поддерживается.');
    e.nameBytes = u8.slice(p + 46, p + 46 + nl);
    e.name = (e.flags & 0x800) ? td8.decode(e.nameBytes) : decodeLatinOrUtf8(e.nameBytes);
    e.centralExtra = u8.slice(p + 46 + nl, p + 46 + nl + xl);
    e.comment = u8.slice(p + 46 + nl + xl, p + 46 + nl + xl + cl);
    p += 46 + nl + xl + cl;
    const lh = e.lho;
    if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error('Повреждён локальный заголовок ZIP: ' + e.name);
    const lnl = dv.getUint16(lh + 26, true), lxl = dv.getUint16(lh + 28, true);
    e.localExtra = u8.slice(lh + 30 + lnl, lh + 30 + lnl + lxl);
    const ds = lh + 30 + lnl + lxl;
    e.raw = u8.subarray(ds, ds + e.csize);
    entries.push(e);
  }
  void cdSize;
  return { entries, comment };
}
function decodeLatinOrUtf8(b){ try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return String.fromCharCode.apply(null, b); } }
async function zipEntryBytes(e){
  let data;
  if (e.method === 0) data = e.raw.slice();
  else if (e.method === 8) data = await inflateRaw(e.raw);
  else throw new Error('Неподдерживаемый метод сжатия ' + e.method + ' в части ' + e.name);
  if (crc32(data) !== e.crc) throw new Error('Часть ' + e.name + ' повреждена: контрольная сумма CRC32 не совпадает. Откройте и пересохраните книгу в Excel; если не поможет — возьмите резервную копию.');
  return data;
}
function zipFind(zip, name){ const l = name.toLowerCase(); return zip.entries.find(e => e.name.toLowerCase() === l); }
/** Новые данные для записи, с сохранением метода сжатия и атрибутов исходной записи */
async function zipReplaceData(e, data){
  const ne = Object.assign({}, e);
  ne.usize = data.length; ne.crc = crc32(data);
  ne.raw = e.method === 0 ? data : await deflateRaw(data);
  if (e.method !== 0 && e.method !== 8){ ne.method = 8; ne.raw = await deflateRaw(data); }
  ne.csize = ne.raw.length;
  return ne;
}
function zipNewEntry(name, data, compressed){
  const nb = te.encode(name);
  return { verMade: 20, verNeed: 20, flags: 0x800, method: compressed ? 8 : 0, time: 0, date: (2024 - 1980) << 9 | 1 << 5 | 1,
    crc: crc32(data), csize: 0, usize: data.length, intAttr: 0, extAttr: 0, nameBytes: nb, name, centralExtra: new Uint8Array(0),
    comment: new Uint8Array(0), localExtra: new Uint8Array(0), raw: data, _plain: data };
}
async function zipFinalizeNew(e){ if (e._plain){ e.raw = e.method === 8 ? await deflateRaw(e._plain) : e._plain; e.csize = e.raw.length; delete e._plain; } return e; }
function zipWrite(entries, comment){
  const parts = []; const central = []; let off = 0;
  for (const e of entries){
    const flags = e.flags & ~0x8; // данные о размерах пишем в локальный заголовок, дескриптор не нужен
    const lh = new Uint8Array(30); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, e.verNeed, true); dv.setUint16(6, flags, true);
    dv.setUint16(8, e.method, true); dv.setUint16(10, e.time, true); dv.setUint16(12, e.date, true);
    dv.setUint32(14, e.crc, true); dv.setUint32(18, e.csize, true); dv.setUint32(22, e.usize, true);
    dv.setUint16(26, e.nameBytes.length, true); dv.setUint16(28, e.localExtra.length, true);
    parts.push(lh, e.nameBytes, e.localExtra, e.raw);
    const ch = new Uint8Array(46); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, e.verMade, true); cv.setUint16(6, e.verNeed, true);
    cv.setUint16(8, flags, true); cv.setUint16(10, e.method, true); cv.setUint16(12, e.time, true); cv.setUint16(14, e.date, true);
    cv.setUint32(16, e.crc, true); cv.setUint32(20, e.csize, true); cv.setUint32(24, e.usize, true);
    cv.setUint16(28, e.nameBytes.length, true); cv.setUint16(30, e.centralExtra.length, true); cv.setUint16(32, e.comment.length, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, e.intAttr, true); cv.setUint32(38, e.extAttr, true); cv.setUint32(42, off, true);
    central.push(ch, e.nameBytes, e.centralExtra, e.comment);
    off += 30 + e.nameBytes.length + e.localExtra.length + e.raw.length;
  }
  const cd = concatBytes(central);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, off, true); ev.setUint16(20, (comment || []).length, true);
  return concatBytes([...parts, cd, end, comment || new Uint8Array(0)]);
}

/* ---- DataMashup (MS-QDEFF): версия, PackageParts(zip), Permissions, Metadata, PermissionBindings ---- */
function parseDataMashup(u8){
  if (u8.length < 8) throw new Error('DataMashup слишком короткий.');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint32(0, true);
  const pLen = dv.getUint32(4, true);
  if (8 + pLen > u8.length) throw new Error('DataMashup: длина блока PackageParts выходит за пределы данных.');
  const parts = u8.subarray(8, 8 + pLen);
  const tail = u8.subarray(8 + pLen); // Permissions + Metadata + PermissionBindings — переносятся без изменений
  const info = { version, partsLen: pLen, tailLen: tail.length };
  try {
    let o = 0; const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const permLen = tv.getUint32(o, true); info.permissions = decodeText(tail.subarray(4, 4 + permLen)).text; o = 4 + permLen;
    const metaLen = tv.getUint32(o, true); info.metaLen = metaLen; info.metadata = tail.subarray(o + 4, o + 4 + metaLen); o += 4 + metaLen;
    const bindLen = tv.getUint32(o, true); info.bindLen = bindLen; info.permLen = permLen; o += 4 + bindLen;
    info.trailing = tail.length - o;
  } catch (err) { info.tailError = String(err.message || err); }
  return { version, parts, tail, info };
}
function buildDataMashup(dm, newParts){
  return concatBytes([u32le(dm.version), u32le(newParts.length), newParts, dm.tail]);
}
/** Метаданные запросов: XML внутри блока Metadata (FillEnabled, FillCount, FillColumnNames…) */
function parseMashupMetadata(metaBytes){
  const res = {};
  if (!metaBytes || metaBytes.length < 8) return res;
  try {
    const dv = new DataView(metaBytes.buffer, metaBytes.byteOffset, metaBytes.byteLength);
    const xmlLen = dv.getUint32(4, true);
    const xml = decodeText(metaBytes.subarray(8, 8 + xmlLen)).text;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const item of doc.getElementsByTagName('Item')){
      const loc = item.getElementsByTagName('ItemLocation')[0]; if (!loc) continue;
      const type = (loc.getElementsByTagName('ItemType')[0] || {}).textContent;
      const path = (loc.getElementsByTagName('ItemPath')[0] || {}).textContent || '';
      if (type !== 'Formula') continue;
      const segs = path.split('/');
      if (segs.length !== 2) continue;
      let name; try { name = decodeURIComponent(segs[1]); } catch { name = segs[1]; }
      const m = {};
      for (const en of item.getElementsByTagName('Entry')) m[en.getAttribute('Type')] = en.getAttribute('Value');
      res[name] = m;
    }
  } catch { /* метаданные — справочная информация, их отсутствие не мешает */ }
  return res;
}
/** Permissions (MS-QDEFF 2.4): FirewallEnabled=false — для книги выбрано «игнорировать уровни конфиденциальности».
    Защищено Permission Bindings (DPAPI пользователя): после любой правки кода Excel сбрасывает к умолчанию. */
function parsePermissions(xml){
  if (!xml) return null;
  const fw = /<(?:\w+:)?FirewallEnabled>\s*(true|false)\s*</i.exec(xml); const gt = /<(?:\w+:)?WorkbookGroupType\b[^>]*>\s*([^<\s]+)\s*</i.exec(xml);
  return { firewall: fw ? fw[1].toLowerCase() === 'true' : null, group: gt ? gt[1] : null };
}
/** Как книга обновляется: свойства подключений (xl/connections.xml) и макросы (xl/vbaProject.bin).
    Только для советов и правки флагов подключений; ошибка здесь не мешает открыть книгу. Код макросов никуда не выгружается. */
async function readRefreshParts(book, zip){
  book.privacy = parsePermissions(book.dm && book.dm.info && book.dm.info.permissions);
  const ce = zipFind(zip, 'xl/connections.xml');
  if (ce){ try { const d = decodeText(await zipEntryBytes(ce)); Object.assign(book, { connsEntry: ce, connsText: d.text, connsEnc: d.enc, connsBom: d.bom }); book.conns = parseConnections(d.text); } catch (e){ book.connsError = e.message; } }
  const ve = zipFind(zip, 'xl/vbaProject.bin');
  if (ve){ try { book.vba = readVbaProject(await zipEntryBytes(ve)); } catch (e){ book.vba = { modules: [], error: e.message }; } }
}
function metaVal(v){
  if (v == null) return null;
  const t = v[0], r = v.slice(1);
  if (t === 'l') return r === '1' ? true : r === '0' ? false : Number(r);
  if (t === 's'){ if (r.startsWith('[')) { try { return JSON.parse(r); } catch { /* как текст */ } } return r; }
  if (t === 'd') return r;
  return r;
}

/* =====================================================================
   Загрузка книги любого поддерживаемого формата → единая модель Book
   ===================================================================== */
const SECTION_PATH = 'Formulas/Section1.m';

/** Чтение книги. Собственные ошибки разбора (класс Error) понятны пользователю и проходят как есть;
    внутренние (битый deflate, выход за границы, неверный base64/UTF-16, JSON) — это повреждённый файл */
async function loadBookFromBytes(name, u8){
  try { return await readBookBytes(name, u8); }
  catch (e){
    if (e && e.constructor === Error) throw e;
    const err = new Error('Файл повреждён: не удалось разобрать его содержимое (' + (e && e.name || 'Error') + (e && e.message ? ': ' + e.message : '') + '). Откройте и пересохраните книгу в Excel; если не поможет — возьмите резервную копию.');
    err.cause = e; throw err;
  }
}
async function readBookBytes(name, u8){
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (['m', 'pq', 'txt'].includes(ext)) return loadBookFromText(name, decodeText(u8).text);
  const zip = zipRead(u8);
  const book = { name, ext, bytes: u8, zip, sha: sha256(u8), kind: 'zip', warnings: [] };
  if (ext === 'pbix' || ext === 'pbit' || zipFind(zip, 'DataMashup') || zipFind(zip, 'DataModelSchema')){
    book.family = 'pbi';
    const dmE = zipFind(zip, 'DataMashup');
    const dmsE = zipFind(zip, 'DataModelSchema');
    let dmParsed = null, section = null;
    if (dmE){
      dmParsed = parseDataMashup(await zipEntryBytes(dmE));
      section = await readSectionFromParts(dmParsed.parts);
    }
    if (section && section.members.length){
      Object.assign(book, { container: 'pbi-mashup', dmEntry: dmE, dm: dmParsed, pkg: section.pkg, secEntry: section.entry, secEnc: section.enc, secBom: section.bom });
      book.origSection = section.text;
      book.meta = parseMashupMetadata(dmParsed.info.metadata);
    } else if (dmsE){
      const raw = await zipEntryBytes(dmsE);
      const dec = decodeText(raw, 'utf-16le');
      const schema = JSON.parse(dec.text);
      const exprs = collectSchemaExpressions(schema);
      if (!exprs.length) throw new Error('В DataModelSchema нет M-выражений (возможно, модель без Power Query).');
      Object.assign(book, { container: 'pbi-schema', dmsEntry: dmsE, schema, schemaEnc: dec.enc, schemaBom: dec.bom, schemaExprs: exprs });
      book.origSection = schemaToSection(exprs);
      book.meta = {};
      book.warnings.push('Запросы прочитаны из DataModelSchema (формат расширенных метаданных). Имена «Таблица» — это таблицы модели; параметры и общие выражения — из model.expressions.');
    } else {
      throw new Error(ext === 'pbix'
        ? 'В этом .pbix запросы хранятся в сжатой модели данных (формат расширенных метаданных) и недоступны для чтения. Сохраните отчёт как шаблон: «Файл → Экспорт → Шаблон Power BI (.pbit)» и загрузите .pbit.'
        : 'Не найдены ни DataMashup, ни DataModelSchema — запросов Power Query в файле нет.');
    }
    if (zipFind(zip, 'SecurityBindings')) book.hasSecurityBindings = true;
  } else {
    book.family = 'excel';
    let found = null;
    for (const e of zip.entries){
      if (!/^customXml\/item\d+\.xml$/i.test(e.name)) continue;
      const raw = await zipEntryBytes(e);
      const dec = decodeText(raw);
      const m = dec.text.match(/(<DataMashup\b[^>]*>)([\s\S]*?)(<\/DataMashup>)/);
      if (m){ found = { e, dec, m }; break; }
    }
    if (!found){
      const err = new Error('Запросов Power Query в этой книге нет: не найдена часть DataMashup в customXml/item*.xml. Если запросы есть, но книга сохранена очень старой версией Excel, пересохраните её в Excel 2016+.');
      err.noMashup = true; throw err;
    }
    const { e, dec, m } = found;
    const dm = parseDataMashup(b64decode(m[2]));
    const section = await readSectionFromParts(dm.parts);
    if (!section) throw new Error('В DataMashup не найден Formulas/Section1.m.');
    Object.assign(book, { container: 'excel', itemEntry: e, itemEnc: dec.enc, itemBom: dec.bom, itemText: dec.text,
      itemPrefix: dec.text.slice(0, m.index + m[1].length), itemSuffix: dec.text.slice(m.index + m[1].length + m[2].length),
      dm, pkg: section.pkg, secEntry: section.entry, secEnc: section.enc, secBom: section.bom });
    book.origSection = section.text;
    book.meta = parseMashupMetadata(dm.info.metadata);
    await readRefreshParts(book, zip);
  }
  return book;
}
async function readSectionFromParts(partsU8){
  const pkg = zipRead(partsU8);
  const entry = zipFind(pkg, SECTION_PATH);
  if (!entry) return null;
  const raw = await zipEntryBytes(entry);
  const dec = decodeText(raw);
  return { pkg, entry, text: dec.text, enc: dec.enc, bom: dec.bom, members: parseSection(dec.text).members };
}
function loadBookFromText(name, text, singleName){
  let t = text.replace(/^\uFEFF/, '');
  let sec = parseSection(t);
  let synthetic = false;
  if (!sec.hasHeader){
    if (!sec.members.length){ t = 'section Section1;\r\n\r\nshared ' + mQuoteName(singleName || 'Запрос1') + ' = ' + t.replace(/;\s*$/, '') + ';\r\n'; }
    else t = 'section Section1;\r\n\r\n' + t;
    synthetic = true;
  }
  return { name, ext: 'm', kind: 'text', family: 'text', container: 'text', origSection: t, meta: {}, warnings: synthetic ? ['Текст дополнен заголовком section Section1; — так его удобнее анализировать. Для вставки в Расширенный редактор используйте код отдельных запросов.'] : [], sha: sha256(text) };
}

/* DataModelSchema (pbit): tables[].partitions[].source.expression и model.expressions[] */
function collectSchemaExpressions(schema){
  const out = []; const model = schema.model || {};
  for (const [ti, t] of (model.tables || []).entries()){
    for (const [pi, p] of (t.partitions || []).entries()){
      if (p.source && p.source.type === 'm' && p.source.expression != null){
        const multi = (t.partitions || []).filter(x => x.source && x.source.type === 'm').length > 1;
        out.push({ name: multi ? t.name + ' / ' + p.name : t.name, path: ['tables', ti, 'partitions', pi], isArray: Array.isArray(p.source.expression), text: [].concat(p.source.expression).join('\n') });
      }
    }
  }
  for (const [ei, x] of (model.expressions || []).entries()){
    if (x.expression != null && (!x.kind || x.kind === 'm')) out.push({ name: x.name, path: ['expressions', ei], isArray: Array.isArray(x.expression), text: [].concat(x.expression).join('\n'), shared: true });
  }
  return out;
}
function schemaToSection(exprs){
  let s = 'section Section1;\r\n';
  for (const x of exprs) s += '\r\nshared ' + mQuoteName(x.name) + ' = ' + x.text + ';\r\n';
  return s;
}

/* =====================================================================
   Сборка новой копии файла с новым Section1.m
   ===================================================================== */
/** Новая копия книги. Код не менялся — DataMashup переносится байт в байт (сохраняются Permission Bindings,
    а с ними флаг «игнорировать уровни конфиденциальности»). edits.conns — правки флагов подключений (applyConnEdits). */
async function buildBookWithSection(book, newSection, edits){
  if (book.container === 'text') throw new Error('Источник — текст, а не файл: собрать книгу нельзя. Скопируйте код запросов в Расширенный редактор.');
  if (book.container === 'pbi-schema') return buildPbiSchema(book, newSection);
  let outEntries = book.zip.entries;
  if (newSection !== book.origSection){
    const secBytes = encodeText(newSection, book.secEnc, book.secBom);
    const newSecEntry = await zipReplaceData(book.secEntry, secBytes);
    const pkgEntries = book.pkg.entries.map(e => e === book.secEntry ? newSecEntry : e);
    const newParts = zipWrite(pkgEntries, book.pkg.comment);
    const newDm = buildDataMashup(book.dm, newParts);
    if (book.container === 'excel'){
      const itemText = book.itemPrefix + b64encode(newDm) + book.itemSuffix;
      const itemBytes = encodeText(itemText, book.itemEnc, book.itemBom);
      const ni = await zipReplaceData(book.itemEntry, itemBytes);
      outEntries = outEntries.map(e => e === book.itemEntry ? ni : e);
    } else {
      const nd = await zipReplaceData(book.dmEntry, newDm);
      outEntries = outEntries.map(e => e === book.dmEntry ? nd : e).filter(e => e.name !== 'SecurityBindings');
    }
  }
  const ce = edits && edits.conns;
  if (ce && Object.keys(ce).length){
    if (!book.connsEntry) throw new Error('В книге нет xl/connections.xml — менять свойства подключений негде.');
    const xml = applyConnEdits(book.connsText, ce);
    if (xml !== book.connsText){ const ne = await zipReplaceData(book.connsEntry, encodeText(xml, book.connsEnc, book.connsBom)); outEntries = outEntries.map(e => e === book.connsEntry ? ne : e); }
  }
  return zipWrite(outEntries, book.zip.comment);
}
async function buildPbiSchema(book, newSection){
  const sec = parseSection(newSection);
  const byName = new Map(sec.members.map(m => [m.name, m]));
  const schema = JSON.parse(JSON.stringify(book.schema));
  for (const x of book.schemaExprs){
    const m = byName.get(x.name);
    if (!m) throw new Error('В новом коде нет запроса «' + x.name + '». Для .pbit поддерживается только изменение существующих выражений.');
    const text = newSection.slice(m.exprStart, m.exprEnd).replace(/^\s+/, '');
    let node = schema.model; for (const k of x.path) node = node[k];
    const target = x.path[0] === 'expressions' ? node : node.source;
    target.expression = x.isArray ? text.split(/\r?\n/) : text;
  }
  for (const m of sec.members) if (!book.schemaExprs.some(x => x.name === m.name)) throw new Error('Новый запрос «' + m.name + '»: добавление таблиц в .pbit не поддерживается.');
  const bytes = encodeText(JSON.stringify(schema, null, 2), book.schemaEnc, book.schemaBom);
  const ne = await zipReplaceData(book.dmsEntry, bytes);
  const out = book.zip.entries.map(e => e === book.dmsEntry ? ne : e).filter(e => e.name !== 'SecurityBindings');
  return zipWrite(out, book.zip.comment);
}
