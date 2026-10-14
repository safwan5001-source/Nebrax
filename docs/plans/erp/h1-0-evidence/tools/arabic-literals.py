import re, sys, os, collections
root = sys.argv[1]
AR = re.compile(r'[؀-ۿ]')
lit = re.compile(r"""(['"`])((?:(?!\1).)*?)\1""")
hits = collections.Counter(); samples = collections.defaultdict(list)
for dp, dn, fn in os.walk(root):
    if 'platform' in dp or '__tests__' in dp: continue
    for f in fn:
        if not f.endswith('.tsx') or '.test.' in f: continue
        p = os.path.join(dp, f)
        for i, line in enumerate(open(p, encoding='utf8'), 1):
            s = line.strip()
            if s.startswith(('//', '*', '/*', '{/*')): continue
            code = line.split('//')[0] if '://' not in line else line
            for m in lit.finditer(code):
                if AR.search(m.group(2)):
                    hits[p] += 1
                    if len(samples[p]) < 2: samples[p].append(f"{i}: {m.group(2)[:50]}")
            # JSX text nodes with Arabic
            for m in re.finditer(r'>([^<>{}]*[؀-ۿ][^<>{}]*)<', code):
                hits[p] += 1
                if len(samples[p]) < 2: samples[p].append(f"{i}: >{m.group(1).strip()[:50]}<")
print('files', len(hits), 'literals', sum(hits.values()))
for p, n in hits.most_common(40):
    print(n, p.replace(root, ''), '|', ' || '.join(samples[p]))
