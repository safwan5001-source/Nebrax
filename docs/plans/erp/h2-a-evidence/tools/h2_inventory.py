#!/usr/bin/env python3
"""AWJ-ERP-UI-H2 A1 — classify every web/src/app page.tsx (evidence tooling, not product code).

Usage: python3 h2_inventory.py <web/src/app> <H1 ROUTE-INVENTORY.md> <out.md> [crawl results.jsonl ...]
"""
import json, os, re, sys
from collections import defaultdict

MODULES = {
    'Sales': ['invoices', 'quotes', 'credit-notes', 'delivery-notes', 'recurring-invoices', 'payments', 'returns',
              'sales-settings', 'customer-refunds', 'delivery-hub', 'delivery-platforms', 'document-design'],
    'Customers': ['partners', 'contacts', 'crm', 'appointments', 'customer-settings'],
    'Purchases': ['purchases', 'purchase-orders', 'purchase-quotes', 'purchase-requests', 'purchase-returns', 'rfq',
                  'debit-notes', 'supplier-refunds', 'suppliers', 'supplier-payments', 'purchase-settings'],
    'Inventory': ['products', 'warehouses', 'stock-permits', 'stocktaking', 'inventory-openings', 'inventory-settings', 'inventory'],
    'Accounting': ['accounts', 'journal-entries', 'manual-journals', 'cost-centers', 'assets', 'accounting-settings', 'numbering-settings'],
    'Finance': ['expenses', 'receipt-vouchers', 'cash-and-bank', 'employee-custodies', 'finance-settings', 'payment-methods', 'financial-alerts'],
    'Reports': ['reports'],
    'HR': ['hr', 'users', 'roles'],
    'Settings & admin': ['settings', 'tax-settings', 'branches', 'applications', 'integrations', 'developer', 'notifications', 'help', 'whats-new'],
    'Dashboard': ['dashboard'],
    'Documents': ['documents'],
    'POS': ['pos'],
}
SEG2MOD = {seg: m for m, segs in MODULES.items() for seg in segs}

def classify(rel):
    parts = rel.split('/')
    group = parts[0] if parts[0].startswith('(') else None
    rest = parts[1:] if group else parts
    first = rest[0] if rest else ''
    if group == '(app)':
        mod, posture, gated = SEG2MOD.get(first, 'Unmapped'), ('Floor' if first == 'pos' else 'Ledger'), True
    elif group == '(pos)':
        mod, posture, gated = 'POS', 'Floor', True
    elif group == '(commerce)':
        mod, posture, gated = ('App Builder' if first == 'app-builder' else 'Commerce Admin'), ('Studio' if 'builder' in rest or first == 'app-builder' else 'Ledger'), True
    elif group == '(fuel)':
        mod, posture, gated = 'Fuel', 'O-14 (deferred)', False
    elif first == 'platform':
        mod, posture, gated = 'EXCLUDED: platform (AWJ-PLATFORM-UX)', '-', False
    elif first in ('dev', 'document-qa'):
        mod, posture, gated = 'EXCLUDED: internal dev/QA harness', '-', False
    elif first in ('login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'auth', 'me', ''):
        mod, posture, gated = 'Auth / self-service', 'gate-excluded', False
    else:
        mod, posture, gated = 'Unmapped', '?', False
    url = '/' + '/'.join(rest)
    url = re.sub(r'\[\[?\.\.\.[^\]]+\]?\]|\[[^\]]+\]', ':id', url).rstrip('/') or '/'
    return url, mod, posture, gated

def main():
    app, h1inv, out = sys.argv[1:4]
    crawls = sys.argv[4:]
    pages = []
    for root, _, files in os.walk(app):
        if 'page.tsx' in files:
            rel = os.path.relpath(root, app)
            pages.append('' if rel == '.' else rel)
    h1 = set(re.findall(r'^\| `([^`]+)` \|', open(h1inv, encoding='utf-8').read(), re.M))
    results = defaultdict(dict)
    for c in crawls:
        for line in open(c, encoding='utf-8'):
            if line.strip():
                r = json.loads(line); results[re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', ':id', r['route'])][r['cfg']] = r
    rows = sorted((classify(p) + (p,) for p in pages), key=lambda r: (r[1], r[0]))
    static_urls = {r[0] for r in rows if ':id' not in r[0]}
    by_mod = defaultdict(list)
    for r in rows: by_mod[r[1]].append(r)
    new = [r for r in rows if r[0] not in h1 and not r[1].startswith('EXCLUDED')]
    with open(out, 'w', encoding='utf-8') as f:
        f.write('# AWJ-ERP-UI-H2 A1 — Route inventory (generated)\n\n')
        f.write(f'`page.tsx` files: **{len(rows)}** · in H2 scope: **{sum(1 for r in rows if not r[1].startswith("EXCLUDED"))}** · '
                f'excluded with reason: **{sum(1 for r in rows if r[1].startswith("EXCLUDED"))}** · not in the H1 inventory: **{len(new)}**\n\n')
        f.write('| Module | Pages | v3-gated | Posture |\n|---|---|---|---|\n')
        for m, rs in sorted(by_mod.items()):
            f.write(f'| {m} | {len(rs)} | {sum(1 for r in rs if r[3])} | {", ".join(sorted({r[2] for r in rs}))} |\n')
        f.write('\n## Routes not present in the H1 inventory\n\n')
        for r in new: f.write(f'- `{r[0]}` ({r[1]})\n')
        f.write('\n## Every page\n\n| Route | Module | Posture | v3 gate | Source | Crawl (v3 ar-1440) |\n|---|---|---|---|---|---|\n')
        for url, mod, posture, gated, src in rows:
            c = results.get(url, {}).get('ar-light-1440')
            if not c and ':id' in url:  # template crawled through concrete paths (e.g. /reports/general/trial-balance)
                pat = re.compile('^' + re.escape(url).replace(':id', '[^/]+') + '$')
                hits = [k for k in results if pat.match(k) and k != url and k not in static_urls]
                if hits: c = dict(results[hits[0]].get('ar-light-1440') or {}); c['_n'] = len(hits)
            cell = 'NOT LOADED (no fixture)' if not c else f"HTTP {c.get('status')}" + (f" · axe {len(c.get('axe') or [])}" if c.get('axe') is not None else '') + ('' if c.get('ui') == '3' else ' · gate n/a') + (f" · via {c['_n']} concrete path(s)" if c.get('_n') else '')
            f.write(f'| `{url}` | {mod} | {posture} | {"yes" if gated else "no"} | `{src}/page.tsx` | {cell} |\n')

if __name__ == '__main__':
    main()
