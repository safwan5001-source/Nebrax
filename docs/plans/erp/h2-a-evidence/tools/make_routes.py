#!/usr/bin/env python3
"""AWJ-ERP-UI-H2 A1 — build the crawl/probe route list for the CURRENT fixture (evidence tooling).

The template holds placeholders instead of record ids, because every fresh audit database gets new UUIDs:
  {C1} {S1} {P2} {B1} {I1} {PAY}   ids printed by `h1-0-evidence/tools/seed.sh` (customer, supplier, product, purchase, invoice, payment)
  {MAIN_BRANCH} {MAIN_WAREHOUSE}    main branch / main warehouse of tenant A (`GET /api/branches`, `GET /api/warehouses`)
  {JE1}                            journal entry of the posted invoice I1 (`GET /api/journal-entries`, source = I1)
Usage: python3 make_routes.py routes.template.json routes.json KEY=uuid ... (or @file with KEY=uuid tokens, e.g. seed.sh output)
Fails if any placeholder is left unresolved, so stale ids can never be crawled silently."""
import json, re, sys
tpl, out, args = sys.argv[1], sys.argv[2], sys.argv[3:]
ids = {}
for a in args:
    text = open(a[1:], encoding='utf-8').read() if a.startswith('@') else a
    ids.update(re.findall(r'\b([A-Z][A-Z0-9_]*)=([0-9a-f-]{36})\b', text))
routes = [re.sub(r'\{([A-Z0-9_]+)\}', lambda m: ids.get(m.group(1), m.group(0)), r) for r in json.load(open(tpl, encoding='utf-8'))]
left = sorted({m for r in routes for m in re.findall(r'\{([A-Z0-9_]+)\}', r)})
if left: sys.exit('make_routes: unresolved placeholders: ' + ', '.join(left))
json.dump(routes, open(out, 'w', encoding='utf-8'), indent=0, ensure_ascii=False)
print(f'{len(routes)} routes -> {out}')
