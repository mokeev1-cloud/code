"""Convert downloaded rvb.ru Pushkin pages into one plain-text file, page order = volume TOC order.
Each text: '### <path> | <title>' then lines."""
import re, sys, html, os
root, out = sys.argv[1], sys.argv[2]
order = []
for v in range(1, 11):
    toc = open(f"{root}/toc/tocvol{v}.htm", encoding="utf-8").read()
    for h in re.findall(r'href="(0[^"#]+\.htm)', toc):
        if h not in order: order.append((v, h))
seen, res = set(), []
for v, h in order:
    if h in seen or not os.path.exists(f"{root}/{h}"): continue
    seen.add(h)
    x = open(f"{root}/{h}", encoding="utf-8").read()
    m = re.search(r'<!-- Content goes here(.*?)<!-- Начало нижней навигации', x, re.S)
    if not m: continue
    c = m.group(1)
    c = re.sub(r'<div class="page"[^>]*>.*?</div>', '', c)
    c = re.sub(r'<sup.*?</sup>', '', c, flags=re.S)
    c = re.sub(r'<br\s*/?>|</p>|</h\d>|</div>', '\n', c)
    c = html.unescape(re.sub(r'<[^>]+>', '', c))
    c = c.replace('-->', '')
    lines = [l.strip() for l in c.split('\n')]
    txt = '\n'.join(l for l in lines if l)
    title = next((l for l in txt.split('\n') if l.strip('=* .')), '')[:80]
    res.append(f"### т.{v} {h} | {title}\n{txt}")
open(out, "w", encoding="utf-8").write("\n\n".join(res))
print(len(res), "texts")
