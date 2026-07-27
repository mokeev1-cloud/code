#!/usr/bin/env python3
"""Сборка автономного HTML из модулей.
   Использование:  python3 build.py [выходной.html]
   Порядок модулей задаётся именами файлов в src/ (00-, 10-, 20-, ...).
   Ничего не минифицируется: файл должен оставаться читаемым и правимым."""
import sys, pathlib

ROOT = pathlib.Path(__file__).parent
SRC  = ROOT / 'src'
OUT  = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'polyphony.html')

mods = sorted(SRC.glob('*.js'))
app  = '\n'.join(f'/* ===== {m.name} ===== */\n' + m.read_text().rstrip() for m in mods)
data = (ROOT / 'data.js').read_text()
html = (ROOT / 'shell.html').read_text()

OUT.write_text(html.replace('__DATA__', data).replace('__APP__', app))
print(f'{OUT}: {len(mods)} модулей, {round(OUT.stat().st_size/1024,1)} КБ')
