"""
Поиск тропа «дальный — печальный» (задача 1).

Ищет в текстовых файлах корпуса места, где слово на ДАЛЬН-/ДАЛЁК-/ОТДАЛЁНН-
стоит не дальше чем в W строках от слова на ПЕЧАЛЬН-, и печатает такие
фрагменты с заглавием текста и номером строки в файле.

Пометка «РИФМА» ставится, если оба слова стоят В КОНЦЕ своих строк
(т.е. образуют рифменную пару, как у Пушкина «дальным / печальным»).
Внутристрочное созвучие («В кварталах дальних и печальных») рифмой не
помечается, но, разумеется, находится.

Запуск:
    python3 tools/trope_dalny.py corpus/pushkin/pushkin_10vol.txt
    python3 tools/trope_dalny.py corpus/ryzhy/*.txt

Заглавие берётся из последней строки вида «### …» перед фрагментом
(такие строки делают fb2_to_txt.py и rvb_to_txt.py; в PDF/DjVu-текстах
их нет, поэтому там заглавие пустое — ориентируйтесь по номеру строки).

Окно W = 4 строки: шире — растёт шум (слова из соседних строф), уже —
теряются рифмы через строку (abab). Проверка с W = 8 для Пушкина новых
текстов не дала.
"""
import re
import sys

W = 4  # окно поиска, строк в каждую сторону

# «Даль»: дальн* (все формы, вкл. твёрдую основу дальный/дальным/дальных),
# далёк*/далек*, отдалённ*. Слово «дальнейший» отсекается ниже отдельно.
pat_d = re.compile(r'\b(дальн\w*|дал[её]к\w*|отдал[её]нн\w*)', re.I)
pat_p = re.compile(r'\bпечальн\w*', re.I)

for path in sys.argv[1:]:
    lines = open(path, encoding='utf-8').read().split('\n')

    # Для каждой строки запоминаем заглавие текущего текста.
    title, titles = '', []
    for l in lines:
        if l.startswith('###'):
            title = l[4:]
        titles.append(title)

    # Пары (начало, конец) фрагмента; set — чтобы не печатать дубли.
    hits = set()
    for i, l in enumerate(lines):
        if not pat_d.search(l) or 'дальнейш' in l.lower():
            continue
        for j in range(max(0, i - W), min(len(lines), i + W + 1)):
            if pat_p.search(lines[j]):
                hits.add((min(i, j), max(i, j)))

    print(f"\n######## {path}: {len(hits)}")
    for a, b in sorted(hits):
        # Последнее слово первой и последней строки фрагмента.
        ends = [re.findall(r'\w+', lines[k].lower())[-1:] for k in (a, b)]
        is_rhyme = (any(pat_d.match(e[0]) for e in ends if e)
                    and any(pat_p.match(e[0]) for e in ends if e))
        print(f"--- {'РИФМА ' if is_rhyme else ''}[{titles[a][:70]}] L{a + 1}")
        for k in range(a, b + 1):
            print('   ', lines[k][:160])
