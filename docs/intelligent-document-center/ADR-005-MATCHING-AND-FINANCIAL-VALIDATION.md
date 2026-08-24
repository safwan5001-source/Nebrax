# ADR-005: Matching and Financial Validation Evidence

- **Status:** Accepted
- **Date:** 2026-08-24
- **Scope:** PR-5

## Decision

PR-5 reads the encrypted `document-schema-v1` extraction evidence and produces only branch-scoped **match results**, ordered **candidates**, and open **issues**. It is an evidence and review-preparation layer; it does not create or update Partners, Products, Units, drafts, invoices, purchases, expenses, journals, or stock movements.

All new operational evidence is `BranchScoped`, inherits the tenant scope, and is created only with trusted tenant and branch contexts. Matching locks the scoped extraction-result row inside its persistence transaction before checking existing evidence, so a redelivery waits for the original attempt and then rebuilds the same useful report from persisted results, candidates, and issues. The database keys one result by `(document_extraction_result_id, subject_type, subject_key)`, one candidate rank by match result, and one issue code by result/subject as a second integrity boundary. Re-delivery is therefore idempotent and cannot multiply evidence.

## Matching policy

The matching document type is the immutable `DocumentBatch.document_type`; the caller context must match it exactly or matching fails before any write. Counterparties are evaluated within the visible branch scope and the permitted role: purchase and expense evidence selects suppliers or `both`; sales evidence selects customers or `both`. Exact normalized VAT number has the highest score, then normalized name similarity. Products use visible products only, with exact primary/alternate barcode before SKU and normalized description. Equal top scores create candidates and an ambiguity issue; no candidate becomes `confirmed` in this PR.

Scores are integer **basis points** from 0 to 10,000. Ordering is deterministic: score descending, then candidate UUID ascending. Candidates carry strategy and bounded explanation codes; free-form provider text is never used as an audit reason. Inactive candidates remain evidence but create a review warning rather than an automatic match.

Unit validation reuses `UnitConversion`. An unknown unit, an unavailable template, or an unsupported product-unit pairing produces an issue. No conversion factor is assumed or written to master data.

## Financial and duplicate validation

The validator consumes only integer minor-unit evidence and parses textual quantities into a bounded numerator/denominator before reusing the existing line-boundary half-up precision helper. It uses the existing invoice integer tax semantics: `intdiv` with explicit half-up behavior for inclusive and exclusive tax. It validates line and header totals, tax totals, missing currency, discounts against gross line value before discount, unsupported tax rates, quantities, rounding differences, and integer overflow. The explicit current tolerance is one minor unit; a difference beyond it is blocking. Evidence is never corrected silently.

Logical duplicates search only the scoped extraction evidence. Supplier tax ID plus document number is blocking; supplier, date, currency, and total without a document number is a warning. A duplicate issue stores only the safe extraction-result UUID reference and never deletes the new batch or links a business transaction.

## Workflow and activation

PR-5 creates no review API or UI and does not promote a batch to `ready_for_draft`. Successful matching remains evidence for a batch in `needs_review`; PR-6 owns human confirmation, issue resolution, and the review workspace. The code-level AI network gate remains `false`, persistent storage remains inactive, and this change provisions no worker, Redis, ClamAV, S3/R2, Render setting, migration run, or external request.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Auto-create an unmatched supplier/product/unit | Extracted evidence is uncertain and cannot mutate master data. |
| Auto-confirm an exact match | Confirmation is human review authority reserved for PR-6. |
| Float-based validation | Monetary values must remain minor-unit integers. |
| Cross-branch or cross-tenant matching | It leaks operational data and violates scopes. |
| Draft or posting creation | The transaction boundary belongs to a later approved PR. |

## Deferred to PR-6 and later

PR-6 adds authenticated review reads, human confirmation/rejection, issue resolution, and review UI. A later transaction-draft PR may consume only reviewed evidence through domain services. Rule-management UI, historical mapping rules, and per-tenant matching policy configuration are deferred until their ownership and migration policy are approved.
