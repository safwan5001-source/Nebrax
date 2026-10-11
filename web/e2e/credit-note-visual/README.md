# Credit-note print/PDF visual verification (AWJ-TAX-REM-02-PRINT-02)

QA tooling only — **nothing here is compiled into the app.** The files are plain `.mjs` / `.txt` / `.md`,
outside `web/src`, and are not picked up by Playwright's `testDir` (`*.spec.ts` only) or `tsc`.

| File | Purpose |
|---|---|
| `credit-note-qa-page.tsx.txt` | Template of an isolated page that renders the real `CreditNoteDocument` (no scaler, fixtures only). **Deliberately not a route in the repo** — a page under `src/app` would ship to production. |
| `capture.mjs` | Playwright/Chromium driver: 122 cases (A4 × 12 templates, thermal 80/58, saved layouts, ar + en), screenshots, DOM checks, browser-print PDF and the app's own PDF export. |
| `capture-a5.mjs` | Informational A5 render of the A4 template (AWJ has no A5 paper). |

Fixtures live in `web/src/modules/documents/qa/credit-note-qa-fixtures.ts` (already on `main`).

## Reproduce

```bash
cd web
mkdir -p src/app/document-qa/credit-note
cp e2e/credit-note-visual/credit-note-qa-page.tsx.txt src/app/document-qa/credit-note/page.tsx   # temporary — do NOT commit
npm run dev -- -p 3001                                                                           # another shell
node e2e/credit-note-visual/capture.mjs /tmp/credit-note-qa
python3 ../docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/oracle.py   # run inside the evidence dir with results.json/texts.json
rm -rf src/app/document-qa/credit-note                                                           # clean up
```

Results of the recorded run: `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/`.
