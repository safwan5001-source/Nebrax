# REM-18a — Implementation report: credit-note (381) XML foundation

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/rem-18a-credit-note-xml`. PR number, head SHA, CI and CI Gate are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction 2026-10-20 "REM-18a — Credit Note XML Foundation — Implementation"; builds on `REM-18-CREDIT-DEBIT-NOTES-AUDIT.md` (slice A of that audit). |
| Base | `origin/main` = `a2a740f9aea6bf73a9b3a707394387c2feb3381c`. |
| Scope | A **pure, independently testable** builder for seller-issued sales credit notes (type 381) plus its input value objects, a reason catalogue, a read-only factory from posted models, six SDK fixtures and the conformance checks for BR-KSA-17 / BR-KSA-56. **Not wired into any posting path.** **No migration.** No change to accounting, VAT, inventory, ICV/PIH persistence, API, `CreditNoteService`, `InvoiceService` or `ZatcaService`. No historical XML/QR/signature/hash/PIH regeneration. No live ZATCA call. |
| Not a compliance claim | SDK results are **advisory**, obtained offline with an **ephemeral synthetic credential**. They show conformance with the official validator, not acceptance by the live ZATCA platform (§7). |

## 1. Evidence gate (before anything was made mandatory)

| # | Question | Official source | Verification | Verdict |
|---|---|---|---|---|
| 1 | Root element of a credit note | XML Implementation Standard §11.2.1: "UBL Message type is *Invoice* for all document types" — but the table cell for 381 reads "Credit note" | The 4 official note samples shipped with SDK 238-R3.4.8 all use the `Invoice` root with `InvoiceTypeCode` 381/383. The SDK's only XSD is UBL-Invoice-2.1. A `CreditNote-2` root (with `CreditNoteTypeCode`, `CreditedQuantity`) built from an official sample **fails XSD and EN** | **`Invoice` root + 381.** The standard's internal inconsistency is recorded (U1). |
| 2 | Reason for issuance (KSA-10 / BR-KSA-17) | Data Dictionary KSA-10, Art. 40(1) and 54(3) of the VAT regulations: five instances; text 1–1000 chars | Two of the five strings appear verbatim in official samples (`EN \| AR`); the other three come from the dictionary; SDK: missing note = **error** BR-KSA-17 | **Five reasons kept as a catalogue** (`ZatcaNoteReason`). Making them the *only* accepted values is an **AWJ conservative policy**, not a proven platform rule (U2). |
| 3 | Reference to the original invoice (BT-25 / BR-KSA-56) | Data Dictionary BT-25 "M"; DTG FAQ "mandatory field" | SDK reports a missing `BillingReference` only as a **warning** (confirmed by mutation: strip it → warning BR-KSA-56, no error) | **Mandatory in AWJ regardless of the SDK severity.** One reference, non-empty. Enforced in the builder and in the harness (§4). |
| 4 | `PaymentMeansCode` | BR-49 (mandatory when `PaymentMeans` exists; XSD fails without it); UNTDID 4461 | Official samples carry `10` only; the SDK does **not** validate the code value (`99999` passes) | **`10` for `cash` only.** A `credit` (receivable reduction) refund has no sourced code → **rejected** by the input object, no code invented (U6). The restriction is AWJ policy, not an SDK rule. |
| 5 | Signing/QR/PIH for notes | REM-17 pipeline | Type-agnostic: the finalizer, assembler and QR encoder never read the type | Re-used **unchanged** (§3). |

## 2. What changed

| File | Kind | Purpose |
|---|---|---|
| `app/Support/ZatcaCreditNoteXml.php` | new | Pure builder: `build`, `phaseOneQr`, `withQr`. Same envelope as the invoice (ICV, PIH, QR placeholder, `cac:Signature` container) so REM-17 signs it as-is. |
| `app/Support/ZatcaCreditNoteInput.php`, `ZatcaCreditNoteLine.php` | new | Immutable validated inputs; totals must equal the sum of lines (verified, never recomputed); classification `standard\|simplified` literal; reason code from the catalogue; refund type `cash` only. |
| `app/Support/ZatcaNoteReason.php` | new | Five KSA-10 reasons with stable AWJ codes; `instructionNote($code)` → `EN \| AR`; unknown code → exception. |
| `app/Support/ZatcaCreditNoteInputFactory.php` | new | Read-only mapping from a **posted** `CreditNote` and its original `Invoice`. Rejects purchase-side, draft, unlinked, different customer/tenant, draft source, absent snapshot, unknown classification, lines without a stored net price. Zero queries, zero writes (tested). |
| `app/Support/ZatcaMonetaryXml.php`, `ZatcaPartyXml.php` | additive refactor | `documentBlockFromAmounts`, `lineFromAmounts`, `isStandardRate`, `requireSnapshotArray`; the invoice methods now delegate. **Invoice output is byte-identical** (guarded by `ZatcaSdkFixtureDriftTest` digests and the 88 REM-15a/16 tests). |
| `tests/Fixtures/zatca-sdk/awj/awj-note-*.xml` (6) | new | Standard ×4 (single, multi-line with discounts, tax-inclusive, zero-rate gap) and simplified ×2 (single, partial two-line). Values come from the **real** `InvoiceService` + `CreditNoteService`, proven by the parity test. |
| `scripts/zatca-sdk/conformance.py` (+tests) | extended | Structural checks and mutation controls for BR-KSA-56 / BR-KSA-17 / `PaymentMeansCode` / type 381 (§4). |
| `tests/Fixtures/zatca-sdk/baseline.json` | extended only | Six notes recorded (unsigned + signed); `BR-KSA-56`, `BR-KSA-17` added to the forbidden warnings; one new known gap (`awj-note-standard-zero-rate`, the same REM-12 gap as the invoice). **Nothing removed or relaxed.** |

What a note document contains: `InvoiceTypeCode name="0100000\|0200000"` = 381 from the **source invoice's stored class**; `BillingReference` (original invoice number as stored); `PaymentMeans` (`10` + `InstructionNote`); seller/buyer blocks from the **source invoice's immutable `party_snapshot`** (D5 recommendation: copy, never recapture; absent snapshot ⇒ rejected); amounts and lines as stored (positive, as in the ZATCA samples); tax category `S` only for 15 % lines, nothing for other rates (REM-12 open, no inference); no `Delivery`, no document-level allowance/charge (the header-discount share is already inside each line's stored `line_discount`).

## 3. Signing, QR, PIH — unchanged pipeline

`ZatcaSignedInvoiceFinalizer` (REM-17) signs the note XML without any edit: ECDSA over the raw 32-byte hash, SignedProperties v1, QR tags 6/7 Base64 text, tag 8 DER SPKI, tag 9 for simplified. `ZatcaCreditNoteSigningTest` proves, with an independent `openssl_verify`, that the signature verifies, the note's `BillingReference`/reason/payment code/ICV/PIH survive signing, nothing else in the document changes, QR tags 1/2/4/5 equal the Phase-1 values derived from the snapshot, and altering the referenced invoice number changes the document hash. Fixtures sit at the **genesis PIH** because the SDK's PIH stage only accepts that value; **continuity of a shared invoice+note chain is not provable by the SDK** and is REM-18b scope (D7).

## 4. Conformance checks for BR-KSA-17 and BR-KSA-56

`conformance.py` now reads each `awj-note-*` fixture (unsigned and signed) with `ElementTree` — independent of the SDK and of AWJ PHP — and fails closed unless: root is `Invoice`; exactly one `InvoiceTypeCode` = 381 (383 is flagged, not accepted); exactly one `BillingReference` with a non-empty ID (**BR-KSA-56 — mandatory even though the SDK only warns**); exactly one `PaymentMeans` with one non-empty `InstructionNote` (**BR-KSA-17**); `PaymentMeansCode` exactly `10`.

Mutation controls run against the live SDK on every run: removing the `BillingReference` must produce BR-KSA-56 from the SDK *and* the structural check; removing the `InstructionNote` must produce BR-KSA-17 (error) from the SDK and the structural check; changing the code to `30` must be flagged structurally; the unmutated fixture must report neither rule. A silent oracle or a dead check fails the run (also unit-tested with a stub SDK in `test_notes.py`). Both rule ids are in `awj_forbidden_warning_codes`, so they can never be baselined as known gaps.

## 5. SDK results (238-R3.4.8, JDK 11, advisory, ephemeral synthetic credential)

| Fixture | Unsigned | Signed at run time |
|---|---|---|
| `awj-note-standard-refund-single-line` | XSD/EN/KSA/PIH PASSED | **GLOBAL PASSED** |
| `awj-note-standard-multi-line-discounts` | PASSED | **GLOBAL PASSED** |
| `awj-note-standard-tax-inclusive` | PASSED | **GLOBAL PASSED** |
| `awj-note-simplified-refund-single-line` | XSD/EN/PIH PASSED; KSA/QR/SIGNATURE FAILED *by construction* (unsigned) | **GLOBAL PASSED** (all six stages) |
| `awj-note-simplified-two-lines-partial` | as above | **GLOBAL PASSED** |
| `awj-note-standard-zero-rate` | EN FAILED (BR-CO-04, BR-CO-18; warnings BR-KSA-EN16931-08/09) | same — **documented REM-12 gap**, identical to the invoice fixture; not suppressed |

Independent OpenSSL checks (`crypto` rows) pass for all six signed notes and the 19 official signed samples. Existing baselines for the 14 invoice fixtures and the 19 official samples are unchanged. The only `-` line in the `baseline.json` diff is the JSON comma after the last forbidden code.

## 6. Tests

| Suite | Result |
|---|---|
| New PHP (`ZatcaNoteReasonTest` 4, `ZatcaCreditNoteXmlTest` 23, `ZatcaCreditNoteSigningTest` 6, `ZatcaCreditNoteFixtureDriftTest` 7, `ZatcaCreditNoteRealServiceParityTest` 7) | green on SQLite and PostgreSQL |
| Existing Zatca / CreditNote / Invoice / monetary / party tests | green; the only local failures are the 5 `Fuel*` tests that need `bcmath` (not installed in this container, installed in CI) |
| Python harness (`scripts/zatca-sdk/tests`) | OK, incl. new `test_notes.py`, the extended digest guard (both drift tests) and the four-known-gap ratchet test |
| Full suite | see PR for CI (SQLite + PostgreSQL) and CI Gate |

Highlights: totals must equal the line sums (inconsistent input rejected, never recomputed); unknown classification/reason/refund type rejected; XML-unsafe characters escaped; zero-rate lines get no category; no `Delivery`/second reason/second reference; builder classes contain no DB/clock/config/random calls; **no file under `app/Services`, `app/Http`, `app/Models`, `app/Console`, `app/Jobs` or `app/Listeners` references the new classes** (not-wired guard); the factory performs zero queries and leaves the invoice and note rows byte-identical.

## 7. Unresolved regulatory / design decisions (recorded, not guessed)

| # | Decision | State |
|---|---|---|
| U1 | `Invoice` root vs `CreditNote` for 381 | Standard is self-inconsistent; validator + all official samples say `Invoice`. **Live platform behaviour never tested.** |
| U2 | Are the five reasons a closed list on the live platform? | SDK accepts any non-empty text. AWJ accepts only the five (conservative). |
| U3 | Exact `EN \| AR` separator and trailing period | Sample strings used verbatim; SDK does not check the text. |
| U4 | More than one reason per note (KSA-10 is 0..*) | Out of scope; one reason. |
| U5 | One note against several invoices (BT-25 1..n, range form) | Out of scope; exactly one reference. |
| U6 | `PaymentMeansCode` for a **credit** (receivable-reducing) note — **D4** | No sourced code; such notes are rejected by the builder. Needs tax-adviser input before REM-18b can cover them. |
| U7 | Parties: copy the source snapshot vs fresh capture — **D5** | Copy implemented in the factory; a source without a snapshot is rejected (no live capture). |
| U8 | Non-15 % rates, zero/exempt categories | REM-12; gap shown, not suppressed. |
| U9 | Shared ICV/PIH chain across invoices and notes — **D7** | Not persisted here. REM-18b. |
| U10 | Deterministic order of note lines | `credit_note_lines` has UUID ids and no position column; PostgreSQL returns them unordered (the PG parity run exposed it). The XML line order follows relation order, which is acceptable for a document generated once and stored, but REM-18b must order explicitly when it persists. |
| U11 | 383 debit notes, purchase-side notes, sales-return/POS integration | Excluded by instruction; purchase-side is rejected explicitly. |
| U12 | QR tag 3 format (Q1) | Unchanged. |

## 8. Risks

* Fixtures prove the builder against the **offline** SDK only; ZATCA's live validation may add rules (U1, U2, U6).
* The factory is correct for notes whose source invoice carries a v1 snapshot; legacy sources are rejected by design — REM-18b must decide how to treat them (D5).
* The refactor of two shared helpers touches the invoice path; mitigated by byte-identical digests and the full invoice test set, but reviewers should read the `*FromAmounts` extraction carefully.

## 9. Recommended next step

Owner review of this PR and answers to **D4** (credit refunds), **D5**, **D7**, then REM-18b (persistence + posting, migration approval, ordered lines, shared chain), as laid out in `REM-18-CREDIT-DEBIT-NOTES-AUDIT.md` §8.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION RELEASE. NO LIVE ZATCA TRANSMISSION.**
