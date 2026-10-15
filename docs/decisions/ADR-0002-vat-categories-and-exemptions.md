# ADR-0002 — VAT categories (S / Z / E / O), exemptions and reason codes

DATE: 2026-10-15
STATUS: accepted — **architectural direction only** (see "Scope of acceptance")
DECIDED_BY: Product owner (direction approved at the D-05 decision review). **Tax-adviser sign-off: NOT OBTAINED.** **ZATCA clarification: NOT SENT / NOT ANSWERED (D-06).**
SUPERSEDES: none
RELATED_TASKS: D-05 · REM-00B · REM-12 · REM-10 · REM-16 · REM-18 · REM-28 · REM-32 · REM-34 · TAX-E01
WORKING LABEL: "ADR-I" in `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` §5

> Not legal or tax advice. Nothing here states or implies that AWJ complies with ZATCA Phase 1 or Phase 2, is certified or production-ready. Items marked **GATE** are unresolved.

## Scope of acceptance

| Layer | Meaning in this record |
|---|---|
| **Approved architectural direction** | Section "Decision". |
| **Verified regulatory requirement** | "External evidence" rows graded **VL**. |
| **Unresolved legal / tax interpretation** | "Decision gates" G-I1 … G-I7. |
| **Still requires owner approval** | Any schema change for category/reason-code storage, any data migration of existing rows, any change to tax amounts or postings, and every gate outcome. **No schema change is authorised by this record.** |

## Context

### Repository evidence (`main` @ `3f445a965c2124049604e355a0b6fb4a2bcea5f8`)

| # | Fact | Location |
|---|---|---|
| R1 | Tax treatment is a bare integer percentage (`tax_rate`, `unsignedSmallInteger default 15`) on invoice, quote, purchase, return, credit-note, expense, asset, recurring and procurement lines. No category or exemption-reason column exists outside unrelated fuel master data. | `database/migrations/…_000004_create_invoices.php:55` and the listed siblings; `…_000108_create_fuel_station_master_data.php:40` (fuel master only) |
| R2 | Input validation accepts any integer 0–100 for `tax_rate`. | `StoreInvoiceRequest.php:67`, `StorePurchaseRequest.php:62`, `StoreReturnRequest.php:57`, others |
| R3 | The seeded tax-definition list contains "Zero Rated" and "Tax Free", both with `rate = 0`; at the data level they are indistinguishable. This list is a non-accounting preference and does not drive the ledger. | `app/Http/Controllers/Api/SalesConfigController.php:35-39` |
| R4 | The UBL builder emits no tax category, no `TaxSubtotal`, no exemption reason. | `ZatcaService.php:234-312` |
| R5 | Several services default a missing rate with `?? 15`. | `ReturnService.php:165`, `ExpenseService.php:59,100`, `AssetService.php:72`, `RecurringInvoiceService.php:60` (verified on this `main`) |
| R6 | A credit note takes the rate sent on its line, and when absent the tenant's `default_tax_rate` (not a fixed 15); neither is a stored treatment inherited from the original line. | `CreditNoteService.php:396,458` |

### External evidence (register, live checks 2026-10-13)

| Requirement | Source key | Grade |
|---|---|---|
| Category code is one of S, Z, E, O. Standard rate 15 (the SDK also accepts 5). Z/E/O carry rate 0. One tax subtotal per (category, rate). An O breakdown carries no tax. | XML Standard v1.2 §11.2.4 pp.32-33; BR-KSA-18/84; Implementation Resolution Annex 2 | **CA** — clause not re-read live |
| Every Z/E/O breakdown carries an exemption/zero-rate reason **code and text**. The 2023 list: VATEX-SA-29, 29-7, 30, 32, 33, 34-1…34-5, 35, 36, EDU, HEA, MLTRY, OOS, with fixed Arabic/English text. | XML Standard §11.2.4; Data Dictionary vF; BR-KSA-CL-04, BR-KSA-83 | **VL** (list) |
| SDK 238-R3.4.8 additionally accepts VATEX-SA-ROYALDECREE and 32(bis), which are not in the 19 May 2023 PDF. | SDK behaviour (register NEW-R02) | **CA** |
| Citizens' private education/health are zero-rated with VATEX-SA-EDU / HEA; buyer name is mandatory even on simplified invoices; a National ID with `schemeID=NAT` is required. | XML BR-KSA-25 (VL), BR-KSA-49 (CA); Resolution Annex 2 | **VL** / **CA** |
| Each exempt/zero-rate ground has a VAT-Regulation article and an evidence rule (for example export evidence within 90 days, Art.32). | VAT IR | **CA** |
| A tax invoice states the taxable amount per rate or exemption, the rate and the VAT amount. | VAT IR Art.53(5) | **VL** |

Grade key as in ADR-0001.

## Decision

1. **Explicit VAT categories S, Z, E and O** become first-class data. Standard-rated, zero-rated, exempt and out-of-scope supplies are distinguishable from entry to output. A bare `rate = 0` no longer stands for "some zero-tax treatment".
2. **Category is the primary input; a rate alone is not a tax treatment.** The rate applicable to a category is resolved from a platform-level, effective-dated source rather than from free tenant input. (The shape of that source — catalogue contents, effective dates, 5% handling — is gated, see G-I3/G-I5.)
3. **Never guess a category for legacy 0% data.** Existing rows with `tax_rate = 0` are not converted to Z, E or O by inference. They remain explicitly "unclassified legacy" until a human supplies the treatment where one is required. A guessed category would assert a legal fact the system does not know.
4. **Validated treatment and reason handling.** For categories that require an exemption/zero-rate reason, a reason code and its official text are required and validated against the official list in force at the document's tax-relevant date. Unknown or mismatched codes are rejected with a coded error. The authoritative list and text pairing come from the Data Dictionary / XML standard; the list in this record is evidence, not a seed.
5. **Line-level treatment is preserved.** A document may contain lines of different categories and rates. The treatment is stored per line, and document-level tax breakdowns are derived from lines (consistent with the existing "totals are derived, not entered" rule). Header-level shortcuts such as a single document category are not introduced.
6. **Credit notes and returns do not assume one category.** A note's lines carry their own treatment; where a note line corresponds to a line of the original document, that treatment is the reference point, and any divergence from it is an explicit, validated decision rather than a silent default. How a note line with no source line, or a mixed-category note, is treated is gated (G-I6). The existing rule that accounts are resolved from the *current* role at posting time (REM-06) is about ledger accounts and is not changed by this ADR.
7. **Unsupported scenarios fail closed.** Combinations the system cannot represent correctly (for example mixing out-of-scope with other categories if an official validator rejects it, special-case buyers such as EDU/HEA without the required identity data, or codes whose legal basis is unconfirmed) are rejected with a clear coded error rather than approximated (links to REM-32).
8. **No accounting effect.** Z, E and O carry zero tax today exactly as `rate = 0` does; this ADR changes classification, not amounts. Any later change to tax totals or postings requires separate explicit owner approval (see ADR-0003).

## Decision gates (unresolved)

| ID | Gate | Needed to close |
|---|---|---|
| **G-I1** | Authoritative VATEX list and text for each supported reason, including whether `VATEX-SA-ROYALDECREE` and `32(bis)` may be offered, and their legal basis. | Primary-source reading of the current Data Dictionary/XML standard; SDK validation; ZATCA confirmation. |
| **G-I2** | The AWJ mapping from each business ground (export, intra-GCC, qualifying medical/education, etc.) to category + VATEX + the evidence the system must capture (for example the 90-day export evidence). | Tax-adviser opinion; VAT Regulation article mapping. |
| **G-I3** | Effective-dated rate rules: which rates and effective dates exist per category (including whether any 5% usage remains valid), and how a rate change applies to documents by tax-relevant date. | Primary evidence; tax-adviser opinion. The platform's rate history is not asserted here. |
| **G-I4** | **Historical migration rules** for existing rows: which legacy rows (15%, 0%, other rates) may be classified automatically, which require human review, and what happens to existing drafts that would be issued after the change. | Owner decision + tax adviser + a read-only count of affected rows (REM-00A). Automatic classification of legacy 0% is excluded by Decision 3. |
| **G-I5** | Whether a category may be defaulted from product/partner/tenant, and the precedence rule; whether any customer-driven zero-rating is ever automatic. | Owner decision. Zero-rating usually depends on the transaction's evidence, so automatic defaults are not presumed. |
| **G-I6** | Treatment of mixed-category notes, notes with no source line, and price-adjustment notes (ties to ADR-E2, which is itself PROPOSED). | Owner + Finance + tax adviser; ADR-E2 decision. |
| **G-I7** | Behaviour of purchases/expenses/assets (input VAT) — whether categories are required there and for which return boxes (REM-28). | Separate decision; out of scope for the first sales slice. |

## Alternatives considered

| Option | Verdict |
|---|---|
| Derive category from the rate (15 ⇒ S, 0 ⇒ ?) | Rejected: zero cannot distinguish Z/E/O and cannot supply a reason code. |
| Free tenant-editable tax table (code, rate, reason) | Not adopted: turns a regulatory fact into an editable preference. |
| Single document-level category | Rejected: legitimate mixed-category invoices exist; the XML requires a breakdown per category. |
| Auto-classify legacy 0% as Z | Rejected: asserts a legal fact the data does not support. |

## Rationale

The official data model is category-first with a mandatory reason for non-standard treatment. Rate-only storage cannot meet it, and any heuristic would create tax statements that no one has evidenced. Keeping classification separate from amounts means the change can be introduced without touching postings.

## Consequences

- **Snapshot:** per-line treatment (category and, where required, reason code) frozen at issuance; the exact columns and the catalogue are for the implementation slice (REM-12).
- **XML:** category and tax-breakdown elements become producible (implemented in REM-16, not here).
- **QR / signing:** no direct change.
- **Credit/debit notes:** per Decision 6; reason/category linkage to the original is implemented with REM-18.
- **Reports:** zero-rated/exempt breakdowns for returns become possible later (REM-28); not part of this ADR.

## Compatibility / migration impact

- **No schema change, data migration or backfill is authorised by this record.** Any storage change must be additive and approved separately; any historical classification follows G-I4.
- Clients that send only `tax_rate` must keep working for non-ZATCA flows until a separately approved compatibility rule says otherwise.
- Tenant data is classified per tenant; nothing is inferred across tenants.

## Security / tenant / accounting impact

- Platform-level reference data (categories, reason list) is read-only to tenants; tenant-selected values are stored on `BaseModel` rows under existing isolation.
- No ledger or amount change; `LedgerService` is untouched.

## Follow-up

- **REM-12** (VAT category/exemption model): first create a design note resolving G-I1…G-I5, then implementation. Not started and not authorised by this PR.
- Questions for the tax adviser / ZATCA (TAX-E01): the legal basis and use of `ROYALDECREE`/`32(bis)`; whether mixing O with other categories is rejected; the evidence the system must retain for zero-rated exports; whether 5% remains valid for any supply; how a rate change is applied by tax point.
- **Required official validation:** SDK runs for S, Z (with reason), E (with reason), O and mixed-category fixtures once REM-16 can emit them; code/text pairing checked against the Data Dictionary workbook.
