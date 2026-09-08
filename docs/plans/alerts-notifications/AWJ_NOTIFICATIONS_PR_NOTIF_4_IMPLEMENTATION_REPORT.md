# AWJ Alerts & Notifications — PR-NOTIF-4 Implementation Report

**Financial Control Alert + ZATCA Notification Integration**

**Date:** 2026-09-06
**Base:** `main` at `dd51fd3eb4300ed6b7db77b6bb39d89b24985e75` (includes merged PR #677, Milestone 1)
**Branch:** `claude/pr-notif-4-financial-zatca`
**Head:** `a914abf566fe4ce6f2f171ebb3f147243e182b8f`

---

## Summary

PR-NOTIF-4 connects two existing, already-approved detection systems — the Financial
Control Alert engine and ZATCA submission attempts — to the Milestone 1 notification
foundation, as two independent, additive observer layers. Neither system's own logic was
changed. The work followed the mandated audit-first process: both domains were inspected
against current `main` before any code was written, a checkpoint decision
(`SAFE TO IMPLEMENT`) was made explicit, and only then was the bounded implementation
built. No accounting posting, financial rule, or ZATCA submission/retry/signing behavior
changed. No migration. No schema change. No breaking API change.

---

## Audit Findings

### Financial Alerts

**Actual architecture (verified directly against current `main`, not assumed from prior
work):**
- `FinancialControlAlert` (`app/Models/FinancialControlAlert.php`) / `financial_control_alerts`
  — unchanged since Milestone 1's own research, with one discovery: a later, unrelated PR
  added `assigned_to`/`assignment_reason` columns (fuel-operations reuse of this table);
  the financial-only controller never reads or writes them.
- `FinancialControlService::scan()` (`app/Services/Accounting/FinancialControlService.php:31`)
  — gated by `finance.financial_alerts_enabled`; generates exactly 4 rules
  (`journal_unbalanced`, `trial_balance_unbalanced`, `balance_sheet_unbalanced`,
  `posted_source_without_journal`), all hardcoded `severity: 'critical'`. **No
  severity-escalation concept exists in the current model** — confirmed by reading every
  rule definition — so no escalation-notification path was built (per the task's own
  conditional: "if the existing model actually supports meaningful escalation").
- `synchronize()` (line 227) resets `first_detected_at` and clears acknowledgement fields
  only when `$new || $reopened`. This is exactly the signal needed, and it is exposed for
  free via Eloquent's own `wasRecentlyCreated`/`wasChanged('status')` flags on the model
  objects `scan()` already returns — **no change to `synchronize()` or `scan()` was
  needed or made** to detect "this alert just became active."
- **Discovered pre-existing issue (not fixed, out of scope):** `scan()`'s stale-closing
  query (lines 52-55) resolves *any* active/acknowledged alert not in its own fingerprint
  list, with no `rule` filter — unlike `FuelStationAlertService::scan()`
  (`app/Services/FuelStationAlertService.php:44-47`), which correctly scopes its
  stale-close to `rule LIKE 'fuel.%'`. This means the hourly `finance:scan-controls` run
  likely spuriously resolves-then-lets-fuel-reopen active fuel alerts sharing the same
  table every cycle. This is unrelated to financial correctness and was left untouched —
  fixing it would be a `FinancialControlService` behavior change, explicitly forbidden by
  this task's safety rules. Flagged here as a separate follow-up recommendation.
- **Recipients:** no existing permission cleanly isolates "accountant-tier" from
  "staff-tier" — `accounts.view`/`reports.view`/`zatca.view` are granted identically to
  both `accountant` and `staff` in `Rbac::MATRIX`. The conservative, RBAC-respecting
  choice made: gate on `accounts.manage` (owner/admin by default, extensible via custom
  `Role` rows) — the same permission that already gates `acknowledge`/`run-check` on this
  exact resource. `accountant` does not receive these notifications under this policy;
  documented as a deliberate scope decision, not an oversight (see Risks).
- **Integration point chosen:** the two existing callers of `scan()` —
  `ScanFinancialControlsCommand::handle()` and `FinancialControlAlertController::runCheck()`
  — each now also pass `scan()`'s own already-computed `alerts[]` to a new observer. Zero
  lines changed inside `FinancialControlService.php` itself.

### ZATCA

**Actual architecture (verified directly, current `main`):**
- Single terminal choke point: `ZatcaSubmissionService::complete()`
  (`app/Services/Accounting/ZatcaSubmissionService.php:91`) is the *only* place a
  `pending` attempt ever becomes `accepted`/`rejected`/`failed`. The model
  (`ZatcaSubmissionAttempt::booted()`) hard-enforces this transition happens **exactly
  once**, and the row is then fully immutable and undeletable.
- **Retry reality:** a retry of a terminal failure creates a brand-new, independent
  attempt row (new `attempt_number`, new `id`) via
  `ZatcaSubmissionService::requestManual()` — there is no fingerprint/cycle/reopen
  concept for this table, confirmed by reading every write path. This **simplifies**
  dedupe versus Financial/Inventory alerts: since each attempt row is a permanent,
  one-time fact, `attempt.id` alone is a fully sufficient, collision-free dedupe identity
  — no cycle counter needed.
- **Success is fully reliable and separable from failure:** `status` is validated to
  exactly one of the three terminal values by both `complete()`'s own guard and the
  model's `booted()` hook; a clearance response that fails to parse is explicitly
  downgraded to `failed` before persisting (`ZatcaSubmissionDispatcher.php:39-61`), so a
  disguised success can never reach `complete()` as `'accepted'`.
- **Sensitive fields:** `response_payload` is transport-layer-trusted, not independently
  scrubbed at the model layer (its own code comment says so) — **never used**. Only
  `response_code` (sanitized: truncated to 120 chars) is surfaced; `response_message`
  (up to 2000 chars of external, less-vetted text) is also **not** used.
- **Recipients:** `invoices.manage` (who can actually dispatch/retry a submission),
  intersected with `attempt.branch_id` (a column that exists directly on the attempt
  table).
- **EGS/CSID/credential state — deliberately scoped out.** Verified: `zatca_credentials.status`
  is written only ever as `'configured'` by `ZatcaCredentialService::store()`; no code
  path anywhere sets it to any other value, and there is no expiry/health event of any
  kind. Building a credential-notification producer would require **new** derived-state
  logic (a scan comparing `expires_at` to `now()`), not wiring an existing signal. Per the
  task's own conditional ("only if current architecture provides a reliable actionable
  state") and to keep this PR bounded, **this was not implemented**. See Scope Not
  Implemented.
- **Integration point chosen:** one addition inside `ZatcaSubmissionService::complete()`
  — after its own transaction commits, if `status ∈ {rejected, failed}`, a call is made
  to a new observer, itself deferring via `DB::afterCommit()`. Zero change to validation,
  transitions, retry, signing, or credential logic.

### Notification layer

Unchanged since Milestone 1 (verified: zero diff against the merged Milestone 1 commit
for `NotificationService.php`/`Notification.php` before this PR's edits).
`NotificationActions::ALLOWED` required exactly two new additive entries (below).

### Decision

**SAFE TO IMPLEMENT** — recorded explicitly before any implementation code was written.
No stop condition from the task's §17 was triggered.

---

## Implementation

### A. Financial Alert Notification Bridge

`App\Services\Accounting\FinancialAlertNotificationBridge::process(array $alerts)` — takes
exactly the `alerts[]` array `FinancialControlService::scan()` already returns. For each
alert where `$alert->wasRecentlyCreated || $alert->wasChanged('status')` (i.e. genuinely
became active this scan — new or reopened), it delivers one notification per eligible
recipient via `NotificationService::deliver()`. Unchanged alerts are skipped entirely — no
delivery attempt, no dedupe-key computation, nothing written.

Wired into the two existing `scan()` callers:
- `ScanFinancialControlsCommand::handle()` — calls `$notifications->process($result['alerts'])`
  only when `$result['enabled']` is true (regardless of `--force`, so a forced preview scan
  on a tenant that has the feature *off* never notifies).
- `FinancialControlAlertController::runCheck()` — same call, right after the existing
  `enabled` check that already returns 422 when disabled.

Any exception during delivery is caught and logged (`Log::error('financial_alert_notification_failed', ...)`)
inside the bridge itself — it can never propagate to affect the scan's own return value or
the command/API response.

### B. ZATCA Notification Bridge

`App\Services\Accounting\ZatcaNotificationBridge::queueEvaluation(string $attemptId)` —
called from `ZatcaSubmissionService::complete()` immediately after its transaction returns,
only when the just-persisted `status` is `rejected` or `failed`. Internally defers via
`DB::afterCommit()` (so a transaction that rolls back around `complete()` never notifies),
then re-fetches the attempt and its invoice fresh from the database (never trusting
in-memory state that might be stale by the time the deferred callback runs), and delivers
one notification per eligible recipient.

Any exception during delivery is caught and logged
(`Log::error('zatca_submission_notification_failed', ...)`) inside the bridge's own
deferred callback — proven by a dedicated test to never affect the attempt row's saved
terminal status.

### C. Minimal UI extension

- `App\Support\NotificationActions::ALLOWED` gained two entries:
  `view_financial_alert => financial_control_alert`, `view_zatca_submission => invoice`.
- `web/src/lib/notifications.ts`'s `ACTION_PATHS` map gained the matching two entries,
  pointing at the existing `/financial-alerts` and `/invoices/[id]` pages — both already
  independently re-authorize on open (`reports.view` and `zatca.view`/`invoices.view`
  respectively). No new frontend page, no Notification Center redesign, no new
  category/severity value (both new types use the existing `alert` category and
  `critical` severity, so no new i18n strings were needed for tabs/badges — only the
  server-generated `title`/`message` text is new, matching the existing
  `FinancialControlAlert` precedent of plain server-rendered strings).

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `app/Services/Accounting/FinancialAlertNotificationBridge.php` | new | Financial observer |
| `app/Services/Accounting/ZatcaNotificationBridge.php` | new | ZATCA observer |
| `app/Console/Commands/ScanFinancialControlsCommand.php` | modified | +1 constructor param, +4 lines calling the bridge |
| `app/Http/Controllers/Api/FinancialControlAlertController.php` | modified | +1 import, +1 constructor param, +1 line calling the bridge |
| `app/Services/Accounting/ZatcaSubmissionService.php` | modified | `complete()` captures its own return value, then calls the bridge for `rejected`/`failed` before returning it |
| `app/Support/NotificationActions.php` | modified | +2 allowlist entries |
| `web/src/lib/notifications.ts` | modified | +2 `ACTION_PATHS` entries |
| `web/src/components/layout/notification-bell.test.tsx` | modified | +2 tests for the new action mappings |
| `tests/Feature/FinancialAlertNotificationBridgeTest.php` | new | 11 tests |
| `tests/Feature/ZatcaNotificationBridgeTest.php` | new | 9 tests |

No file outside this list was touched. No accounting, ZATCA signing/crypto, POS, or
unrelated module file was modified.

---

## Migrations

**None.** No new table, no new column, no index change.

---

## API Changes

**None.** No new route, no changed request/response contract on any existing route.
`POST /api/financial-control-alerts/run-check` and the scheduled `finance:scan-controls`
command have an added *side effect* (notifications may now be delivered) but their
existing response/output shape is unchanged.

---

## Notification Types Added

| `type` | `category` | `severity` | Fires on |
|---|---|---|---|
| `financial.alert_active` | `alert` | `alert.severity` (currently always `critical`) | A financial control alert becomes active (new or reopened) |
| `zatca.submission_rejected` | `alert` | `critical` | A ZATCA submission attempt is rejected |
| `zatca.submission_failed` | `alert` | `critical` | A ZATCA submission attempt fails (transport/preflight) |

Success (`accepted`) never produces a notification, by design.

---

## Dedupe Contracts

**Financial:** `"financial.alert_active:{alert_id}:{priorNotificationCount}"`, where
`priorNotificationCount` is the number of notifications already delivered for that exact
alert (`source_type = 'financial_control_alert'`, `source_id = alert.id`), counted at
delivery time. **This replaced an initial design using
`"…:{alert_id}:{first_detected_at unix timestamp}"`, which a real test caught failing**:
`first_detected_at` is stored with whole-second precision in the database, so a fast
reopen (resolve then re-corrupt within the same wall-clock second — exactly what a test
does, and plausible in production under rapid manual correction) produced an identical
key for two genuinely distinct transitions, silently swallowing the second notification.
The count-based key is immune to this because it only changes after a real notification
row has actually been persisted, and is naturally stable across a true retry of the same
unchanged transition (since `wasChanged('status')` guards the whole path, an unchanged
scan never re-attempts delivery at all, so the count and the key can never drift for
retries of the same event).

**ZATCA:** `"zatca.submission_{status}:{attempt.id}"`. Simpler and needs no cycle logic
at all, because `attempt.id` is already a permanent, immutable, one-time identity per the
audit findings above — no two distinct events can ever share it, and a retried failure
correctly gets its own new attempt id and thus its own new notification.

---

## Recipient Resolution

Both bridges follow the same shape established in PR-NOTIF-3
(`InventoryAlertService::resolveRecipients()`): active tenant users filtered by
`hasPermission()` for the domain's "can act" permission, intersected with branch
visibility using the `branch_id === null || canAccessBranch(branch_id)` convention (a
`null` branch means "shared/visible to all," matching `ApiController::scopeToActiveBranch`'s
existing `branch_id IS NULL` treatment — deliberately *not* `User::canAccessBranch(null)`
directly, since that method alone returns `false` for a restricted user given a `null`
argument, which would have been the opposite of the intended semantics).

- **Financial:** `accounts.manage`, filtered by `alert.branch_id`.
- **ZATCA:** `invoices.manage`, filtered by `attempt.branch_id`.

Recipient IDs are never accepted from any client input — both resolvers query
`User::where('tenant_id', ...)` server-side only.

---

## Tenant Isolation

- Both bridges require an explicit `tenant_id` (from `TenantContext` at the moment the
  triggering event occurs) and pass it explicitly into every query and into
  `NotificationService::deliver()` — never relying on ambient scope alone as the isolation
  boundary, consistent with the rest of the codebase.
- Verified by dedicated tests using `withoutGlobalScopes()` cross-checks: two tenants with
  structurally identical corrupt data (financial) or identical failed submissions (ZATCA)
  never see each other's notifications, and no alert/attempt ID from one tenant appears as
  a `source_id` under the other tenant's notifications.

---

## RBAC / Source Authorization

- Financial: `accounts.manage` only (not the broader `reports.view`/`accounts.view` that
  `staff` and `accountant` also hold) — verified by a test asserting `staff` and
  `accountant` tokens are excluded from the recipient list while `owner` is included.
- ZATCA: `invoices.manage` only (not `invoices.view`) — verified by a test asserting
  `staff` (view-only) is excluded while the registering `owner` is included.
- **Source re-authorization on open:** neither new action grants any access by existing.
  `/financial-alerts` re-enforces `reports.view` (and its own branch-visibility filtering)
  on every load, regardless of how the user navigated there. `/invoices/[id]` re-enforces
  its own existing invoice-visibility rules. The notification API itself exposes no way to
  read `financial_control_alerts` or `zatca_submission_attempts` content directly — only
  the safe `title`/`message`/`data` fields already computed by the bridges.
- `NotificationActions::ALLOWED` continues to reject any action/source_type pair not
  registered — verified indirectly by the full PR-NOTIF-1 `NotificationApiTest` suite
  (still green, including its "unregistered action" and "action requires matching source
  type" tests) applying unchanged to these two new entries.

---

## Sensitive Data Protection

- **Financial:** notification `data` contains only `{'rule': alert.rule}` (a short rule
  slug, e.g. `journal_unbalanced`) — no amounts, no journal line detail, no
  customer/vendor data. `title`/`message` reuse the alert's own `title`/`description`
  fields, which are the exact same text already exposed to `accounts.manage` holders via
  the existing `GET /financial-control-alerts` endpoint — no new exposure.
- **ZATCA:** notification `data` contains only `{'submission_type': 'clearance'|'reporting'}`.
  The message includes `response_code` only (sanitized, ≤120 chars) — never
  `response_message` (up to 2000 chars of less-vetted external text) or `response_payload`
  (transport-layer-trusted, not independently scrubbed). Verified by a dedicated test that
  injects a long message and a fake "certificate" key into the raw `complete()` call and
  asserts neither appears anywhere in the delivered notification's `message` or `data`.
- No credentials, tokens, private keys, OTPs, or raw XML are referenced by either bridge
  at any point — neither bridge touches `ZatcaCredential`, `ZatcaSigningCredentialResolver`,
  or any invoice's `zatca_xml`/`zatca_cleared_xml` fields.

---

## Accounting Safety

Explicit confirmation:
- **Posting: unchanged.** No bridge calls `LedgerService::post()` or any invoice/purchase/
  payment posting method.
- **Journals: unchanged.** No bridge creates, updates, or reverses a `JournalEntry` or
  `JournalLine`. Verified by a dedicated test (`the_bridge_never_mutates_accounting_records`)
  asserting `JournalEntry`/`JournalLine` counts and sums are identical before and after a
  scan that triggers a notification.
- **Balances: unchanged.** No `AccountBalance` row is touched by either bridge.
- **Financial rules: unchanged.** `FinancialControlService.php` has zero lines changed in
  this PR. The 4 existing rules, their fingerprints, and their lifecycle
  (`active → acknowledged → resolved → reopened`) behave identically to before this PR —
  verified by the full pre-existing `FinancialControlAlertTest` suite (10 tests) still
  passing unmodified.

---

## ZATCA Safety

Explicit confirmation:
- **Submission: unchanged.** `ZatcaSubmissionDispatcher`, `ZatcaHttpTransport`, and
  `ZatcaSubmissionQueue` have zero lines changed.
- **Retry/resend: unchanged.** `ZatcaSubmissionService::requestManual()` (the resubmission
  path) and `ZatcaSubmissionQueue::enqueue()` (the re-dispatch path) have zero lines
  changed. The full pre-existing `ZatcaSubmissionAttemptTest`,
  `ZatcaSubmissionRecoveryTest`, and `ZatcaSubmissionDispatcherTest` suites (16 tests)
  still pass unmodified.
- **XML/signing: unchanged.** No file under `ZatcaXades*`, `ZatcaXml*`, `ZatcaInvoiceSigner`,
  `ZatcaInvoiceHasher`, or `ZatcaPhaseTwoQrEncoder` was touched. The full pre-existing
  signing/canonicalization/XAdES test suites (60+ tests) still pass unmodified.
- **Credential handling: unchanged.** No file under `ZatcaCredential*`,
  `ZatcaSigningCredentialResolver`, or `ZatcaTransportCredentialResolver` was touched.
  `ZatcaSubmissionService::complete()`'s only change is: capture its existing return value
  in a local variable, conditionally call the new bridge, then return the same value —
  verified by a dedicated test
  (`a_notification_delivery_failure_never_corrupts_the_saved_zatca_result`) that forces the
  notification layer to throw and asserts the attempt's saved `status`/`response_http_status`
  are exactly as `complete()` computed them, with zero notifications created.

---

## Tests

Exact commands run, from `/home/user/nibras-app` (the built Laravel project synced from
this core repository, per the project's documented `setup.sh` workflow):

```bash
php artisan test --filter="FinancialAlertNotificationBridgeTest|ZatcaNotificationBridgeTest"
# Tests: 20 passed (92 assertions)

php artisan test --filter="FinancialControl|Zatca|Notification|BranchIsolationGuardTest"
# Tests: 209 passed (1777 assertions)

php artisan test
# (full suite, no filter)
```

### SQLite

Full suite: **2529 passed, 25 failed, 1 skipped (18011 assertions)**.

### PostgreSQL

Local PostgreSQL configured to match `ci.yml`'s service exactly
(`DB_DATABASE=nibras`, `DB_USERNAME=nibras`, `DB_PASSWORD=secret`).

Full suite: **2530 passed, 25 failed (18013 assertions)**.

### The 25 failures (both engines, identical set)

Pre-existing and unrelated to this PR — confirmed by inspection, not assumption:
- 24 are `Fuel*Test` failures: `Error: Call to undefined function App\Services\bcmul()`
  inside `FuelCostBasisService`. This sandbox has no `bcmath` PHP extension loaded
  (`php -m | grep bcmath` returns nothing); `ci.yml` explicitly installs `bcmath`.
- 1 is `DocumentCenterSecureIntakeTest > a valid pdf is cou…`, needing `pdftoppm`/`pdfinfo`
  (`poppler-utils`), also absent from this sandbox; `ci.yml` explicitly installs it.

No Financial-, ZATCA-, Notification-, or branch-isolation-related test is in either
failure list, on either engine. This is the identical failure set already documented in
the Milestone 1 report — nothing new.

---

## Frontend Tests

```bash
npm test
# Test Files  234 passed (234)
#      Tests  1504 passed (1504)
```

`notification-bell.test.tsx` specifically: 15/15 pass (13 from Milestone 1 + 2 new,
covering both new action mappings resolving to `/financial-alerts` and `/invoices/{id}`).

---

## Build

```bash
npm run build
# ✓ Compiled successfully
```

Full type-check and lint pass with no errors.

---

## CI

Not triggered on GitHub Actions in this session — see Git section for the PR link once
opened; CI will run there automatically. Both `ci.yml` (PHP matrix, sqlite+pgsql) and
`web-ci.yml` (`npm test` + `npm run build`) were faithfully reproduced locally as
described above.

---

## Risks / Follow-ups

1. **Pre-existing bug found, not fixed (out of scope for this PR):**
   `FinancialControlService::scan()`'s stale-closing query lacks a `rule` filter, unlike
   `FuelStationAlertService::scan()`'s equivalent — the hourly financial scan likely
   spuriously resolves-then-lets-reopen active fuel alerts sharing the same table every
   cycle. Recommend a separate, narrowly-scoped fix PR adding
   `->where('rule', 'not like', 'fuel.%')` (or equivalent) to that one query — a one-line,
   non-financial-rule-affecting change, but explicitly outside this PR's authorized scope
   (touching `FinancialControlService.php`'s logic was not authorized here).
2. **`accountant` role does not receive financial alert notifications** under the
   `accounts.manage`-only recipient policy, despite handling day-to-day accounting. This
   was a deliberate, conservative choice given no existing permission cleanly expresses
   "accountant-tier but not staff-tier" visibility. If broader delivery is wanted, the
   correct fix is a tenant-level recipient-role setting (explicitly deferred, matching the
   PR-NOTIF-3 precedent), not widening to `reports.view` (which would also include
   `staff`).
3. **ZATCA credential/EGS/CSID notifications are not implemented.** As documented in the
   audit, no reliable actionable signal exists for this today; building one requires new
   derived-state logic (a scan over `expires_at`), which is a materially different kind of
   change from this PR's "observe an existing terminal write" pattern. Recommend treating
   it as its own explicitly-scoped follow-up if pursued.
4. **Dedupe-key precision lesson:** the financial dedupe key's initial timestamp-based
   design was caught and fixed by a real test before merge (see Dedupe Contracts) — flagged
   here so the same class of bug (second-precision timestamp columns used as a uniqueness
   component) is remembered for any future alert-lifecycle bridge in this codebase.

---

## Scope Not Implemented

Per the task's explicit "DO NOT DO" list — none of the following were implemented, and
none were required by anything above: email, push, WebSockets/realtime infrastructure,
WhatsApp/SMS, receivables alerts, POS alerts, System Announcements, What's New, advanced
user notification preferences, Notification Center redesign, financial auto-fixes, ZATCA
auto-remediation, ZATCA credential/EGS/CSID notifications (see Risks item 3).

---

## Git

- **Branch:** `claude/pr-notif-4-financial-zatca`
- **Base SHA:** `dd51fd3eb4300ed6b7db77b6bb39d89b24985e75` (`origin/main`, includes merged
  PR #677 / Milestone 1)
- **Head SHA:** `a914abf566fe4ce6f2f171ebb3f147243e182b8f`
- **PR:** opened after this report — see the PR description for its number/link; not
  merged, not deployed.

---

## Recommended Next Step

1. Owner/reviewer review of this report and the single commit on
   `claude/pr-notif-4-financial-zatca` (`git diff dd51fd3..a914abf`).
2. A real CI run (this PR, once opened) to get a fully clean signal — the 25 failures
   documented above are sandbox-only gaps that CI's own tooling installation avoids.
3. Once approved: merge is Safwan's decision alone, per this task's delivery rule. No
   further phase (PR-NOTIF-5 or later) should begin without a new, separate explicit
   request.
