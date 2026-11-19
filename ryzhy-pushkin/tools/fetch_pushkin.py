"""
Скачивание корпуса Пушкина.

Источник: А. С. Пушкин. Собрание сочинений в 10 томах. М.: ГИХЛ, 1959–1962.
Электронная публикация — Русская виртуальная библиотека (rvb.ru/pushkin/).
Тексты — общественное достояние.

Что делает:
  1. Скачивает оглавления всех 10 томов (tocvol1.htm … tocvol10.htm).
  2. Собирает из них ссылки на страницы текстов (они начинаются с цифры 0:
     01text/..., 03articles/... — так устроены пути на rvb.ru).
  3. Скачивает каждую страницу в 6 потоков, повторяя запрос при ошибке.

Запуск (из папки ryzhy-pushkin):
    python3 tools/fetch_pushkin.py corpus/pushkin/html

Результат: corpus/pushkin/html/ — ~2000 HTML-страниц (≈50 МБ, в git НЕ
кладётся, т.к. почти весь объём — разметка сайта; в git лежит только
сводный текст, см. rvb_to_txt.py).

Важно: rvb.ru отдаёт страницы в кодировке windows-1251; сохраняем уже в UTF-8,
чтобы дальше работать с текстом без перекодировок.
Повторный запуск докачивает только отсутствующие страницы.
"""
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://rvb.ru/pushkin/"
OUT = sys.argv[1]  # куда складывать HTML


def get(url):
    """Скачать URL; до 4 попыток с паузой 1, 2, 4, 8 с. None — если не вышло."""
    for i in range(4):
        try:
            return urllib.request.urlopen(url, timeout=60).read()
        except Exception:
            time.sleep(2 ** i)
    print("FAIL", url, file=sys.stderr)
    return None


# --- 1–2. Оглавления томов -> упорядоченный список страниц без повторов ---
links = []
for v in range(1, 11):
    toc = get(f"{BASE}tocvol{v}.htm").decode("cp1251", "replace")
    os.makedirs(f"{OUT}/toc", exist_ok=True)
    # Оглавления сохраняем: rvb_to_txt.py по ним восстанавливает порядок текстов.
    open(f"{OUT}/toc/tocvol{v}.htm", "w", encoding="utf-8").write(toc)
    for h in re.findall(r'href="(0[^"#]+\.htm)', toc):
        if h not in links:
            links.append(h)
print(len(links), "pages")


# --- 3. Скачивание страниц ---
def dl(h):
    p = f"{OUT}/{h}"
    if os.path.exists(p):  # уже скачано при прошлом запуске
        return
    b = get(BASE + h)
    if b is None:
        return
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(b.decode("cp1251", "replace"))


# 6 потоков — компромисс между скоростью и вежливостью к сайту.
with ThreadPoolExecutor(6) as ex:
    list(ex.map(dl, links))
print("done")
