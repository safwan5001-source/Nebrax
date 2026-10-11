# AWJ-TAX-REM-02 — Printed credit-note line amounts: the issue and the smallest independent fix

| | |
|---|---|
| **Status** | Documented. **Not implemented** in REM-02 (owner decision: no general document-template redesign in this task). |
| **Scope of the problem** | Customer-facing credit-note PDF/print (`credit_note` document type). Same shape exists for invoices and returns. |
| **Financial impact** | None. Stored amounts, the ledger entry and the document totals are exact. This is a *presentation* issue only. |

## 1. What is stored vs what is printed

For every credit-note line the API stores (all halalas, integers):

| Field | Meaning |
|---|---|
| `line_subtotal` | amount before line/header discount |
| `line_discount` | line discount + the line's share of the header discount |
| `line_tax` | VAT charged for the quantity credited |
| `line_total` | `(line_subtotal − line_discount) + line_tax` — **exact** |
| `unit_price` | the **invoice's** unit price (VAT-inclusive on an inclusive invoice) — the key used for the cap/hold-back comparison |
| `unit_price_before_tax` | per-unit pre-tax price (added in REM-02; derived from the source line, scaled for reduced-price credits) |

The document model (`web/src/modules/documents/types`, `DocumentLine`) has only `quantity`, `unitPrice`, `priceBeforeTax`, `tax`, `total` — **no discount and no line-net amount** — and the default columns are `quantity · unit price · tax · total`.

## 2. Where a printed row can look wrong

REM-02 already fixed the main case: a note on a **tax-inclusive** invoice printed `115.00 + 15.00 = 115.00`; the builder now prints the pre-tax unit price (`100.00 + 15.00 = 115.00`).

Two cases remain, both inherent to "unit price × quantity" on a row:

1. **Discounted line** (line or header discount): `unit price × qty + tax` ≠ `total` by exactly the discount. Example: 100.00 line discounted to 80.00, VAT 12.00 → prints `100.00 + 12.00`, total `92.00`.
2. **Per-unit rounding on multi-unit inclusive lines**: the per-unit pre-tax price is a rounded display value. Example: 7 × 0.01 at 15 %: aggregate VAT 0.01, total 0.07, but the row shows `7 × 0.01 + 0.01`.

Invoices and returns print the same way today. The document totals block (`subtotal / tax / total`) and every row's `total` are always consistent.

## 3. Smallest independent fix (proposal — separate PR, not REM-02)

Add **one optional field and one optional column**; touch no layout and no other document type's output:

1. `DocumentLine.lineNet?: number | null` — "amount before tax after discounts", filled by the *source builder* (not derived in the renderer, same rule as `priceBeforeTax`): for credit notes `line_subtotal − line_discount`.
2. A new column key `line_net` ("المبلغ قبل الضريبة / Amount before tax") next to the existing `price_before_tax` handling in `doc-items-table.tsx` and the `presentation/*.ts` column lists; **off by default** for every template.
3. Enable it only in the default **credit_note** (and `debit_note`) template column set. The row then reads `amount before tax + tax = total` — exact in all cases, independent of unit-price rounding or discounts.
4. Tests: builder test (`lineNet = subtotal − discount`), one render test with a discounted line, and a golden check that no other document type's column set changed.

Why this is the smallest: it removes the misleading equation without changing how unit prices are shown, without a template redesign, and without touching invoices/returns. If the owner later wants the same on invoices, it is a one-line column-set change per template.

**Acceptance for the follow-up:** for any stored credit-note line, `lineNet + tax = total` holds on the printed row (property test over the seeded random sequences used in `CreditNoteSourceVatAccuracyTest`).
