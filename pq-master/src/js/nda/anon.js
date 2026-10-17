/* =====================================================================
   Обезличивание: категории, словарь, контекстная классификация, сканер
   ===================================================================== */
const CATS = [
  { id:'PATH',  g:'Пути',        label:'Локальные пути (C:\\…)', def:true },
  { id:'UNC',   g:'Пути',        label:'Сетевые пути (\\\\server\\share)', def:true },
  { id:'SPO',   g:'Пути',        label:'SharePoint / OneDrive', def:true },
  { id:'URL',   g:'Сеть',        label:'URL', def:true },
  { id:'HOST',  g:'Сеть',        label:'Домены и имена хостов', def:true },
  { id:'IP',    g:'Сеть',        label:'IP-адреса', def:true },
  { id:'EMAIL', g:'Сеть',        label:'E-mail', def:true },
  { id:'SRV',   g:'Источники',   label:'Серверы (Sql.Database, Oracle, ODBC…)', def:true },
  { id:'DB',    g:'Источники',   label:'Базы данных', def:true },
  { id:'CONN',  g:'Источники',   label:'Строки подключения целиком', def:true },
  { id:'SECRET',g:'Источники',   label:'Секреты: пароли, логины, ключи, токены', def:true, locked:true },
  { id:'SQLV',  g:'SQL',         label:'Литералы внутри SQL', def:true },
  { id:'SQL',   g:'SQL',         label:'Текст SQL целиком', def:false },
  { id:'NUM',   g:'Литералы',    label:'Числа', def:true },
  { id:'DATE',  g:'Литералы',    label:'Даты (#date, #datetime)', def:true },
  { id:'TXT',   g:'Литералы',    label:'Текст в фильтрах и условиях', def:true },
  { id:'CMT',   g:'Литералы',    label:'Комментарии целиком', def:false },
  { id:'SHEET', g:'Структура',   label:'Имена листов', def:false },
  { id:'TABLE', g:'Структура',   label:'Имена таблиц и объектов БД', def:false },
  { id:'COL',   g:'Структура',   label:'Имена столбцов', def:false },
  { id:'QRY',   g:'Структура',   label:'Имена запросов', def:false }
];
const CAT_LABEL = Object.fromEntries(CATS.map(c => [c.id, c.label]));
Object.assign(CAT_LABEL, { NDA:'Чёрный список NDA', MAN:'Добавлено вручную', VAL:'Значения образцов', RES:'Ресурсы диагностики' });
const ALL_TOKEN_CATS = [...CATS.map(c => c.id), 'NDA', 'MAN', 'VAL', 'RES'];
const CRITICAL_CATS = new Set(['PATH','UNC','SPO','URL','HOST','IP','EMAIL','SRV','DB','CONN','SECRET','SQL','SQLV','NDA','MAN','VAL','RES']);
const TOKEN_RE = /⟦([A-Z]+)_(\d+)⟧/g;

function defaultConfig(){
  return { cats: Object.fromEntries(CATS.map(c => [c.id, c.def])), keepSmall: true, keepPositional: true, cmtDetect: true,
    blacklist: [], manual: [], excluded: new Set() };
}

class TokenDict {
  constructor(){ this.entries = []; this.byRaw = new Map(); this.byToken = new Map(); this.counters = {}; this.version = 0; }
  token(cat, raw){
    let e = this.byRaw.get(raw);
    if (e) return e.token;
    const n = (this.counters[cat] || 0) + 1; this.counters[cat] = n;
    e = { token: '⟦' + cat + '_' + n + '⟧', cat, value: raw };
    this.entries.push(e); this.byRaw.set(raw, e); this.byToken.set(e.token, e); this.version++;
    return e.token;
  }
  /** Метки, уже встречающиеся в исходном тексте и неизвестные словарю, не выдавать заново —
      иначе обратная подстановка превратит этот чужой текст в значение */
  reserve(text){
    for (const m of String(text).matchAll(TOKEN_RE)) if (!this.byToken.has(m[0])) this.counters[m[1]] = Math.max(this.counters[m[1]] || 0, +m[2]);
  }
  get size(){ return this.entries.length; }
  toJSON(extra){
    return Object.assign({ format: 'pq-master-dictionary', version: 1, created: new Date().toISOString(),
      warning: 'СЕКРЕТНО. Этот словарь превращает обезличенный код обратно в исходный. НИКОМУ не отправляйте его (включая ИИ). Храните рядом с оригиналом книги.',
      counters: this.counters, entries: this.entries.map(e => ({ token: e.token, cat: e.cat, value: e.value })) }, extra || {});
  }
  static fromJSON(o){
    if (!o || o.format !== 'pq-master-dictionary' || !Array.isArray(o.entries)) throw new Error('Это не словарь Мастера PQ.');
    const d = new TokenDict();
    for (const e of o.entries){
      const m = /^⟦([A-Z]+)_(\d+)⟧$/.exec(e.token); if (!m) continue;
      const ent = { token: e.token, cat: e.cat || m[1], value: String(e.value) };
      d.entries.push(ent); d.byRaw.set(ent.value, ent); d.byToken.set(ent.token, ent);
      d.counters[m[1]] = Math.max(d.counters[m[1]] || 0, +m[2]);
    }
    for (const [k, v] of Object.entries(o.counters || {})) d.counters[k] = Math.max(d.counters[k] || 0, v | 0);
    d.version = 1; return d;
  }
}

/* ---- Детекторы ---- */
const RE_SPO = /\bhttps?:\/\/[^\s"'<>]*(?:sharepoint\.com|sharepoint\.[a-z]{2,}|onedrive\.live\.com|1drv\.ms|-my\.sharepoint)[^\s"'<>]*/gi;
const RE_URL = /\b(?:https?|ftp|ftps|file|sftp):\/\/[^\s"'<>]+/gi;
const RE_UNC = /\\\\[A-Za-z0-9._$\-]+(?:\\[^\\\r\n"<>|*?,;]+)*\\?/g;
const RE_LPATH = /(?<![A-Za-z0-9])[A-Za-z]:\\(?:[^\\\r\n"<>|*?,;]+\\)*[^\\\r\n"<>|*?,;]*/g;
const RE_EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const RE_IP = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?::\d{1,5})?(?![\d.])/g;
const RE_HOST = /(?<![\w.@\-\/\\])(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+(?:local|corp|lan|internal|intra|intranet|ru|com|net|org|io|biz|info|kz|by|ua|de|uk|eu|su|рф|cloud|dev|app)(?![\w\-])/gi;
const RE_SECRET_KV = /(?<![A-Za-z0-9_])(password|pwd|passwd|user ?id|uid|user ?name|username|login|api[_\- ]?key|apikey|x-api-key|access[_\-]?token|refresh[_\-]?token|id[_\-]?token|token|client[_\-]?secret|secret|account ?key|sig|signature|auth|subscription[_\-]?key|code)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^;&\s"'#,)]+)/gi;
const RE_BEARER = /\b(?:Bearer|Basic|Token)\s+([A-Za-z0-9\-._~+\/]{6,}=*)/g;
const SECRET_KEY_RE = /^(password|pwd|passwd|user ?id|uid|user|user ?name|login|api[_\- ]?key|x-api-key|access[_\-]?token|refresh[_\-]?token|token|client[_\-]?secret|secret|account ?key|shared ?access ?signature|sig|authorization|auth|subscription[_\-]?key)$/i;
const SECRET_FIELD_RE = /(password|passwd|pwd|secret|token|api[_\-]?key|apikey|authorization|subscription-key|access[_\-]?key|credential|^user ?name$|^username$|^login$|^uid$|^user ?id$)/i;
const CONN_DETECT = /(?:^|;)\s*(server|data source|initial catalog|database|provider|dsn|driver|uid|pwd|password|user id|host|port|integrated security|trusted_connection|address|addr|extended properties)\s*=/i;
const SRV_KEYS = /^(server|data source|host|hostname|address|addr|network address|dsn|server name)$/i;
const DB_KEYS = /^(database|initial catalog|dbname|catalog)$/i;

const POS_FNS = new Set(['Table.FirstN','Table.LastN','Table.Skip','Table.Range','Table.RemoveFirstN','Table.RemoveLastN','Table.RemoveRows','Table.Repeat','Table.AlternateRows','Table.InsertRows','Table.ReplaceRows','Table.AddIndexColumn','Table.PromoteHeaders','Table.SplitAt','Table.Split',
  'List.FirstN','List.LastN','List.Skip','List.Range','List.RemoveFirstN','List.RemoveLastN','List.RemoveRange','List.InsertRange','List.ReplaceRange','List.Alternate','List.Split','List.Numbers','List.Repeat',
  'Text.Start','Text.End','Text.Middle','Text.Range','Text.PadStart','Text.PadEnd','Text.At','Text.RemoveRange','Text.Insert','Text.ReplaceRange','Text.Repeat',
  'Number.Round','Number.RoundUp','Number.RoundDown','Number.RoundTowardZero','Number.RoundAwayFromZero','Splitter.SplitTextByPositions','Splitter.SplitTextByLengths','Splitter.SplitTextByRanges','Csv.Document','Excel.Workbook','Character.FromNumber','Binary.Range','Lines.FromBinary','Table.TransformColumnTypes','Record.FieldOrDefault']);
const SKIP_NUM_FIELDS = /^(Encoding|Columns|CommandTimeout|ConnectionTimeout|Timeout|Version|MaxDegreeOfParallelism|QuoteStyle|CsvStyle|ExtraValues|Implementation|Delimiter|HierarchicalNavigation|MultiSubnetFailover|CreateNavigationProperties|ManualStatusHandling|IsRetry)$/i;
const COL_FN_ARGS = {
  'Table.SelectColumns':[1], 'Table.RemoveColumns':[1], 'Table.ReorderColumns':[1], 'Table.RenameColumns':[1], 'Table.TransformColumnTypes':[1],
  'Table.TransformColumns':[1], 'Table.AddColumn':[1], 'Table.DuplicateColumn':[1,2], 'Table.Group':[1,2], 'Table.ExpandTableColumn':[1,2,3],
  'Table.ExpandRecordColumn':[1,2,3], 'Table.ExpandListColumn':[1], 'Table.NestedJoin':[1,3,4], 'Table.Join':[1,3], 'Table.Sort':[1], 'Table.Distinct':[1],
  'Table.UnpivotOtherColumns':[1,2,3], 'Table.Unpivot':[1,2,3], 'Table.Pivot':[2,3], 'Table.FillDown':[1], 'Table.FillUp':[1], 'Table.ReplaceValue':[4],
  'Table.ReplaceErrorValues':[1], 'Table.SplitColumn':[1,3], 'Table.CombineColumns':[1,3], 'Table.Column':[1], 'Table.HasColumns':[1], 'Table.AddIndexColumn':[1],
  'Table.RemoveRowsWithErrors':[1], 'Table.SelectRowsWithErrors':[1], 'Table.AddKey':[1], 'Table.Max':[1], 'Table.Min':[1], 'Table.MaxN':[2], 'Table.MinN':[2],
  'Record.Field':[1], 'Record.FieldOrDefault':[1], 'Table.AggregateTableColumn':[1,2], 'Table.AddJoinColumn':[1,3,4], 'Table.FuzzyNestedJoin':[1,3,4],
  'Table.PositionOfAny':[], 'Table.TransformColumnNames':[], '#table':[0], 'Table.FromRows':[1], 'Table.FromColumns':[1], 'Table.FromList':[2],
  'Table.ToColumns':[], 'Table.ColumnsOfType':[], 'Table.SelectRows':[], 'Table.Contains':[2], 'Table.Keys':[], 'Table.MatchesAnyRows':[]
};
const TXT_FN_ARGS = { 'Text.Contains':[1], 'Text.StartsWith':[1], 'Text.EndsWith':[1], 'Text.PositionOf':[1], 'Text.Replace':[1,2], 'List.Contains':[0,1], 'List.ContainsAny':[0,1], 'List.ContainsAll':[0,1], 'Table.ReplaceValue':[1,2], 'Text.Remove':[1], 'Text.Select':[1], 'Text.Split':[1], 'Comparer.Equals':[1,2] };
const SYSTEM_FIELDS = new Set(['Data','Content','Name','Item','Kind','Hidden','Extension','Folder Path','Date accessed','Date modified','Date created','Attributes','Value','Attribute','Schema','Signature','Id','Key']);

function wholeCategory(raw){
  const r = raw.trim(); if (!r) return null;
  const full = (re) => { re.lastIndex = 0; const m = re.exec(r); return m && m.index === 0 && m[0].length === r.length; };
  if (full(RE_SPO)) return 'SPO';
  if (full(RE_URL)) return 'URL';
  if (full(RE_UNC)) return 'UNC';
  if (full(RE_LPATH)) return 'PATH';
  if (full(RE_EMAIL)) return 'EMAIL';
  if (full(RE_IP)) return 'IP';
  if (full(RE_HOST)) return 'HOST';
  return null;
}

/** Общий накопитель спанов (замен) с проверкой включённых категорий */
function makeCollector(text, cfg){
  const spans = [];
  const want = c => c === 'SECRET' || !!cfg.cats[c];
  const add = (s, e, cat, raw) => {
    if (e <= s) return;
    const r = raw != null ? raw : text.slice(s, e);
    if (!r.trim()) return;
    if (cat !== 'SECRET' && cfg.excluded && cfg.excluded.has(r)) return;
    // пробелы по краям не заменяем — так меньше «съезжает» форматирование
    const ls = r.length - r.trimStart().length, rs = r.length - r.trimEnd().length;
    if (raw == null && (ls || rs)) { s += ls; e -= rs; }
    spans.push({ s, e, cat, raw: raw != null ? raw.trim() : text.slice(s, e) });
  };
  /** детекторы внутри произвольного фрагмента [base, base+seg.length) */
  const embedded = (seg, base, opts) => {
    opts = opts || {};
    const run = (re, cat, grp) => {
      re.lastIndex = 0; let m;
      while ((m = re.exec(seg))){
        if (grp){ const vi = m[0].lastIndexOf(m[grp]); let v = m[grp]; let off = vi;
          if (/^["'{]/.test(v) && v.length >= 2){ v = v.slice(1, -1); off += 1; }
          if (v && !/^⟦/.test(v)) add(base + m.index + off, base + m.index + off + v.length, cat); }
        else add(base + m.index, base + m.index + m[0].length, cat);
        if (m[0].length === 0) re.lastIndex++;
      }
    };
    run(RE_SECRET_KV, 'SECRET', 2);
    run(RE_BEARER, 'SECRET', 1);
    if (opts.secretsOnly) return;
    if (want('SPO')) run(RE_SPO, 'SPO');
    if (want('URL')) run(RE_URL, 'URL');
    if (want('UNC')) run(RE_UNC, 'UNC');
    if (want('PATH')) run(RE_LPATH, 'PATH');
    if (want('EMAIL')) run(RE_EMAIL, 'EMAIL');
    if (want('IP')) run(RE_IP, 'IP');
    if (want('HOST')) run(RE_HOST, 'HOST');
  };
  const conn = (raw, base) => {
    if (want('CONN')) { add(base, base + raw.length, 'CONN'); return; }
    const re = /([^=;]+)=(\{[^}]*\}|'[^']*'|[^;]*)/g; let m;
    while ((m = re.exec(raw))){
      const key = m[1].trim(); let v = m[2]; let vs = m.index + m[1].length + 1;
      if (/^[{']/.test(v) && v.length >= 2){ v = v.slice(1, -1); vs += 1; }
      if (!v.trim()) continue;
      if (SECRET_KEY_RE.test(key)) add(base + vs, base + vs + v.length, 'SECRET');
      else if (SRV_KEYS.test(key) && want('SRV')) add(base + vs, base + vs + v.length, 'SRV');
      else if (DB_KEYS.test(key) && want('DB')) add(base + vs, base + vs + v.length, 'DB');
      else embedded(v, base + vs);
    }
  };
  const sql = (raw, base) => {
    if (want('SQL')) { add(base, base + raw.length, 'SQL'); return; }
    if (want('SQLV')){ const re = /N?'((?:[^']|'')*)'/g; let m; while ((m = re.exec(raw))){ const off = m[0].indexOf("'") + 1; if (m[1]) add(base + m.index + off, base + m.index + off + m[1].length, 'SQLV'); } }
    if (want('NUM')){ const re = /(?<![\w.@#$\[⟦'])(\d+(?:\.\d+)?)(?![\w.'])/g; let m; while ((m = re.exec(raw))){ const v = Number(m[1]); if (cfg.keepSmall && (v === 0 || v === 1)) continue; add(base + m.index, base + m.index + m[1].length, 'NUM'); } }
    embedded(raw, base);
  };
  return { spans, want, add, embedded, conn, sql };
}

/** Разрешение пересечений: побеждает более раннее, при равенстве — более длинное */
function resolveSpans(spans){
  spans.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const out = []; let end = -1;
  for (const sp of spans){ if (sp.s >= end){ out.push(sp); end = sp.e; } }
  return out;
}
function termSpans(text, terms, cat, ci, taken, collector){
  const partial = [];
  for (const term of terms){
    if (!term) continue;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'giu' : 'gu'); let m;
    while ((m = re.exec(text))){
      const s = m.index, e = s + m[0].length;
      let inside = false, cross = false;
      for (const t of taken){ if (t.e <= s || t.s >= e) continue; if (t.s <= s && t.e >= e) inside = true; else cross = true; }
      if (!inside && !cross) collector.add(s, e, cat, m[0]);
      else if (cross) partial.push({ s, e, term });
    }
  }
  return partial;
}

/* ---- Обезличивание M-кода ---- */
function anonymizeM(text, cfg, dict){
  const toks = lexM(text); const st = structure(toks);
  const sec = parseSection(text); const names = new Set(sec.members.map(m => m.name));
  const C = makeCollector(text, cfg); const { want, add, embedded } = C;
  const colNames = new Set(); const pending = []; const inDate = new Set(); const paramRole = new Map(); const paramStr = [];
  const stack = []; const bindEq = new Set();
  const sig = st.sig;
  const nearestCall = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].k === '(') return { f: stack[i], idx: i }; return null; };

  for (let k = 0; k < sig.length; k++){
    const ti = sig[k], t = toks[ti], top = stack[stack.length - 1];
    const prev = k > 0 ? toks[sig[k - 1]] : null, prev2 = k > 1 ? toks[sig[k - 2]] : null;
    if (t.t === 'op'){
      const v = t.v;
      if (v === '('){ stack.push({ k: '(', fn: prev && prev.t === 'id' && !M_KEYWORDS.has(prev.v) ? prev.v : null, arg: 0, lam: false, o: ti }); continue; }
      if (v === '{'){ const ia = prev && (isName(prev) || prev.t === 'str' || [')', ']', '}'].includes(prev.v)); stack.push({ k: '{', o: ti, lam: false, itemAccess: !!ia }); continue; }
      if (v === '['){
        const kind = st.brKind.get(ti);
        stack.push({ k: '[', kind, o: ti, field: null, expect: kind !== 'access', nameToks: [] });
        if (kind === 'access' && st.match.has(ti)){
          const c = st.match.get(ti); const inner = [];
          for (let j = k + 1; j < sig.length && sig[j] < c; j++) inner.push(sig[j]);
          if (inner.length && inner.every(x => st.fieldTok.has(x))){
            let s, e;
            if (inner.length === 1 && toks[inner[0]].t === 'qid'){ s = toks[inner[0]].s + 2; e = toks[inner[0]].e - 1; }
            else { s = toks[inner[0]].s; e = toks[inner[inner.length - 1]].e; }
            const raw = text.slice(s, e);
            if (!SYSTEM_FIELDS.has(raw)){ colNames.add(raw); if (want('COL')) add(s, e, 'COL', raw); }
          }
        }
        continue;
      }
      if (v === ')' || v === ']' || v === '}'){ stack.pop(); continue; }
      if (v === ','){
        if (top){ top.lam = false; if (top.k === '(') top.arg++; if (top.k === '[' && top.kind !== 'access'){ top.field = null; top.expect = true; top.nameToks = []; } }
        continue;
      }
      if (v === '='){
        if (top && top.k === '[' && top.kind !== 'access' && top.expect){
          top.field = top.nameToks.map(x => nameOf(toks[x])).join(' '); top.expect = false; bindEq.add(ti);
          if (top.kind === 'typerec' && top.nameToks.length){
            const a = toks[top.nameToks[0]], b = toks[top.nameToks[top.nameToks.length - 1]];
            const s = top.nameToks.length === 1 && a.t === 'qid' ? a.s + 2 : a.s, e = top.nameToks.length === 1 && a.t === 'qid' ? a.e - 1 : b.e;
            const raw = text.slice(s, e); colNames.add(raw); if (want('COL')) add(s, e, 'COL', raw);
          }
        } else if (prev && isName(prev) && (!prev2 || prev2.v === ',' || prev2.v === ';' || isKw(prev2, 'let') || isKw(prev2, 'shared'))) bindEq.add(ti);
        continue;
      }
      if (v === '=>'){ if (top) top.lam = true; continue; }
      continue;
    }
    if (t.t === 'id' && t.v === 'each'){ if (top) top.lam = true; continue; }
    if (top && top.k === '[' && top.kind !== 'access' && top.expect && (t.t === 'id' || t.t === 'qid')){ top.nameToks.push(ti); continue; }

    if (t.t === 'id' && /^#(date|datetime|datetimezone|duration|time)$/.test(t.v)){
      const nx = sig[k + 1];
      if (nx != null && toks[nx].v === '(' && st.match.has(nx)){
        const c = st.match.get(nx); const inner = [];
        for (let j = k + 2; j < sig.length && sig[j] < c; j++) inner.push(sig[j]);
        if (inner.length && inner.every(x => toks[x].t === 'num' || toks[x].v === ',' || toks[x].v === '-' || toks[x].v === '+')){
          inner.forEach(x => inDate.add(x));
          if (want('DATE') && /^#date/.test(t.v)) add(toks[inner[0]].s, toks[inner[inner.length - 1]].e, 'DATE');
        }
      }
      continue;
    }
    if (t.t === 'num'){
      if (inDate.has(ti)) continue;
      const num = Number(t.v);
      if (cfg.keepSmall && (num === 0 || num === 1)) continue;
      if (cfg.keepPositional && top){
        if (top.k === '(' && top.fn && POS_FNS.has(top.fn) && top.arg >= 1) continue;
        if (top.k === '{' && top.itemAccess) continue;
        if (top.k === '[' && top.field && SKIP_NUM_FIELDS.test(top.field)) continue;
      }
      if (top && top.k === '[' && top.field && SKIP_NUM_FIELDS.test(top.field)) continue;
      if (want('NUM')) add(t.s, t.e, 'NUM');
      continue;
    }
    if (isName(t) && !st.fieldTok.has(ti)){
      if (names.has(nameOf(t))){
        if (want('QRY')){ if (t.t === 'qid') add(t.s + 2, t.e - 1, 'QRY'); else add(t.s, t.e, 'QRY'); }
        // запрос-параметр как аргумент функции-источника: запоминаем роль (сервер, база, путь…)
        if (top && top.k === '(' && top.fn && SOURCE_FNS[top.fn]){ const role = SOURCE_FNS[top.fn][top.arg]; const nx = toks[sig[k + 1]]; if (role && nx && (nx.v === ',' || nx.v === ')')) paramRole.set(nameOf(t), role); }
      }
      continue;
    }
    if (t.t !== 'str') continue;

    // ---------- строковый литерал: классификация по контексту ----------
    const raw = t.v.slice(1, -1), base = t.s + 1;
    if (!raw.trim()) continue;
    // значение запроса-параметра: "…" meta [IsParameterQuery=true…] — классифицируем после обхода по месту использования
    { const nx = toks[sig[k + 1]]; if (!top && prev && prev.v === '=' && nx && isKw(nx, 'meta')){ const pm = sec.members.find(m => t.s >= m.exprStart && t.e <= m.exprEnd); if (pm){ paramStr.push({ raw, base, name: pm.name }); continue; } } }
    const nc = nearestCall(); const fnF = nc ? nc.f : null;
    const direct = top && top.k === '(';
    const recTop = top && top.k === '[' && top.kind === 'record' ? top : null;
    const field = recTop && !recTop.expect ? recTop.field : null;
    const parentOfRec = recTop ? stack[stack.length - 2] : null;
    const next = toks[sig[k + 1]];

    if (direct && fnF.fn in SQL_TEXT_ARGS && fnF.arg === SQL_TEXT_ARGS[fnF.fn]){ C.sql(raw, base); continue; }
    if (field && /^(Query|CommandText|Statement)$/i.test(field) && parentOfRec && parentOfRec.k === '(' && (SOURCE_FNS[parentOfRec.fn] || parentOfRec.fn === 'Value.NativeQuery')){ C.sql(raw, base); continue; }
    if (field && SECRET_FIELD_RE.test(field)){ add(base, base + raw.length, 'SECRET'); continue; }
    let role = null;
    if (direct && fnF.fn && SOURCE_FNS[fnF.fn]) role = SOURCE_FNS[fnF.fn][fnF.arg] || null;
    if (role === 'CONN' || CONN_DETECT.test(raw) && /=/.test(raw) && (/;/.test(raw) || /^\s*(dsn|driver|provider)\s*=/i.test(raw))){ C.conn(raw, base); continue; }
    if (role === 'SRV' || role === 'DB'){ if (want(role)) add(base, base + raw.length, role); else embedded(raw, base); continue; }
    const wc = wholeCategory(raw);
    if (wc){ if (want(wc)) add(base, base + raw.length, wc); else embedded(raw, base, {}); continue; }
    if (role === 'PATH' || role === 'URL' || role === 'EMAIL' || role === 'HOST'){
      const cat = role === 'URL' ? 'URL' : role; if (want(cat)) add(base, base + raw.length, cat); else embedded(raw, base); continue; }
    if (field && /^(Item|Name|Entity)$/.test(field) && parentOfRec && parentOfRec.k === '{'){
      const kind = recFieldString(toks, st.recFields, recTop.o, 'Kind');
      const cat = kind === 'Sheet' ? 'SHEET' : 'TABLE';
      if (want(cat)) add(base, base + raw.length, cat); else embedded(raw, base); continue;
    }
    if (fnF && COL_FN_ARGS[fnF.fn] && COL_FN_ARGS[fnF.fn].includes(fnF.arg) && !recTop){
      let ok = !fnF.lam;
      for (let i = nc.idx + 1; i < stack.length; i++){ if (stack[i].k !== '{' || stack[i].lam) { ok = false; break; } }
      if (ok){ colNames.add(raw); if (want('COL')) add(base, base + raw.length, 'COL'); else embedded(raw, base); continue; }
    }
    const cmpOps = ['=', '<>', '<', '>', '<=', '>='];
    const isCmp = (prev && prev.t === 'op' && cmpOps.includes(prev.v) && !bindEq.has(sig[k - 1])) || (next && next.t === 'op' && cmpOps.includes(next.v));
    const inTxtFn = fnF && TXT_FN_ARGS[fnF.fn] && TXT_FN_ARGS[fnF.fn].includes(fnF.arg) && !recTop;
    const afterIf = prev && prev.t === 'id' && (prev.v === 'then' || prev.v === 'else');
    if (isCmp || inTxtFn || afterIf){ if (want('TXT')) add(base, base + raw.length, 'TXT'); else embedded(raw, base); continue; }
    if (/^\s*[-+]?\d[\d\s\u00A0.,]*\s*$/.test(raw) && /\d{2,}/.test(raw)){ if (want('NUM')) add(base, base + raw.length, 'NUM'); continue; }
    pending.push({ raw, base });
    embedded(raw, base);
  }
  for (const p of pending) if (colNames.has(p.raw) && want('COL')) add(p.base, p.base + p.raw.length, 'COL');
  for (const p of paramStr){
    const role = paramRole.get(p.name); const wc = wholeCategory(p.raw);
    const cat = role === 'SRV' || role === 'DB' ? role : (wc || role || 'TXT');
    if (role === 'CONN' || CONN_DETECT.test(p.raw) && /;/.test(p.raw)){ C.conn(p.raw, p.base); continue; }
    if (want(cat)) add(p.base, p.base + p.raw.length, cat); else embedded(p.raw, p.base);
  }

  // комментарии
  for (const t of toks){
    if (t.t !== 'cmt') continue;
    const s = t.s + 2, e = t.v.startsWith('/*') && t.v.endsWith('*/') && t.v.length >= 4 ? t.e - 2 : t.e;
    if (want('CMT')) add(s, e, 'CMT'); else if (cfg.cmtDetect) embedded(text.slice(s, e), s);
  }
  return finishSpans(text, C, cfg, dict, colNames);
}
function finishSpans(text, C, cfg, dict, colNames){
  dict.reserve(text);
  let acc = resolveSpans(C.spans);
  const extra = makeCollector(text, cfg);
  const partial = termSpans(text, cfg.blacklist || [], 'NDA', true, acc, extra)
    .concat(termSpans(text, cfg.manual || [], 'MAN', false, acc, extra));
  acc = resolveSpans(acc.concat(resolveSpans(extra.spans)));
  let out = '', last = 0, delta = 0;
  for (const sp of acc){
    sp.token = dict.token(sp.cat, sp.raw);
    out += text.slice(last, sp.s);
    sp.os = sp.s + delta; out += sp.token; sp.oe = sp.os + sp.token.length;
    delta += sp.token.length - (sp.e - sp.s); last = sp.e;
  }
  out += text.slice(last);
  const counts = {};
  for (const sp of acc){ const c = counts[sp.cat] || (counts[sp.cat] = { n: 0, u: new Set() }); c.n++; c.u.add(sp.raw); }
  return { out, spans: acc, counts, partial, colNames: colNames || new Set() };
}
/** Позиция в обезличенном тексте для позиции в оригинале */
function mapPos(spans, p){
  let d = 0;
  for (const sp of spans){ if (sp.e <= p) d += sp.token.length - (sp.e - sp.s); else if (sp.s < p) return sp.oe; else break; }
  return p + d;
}

/* ---- Обратная подстановка ---- */
function restoreTokens(text, dict){
  const unknown = [], used = new Set();
  const out = text.replace(TOKEN_RE, (m, cat, n, off) => {
    const e = dict.byToken.get(m);
    if (!e){ unknown.push({ token: m, pos: off }); return m; }
    used.add(m); return e.value;
  });
  const nearMiss = [];
  const re = /(\[\[|\[|⟦|\{\{)\s*([A-Za-z]{2,6})\s*_\s*(\d+)\s*(\]\]|\]|⟧|\}\})/g; let m;
  while ((m = re.exec(text))){
    if (m[1] === '⟦' && m[4] === '⟧' && /^[A-Z]+$/.test(m[2]) && m[0] === '⟦' + m[2] + '_' + m[3] + '⟧') continue;
    if (ALL_TOKEN_CATS.includes(m[2].toUpperCase())) nearMiss.push({ text: m[0], pos: m.index });
  }
  const stray = (text.replace(TOKEN_RE, '').match(/[⟦⟧]/g) || []).length;
  return { out, unknown, used, nearMiss, stray };
}

/* ---- Обезличивание произвольного текста (диагностика, трассировки, сообщения) ---- */
let _dictRe = { v: -1, re: null, map: null };
function dictRegex(dict){
  if (_dictRe.v === dict.version && _dictRe.dict === dict) return _dictRe;
  const map = new Map();
  for (const e of dict.entries){
    if (e.cat === 'NUM' || e.cat === 'DATE' || e.value.length < 3) continue;
    map.set(e.value, e.token);
    const un = e.value.replace(/""/g, '"'); if (un !== e.value && !map.has(un)) map.set(un, e.token);
  }
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = keys.length ? new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  _dictRe = { v: dict.version, dict, re, map };
  return _dictRe;
}
function anonymizeFree(str, cfg, dict, mode){
  if (str == null) return str;
  str = String(str); if (!str.trim()) return str;
  const C = makeCollector(str, cfg);
  const { re, map } = dictRegex(dict);
  if (re){ re.lastIndex = 0; let m; while ((m = re.exec(str))) C.add(m.index, m.index + m[0].length, dict.byToken.get(map.get(m[0])).cat, m[0]); }
  if (mode === 'sql') C.sql(str, 0);
  else {
    if (CONN_DETECT.test(str) && /;/.test(str)) C.conn(str, 0);
    C.embedded(str, 0);
  }
  const r = finishSpansFree(str, C, cfg, dict, map);
  if (mode === 'strict'){
    // всё, что осталось вне меток и похоже на имя/идентификатор ресурса, — в метку RES
    return r.replace(/(^|⟧)([^⟦]*)/g, (m0, lead, chunk) => lead + chunk.replace(/[^\s;,|=()\[\]{}"'<>⟦⟧]{3,}/g, w => /^[\d.:\-+%]+$/.test(w) ? w : dict.token('RES', w)));
  }
  return r;
}
function finishSpansFree(text, C, cfg, dict, knownMap){
  dict.reserve(text);
  let acc = resolveSpans(C.spans);
  const extra = makeCollector(text, cfg);
  termSpans(text, cfg.blacklist || [], 'NDA', true, acc, extra);
  termSpans(text, cfg.manual || [], 'MAN', false, acc, extra);
  acc = resolveSpans(acc.concat(resolveSpans(extra.spans)));
  let out = '', last = 0;
  for (const sp of acc){ out += text.slice(last, sp.s) + (knownMap.get(sp.raw) || dict.token(sp.cat, sp.raw)); last = sp.e; }
  return out + text.slice(last);
}

/* ---- Сканер утечек в обезличенном тексте ---- */
const SCAN_RULES = [
  { id:'path', sev:'crit', label:'Похоже на локальный путь', re:/(?<![A-Za-z0-9])[A-Za-z]:\\[^\s"';,)⟦]+/g },
  { id:'unc', sev:'crit', label:'Похоже на сетевой путь', re:/\\\\[A-Za-z0-9._$\-]+\\[^\s"']*/g },
  { id:'url', sev:'crit', label:'URL', re:/\b(?:https?|ftp|file):\/\/[^\s"'<>)⟦]+/gi },
  { id:'email', sev:'crit', label:'E-mail', re:/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g },
  { id:'ip', sev:'crit', label:'IP-адрес', re:/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g },
  { id:'secret', sev:'crit', label:'Похоже на секрет (ключ=значение)', re:/\b(password|pwd|passwd|secret|token|apikey|api_key|client_secret|authorization|access_token)\b[ \t]*[:=][ \t]*["']?(?!⟦|["'\s,;)\]])[^\s"';,\])]{3,}/gi },
  { id:'bearer', sev:'crit', label:'Bearer/Basic-токен', re:/\b(?:Bearer|Basic)[ \t]+(?!⟦)[A-Za-z0-9\-._~+\/]{8,}=*/g },
  { id:'guid', sev:'warn', label:'GUID (ID арендатора, ключ, ID ресурса?)', re:/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { id:'host', sev:'warn', label:'Похоже на имя хоста/домен', re:RE_HOST },
  { id:'b64', sev:'warn', label:'Длинная строка, похожая на ключ', re:/(?<![\w⟦])[A-Za-z0-9+\/_\-]{32,}={0,2}(?![\w⟧])/g },
  { id:'longnum', sev:'warn', label:'Длинное число (счёт, ИНН, телефон?)', re:/(?<![\w⟦_.])\d{6,}(?![\w.])/g }
];
function scanLeaks(text, cfg, dict){
  const found = [];
  const lineOf = (p) => { let n = 1; for (let i = 0; i < p && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
  for (const r of SCAN_RULES){
    r.re.lastIndex = 0; let m;
    while ((m = r.re.exec(text))){
      if (/⟦|⟧/.test(m[0])) continue;
      found.push({ rule: r.id, sev: r.sev, label: r.label, s: m.index, e: m.index + m[0].length, match: m[0] });
      if (found.length > 2000) break;
    }
  }
  for (const term of cfg.blacklist || []){
    if (!term) continue; const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'); let m;
    while ((m = re.exec(text))) found.push({ rule: 'nda', sev: 'crit', label: 'Слово из чёрного списка NDA', s: m.index, e: m.index + m[0].length, match: m[0] });
  }
  if (dict){
    for (const e of dict.entries){
      if (e.value.length < 4) continue;
      for (const v of new Set([e.value, e.value.replace(/""/g, '"')])){
        let p = text.indexOf(v);
        while (p >= 0){
          found.push({ rule: 'known', sev: CRITICAL_CATS.has(e.cat) ? 'crit' : 'warn', label: 'Известное значение из словаря (' + (CAT_LABEL[e.cat] || e.cat) + ') осталось открытым', s: p, e: p + v.length, match: v });
          p = text.indexOf(v, p + v.length);
        }
      }
    }
  }
  found.sort((a, b) => a.s - b.s);
  const seen = new Set(); const uniq = [];
  for (const f of found){ const k = f.s + ':' + f.e + ':' + f.rule; if (seen.has(k)) continue; seen.add(k); f.line = lineOf(f.s); uniq.push(f); }
  return uniq;
}
