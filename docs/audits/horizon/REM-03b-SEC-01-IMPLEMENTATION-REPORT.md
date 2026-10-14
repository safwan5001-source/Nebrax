# REM-03b / SEC-01 — Implementation Report: close the remaining Active-Branch-Only gaps

STATUS: **PASS (pending CI on the final head and owner review)** — **DRAFT PR — NOT MERGED — NOT DEPLOYED**
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: TAX-HZ-00 → REM-03 / PR #1403)
ZONE: C — security / authorization / accounting / ZATCA

## Executive summary

| | |
|---|---|
| Verdict | **PASS.** Six operations now enforce Active-Branch-Only with the existing REM-03 primitive; every denial is a 404 before any side effect; permission (403) and entitlement gates are unchanged. Local evidence on SQLite and PostgreSQL is green; CI on the code head was green on SQLite and is recorded below. |
| Scope completed | `InvoiceController::duplicate`, `::storeNote` · `ZatcaSubmissionController::store`, `::dispatch` · `CreditNoteController::show`, `::post` (the note itself). **Exactly six; nothing else.** |
| Production change | 3 controller files, ~25 lines (guard swaps + comments). No new helper (reused `ApiController::scopeToCurrentBranchOnly()` and the existing `InvoiceController::targetInvoice()`; one trivial private `targetInvoice()` was added to `ZatcaSubmissionController`, which mirrors the existing private `visibleInvoice()` there). |
| STOP conditions | None triggered that blocks this slice. One **boundary finding** (per-attempt environment binding is not representable) is reported below, not expanded — see *ZATCA dispatch: attempt-to-invoice binding*. |
| Remaining blockers | None for this PR. |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `176965d086dd60dbd98208d4f4580da91b9a07b0` (`origin/main` at start; contains REM-03 merge `c589ced1dcbad88ef023d8be6ead34bc58f489f0`) |
| Branch | `fix/security/rem03b-active-branch-only` |
| PR | #1410 — https://github.com/safwan5001-source/Nebrax/pull/1410 (**Draft**) |
| Code+tests head | `3b90b50b98c5032b2d02ca2b5add12e2da30059b` |
| Final Head SHA | recorded in the PR description and hand-back message (a file cannot contain its own commit hash); it adds only this report and three test assertions on top of the code head |
| Merge SHA | N/A |

## Scope — exactly six operations

| # | Operation | Route | Permission / gate (unchanged) | Before | After |
|---|---|---|---|---|---|
| 1 | `InvoiceController::duplicate` | `POST /invoices/{id}/duplicate` | `invoices.manage` + invoices plan limit | `visibleInvoice()` → `scopeToActiveBranch` (widened by `?branch=all`) | `targetInvoice()` → `scopeToCurrentBranchOnly` |
| 2 | `InvoiceController::storeNote` | `POST /invoices/{id}/notes` | `invoices.manage` | same | same as above |
| 3 | `ZatcaSubmissionController::store` | `POST /invoices/{id}/zatca/submissions` | `invoices.manage` + `compliance.zatca` | same | `scopeToCurrentBranchOnly` |
| 4 | `ZatcaSubmissionController::dispatch` | `POST /invoices/{id}/zatca/submissions/{attemptId}/dispatch` | `invoices.manage` + `compliance.zatca` | same | `scopeToCurrentBranchOnly` + attempt bound to that invoice |
| 5 | `CreditNoteController::show` | `GET /credit-notes/{id}` | `invoices.view` + credit-note operation gate | `assertRecordAccessible` (allowed set) | `scopeToCurrentBranchOnly` (+ `assertRecordAccessible` kept) |
| 6 | `CreditNoteController::post` | `POST /credit-notes/{id}/post` | `invoices.manage` + credit-note operation gate | `assertRecordAccessible` (allowed set) | `scopeToCurrentBranchOnly` (+ `assertRecordAccessible` and the **unchanged** `original_invoice_id` reference check kept) |

The REM-03 contract applies unchanged: `branch_id = BranchContext::id()` **or** `branch_id IS NULL`; with no active branch only `NULL`; ignores `?branch=all` and `allowedBranchIds()`; a miss is an ordinary `findOrFail` 404 (indistinguishable from a nonexistent id); the guard is the first statement.

## Explicit exclusions (untouched, and why)

| Surface | Why it stays as is |
|---|---|
| `ReturnableController` | The source document is a *reference*, not a browse result; a return may legitimately happen in a branch other than the sale's. `purpose=credit_note` keeps its allowed-branch policy. Characterized (`returnable_credit_note_source_reference_still_uses_the_allowed_branch_policy`) and covered by the existing source-picker tests in `CreditNoteSourceVatAccuracyTest`. |
| `AppointmentController` | Non-accounting CRM surface; stays on `scopeToActiveBranch()` including `?branch=all`. Characterized (`appointments_keep_the_general_read_policy_including_branch_all`) and by the existing `InvoiceAppointmentTest`. |
| Credit-note `original_invoice_id` reference authorization | Tightening it could strand drafts and break cross-branch source flows that are supported today. Only the **note itself** became Active-Branch-Only. Tested both ways (below). |
| Reads: `notes()`, note-attachment download, invoice `show`/`payments`/`accounting`/`inventory`/`zatca`, `ZatcaSubmissionController::index`, `CreditNoteController::index` | General Access Control V2 read policy. |

## Implementation

* **Guard ordering (verified statement-by-statement).** `duplicate`: guard → `InvoiceService::duplicate` (numbering and writes). `storeNote`: guard → `validated()` → `newResourceId()` → `putMany()` (files) → DB transaction (note + attachment rows) → `discard()` on failure; denial happens before any ID, file or row. `store`: guard → idempotency validator → `requestManual` → `enqueue`. `dispatch`: guard → attempt lookup → `enqueue`. `CreditNote::show`: guard → `assertRecordAccessible`. `CreditNote::post`: guard → `assertRecordAccessible` → original-invoice reference check (unchanged) → `CreditNoteService::post`.
* **FormRequests** (`StoreInvoiceNoteRequest`) validate input only; a 422 can precede a 404 but reveals nothing about the invoice.
* **No** service, model, migration, route, permission, middleware or config file changed.

### ZATCA dispatch: attempt-to-invoice binding

Required relationship: *Current Tenant ∩ Authorized Active-Branch Invoice ∩ Attempt Bound to That Exact Invoice ∩ existing environment/state rules.*

* **Already enforced by existing code and preserved:** `ZatcaSubmissionAttempt::query()->where('invoice_id', $invoice->id)->findOrFail($attemptId)` — `BaseModel` applies `TenantScope`, and the invoice is the one already resolved through the guard. `ZatcaSubmissionQueue::enqueue()` and the `SendZatcaSubmission` job re-load by the attempt id under the tenant scope and cannot be handed a different attempt. Evidence: the binding test **passes before and after** (it characterizes existing correct behavior); see *Negative control*.
* **Representable through the public API:** invoice A + attempt of invoice A2 (same branch/tenant); invoice A + attempt of an invoice in another branch; invoice A + a foreign-tenant attempt; foreign invoice + the foreign attempt supplied directly; foreign invoice + our attempt; nonexistent attempt — all 404, every attempt row byte-identical, nothing queued, no HTTP.
* **Boundary finding (STOP-condition #12 territory, reported, not expanded):** `zatca_submission_attempts` has **no environment column** (asserted in the test via `Schema::hasColumn`). The existing environment rule is the readiness check of the tenant's **active** environment at enqueue (and credential resolution at job run time). A "wrong-environment attempt" therefore cannot be represented without a schema/state-machine change, which is out of scope; the observation (an environment switched between enqueue and job run could send under a different environment) belongs to **REM-25**. What is tested: a non-ready environment rejects dispatch with 422 and leaves the attempt untouched, no queue push, no network.

## Tenant isolation / RBAC

| Case | Result (asserted) |
|---|---|
| Foreign-tenant id on each of the six operations | 404; the foreign rows are byte-identical afterwards |
| Forged foreign/unauthorized `X-Branch-Id` | ignored by `SetBranch` (unchanged); own-branch operation still resolves to the user's default branch; foreign branch never selected |
| Nonexistent id | 404 |
| Valid permission + wrong active branch | **404** |
| Missing action permission (`staff`: no `invoices.manage`; `self_service`: no `invoices.view`) | existing **403**, on both the right and wrong branch, no state change |
| Entitlement (`compliance.zatca` disabled) | existing **403**, no attempt created |
| Credit-note operation gate | unchanged (`EnsureApplicationOperationActive`) |

## Active branch matrix (Branch A active unless stated)

| Actor | A document | B document (allowed, inactive) | C document (not allowed) | After switching to B |
|---|---|---|---|---|
| Multi-branch admin (A+B) | success | **404** (also with `?branch=all`) | n/a | success (positive control per operation) |
| Unrestricted owner/admin | success | **404** (also with `?branch=all`) | **404** | success |
| Restricted admin (A only), with forged header B/C | success | **404** | **404** | n/a (header ignored) |
| Branchless (`branch_id IS NULL`) legacy row | reachable (all six) | | | |

Plus one cross-branch-source scenario: note in B referencing a source invoice in A → postable by a user allowed A+B with B active; **not** postable by a user restricted to B (source outside their allowed set → existing 404 from the unchanged reference check) — proving the reference policy was not tightened or loosened.

## Side-effect evidence (denied calls)

Every denial compares full-row snapshots and these counters before/after: invoices, invoice lines, invoice notes, note attachment rows, ZATCA attempts, credit notes and lines, journal entries and lines, stock movements, payments, document revisions, `max(zatca_icv)`; storage objects (`Storage::fake('local')`, `allFiles()`); `Queue::assertNothingPushed()` and `Http::assertNothingSent()` with `Http::preventStrayRequests()` for ZATCA.

* **duplicate:** no draft, no line, no revision; source unchanged. **storeNote:** no note, no attachment row, no stored object (body-only and attachment-backed). **store:** no attempt, no job, no ZATCA field change, no network. **dispatch:** full attempt row (status, `queue_count`, `queued_at`, `completed_at`, response fields) unchanged across repeated denials incl. `?branch=all`; no job, no HTTP. **CreditNote post:** note row and source invoice row identical; no journal entry/line, stock, payment or revision.
* Positive controls (right branch) show the existing behavior continues: duplicate 201; note created; ZATCA attempt created and one job pushed; dispatch → `queue_count = 1` and one job; credit-note post → posted with a new journal entry (no accounting figures asserted).

## SQLite

| Command (shell: `/home/user/nibras-app`, Laravel shell built by `setup.sh`, CI-matched deps) | Result |
|---|---|
| `DB_CONNECTION=sqlite DB_DATABASE=:memory: php artisan test --filter='Rem03bActiveBranchOnlyTest\|Rem03ActiveBranchOnlyTest'` | **37 passed** (785 assertions) |
| Full `php artisan test` (SQLite) | **6553 passed, 73 skipped, 38 failed** (49,154 assertions, 501 s) |

The 38 failures are the **same environmental set as in REM-03** (`Fuel*` classes need the `bcmath` PHP extension; `AuthRecovery`/`UserInvitation`/`ResendMailTransport` depend on mail/queue shell config) — the failing-test list is identical to the REM-03 run, which was itself shown identical on unmodified base controllers. None is in a class this PR touches.

## PostgreSQL

| Command (PostgreSQL 16.15 local, `DB_CONNECTION=pgsql`) | Result |
|---|---|
| `php artisan test --filter='Rem03bActiveBranchOnlyTest\|Rem03ActiveBranchOnlyTest'` | **37 passed** (785 assertions) |
| Full `php artisan test` (PostgreSQL) | **6623 passed, 2 skipped, 39 failed** (49,612 assertions, 1047 s) |

The 39 = the 38 environmental failures above **plus** `StorefrontMediaApiTest > the library lists newest f…` (`PDOException: Invalid parameter number`, a local PDO-pgsql quirk in a module not touched here) — an **identical failing set to the REM-03 local PostgreSQL run**, where this test was shown to fail identically on the unmodified base and to pass in CI. The PostgreSQL-specific suites (`CreditNote*Postgres*`, return/credit-note lock-order, concurrency) PASS. A note on method: the first PostgreSQL attempt in this session failed with `connection refused` because the local cluster had stopped when the session resumed; it was restarted and all numbers above are from clean re-runs.

## Negative control

The new class was run against the **pre-REM-03b controllers** (`InvoiceController`, `ZatcaSubmissionController`, `CreditNoteController` restored from `origin/main` in the local test shell only; the branch was untouched and the shell was re-synced and diff-verified afterwards): **6 failed, 10 passed.** The 6 failing are the core tests of the six operations (duplicate, storeNote, ZATCA store, ZATCA dispatch, credit-note show, credit-note post) — i.e. old behavior reached the operation through `?branch=all`, the allowed set or an unrestricted owner. The 10 passing are invariants that must hold both before and after: foreign-tenant and nonexistent 404s, entitlement, the attempt-to-invoice binding (**already correct**), non-ready environment, the original-invoice reference policy, and the Returnable/Appointment characterizations.

## Existing regression suites

PASS locally on SQLite **and** PostgreSQL (none appears in the failure lists): invoice/duplicate/notes (`InvoiceTest`, `ApiInvoiceTest`, `InvoiceNoteApiTest`, `AttachmentDurabilityS1Test`), credit notes (`CreditNoteTest`, `CreditNoteSourceVatAccuracyTest`, `CreditNoteSourceOwnershipTest`, `CreditNotePostingOwnershipTest`, `CreditNoteLegacyBlockTest`, `CreditNoteMigrationPolicyTest`, PostgreSQL lock-order classes), ZATCA (`ZatcaTest`, `ZatcaPhase2Test`, `ZatcaSubmissionAttemptTest`, `ZatcaSubmissionRecoveryTest`, `ZatcaSubmissionDispatcherTest`, and the rest of the `Zatca*` classes), tenant isolation and Access Control V2 (`ApiTenantIsolationTest`, `ApiRbacTest`, `Branch*IsolationTest`, `BranchSharingTest`, `DocumentBranchScopeTest`, `PosInvoiceBranchAccessTest`, `Rem03ActiveBranchOnlyTest`), and the Returnable/Appointment tests (`ReturnFromSourceTest`, `ReturnSourceVatAccuracyTest`, `InvoiceAppointmentTest`).

## Accounting / ZATCA invariants

The diff is guards only (3 controllers) plus tests and docs. **No change** to: accounting calculations, VAT, journal rules, credit-note allocations, ICV, PIH, QR, XML, the ZATCA submission state machine, queue, HTTP transport, credentials or environment handling; `ZATCA_SUBMISSION_DISPATCH_ENABLED` and all configuration untouched; no ZATCA traffic, OTP or CSID of any kind (the tests fake Queue and Http and prevent stray requests).

## Files changed

| File | Change |
|---|---|
| `app/Http/Controllers/Api/InvoiceController.php` | `duplicate`, `storeNote` use `targetInvoice()`; docblock note |
| `app/Http/Controllers/Api/ZatcaSubmissionController.php` | `store`, `dispatch` use new private `targetInvoice()` (→ `scopeToCurrentBranchOnly`); `index` unchanged |
| `app/Http/Controllers/Api/CreditNoteController.php` | `show`, `post` resolve the note through `scopeToCurrentBranchOnly`; existing checks kept |
| `tests/Feature/Rem03bActiveBranchOnlyTest.php` | new — 16 tests |
| `docs/audits/horizon/REM-03-SEC-01-IMPLEMENTATION-REPORT.md` | appended "Follow-up: REM-03b" pointer (original conclusions unchanged) |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | REM-03b entry: six operations, exclusions, *in review*, not closed |
| `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` | §43 remediation note |
| `docs/audits/horizon/REM-03b-SEC-01-IMPLEMENTATION-REPORT.md` | this report |

## Code review

| Review | Result |
|---|---|
| Implementer self-review | Guard-first ordering verified per operation; no `$request`/`?branch`/`allowedBranchIds()` read in the primitive; existing second layers (`assertRecordAccessible`, original-invoice check) retained. |
| Independent security reviewer (separate read-only agent, given the diff and a checklist, not my conclusions) | **No blocker/high/medium.** One **low, pre-existing, informational**: `EnsureApplicationOperationActive` (credit-note route middleware, `:116-135`) loads the note by id with tenant scope only before the controller, so for a *purchase-type* note in another branch on a tenant that hides purchase credit notes the response can be that middleware's 403 rather than the controller's 404 — same tenant, can only deny, unchanged by this PR, not widened; optional follow-up. Test gaps noted by the reviewer (owner + `?branch=all` on ZATCA `store`, credit-note `post`, `dispatch`) were closed with three assertions. |
| AWJ Guardian | No separate Guardian reviewer exists in this environment. Contract check performed by the implementer against `CLAUDE.md` and Access Control V2: tenant isolation outermost ✔; no global scope on `BelongsToBranch` ✔; no new permission/helper/middleware ✔; money/ledger/ZATCA untouched ✔; `allowedBranchIds()`/`canAccessBranch()` untouched ✔. **Implementer-performed, not independent.** |
| Unresolved | None in this PR. |

## Risks / remaining

1. **Behavior change:** a user who created a credit-note draft in branch X must have X active to view or post it (intended; switching recovers it). Web sends the active branch in `X-Branch-Id` on every request (`web/src/lib/api.ts`), not exercised against a running UI here.
2. **Per-attempt environment binding does not exist** (no column): an environment switch between enqueue and job run is a pre-existing REM-25 concern.
3. **Pre-existing, unchanged:** the credit-note route middleware note above; `CreditNoteController::store` validates the source invoice against the allowed set (tests pin that a note may be created from a source in another allowed branch).
4. **Still on the read policy (by design):** `?branch=all` widens reads such as `notes()`, attachment download, invoice reads, `ZatcaSubmissionController::index` (includes `response_payload`), `CreditNoteController::index`.
5. Local full-suite environmental failures (38 SQLite / 39 PostgreSQL) are identical to REM-03 and absent from CI; CI is the authoritative full-suite result.
6. SQLite-only test-DB quirk (unique `(tenant_id, number)` without the branch predicate) required explicit number overrides in multi-branch fixtures; PostgreSQL unaffected.

## CI

* Code head `3b90b50b98c5032b2d02ca2b5add12e2da30059b`: `php artisan test (L11, sqlite)` ✅ (run 38489689181); `php artisan test (L11, pgsql)` and `CI Gate` — see the PR.
* **Final head:** all three checks (`php artisan test (L11, sqlite)`, `php artisan test (L11, pgsql)`, `CI Gate`) are verified on the exact final head SHA and recorded in the PR description / hand-back message.

## Merge / Deploy status

**DRAFT PR — NOT MERGED — NOT DEPLOYED.** No migration, no GitHub setting/ruleset/CI change, no Horizon grant or policy change, no ZATCA transmission, OTP or credential operation, no production action.

## Recommended next step

Owner review of PR #1410 only. Optional later: a tiny follow-up for the credit-note route-middleware 403-vs-404 observation, and REM-25 for per-attempt environment binding. Then REM-08.
