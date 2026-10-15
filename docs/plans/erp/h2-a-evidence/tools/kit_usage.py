#!/usr/bin/env python3
"""AWJ-ERP-UI-H2 A1 — static adoption of the shared UI kit per page (evidence tooling).
Traces each app/**/page.tsx and its local imports (2 levels) and records which shared patterns appear.
Usage: python3 kit_usage.py <web/src> <out.md>"""
import os, re, sys, json
from collections import defaultdict
SRC, OUT = sys.argv[1], sys.argv[2]
PAT = {
  'PageHeader': r'<PageHeader\b', 'ListToolbar': r'<ListToolbar\b', 'DataTable': r'<DataTable\b',
  'raw<table>': r'<table\b', 'ui/Table': r"from ['\"]@/components/ui/table['\"]", 'Pagination': r'<Pagination\b',
  'EmptyState': r'<EmptyState\b', 'ErrorState': r'<ErrorState\b', 'LoadingState': r'<LoadingState\b',
  'Skeleton': r'<Skeleton\b', 'FormPage': r'<FormPage\b', 'FormSection': r'<FormSection\b', 'DetailPage': r'<DetailPage\b',
  'ConfirmDialog': r'<ConfirmDialog\b', 'window.confirm': r'window\.confirm\(', 'MobileRecord': r'<MobileRecord\b',
  'DocumentWorkspace': r'DocumentWorkspace|data-awj-docws', 'rawHex': r'#[0-9a-fA-F]{6}\b', 'text<12px': r'text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]',
}
IMP = re.compile(r"""from\s+['"](@/[^'"]+|\.{1,2}/[^'"]+)['"]""")
def resolve(base, spec):
    p = os.path.join(SRC, spec[2:]) if spec.startswith('@/') else os.path.normpath(os.path.join(os.path.dirname(base), spec))
    for c in (p, p + '.tsx', p + '.ts', os.path.join(p, 'index.tsx'), os.path.join(p, 'index.ts')):
        if os.path.isfile(c): return c
def skip(f): return '/components/ui/' in f or '/components/nebrax/' in f or '/lib/' in f or f.endswith('data-table.tsx') or '.test.' in f
def trace(page, depth=2):
    seen, frontier = {page}, [page]
    for _ in range(depth):
        nxt = []
        for f in frontier:
            for spec in IMP.findall(open(f, encoding='utf-8').read()):
                r = resolve(f, spec)
                if r and r not in seen and not skip(r): seen.add(r); nxt.append(r)
        frontier = nxt
    return seen
rows = []
app = os.path.join(SRC, 'app')
for root, _, files in os.walk(app):
    top = os.path.relpath(root, app).split(os.sep)[0]
    if 'page.tsx' not in files or top in ('platform', 'dev', 'document-qa'): continue
    files_ = trace(os.path.join(root, 'page.tsx'))
    text = '\n'.join(open(f, encoding='utf-8').read() for f in files_)
    rel = os.path.relpath(root, app)
    rows.append((rel, {k: len(re.findall(v, text)) for k, v in PAT.items()}))
rows.sort()
tot = defaultdict(int)
for _, c in rows:
    for k, v in c.items(): tot[k] += 1 if v else 0
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('# AWJ-ERP-UI-H2 A1 — Shared UI kit adoption per page (static, generated)\n\n')
    f.write(f'Pages traced: **{len(rows)}** (each `page.tsx` + its local imports, 2 levels; shared kit files themselves excluded). Excludes `platform/`, `dev/`, `document-qa`.\n\n')
    f.write('| Pattern | Pages using it |\n|---|---|\n')
    for k in PAT: f.write(f'| `{k}` | {tot[k]} |\n')
    f.write('\n| Page | ' + ' | '.join(PAT) + ' |\n|' + '---|' * (len(PAT) + 1) + '\n')
    for rel, c in rows: f.write(f'| `{rel}` | ' + ' | '.join(str(c[k]) if c[k] else '' for k in PAT) + ' |\n')
json.dump(rows, open(OUT.replace('.md', '.json'), 'w'), ensure_ascii=False)
