/* =====================================================================
   Язык M: лексер, структура скобок, section-документ, шаги let…in
   ===================================================================== */
const M_KEYWORDS = new Set(['and','as','each','else','error','false','if','in','is','let','meta','not','null','or','otherwise','section','shared','then','true','try','type']);
const RE_WS = /[ \t\r\n\u00A0\uFEFF\u2028\u2029\v\f]+/y;
const RE_ID = /[\p{L}_][\p{L}\p{N}_\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*(?:\.[\p{L}_][\p{L}\p{N}_\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*)*/uy;
const RE_HASHKW = /#(?:datetimezone|datetime|date|duration|time|table|binary|infinity|nan|sections|shared)\b/y;
const RE_NUM = /(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)/y;
const OPS3 = ['...'];
const OPS2 = ['=>','<=','>=','<>','..','??'];

function lexM(src){
  const toks = []; const n = src.length; let i = 0;
  const push = (t, s, e) => toks.push({ t, s, e, v: src.slice(s, e) });
  while (i < n){
    const c = src[i];
    RE_WS.lastIndex = i;
    if (RE_WS.test(src)){ push('ws', i, RE_WS.lastIndex); i = RE_WS.lastIndex; continue; }
    if (c === '/' && src[i+1] === '/'){ let j = i + 2; while (j < n && src[j] !== '\n' && src[j] !== '\r') j++; push('cmt', i, j); i = j; continue; }
    if (c === '/' && src[i+1] === '*'){ let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('cmt', i, j); i = j; continue; }
    if (c === '"' || (c === '#' && src[i+1] === '"')){
      let j = i + (c === '#' ? 2 : 1);
      for (;;){ if (j >= n) break; if (src[j] === '"'){ if (src[j+1] === '"'){ j += 2; continue; } j++; break; } j++; }
      push(c === '#' ? 'qid' : 'str', i, j); i = j; continue;
    }
    if (c === '#'){ RE_HASHKW.lastIndex = i; if (RE_HASHKW.test(src)){ push('id', i, RE_HASHKW.lastIndex); i = RE_HASHKW.lastIndex; continue; } }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i+1] >= '0' && src[i+1] <= '9')){
      RE_NUM.lastIndex = i; if (RE_NUM.test(src)){ push('num', i, RE_NUM.lastIndex); i = RE_NUM.lastIndex; continue; }
    }
    RE_ID.lastIndex = i;
    if (RE_ID.test(src)){ push('id', i, RE_ID.lastIndex); i = RE_ID.lastIndex; continue; }
    const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
    if (OPS3.includes(s3)){ push('op', i, i + 3); i += 3; continue; }
    if (OPS2.includes(s2)){ push('op', i, i + 2); i += 2; continue; }
    push('op', i, i + 1); i++;
  }
  return toks;
}
const isSig = t => t.t !== 'ws' && t.t !== 'cmt';
const isKw = (t, w) => t && t.t === 'id' && t.v === w;
const isName = t => t && ((t.t === 'id' && !M_KEYWORDS.has(t.v) && t.v[0] !== '#') || t.t === 'qid');
function nameOf(t){ return t.t === 'qid' ? t.v.slice(2, -1).replace(/""/g, '"') : t.v; }
function strValue(t){ return t.v.slice(1, -1).replace(/""/g, '"'); }
const RE_PLAIN_ID = /^[\p{L}_][\p{L}\p{N}_\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*(?:\.[\p{L}_][\p{L}\p{N}_\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*)*$/u;
function mQuoteName(name){ return RE_PLAIN_ID.test(name) && !M_KEYWORDS.has(name) ? name : '#"' + name.replace(/"/g, '""') + '"'; }
/** Если выражение кончается строчным комментарием «// …», завершающая «;» попадёт в комментарий —
    добавим перевод строки. Применять везде, где выражение вставляется перед «;». */
function safeExprEnd(expr, nl){
  const toks = lexM(expr); for (let i = toks.length - 1; i >= 0; i--){ const t = toks[i]; if (t.t === 'ws') continue; return t.t === 'cmt' && t.v.startsWith('//') ? expr + (nl || '\n') : expr; }
  return expr;
}
function mQuoteString(s){ return '"' + s.replace(/"/g, '""') + '"'; }

/** Структура: значимые токены, пары скобок, тип квадратных скобок (запись / доступ к полю / тип-таблица) */
function structure(toks){
  const sig = []; for (let i = 0; i < toks.length; i++) if (isSig(toks[i])) sig.push(i);
  const pos = new Map(sig.map((ti, k) => [ti, k]));
  const match = new Map(); const st = [];
  for (const ti of sig){
    const v = toks[ti].t === 'op' ? toks[ti].v : null;
    if (v === '(' || v === '[' || v === '{') st.push(ti);
    else if (v === ')' || v === ']' || v === '}'){ const o = st.pop(); if (o != null){ match.set(o, ti); match.set(ti, o); } }
  }
  const brKind = new Map(); const fieldTok = new Set(); const recFields = new Map();
  for (const [o, c] of match){
    if (o > c || toks[o].v !== '[') continue;
    const ks = pos.get(o), kc = pos.get(c);
    let depth = 0, hasEq = false;
    for (let k = ks + 1; k < kc; k++){
      const t = toks[sig[k]];
      if (t.t === 'op'){ if ('([{'.includes(t.v)) depth++; else if (')]}'.includes(t.v)) depth--; else if (depth === 0 && t.v === '=') { hasEq = true; break; } }
    }
    const prev = ks > 0 ? toks[sig[ks - 1]] : null;
    let kind = hasEq ? 'record' : 'access';
    if (hasEq && prev && prev.t === 'id' && (prev.v === 'table' || prev.v === 'type')) kind = 'typerec';
    brKind.set(o, kind);
    if (kind === 'access'){
      let simple = true; for (let k = ks + 1; k < kc; k++){ const t = toks[sig[k]]; if (!(t.t === 'id' || t.t === 'qid' || t.t === 'num')) { simple = false; break; } }
      if (simple) for (let k = ks + 1; k < kc; k++) fieldTok.add(sig[k]);
    } else {
      // имена полей записи: токены между '[' или ',' и '=' на верхнем уровне
      const fields = {}; let d = 0, expect = true, nameToks = [], cur = null;
      for (let k = ks + 1; k < kc; k++){
        const ti = sig[k], t = toks[ti];
        if (t.t === 'op' && '([{'.includes(t.v)) { d++; continue; }
        if (t.t === 'op' && ')]}'.includes(t.v)) { d--; continue; }
        if (d !== 0) continue;
        if (expect){
          if (t.t === 'op' && t.v === '='){ cur = nameToks.map(x => nameOf(toks[x])).join(' '); nameToks.forEach(x => fieldTok.add(x)); expect = false; fields[cur] = { first: sig[k + 1], only: true }; nameToks = []; }
          else if (t.t === 'id' || t.t === 'qid') nameToks.push(ti);
        } else if (t.t === 'op' && t.v === ','){ expect = true; cur = null; }
        else if (cur && fields[cur] && ti !== fields[cur].first) fields[cur].only = false;
      }
      recFields.set(o, fields);
    }
  }
  return { sig, pos, match, brKind, fieldTok, recFields };
}
function recFieldString(toks, recFields, openIdx, field){
  const f = (recFields.get(openIdx) || {})[field];
  if (!f || !f.only) return null;
  const t = toks[f.first];
  return t && t.t === 'str' ? strValue(t) : null;
}

/** section Section1; [attrs] shared Имя = выражение; … */
function parseSection(text){
  const toks = lexM(text);
  const sig = []; for (let i = 0; i < toks.length; i++) if (isSig(toks[i])) sig.push(i);
  const members = []; let k = 0, hasHeader = false, headerEnd = 0;
  if (sig.length && isKw(toks[sig[0]], 'section')){
    hasHeader = true;
    while (k < sig.length && toks[sig[k]].v !== ';') k++;
    if (k < sig.length){ headerEnd = toks[sig[k]].e; k++; }
  }
  while (k < sig.length){
    const startK = k;
    if (toks[sig[k]].v === '['){ let d = 0; for (; k < sig.length; k++){ const v = toks[sig[k]].v; if (v === '[') d++; else if (v === ']'){ d--; if (d === 0){ k++; break; } } } }
    let shared = false;
    if (k < sig.length && isKw(toks[sig[k]], 'shared')){ shared = true; k++; }
    const nt = toks[sig[k]];
    if (!nt || !isName(nt) || !(toks[sig[k + 1]] && toks[sig[k + 1]].v === '=')){
      if (!hasHeader && !shared) break; // это не section-документ, а одиночное выражение
      while (k < sig.length && toks[sig[k]].v !== ';') k++; k++; continue;
    }
    const eqK = k + 1; let d = 0, j = eqK + 1;
    for (; j < sig.length; j++){
      const t = toks[sig[j]]; if (t.t !== 'op') continue;
      if ('([{'.includes(t.v)) d++; else if (')]}'.includes(t.v)) d--; else if (t.v === ';' && d <= 0) break;
    }
    const semi = j < sig.length ? toks[sig[j]] : null;
    members.push({
      name: nameOf(nt), nameRaw: nt.v, nameS: nt.s, nameE: nt.e, shared,
      start: toks[sig[startK]].s, end: semi ? semi.e : text.length,
      exprStart: toks[sig[eqK]].e, exprEnd: semi ? semi.s : text.length,
      tokStart: sig[eqK] + 1, tokEnd: semi ? sig[j] : toks.length
    });
    k = j + 1;
  }
  return { toks, members, hasHeader, headerEnd };
}

/* ---- Справочники функций ---- */
const SOURCE_FNS = {
  'Sql.Database':['SRV','DB'], 'Sql.Databases':['SRV'], 'Oracle.Database':['SRV'], 'MySQL.Database':['SRV','DB'],
  'PostgreSQL.Database':['SRV','DB'], 'Teradata.Database':['SRV'], 'DB2.Database':['SRV','DB'], 'Sybase.Database':['SRV','DB'],
  'Informix.Database':['SRV','DB'], 'SapHana.Database':['SRV'], 'SapBusinessWarehouse.Cubes':['SRV','DB','DB'],
  'AnalysisServices.Database':['SRV','DB'], 'AnalysisServices.Databases':['SRV'], 'Snowflake.Databases':['SRV','DB'],
  'AmazonRedshift.Database':['SRV','DB'], 'Databricks.Catalogs':['SRV','DB'], 'GoogleBigQuery.Database':[], 'Impala.Database':['SRV'],
  'Odbc.DataSource':['CONN'], 'Odbc.Query':['CONN'], 'Odbc.InferOptions':['CONN'], 'OleDb.DataSource':['CONN'], 'OleDb.Query':['CONN'],
  'AdoDotNet.DataSource':['', 'CONN'], 'AdoDotNet.Query':['', 'CONN'],
  'Web.Contents':['URL'], 'Web.Page':['URL'], 'Web.BrowserContents':['URL'], 'OData.Feed':['URL'], 'Json.Document':[],
  'SharePoint.Files':['URL'], 'SharePoint.Contents':['URL'], 'SharePoint.Tables':['URL'],
  'File.Contents':['PATH'], 'Folder.Files':['PATH'], 'Folder.Contents':['PATH'], 'Hdfs.Files':['URL'], 'Hdfs.Contents':['URL'],
  'AzureStorage.Blobs':['URL'], 'AzureStorage.DataLake':['URL'], 'AzureStorage.Tables':['URL'], 'AzureDataExplorer.Contents':['URL','DB'],
  'Exchange.Contents':['EMAIL'], 'ActiveDirectory.Domains':['HOST'], 'Salesforce.Data':['URL'], 'Excel.CurrentWorkbook':[],
  'Access.Database':[], 'Excel.Workbook':[], 'Csv.Document':[], 'Xml.Tables':[], 'Pdf.Tables':[], 'Lines.FromBinary':[],
  'Python.Execute':[], 'R.Execute':[], 'Dataflows.Contents':[], 'PowerPlatform.Dataflows':[], 'PowerBI.Dataflows':[], 'Lakehouse.Contents':[]
};
// внешние источники данных (Excel.CurrentWorkbook — тоже источник, но внутри книги)
const EXTERNAL_SOURCES = new Set(Object.keys(SOURCE_FNS).filter(f => !['Json.Document','Excel.Workbook','Csv.Document','Xml.Tables','Pdf.Tables','Lines.FromBinary','Excel.CurrentWorkbook','Access.Database','Odbc.InferOptions'].includes(f)));
const DATA_SOURCES = new Set([...EXTERNAL_SOURCES, 'Excel.CurrentWorkbook']);
const FOLDABLE_SOURCES = new Set(['Sql.Database','Sql.Databases','Oracle.Database','PostgreSQL.Database','MySQL.Database','Teradata.Database','DB2.Database','Sybase.Database','Informix.Database','SapHana.Database','Snowflake.Databases','AmazonRedshift.Database','Databricks.Catalogs','GoogleBigQuery.Database','Impala.Database','Odbc.DataSource','OData.Feed','AnalysisServices.Database','AzureDataExplorer.Contents','OleDb.DataSource']);
const SQL_TEXT_ARGS = { 'Value.NativeQuery':1, 'Odbc.Query':1, 'OleDb.Query':1, 'AdoDotNet.Query':2 };

/* ---- Анализ section-документа ---- */
function analyzeSection(text, meta){
  const sec = parseSection(text);
  const toks = sec.toks; const st = structure(toks);
  const names = new Set(sec.members.map(m => m.name));
  const members = sec.members.map(m => {
    const r = Object.assign({}, m);
    r.refs = new Set(); r.calls = []; r.sources = [];
    for (let i = m.tokStart; i < m.tokEnd; i++){
      const t = toks[i]; if (!isSig(t)) continue;
      if (isName(t) && !st.fieldTok.has(i) && names.has(nameOf(t)) && nameOf(t) !== m.name) r.refs.add(nameOf(t));
      if (t.t === 'id' && !M_KEYWORDS.has(t.v)){
        const k = st.pos.get(i); const nx = toks[st.sig[k + 1]];
        if (nx && nx.v === '(') { r.calls.push({ fn: t.v, i }); if (DATA_SOURCES.has(t.v)) r.sources.push(t.v); }
      }
    }
    const exprText = text.slice(m.exprStart, m.exprEnd);
    r.isParam = /\bmeta\s*\[[^\]]*IsParameterQuery\s*=\s*true/i.test(exprText);
    r.isFn = /^\s*\((?:[^()]|\([^()]*\))*\)\s*(?:as\s+[\w.]+(?:\s+[\w.]+)?\s*)?=>/.test(exprText);
    r.hasSource = r.sources.some(s => EXTERNAL_SOURCES.has(s));
    r.steps = parseSteps(toks, st, m.tokStart, m.tokEnd);
    const md = (meta || {})[m.name] || {};
    r.meta = md;
    r.load = {
      sheet: metaVal(md.FillEnabled) === true,
      model: metaVal(md.FillToDataModelEnabled) === true,
      rows: md.FillCount != null ? metaVal(md.FillCount) : null,
      errors: md.FillErrorCount != null ? metaVal(md.FillErrorCount) : null,
      errorCode: md.FillErrorCode != null ? metaVal(md.FillErrorCode) : null,
      status: md.FillStatus != null ? metaVal(md.FillStatus) : null,
      columns: md.FillColumnNames != null ? metaVal(md.FillColumnNames) : null,
      target: md.FillTarget != null ? metaVal(md.FillTarget) : null,
      updated: md.FillLastUpdated != null ? metaVal(md.FillLastUpdated) : null,
      resultType: md.ResultType != null ? metaVal(md.ResultType) : null
    };
    return r;
  });
  const byName = new Map(members.map(m => [m.name, m]));
  for (const m of members){ m.usedBy = members.filter(x => x.refs.has(m.name)).map(x => x.name); }
  return { text, toks, st, members, byName, hasHeader: sec.hasHeader };
}
function parseSteps(toks, st, a, b){
  const sig = []; for (let i = a; i < b; i++) if (isSig(toks[i])) sig.push(i);
  if (!sig.length || !isKw(toks[sig[0]], 'let')) return null;
  const steps = []; let k = 1, d = 0, letD = 0;
  let cur = null, inExpr = null;
  const startStep = k0 => {
    let j = k0; const nameToks = [];
    while (j < sig.length && toks[sig[j]].v !== '=') { nameToks.push(sig[j]); j++; }
    if (j >= sig.length) return null;
    const nt = nameToks.length === 1 ? toks[nameToks[0]] : null;
    return { name: nt ? nameOf(nt) : nameToks.map(x => toks[x].v).join(' '), nameRaw: nt ? nt.v : '', s: toks[sig[k0]].s, nameE: toks[nameToks[nameToks.length - 1]].e, exprK: j + 1, exprS: toks[sig[j + 1]] ? toks[sig[j + 1]].s : toks[sig[j]].e };
  };
  cur = startStep(k); if (!cur) return null; k = cur.exprK;
  for (; k < sig.length; k++){
    const t = toks[sig[k]];
    if (t.t === 'op'){ if ('([{'.includes(t.v)) d++; else if (')]}'.includes(t.v)) d--; }
    if (t.t === 'id' && t.v === 'let') letD++;
    if (d === 0 && t.t === 'id' && t.v === 'in'){
      if (letD > 0){ letD--; continue; }
      cur.exprE = toks[sig[k - 1]].e; cur.tokS = sig[cur.exprK]; cur.tokE = sig[k - 1] + 1; steps.push(cur);
      inExpr = { s: sig[k + 1] != null ? toks[sig[k + 1]].s : t.e, tokS: sig[k + 1], tokE: b };
      break;
    }
    if (d === 0 && letD === 0 && t.v === ','){
      cur.exprE = toks[sig[k - 1]].e; cur.tokS = sig[cur.exprK]; cur.tokE = sig[k - 1] + 1; steps.push(cur);
      cur = startStep(k + 1); if (!cur) return steps.length ? { steps, inExpr: null } : null; k = cur.exprK - 1;
    }
  }
  const names = new Set(steps.map(s => s.name));
  const refsIn = (ta, tb, self) => { const r = new Set(); for (let i = ta; i < tb; i++){ const t = toks[i]; if (isSig(t) && isName(t) && !st.fieldTok.has(i) && names.has(nameOf(t)) && nameOf(t) !== self) r.add(nameOf(t)); } return r; };
  for (const s of steps){
    s.refs = refsIn(s.tokS, s.tokE, s.name);
    s.fns = [];
    for (let i = s.tokS; i < s.tokE; i++){ const t = toks[i]; if (t.t === 'id' && !M_KEYWORDS.has(t.v)){ const kk = st.pos.get(i); const nx = toks[st.sig[kk + 1]]; if (nx && nx.v === '(') s.fns.push(t.v); } }
    s.fn = s.fns[0] || '';
  }
  const finalRefs = inExpr ? refsIn(inExpr.tokS, inExpr.tokE, null) : new Set();
  // достижимость от выражения in
  const alive = new Set(); const stack = [...finalRefs];
  const byN = new Map(steps.map(s => [s.name, s]));
  while (stack.length){ const n = stack.pop(); if (alive.has(n)) continue; alive.add(n); const s = byN.get(n); if (s) stack.push(...s.refs); }
  for (const s of steps) s.dead = !alive.has(s.name);
  const last = steps[steps.length - 1];
  return { steps, finalRefs, lastIsFinal: last ? finalRefs.has(last.name) && finalRefs.size === 1 : true };
}

/* ---- Подсветка синтаксиса (HTML) ---- */
function escHtml(s){ return s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }
function highlightM(src){
  const toks = lexM(src); let out = '';
  for (let i = 0; i < toks.length; i++){
    const t = toks[i]; const v = escHtml(t.v);
    if (t.t === 'cmt') out += '<span class="c">' + v + '</span>';
    else if (t.t === 'str') out += '<span class="s">' + v + '</span>';
    else if (t.t === 'qid') out += '<span class="q">' + v + '</span>';
    else if (t.t === 'num') out += '<span class="n">' + v + '</span>';
    else if (t.t === 'id'){
      if (M_KEYWORDS.has(t.v) || t.v[0] === '#') out += '<span class="k">' + v + '</span>';
      else { let j = i + 1; while (toks[j] && !isSig(toks[j])) j++; out += toks[j] && toks[j].v === '(' ? '<span class="f">' + v + '</span>' : v; }
    } else out += v;
  }
  return out;
}
