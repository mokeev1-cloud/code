/* =====================================================================
   nda/agent.js — пакет для ИИ, шаблон задачи, протокол папки обмена (Claude Code).
   Зависит от: S (app/state.js), anon.js, diag.js, $ (ui-base.js — только внутри функций).
   ===================================================================== */
function sanitizeName(s){ return anonymizeFree(s, S.cfg, S.dict, 'names'); }
function anonQueryName(name){
  if (S.cfg.cats.QRY){ const e = S.dict.byRaw.get(name) || S.dict.byRaw.get(name.replace(/"/g, '""')); if (e) return e.token; }
  return sanitizeName(name);
}
function anonColName(c){
  if (S.cfg.cats.COL) return S.dict.token('COL', String(c).replace(/"/g, '""'));
  return sanitizeName(String(c));
}
function columnTypesFromCode(text){
  const map = {}; const re = /\{\s*"((?:[^"]|"")*)"\s*,\s*(type\s+(?:nullable\s+)?[\w.]+|[\w]+\.Type)\s*\}/g; let m;
  while ((m = re.exec(text))) map[m[1].replace(/""/g, '"')] = m[2].replace(/\s+/g, ' ');
  return map;
}
function syntheticValue(type, i, col){
  const t = (type || '').toLowerCase();
  if (/int64|number|decimal|currency|double|single|int32|int16|byte|percentage/.test(t)) return /int/.test(t) ? (i + 1) * 10 + 7 : Math.round(((i + 1) * 123.45) * 100) / 100;
  if (/datetimezone/.test(t)) return '2024-01-0' + (i + 1) + 'T09:30:00+03:00';
  if (/datetime/.test(t)) return '2024-01-0' + (i + 1) + 'T09:30:00';
  if (/date/.test(t)) return '2024-01-0' + (i + 1);
  if (/time/.test(t)) return '0' + (i + 8) + ':00:00';
  if (/logical/.test(t)) return i % 2 === 0;
  if (/text/.test(t)) return 'Текст_' + (i + 1);
  return 'знач_' + (i + 1);
}
function maskValue(v, type){
  if (v == null || v === '') return v;
  const s = String(v);
  if (type === 'number'){
    const h = sha256(S.numSalt + s);
    let k = 0; return s.replace(/\d/g, (d, idx) => idx === 0 && d !== '0' ? String(1 + parseInt(h[k++ % 64], 16) % 9) : String(parseInt(h[k++ % 64], 16) % 10));
  }
  if (type === 'date'){ const t = parseTime(s); if (isFinite(t)) return new Date(t + S.dateShift * 86400000).toISOString().slice(0, s.length > 10 ? 19 : 10); }
  if (type === 'bool') return s;
  return S.dict.token('VAL', s);
}
function inferType(vals){
  const ne = vals.filter(v => v != null && v !== '');
  if (!ne.length) return 'empty';
  if (ne.every(v => /^-?\d+([.,]\d+)?$/.test(String(v).trim()))) return 'number';
  if (ne.every(v => /^(true|false|истина|ложь|да|нет)$/i.test(String(v)))) return 'bool';
  if (ne.every(v => isFinite(parseTime(v)) && /\d{4}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(String(v)))) return 'date';
  return 'text';
}
function debugData(mode){
  if (mode === 'none' || !S.A) return null;
  const res = { note: 'Схема взята из метаданных книги (FillColumnNames) и шагов типов в коде. Строки «synthetic» сгенерированы по типам и НЕ являются реальными данными.', queries: [] };
  for (const m of S.A.members){
    const cols = Array.isArray(m.load.columns) ? m.load.columns : null;
    const types = columnTypesFromCode(S.work.slice(m.exprStart, m.exprEnd));
    const names = cols || Object.keys(types);
    if (!names.length) continue;
    res.queries.push({
      query: anonQueryName(m.name), rows: m.load.rows, errors: m.load.errors,
      columns: names.map(c => ({ name: anonColName(c), type: types[c] || 'неизвестен' })),
      synthetic: Array.from({ length: 5 }, (_, i) => Object.fromEntries(names.map(c => [anonColName(c), syntheticValue(types[c], i, c)])))
    });
  }
  if (mode === 'masked' && S.samples.length){
    res.masked = S.samples.map(smp => {
      const H = smp.rows[0] || []; const body = smp.rows.slice(1);
      const types = H.map((_, i) => inferType(body.map(r => r[i]).slice(0, 500)));
      return {
        sample: 'образец ' + (S.samples.indexOf(smp) + 1),
        note: 'Маскированный образец: текст → метки ⟦VAL_n⟧ (одинаковые значения — одинаковые метки, так что соединения и группировки сохраняют смысл); числа — те же разрядность и знак, случайные цифры; даты сдвинуты на постоянное случайное число дней.',
        profile: H.map((h, i) => { const col = body.map(r => r[i]); const ne = col.filter(v => v != null && v !== ''); return { column: anonColName(h), type: types[i], rows: col.length, empty: col.length - ne.length, distinct: new Set(ne).size, maxLen: ne.reduce((a, v) => Math.max(a, String(v).length), 0) }; }),
        rows: body.slice(0, 20).map(r => Object.fromEntries(H.map((h, i) => [anonColName(h), maskValue(r[i], types[i])])))
      };
    });
  }
  return res;
}
function diagSummary(){
  const out = [];
  for (const d of S.diag){
    if (d.kind !== 'table') continue;
    const an = anonymizeTable(d.rows, d.modes, S.cfg, S.dict);
    const v = diagVizData(an); if (!v) continue;
    out.push({ file: 'диагностика ' + (S.diag.indexOf(d) + 1), topSteps: v.top.map(a => ({ query: a.q, step: a.step, seconds: +a.d.toFixed(4), events: a.n })), perQuerySeconds: v.perQ.map(([q, s]) => ({ query: q, seconds: +s.toFixed(4) })) });
  }
  return out.length ? out : null;
}
const AI_RULES = [
  'Метки вида ⟦КАТЕГОРИЯ_N⟧ — обезличенные значения. Переноси их в ответ символ в символ: не меняй, не переводи, не угадывай, что за ними стоит, и не придумывай новых меток.',
  'Если нужен новый литерал (путь, сервер, число, текст), напиши его обычным текстом и перечисли такие места в notes — человек проверит их перед сборкой.',
  'Реальных данных не будет. Если для отладки нужен пример, опиши, какой (столбцы, типы, крайние случаи), или попроси schema / masked samples.',
  'Сохраняй имена запросов и шагов, если задача не требует переименования: от имени запроса зависит связь с таблицей на листе.',
  'Отвечай по-русски. Объясняй, почему изменение ускоряет или исправляет запрос (свёртка, Formula.Firewall, повторные чтения и т. д.).'
];
function buildPackage(){
  if (!S.A) throw new Error('Нет загруженной книги или кода.');
  ensureAnon();
  const dbg = $('#dbgMode').value;
  const pkg = {
    protocol: PROTOCOL, kind: 'package', id: 'pkg-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6),
    created: new Date().toISOString(), tool: 'Мастер PQ ' + PQM_VERSION,
    goal: sanitizeName($('#goal').value || ''),
    environment: { host: $('#envHost').value, locale: $('#envLocale').value },
    rules: AI_RULES,
    privacy: { anonymizedCategories: CATS.filter(c => S.cfg.cats[c.id] || c.locked).map(c => c.id), tokenFormat: '⟦CAT_N⟧', note: 'Код и всё содержимое пакета прошли обезличивание и сканер на стороне пользователя. Словарь замен остаётся у пользователя.' },
    book: { format: S.book.family === 'pbi' ? 'Power BI' : S.book.family === 'excel' ? 'Excel' : 'M-текст', queries: S.A.members.length },
    section: S.anon.out,
    queries: S.A.members.map(m => ({
      name: anonQueryName(m.name), kind: m.isParam ? 'parameter' : m.isFn ? 'function' : 'query',
      loadsTo: [m.load.sheet ? 'sheet' : null, m.load.model ? 'model' : null].filter(Boolean),
      lastRefresh: { rows: m.load.rows, errors: m.load.errors },
      dependsOn: [...m.refs].map(anonQueryName), usedBy: m.usedBy.map(anonQueryName),
      sources: [...new Set(m.sources)],
      steps: m.steps ? m.steps.steps.map(s => ({ name: sanitizeName(s.name), fn: s.fn, unused: s.dead || undefined })) : null
    })),
    lint: S.lint.map(l => ({ severity: l.sev, rule: l.rule, query: anonQueryName(l.query), step: sanitizeName(l.step), message: sanitizeName(l.msg), suggestion: sanitizeName(l.fix) })),
    diagnostics: $('#pkgDiag').checked ? diagSummary() : null,
    debugData: debugData(dbg),
    reply: {
      howTo: 'Ответ — JSON-файл в папке inbox/ (режим агента) или текст в чате. Формат патча ниже. Значения members — полный текст выражения запроса (то, что после «shared Имя =», без завершающей «;»).',
      patchExample: { protocol: PROTOCOL, kind: 'patch', replyTo: '<id пакета>', summary: 'Что изменено и зачем', members: { '<имя запроса или его метка>': 'let\n    Источник = …\nin\n    Результат' }, remove: [], notes: 'Новые литералы, которые нужно проверить человеку' },
      requestExample: { protocol: PROTOCOL, kind: 'request', what: ['package'], debugData: 'schema | masked', note: 'Зачем нужно' }
    }
  };
  // имена запросов в коде уже обезличены, но пакет целиком ещё раз пропускаем через словарь известных значений
  return pkg;
}
function buildPromptText(pkg){
  const q = pkg.queries.map(x => '- ' + x.name + ' [' + x.kind + (x.loadsTo.length ? ', загрузка: ' + x.loadsTo.join('+') : ', только подключение') + ']' + (x.dependsOn.length ? ' ← ' + x.dependsOn.join(', ') : '') + (x.sources.length ? ' · источники: ' + x.sources.join(', ') : '')).join('\n');
  const l = pkg.lint.slice(0, 40).map(x => '- [' + x.severity + '] ' + x.query + (x.step ? ' / ' + x.step : '') + ': ' + x.message).join('\n');
  let t = 'Ты помогаешь разрабатывать и отлаживать запросы Power Query (язык M).\n' +
    'Код обезличен инструментом «Мастер PQ»: конфиденциальные значения заменены метками ⟦КАТЕГОРИЯ_N⟧ (PATH — путь, SRV — сервер, DB — база, URL, NUM — число, DATE — дата, TXT — текст фильтра, SECRET — секрет и т. д.).\n\n' +
    'Правила:\n' + pkg.rules.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n\n' +
    'Формат ответа: код только изменённых и новых запросов в ОДНОМ блоке ```m``` в виде\nshared ИмяЗапроса = let … in …;\nзатем краткое объяснение изменений и список новых литералов, если они есть.\n\n' +
    'Среда: ' + pkg.environment.host + ', локаль ' + pkg.environment.locale + '.\n' +
    'Задача: ' + (pkg.goal || '(не указана — проанализируй код, найди ошибки и узкие места производительности)') + '\n\n' +
    'Запросы:\n' + q + '\n' + (l ? '\nЗамечания локального линтера (эвристики):\n' + l + '\n' : '');
  if (pkg.diagnostics) t += '\nДиагностика (самые долгие шаги, обезличено):\n' + pkg.diagnostics.map(d => d.topSteps.slice(0, 12).map(s => '- ' + s.query + ' › ' + s.step + ': ' + s.seconds + ' с').join('\n')).join('\n') + '\n';
  if (pkg.debugData) t += '\nСхема и отладочные данные (JSON):\n```json\n' + JSON.stringify(pkg.debugData, null, 1) + '\n```\n';
  t += '\nКод (Section1.m):\n```m\n' + pkg.section + '\n```\n';
  return t;
}

/* ---- Комплект для Claude Code ---- */
function winToClaudePath(p){
  p = p.trim().replace(/[\\/]+$/, ''); if (!p) return null;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (m) return '//' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
  if (p.startsWith('\\\\')) return null;
  if (p.startsWith('/')) return '/' + p;
  if (p.startsWith('~')) return p;
  return null;
}
function kitFiles(){
  const deny = ['Bash', 'WebFetch', 'WebSearch'];
  for (const line of ($('#denyPaths').value || '').split(/\r?\n/)){
    const p = winToClaudePath(line); if (!p) continue;
    deny.push('Read(' + p + '/**)', 'Edit(' + p + '/**)', 'Write(' + p + '/**)');
  }
  const settings = { permissions: { deny, defaultMode: 'default' }, '$comment': 'Сгенерировано Мастером PQ. Claude Code должен запускаться из этой папки. Bash и веб запрещены, чтобы агент не мог прочитать оригиналы книг и словари в обход шлюза. Проверьте командой /permissions.' };
  const md = `# Папка обмена «Мастер PQ» — инструкции для Claude Code

Ты работаешь с ОБЕЗЛИЧЕННЫМИ запросами Power Query (язык M). Реальные данные,
оригиналы книг и словарь замен находятся вне этой папки, и доступа к ним у тебя нет.
Это намеренно: страница «Мастер PQ» в браузере пользователя — NDA-шлюз.

## Структура
- \`outbox/\` — пакеты от пользователя: \`package-*.json\` (код, граф, линтер,
  диагностика, схема, синтетические данные) и \`section-*.m\` (обезличенный код).
  Только читай.
- \`inbox/\` — сюда ты пишешь ответы. Страница забирает файлы и показывает их
  пользователю, а применяет только после его подтверждения.
- \`processed/\` — обработанные ответы (не трогай).

## Правила
${AI_RULES.map((r, i) => (i + 1) + '. ' + r).join('\n')}
6. Не пытайся читать файлы вне этой папки, запускать команды или ходить в сеть.
7. Не проси прислать словарь замен или оригинал книги.

## Ответ-патч: \`inbox/patch-<что-то>.json\`
\`\`\`json
{
  "protocol": "${PROTOCOL}",
  "kind": "patch",
  "replyTo": "<id пакета из outbox>",
  "summary": "Кратко: что изменено и зачем",
  "members": {
    "<ИмяЗапроса или его метка ⟦QRY_N⟧>": "let\\n    Источник = …\\nin\\n    Результат"
  },
  "remove": [],
  "notes": "Новые литералы, которые нужно проверить человеку"
}
\`\`\`
- \`members\` — полный текст выражения запроса (после «shared Имя =», без «;»).
  Новый запрос — просто новое имя. Для удаления — имя в \`remove\`.
- Можно вместо \`members\` прислать \`"section"\` — весь Section1.m целиком.

## Запрос пользователю: \`inbox/request-<что-то>.json\`
\`\`\`json
{ "protocol": "${PROTOCOL}", "kind": "request", "what": ["package"], "debugData": "schema", "note": "Зачем нужно" }
\`\`\`
\`debugData\`: \`"schema"\` — схема и синтетические строки; \`"masked"\` — маскированные
образцы (если пользователь их загрузил). Пользователь подтверждает каждый запрос.

## Сообщение: \`inbox/message-<что-то>.json\`
\`\`\`json
{ "protocol": "${PROTOCOL}", "kind": "message", "text": "Вопрос или пояснение для пользователя" }
\`\`\`
`;
  const readme = 'Папка обмена Мастера PQ.\r\nЗапускайте Claude Code ИЗ ЭТОЙ ПАПКИ: cd в неё, затем claude.\r\nОригиналы книг и словари замен держите в другой папке и впишите её на вкладке «Агент» в список запрещённых — тогда она попадёт в .claude/settings.json.\r\nДля полной изоляции запускайте Claude Code под отдельной учётной записью или в контейнере, куда смонтирована только эта папка.\r\n';
  return { 'CLAUDE.md': md, '.claude/settings.json': JSON.stringify(settings, null, 2), 'ПРОЧТИ.txt': readme };
}

/* ---- File System Access API: папка обмена ---- */
async function exchDir(name){ return S.exch.getDirectoryHandle(name, { create: true }); }
async function writeFileIn(dir, path, content){
  const parts = path.split('/'); let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable(); await w.write(content); await w.close();
}
async function pollInbox(){
  if (!S.exch) return;
  const inbox = await exchDir('inbox'); const processed = await exchDir('processed');
  for await (const [name, h] of inbox.entries()){
    if (h.kind !== 'file' || !/\.(json|txt|m|md)$/i.test(name)) continue;
    const f = await h.getFile();
    const key = name + '|' + f.lastModified + '|' + f.size;
    if (S.seenIn.has(key)) continue; S.seenIn.add(key);
    const text = await f.text();
    try { await writeFileIn(processed, new Date().toISOString().replace(/[:.]/g, '-') + '_' + name, text); await inbox.removeEntry(name); } catch { /* оставим как есть, но второй раз не покажем */ }
    receiveInbound(name, text, 'inbox');
  }
}
