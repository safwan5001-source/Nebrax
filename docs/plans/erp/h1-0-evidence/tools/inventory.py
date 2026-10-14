#!/usr/bin/env python3
"""Route & module inventory from crawl JSONL (AWJ-ERP-UX-H1-0)."""
import json, sys, os, re, collections

base, out, skipped_file = sys.argv[1], sys.argv[2], sys.argv[3]
manifest_file = sys.argv[4] if len(sys.argv) > 4 else None
rows = []
for d in ['v3a', 'v3b', 'v3c', 'legacy']:
    p = os.path.join(base, d, 'results.jsonl')
    for line in open(p, encoding='utf8'):
        if line.strip():
            r = json.loads(line); r['_ui'] = 'legacy' if d == 'legacy' else 'v3'; rows.append(r)

def norm(x): return re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id', x)

GROUPS = [
    ('Sales', r'^/(invoices|quotes|credit-notes|returns|recurring-invoices|payments|customer-refunds|delivery-notes|delivery-hub|delivery-platforms|sales-settings)'),
    ('Customers', r'^/(partners|contacts|crm|appointments|customer-settings)'),
    ('Purchases', r'^/(purchases|purchase-|rfq|debit-notes|suppliers|supplier-)'),
    ('Inventory', r'^/(products|inventory|inventory-openings|inventory-settings|warehouses|stock-permits|stocktaking)'),
    ('Accounting', r'^/(accounts|journal-entries|manual-journals|assets|cost-centers|accounting-settings)'),
    ('Finance', r'^/(expenses|receipt-vouchers|cash-and-bank|employee-custodies|finance-settings|financial-alerts|payment-methods)'),
    ('HR', r'^/(hr)'),
    ('Reports', r'^/(reports)'),
    ('POS', r'^/(pos)'),
    ('Documents', r'^/(documents|document-design|document-qa)'),
    ('Settings & admin', r'^/(settings|tax-settings|numbering-settings|branches|applications|integrations|developer|notifications|help|whats-new|dashboard)'),
    ('Commerce / App Builder (separate posture)', r'^/(commerce|app-builder)'),
    ('Fuel stations (separate workspace)', r'^/(fuel-stations)'),
    ('Auth / self-service / dev', r'^/(login|register|forgot-password|reset-password|verify-email|auth|me|dev|_not-found|$)'),
]

def group(route):
    for g, rx in GROUPS:
        if re.match(rx, route):
            return g
    return 'Other'

by = collections.OrderedDict()
for r in rows:
    k = norm(r['route'])
    e = by.setdefault(k, {'cfgs': set(), 'h1': '', 'status': set(), 'final': set(), 'api': set(), 'axe': set(), 'ov320': 0, 'err': False})
    e['cfgs'].add(f"{r['_ui']}:{r['cfg']}")
    if r['cfg'] == 'ar-light-1440' and r['_ui'] == 'v3':
        e['h1'] = (r.get('h1Text') or '').replace('|', '/')
    e['status'].add(str(r.get('status')))
    e['final'].add(norm(r.get('finalPath') or ''))
    for f in r.get('failedApi') or []:
        e['api'].add(f.split(' ')[0])
    if r['_ui'] == 'v3':
        for v in r.get('axe') or []:
            e['axe'].add(v['id'])
    if r['cfg'] == 'ar-light-320':
        e['ov320'] = r.get('overflowX') or 0
    if r.get('errorState'):
        e['err'] = True

L = ['# AWJ-ERP-UX-H1-0 — Route & module inventory (generated from real-browser crawl)\n',
     'Columns: **Loads** = page loads across v3/legacy × locale × theme × width; **HTTP** = document status; **Redirect** = final path when it differs; **API ≥400** = status codes seen from `/api/*` during load; **axe (v3)** = rule ids on any v3 run; **ox@320** = page-level horizontal overflow at 320px (v3, AR light).\n']
counts = collections.Counter(group(k) for k in by)
L.append('| Module group | Routes crawled |\n|---|---|')
for g, _ in GROUPS + [('Other', '')]:
    if counts.get(g):
        L.append(f'| {g} | {counts[g]} |')
entries_line = ''
if manifest_file:
    manifest = [r for r in set(json.load(open(manifest_file)).values()) if not r.startswith(('/api', '/platform'))]
    statics = {r for r in manifest if '[' not in r}
    dynamics = [r for r in manifest if '[' in r]
    covered = set()
    for k in by:
        if k in statics:
            covered.add(k); continue
        for r in dynamics:
            if re.fullmatch(re.sub(r'\[[^\]]+\]', '[^/]+', r), k):
                covered.add(r); break
    entries_line = f' = **{len(covered)} of {len(manifest)}** manifest entries'
L.append(f'| **Total** | **{len(by)}** URLs{entries_line} |\n')
for g, _ in GROUPS + [('Other', '')]:
    ks = [k for k in by if group(k) == g]
    if not ks:
        continue
    L.append(f'\n## {g}\n')
    L.append('| Route | H1 (AR) | Loads | HTTP | Redirect | API ≥400 | axe (v3) | ox@320 | Visible error text |\n|---|---|---|---|---|---|---|---|---|')
    for k in sorted(ks):
        e = by[k]
        red = ', '.join(sorted(x for x in e['final'] if x != k)) or ''
        L.append(f"| `{k}` | {e['h1'][:40]} | {len(e['cfgs'])} | {'/'.join(sorted(e['status']))} | {red} | {', '.join(sorted(e['api']))} | {', '.join(sorted(x for x in e['axe']))} | {e['ov320']} | {'yes' if e['err'] else ''} |")
sk = json.load(open(skipped_file))
L.append('\n## Dynamic routes not crawled (no fixture record in the isolated test tenant)\n')
L.append('These routes exist in the build manifest but need a record the test tenant did not have. They are **NOT VERIFIED** in the browser by H1-0; their shared components were covered through sibling list/new routes.\n')
for s in sk:
    L.append(f'- `{s}`')
open(out, 'w', encoding='utf8').write('\n'.join(L) + '\n')
print('routes', len(by))
