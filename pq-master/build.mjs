#!/usr/bin/env node
/*
  Сборщик «Мастера PQ».
  Исходники — модули в src/ (порядок задаёт MANIFEST ниже), результат — ОДИН файл ../pq-master.html.

  node build.mjs                   собрать ../pq-master.html
  node build.mjs --check           собрать и проверить, что разрезка даёт исходники байт в байт
  node build.mjs --split FILE DIR  разрезать готовый pq-master.html обратно на модули в DIR
                                   (если у вас есть только HTML — так можно восстановить src/)

  Каждый модуль в итоговом файле обёрнут маркерами
    /* ===== BEGIN path ===== *\/ … /* ===== END path ===== *\/      (CSS/JS)
    <!-- ===== BEGIN path ===== --> … <!-- ===== END path ===== -->  (HTML/Markdown)
  а в самом начале файла — оглавление с номерами строк, чтобы читать только нужный модуль.
  Зависимостей нет: только Node.js ≥ 18.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '..', 'pq-master.html');

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
  const c = type === 'html' || type === 'md' ? ['<!-- ', ' -->'] : ['/* ', ' */'];
  return `${c[0]}===== BEGIN ${p} =====${c[1]}\n${body}\n${c[0]}===== END ${p} =====${c[1]}`;
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\n$/, '');

export function build(){
  const parts = { html: [], css: [], bottom: [], md: [], vendor: [], js: [] };
  let seenShellBottom = false;
  for (const [type, p] of MANIFEST){
    const body = read(p);
    if (type === 'md' && /<\/?script/i.test(body)) throw new Error(p + ': в Markdown не должно быть <script / </script (ломает разбор HTML)');
    if ((type === 'js' || type === 'vendor') && /<\/script|<!--/i.test(body)) throw new Error(p + ': в JS не должно быть </script и <!-- — используйте "<\\/script"');
    const w = wrap(type, p, body);
    if (type === 'html'){ if (p.endsWith('shell-bottom.html')) seenShellBottom = true; (seenShellBottom ? parts.bottom : parts.html).push(w); }
    else parts[type].push(w);
  }
  const [head, ...bodyHtml] = parts.html;
  let out = head + '\n<style>\n' + parts.css.join('\n') + '\n</style>\n</head>\n<body>\n' + bodyHtml.join('\n') + '\n' + parts.bottom.join('\n') +
    '\n<script type="text/markdown" id="pqm-dev-docs">\n' + parts.md.join('\n') + '\n</script>' +
    '\n<script id="pqm-vendor">\n' + parts.vendor.join('\n') + '\n</script>' +
    '\n<script id="pqm-app">\n\'use strict\';\n' + parts.js.join('\n') + '\n</script>\n</body>\n</html>\n';
  // оглавление с номерами строк (номера считаются с учётом самого оглавления)
  const tocFor = text => {
    const lines = text.split('\n'); const items = [];
    lines.forEach((l, i) => { const m = /===== BEGIN (\S+) =====/.exec(l); if (m) items.push([m[1], i + 1]); });
    const ends = {}; lines.forEach((l, i) => { const m = /===== END (\S+) =====/.exec(l); if (m) ends[m[1]] = i + 1; });
    return items.map(([p, s]) => `  ${String(s).padStart(6)}–${String(ends[p]).padEnd(6)} ${p}`).join('\n');
  };
  const tocHead = n => `<!--\n  Мастер PQ — собрано из модулей (pq-master/build.mjs). НЕ РЕДАКТИРУЙТЕ этот файл вручную —\n  правьте модуль и пересоберите; нет исходников — разрежьте: node build.mjs --split pq-master.html src-out\n  Документация для разработчика: блок <script id="pqm-dev-docs"> (DEV.md) ниже.\n  ОГЛАВЛЕНИЕ (строки этого файла → модуль):\n${n}\n-->\n`;
  const DT = '<!doctype html>\n';
  let toc = tocHead(tocFor(DT + out));
  for (let i = 0; i < 3; i++){ const shift = toc.split('\n').length - 1; const t2 = tocHead(tocFor(DT + '\n'.repeat(shift) + out)); if (t2 === toc) break; toc = t2; }
  return DT + toc + out;
}
export function split(html){
  const re = /(?:\/\* |<!-- )===== BEGIN (\S+) =====(?: \*\/| -->)\n([\s\S]*?)\n(?:\/\* |<!-- )===== END \1 =====(?: \*\/| -->)/g;
  const files = {}; let m;
  while ((m = re.exec(html))) files[m[1]] = m[2] + '\n';
  return files;
}

const args = process.argv.slice(2);
if (args[0] === '--split'){
  const html = fs.readFileSync(args[1], 'utf8'); const dir = args[2] || 'src-out';
  const files = split(html);
  for (const [p, c] of Object.entries(files)){ const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); }
  console.log('Модулей извлечено:', Object.keys(files).length, '→', dir);
} else {
  const html = build();
  fs.writeFileSync(OUT, html);
  console.log('Собрано:', path.relative(process.cwd(), OUT), (html.length / 1024).toFixed(0) + ' КБ,', html.split('\n').length, 'строк,', MANIFEST.length, 'модулей');
  if (args.includes('--check')){
    const files = split(html); let bad = 0;
    for (const [, p] of MANIFEST){ if (files[p] !== read(p) + '\n'){ console.error('Расхождение при разрезке:', p); bad++; } }
    if (bad) process.exit(1);
    console.log('Проверка разрезки: все', MANIFEST.length, 'модулей восстанавливаются байт в байт.');
  }
}
