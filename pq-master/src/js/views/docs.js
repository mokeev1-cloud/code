/* =====================================================================
   views/docs.js — документация книги (HTML / Markdown), опционально обезличенная.
   Описание запроса берётся из комментариев в начале его кода.
   ===================================================================== */
const DOC_CSS = '.pqdoc{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1b2130;max-width:1100px;margin:0 auto}.pqdoc h1{font-size:26px;margin:0 0 4px}.pqdoc h2{font-size:19px;margin:28px 0 8px;border-bottom:2px solid #e4ecfc;padding-bottom:4px}.pqdoc h3{font-size:15px;margin:16px 0 6px}.pqdoc .muted{color:#667085}.pqdoc table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}.pqdoc th,.pqdoc td{border:1px solid #dde1e8;padding:5px 8px;text-align:left;vertical-align:top}.pqdoc th{background:#f0f2f6}.pqdoc pre{background:#fbfbfd;border:1px solid #dde1e8;border-radius:8px;padding:10px;overflow:auto;font:12.5px Consolas,monospace;white-space:pre-wrap}.pqdoc .k{color:#7b2fb5;font-weight:600}.pqdoc .s{color:#a5461c}.pqdoc .n{color:#0b7a6e}.pqdoc .c{color:#7c8595;font-style:italic}.pqdoc .f{color:#2156b8}.pqdoc .q{color:#8a5a00}.pqdoc .b{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px;background:#f0f2f6;margin-right:4px}.pqdoc .graph{overflow:auto;border:1px solid #dde1e8;border-radius:8px;padding:6px;background:#fbfbfd}.pqdoc .graph svg text{font:12px sans-serif;fill:#1b2130}.pqdoc .graph .gnode rect{fill:#fff;stroke:#c9ced8}.pqdoc .graph .gnode.src rect{fill:#e1f4e9}.pqdoc .graph .gnode.param rect{fill:#e4ecfc}.pqdoc .graph .gnode.load rect{stroke:#2f6fde;stroke-width:2}.pqdoc .graph .gnode.warnf rect{stroke:#b26a00;stroke-width:2}.pqdoc .graph .gnode.fn rect{stroke-dasharray:4 3}.pqdoc .graph .gedge{fill:none;stroke:#8a93a5}.pqdoc .sev-err{color:#c42b2b}.pqdoc .sev-warn{color:#b26a00}';
function memberDescription(text){ const lines = []; for (const l of text.replace(/^\s+/, '').split(/\r?\n/)){ const m = /^\s*\/\/\s?(.*)$/.exec(l); if (m) lines.push(m[1]); else break; } return lines.join(' '); }
function genBookDoc(opts){
  const anon = !!opts.anon; const A = S.A; const a = anon ? ensureAnon() : null;
  const qn = n => anon ? anonQueryName(n) : n; const tx = s => anon ? sanitizeName(String(s)) : String(s);
  const codeOf = m => anon ? a.out.slice(mapPos(a.spans, m.start), mapPos(a.spans, m.end)) : S.work.slice(m.start, m.end);
  const title = anon ? 'Документация запросов Power Query' : 'Документация: ' + S.book.name;
  const loadTxt = m => [m.load.sheet ? 'лист' : '', m.load.model ? 'модель данных' : ''].filter(Boolean).join(' + ') || 'только подключение';
  const kind = m => m.isParam ? 'параметр' : m.isFn ? 'функция' : 'запрос';
  let h = '<div class="pqdoc"><h1>' + escHtml(title) + '</h1><div class="muted">Сформировано Мастером PQ ' + fmtDateTime(new Date()) + (anon ? ' · обезличено' : '') + '</div>';
  h += '<h2>Сводка</h2><table><tr><th>Запросов</th><td>' + A.members.length + ' (загружаются: ' + A.members.filter(m => m.load.sheet || m.load.model).length + ', параметров: ' + A.members.filter(m => m.isParam).length + ', функций: ' + A.members.filter(m => m.isFn).length + ')</td></tr><tr><th>Источники</th><td>' + escHtml([...new Set(A.members.flatMap(m => m.sources))].join(', ') || '—') + '</td></tr><tr><th>Оценка оптимизатора</th><td>' + S.opt.score + ' / 100 · советов: ' + S.opt.findings.length + '</td></tr></table>';
  h += '<h2>Граф зависимостей</h2><div class="graph">' + graphSvg(A, { lint: S.lint, name: qn }) + '</div>';
  h += '<h2>Запросы</h2><table><tr><th>Запрос</th><th>Тип</th><th>Загрузка</th><th>Строк</th><th>Использует</th><th>Используется в</th><th>Шагов</th></tr>' + A.members.map(m => '<tr><td><a href="#q-' + A.members.indexOf(m) + '">' + escHtml(qn(m.name)) + '</a></td><td>' + kind(m) + '</td><td>' + loadTxt(m) + '</td><td>' + (m.load.rows != null ? m.load.rows : '') + '</td><td>' + [...m.refs].map(x => escHtml(qn(x))).join(', ') + '</td><td>' + m.usedBy.map(x => escHtml(qn(x))).join(', ') + '</td><td>' + (m.steps ? m.steps.steps.length : '') + '</td></tr>').join('') + '</table>';
  for (const m of A.members){
    const desc = memberDescription(S.work.slice(m.exprStart, m.exprEnd));
    const lints = S.lint.filter(l => l.query === m.name);
    h += '<h2 id="q-' + A.members.indexOf(m) + '">' + escHtml(qn(m.name)) + '</h2><div><span class="b">' + kind(m) + '</span><span class="b">' + loadTxt(m) + '</span>' + (m.sources.length ? '<span class="b">' + escHtml([...new Set(m.sources)].join(', ')) + '</span>' : '') + (m.load.rows != null ? '<span class="b">' + m.load.rows + ' строк</span>' : '') + '</div>';
    if (desc) h += '<p>' + escHtml(tx(desc)) + '</p>';
    if (Array.isArray(m.load.columns)) h += '<h3>Столбцы результата</h3><p>' + m.load.columns.map(c => '<span class="b">' + escHtml(anon ? anonColName(c) : String(c)) + '</span>').join(' ') + '</p>';
    if (m.steps) h += '<h3>Шаги</h3><table><tr><th>#</th><th>Шаг</th><th>Функция</th><th>Зависит от</th><th>Примечание</th></tr>' + m.steps.steps.map((s, i) => '<tr><td>' + (i + 1) + '</td><td>' + escHtml(tx(s.name)) + '</td><td>' + escHtml(s.fn) + '</td><td>' + [...s.refs].map(x => escHtml(tx(x))).join(', ') + '</td><td>' + (s.dead ? 'не используется ' : '') + lints.filter(l => l.step === s.name).map(l => '<span class="sev-' + l.sev + '">' + escHtml(tx(l.msg)) + '</span>').join('; ') + '</td></tr>').join('') + '</table>';
    const ql = lints.filter(l => !l.step);
    if (ql.length) h += '<h3>Замечания</h3><ul>' + ql.map(l => '<li class="sev-' + l.sev + '">' + escHtml(tx(l.msg)) + '</li>').join('') + '</ul>';
    if (opts.code) h += '<h3>Код</h3><pre>' + highlightM(codeOf(m)) + '</pre>';
  }
  h += '</div>';
  // Markdown
  let md = '# ' + title + '\n\n_Сформировано Мастером PQ ' + fmtDateTime(new Date()) + (anon ? ' · обезличено' : '') + '_\n\n## Запросы\n\n| Запрос | Тип | Загрузка | Строк | Использует |\n|---|---|---|---|---|\n' + A.members.map(m => '| ' + qn(m.name) + ' | ' + kind(m) + ' | ' + loadTxt(m) + ' | ' + (m.load.rows != null ? m.load.rows : '') + ' | ' + [...m.refs].map(qn).join(', ') + ' |').join('\n') + '\n';
  for (const m of A.members){
    md += '\n## ' + qn(m.name) + '\n\n' + kind(m) + ' · ' + loadTxt(m) + (m.sources.length ? ' · ' + [...new Set(m.sources)].join(', ') : '') + '\n';
    const desc = memberDescription(S.work.slice(m.exprStart, m.exprEnd)); if (desc) md += '\n' + tx(desc) + '\n';
    if (m.steps) md += '\n| # | Шаг | Функция |\n|---|---|---|\n' + m.steps.steps.map((s, i) => '| ' + (i + 1) + ' | ' + tx(s.name) + ' | ' + s.fn + ' |').join('\n') + '\n';
    if (opts.code) md += '\n```m\n' + codeOf(m) + '\n```\n';
  }
  return { html: h, md, full: '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>' + escHtml(title) + '</title><style>body{margin:24px;background:#fff}' + DOC_CSS + '</style></head><body>' + h + '</body></html>' };
}
async function exportDoc(kind){
  const opts = { anon: $('#docAnon').checked, code: $('#docCode').checked };
  const d = genBookDoc(opts); const content = kind === 'md' ? d.md : d.full;
  const name = (opts.anon ? 'pq_документация_' + stamp() : S.book.name.replace(/\.[^.]+$/, '') + '_документация') + (kind === 'md' ? '.md' : '.html');
  if (opts.anon){ if (!(await gate(kind === 'md' ? d.md : d.full.replace(/<[^>]+>/g, ' '), 'Документация'))) return; audit('скачивание', name, content); }
  else if ((await modal('<h2>Документация с реальными данными</h2><p>В документе реальные имена, пути и код. Это файл для внутреннего использования. Для отправки наружу включите «обезличить».</p>', [['cancel', 'Отмена'], ['go', 'Скачать', 'pri']])) !== 'go') return;
  download(name, content, kind === 'md' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8');
}
$('#docHtml').onclick = () => exportDoc('html');
$('#docMd').onclick = () => exportDoc('md');
$('#docAnon').onchange = () => renderDocs(); $('#docCode').onchange = () => renderDocs();
function renderDocs(){ if (!S.A) return; const d = genBookDoc({ anon: $('#docAnon').checked, code: $('#docCode').checked }); $('#docPreview').innerHTML = '<style>' + DOC_CSS.replace(/\.pqdoc/g, '.pqdoc-preview .pqdoc') + '.pqdoc-preview .pqdoc{color:var(--text)}.pqdoc-preview .pqdoc th{background:var(--panel2)}.pqdoc-preview .pqdoc pre{background:var(--code-bg)}</style>' + d.html; }
registerView('docs', { render: renderDocs });
