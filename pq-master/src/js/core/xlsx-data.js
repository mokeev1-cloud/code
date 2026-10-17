/* =====================================================================
   core/xlsx-data.js — данные книги .xlsx/.xlsm: листы, таблицы (ListObject) и именованные диапазоны.
   Нужно для вычислений на этом компьютере: Excel.CurrentWorkbook (таблицы открытой книги) и
   Excel.Workbook (прикреплённые выгрузки). Значения не выгружаются: наружу (ИИ, папка обмена,
   буфер) уходит только обезличенное — см. DEV.md, «Данные — только локально».
   readXlsxData(zip, { only, maxRows }) → { sheets, tables, names, truncated }
     sheets: [{ name, hidden, cols, rows }] — используемый диапазон листа, столбцы Column1…N;
     tables: [{ name, sheet, cols, rows }]; names: [{ name, cols, rows }].
   Значение ячейки: число, текст, логическое, null, { xd: серийный номер, kind: date|datetime|time }
   или { err: '#N/A' } (преобразует в M xlsxValueToM, m/interp.js).
   ===================================================================== */
function xlsxCol(s){ let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; }
function xlsxRef(ref){ const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref); return m ? { c: xlsxCol(m[1]), r: +m[2] - 1 } : null; }
function xlsxRange(ref){ const [a, b] = String(ref).split(':'); const p = xlsxRef(a), q = b ? xlsxRef(b) : p; return p && q ? { r0: Math.min(p.r, q.r), c0: Math.min(p.c, q.c), r1: Math.max(p.r, q.r), c1: Math.max(p.c, q.c) } : null; }
/** Форматы дат: встроенные номера и пользовательские коды с d/m/y/h/s (без учёта текста в кавычках и [цвета]) */
function xlsxDateKinds(stylesXml){
  const custom = {}; let m; const reF = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  while ((m = reF.exec(stylesXml))) custom[m[1]] = xmlUnescape(m[2]);
  const kindOf = id => {
    if ((id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 31) || (id >= 34 && id <= 36) || (id >= 50 && id <= 58)) return id === 22 ? 'datetime' : 'date';
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47) || id === 32 || id === 33) return 'time';
    const code = custom[id]; if (!code) return null;
    const c = code.split(';')[0].replace(/\[(h+|m+|s+)\]/gi, '$1').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');   // [h]:mm — длительность, оставить h
    const d = /[dy]/i.test(c) || /m{3,}/i.test(c), t = /[hs]/i.test(c);
    return d && t ? 'datetime' : d ? 'date' : t ? 'time' : null;
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml || ''); const kinds = [];
  if (xfs){ const reX = /<xf\b([^>]*?)\/?>/g; while ((m = reX.exec(xfs[1]))){ const id = /numFmtId="(\d+)"/.exec(m[1]); kinds.push(id ? kindOf(+id[1]) : null); } }
  return kinds;
}
function xlsxSharedStrings(xml){
  const out = []; if (!xml) return out; const reS = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m;
  while ((m = reS.exec(xml))){ const body = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); let s = ''; const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let t; while ((t = reT.exec(body))) s += t[1]; out.push(xmlUnescape(s)); }
  return out;
}
/** Сетка листа: grid[строка][столбец] (абсолютные индексы с 0) и границы используемого диапазона */
function xlsxParseSheet(xml, ss, kinds, date1904, maxRows){
  const grid = []; let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1, truncated = false;
  const reRow = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let rm, nextRow = 0;
  while ((rm = reRow.exec(xml))){
    const ra = /\br="(\d+)"/.exec(rm[1]); const r = ra ? +ra[1] - 1 : nextRow; nextRow = r + 1;
    if (maxRows && r >= maxRows){ truncated = true; break; }
    if (!rm[2]) continue;
    const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm, nextCol = 0;
    while ((cm = reC.exec(rm[2]))){
      const a = cm[1]; const ref = /\br="([A-Z]+)\d*"/.exec(a); const c = ref ? xlsxCol(ref[1]) : nextCol; nextCol = c + 1;
      const body = cm[2] || ''; const t = (/\bt="(\w+)"/.exec(a) || [])[1]; const si = /\bs="(\d+)"/.exec(a);
      let v = null; const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (t === 'inlineStr'){ let s = ''; const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let x; while ((x = reT.exec(body))) s += x[1]; v = xmlUnescape(s); }
      else if (!vm) continue;
      else if (t === 's') v = ss[+vm[1]] != null ? ss[+vm[1]] : '';
      else if (t === 'str') v = xmlUnescape(vm[1]);
      else if (t === 'b') v = vm[1] === '1';
      else if (t === 'e') v = { err: xmlUnescape(vm[1]) };
      else { const n = +vm[1]; const k = si ? kinds[+si[1]] : null; v = k && isFinite(n) ? { xd: n + (date1904 ? 1462 : 0), kind: k } : n; }
      (grid[r] || (grid[r] = []))[c] = v;
      if (r < r0) r0 = r; if (r > r1) r1 = r; if (c < c0) c0 = c; if (c > c1) c1 = c;
    }
  }
  return { grid, r0, c0, r1, c1, truncated };
}
function xlsxSlice(grid, g){ const rows = []; for (let r = g.r0; r <= g.r1; r++){ const src = grid[r] || []; const row = new Array(g.c1 - g.c0 + 1); for (let c = g.c0; c <= g.c1; c++) row[c - g.c0] = src[c] === undefined ? null : src[c]; rows.push(row); } return rows; }
const xlsxColumns = n => Array.from({ length: Math.max(0, n) }, (_, i) => 'Column' + (i + 1));
async function readXlsxData(zip, opts){
  opts = opts || {};
  const get = async n => { const e = zipFind(zip, n); return e ? decodeText(await zipEntryBytes(e)).text : null; };
  const resolve = (base, target) => { if (target.startsWith('/')) return target.slice(1); const parts = base.split('/').slice(0, -1); for (const s of target.split('/')){ if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); } return parts.join('/'); };
  const relsOf = async part => { const xml = await get(part.replace(/([^/]+)$/, '_rels/$1.rels')) || ''; const out = []; const re = /<Relationship\b([^>]*?)\/?>/g; let m; while ((m = re.exec(xml))){ const a = xmlAttrs(m[1]); out.push({ id: a.Id, type: a.Type || '', target: resolve(part, a.Target || '') }); } return out; };
  const wb = await get('xl/workbook.xml'); if (!wb) throw new Error('Не книга Excel: нет xl/workbook.xml (формат .xls и .xlsb не читается).');
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const wbRels = await relsOf('xl/workbook.xml');
  const ss = xlsxSharedStrings(await get('xl/sharedStrings.xml'));
  const kinds = xlsxDateKinds(await get('xl/styles.xml') || '');
  const sheetDefs = []; let m; const reSh = /<sheet\b([^>]*?)\/?>/g;
  while ((m = reSh.exec(wb))){ const a = xmlAttrs(m[1]); const rid = a['r:id'] || Object.entries(a).find(([k]) => /:id$/.test(k))?.[1]; const rel = wbRels.find(x => x.id === rid); if (rel) sheetDefs.push({ name: a.name, hidden: !!a.state && a.state !== 'visible', part: rel.target }); }
  // именованные диапазоны: только простые ссылки Лист!$A$1:$C$9, без служебных _xlnm и скрытых
  const names = []; const reN = /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g;
  while ((m = reN.exec(wb))){ const a = xmlAttrs(m[1]); if (/^_xlnm\./i.test(a.name) || a.hidden === '1' || a.localSheetId != null) continue; const f = xmlUnescape(m[2]).trim(); const fm = /^(?:'((?:[^']|'')+)'|([^'!]+))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/.exec(f); if (fm) names.push({ name: a.name, sheet: fm[1] != null ? fm[1].replace(/''/g, "'") : fm[2], range: xlsxRange(fm[3]) }); }
  const out = { sheets: [], tables: [], names: [], truncated: false };
  for (const sd of sheetDefs){
    const tParts = (await relsOf(sd.part)).filter(r => /\/table$/.test(r.type));
    const tdefs = [];
    for (const tp of tParts){ const tx = await get(tp.target); if (!tx) continue; const ta = xmlAttrs((/<table\b([^>]*)>/.exec(tx) || [, ''])[1]); const cols = []; const reTc = /<tableColumn\b([^>]*?)\/?>/g; let c; while ((c = reTc.exec(tx))) cols.push(xmlAttrs(c[1]).name || ''); tdefs.push({ name: ta.displayName || ta.name, range: xlsxRange(ta.ref), header: ta.headerRowCount == null ? 1 : +ta.headerRowCount, totals: +(ta.totalsRowCount || 0), cols }); }
    const myNames = names.filter(n => n.sheet === sd.name);
    if (opts.only === 'objects' && !tdefs.length && !myNames.length) continue;
    const xml = await get(sd.part); if (xml == null) continue;
    const g = xlsxParseSheet(xml, ss, kinds, date1904, opts.maxRows); if (g.truncated) out.truncated = true;
    if (opts.only !== 'objects'){ const ok = g.r1 >= 0; out.sheets.push({ name: sd.name, hidden: sd.hidden, cols: xlsxColumns(ok ? g.c1 - g.c0 + 1 : 0), rows: ok ? xlsxSlice(g.grid, g) : [] }); }
    for (const t of tdefs){ if (!t.range) continue; const rg = { r0: t.range.r0 + t.header, c0: t.range.c0, r1: Math.min(t.range.r1 - t.totals, g.r1), c1: t.range.c1 } /* не дальше прочитанных строк (лимит) */; const w = rg.c1 - rg.c0 + 1;
      out.tables.push({ name: t.name, sheet: sd.name, cols: t.cols.length === w ? t.cols : xlsxColumns(w), rows: rg.r1 >= rg.r0 ? xlsxSlice(g.grid, rg) : [] }); }
    for (const n of myNames) if (n.range){ const rg = Object.assign({}, n.range, { r1: Math.min(n.range.r1, g.r1), c1: Math.min(n.range.c1, Math.max(g.c1, n.range.c0)) });   // «A1:C1048576» — до последней заполненной строки
      out.names.push({ name: n.name, cols: xlsxColumns(rg.c1 - rg.c0 + 1), rows: rg.r1 >= rg.r0 ? xlsxSlice(g.grid, rg) : [] }); }
  }
  return out;
}
