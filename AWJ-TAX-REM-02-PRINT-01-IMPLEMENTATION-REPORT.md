# AWJ-TAX-REM-02-PRINT-01 — Credit Note Print/PDF Financial Reconciliation · Implementation Report

| | |
|---|---|
| **Task** | Print/PDF follow-up to REM-02 (#1304): every amount a customer sees on a credit note reconciles with the posted amounts, to the halala. Closes the three open Codex threads on #1304 that were deferred to this slice (see §9). |
| **Branch** | `claude/awj-tax-rem-02-print-01` |
| **PR** | opened against `claude/awj-tax-rem-02-credit-note-vat` (**stacked on #1304**, see §1). Link in the PR / final message. |
| **Base SHA** | `2c82b01afbc8f2a5fb4ea9d01509c9fe1776eda9` — head of #1304. (`origin/main` is `4d8e1a66…`; merge-base of #1304 with `main` is `bdecbd01…`.) |
| **Head SHA (code)** | `e6d5548d732b470fe63d6e8e63a83d14362a2d1a` — the only code commit. The commit that adds this report changes no code. |
| **Status** | Implemented, web-only. Focused + full web suites green, production build green. **Not merged, not deployed, no migration, no backend change.** |

---

## 1. Why this is stacked on #1304 and cannot sit on `main`

The print fix needs stored amounts that **only #1304 creates**:

| Needed by the print fix | Where it comes from |
|---|---|
| `credit_note_lines.line_discount` | added by #1304's migration `2026_11_04_010000_add_source_line_to_credit_note_lines` (the column does not exist on `main`) |
| `credit_note_lines.unit_price_before_tax` | same migration |
| `line_discount` / `unit_price_before_tax` / `source_line_id` in the API payload | `CreditNoteLineResource` — #1304 only |
| builder already mapping `unit_price_before_tax` | `from-credit-note.ts` — #1304 only |

On `main` there is no discount datum for a credit-note line at all, so a branch from `main` could neither show a discount nor be tested against real payload shapes. **Dependency, stated explicitly:** this PR is stacked on #1304's head `2c82b01`. Merge order: #1304 first, then retarget this PR to `main` (it is 19 web-only files and rebases cleanly on top of #1304's merge). **#1304 itself is untouched** — no commit, comment or thread change was made there.

## 2. Root cause

Stored data is correct; the print model could not express it.

1. `DocumentLine` carried `unitPrice · tax · total` only. For a discounted line, `qty × unit price + tax ≠ total` by exactly the discount, because the discount (stored in `line_discount`) was dropped by the builder.
2. The default credit-note columns were the generic 10-column invoice set, so the customer saw unit price, VAT and total side by side with no net amount between them.
3. For multi-unit inclusive lines the per-unit pre-tax price is a rounded **display** integer; `qty × unit` cannot equal the line's allocated net, and nothing said so.
4. The totals block's VAT row hard-codes **"(15%)"** in every language (`MODERN_TOTAL_LABELS.vat`, `invoiceDoc.vat`). A credit note at any other rate (REM-02 makes `sales.default_tax_rate` configurable) printed `VAT (15%) 5.00`.
5. The document `subtotal` posted by the service is **net of discount** (`Σ(line_subtotal − line_discount)`), so simply passing `totals.discount` to the existing totals block would have **counted the discount twice** (`subtotal − discount + tax ≠ total`).

## 3. What changed (all presentation)

| Area | Change |
|---|---|
| `builder/from-credit-note.ts` | Per-line reconciliation **from stored amounts only** (§4). New optional source fields `tax_rate`, `line_subtotal`, `line_discount`. Totals logic (§5). |
| `types/index.ts` | `DocumentLine`: optional `discount`, `netAmount`, `taxRate`, `unitPriceRounded`. `DocumentTotals`: optional `taxRate`. `DocItemsColumnId`: `line_discount`, `line_net`, `tax_rate`. All optional → every other builder compiles and renders unchanged. |
| `registry/document-types.ts` | `credit_note` default columns = `# · description · qty · price before tax · discount · net before VAT · VAT rate · VAT · total`. Registry validation still accepts only the persistable column ids (`DOCUMENT_ITEMS_COLUMN_IDS` unchanged). |
| `doc-items-table.tsx` + 7 presentation files | Labels / values / widths for the three columns (the width `switch` in each composition is exhaustive, hence one small block per file). Footnote under the table only when a unit price is rounded. |
| `doc-totals.tsx`, `visual-v2.ts`, `modern-bilingual-label.tsx` | `applyVatRateToLabel`: replaces/removes the hard-coded `(15%)` **only** when the builder declared `totals.taxRate`; no declaration ⇒ the label is byte-identical to before. |
| `messages/{ar,en}.json` | 4 keys in `invoiceDoc`: `line_discount`, `line_net`, `tax_rate`, `unit_price_rounding_note`. |
| `invoice-pdf.ts`, `block-properties-editor.tsx` | Placeholder entries only, to satisfy exhaustive `Record<DocItemsColumnId, …>` types. Unreachable: the jsPDF invoice generator never prints a credit note and the editor lists only persistable columns. |

**Not touched:** any PHP, migration, tax/ledger/return/POS/invoice-posting code, ZATCA, `PrintTemplateContract.php`, the template editor's column picker.

## 4. Per-line rule (no invented numbers)

```
tax = line_tax            total = line_total            (stored)
gross = line_subtotal     discount = line_discount      (stored, may be absent)

discount known   ⇔ gross − discount == total − tax                      → net = gross − discount
historical row   ⇔ discount absent AND gross == total − tax             → discount = 0 (the identity proves it)
anything else                                                           → net = total − tax, discount = null  ("—", never assumed 0)
```

* The printed unit price is the stored pre-tax price. For rows from before REM-02 (no `unit_price_before_tax`) the stored `unit_price` is used **only if `qty × unit_price == line_subtotal`** proves it is a pre-tax price; otherwise the column shows "—".
* `unitPriceRounded = discount known && qty × displayed unit price ≠ net + discount` → drives the footnote. The line's authoritative amounts are never derived from the displayed unit price.

## 5. Totals rule

`note.subtotal` is posted **net**. The block prints `subtotal-before-discount, discount, VAT, total` **only when all of these hold to the halala**; otherwise it prints the stored totals exactly as before, with no discount row:

* every line's discount is known and Σ discount > 0
* Σ line net == posted `subtotal`, Σ line VAT == posted `tax_amount`, `subtotal + tax == total`

Then: printed subtotal = posted subtotal + Σ discount; printed discount = Σ `line_discount` (line discount **plus** the header-discount share, which the service already folded into `line_discount` — counted once). Printed `tax` and `total` are always the posted values.

## 6. Before / after

| Case | Before (row · totals) | After |
|---|---|---|
| 1 × 115.00 inclusive | `100.00 + 15.00 = 115.00` (already fixed in #1304) | `qty 1 · 100.00 · disc 0.00 · net 100.00 · 15% · 15.00 · 115.00`; totals `100.00 / 15.00 / 115.00` — no discount row |
| 100.00 − 20.00, VAT 12.00 | `100.00 · 12.00 · 92.00`; totals `80.00 / 12.00 / 92.00` (the 20.00 appears nowhere) | `1 · 100.00 · disc 20.00 · net 80.00 · 15% · 12.00 · 92.00`; totals `100.00 − 20.00 + 12.00 = 92.00` |
| Header discount 20.00 over 2 × 100.00 | each row `100.00 · 13.50 · 103.50`; totals `180.00 / 27.00 / 207.00` | each row discount 10.00 · net 90.00 · 13.50 · 103.50; totals `200.00 − 20.00 + 27.00 = 207.00` |
| 7 × 0.10 inclusive (net 0.61, VAT 0.09) | `7 · 0.09 · 0.09 · 0.70` | `7 · 0.09 · 0.00 · net 0.61 · 15% · 0.09 · 0.70` + footnote: *unit prices are shown rounded for display; the recorded line amounts are authoritative* |
| Codex example 7 × 0.01 | `7 · 0.01 · 0.01 · 0.07` | `7 · 0.01 · 0.00 · net 0.06 · 15% · 0.01 · 0.07` + footnote |
| Note at 5 % VAT, 100.00 | VAT row labelled **"(15%)"** with 5.00 | labelled **"(5%)"**; mixed rates ⇒ no percentage |
| Pre-REM-02 payload (no new fields) | `50.00 · 15.00 · 115.00` | net 100.00 derived (`115.00 − 15.00`), discount "—", rate "—"; stored totals and original VAT label untouched |

Arabic and English render the same figures: tests compare the numeric content of every row and totals block across `ar` and `en` for all 12 template compositions.

## 7. Tests and results

New (all deterministic, all fail when the logic is broken — mutation-checked):

* `builder/from-credit-note.reconcile.test.ts` — 13 tests: 115.00 = 100.00 + 15.00; 100 − 20 + 12 = 92; header-discount allocation; multi-unit inclusive rounding; Codex 7 × 0.01; three partial notes of one line (Σ net 0.26, Σ VAT 0.04, Σ total 0.30); single/mixed rate; pre-REM-02 payloads (with and without `line_subtotal`); unreconcilable stored data ⇒ no discount row; drifted totals ⇒ printed as stored; **300 seeded random notes** asserting Σ line totals = posted total, Σ VAT = posted VAT, `subtotal − discount + VAT = total`, and `ar` model = `en` model except direction.
* `components/document-credit-note-reconciliation.test.tsx` — 53 tests: for each of the 12 compositions × `ar`/`en`: row figures, totals figures, 5 % label, rounding footnote; historical payload renders; invoice-shaped model keeps its column count and `15%` label; only `credit_note` declares the new columns and every other type's default set stays persistable.

Mutations run and caught: discount not added back to the printed subtotal (4 failures), rounding flag disabled (1), VAT-label override disabled (12).

| Run | Result |
|---|---|
| Focused: `builder/from-credit-note*` | 19 passed |
| Affected: `modules/documents`, `components/credit-notes`, `modules/invoices`, `modules/print-templates` | 52 files / 459 tests passed |
| **Full web suite** (`npm test`, the CI command) | **466 files / 4,653 tests passed** |
| **`npm run build`** (the CI command) | **passed** |
| `tsc --noEmit` | 0 new errors (26 pre-existing errors in unrelated test/e2e files, identical set before and after) |
| PHP suites | not run — no PHP, migration or API change in this PR |

CI on the PR: see the PR checks (`web-ci.yml` = `npm ci`, `npm run test`, `npm run build`). Result is stated in the final message after the run.

## 8. Compatibility

* **Other document types:** their default columns, widths of existing columns, labels and totals are unchanged (asserted). New optional fields default to absent; the VAT label override needs an explicit declaration only the credit/debit-note builder makes.
* **Saved / frozen print-template layouts:** per the registry contract, type defaults are *fallbacks*; a tenant layout (or a frozen revision on a posted note) that stores explicit `columns` keeps exactly those columns. Those tenants therefore do **not** get the new columns (see §10-1). Their totals block and VAT label still improve.
* **Print vs PDF vs thermal:** the page renders `CreditNoteDocument` for `print-root`, `pdf-print-root` and `thermal-print-root`; the PDF is a capture of that DOM and `thermal-layout.tsx` is a page wrapper — all three consume the one model built by this builder.
* **Debit notes:** share the builder, so the data and VAT label apply, but `debit_note` keeps the generic default columns (unchanged by design).
* **Ledger / tax / schema:** untouched. No posted value is read differently; the builder only re-expresses stored values.

## 9. Codex threads on #1304 this slice resolves

| Thread (open on #1304) | Resolved by |
|---|---|
| *Make printed line amounts reconcile* (`CreditNoteService`) | net/discount/rate columns + totals identity (§3–5) |
| *Render sourced discounts on credit-note lines* (`from-credit-note.ts`) | `line_discount` carried into the model and printed row-level and in totals |
| *Reconcile multi-unit inclusive lines after rounding* (`CreditNoteService`) | authoritative net/VAT/total printed; rounded unit price flagged, not hidden |

I did not reply to or resolve these threads on #1304; that is for the owner once this slice is accepted.

## 10. Remaining issues and limitations

1. **Template editor cannot add the new columns.** They are render-time defaults only. Letting a tenant add them to a saved layout needs: `DOCUMENT_ITEMS_COLUMN_IDS` (web registry), `PrintTemplateContract::ITEM_COLUMNS` (PHP, `app/Support/PrintTemplateContract.php:72`), and the editor's list — a backend contract change I deliberately did not make. Also, a tenant who edits a credit-note layout's columns starts from the *generic* default and loses the reconciliation columns.
2. **Header discount share is not separable.** The service stores one combined `line_discount` per line; the print shows one "Discount" column. A separate "line discount" vs "header share" would need a stored split (source-data change — not made).
3. **Historical rows:** unknown discount prints "—" (never 0); unit price prints "—" unless proven pre-tax by `qty × price == line_subtotal`. Net is derived from the stored `total − tax` identity.
4. **Printed "Subtotal" for a discounted note is the pre-discount amount**, so it differs from the posted `subtotal` field (net) by the discount; `printed subtotal − printed discount = posted subtotal` exactly. Owner may prefer to keep the net subtotal and show the discount informationally — a policy/wording choice, not a calculation.
5. **Shared label wording:** the discount row uses the existing shared label ("Invoice discount" / "خصم الفاتورة"); not changed to avoid touching invoices.
6. **Layout not verified visually.** 9 columns on A4 are covered by structure/width tests only; narrow papers (thermal 58/80 mm, A5) were not rendered in a browser. Column widths for the new columns were chosen per composition by analogy with `price_before_tax`/`tax`.
7. The jsPDF `invoice-pdf.ts` path (invoices only) got placeholder map entries; credit notes never use it.

## 11. Recommended next step

1. Review/accept #1304, merge it, then retarget this PR to `main` and re-run CI.
2. Open a visual-QA pass for the credit-note print on A4, A5 and thermal 80 mm (ar + en) and adjust widths if needed.
3. Decide §10-1 (allow the columns in saved layouts: web registry + PHP `ITEM_COLUMNS` + editor) and §10-4 (printed subtotal wording).
4. Reply to / resolve the three Codex threads on #1304 with a pointer to this PR.

**Not merged. Not deployed. No migration. No production change.**
