# AWJ-TAX-REM-02-PRINT-02 — Credit Note Print/PDF Visual Verification & Release Gate

| | |
|---|---|
| **Scope** | Real-browser verification of credit-note print/PDF (PR #1315, now merged; originally stacked on #1304). Not a repeat of the implementation audit. This file is the deliverable of PR #1320, which now carries **only** this report and its QA evidence/tooling (§12). |
| **Method** | Real **Chromium 141 (Playwright)** rendering the actual `<CreditNoteDocument>` → `DocumentView` → templates, with the real Arabic web font (IBM Plex Sans Arabic, loaded in all 122 cases), real cookie-driven `ar`/`en` locale, browser print-to-PDF with the same `@page` injection as `printDocument`, and the app's own `documentExporter.download` (html2canvas + jsPDF) for PDF. 122 cases × screenshot + DOM checks (clipping, overflow, cell overlap, mid-word header breaks) + an independent equation oracle over the rendered text. |
| **Result** | **1 blocking defect found in #1315 (thermal), fixed in #1315 and re-verified.** All 122 cases now reconcile to the halala. A5 is **not a supported AWJ paper** (§3). **Recommendation: READY — conditional** (§11). |
| **Not done** | No merge, no deploy, no migration, no accounting/tax/posted-value change, no change to #1304, no Codex re-review requested. |

> **Post-merge update.** #1304 was squash-merged to `main` as `56fcac62…`; **#1315 was squash-merged to `main` as `3209fcb77cc4e02b729bb74c34adf7e131869a1b`** (final PR head `8615b3e9…`, CI 5/5 success, `mergeable_state: clean`, 23 web-only files). The fixes this report found (thermal discount row / real VAT rate / rounding note, saved-layout note, header widths) are therefore **on `main`**. What remains in *this* PR is docs/QA only: the report, the evidence, the isolated `/document-qa/credit-note` route and the capture scripts. Its branch was cleaned up by merging `main` (no history rewrite); the "merge order" in §11 is now historical — #1304 → #1315 are done, this PR is optional. SHAs quoted below are as of the verification run.

---

## 1. PR and SHA status (re-fetched at start of this task)

| | #1304 — Credit Note VAT Accuracy | #1315 — Print/PDF Reconciliation |
|---|---|---|
| State | open, not draft, not merged | open, not draft, not merged |
| Head SHA | `2c82b01afbc8f2a5fb4ea9d01509c9fe1776eda9` (unchanged) | **start of task** `1287f514a88f2d482e1eb6d309002e2d2a8b5d5f` → **now** `b3adda190da55e250d7940d436d9cd97e9f3af7b` (this task's fix commit) |
| Base | `main` @ `bdecbd01…` (main is now `eae4bd7c…`) | `claude/awj-tax-rem-02-credit-note-vat` (= #1304) @ `2c82b01…` |
| Mergeability | API says `unknown` (not recomputed since `main` moved). **I verified with `git merge-tree`: #1304 merges into current `main` with no conflicts.** | `clean` |
| CI | all 5 runs `success` on its head (web build, PHP sqlite, PHP pgsql) | start of task: 6/6 `success` on `1287f51`. On `b3adda1`: **6/6 `success`** (web build + `npm run test`, PHP sqlite, PHP pgsql — both workflow runs; completed 15:16 UTC), `mergeable_state: clean` |

**Important:** the earlier green CI on `1287f51` did **not** prove the print output was correct — the thermal defect below was present and CI cannot see it. The PRINT-01 report's statement that thermal "consumes the one model built by this builder" was true but incomplete: the thermal receipt is a separate template with no discount row (§5, F1). This report supersedes that statement.

Reports/notes read: `AWJ-TAX-REM-02-IMPLEMENTATION-REPORT.md`, `AWJ-TAX-REM-02-PRINT-01-IMPLEMENTATION-REPORT.md`, `docs/audits/AWJ-TAX-REM-02-PRINT-AMOUNTS-NOTE.md`.

## 2. How the rendering was produced (reproducible)

* QA page (isolated, fixtures only): a template at `web/e2e/credit-note-visual/credit-note-qa-page.tsx.txt` — renders the **real** `CreditNoteDocument` with no scaler so `#print-root` is captured at natural size. **It is deliberately not a route in the repo** (a page under `src/app` would be shipped to production); to reproduce, copy it temporarily to `src/app/document-qa/credit-note/page.tsx` as described in `web/e2e/credit-note-visual/README.md`. The recorded run used a byte-identical copy of this file (`git mv`, 100 % rename). Fixtures: `web/src/modules/documents/qa/credit-note-qa-fixtures.ts` (API-shaped payloads from stored halala amounts; the 10 requested scenarios + long names + 28 lines).
* Driver: `web/e2e/credit-note-visual/capture.mjs` (`cd web && npm run dev -- -p 3001`, then `node e2e/credit-note-visual/capture.mjs <outDir>`); A5 informational: `capture-a5.mjs`.
* Oracle: `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/oracle.py` (reads `results.json`/`texts.json`; checks every row `net + VAT = total`, Σ rows = grand total, totals identity `subtotal − discount + VAT = total`, thermal totals parsed from rendered text, saved-layout note presence, header-word overflow).
* Evidence: `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/` — **137 curated screenshots (8 MB)**; `results.json` covers all 122 cases (images are a curated subset: all A4 default, A4 compositions for the discount case, all saved-layout, all thermal, app-PDF pages, A5, before-fix). Browser-print/app PDFs (85 MB) are not committed; page counts are in `results.json`.

## 3. Verification matrix — paper × language

Classification: **PASS** = verified in actual rendering · **FAIL** = demonstrated incorrect output · **NOT VERIFIED** = insufficient evidence.

| Format | Arabic RTL | English LTR | Evidence |
|---|---|---|---|
| **A4** (default layout, 11 scenarios) | **PASS** | **PASS** | `a4/` (22) |
| **A4**, 11 other template compositions (discounted note) | **PASS** | **PASS** | `a4-compositions/` (22) |
| **A4**, saved/custom layouts (12 cases) | **PASS** (after note fix; **FAIL-class before** — §6) | **PASS** (same) | `saved-layout/` (12), `before-fix/` |
| **Thermal 80 mm** (11 scenarios) | **PASS** after fix · **FAIL before** (F1, F2) | **PASS** after fix · **FAIL before** | `thermal-80/` (22), `before-fix/` |
| **Thermal 58 mm** (11 scenarios) | **PASS** after fix · **FAIL before** | **PASS** after fix · **FAIL before** | `thermal-58/` (22), `before-fix/` |
| **A5** | **NOT VERIFIED — unsupported paper** | **NOT VERIFIED — unsupported paper** | informational only: `a5-informational/` (8) |
| In-app PDF (html2canvas/jsPDF) A4, thermal 80/58 | **PASS** (figures identical to on-screen; one pre-existing blank trailing page, F6) | **PASS** | `app-pdf/` (22 page images) |
| Browser print-to-PDF | **PASS** for A4 (1 page; 3 for 28 lines) and thermal content; real thermal driver / roll length **NOT VERIFIED** (F10) | same | `results.json` (`printPages`) |

**A5:** AWJ has **no A5 paper**: `PAPER_SIZES` (`web/src/modules/documents/constants/paper.ts`) is `a4 · a4_landscape · letter · legal · thermal_58 · thermal_80`, and no template lists A5 in `supportedPaper`. There is therefore no product behaviour to verify; I will not mark it passed. Informational render (A4 template sent to 148×210 mm): unscaled it reflows and the figures reconcile (the customer/seller tax-number cards wrap digit-wise — pre-existing party-card layout, outside this change); "fit to page" is legible and reconciles. **Owner: confirm A5 is out of scope.**

## 4. Financial reconciliation (rendered figures, ar = en)

Every case below was produced by the browser and read back from the DOM; for each, rows satisfy `net + VAT = total`, Σ row totals = grand total, and `subtotal − discount + VAT = total`. Arabic and English figures are identical (asserted per scenario).

**A4 classic, default columns** (`qty · price before tax · discount · net · rate · VAT · total`):

| # | Scenario | Row(s) | Totals: subtotal · discount · VAT · total |
|---|---|---|---|
| 1 | VAT-inclusive 115.00 | 1 · 100.00 · 0.00 · 100.00 · 15% · 15.00 · 115.00 | 100.00 · — · 15.00 · 115.00 |
| 2 | VAT-exclusive | 2 · 50.00 · 0.00 · 100.00 · 15% · 15.00 · 115.00 | 100.00 · — · 15.00 · 115.00 |
| 3 | Line discount | 1 · 100.00 · **20.00** · 80.00 · 15% · 12.00 · **92.00** | 100.00 · **20.00** · 12.00 · 92.00 |
| 4 | Header discount over 3 lines | 100.00/8.75→91.25→13.69→104.94 · 50.00×2/8.75→91.25→13.69→104.94 · 200.00/17.50→182.50→27.38→209.88 | 400.00 · 35.00 · 54.76 · 419.76 |
| 5 | Qty 7, halala rounding | 7 · 0.09 · 0.00 · **0.61** · 15% · 0.09 · 0.70 **+ footnote** (unit price rounded for display) | 0.61 · — · 0.09 · 0.70 |
| 6 | VAT 5 % | 1 · 100.00 · 0.00 · 100.00 · **5%** · 5.00 · 105.00 | 100.00 · — · 5.00 · 105.00, label **"VAT (5%)" / "(5%)"** |
| 7 | Mixed rates 15 % / 0 % | 15%: 15.00→115.00 · 0%: 0.00→100.00 | 200.00 · — · 15.00 · 215.00, label **"VAT"** (no percentage) |
| 8 | Partial note (2 of 3 units) | 2 · 100.00 · 0.00 · 200.00 · 15% · 30.00 · 230.00 | 200.00 · — · 30.00 · 230.00 |
| 9 | Historical (no new fields) | 2 · **—** · **—** · 100.00 · **—** · 15.00 · 115.00 | 100.00 · — · 15.00 · 115.00, original label "(15%)" |
| 10 | Saved/custom layouts | see §6 | document totals identical to the default layout |

**Thermal 58 and 80 mm** (after fix; identical on both widths and both languages): totals `100.00 · 20.00 · 12.00 · 92.00` (scenario 3), `400.00 · 35.00 · 54.76 · 419.76` (4), `0.61 · 0.09 · 0.70` + note (5), `VAT (5%)` (6), `VAT` (7), `100.00 · 15.00 · 115.00` (9). Full list in `results.json` / `oracle.py` output.

**Oracle result on the final code: 122 / 122 cases satisfy every financial identity** (66 A4-default, 44 thermal, 12 saved-layout). **Before the fix: 16 / 44 thermal cases failed** (the four discount-bearing scenarios × 80/58 mm × ar/en) and **8 / 12 saved-layout cases left discounted rows unexplained**.

## 5. Findings

### Blocking (found, fixed inside #1315, re-verified)

| ID | Finding | Evidence |
|---|---|---|
| **F1 — FAIL → fixed** | **Thermal 58/80 mm printed a discounted credit note that does not add up.** Line-discount note rendered `Subtotal 100.00 · VAT 12.00 · Total 92.00` (100 + 12 ≠ 92) with no discount row; header-discount note `400.00 · 54.76 · 419.76`. **Regression introduced by #1315 itself:** before PRINT-01 the subtotal was the posted net (80.00 + 12.00 = 92.00 reconciled); PRINT-01 made the subtotal pre-discount and added the discount row only to the A4 totals block — `ThermalReceipt` has its own totals and no discount row. | `before-fix/thermal_80…line_discount__ar.jpg`, `…__en.jpg`, `thermal_58…header_discount__ar.jpg` (before) vs `thermal-80/…line_discount__ar.jpg`, `thermal-58/…header_discount__en.jpg` (after) |
| **F2 — FAIL → fixed** | **Thermal VAT label hard-coded "(15%)"**: a 5 % note and a mixed 15 %/0 % note both printed `VAT (15%)` (PRINT-01 fixed this only in the A4 totals block). | `results-before-fix.json`; after: `VAT (5%)` / `VAT` |

*Root cause:* `web/src/modules/documents/templates/thermal-receipt.tsx` renders its own totals (`subtotal / VAT / total`) and ignores `totals.discount` and `totals.taxRate`. *Smallest safe fix (implemented):* three additions mirroring the A4 `DocTotals` contract — a discount row when `totals.discount > 0` (same `purchaseForm.discount` label), `applyVatRateToLabel(t('vat'), totals.taxRate)`, and the unit-price rounding footnote. No new field, no contract change, no accounting change. *Files:* `thermal-receipt.tsx` only (+ tests). *Compatibility:* a document with `totals.discount > 0` printed on thermal now shows a discount row. Credit notes are the target. **Tax invoices with a header discount printed on thermal were already affected by the same gap** (invoice `subtotal` is pre-discount: `total = subtotal − discount + VAT`), so this also corrects them — strictly additive, nothing else on those receipts changes. **Owner: this is the one behavioural effect outside credit notes; flag if you want it gated by document type instead.**

### Fixed non-blocking (presentation)

| ID | Finding | Fix |
|---|---|---|
| **F3** | **Saved/custom layouts without the discount column** (explicit `columns`, e.g. `# · description · qty · unit price · tax · total`): a discounted row reads `100.00 + 13.69 ≠ 104.94` (header-discount case) — individually correct amounts, but the row equation is misleading; the totals block does reconcile (`400.00 − 35.00 + 54.76 = 419.76`). Not a regression (PRINT-01 improved the totals), but unexplained. | `DocItemsTable` now prints a one-line note — *"Unit prices are before discount and line totals are after discount; the discount is itemised in the totals summary"* (ar/en) — **only** when a line is discounted **and** the layout lacks the discount column. Silent otherwise (asserted: default layout, undiscounted note, invoices). |
| **F4** | New-column headers broke **mid-word**: "نسبة الضريبة" → "الضري/بة" (`quotation-proposal`, same 5 % width in `retail-v2`/`purchase-order-formal`); "Discount" → "Discou/nt" (`quotation-proposal`, `minimal-v2`); "نسبة الضريبة" (`minimal-v2`). | Widths of **my new columns only** raised (VAT-rate 5→6 %; `minimal-v2` 9/7/7; `quotation-proposal` discount 8). Pre-existing column widths and the 100 % width-sum guards untouched. Verified by an exact per-word header measurement (the first canvas-based check had false negatives, replaced). |

### Deferred (non-blocking; cosmetic or pre-existing, no effect on financial interpretation)

| ID | Finding | Status |
|---|---|---|
| F5 | `minimal-v2`: existing **Qty / الكمية** header splits mid-word. A plain tax invoice (untouched by these PRs) in the same template shows the same and more (Barcode, Product, الباركود, الوحدة, الكمية, الضريبة). Shared pre-existing column width. | deferred; pre-existing |
| F6 | **In-app PDF export adds a blank trailing page** when content nearly fills N pages (28-line note: 3 pages, last 0.0 % non-white). A plain tax invoice gives the same (6 pages for 4,397 px; 9 for 8,147 px). Exporter slicing in `lib/pdf.ts`; not credit-note specific. | deferred; pre-existing |
| F7 | **Wording on credit notes (all papers):** default footer "This is an electronic invoice issued per ZATCA…" and thermal labels "Invoice no." / "Bill to" (ar: "رقم الفاتورة" / "فاتورة إلى"). REM-02 states notes are **not** ZATCA e-invoiced (REM-18), so the footer is a compliance statement that is not true for notes. Not an amount; pre-existing default text. | **owner decision** — recommend a follow-up to give credit notes their own footer/labels |
| F8 | Thermal truncates long descriptions with an ellipsis (`truncate`); in Arabic mode an English name is cut from its start (`…ystem including…`). Pre-existing for all thermal documents. | deferred; pre-existing |
| F9 | Arabic A4 (classic): the "ريال" unit wraps under the number in narrow columns (Discount/VAT/Total). Readable. | cosmetic |
| F10 | Browser print with `@page { size: 80mm auto }`: headless `page.pdf` ignored `auto` height (2 pages for 28 lines); the in-app thermal PDF is one tall page (verified). **Real thermal printer / driver / roll length: NOT VERIFIED** (no device). | NOT VERIFIED |
| F11 | In-app PDFs are raster (html2canvas): ~4–6 MB per A4 page (85 MB for the 22 PDFs). No effect on figures; relevant for e-mailing. | pre-existing |

## 6. Saved / frozen layout compatibility (determination)

Type defaults are *fallbacks*: a tenant layout (or a frozen revision on a posted note) with explicit `columns` keeps exactly those columns, so these tenants do **not** get the new columns. Rendered with `# · description · qty · unit price · tax · total` and `# · description · qty · price-before-tax · tax · total`, in ar and en:

| Case | Row-level | Document-level | Misleading? |
|---|---|---|---|
| Discounted line, layout **without** discount column | `100.00 + 12.00 ≠ 92.00` (discount invisible) | `100.00 − 20.00 + 12.00 = 92.00` ✓ | **Yes at row level** — same as before PRINT-01 (not a regression; the totals are now better). **Mitigated by F3 note.** |
| Header discount, layout without discount column | `100.00 + 13.69 ≠ 104.94` | `400.00 − 35.00 + 54.76 = 419.76` ✓ | same; mitigated by F3 note |
| Undiscounted / rounding / historical notes | reconcile | reconcile | No |

A saved layout that omits a necessary financial column therefore **can** show a misleading row equation for discounted lines; after F3 it is explained on the document, and the totals block always carries the discount. Making the discount columns *selectable in saved layouts* needs the shared contract (`DOCUMENT_ITEMS_COLUMN_IDS` + `PrintTemplateContract::ITEM_COLUMNS` in PHP + editor list) — **not done; requires owner approval** (PRINT-01 §10-1).

## 7. Layout checks

| Check | Result |
|---|---|
| Column alignment | PASS — numeric columns end-aligned, `ltr` numbers inside RTL. Inspected visually: all 12 compositions in Arabic (`a4-compositions/`; the 8 not individually opened earlier were reviewed on a contact sheet — header, row and totals intact, no overlap) and classic / retail-v2 / quotation-proposal / minimal-v2 in English; the other English renders are covered by the automated checks below. |
| Arabic / English number readability | PASS — Latin digits, monospaced, identical in both languages; "(%15)" bidi rendering of "(15%)" in RTL is standard. |
| Text clipping / overlap / horizontal overflow | PASS — 0 clipped cells, 0 elements outside the root, 0 cell overlaps across 122 cases. |
| Totals placement | PASS — totals block under the table, discount row between subtotal and VAT. |
| Discount visibility | PASS — row column + totals row (A4 default); totals row (thermal, after F1); note (saved layouts, after F3). |
| VAT labels | PASS after F2 — 5 % → "(5%)", mixed → none, historical → original "(15%)". |
| Page breaks | PASS — 28-line A4: 3 print pages / 3 app-PDF pages (rows not cut; last app-PDF page blank = F6). |
| Thermal column widths | PASS — 58 mm and 80 mm single-column, no overflow; long names truncate (F8). |
| Long Arabic item names | PASS — wrap to 3 lines on A4, truncate on thermal. |
| Print/PDF consistency | PASS — app-PDF page images match the on-screen render (viewed A4 ar/en and thermal 80, incl. discount row). |
| Existing saved/frozen templates | §6. |

## 8. Tests and CI

| Run | Result |
|---|---|
| New regression tests (21): thermal 58/80 × ar/en — discount row & identity, header discount, 5 % label, rounding note; saved-layout note (shown / silent); width guard | pass; **17 fail with the fixes reverted** (mutation-checked) |
| Isolated committed state (`documents`, `design`, `credit-notes`, `invoices`, `print-templates`) | 58 files / 585 tests pass |
| Full web suite (`npm test`) on final code | **467 files / 4,675 tests pass** (includes the 21 new tests) |
| `npm run build` on final code | **passes** |
| `tsc --noEmit` | 0 new errors vs. baseline |
| Drift ratchet (`src/design`) | caught `bg-white` in my first QA page; fixed (passes) |
| CI #1315 @ `b3adda1` | **6/6 `success`** (web build + tests, PHP sqlite, PHP pgsql; both runs; verified after completion) |
| CI #1304 @ `2c82b01` | 5/5 success (unchanged) |

## 9. Changes made in this task

* **#1315 (commit `b3adda1`, presentation only):** `templates/thermal-receipt.tsx`, `components/sections/doc-items-table.tsx`, widths in `presentation/{minimal-v2,quotation-proposal,retail-v2,purchase-order-formal}.ts`, 1 message key (ar/en), `qa/credit-note-qa-fixtures.ts` (test fixtures), `document-credit-note-print02.test.tsx`.
* **Evidence PR #1320 (docs/QA only, base `main`):** this report, `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/`, and the QA tooling under `web/e2e/credit-note-visual/` (capture scripts, README, page template). See §12 for the exact inventory and scope proof.
* **Not touched:** #1304, any PHP, migrations, tax/ledger/return/POS/invoice-posting code, ZATCA, `PrintTemplateContract.php`, posted values.

## 10. Remaining risks

1. Physical thermal printer / driver / roll behaviour not verified (F10); A5 unsupported (§3).
2. Tenants with saved layouts that omit the discount column still show a row-level equation that only the note and the totals explain (§6); selectable columns need the shared contract (owner approval).
3. F1 changes thermal output for **invoices with a header discount** (adds the missing row) — flagged above.
4. F7 (ZATCA footer / invoice labels on credit notes) is a pre-existing compliance wording issue for the owner.
5. `minimal-v2` header splits (F5) and the blank trailing PDF page (F6) are pre-existing and shared with invoices.
6. #1304's `mergeable_state` reads `unknown` until GitHub recomputes; local `merge-tree` against current `main` shows no conflicts.

## 11. Final recommendation for #1315 (historical — #1315 has since merged) : **READY — conditional**

**#1315 is READY to merge after #1304**, on these conditions: **(a)** CI stays green on `b3adda1` — **verified 6/6 success**; re-check after retargeting to `main`; **(b)** the owner accepts that A5 is unsupported and that physical-thermal-printer behaviour is NOT VERIFIED; **(c)** the owner accepts F1's effect on invoice thermal receipts with a header discount (or asks for it to be gated). It is **not** safe to merge #1315 at `1287f51` (the thermal defect). This report does not approve #1304's accounting — that is covered by its own report/review.

**Exact merge order and prerequisites**

1. **#1304** — owner approval of its accounting changes (its 5 still-open review threads include the 3 print ones that #1315 resolves). CI is green. Confirm GitHub shows it mergeable after `main` moved (local check: clean).
2. **Retarget #1315 to `main`** (`gh`/UI: change base) → CI re-runs → confirm green on the final head → merge.
3. **Evidence PR #1320** (docs/QA only) — optional, any time after #1315; merging it adds the report, screenshots and QA tooling to the repo (no application code).
4. Follow-ups (owner decisions, not blockers): F7 credit-note footer/labels; selectable discount columns in saved layouts (shared contract); A5 scope; real thermal-printer test; the shared exporter's blank trailing page.

**Stopped before merging either PR.**

---

## 12. PR #1320 — post-squash branch cleanup, scope and status

**Why this section exists.** After #1304 (`56fcac62`) and #1315 (`3209fcb77cc4e02b729bb74c34adf7e131869a1b`) were squash-merged, this PR's branch still carried their original commits, so GitHub's three-dot diff (merge-base = the pre-#1304 `main`) showed **221 files** and `mergeable=false`.

**Fix — no history rewrite, no force-push.** `main` was merged into the branch (fast-forward push). One conflict: `AWJ-TAX-REM-02-PRINT-01-IMPLEMENTATION-REPORT.md` (add/add) — `main` carries #1315's final copy (blob `eeec852…`, identical to #1315's last head), so `main`'s was kept. Independent cross-check: replaying this PR's three own evidence commits onto a clean `main` produced a tree **byte-identical** to the merge result (`533b8fc…`). Nothing from #1304/#1315 was reintroduced — those changes are already on `main`, so they do not appear in the diff.

**Scope correction (this commit).** The first cleanup left one file under `web/src/app/` — the isolated QA page. Although fixtures-only and not in navigation, a page under `src/app` is compiled into the production bundle and reachable by URL, so "no production code change" was not strictly true. It was **moved out of `src/app`** into `web/e2e/credit-note-visual/credit-note-qa-page.tsx.txt` (a non-compiled template; `git mv`, 100 % rename) with a README on how to reproduce. The PR now contains **no file under `web/src/`**.

**Scope proof** (`git diff --name-only origin/main` after the change, checked against an allowlist):

| Check | Result |
|---|---|
| Files changed vs `main` | **146** (137 `.jpg`, 3 `.json`, 2 `.md`, 2 `.mjs`, 1 `.py`, 1 `.txt`) |
| Outside `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/`, `AWJ-TAX-REM-02-PRINT-02-VISUAL-VERIFICATION.md`, `web/e2e/credit-note-visual/` | **none** |
| Any `app/`, `database/`, `routes/`, `config/`, `tests/`, `.github/`, `web/src/`, `*.php`, `*.ts`, `*.tsx`, `*.js` | **none** — no accounting, tax, POS, database or production code |
| Can the tooling be run/compiled by the project? | No: `tsconfig` includes only `**/*.ts(x)`; vitest only `src/**/*.test.ts(x)`; Playwright's default `testMatch` needs `*.spec/test.*` — the `.mjs`/`.txt`/`.md` files match none |

**Changed files (inventory):** `AWJ-TAX-REM-02-PRINT-02-VISUAL-VERIFICATION.md` · `docs/audits/evidence/AWJ-TAX-REM-02-PRINT-02/` (137 screenshots in `a4/`, `a4-compositions/`, `saved-layout/`, `thermal-80/`, `thermal-58/`, `app-pdf/`, `a5-informational/`, `before-fix/`; `results.json`, `results-before-fix.json`, `texts.json`, `oracle.py`) · `web/e2e/credit-note-visual/` (`capture.mjs`, `capture-a5.mjs`, `credit-note-qa-page.tsx.txt`, `README.md`).

**Checks on this tree (local):**

| Check | Result |
|---|---|
| Focused vitest: `modules/documents`, `design`, `components/credit-notes`, `modules/invoices`, `modules/print-templates` | 58 files / 585 tests pass (no `src` change vs `main`, so this confirms `main`'s state) |
| Evidence integrity | 137 images; `results.json` / `results-before-fix.json` / `texts.json` valid JSON, 122 entries each |
| `oracle.py` reproduces from the committed evidence | 122 cases checked; 4 residual cosmetic flags (`minimal-v2` Qty header, F5) — as recorded in §5 |
| `tsc` / full suite / build | unaffected by construction (no `.ts/.tsx/.js` in the diff); CI runs them — see below |

**Base / Head / CI / mergeability:** **Base** `main` @ `3209fcb77cc4e02b729bb74c34adf7e131869a1b` (merge-base == `main`). **Verified head `c11ce2535b5c49c7f85fe2c0c14ea60fc00502d5`** (the scope-correction commit): **6/6 check runs `success`** — web build (`npm run test` + `npm run build`), PHP sqlite and PHP pgsql, across both workflow runs (completed 17:37 UTC) — and GitHub `mergeable_state: clean`, **146 changed files**. The head of the PR is the commit that adds this paragraph (`c11ce25` + a report-only commit that changes no other file); its CI is re-verified separately in the PR description before the PR is called ready.

**Remaining risks (specific to this PR):**
1. Merging adds ≈8 MB of screenshots to the repo history (can be closed unmerged instead; no shipped fix depends on it).
2. Reproducing the run needs the page template copied into `src/app` temporarily (documented); if someone commits that copy, it would ship to production — the README says not to, and this PR deliberately does not.
3. The evidence documents the state of the code at verification time (`b3adda1`, later squash-merged as `3209fcb`); later changes to the document templates are not covered.
4. The report's earlier sections still quote verification-time SHAs and the (historical) merge order; the post-merge note at the top and this section are authoritative for current status.
5. Open product items from §5/§10 remain owner decisions: A5 (unsupported), physical thermal printer (not verified), selectable discount columns in saved layouts, ZATCA footer / "Invoice no." wording on credit notes.

**Stopped before merging either PR.**
