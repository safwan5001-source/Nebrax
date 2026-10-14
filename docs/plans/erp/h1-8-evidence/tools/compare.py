#!/usr/bin/env python3
"""H1-8: compare the H1-0 baseline crawl with the final-main crawl, per config (same routes, same metrics)."""
import json, sys, os, collections, re
base = sys.argv[1]
def load(dirs, ui):
    # A missing or empty crawl must abort: zero rows would read as a clean result.
    rows = []
    for d in dirs:
        p = os.path.join(base, d, 'results.jsonl')
        if not os.path.isfile(p):
            sys.exit(f'compare.py: required crawl result missing: {p}')
        found = 0
        for l in open(p, encoding='utf8'):
            if l.strip():
                r = json.loads(l); r['_ui'] = ui; rows.append(r); found += 1
        if not found:
            sys.exit(f'compare.py: required crawl result has no records: {p}')
    return rows
def norm(route): return re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id', route)
before = load(['v3a', 'v3b', 'v3c'], '3') + load(['legacy'], 'legacy')
after = load(['final-v3'], '3') + load(['final-legacy'], 'legacy')
staff = load(['final-staff'], 'staff')
CFGS = [('3', 'ar-light-1440'), ('3', 'en-dark-1440'), ('3', 'ar-light-390'), ('3', 'ar-light-320'), ('legacy', 'ar-light-1440')]
def summary(rows, ui, cfg):
    rs = [r for r in rows if r['_ui'] == ui and r['cfg'] == cfg and not r.get('navErr')]
    routes = {norm(r['route']) for r in rs}
    s = {'loads': len(rs)}
    s['overflow'] = sum(1 for r in rs if (r.get('overflowX') or 0) > 0)
    s['h1!=1'] = sum(1 for r in rs if r.get('h1') != 1)
    s['headingSkips'] = sum(1 for r in rs if (r.get('headingSkips') or 0) > 0)
    s['consoleErr'] = sum(1 for r in rs if r.get('consoleErrors'))
    s['missingMsg'] = sum(1 for r in rs if r.get('missingMessages'))
    s['rawKeys'] = sum(1 for r in rs if r.get('rawKeys'))
    s['unnamed'] = sum(r.get('unnamed') or 0 for r in rs)
    rules = collections.Counter(); nodes = collections.Counter()
    for r in rs:
        for a in r.get('axe') or []:
            rules[a['id']] += 1; nodes[a['id']] += a.get('n', 1)
    return s, rules, nodes, routes
out = []
allrules = set()
data = {}
for ui, cfg in CFGS:
    b = summary(before, ui, cfg); a = summary(after, ui, cfg)
    data[(ui, cfg)] = (b, a); allrules |= set(b[1]) | set(a[1])
out.append('| Metric (routes affected) | ' + ' | '.join(f'{("v3" if u=="3" else "legacy")} {c} before → after' for u, c in CFGS) + ' |')
out.append('|---|' + '---|' * len(CFGS))
for k in ['loads', 'overflow', 'h1!=1', 'headingSkips', 'consoleErr', 'missingMsg', 'rawKeys']:
    out.append(f'| {k} | ' + ' | '.join(f"{data[x][0][0][k]} → **{data[x][1][0][k]}**" for x in CFGS) + ' |')
for rule in sorted(allrules, key=lambda r: (-sum(data[x][0][1][r] for x in CFGS), r)):  # name breaks ties: stable output
    out.append(f'| axe `{rule}` | ' + ' | '.join(f"{data[x][0][1][rule]} → **{data[x][1][1][rule]}**" for x in CFGS) + ' |')
print('\n'.join(out))
# residual detail on final
print('\n### Residual axe findings on final main (route list)\n')
res = collections.defaultdict(set)
for r in after:
    for a in r.get('axe') or []: res[a['id']].add(f"{norm(r['route'])} ({'v3' if r['_ui']=='3' else 'legacy'} {r['cfg']})")
for k, v in sorted(res.items(), key=lambda x: (-len(x[1]), x[0])):
    print(f'- `{k}` ({len(v)}): ' + ', '.join(sorted(v)[:12]) + (' …' if len(v) > 12 else ''))
if staff:
    s = summary(staff, 'staff', 'ar-light-1440')[0]
    rr = collections.Counter(a['id'] for r in staff for a in (r.get('axe') or []))
    st = collections.Counter(r.get('status') for r in staff)
    err = sum(1 for r in staff if r.get('errorState'))
    print('\n### Restricted role (staff) — v3 ar-light-1440\n')
    print(f"- loads {s['loads']}, overflow {s['overflow']}, h1≠1 {s['h1!=1']}, console errors {s['consoleErr']}, missing messages {s['missingMsg']}, raw keys {s['rawKeys']}, pages in an error state {err}")
    print('- axe rules: ' + (', '.join(f'`{k}` {v}' for k, v in rr.most_common()) or 'none'))
    fa = collections.Counter(x.split(' ')[0] for r in staff for x in (r.get('failedApi') or []))
    print('- failed API statuses seen: ' + (', '.join(f'{k} ×{v}' for k, v in fa.most_common(6)) or 'none'))
