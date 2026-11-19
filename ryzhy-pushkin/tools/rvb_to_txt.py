"""
Сборка сводного текстового файла Пушкина из скачанных страниц rvb.ru.

Запуск (из папки ryzhy-pushkin):
    python3 tools/rvb_to_txt.py corpus/pushkin/html corpus/pushkin/pushkin_10vol.txt

Формат результата — один текст на блок, блоки разделены пустой строкой:

    ### т.<том> <путь страницы> | <заглавие или первая строка>
    строка текста
    строка текста
    ...

Путь страницы кодирует раздел и год, например
    01text/01versus/0217_22/1820/0077.htm  — лирика, 1820 год, текст № 77.
По этому пути текст легко найти на сайте: https://rvb.ru/pushkin/<путь>.
Комментарии издания лежат на сайте по адресу 02comm/<номер>.htm.

Порядок текстов — порядок оглавлений томов (т.е. порядок издания).

Что вычищается: колонтитулы с номерами страниц (<div class="page">),
сноски-номера (<sup>), вся HTML-разметка. Строки стихов сохраняются
построчно (на rvb.ru каждая строка стиха — отдельный <span> + <br>).
"""
import html
import os
import re
import sys

root, out = sys.argv[1], sys.argv[2]

# Порядок страниц по оглавлениям томов.
order = []
for v in range(1, 11):
    toc = open(f"{root}/toc/tocvol{v}.htm", encoding="utf-8").read()
    for h in re.findall(r'href="(0[^"#]+\.htm)', toc):
        if h not in order:
            order.append((v, h))

seen, res = set(), []
for v, h in order:
    if h in seen or not os.path.exists(f"{root}/{h}"):
        continue
    seen.add(h)
    x = open(f"{root}/{h}", encoding="utf-8").read()

    # Полезный текст на rvb.ru заключён между этими двумя HTML-комментариями.
    m = re.search(r'<!-- Content goes here(.*?)<!-- Начало нижней навигации', x, re.S)
    if not m:
        continue
    c = m.group(1)
    c = re.sub(r'<div class="page"[^>]*>.*?</div>', '', c)    # номера страниц издания
    c = re.sub(r'<sup.*?</sup>', '', c, flags=re.S)            # номера сносок
    c = re.sub(r'<br\s*/?>|</p>|</h\d>|</div>', '\n', c)       # конец строки/абзаца
    c = html.unescape(re.sub(r'<[^>]+>', '', c))               # прочие теги долой
    c = c.replace('-->', '')                                   # хвост HTML-комментария
    lines = [l.strip() for l in c.split('\n')]
    txt = '\n'.join(l for l in lines if l)

    # Заглавие = первая непустая строка, не состоящая из «====» или «* * *».
    title = next((l for l in txt.split('\n') if l.strip('=* .')), '')[:80]
    res.append(f"### т.{v} {h} | {title}\n{txt}")

open(out, "w", encoding="utf-8").write("\n\n".join(res))
print(len(res), "texts")
