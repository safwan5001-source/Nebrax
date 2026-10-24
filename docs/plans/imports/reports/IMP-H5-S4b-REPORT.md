# IMP-H5-S4b — Purchase import wizard (UI)

**Branch:** `claude/imp-h5-s4b-purchase-import-wizard` (stacked on S4a / PR #1710). Web only: **no backend, migration, permission, accounting or ZATCA change.** Drives the endpoints and the `purchase_import` job domain delivered in S4a; nothing is posted and stock does not move.

## What it adds

- Route **`/purchases/import`**; entry button «استيراد من ملف / Import from file» on the purchases list header (next to «new purchase»).
- **Four steps** — Setup (file · preferences · column mapping) → Preview (no writes) → preview-bound durable job → Result — built on the same pieces as the expense and stocktake wizards (`Stepper`, `useImportJobEngine('purchase_import')`, `ImportJobStatusPanel`).
- **Invoices, not rows:** the preview counts «invoices to create», derived total, warnings and errors, and lists each invoice (number, supplier, date, lines, total, status, messages/warnings) with show-all; sheet-row errors can be downloaded as CSV (formula-neutralised). The result shows the cumulative **invoice** count (`processed_rows`), not the last chunk's `created`.
- **Preferences are blank-able and honest:** payment type, default tax rate and «file prices include tax» default to **«Company default»** and are then *not sent*; the server resolves and freezes them into the preview (S4a). Default supplier and warehouse are optional selects (active suppliers / warehouses only; the server still enforces warehouse access on the actor).
- **Mapping guard mirrors the server:** required fields (invoice number, date, quantity, unit price), a supplier source (column or default supplier), and at least one product identifier (SKU / barcode / Nebrax ID); duplicate mapping blocked; tax rate accepts blank or whole Latin-digit 0–100 only.
- **Hardening carried over from the expense/stocktake wizards' reviews:** stale job never re-applied after any change (rules/file/mapping invalidate and drop it, never while applying), job-creation failure visible and returns to Preview, explicit **Continue** for a paused job, resume from `?job=` (an unbound job is refused), latest-wins sequencing for inspect/preview.
- **Partial-failure honesty:** if a later chunk fails after earlier ones created drafts, the panel says how many invoices already exist and that re-uploading the corrected file will refuse those as existing (remove their rows first), with a «start another» action.
- ar/en `purchaseImport` block + `purchases.import_from_file`; `ImportJobDomain` client type gained `purchase_import`.

## Disclosures / limits

- **No repair/failure-file download** for purchases (document-unit failures aren't row units; S4a). The failed job's message names the first bad invoices.
- No screenshots (component tests only) — same disclosed limit as the earlier wizards.
- `useImportJobEngine.test.tsx(158)` has a pre-existing TS error unrelated to this change.

## Tests

- `contract.test.ts` (5) and `PurchaseImportWizard.test.tsx` (13): inspection + active-only suppliers/warehouses and *only user-set options sent*; explicit preferences sent with the preview and frozen identically into the job (booleans typed as `0/1`); mapping/tax guards (supplier source, product identifier, tax-rate edge cases `150`, `1e1`, `5.0`, ` 5`, `0x10`); invoice list with an existing-invoice error blocking Apply; durable job completes showing the cumulative count (120) and sends `{}` on apply; creation failure visible; stale-job rule change creates a new job with the new option; partial-failure note; resume from URL with an unbound job refused.
- Mutation controls: using the last chunk's `created` instead of `processed_rows` fails the count test; ignoring the product-identifier gap fails the guard test. (Removing the extra `dropJob()` in `runPreview` is *not* detected — the rule-change path already drops the job, so it's belt-and-braces.)
- Full web suite (before the review fixes): 707 files / 8481 tests passed.

## Independent review (read-only subagent; not Codex) — findings and disposition

Verified correct: preview-form vs job-options parity (booleans `0/1`, tax `0` vs blank, mapping `ignore`), i18n keys complete and symmetrical in ar/en (scripted check, including the dynamic `step_*`/`payment_*`/`count_*`/`status_*` prefixes), sequence/busy guards, RTL.

| # | Finding | Disposition |
|---|---|---|
| 1 | Frozen company defaults (tax rate / inclusive / payment type) never shown to the user before confirming | **Fixed** (needed a small S4a change: the preview is now computed with the canonical options so its response carries the resolved values) — an «applied to this run» line in the preview card. Test |
| 2 | Apply stayed enabled after the job from that preview ended (single-use binding spent) | **Fixed**: disabled with an explanatory note. Mutation-verified test |
| 3 | Preview enabled after a failed inspect | **Fixed** (`inspection !== null`). Mutation-verified test |
| 4 | Resume didn't check the job's domain | **Fixed**: a job of another domain shows an error and Apply stays disabled. Mutation-verified test. (The completion toast re-firing on reload of a completed job is the shared engine's behaviour for every wizard — left) |
| 5 | a11y: `aria-describedby` for the tax error, `scope="col"` on table headers | **Fixed**; the several simultaneous mapping alerts left as in the sibling wizards |
| 6 | Copy: Arabic comma in English joined list; «Include tax»; no singular/plural in the partial-failure note | **Fixed** (locale-aware joiner, «Tax-inclusive», ICU plural incl. Arabic forms) |
| — | Test gaps: partial note at 0 processed, inspect failure, wrong-domain resume, stale/terminal | **Added**. Not added: a parity test comparing the preview form with the job-creation fields in one assertion (covered field-by-field in the explicit-preferences test and by the backend round-trip tests) |

## Journal entries

None — the UI only drives drafts-only endpoints.
