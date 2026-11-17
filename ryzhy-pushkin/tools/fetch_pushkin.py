"""Download A.S. Pushkin, Collected works in 10 vols (GIHL 1959-62) from rvb.ru into corpus/pushkin/html/."""
import os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
BASE = "https://rvb.ru/pushkin/"
OUT = sys.argv[1]
def get(url):
    for i in range(4):
        try:
            return urllib.request.urlopen(url, timeout=60).read()
        except Exception as e:
            time.sleep(2 ** i)
    print("FAIL", url, file=sys.stderr); return None
links = []
for v in range(1, 11):
    toc = get(f"{BASE}tocvol{v}.htm").decode("cp1251", "replace")
    os.makedirs(f"{OUT}/toc", exist_ok=True)
    open(f"{OUT}/toc/tocvol{v}.htm", "w", encoding="utf-8").write(toc)
    for h in re.findall(r'href="(0[^"#]+\.htm)', toc):
        if h not in links: links.append(h)
print(len(links), "pages")
def dl(h):
    p = f"{OUT}/{h}"
    if os.path.exists(p): return
    b = get(BASE + h)
    if b is None: return
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(b.decode("cp1251", "replace"))
with ThreadPoolExecutor(6) as ex: list(ex.map(dl, links))
print("done")
