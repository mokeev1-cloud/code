#!/usr/bin/env bash
# Скачивание и конвертация корпуса Бориса Рыжего.
#
# ВНИМАНИЕ: тексты Рыжего охраняются авторским правом (до 2072 г.).
# Поэтому в публичный git-репозиторий они не кладутся (см. .gitignore),
# а скачиваются этим скриптом для личной исследовательской работы.
#
# Полного (академического) собрания сочинений Рыжего не существует.
# Используются четыре издания (источник файлов — flibusta.is):
#   308127  «В кварталах дальних и печальных» (М.: Искусство-XXI век, 2012), FB2 — 536 стих.
#   703898  «И всё такое…» (СПб.: Пушкинский фонд, 2000) — ПРИЖИЗНЕННОЕ, PDF с текстовым слоем
#   703899  «На холодном ветру» — PDF с текстовым слоем (послесловие С. Гандлевского)
#   732115  «Оправдание жизни» (Екатеринбург, 2015) — самое полное: лирика, ранние,
#           проза, критика, интервью, письма, воспоминания; DjVu с OCR-слоем
#           (возможны опечатки распознавания!)
# Примечание: flibusta отдаёт «/fb2» для всех, но реальный формат у 703898/703899 — PDF,
# у 732115 — DjVu; поэтому файлы сразу сохраняются с правильными расширениями.
#
# Нужны программы: curl, unzip, python3, pdftotext (poppler-utils), djvutxt (djvulibre-bin):
#   apt-get install -y poppler-utils djvulibre-bin
#
# Запуск (из папки ryzhy-pushkin):
#   tools/fetch_ryzhy.sh            # -> corpus/ryzhy/
#   tools/fetch_ryzhy.sh другая/папка
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"        # папка со скриптами, где бы ни запускали
D="${1:-corpus/ryzhy}"
mkdir -p "$D/raw"
cd "$D/raw"

# 1. Исходные файлы
curl -sL -o k.zip https://flibusta.is/b/308127/fb2 && unzip -o -q k.zip && rm k.zip   # FB2 в zip
curl -sL -o 703898_I-vse-takoe.pdf        https://flibusta.is/b/703898/fb2
curl -sL -o 703899_Na-holodnom-vetru.pdf  https://flibusta.is/b/703899/fb2
curl -sL -o 732115_Opravdanie-zhizni.djvu https://flibusta.is/b/732115/fb2
cd ..

# 2. Конвертация в простой текст (UTF-8)
python3 "$TOOLS/fb2_to_txt.py" raw/*.fb2 ryzhy_v-kvartalah-2012.txt
pdftotext -layout raw/703898_I-vse-takoe.pdf       ryzhy_i-vse-takoe.txt
pdftotext -layout raw/703899_Na-holodnom-vetru.pdf ryzhy_na-holodnom-vetru.txt
djvutxt raw/732115_Opravdanie-zhizni.djvu          ryzhy_opravdanie-zhizni.txt
