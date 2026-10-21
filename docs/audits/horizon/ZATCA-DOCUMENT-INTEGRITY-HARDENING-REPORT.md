# TAX-ZATCA: document integrity hardening before transmission

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no migration, no live ZATCA transmission. Submission stays disabled (`ZATCA_SUBMISSION_DISPATCH_ENABLED=false`).** PR number, Head SHA and CI are posted on the PR (this file cannot name its own SHA). |
| Base | `origin/main` = `f919de6fdc1799f5e28d0646350e092063a94816` (REM-18b-2, PR #1588). |
| Closes | Integrity gaps A, B and C found in the REM-18b-2 review (`REM-18b-2-IMPLEMENTATION-REPORT.md` §8b). |
| Not changed | ICV/PIH allocation · XML building, hashing and signing · accounting and posting · tenant isolation · schema (no migration) · API contracts · F1 triggers · dispatch configuration · any issued or historical document. |

## 1. Phase A: where the guard must sit (verdict: GO)

Read-only review of every path that can reach ZATCA:

| Step | Code | Notes |
|---|---|---|
| Entry 1: manual request | `ZatcaSubmissionController::store` → `ZatcaSubmissionService::requestManual` | Creates the attempt and stores `request_hash = sha256(zatca_xml)` **of whatever XML is stored at that moment**. |
| Entry 2: queueing | `ZatcaSubmissionQueue::enqueue` (called by `store` when dispatch is enabled, and by `ZatcaSubmissionController::dispatch` for retries and re-queues) | Only checked `status`/non-empty XML. |
| Entry 3: worker | `SendZatcaSubmission` job → `ZatcaSubmissionDispatcher::dispatch` → `assertSnapshot` | `assertSnapshot` compared `request_hash` with the current XML only. |
| Transport | `ZatcaHttpTransport::submit` | The **only** call site is `ZatcaSubmissionDispatcher::dispatch`. A repository search finds no other HTTP call to a ZATCA host (`fatoora` appears only in the endpoint allow-list). No bypass exists. |

**Root cause.** `request_hash` proves only that the XML did not change *since the attempt was registered*. Nothing compared the stored XML or `zatca_hash` with the issue record, so: (A) a changed `zatca_hash` was sent as is (only its Base64 shape was checked); (B) an XML changed *before* registration became the "snapshot" because `request_hash` was computed from it; (C) a changed XML on an older invoice was never examined by any later step.

**Placement.** The earliest reliable point is attempt creation, because that is where the first value derived from mutable data (`request_hash`) is frozen. The check must then be repeated wherever the data can have changed again, and last before the transport. The transport is reachable only through the dispatcher and the dispatcher verifies and sends the same in-memory invoice object (no re-read between the check and `submit`), so a single final check is sufficient there. A complete placement exists without schema, API or posting changes, so the verdict is GO.

## 2. What was built

`App\Services\Accounting\ZatcaIssuedDocumentIntegrity::assertIntact(Invoice)` (read-only, fail-closed) and `App\Support\ZatcaIntegrityException` (a `RuntimeException` with a fixed message and a short `reason` code; no hash, XML or id is ever put in a message or a log).

For an invoice that has a shared-chain entry, all of these must hold:

1. `ZatcaInvoiceHasher::hash(zatca_xml)` (the existing official canonical hash; no new algorithm) equals `zatca_chain_entries.hash`.
2. `invoices.zatca_hash` equals `entry.hash`.
3. Entry identity: same tenant as the invoice, `document_type = invoice`, `type_code = 388`, `invoice_id` equal to the invoice, no credit-note id, chain of the same tenant with `chain_key = tenant`, and an ICV above the chain seed and not above its head.
4. ICV, UUID and PIH (`zatca_previous_hash`) of the invoice equal those of the entry.

The ICV/PIH/UUID embedded in the XML need no separate comparison: they are inside the canonical hash (only `UBLExtensions`, `Signature`, the QR reference and comments are excluded), so check 1 already covers them.

Reasons: `tenant_context`, `entry_missing`, `entry_tenant`, `entry_document`, `entry_chain`, `icv_mismatch`, `uuid_mismatch`, `pih_mismatch`, `hash_column_mismatch`, `xml_missing`, `xml_unreadable`, `xml_hash_mismatch`.

### Guard locations

| # | Where | Effect of a failure |
|---|---|---|
| 1 | `ZatcaSubmissionService::requestManual`, inside the transaction, after the invoice row is locked and after the idempotency/accepted/pending checks, **immediately before the attempt is created** | No attempt is created; the API answers 422 (a `RuntimeException`, as for other pre-flight rejections) |
| 2 | `ZatcaSubmissionQueue::enqueue`, after the existing snapshot check and **before `queue_count` is touched and the job is dispatched** (covers new queueing, retries and re-queues, from `store` and from `dispatch`) | Nothing is queued; 422 on `dispatch` |
| 3 | `ZatcaSubmissionDispatcher::assertSnapshot`, **after** the existing checks (status, non-empty XML/hash, `request_hash`, document type), i.e. before credentials are resolved and before `ZatcaHttpTransport::submit` | The attempt is persisted as `failed` / `submission_preflight_failed` / `retryable=false` exactly like any snapshot failure; the structured log carries `cause_code = snapshot_mismatch` and `exception_class = ZatcaIntegrityException`; no network request |

The new guard comes after the old checks so existing diagnostics (for example a changed XML after registration still reports a plain `RuntimeException`) keep their classes. The guard performs read queries only (a static test asserts the class contains no write call).

A replay of an existing idempotency key returns the stored attempt without creating anything, so it needs no check. The tenant context must equal the invoice's tenant, otherwise the guard fails closed (a different context would hide the entry and make the invoice look legacy).

## 3. Legacy invoices (issued before the shared chain)

A document is legacy when it has no entry **and** either its tenant has no chain head, or its ICV is not above the head's seed, or it has no ICV. For these the guard does nothing: no entry is required and the raw `zatca_hash` is not reinterpreted (pre-REM-17 raw hashes may differ from the canonical hash legitimately). Their protection is unchanged: `request_hash` after registration, the transport's Base64/32-byte hash check, and the existing type checks.

An invoice with no entry whose ICV is above the seed of a tenant that has a head cannot exist (fence F1), so it is rejected (`entry_missing`) rather than treated as legacy. The same applies to a tenant context that does not match.

## 4. Behaviour change in an existing test

`TaxN01ZatcaDispatcherDiagnosticsTest::an_invalid_stored_hash_rejected_inside_the_transport_is_a_transport_error` expected a malformed stored hash to be rejected inside the transport. For a chain invoice it is now rejected earlier, at the snapshot stage, by the new guard. The test stays a negative test (still `failed` / `submission_preflight_failed`, still no network request) and now expects `snapshot_mismatch` with `ZatcaIntegrityException`; it was renamed accordingly. The transport's own shape check remains as a second defence and is covered for a legacy invoice (`the_transport_format_check_still_rejects_a_malformed_hash_on_a_legacy_invoice`) and by `ZatcaHttpTransportTest`. The two `known_gap_*` characterisation tests from the REM-18b-2 review were retired from `ZatcaChainIssuedInvoiceIntegrityTest` because their gaps are now closed, and replaced by rejection tests in `ZatcaSubmissionIntegrityTest`. No other existing test changed its expectation.

`ZatcaChainSchemaTest::only_the_allocator_writes_the_chain...` now allows the guard's file by name and additionally asserts that the guard contains no write operation.

## 5. Tests

`tests/Feature/ZatcaSubmissionIntegrityTest.php` (SQLite and PostgreSQL), mapped to the required cases:

| # | Case | Test |
|---|---|---|
| 1 | `zatca_hash` alone before attempt creation | `a_hash_only_change_is_rejected_before_the_attempt_is_created` |
| 2 | `zatca_xml` alone before attempt creation | `an_xml_only_change_is_rejected_before_the_attempt_is_created_so_it_can_never_become_the_snapshot`, plus the API 422 test |
| 3 | Either field after creation, before dispatch | `a_hash_change_after_…`, `an_xml_change_after_…`, `the_dispatcher_rejects_a_consistent_but_wrong_snapshot_the_request_hash_alone_would_accept`, `an_attempt_is_not_queued_when_…` |
| 4 | Retry with a modified invoice | `a_retry_with_a_modified_invoice_is_rejected_and_no_new_attempt_is_created` |
| 5 | Valid unchanged invoice | `an_unchanged_issued_invoice_passes_every_check_and_is_sent_with_the_chain_hash` |
| 6 | Legacy invoice without an entry | `a_legacy_invoice_without_a_chain_entry_keeps_working_…`, `a_legacy_invoice_stays_legacy_after_its_tenant_opens_a_chain_…`, `the_transport_format_check_still_rejects_…` |
| 7 | Cross-tenant or wrong-document entry | `an_entry_that_is_invisible_or_belongs_to_another_document_fails_closed` |
| 8 | ICV/UUID/PIH mismatch | `an_icv_uuid_or_pih_that_differs_from_the_issue_record_fails_closed` (also hash column, missing and unreadable XML) |
| 9 | No network call on failure | every rejection test uses `Http::fake()` or `Http::preventStrayRequests()` and `assertNothingSent` / `assertSentCount` |
| 10 | `zatca_cleared_xml` | `writing_the_cleared_xml_stays_valid_and_does_not_disturb_the_integrity_check` (and the existing clearance tests) |
| C | Older invoice with changed XML | `an_older_invoice_whose_xml_was_changed_can_never_be_transmitted_…` |

The DB cannot produce an ICV/UUID/PIH mismatch (fence F1 freezes them), so case 8 changes the in-memory model and proves the guard rejects it if it ever arrives (defence in depth).

Mutation checks (done locally, not committed): with the guard body disabled 12 of the new and TaxN01 tests failed; with only the dispatcher call removed 3 failed (the earlier version of the after-attempt tests passed vacuously through `preventStrayRequests`, so they now use `Http::fake()`).

### Results (local; CI is the authority)

| Run | Result |
|---|---|
| `ZatcaSubmissionIntegrityTest` + `ZatcaChainIssuedInvoiceIntegrityTest` + TaxN01 + submission/transport suites, SQLite | 55 passed, 1 skipped |
| Regression filter `Zatca\|TaxN01\|Invoice\|CreditNote\|PublicApi\|Rem0`, SQLite | 1099 passed, 6 failed (all environmental, below; plus the schema-scan test that this slice then updated, now green on both engines) |
| Same filter, PostgreSQL 16 | 1130 passed, 6 failed (same) |
| Full suite, SQLite | 7994 passed, 27 failed, 151 skipped (69941 assertions) |
| Full suite, PostgreSQL 16 (`lock_timeout=60s`) | 8141 passed, 27 failed, 4 skipped (71266 assertions) |

The 27 failures are environmental and identical to the previous slice: 26 `Fuel*` (`bcmath` is not installed in this container; CI has it) plus `AiPaidProviderDisabledTest` on SQLite or `StorefrontMediaApiTest` on PostgreSQL (both also fail without this change). SDK conformance: no XML-building or signing code changed, so the local harness was not re-run; CI runs `zatca-sdk-conformance` because `app/Services/Accounting/Zatca*` changed (advisory).


## 6. Remaining security risks

| Risk | State |
|---|---|
| Legacy invoices (pre-chain) | Modified `zatca_xml`/`zatca_hash` **before** an attempt is registered is still accepted (no immutable reference exists). Mitigation would need a one-off, owner-approved attestation of historical hashes; not done (no historical rewrite). |
| Database does not freeze `zatca_xml`/`zatca_hash` | By decision for this slice. A privileged writer can change them any time; the guard makes any such change fail closed before transmission and Q7 finds the `zatca_hash` divergence offline. Freezing remains an optional later hardening. |
| Time of check vs. time of send | Closed inside the dispatcher (same in-memory object). Between registration and dispatch the data can change, which is exactly why the check repeats. |
| Next issuance still verifies only its predecessor | Unchanged by design; an older tampered invoice can no longer be transmitted, and an offline chain walk finds it. |
| `zatca_document_type` is mutable and not chain-pinned | Not covered here (the entry stores `subtype` but the guard does not compare it, because an existing test changes the type on purpose). `assertSnapshot` already binds the attempt type to the invoice type. |
| Invoice with XML but no ICV | Treated as legacy. Cannot be produced by any code version since ICV exists; a rogue direct write could. Out of scope. |
| Credit notes and 383 | Not issued through the chain yet (REM-18b-3); this guard is invoice-only. |

## 7. Recommended next step

Review and merge this slice. Then REM-18b-3 (credit-note issuance through the same allocator, F2, activation row off) after the open owner decisions O-R2, O-R4 and O-2…O-6. Before any real transmission is enabled, also run the Q0–Q7 read-only gates of the REM-18b-2 runbook on the target environment.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO LIVE ZATCA TRANSMISSION.**
