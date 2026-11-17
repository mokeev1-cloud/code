"""Count hard-stem (дальный, через ы/о) vs soft-stem (дальний) forms per corpus file."""
import re, sys, collections
for p in sys.argv[1:]:
    t = open(p, encoding='utf-8').read().lower()
    c = collections.Counter(re.findall(r'(?<![а-яё])дальн[а-яё]*', t))
    hard = {k: v for k, v in c.items() if re.match(r'дальн(ый|ой|ая|ую|ое|ые|ых|ым|ыми|ою|ого|ому)$', k)}
    soft = {k: v for k, v in c.items() if re.match(r'дальн(ий|ей|яя|юю|ее|ие|их|им|ими|ею|его|ему)$', k)}
    print(p, '\n  hard', sum(hard.values()), hard, '\n  soft', sum(soft.values()), soft)
