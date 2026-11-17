"""Find co-occurrences of дальн*/далек* and печальн* within a window of N lines; mark line-end rhymes."""
import re, sys
W = 4
pat_d = re.compile(r'\b(дальн\w*|дал[её]к\w*|отдал[её]нн\w*)', re.I)
pat_p = re.compile(r'\bпечальн\w*', re.I)
for path in sys.argv[1:]:
    lines = open(path, encoding='utf-8').read().split('\n')
    title = ''
    titles = []
    for l in lines:
        if l.startswith('###'): title = l[4:]
        titles.append(title)
    hits = set()
    for i, l in enumerate(lines):
        if not pat_d.search(l) or 'дальнейш' in l.lower(): continue
        for j in range(max(0, i - W), min(len(lines), i + W + 1)):
            if pat_p.search(lines[j]): hits.add((min(i, j), max(i, j)))
    print(f"\n######## {path}: {len(hits)}")
    for a, b in sorted(hits):
        ends = [re.findall(r'\w+', lines[k].lower())[-1:] for k in (a, b)]
        rhyme = 'РИФМА ' if any(pat_d.match(e[0]) for e in ends if e) and any(pat_p.match(e[0]) for e in ends if e) else ''
        print(f"--- {rhyme}[{titles[a][:70]}] L{a+1}")
        for k in range(a, b + 1): print('   ', lines[k][:160])
