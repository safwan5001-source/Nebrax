# ADR-0003 — Monetary calculation contract (rounding, tax totals, UBL amount consistency)

DATE: 2026-10-15
STATUS: accepted — **architectural direction only** (see "Scope of acceptance"); **no calculation change is approved**
DECIDED_BY: Product owner (direction approved at the D-05 decision review). **Accounting approval for any calculation change: NOT GIVEN.** **Tax-adviser sign-off: NOT OBTAINED.** **ZATCA clarification: NOT SENT / NOT ANSWERED (D-06).**
SUPERSEDES: none
RELATED_TASKS: D-05 · REM-00B · REM-10 · REM-16 · REM-18 · REM-34 · TAX-E01
WORKING LABEL: "ADR-B" in `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` §5

> Not legal or tax advice. Nothing here states or implies that AWJ complies with ZATCA Phase 1 or Phase 2, is certified or production-ready.

## Scope of acceptance

| Layer | Meaning in this record |
|---|---|
| **Approved architectural direction** | The *principle*: one monetary contract, verified before adoption, preserving existing amounts. |
| **Verified regulatory requirement** | "External evidence" rows graded **VL**. |
| **Unresolved legal / tax interpretation** | "Decision gates" G-B1 … G-B8. |
| **Still requires owner approval** | **Every change** to tax totals, rounded amounts or posting amounts, and the choice of the rounding algorithm itself. |

## Context

### Repository evidence (`main` @ `3f445a965c2124049604e355a0b6fb4a2bcea5f8`)

| # | Fact | Location |
|---|---|---|
| R1 | Line tax is computed per line, half-up, on integer minor units (`intdiv(base*rate+50,100)`); inclusive extraction uses `intdiv(2*gross*rate+denom, 2*denom)`. Document tax is the sum of line taxes. | `InvoiceService.php:1214,1223`; `ComputesLineTax.php` |
| R2 | Header (document) discount scales the summed line tax with `intdiv(taxGross*net, subtotal)` (truncating). | `InvoiceService.php:1240-1251` |
| R3 | Shipping VAT is computed at a constant 15%, independent of any line treatment. | `InvoiceService.php:49,697,914` |
| R4 | `adjustment` is an unbounded signed amount, outside VAT, added to the total and posted to the `document_adjustment` role. | `InvoiceService.php:701-703,1000-1008` |
| R5 | The UBL builder emits `TaxExclusiveAmount = subtotal`, `TaxInclusiveAmount = PayableAmount = total`, a single `TaxTotal`, line `LineExtensionAmount = line_subtotal` and `PriceAmount = unit_price`; it emits no document allowance/charge, no rounding amount, no per-category subtotal. | `ZatcaService.php:245-247,305-312` |
| R6 | The same calculation exists in more than one place (`InvoiceService` has its own copies; quote/return/procurement/purchase use `ComputesLineTax`). | `InvoiceService.php`; `ComputesLineTax.php` |
| R7 | Posted amounts are immutable; the ledger engine is the only journal writer. | `LedgerService`; CLAUDE.md rules |

**Illustrative observation (not evidence of a regulatory requirement, and not a basis for adopting an algorithm).** The current formulas, applied to small-value baskets, can differ by one minor unit from a document-level calculation (for example three lines of 0.10 SAR at 15%, or a very small header discount on a larger base). These cases only show *where to test*; they are not used here to choose or to justify a new rounding method. The question of whether any difference is a defect is G-B1.

### External evidence (register, live checks 2026-10-13)

| Requirement | Source key | Grade |
|---|---|---|
| For tax-inclusive consideration: VAT = consideration × rate ÷ (100% + rate). | VAT IR Art.45(2) | **VL** |
| VAT is stated in riyals and halalas, rounded to the nearest halala; the same figures are used in the return. | VAT Guideline v3 §4.2.4 p.21 | **VL** |
| XML: half-up on the third decimal; document totals to two decimals; round only final results; BT-110 is rounded at document level, not as the sum of rounded line VAT. | XML Standard v1.2 §10 p.29 | **VL** |
| The VAT IR itself contains no rounding article. | VAT IR (register note) | **VL** |
| Document totals relationships: BT-109 = BT-106 − BT-107 + BT-108; BT-112 = BT-109 + BT-110; BT-115 = BT-112 − BT-113 + BT-114; BT-116 = line nets (+charges −allowances) per category; BT-117 = BT-116 × rate to two decimals. | XML Standard §9.2-9.3, §13.2.2 | **CA** |
| SDK tolerates 0.01 × number of lines on these checks. | SDK 238-R3.4.8 | **CA** |
| Document-level allowances/charges require a category; charges require a reason code and text. | XML BR-KSA-19/21, CL-06 | **CA** |
| VAT is computed on the value after discounts; a post-sale discount needs a credit note. | VAT Guideline v3 FAQ 8-9 p.55 | **CA** |
| Guidance example 6 in the VAT Guideline p.21 is arithmetically inconsistent. | register DP-R7 | **VL** |

Grade key as in ADR-0001.

## Decision

1. **A single, consistent monetary calculation contract** governs financial posting, the XML amounts, the QR amounts and the document totals shown to the user: the same issued document yields the same numbers everywhere, derived once from stored line data and a stored breakdown, never recomputed independently per output.
2. **Existing posted journals and invoice amounts are preserved.** Nothing in this ADR re-states, re-rounds or re-posts any posted document.
3. **No new rounding algorithm is adopted on the strength of illustrative examples.** The method (per line, per category per document, or another) is chosen only after verified official ZATCA monetary rules are read at the point of implementation and the choice is demonstrated against the official validator.
4. **Accounting approval is required before any calculation change.** Because a changed tax total moves money between revenue and VAT payable, "separate explicit owner approval" is mandatory for any change in tax totals or posting amounts, with the accounting entries shown in tabular form per the repository's pre-PR protocol.
5. **The contract explicitly covers** (each is a gate, not a presumed rule):
   - **document-level discounts** (basis in tax-inclusive mode, allocation across categories, effect on tax);
   - **shipping/charges** (their own tax treatment rather than an assumed rate);
   - **adjustments/rounding amounts** (what is a legitimate rounding difference vs a hidden discount/charge, and any bound);
   - **mixed tax categories** (per-category totals and a derived document total);
   - **credit and debit notes** (arithmetic that reconciles to the original document and to cumulative caps, including final-note remainder handling).
6. **Totals remain derived from lines.** The rule "no manually entered subtotal/tax/total" is unchanged.
7. **Any divergence between official guidance, the standard's text and validator behaviour is recorded**, not resolved silently (register DP-R5/DP-R7).

## Decision gates (unresolved)

| ID | Gate | Needed to close |
|---|---|---|
| **G-B1** | Whether current line-sum/truncating-discount results are *non-compliant*, merely *different*, or accepted, and the permitted tolerance. | Primary-source monetary rules + SDK differential evidence + tax-adviser opinion. |
| **G-B2** | Rounding level: per line vs per category per document vs other; interaction with inclusive pricing (POS). | As above; accounting approval for any change. |
| **G-B3** | Header discount: basis in inclusive mode, allocation across categories and lines, resulting tax. | Owner/accounting decision + evidence. |
| **G-B4** | Shipping/charges: which category and rate, and whether they follow the goods. | Tax-adviser opinion; depends on ADR-0002. |
| **G-B5** | `adjustment`: whether it may exist as an uncategorised amount at all for ZATCA tenants, the permitted bound, and mapping to the document rounding element vs an allowance/charge. | Official rule on the rounding element + owner decision. A bound would be a configurable policy (CLAUDE.md rule 6) with a tenant-protecting default. |
| **G-B6** | Relationship of QR amount tags and `PayableAmount` to the totals in the presence of rounding/prepayment. | Official standard re-read + SDK evidence. |
| **G-B7** | Credit/debit-note arithmetic and remainder rules (links REM-01/02 caps, ADR-E2). | Owner + Finance. |
| **G-B8** | Currency/SAR-tax-amount requirements for non-SAR documents (tax amount in SAR). | Evidence; depends on REM-14/16. |

## Alternatives considered

| Option | Verdict |
|---|---|
| Keep per-line rounding everywhere | Not decided; the standard text indicates document-level (VL), so continuing unchanged is a risk to be evaluated under G-B1, not assumed acceptable. |
| Adopt document-level, per-category rounding now | **Not adopted** in this record; candidate only, pending verification and approval (Decision 3). |
| Adjust the last line to absorb differences | Not adopted: hides differences inside a line and breaks per-line amounts. |

## Rationale

Money, tax and the signed document must agree. Choosing the algorithm before the official rules are verified and before accounting has approved the effect on posted-style amounts would risk changing what customers are charged and what is declared. The record therefore fixes the *contract* (one calculation, verified, approved) and leaves the *method* to evidence.

## Consequences

- **Snapshot:** a stored tax breakdown (and any rounding element) becomes the single source for all outputs; its shape is decided in the implementation slice.
- **XML / QR / signing:** amounts read from the stored breakdown; the QR amount tags and the hash input follow automatically once XML is rebuilt (REM-16), not before.
- **Credit/debit notes:** same arithmetic contract, reconciled to the original (G-B7).
- **Posting:** unchanged unless and until a separately approved change.

## Compatibility / migration impact

- Posted journals and documents are never recomputed. Any change applies only to documents issued after an explicitly approved cut-over.
- **No schema change, calculation change or posting change is authorised by this record.**
- Draft totals are re-derived at posting today; if the method changes, previewed and posted totals must come from the same function (requirement for the future slice).

## Security / tenant / accounting impact

- Tenant isolation unchanged. Journal writes stay behind `LedgerService`; this ADR adds none.
- Any change to the VAT payable amount affects ledger balances and returns: hence Decision 4.

## Follow-up

- **REM-10** (arithmetic consistency) stays gated: step 10a is this ADR's gates G-B1…G-B5; no code until closed.
- **Required official validation:** SDK differential runs over agreed basket families (many small lines, inclusive POS, header discount, mixed categories, shipping, within-bound adjustment) once the XML can express them (REM-16); tests on SQLite and PostgreSQL for boundary values (exact half, zero, large values), balance of the resulting entry, cross-document consistency and partial-then-final credit sequences.
- **Questions for the tax adviser / ZATCA (TAX-E01):** whether a document-level, per-category method is required and what tolerance applies; whether the rounding element is permitted on tax invoices and its bound; the tax category of shipping on zero-rated or mixed supplies; the basis of a document discount on inclusive prices.
