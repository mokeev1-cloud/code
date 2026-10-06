#!/usr/bin/env python3
"""Сборка master.html из исходников: python3 master/build.py  → master/master.html"""
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
src = lambda *p: os.path.join(here, 'src', *p)
rd = lambda *p: open(src(*p), encoding='utf-8').read()
safe = lambda s: s.replace('</script', '<\\/script').replace('</SCRIPT', '<\\/SCRIPT')

html = rd('index.html')
parts = {
    '/*@CSS*/': rd('style.css'),
    '/*@lib-xlsx*/': rd('lib', 'lib-xlsx.js'), '/*@lib-jszip*/': rd('lib', 'lib-jszip.js'), '/*@lib-petrovich*/': rd('lib', 'lib-petrovich.js'),
    '/*@engine-core*/': rd('engine', 'core.js'), '/*@engine-tpl*/': rd('engine', 'tpl.js'), '/*@engine-cess*/': rd('engine', 'cess.js'),
    '/*@engine-acc*/': rd('engine', 'acc.js'), '/*@engine-liq*/': rd('engine', 'liq.js'), '/*@engine-ext*/': rd('engine', 'ext.js'),
    '/*@engine-test*/': rd('engine', 'test.js'), '/*@engine-case*/': rd('case.js'),
    '/*@app*/': rd('app-a.js') + '\n' + rd('app-b.js') + '\n' + rd('app-c.js'),
}
legacy = rd('legacy-docs.md')
legacy = re.sub(r'^<script[^>]*>\n', '', legacy)
legacy = re.sub(r'\n## 0\. .*?(?=\n## 1\. )', '\n', legacy, flags=re.S)
legacy = re.sub(r'\n## 4\. .*?(?=\n## 5\. )', '\n', legacy, flags=re.S)
legacy = legacy.replace('# ВГО: уступки, зачеты, ликвидация — документация проекта', '# Приложение. Документация движка (из исходного инструмента «ВГО»)\n\nРазделы 0 и 4 исходной документации (запуск и пересборка) заменены разделом «Разработка» выше. Названия режимов «1. Свертывание ВГО», «2. Внешние долги», «3. Готовность» соответствуют шагам 4, 5 и 3 мастера.')
parts['/*@docs*/'] = rd('docs.md') + '\n\n' + legacy
for k, v in parts.items():
    assert html.count(k) == 1, k
    i = html.index(k); html = html[:i] + safe(v) + html[i + len(k):]
out = os.path.join(here, 'master.html')
open(out, 'w', encoding='utf-8').write(html)
print('master.html', round(len(html.encode('utf-8')) / 1024), 'КБ')
