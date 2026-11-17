"""Extract poems from an FB2 file into plain text: one block per <poem>, with title."""
import re, sys, html
src, out = sys.argv[1], sys.argv[2]
x = open(src, encoding="utf-8").read()
body = x.split("<body", 1)[1]
body = re.sub(r'<body name="notes".*', '', body, flags=re.S)
res = []
for m in re.finditer(r'<section>(.*?)(?=<section>|</section>)', body, re.S):
    sec = m.group(1)
    t = re.search(r'<title>(.*?)</title>', sec, re.S)
    title = re.sub(r'<[^>]+>', ' ', t.group(1)).strip() if t else ''
    for p in re.finditer(r'<poem>(.*?)</poem>', sec, re.S):
        lines = [html.unescape(re.sub(r'<[^>]+>', '', v)).strip() for v in re.findall(r'<v>(.*?)</v>', p.group(1), re.S)]
        res.append(f"### {' '.join(title.split())}\n" + "\n".join(lines))
open(out, "w", encoding="utf-8").write("\n\n".join(res))
print(len(res), "poems")
