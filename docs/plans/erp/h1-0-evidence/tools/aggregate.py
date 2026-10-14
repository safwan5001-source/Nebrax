#!/usr/bin/env python3
"""Aggregate crawler JSONL into Markdown evidence tables (AWJ-ERP-UX-H1-0)."""
import json, sys, collections, re, os

base = sys.argv[1]
out = sys.argv[2]
rows = []
for d in ['v3a', 'v3b', 'v3c', 'legacy']:
    p = os.path.join(base, d, 'results.jsonl')
    if not os.path.exists(p):
        continue
    for line in open(p, encoding='utf8'):
        if line.strip():
            r = json.loads(line)
            r['_set'] = d
            r['uiAttr'] = r.get('ui')
            r['ui'] = 'legacy' if d == 'legacy' else '3'
            rows.append(r)

def norm(route):
    return re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id', route)

L = []
w = L.append
w('# AWJ-ERP-UX-H1-0 — Crawl evidence (generated)\n')
w(f'Page loads recorded: **{len(rows)}**\n')
mism = [r for r in rows if (r['ui'] == '3') != (r['uiAttr'] == '3') and r['route'] not in ('/', '/login') and not r['route'].startswith(('/auth','/forgot','/register','/reset','/verify','/me','/dev','/document-qa','/fuel-stations'))]
w(f'Gate check: loads whose `data-awj-ui` attribute disagreed with the requested mode (excluding gate-excluded routes): **{len(mism)}** ' + ', '.join(sorted(set(norm(r['route']) for r in mism))[:20]) + '\n')
cnt = collections.Counter((r['ui'], r['cfg']) for r in rows)
w('| UI | Config | Loads |\n|---|---|---|')
for (ui, cfg), n in sorted(cnt.items()):
    w(f'| {ui} | {cfg} | {n} |')
w('')

# axe rules
w('## axe-core 4.10.2 violations (WCAG 2.0/2.1/2.2 A+AA + best-practice)\n')
w('| Rule | Impact | UI | Page loads affected | Distinct routes | Example route | Example node |\n|---|---|---|---|---|---|---|')
agg = {}
for r in rows:
    for v in (r.get('axe') or []):
        k = (v['id'], v['impact'], r['ui'])
        a = agg.setdefault(k, {'loads': 0, 'routes': set(), 'ex': (norm(r['route']), v.get('sample', ''))})
        a['loads'] += 1
        a['routes'].add(norm(r['route']))
for (rid, imp, ui), a in sorted(agg.items(), key=lambda x: (-x[1]['loads'])):
    w(f"| `{rid}` | {imp} | {ui} | {a['loads']} | {len(a['routes'])} | `{a['ex'][0]}` | `{(a['ex'][1] or '').replace('|', '/')[:90]}` |")
w('')

# per-rule route lists (excluding ubiquitous)
w('### Routes per axe rule (v3, excluding `aria-hidden-focus` which is shell-wide)\n')
per = collections.defaultdict(set)
for r in rows:
    if r['ui'] != '3':
        continue
    for v in (r.get('axe') or []):
        if v['id'] != 'aria-hidden-focus':
            per[v['id']].add(norm(r['route']))
for rid, rs in sorted(per.items(), key=lambda x: -len(x[1])):
    w(f"- **`{rid}`** ({len(rs)}): " + ', '.join(f'`{x}`' for x in sorted(rs)[:60]) + (' …' if len(rs) > 60 else ''))
w('')

# overflow
w('## Page-level horizontal overflow (documentElement.scrollWidth > clientWidth)\n')
w('| Route | Config | UI | Overflow px |\n|---|---|---|---|')
ov = sorted([r for r in rows if (r.get('overflowX') or 0) > 0], key=lambda r: (-r['overflowX']))
for r in ov:
    w(f"| `{norm(r['route'])}` | {r['cfg']} | {r['ui']} | {r['overflowX']} |")
w(f'\nTotal overflowing loads: {len(ov)} of {len(rows)}\n')

# failed API
w('## API responses >= 400 during page load\n')
fa = collections.defaultdict(set)
for r in rows:
    for f in r.get('failedApi') or []:
        fa[f].add(norm(r['route']))
w('| Response | Routes |\n|---|---|')
for f, rs in sorted(fa.items(), key=lambda x: -len(x[1])):
    w(f"| `{f}` | " + ', '.join(f'`{x}`' for x in sorted(rs)[:12]) + ' |')
w('')

# console errors
w('## Console errors / page errors\n')
ce = collections.defaultdict(set)
for r in rows:
    for e in r.get('consoleErrors') or []:
        key = re.sub(r'https?://\S+', '<url>', e)[:140]
        ce[key].add(norm(r['route']))
w('| Message (truncated) | Routes |\n|---|---|')
for e, rs in sorted(ce.items(), key=lambda x: -len(x[1]))[:40]:
    w(f"| `{e.replace('|', '/')}` | " + ', '.join(f'`{x}`' for x in sorted(rs)[:8]) + ' |')
w('')

# missing messages / raw keys
w('## i18n: missing messages, raw keys, Arabic UI chrome in English mode\n')
mm = collections.defaultdict(set)
for r in rows:
    for m in r.get('missingMessages') or []:
        mm[m].add(norm(r['route']))
    for k in r.get('rawKeys') or []:
        mm['RAW-KEY ' + k].add(norm(r['route']))
w('| Key | Routes |\n|---|---|')
for m, rs in sorted(mm.items(), key=lambda x: -len(x[1]))[:80]:
    w(f"| `{m}` | " + ', '.join(f'`{x}`' for x in sorted(rs)[:8]) + ' |')
w('')
w('### Arabic text in UI chrome (th/label/button/h1-h3/tab/nav/option) while locale = en\n')
w('| Route | Config | Count | Samples |\n|---|---|---|---|')
en = [r for r in rows if r['cfg'].startswith('en') and (r.get('arabicChromeN') or 0) > 0]
seen = set()
for r in sorted(en, key=lambda r: -r['arabicChromeN']):
    k = norm(r['route'])
    if k in seen:
        continue
    seen.add(k)
    samples = '; '.join(s.replace('|', '/')[:30] for s in r['arabicChrome'][:5])
    w(f"| `{k}` | {r['cfg']} | {r['arabicChromeN']} | {samples} |")
w(f'\nRoutes with Arabic chrome in EN: {len(seen)}\n')

# headings / landmarks
w('## Structure: h1 count, heading skips, main landmark\n')
w('| Route | Config | h1 | main | heading skips | h1 text |\n|---|---|---|---|---|---|')
for r in rows:
    if r['cfg'] != 'ar-light-1440' or r['ui'] != '3':
        continue
    if r.get('h1') != 1 or r.get('main') != 1:
        w(f"| `{norm(r['route'])}` | {r['cfg']} | {r.get('h1')} | {r.get('main')} | {r.get('headingSkips')} | {(r.get('h1Text') or '').replace('|', '/')} |")
w('')

# touch targets
w('## Targets smaller than 24×24 CSS px at 390px (v3, ar-light-390)\n')
w('| Route | Count | Samples |\n|---|---|---|')
for r in sorted([r for r in rows if r['cfg'] == 'ar-light-390' and r['ui'] == '3' and (r.get('small') or 0) > 0], key=lambda r: -r['small']):
    w(f"| `{norm(r['route'])}` | {r['small']} | {'; '.join(s.replace('|', '/') for s in r.get('smallSamples') or [])[:100]} |")
w('')

# redirects / error states
w('## Redirects, non-200 and visible error states\n')
w('| Route | Config | UI | HTTP | Final path | Error-text detected | navErr |\n|---|---|---|---|---|---|---|')
for r in rows:
    if r['cfg'] not in ('ar-light-1440',):
        continue
    if r.get('status') != 200 or norm(r.get('finalPath') or '') != norm(r['route']) or r.get('errorState') or r.get('navErr'):
        w(f"| `{norm(r['route'])}` | {r['cfg']} | {r['ui']} | {r.get('status')} | `{norm(r.get('finalPath') or '')}` | {r.get('errorState')} | {r.get('navErr') or ''} |")
w('')

# load time
w('## Time to DOMContentLoaded + network idle (capped 4–12 s; ar-light-1440, v3)\n')
lt = sorted([r for r in rows if r['cfg'] == 'ar-light-1440' and r['ui'] == '3'], key=lambda r: -r['loadMs'])
w('| Route | ms |\n|---|---|')
for r in lt[:25]:
    w(f"| `{norm(r['route'])}` | {r['loadMs']} |")
w('')
open(out, 'w', encoding='utf8').write('\n'.join(L))
print('wrote', out, len(rows))
