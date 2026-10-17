#!/usr/bin/env node
/*
  Сборщик «Мастера PQ».
  Исходники — модули (порядок задаёт MANIFEST ниже), результат — ОДИН файл ../pq-master.html.

  node build.mjs                   собрать ../pq-master.html
  node build.mjs --check           собрать и проверить, что разрезка даёт исходники байт в байт
  node build.mjs --split FILE DIR  разрезать готовый pq-master.html обратно на модули в DIR
                                   (DIR получает всё: src/, DEV.md, vendor/, test/ и сам build.mjs)

  Каждый модуль в итоговом файле обёрнут маркерами BEGIN/END с путём модуля: для CSS/JS и файлов
  разработки — в комментарии вида «/* … *\/», для HTML и Markdown — в HTML-комментарии.
  В начале файла — оглавление с номерами строк, чтобы читать только нужный модуль.
  Типы модулей: html (разметка), css, md (DEV.md, блок pqm-dev-docs), vendor (CodeMirror),
  js (приложение), file (сборщик, тесты, точка входа CodeMirror — блок pqm-dev-files, не исполняется).
  Зависимостей нет: только Node.js ≥ 18.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '..', 'pq-master.html');
// сборщик сам встроен в HTML, поэтому в его тексте не должно быть закрывающего тега script и начала HTML-комментария
const LT = '<';
const END_SCRIPT = LT + '/script>';
const HC = [LT + '!-- ', ' -->'];

// [тип, путь]. Тип определяет, в какой контейнер попадёт модуль.
export const MANIFEST = [
  ['html', 'src/html/head.html'],
  ['css', 'src/css/theme.css'],
  ['css', 'src/css/themes.css'],
  ['css', 'src/css/layout.css'],
  ['css', 'src/css/components.css'],
  ['css', 'src/css/editor.css'],
  ['html', 'src/html/shell-top.html'],
  ['html', 'src/html/view-home.html'],
  ['html', 'src/html/view-editor.html'],
  ['html', 'src/html/view-optimizer.html'],
  ['html', 'src/html/view-graph.html'],
  ['html', 'src/html/view-sandbox.html'],
  ['html', 'src/html/view-reference.html'],
  ['html', 'src/html/view-snippets.html'],
  ['html', 'src/html/view-history.html'],
  ['html', 'src/html/view-anon.html'],
  ['html', 'src/html/view-diag.html'],
  ['html', 'src/html/view-ai.html'],
  ['html', 'src/html/view-agent.html'],
  ['html', 'src/html/view-compare.html'],
  ['html', 'src/html/view-docs.html'],
  ['html', 'src/html/view-help.html'],
  ['html', 'src/html/view-selftest.html'],
  ['html', 'src/html/shell-bottom.html'],
  ['md', 'DEV.md'],
  ['file', 'build.mjs'],
  ['file', 'test/e2e.mjs'],
  ['file', 'test/stress.mjs'],
  ['file', 'vendor/codemirror.entry.js'],
  ['vendor', 'vendor/codemirror.bundle.js'],
  ['js', 'src/js/core/zip-mashup.js'],
  ['js', 'src/js/m/lang.js'],
  ['js', 'src/js/m/format.js'],
  ['js', 'src/js/m/reference.js'],
  ['js', 'src/js/m/interp.js'],
  ['js', 'src/js/nda/anon.js'],
  ['js', 'src/js/nda/diag.js'],
  ['js', 'src/js/opt/lint.js'],
  ['js', 'src/js/opt/optimizer.js'],
  ['js', 'src/js/opt/refactor.js'],
  ['js', 'src/js/opt/snippets.js'],
  ['js', 'src/js/app/state.js'],
  ['js', 'src/js/nda/agent.js'],
  ['js', 'src/js/app/ui-base.js'],
  ['js', 'src/js/app/storage.js'],
  ['js', 'src/js/app/hints.js'],
  ['js', 'src/js/app/shell.js'],
  ['js', 'src/js/views/home.js'],
  ['js', 'src/js/views/editor.js'],
  ['js', 'src/js/views/optimizer.js'],
  ['js', 'src/js/views/graph.js'],
  ['js', 'src/js/views/sandbox.js'],
  ['js', 'src/js/views/reference.js'],
  ['js', 'src/js/views/snippets.js'],
  ['js', 'src/js/views/history.js'],
  ['js', 'src/js/views/anon.js'],
  ['js', 'src/js/views/diag.js'],
  ['js', 'src/js/views/ai.js'],
  ['js', 'src/js/views/agent.js'],
  ['js', 'src/js/views/compare.js'],
  ['js', 'src/js/views/docs.js'],
  ['js', 'src/js/views/help.js'],
  ['js', 'src/js/app/selftest.js'],
  ['js', 'src/js/app/main.js']
];

const wrap = (type, p, body) => {
  const c = type === 'html' || type === 'md' ? HC : ['/* ', ' */'];
  return `${c[0]}===== BEGIN ${p} =====${c[1]}\n${body}\n${c[0]}===== END ${p} =====${c[1]}`;
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\n$/, '');
// строка-маркер целиком (\x3c — это «<»): только такие строки считаются границами модулей
const MARK = (kind, name) => new RegExp('^(?:\\/\\* |\\x3c!-- )===== ' + kind + ' (' + (name || '\\S+') + ') =====(?: \\*\\/| -->)$');

export function build(){
  const parts = { html: [], css: [], bottom: [], md: [], file: [], vendor: [], js: [] };
  let seenShellBottom = false;
  for (const [type, p] of MANIFEST){
    const body = read(p);
    if (type === 'md' && /<\/?script/i.test(body)) throw new Error(p + ': в Markdown не должно быть тегов script (ломает разбор HTML)');
    if ((type === 'js' || type === 'vendor' || type === 'file') && (/<\/script/i.test(body) || body.includes(HC[0].trim()))) throw new Error(p + ': в коде не должно быть закрывающего тега script и начала HTML-комментария — соберите строку из частей: "<" + "/script>"');
    const w = wrap(type, p, body);
    if (type === 'html'){ if (p.endsWith('shell-bottom.html')) seenShellBottom = true; (seenShellBottom ? parts.bottom : parts.html).push(w); }
    else parts[type].push(w);
  }
  const [head, ...bodyHtml] = parts.html;
  const block = (attrs, items) => '\n' + LT + 'script ' + attrs + '>\n' + items.join('\n') + '\n' + END_SCRIPT;
  let out = head + '\n' + LT + 'style>\n' + parts.css.join('\n') + '\n' + LT + '/style>\n' + LT + '/head>\n' + LT + 'body>\n' + bodyHtml.join('\n') + '\n' + parts.bottom.join('\n') +
    block('type="text/markdown" id="pqm-dev-docs"', parts.md) +
    block('type="text/plain" id="pqm-dev-files"', parts.file) +
    block('id="pqm-vendor"', parts.vendor) +
    block('id="pqm-app"', ["'use strict';", ...parts.js]) + '\n' + LT + '/body>\n' + LT + '/html>\n';
  // оглавление с номерами строк (номера считаются с учётом самого оглавления)
  const tocFor = text => {
    const lines = text.split('\n'); const items = []; const ends = {};
    lines.forEach((l, i) => { let m = MARK('BEGIN').exec(l); if (m) items.push([m[1], i + 1]); m = MARK('END').exec(l); if (m) ends[m[1]] = i + 1; });
    return items.map(([p, s]) => `  ${String(s).padStart(6)}–${String(ends[p]).padEnd(6)} ${p}`).join('\n');
  };
  const tocHead = n => HC[0].trim() + `\n  Мастер PQ — собрано из модулей (build.mjs). НЕ РЕДАКТИРУЙТЕ этот файл вручную — правьте модуль и пересоберите.\n  Есть только этот HTML? Справка → «Для разработчика» → «⬇ build.mjs», затем:\n    node build.mjs --split pq-master.html pq-master   (восстановит все исходники, тесты и сам сборщик)\n  Документация для разработчика: блок «pqm-dev-docs» (DEV.md) ниже.\n  ОГЛАВЛЕНИЕ (строки этого файла → модуль):\n${n}\n` + HC[1].trim() + '\n';
  const DT = LT + '!doctype html>\n';
  let toc = tocHead(tocFor(DT + out));
  for (let i = 0; i < 3; i++){ const shift = toc.split('\n').length - 1; const t2 = tocHead(tocFor(DT + '\n'.repeat(shift) + out)); if (t2 === toc) break; toc = t2; }
  return DT + toc + out;
}
export function split(html){
  const lines = html.split('\n'); const files = {};
  for (let i = 0; i < lines.length; i++){
    const m = MARK('BEGIN').exec(lines[i]); if (!m) continue;
    const name = m[1], endRe = MARK('END', name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    let j = i + 1; while (j < lines.length && !endRe.test(lines[j])) j++;
    if (j >= lines.length) throw new Error('Нет конца модуля ' + name);
    files[name] = lines.slice(i + 1, j).join('\n') + '\n'; i = j;
  }
  return files;
}

const args = process.argv.slice(2);
if (args[0] === '--split'){
  const html = fs.readFileSync(args[1], 'utf8'); const dir = args[2] || 'src-out';
  const files = split(html);
  for (const [p, c] of Object.entries(files)){ const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); }
  console.log('Модулей извлечено:', Object.keys(files).length, '→', dir);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const html = build();
  fs.writeFileSync(OUT, html);
  console.log('Собрано:', path.relative(process.cwd(), OUT), (html.length / 1024).toFixed(0) + ' КБ,', html.split('\n').length, 'строк,', MANIFEST.length, 'модулей');
  if (args.includes('--check')){
    const files = split(html); let bad = 0;
    for (const [, p] of MANIFEST){ if (files[p] !== read(p) + '\n'){ console.error('Расхождение при разрезке:', p); bad++; } }
    if (Object.keys(files).length !== MANIFEST.length){ console.error('Модулей в файле:', Object.keys(files).length, 'а в MANIFEST:', MANIFEST.length); bad++; }
    if (bad) process.exit(1);
    console.log('Проверка разрезки: все', MANIFEST.length, 'модулей восстанавливаются байт в байт.');
  }
}
