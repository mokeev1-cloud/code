"""
Извлечение стихотворений из FB2-файла (книга Рыжего «В кварталах дальних
и печальных», 2012) в простой текст.

Запуск:
    python3 tools/fb2_to_txt.py corpus/ryzhy/raw/<файл>.fb2 corpus/ryzhy/ryzhy_v-kvartalah-2012.txt

Формат результата — по блоку на каждый <poem>:

    ### <заглавие раздела/стихотворения>
    строка
    строка

Как устроен FB2 этого издания: <section> с <title> (заглавие стихотворения
или ««Первая строка…»») и внутри один или несколько <poem>, строки — <v>.
Примечания (body name="notes") отрезаются, ссылки на них вида [70] в
тексте остаются — по ним можно найти комментарий в исходном .fb2.

Ограничения (известны, на поиск не влияют):
  * у стихотворений внутри циклов (например «Маленькие трагедии»)
    заглавием становится название цикла;
  * стихи, процитированные в предисловии, попадают под заглавие
    предисловия («Дмитрий Сухарев… Влажным взором»);
  * длинные «прозаические» строфы (как в «Море») остаются одной строкой.
"""
import html
import re
import sys

src, out = sys.argv[1], sys.argv[2]
x = open(src, encoding="utf-8").read()

body = x.split("<body", 1)[1]                                  # всё после первого <body
body = re.sub(r'<body name="notes".*', '', body, flags=re.S)   # без примечаний

res = []
# Секция = от <section> до следующего <section> или </section>
# (вложенность секций в этой книге неглубокая, такого приближения хватает).
for m in re.finditer(r'<section>(.*?)(?=<section>|</section>)', body, re.S):
    sec = m.group(1)
    t = re.search(r'<title>(.*?)</title>', sec, re.S)
    title = re.sub(r'<[^>]+>', ' ', t.group(1)).strip() if t else ''
    for p in re.finditer(r'<poem>(.*?)</poem>', sec, re.S):
        lines = [html.unescape(re.sub(r'<[^>]+>', '', v)).strip()
                 for v in re.findall(r'<v>(.*?)</v>', p.group(1), re.S)]
        res.append(f"### {' '.join(title.split())}\n" + "\n".join(lines))

open(out, "w", encoding="utf-8").write("\n\n".join(res))
print(len(res), "poems")
