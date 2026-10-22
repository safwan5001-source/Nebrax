# REM-18b-3c: Implementation report: atomic cash sales credit-note (381) issuance

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration, no tenant activation, no live ZATCA transmission.** Branch `claude/rem-18b-3c-credit-note-issuance`. PR number, Head SHA and CI are posted on the PR (this file cannot name its own SHA). |
| Base | `origin/main` = `d1874065f580c805706c2b4cda7eb612708550e1` (contains #1593 rollout controls and #1594 F2 fences). |
| Scope | Issuer + allocator method + one wiring in `CreditNoteService::post()`, tests on both engines, docs. **No migration, no accounting change.** |
| Excluded (blocker) | Emergency-stop policy B: it changes the merged F2b contract. Not implemented; contract-change proposal written for owner approval (`REM-18b-3c-EMERGENCY-STOP-POLICY-B-CONTRACT-PROPOSAL.md`). |

## 1. What was implemented

* `ZatcaChainAllocator::recordCreditNote()`: the credit-note twin of `recordInvoice()`; inserts the immutable entry (`document_type = credit_note`, `type_code = 381`, subtype = source classification, `signed`, UUID, PIH, hash, issue time) into the **same shared chain**.
* `ZatcaCreditNoteIssuer` (new, `app/Services/Accounting`): reads the effective rollout state, applies the eligibility rules, reserves the chain slot, builds and hashes the XML with the existing `ZatcaCreditNoteInputFactory` / `ZatcaCreditNoteXml`, signs with the existing `ZatcaSignedInvoiceFinalizer` when a credential exists, records the chain entry, and returns the ZATCA columns for the single note update.
* `CreditNoteService::post()`: after the unchanged ledger post, the totals/status/journal/template attributes are held in memory, the issuer is called for sales notes, and **one** `save()` writes everything. Disabled tenants take the exact previous path (the issuer returns `null`).
* `ZatcaCreditNoteIneligibleException` (a `RuntimeException`, so the API answers 422 with a fixed message and a stable `reason` code).
* `CreditNote` casts `issued_at` (UTC second instant, as on invoices) and `party_snapshot` (array). The ZATCA columns are still **not** in `$fillable`; only the issuer writes them (via `forceFill`).

### 1.1 Eligibility (activated tenant only)

| Condition | If not met |
|---|---|
| `type = sales` | purchase notes are never touched (legacy posting) |
| `refund_type = cash` | `refund_type_unsupported`: no documented payment-means code for a receivable-reducing refund (D4 open); nothing invented |
| source invoice exists, is posted | `standalone_not_supported` / `source_invoice_not_posted` (BR-KSA-56: `BillingReference` is mandatory) |
| source invoice has a valid immutable party snapshot | `source_snapshot_missing` (invoices posted before REM-14 are excluded, no backfill) |
| class is `standard` or `simplified` | `document_type_unsupported` |
| lines satisfy `ZatcaCreditNoteInputFactory` / `ZatcaCreditNoteInput` | `document_invalid` (the factory message is kept) |

For an **activated** tenant every miss is an explicit refusal with a full rollback: no journal entry, no chain advance, no `posted` status, never a silent `NULL`/`disabled`/`not_generated`. Historical posted notes are never issued (F2 S4 forbids a retroactive decision).

### 1.2 Reason code (needs sign-off)

KSA-10 for the single supported case (a cash refund of a posted invoice) is the constant `goods_or_services_refund` ("In case of goods or services refund"). This is an **AWJ decision**, not a tax rule proven from an official source; it lives in one constant (`ZatcaCreditNoteIssuer::CASH_REFUND_REASON`).

### 1.3 Signing

The approved invoice policy is reused unchanged: no `ZatcaCredential` row means the tenant is still on the phase-1 contract (QR only, `signed = false`); any credential row sends the document through `ZatcaSignedInvoiceFinalizer`, which fails closed on any missing policy, key or certificate (tested). No placeholder signature is ever produced and SDK fixtures are not used as live compliance. The synthetic test credential is created per run (no key in the repository).

## 2. Transaction and lock sequence (single documented order)

`CreditNoteService::post()`, one database transaction:

1. `credit_notes` row `FOR UPDATE` (existing).
2. Source invoice row `FOR UPDATE`; lines re-derived under it (existing).
3. **Tenant anchor** `FOR UPDATE` inside `LedgerService::post` (existing); journal entry and lines inserted. *Accounting is finished here and is not touched again.*
4. Print-template revisions resolved (existing, reads).
5. In-memory fill of status/totals/journal id.
6. **Rollout state read**: one statement, no lock (`effectiveForTenant`).
7. Not enabled ⇒ `null` ⇒ step 11 with no ZATCA columns (legacy). Enabled ⇒ eligibility (refusal ⇒ rollback).
8. **Chain head** `FOR UPDATE` via `reserve()` (anchor re-lock is a no-op for the same transaction).
9. Build XML, hash, QR, optional signature (CPU only, no lock).
10. `recordCreditNote()`: insert the chain entry (trigger T4 advances the head atomically; the foreign key takes `FOR KEY SHARE` on the note row this transaction already holds).
11. **One** `UPDATE credit_notes`: `status = posted` + journal/totals + the twelve ZATCA columns. F2a sees the matching entry; F2b sees an explicit decision.
12. Commit.

### 2.1 Resolving the review inconsistency (control read vs chain head)

The 3a/3b text said "read the control last, after the chain head"; the 3c-0 review put the read before `reserve()`. **The correct and implemented order is: anchor ➜ control read ➜ chain head.** The head lock is only taken when issuing, and whether to issue is decided by the read, so the read necessarily precedes the head lock. This is safe because the read takes **no** lock (no edge in any lock cycle) and tenant-scope control writers serialise behind the anchor we already hold, so the tenant state cannot change under the transaction. Only the platform stop is not behind the anchor; if it flips between the read and the `UPDATE`, the F2b trigger re-evaluates in the `UPDATE` statement and refuses (fail closed, full rollback); an explicit `generated` decision is valid in every state. `CLAUDE.md` was corrected accordingly.

No lock-order inversion or cycle was introduced: the issuer adds only the chain-head lock after the anchor, exactly the order of `ZatcaService::buildFor` for invoices, and the chain entry/note triggers use plain MVCC reads.

## 3. Files changed

| File | Kind |
|---|---|
| `app/Services/Accounting/ZatcaCreditNoteIssuer.php` | new |
| `app/Support/ZatcaCreditNoteIneligibleException.php` | new |
| `app/Services/Accounting/ZatcaChainAllocator.php` | `recordCreditNote()` added |
| `app/Services/Accounting/CreditNoteService.php` | issuer wiring (fill in memory, one save); constructor gets the issuer |
| `app/Models/CreditNote.php` | two casts |
| `tests/Feature/ZatcaCreditNoteIssuanceTest.php` | new, 17 tests, both engines |
| `tests/Feature/ZatcaCreditNoteIssuancePostgresTest.php` | new, 3 fork-based tests (fail, not skip, without `pcntl`) |
| `tests/Feature/ZatcaChainSchemaTest.php`, `ZatcaCreditNoteFenceTest.php`, `ZatcaCreditNoteXmlTest.php`, `ZatcaRolloutControlTest.php` | the four "not wired yet" guards were rewritten into "only the issuer is wired" guards (stricter, not removed) |
| `CLAUDE.md`, task queue, this report, the policy B proposal | docs |

Untouched: every migration (**no schema change**), `LedgerService`, `InvoiceService`, `ZatcaService`, signing/QR/XML builders, routes, resources, `Settings`.

## 4. Accounting invariants

* The journal is **not** touched: the issuer runs after `LedgerService::post` and never reads or writes journal tables. Test `issuance_does_not_change_the_journal_in_any_way` posts an identical note with and without issuance and compares account codes, debits and credits line by line, plus subtotal, tax and total.
* One journal entry per note, even under concurrency (asserted in the PostgreSQL tests).
* No VAT, rounding, inventory, COGS or account-role change. Money stays integer minor units.
* Entry for the new operation (cash sales credit note, unchanged by this slice):

| Account | Debit | Credit |
|---|---|---|
| 4110 Sales | subtotal | |
| `tax_output` (default 2120) | tax | |
| 1110 Cash | | total |

## 5. Tests and results

| Run | Result |
|---|---|
| `ZatcaCreditNoteIssuanceTest`, SQLite / PostgreSQL 16 | 17 passed / 17 passed |
| `ZatcaCreditNoteIssuancePostgresTest` (`pcntl_fork`, `lock_timeout=60s` as CI) | 3 passed, ran not skipped; 6 consecutive runs stable, no deadlock |
| Regression filter (`Zatca`, `TaxN01`, `CreditNote`, `PublicApi`, `BranchIsolation`, `PostgresTestLockTimeout`, `ReturnSource`, `PosExchange`, `PosReturn`, `InvoicePartySnapshot`, `LedgerTest`, `InvoiceTest`) incl. F1/F2/chain/rollout suites and `CreditNotePosLockOrderPostgresTest`, SQLite | 998 passed, 41 skipped (8374 assertions), 0 failed |
| Same filter, PostgreSQL 16 with `PGOPTIONS='-c lock_timeout=60s'` | 1037 passed, 2 skipped (9156 assertions), 0 failed |
| Full suite, SQLite (first run of this branch) | 8157 passed, 28 failed, 167 skipped |
| Full suite, PostgreSQL 16, `lock_timeout=60s` (first run of this branch) | 8319 passed, 29 failed, 4 skipped |

Failures in the full runs, all explained: 26 `Fuel*` (`bcmath` is not installed in this container; CI has it); `AiPaidProviderDisabledTest` (SQLite) and `StorefrontMediaApiTest` (PostgreSQL), both failing without this change; `InvoicePartySnapshotTest` on both engines, a static guard listing the reviewed writers of `party_snapshot`, which this slice legitimately extended (the issuer copies the source invoice snapshot); fixed in a follow-up commit and now passing; and, on PostgreSQL only, one `ZatcaMonetaryXmlTest` case that asserts the order of invoice lines (`invoice_lines` has no sequence column), which passes 6/6 in isolation and in the regression run, and involves no file this slice touched. The full suites after the fix run in CI.

Covered: successful eligible issuance (entry, columns, hash, QR, UUID, ICV, PIH, BillingReference, payment means 10, snapshot copied from the source); shared ICV/PIH across invoices and notes (genesis, continuity, signed and unsigned); exact journal preservation; credit refund, standalone, missing snapshot and unsupported class refused on an activated tenant with reason and full rollback; purchase notes untouched; unconfigured, disabled and platform-stopped tenants keep the legacy path with no chain rows; missing signing policy ⇒ fail closed and full rollback; a failure right after the chain entry rolls back entry, head and journal; tenant isolation (independent chains, no leak of activation); immutable issued identity and refusal of a second post; default off (no controls, dispatch disabled). PostgreSQL: concurrent notes and invoices on one chain without deadlock, postings racing activation flips (every note ends issued, legacy or refused, never inconsistent; ICV contiguous), SIGKILL after the entry insert.

Mutation checks (each makes the suite fail): dropping `recordCreditNote` (7 failures), allowing credit refunds, never issuing (11), allowing standalone, ignoring credentials.

## 6. Security and tenant isolation

* Every read and write is keyed by the note's tenant; the allocator re-checks the tenant context and the slot tenant; the chain entry carries the tenant and the F2 triggers reject any mismatch.
* The issuer reads the rollout controls and never writes them; there is no route, command or UI (asserted).
* Exceptions carry fixed text and a short reason code, never values, keys or XML. No secret is logged or committed.
* The dispatch kill switch (`zatca.transport.dispatch_enabled`, default `false`) is untouched; nothing calls the network.

## 7. Remaining risks and blockers

| Item | State |
|---|---|
| **Policy B (blocker)** | Under a platform stop an enabled tenant still posts legacy notes with no decision, which stay undecided forever (S4). Fixing it changes the merged F2b contract. Proposal written; **owner approval needed.** |
| **Pre-existing PostgreSQL deadlock (found, not caused here)** | Posting a **cash** invoice takes `FOR UPDATE` on cash account 1110 (`CashBankAccountService::bootstrapDefaults`) while a cash credit note holding the tenant anchor inserts a journal line on 1110 (`FOR KEY SHARE`). Reproduced on untouched `main` (d187406) with the tenant **not** activated, so it affects today's cash credit notes. Same class as REM-04/SEC-02 (fixed there for partners with `FOR NO KEY UPDATE`). Not fixed here (no unscoped refactor, no locking change outside scope); the transaction aborts and rolls back atomically. Proposed small fix: `FOR NO KEY UPDATE` on that account lock; needs approval. The concurrency tests use credit invoices to avoid it and say so. |
| D4 (credit refunds) | Still unresolved: no documented payment-means code; 100 % of default (`credit`) notes are refused for activated tenants. Activating a tenant before D4 would block its non-cash credit notes. |
| KSA-10 reason | `goods_or_services_refund` for every cash refund is an AWJ decision. |
| Line order | `credit_note_lines` has no sequence column; the XML lines are ordered by id (deterministic, arbitrary). Harmless to validity, noted since 18a. |
| Open tax questions | Q1/Q2 (QR tag 3 format, region), REM-12 (non-15 % categories), 383, standalone notes: unchanged and excluded. |
| Phase 1 versus signed | Without a credential the note is a phase-1 document (like invoices today); mixed chains already exist. Phase 2 readiness is a separate activation gate. |

## 8. Branch, PR, SHAs

Branch `claude/rem-18b-3c-credit-note-issuance`; Base `d1874065f580c805706c2b4cda7eb612708550e1`; the Draft PR number, Head SHA and CI are on the PR.

## 9. Recommended next action

Owner decisions, in this order: (1) approve or amend policy B (proposal); (2) approve the one-line cash-account lock fix (a separate small slice); (3) decide D4 for credit refunds and confirm the KSA-10 constant. Then an activation-readiness review (credentials, phase-2 policy, pilot tenant) before any tenant is enabled.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO TENANT ACTIVATION. NO LIVE ZATCA TRANSMISSION.**
