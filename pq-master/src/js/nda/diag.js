/* =====================================================================
   Диагностика Power Query: CSV / XLSX / трассировки
   ===================================================================== */
function parseCSV(text){
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const cnt = d => { let n = 0, q = false; for (const ch of first){ if (ch === '"') q = !q; else if (!q && ch === d) n++; } return n; };
  const delim = [';', ',', '\t', '|'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') { q = true; continue; }
    if (ch === delim){ row.push(f); f = ''; continue; }
    if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; continue; }
    f += ch;
  }
  if (f !== '' || row.length){ row.push(f); rows.push(row); }
  return { delim, rows };
}
function toCSV(rows, delim){
  const q = v => { v = v == null ? '' : String(v); return /["\r\n]/.test(v) || v.includes(delim) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '\uFEFF' + rows.map(r => r.map(q).join(delim)).join('\r\n') + '\r\n';
}
async function readXlsxSheets(u8, maxRows){
  const zip = zipRead(u8);
  const get = async n => { const e = zipFind(zip, n); return e ? decodeText(await zipEntryBytes(e)).text : null; };
  const P = s => new DOMParser().parseFromString(s, 'application/xml');
  const wb = P(await get('xl/workbook.xml') || '<x/>');
  const rels = P(await get('xl/_rels/workbook.xml.rels') || '<x/>');
  const relMap = {}; for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const ssXml = await get('xl/sharedStrings.xml'); const ss = [];
  if (ssXml) for (const si of P(ssXml).getElementsByTagName('si')){ let s = ''; for (const t of si.getElementsByTagName('t')) s += t.textContent; ss.push(s); }
  const sheets = [];
  for (const sh of wb.getElementsByTagName('sheet')){
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || ''; target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
    const xml = await get(target); if (!xml) continue;
    const doc = P(xml); const rows = [];
    for (const r of doc.getElementsByTagName('row')){
      const row = [];
      for (const c of r.getElementsByTagName('c')){
        const ref = c.getAttribute('r') || ''; const col = colIndex(ref.replace(/\d+/g, '')) ; const t = c.getAttribute('t');
        let v = '';
        if (t === 's'){ const vn = c.getElementsByTagName('v')[0]; v = vn ? ss[+vn.textContent] || '' : ''; }
        else if (t === 'inlineStr'){ for (const tt of c.getElementsByTagName('t')) v += tt.textContent; }
        else { const vn = c.getElementsByTagName('v')[0]; v = vn ? vn.textContent : ''; }
        row[col >= 0 ? col : row.length] = v;
      }
      for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
      rows.push(row);
      if (maxRows && rows.length >= maxRows) break;
    }
    sheets.push({ name: sh.getAttribute('name'), rows });
  }
  return sheets;
}
function colIndex(letters){ let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

const DIAG_KEEP = /(^|\s)(id|guid)$|^(activity|parent|group|query|step|partition|session|process|thread|request|operation) ?id$|start ?time|end ?time|duration|row ?count|content ?length|^operation$|^category$|is ?user ?query|data ?source ?kind|^kind$|^level$|^status$|^count$|timestamp|^(exclusive|inclusive)|%|^rows?$|^bytes$|^size$|^cpu|^memory|^wait/i;
const DIAG_NAMES = /^(query|step|partition key|partition|action|activity|event|name)$/i;
const DIAG_SQL = /data ?source ?query|native ?query|command ?text|^sql|^query text|^statement/i;
const DIAG_STRICT = /resource|data ?source(?! ?kind)|server|database|connection|url|^file|folder|^path$|location|user|machine|host|account|credential/i;
const RE_PLAINVAL = /^(\s*|-?\d+([.,]\d+)?(E[+-]?\d+)?%?|\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?|\d{4}-\d{2}-\d{2}([ T][\d:.,]+)?(Z|[+-]\d{2}:?\d{2})?|\d{1,2}[./]\d{1,2}[./]\d{2,4}( [\d:.,]+)?|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|true|false|null|истина|ложь|[\d/]+|-?\d+\.\d{2}:\d{2}:\d{2}(\.\d+)?)$/i;
const DIAG_MODES = [['keep','Оставить'],['names','Имена (чёрный список, имена запросов)'],['anon','Обезличить текст'],['strict','Обезличить строго'],['sql','SQL'],['drop','Удалить столбец']];

function classifyDiagColumn(header, values){
  const h = String(header || '').trim();
  const plain = values.every(v => RE_PLAINVAL.test(String(v == null ? '' : v)));
  if (DIAG_SQL.test(h)) return 'sql';
  if (DIAG_KEEP.test(h) && plain) return 'keep';
  if (DIAG_NAMES.test(h)) return 'names';
  if (DIAG_STRICT.test(h)) return plain ? 'keep' : 'strict';
  if (plain) return 'keep';
  return 'anon';
}
function anonymizeCell(v, mode, cfg, dict){
  if (v == null || v === '') return v;
  if (mode === 'keep') return v;
  if (mode === 'names') return anonymizeFree(v, cfg, dict, 'names');
  if (mode === 'sql') return anonymizeFree(v, cfg, dict, 'sql');
  if (mode === 'strict') return anonymizeFree(v, cfg, dict, 'strict');
  return anonymizeFree(v, cfg, dict, 'anon');
}
function anonymizeTable(rows, modes, cfg, dict){
  const keepIdx = modes.map((m, i) => m === 'drop' ? -1 : i).filter(i => i >= 0);
  return rows.map((r, ri) => keepIdx.map(i => ri === 0 ? anonymizeFree(r[i], cfg, dict, 'names') : anonymizeCell(r[i], modes[i], cfg, dict)));
}
const TRACE_KEYS = /^(ResourcePath|Path|Url|Uri|Query|CommandText|ConnectionString|DataSource|Data ?Source|Server|Database|UserName|User|MachineName|Host|HostName|FileName|File|Folder|Expression|Formula|Section|Message|Text|Account|Resource|Credential|ProviderName|DataSourcePath|TargetPath|Location)$/i;
function anonymizeTrace(text, cfg, dict){
  return text.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line) || !line) return line;
    let l = line.replace(/"([\w ]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g, (m, k, v) => {
      if (!TRACE_KEYS.test(k)) return m;
      const raw = v.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
      const mode = /^(Query|CommandText|Expression|Formula|Section|Text)$/i.test(k) ? 'sql' : 'strict';
      const an = anonymizeFree(raw, cfg, dict, mode);
      return '"' + k + '":"' + an.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    });
    return anonymizeFree(l, cfg, dict, 'anon');
  }).join('');
}
/* длительность: "00:00:01.2345678", "1.02:03:04.5", число секунд/мс */
function parseDuration(v){
  if (v == null) return NaN; const s = String(v).trim(); if (!s) return NaN;
  let m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:[.,]\d+)?)$/.exec(s);
  if (m) return (+(m[1] || 0)) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + parseFloat(m[4].replace(',', '.'));
  m = /^(\d{1,2}):(\d{2}(?:[.,]\d+)?)$/.exec(s); if (m) return (+m[1]) * 60 + parseFloat(m[2].replace(',', '.'));
  const n = parseFloat(s.replace(',', '.')); return isFinite(n) ? n : NaN;
}
function parseTime(v){ if (v == null || v === '') return NaN; let s = String(v).trim();
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(.*)$/.exec(s); if (ru) s = ru[3] + '-' + ru[2].padStart(2, '0') + '-' + ru[1].padStart(2, '0') + 'T' + ru[4];
  const n = Number(s); if (isFinite(n) && n > 20000 && n < 80000) return (n - 25569) * 86400000; // серийная дата Excel
  const t = Date.parse(s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')); return t; }
function diagVizData(rows){
  if (!rows || rows.length < 2) return null;
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = (...names) => { for (const n of names){ const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iQ = idx('query'), iS = idx('step'), iE = idx('exclusive duration', 'exclusive duration (ms)', 'duration'), iSt = idx('start time'), iEn = idx('end time'), iOp = idx('operation'), iCat = idx('category'), iRes = idx('resource', 'data source query');
  if (iE < 0 && !(iSt >= 0 && iEn >= 0)) return null;
  const agg = new Map(); const tl = [];
  for (const r of rows.slice(1)){
    let d = iE >= 0 ? parseDuration(r[iE]) : NaN;
    const ts = iSt >= 0 ? parseTime(r[iSt]) : NaN, te2 = iEn >= 0 ? parseTime(r[iEn]) : NaN;
    if (!isFinite(d) && isFinite(ts) && isFinite(te2)) d = (te2 - ts) / 1000;
    if (!isFinite(d)) continue;
    const key = (iQ >= 0 ? r[iQ] : '?') + ' › ' + (iS >= 0 ? r[iS] : (iOp >= 0 ? r[iOp] : ''));
    const a = agg.get(key) || { key, q: iQ >= 0 ? r[iQ] : '', step: iS >= 0 ? r[iS] : '', d: 0, n: 0, cat: iCat >= 0 ? r[iCat] : '' };
    a.d += d; a.n++; agg.set(key, a);
    if (isFinite(ts) && isFinite(te2) && tl.length < 400) tl.push({ ts, te: te2, label: key, op: iOp >= 0 ? r[iOp] : '', res: iRes >= 0 ? r[iRes] : '' });
  }
  const top = [...agg.values()].sort((a, b) => b.d - a.d).slice(0, 25);
  const perQ = new Map(); for (const a of agg.values()) perQ.set(a.q, (perQ.get(a.q) || 0) + a.d);
  return { top, perQ: [...perQ.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), tl: tl.sort((a, b) => a.ts - b.ts) };
}
