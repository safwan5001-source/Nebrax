# AWJ Intelligence — AI-02 Financial Intelligence Foundation: Implementation Report

## 0. Split decision

AI-02 is delivered as **two stacked Draft PRs**, because one PR would mix a migration, a concurrency-critical budget engine and three financial tools into one hard-to-review diff.

| PR | Scope | Depends on |
|---|---|---|
| **AI-02A** (Part A) | Budget and usage metering, durable audit, retention, idempotency | `main` (AI-01 merged at `336284170ea6a044ee745fda2f1c844e161215cf`) |
| **AI-02B** (Part B, this branch) | Three read-only finance tools over `ReportService` | AI-02A (PR #1548) |

- Neither PR makes a live call, activates a provider, or turns on any platform or tenant switch.
- AI-02B is stacked on the AI-02A branch. Its base is retargeted to `main` once AI-02A merges.
- Nothing was merged or deployed.

---

# Part A — AI-02A: Metering and durable audit

| Item | Value |
|---|---|
| Branch | `feat/ai-02-financial-intelligence-20261016` |
| Base SHA (`origin/main`) | `336284170ea6a044ee745fda2f1c844e161215cf` |
| Head SHA | stated on the PR (the report commit is the last commit) |
| Draft PR | see PR description |
| References | AI-01 report `docs/reports/AWJ_AI_01_IMPLEMENTATION_REPORT.md`; #1544 (architecture baseline) and #1545 (lean contract), not merged and not needed to build |

## A1. Work completed

### Budget and usage (`ai_budgets`, `ai_requests`)

- **Two caps per request:** a global platform cap and a per-tenant cap, per UTC calendar month.
- **Explicit units:** tokens, and **micro-USD** (1 USD = 1,000,000), as integers. There is no float anywhere in the path.
- **No silent unlimited default:**
  - Cap columns are `NOT NULL` with no default.
  - A billable request with no global **and** tenant row for the current month is refused (`budget_not_configured`).
  - A cap of `0` denies everything.
  - A provider or model with no price entry is refused (`pricing_unknown`), never treated as free.
- **Atomic reserve-before-egress:**
  - Each cap row is reserved with **one conditional `UPDATE`**: `... WHERE used + reserved + :n <= cap`. There is no read-then-write window.
  - The global row is reserved first, then the tenant row, in one transaction in a fixed order. A failure on either rolls back both.
  - The reservation is the conservative estimate: `estimated input tokens + max_output_tokens`.
- **Settlement:**
  - The actual provider-reported usage replaces the reservation on both rows.
  - Settlement moves a request out of `reserved` **exactly once** (row lock plus a status condition), so a double settlement or a settlement racing the reaper cannot double-count.
  - Actual usage above the reservation is recorded as the truth (flagged `overrun` in audit) and blocks what follows.
- **Failure and retry accounting:**
  - A failed call is charged per `ai_assistant.budget.failure_charge`. The default is `reserved` (conservative: the call may have been billed). `none` is available.
  - Usage reported on the failure is charged as reported.
  - An idempotent retry after a failure reuses the same request row. `attempt` increments and usage accumulates, so the failed attempt stays charged.
- **Abandoned reservations:**
  - A reservation older than `reservation_ttl_seconds` (default 600) is settled by the failure policy.
  - This runs on cap pressure, **outside the reservation transaction**, then retries once. A defect found during testing: running it inside the transaction rolled the cleanup back on final refusal. The cleanup now lives in `AiRequestLedger::open`, and a test covers it.
- **Request identity and idempotency:**
  - An optional `Idempotency-Key` header (8–64 characters from `[A-Za-z0-9._:-]`).
  - Stored only as an HMAC scoped to the tenant, plus an HMAC fingerprint of the request. Neither the key nor the prompt is stored.
  - Outcomes:
    - Same key, settled request: `409 duplicate_request`. No second call and no second charge. Nothing is replayed, because replies are never stored.
    - Same key, in flight: `409 request_in_progress`.
    - Same key, different request: `422 idempotency_key_reuse`.
- **Kill switch:** the AI-01 platform switch is unchanged. When off, nothing touches the ledger or budgets.
- **Billing exemption:** only the in-process `mock` provider may be `billable=false` (enforced in code, not config). Every other provider is always billable.

### Durable audit (`ai_audit_events`)

- **Contents:** metadata only: tenant, actor, feature, event, tool, provider, model, outcome, reason code, attempt, tokens, cost, an allow-listed `meta` of counts and flags, and a timestamp.
- **Redaction by construction:**
  - `event`, `reason` and `tool` must match a strict snake_case pattern. A sentence or free text is rejected, not stored.
  - `meta` accepts only declared keys with typed values. Anything else is dropped.
  - The table has no column for a prompt, a reply or a secret.
- **Fail-closed before egress:**
  - `request.started` is written **durably before the provider is called**.
  - If that write fails, the provider is never called, the reservation is released uncharged (`audit_unavailable`), and the caller gets `500 internal_error`.
- **Events written:** `request.started`, `request.completed`, `request.failed`, `request.denied`, and `tool.invoked` / `tool.denied` (reserved for AI-02B).
- **Append-only through the model:** update and delete from application code throw.
- **Access control:**
  - New permission `ai.audit.view`.
  - Granted to owner and admin via `*` only. It is not granted to accountant, staff or self_service, and using the assistant does not grant reading its audit.
  - `GET /api/ai-assistant/audit-events` is tenant-isolated (global scope) and exposes a whitelist of columns without `tenant_id`.
  - It has validated filters, `per_page` capped at 100, and a throttle.
- **Retention:** `php artisan ai:prune-records`, scheduled daily.
  - It is governed by `ai_assistant.audit.retention_days` (default 400), with a **hard floor of 30 days** in code.
  - It removes old audit events and finished request records, and never touches `reserved` requests.

### Unchanged

- Mock provider only. No real adapter, no network, no platform provider settings read.
- No platform or tenant consent was turned on.
- No change to accounting, Document Center, Store, UI or the Help Center.

## A2. Changed files

| File | Change |
|---|---|
| `database/migrations/2026_11_13_010000_create_ai_metering_and_audit_tables.php` | **new**: 3 tables (see A3) |
| `app/Models/AiBudget.php`, `AiRequest.php`, `AiAuditEvent.php` | new (the latter two `CompanyWide` and tenant-isolated; the budget model is deliberately not a tenant model) |
| `app/Services/AiBudgetService.php` | new: caps, atomic reserve, settle, reaper |
| `app/Services/AiRequestLedger.php` | new: request identity, idempotency, open, complete, fail |
| `app/Services/AiAuditRecorder.php` | new: redacting audit writer |
| `app/Support/AiAssistantPricing.php`, `AiProviderException.php` | new |
| `app/Http/Controllers/Api/AiAuditController.php` | new: audit read |
| `app/Console/Commands/PruneAiRecords.php` | new: retention |
| `app/Services/AiAssistantGateway.php` | metered, audited flow (AI-01 gates kept as is) |
| `app/Services/MockAiAssistantProvider.php`, `app/Contracts/AiAssistantProvider.php` | `model()` plus reported `usage`; test-only failure and usage injection |
| `app/Support/AiAssistantDenied.php` | new codes (budget, pricing, idempotency) |
| `app/Http/Requests/AiAssistantMessageRequest.php`, `AiAssistantController.php` | `Idempotency-Key` header |
| `app/Support/Rbac.php` | `ai.audit.view` permission string |
| `config/ai_assistant.php` | `budget`, `pricing`, `audit`, `max_output_tokens` |
| `routes/api.php`, `routes/console.php` | audit route; daily prune schedule |
| `tests/Feature/AiMeteringTest.php`, `AiAuditTest.php`, `InteractsWithAiAssistant.php` | new |

## A3. Migration and compatibility notes

- **Schema change: yes, justified.** AI-01 approved log-only audit for the mock phase only. Durable audit, plus atomic budgets that survive across requests and processes, require persisted state.
- **One migration, three new tables, no change to any existing table.**
  - `ai_budgets`: one row per (month, `global` or `tenant:<uuid>`). Unique on (`period`, `budget_key`). Caps are `NOT NULL`.
  - `ai_requests`: request identity, status, attempts, reservation, usage, cost. Unique on (`tenant_id`, `idempotency_hash`).
  - `ai_audit_events`: append-only metadata.
  - PostgreSQL gets non-negative `CHECK` constraints. SQLite cannot add them after creation, so the code and tests guard that.
- **Compatibility:**
  - The AI-01 behavior and the AI-01 gateway test suite pass unchanged. All 39 still pass.
  - The only visible response additions are `attempt` and `usage` (tokens only).
  - New tenants and existing tenants are unaffected while the feature is off.
- **Rollback:** the migration `down()` drops the three tables. It is safe before any use. After real data exists, prefer forward-only changes.
- **Operations needed before any paid call (not done here):**
  - A platform operator must create the global and tenant cap rows. There is no UI or command for this yet; `AiBudgetService::setCaps` is the code path.
  - The prune schedule only runs where a scheduler runs, the same limitation as the existing scheduled commands.

## A4. Tests

| Check | Result |
|---|---|
| `AiMeteringTest` | **28 passed** |
| `AiAuditTest` | **16 passed** |
| `AiMeteringMigrationTest` (final review) | **3 passed, 1 skipped on SQLite; 4 passed on PostgreSQL** |
| `AiAssistantGatewayTest` (AI-01 regression, unchanged) | **39 passed** |
| Nearby guard and RBAC suites (`BranchIsolationGuardTest`, `ApiTenantIsolationTest`, `ApiUnauthenticatedResponseTest`, `ApplicationAccessGateGuardTest`, `RoleGrantBoundaryTest`, `UserGrantBoundaryTest`, `MeActorScopeTest`, `PublicApiWriteSurfaceTest`) | **98 passed** |
| Full local suite (`php artisan test`, SQLite) | **7415 passed, 140 skipped, 26 failed** (59,104 assertions, 679 s) |
| Real concurrency check (see below) | pass |
| `git diff --check` | clean |

The 26 failures are the same environmental set as in AI-01: six fuel test classes (`FuelAviRfidServiceTest`, `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`, `FuelSupplyReceivingTest`) failing with `undefined function bcmul()`, because this sandbox PHP lacks `bcmath`. CI installs it and passed these on the AI-01 merge. The 140 skips are pre-existing.

Commands: `php artisan test --filter=AiMeteringTest`, `--filter=AiAuditTest`, `--filter=AiAssistantGatewayTest`.

### Real concurrency check

PHPUnit runs inside a transaction, so it cannot show true parallelism. I ran **12 parallel PHP processes** against the real SQLite database file. Each reserved 400 tokens against a 1,000-token cap on both the global row and a tenant row.
- **Result:** exactly 2 succeeded and 10 were refused (`platform_budget_exceeded`). The final reserved total was 800, never above the cap.
- **Cleanup:** the temporary rows were deleted afterwards.
- **PostgreSQL:** the same race was run again during the final review, see A8.

### Coverage

- **Budget:** global and tenant caps, hard stop, zero cap, missing rows (global only, tenant only), rollback of the global reservation on tenant refusal, reservation visible *during* the provider call, exact settlement of both rows, overrun, month rollover, cap validation.
- **Statement shape:** the reservation is one conditional `UPDATE` per row, with no preceding read.
- **Failure and retry:** failure policy `reserved` and `none`, reported usage, retry attempts, cumulative accounting.
- **Idempotency:** duplicate, in-flight, key reuse, per-tenant scoping, header validation, hash-only storage.
- **Audit:** metadata only, redaction, forbidden free-text codes, cross-tenant write refusal, append-only, durable before egress, fail-closed on audit failure.
- **Audit access:** its own permission, immediate revocation, tenant isolation including a foreign request id, whitelist and validation.
- **Retention:** retention, the 30-day floor, and that in-flight requests are kept.
- **No egress:** `Http::preventStrayRequests()` plus `assertNothingSent()` in every test, and a static scan of the new sources.

## A5. CI

CI results for the PR head are recorded in the PR description.

## A6. Risks and open issues

1. ~~Single-statement atomicity only exercised on SQLite~~ — **closed in the final review (A8):** the same race was repeated on a local PostgreSQL 16 (16 processes: 2 granted, 14 refused, reserved total 800 of a 1,000 cap).
2. **Audit is database-level append-only only through the model.** Raw SQL or DBA access can alter it. The retention command deletes by design. Stronger tamper evidence (hash chaining or database triggers) is a possible later step and was not added.
3. **Budget rows must be provisioned by an operator.** Until a UI or command exists, there is no way to set caps outside code. The failure mode is safe: no row means no paid call.
4. **The reaper charges abandoned reservations in full by default.** This is conservative: a crash can consume budget without a real charge. The failure policy is configurable.
5. **Platform-disabled requests still write one audit row each.** They are authenticated and throttled, but a disabled platform with an abusive tenant could grow the table. The retention command bounds it.
6. **Estimation is conservative, not exact.** The input estimate (about 3 bytes per token plus overhead) may over-reserve, which reduces headroom but never under-protects. Real provider usage will need real tokenizer-based tuning in the adapter phase.
7. **No platform-operator audit view** across tenants yet.

## A7. Recommended next action

Review and merge AI-02A first (with CI green), then AI-02B. Before any real provider adapter, create the global and tenant caps through a reviewed operator path.

## A8. Final review — migration date and ordering

**Decision: the migration keeps its name, `2026_11_13_010000_create_ai_metering_and_audit_tables.php`. No rename.**

| Question | Finding |
|---|---|
| Is it ordered correctly? | Yes. It is the last file in `database/migrations` (previous: `2026_11_12_010000_add_party_snapshot_to_invoices`), and sorts after `2025_01_01_000001_create_tenants_and_users`, the only table it depends on (foreign keys to `tenants`). It depends on no later migration, and nothing depends on it. |
| Is the "future" date a problem? | No. The calendar date today is 2026-10-16, but `main` already holds 21 migrations dated `2026_11_*`, including `2026_11_12_010000`, committed on 2026-10-16. The repository uses a rolling sequence that runs ahead of wall-clock time, and `2026_11_13` continues it. A date earlier than `2026_11_12` would be the anomaly: it would sort before migrations that are already applied. |
| Execution-order risk? | Laravel runs pending migrations in filename order and skips applied ones, so a deployed database applies this one after everything already applied. The only hazard would be a future branch adding a migration that sorts *before* this one; it would still be independent of these three new tables, so there is no ordering conflict. |
| Is a rename necessary or safe? | Not necessary. Renaming after the file has run anywhere would make Laravel treat it as a new migration and try to recreate the tables. Before merge it would only churn the stacked PR. |

### Verification run (local, in addition to CI)

| Check | SQLite | PostgreSQL 16.15 (local) |
|---|---|---|
| `migrate:fresh` (all migrations including this one) | pass | pass |
| `migrate:rollback --step=1` removes only this migration's three tables | pass | pass (no `ai_*` table remains) |
| `migrate` re-applies it incrementally | pass | pass |
| Non-negative `CHECK` constraints present and enforced | not applicable (SQLite cannot add them after creation) | pass: a negative cap is rejected |
| New `AiMeteringMigrationTest` (4 tests) | 3 passed, 1 skipped (PostgreSQL-only CHECK) | 4 passed |
| All AI suites (`AiAssistantGatewayTest`, `AiMeteringTest`, `AiAuditTest`, `AiFinanceToolsTest`) | passed in earlier runs | **109 passed (1,433 assertions)** |
| Parallel processes reserving 400 tokens against a 1,000-token cap on a global row and a tenant row | 12 processes: 2 granted, 10 refused | **16 processes: 2 granted, 14 refused, reserved total 800** |

- `AiMeteringMigrationTest` belongs to this PR (#1548). It guards the ordering relative to the migration's dependency, the `down()` and `up()` round trip (only its own tables are dropped), the database-level uniqueness, and the PostgreSQL `CHECK`.
- The local PostgreSQL was started only for this verification, on a throwaway database. No existing migration or data was changed.

---

# Part B — AI-02B: Read-only finance tools

| Item | Value |
|---|---|
| Branch | `feat/ai-02b-finance-tools-20261016` (stacked on `feat/ai-02-financial-intelligence-20261016`) |
| Base | AI-02A head `db9fc57dd82bf928754d845c53be2d5eef6f0595` (PR #1548); `main` is `336284170ea6a044ee745fda2f1c844e161215cf` |
| Head SHA | stated on the PR (the report commit is the last commit) |
| Draft PR | see PR description; its base is the AI-02A branch and is retargeted to `main` after #1548 merges |

## B1. Work completed

### Three allowlisted tools (the registry is closed to exactly these)

| Tool | Source | Arguments (closed schema) |
|---|---|---|
| `finance.income_statement` | `ReportService::incomeStatement` | `from`, `to` (`Y-m-d`) |
| `finance.receivables_aging` | `ReportService::aging('receivable')` | `as_of` (`Y-m-d`) |
| `finance.payables_aging` | `ReportService::aging('payable')` | `as_of` (`Y-m-d`) |

- **No recalculation and no generated SQL.**
  - Each tool calls the existing `ReportService` method and only reshapes its integer output.
  - A test greps the tool sources for `DB::`, raw SQL, `JournalLine`, `Invoice::`, `round(`, float casts and network code.
  - A second test asserts the tools issue no write statements against accounting tables.
  - Financial figures are never produced by the model.
- **Typed, validated input.**
  - Unknown keys are rejected, not ignored.
  - Dates must be strict `Y-m-d`, a real calendar date, year 2000 or later, and **not in the future** in the tenant's timezone.
  - Income statement: `from` must not be after `to`; the period is capped at **366 days** inclusive (366 passes, 367 is rejected).
  - Validation runs after authorization, so an unauthorized caller never learns the schema.
- **Typed output.** Every amount is `{minor: int, decimal: "1150.00"}` with the currency and `minor_unit: 2` stated once. A test walks the whole result and asserts no floats. Each result carries the period or `as_of`, the timezone, `generated_at` (UTC), the effective branch scope, the explicit basis, and a `sources` entry with the API path (including the filters used) and the UI path.
- **SAR-only pilot, explicit.** The tenant currency is verified as `SAR` before any read; otherwise the call is refused with `currency_unsupported` and no report query runs. The result states `currency_assumption: sar_only_pilot_tenant_currency_verified`.
- **Timezone.** "Today" and the future-date check use the tenant timezone, not UTC. A test at 22:30 UTC (which is 01:30 the next day in Riyadh) accepts the local date and rejects the day after.
- **Basis labels (what `ReportService` actually does, stated rather than changed).**
  - Income statement: accrual ledger, `posted` and `reversed` entries, by `entry_date`, inclusive, excluding fiscal-year closing entries. When filtered by branch, `unallocated` (entries with no branch) is returned explicitly.
  - Aging: remaining balance of posted, not-fully-paid documents; age reference is due date, else document date. Buckets are `<=30` days past due (this includes not-yet-due), `31-60`, `61-90`, `>90`. It is **not reconciled to the control ledger** (stated in the result).
  - **Important limitation, labeled in the result:** aging balances are the **current** outstanding balances. `as_of` only moves the age reference and does not reconstruct history. When `as_of` is not today (tenant time), the result carries the warning `as_of_not_historical`. I did not change the report logic.

### Authorization (re-checked on every invocation with a freshly loaded actor)

- **Permissions.** `ai.assistant.use` (gateway) plus `reports.view` (tool). `reports.view` alone is not enough, and the assistant permission alone is not enough.
- **Consent.** The tenant must have consented to the `financial_summary` category. Message consent does not cover it. `financial_summary` is now an *available* category, but it stays default-deny and no tenant is opted in.
- **Restricted field.** Partner detail (id and name) in aging requires `partners.view` on top of `reports.view`. Without it the totals and buckets are returned unchanged, `rows` is empty and `partner_detail` is `withheld`. A test confirms a partner-name canary never appears in that response.
- **Scope.**
  - Only the resolved, authorized branch ids are passed to `ReportService`, so there is no widening. The existing report helper widens a forbidden request to the user's full scope; the gateway rejects it with `403` before the tool runs.
  - Forbidden branch or warehouse ids, and ids from another tenant, are rejected.
  - Revoking a branch or `reports.view` between planning and execution is enforced.
  - The fresh actor is installed as the authenticated user while the tool runs, because `ReportService` reads branch scope from `auth()->user()`. A test fails if this is removed.
- **Warehouse.** The financial reports have no warehouse dimension. A request that names warehouses is rejected (`scope_not_supported`) instead of silently ignoring them. A user restricted to warehouses but naming none gets company-wide financials, the same as the existing `/api/reports/*` behavior, and the result states `warehouse: not_applicable`.

### Data flow

- Tool results are returned only to the authenticated caller. In AI-02B they are **not forwarded to any provider**. Forwarding financial data to a real model needs the real adapter, the privacy approval and a separate review.
- The deterministic mock provider can plan a tool from a few Arabic and English keywords (for example "income statement", "قائمة الدخل", "receivables aging", "أعمار الذمم الدائنة") with default arguments. This is for demonstration and tests; a custom planner overrides it.
- Audit: `tool.invoked` and `tool.denied` carry the tool name and counts only (row count, period days, branch mode and count, `partner_detail`). A test confirms no amount or partner name reaches the audit table.

### Unchanged
No accounting rule, report calculation, Document Center, Store, UI or Help Center change. No real provider, network call or credential. No migration in AI-02B.

## B2. Changed files (AI-02B only)

| File | Change |
|---|---|
| `app/Services/AiFinanceReportTool.php` | new: shared base (SAR gate, dates, scope, money, envelope) |
| `app/Services/AiIncomeStatementTool.php`, `AiAgingReportTool.php` | new |
| `app/Services/AiAssistantToolRegistry.php` | registers exactly the three tools |
| `app/Contracts/AiAssistantTool.php` | adds `validate`, `supportsWarehouseScope`, `auditMeta` |
| `app/Services/AiAssistantGateway.php` | validates arguments after authorization, rejects unsupported warehouse scope, installs the fresh actor, passes tenant clock to the provider, audits tool metadata |
| `app/Services/MockAiAssistantProvider.php`, `app/Contracts/AiAssistantProvider.php` | keyword planner; `today` and `timezone` inputs |
| `app/Support/AiAssistantDataCategory.php` | `financial_summary` becomes available (still needs consent) |
| `app/Support/AiAssistantDenied.php` | `invalid_tool_arguments`, `scope_not_supported`, `currency_unsupported` |
| `tests/Feature/AiFinanceToolsTest.php` | new, 26 tests |
| `tests/Feature/AiAssistantGatewayTest.php` | AI-01 tests updated for the new contract (registry now has three tools, financial category now consent-gated, probe tool implements the new methods, fresh-actor assertion) |

## B3. Compatibility

- **No migration and no schema change** in AI-02B.
- **AI-01 test changes:** they follow deliberate behavior changes (registry no longer empty; `financial_summary` no longer reserved). The 39 AI-01 gateway tests still pass.
- **Default behavior is unchanged:** the feature is off platform-wide, no tenant is opted in, and `financial_summary` consent is empty for every tenant.
- **Tool contract:** `AiAssistantTool` gained three methods. The only implementers are the three new tools and the test double.

## B4. Tests

| Check | Result |
|---|---|
| `AiFinanceToolsTest` | **26 passed** |
| `AiAssistantGatewayTest` (AI-01, updated) | **39 passed** |
| `AiMeteringTest` + `AiAuditTest` (AI-02A) | **44 passed** |
| Nearby accounting, report and isolation suites (`ReportStatementsTest`, `ApiReportsTest`, `FinancialStatementsTest`, `ReportEffectiveScopeTest`, `BranchPartnerIsolationTest`, `BranchIsolationGuardTest`, `ApiUnauthenticatedResponseTest`, `ApplicationAccessGateGuardTest`) with the above | **188 passed in total** |
| Full local suite (SQLite) | **7441 passed, 140 skipped, 26 failed** (59,476 assertions, 693 s) |
| Mutation checks | Downgrading the tool permission, ignoring the branch filter, or dropping the fresh-actor installation each makes tests fail, then the code was restored |
| `git diff --check` | clean |

The 26 failures are the same environmental set: six fuel classes failing with `undefined function bcmul()`, because the sandbox PHP lacks `bcmath`. CI installs it.

### Coverage

- **Financial parity vs `ReportService`:**
  - Income statement with inclusive boundaries (day before, first day, last day and the day after excluded), a three-line rounding case, negative values, and expenses.
  - Aging at every bucket boundary: due today, 30, 31, 60, 61, 90, 91 days late and not yet due, plus payables.
  - Parity is asserted on totals, rows and the decimal strings.
- **Isolation:** another tenant's documents never appear; cross-tenant branch and warehouse ids are rejected.
- **Scope:** branch filtering with `unallocated`; a restricted user pinned to their branches; an explicitly forbidden branch rejected, not widened; a branch revoked mid-request; a warehouse selection rejected; a warehouse-restricted user.
- **Authorization:** missing `reports.view`; `reports.view` revoked between planning and execution (no report query runs); missing consent; withheld partner detail.
- **Dates and limits:** timezone boundaries, 15 malformed or out-of-bound argument cases (no report query runs), the 366-day limit, and the non-SAR tenant.
- **Audit and safety:** redaction, no write statements, no generated SQL, the closed registry.

## B5. CI

Recorded in the PR description for the head commit.

## B6. Risks and open issues (AI-02B)

1. **Aging `as_of` is not historical.** This is existing `ReportService` behavior, now labeled with a machine-readable warning. If the product needs true historical aging, that is an accounting change in a separate task. A model that ignores the warning could narrate a current balance as a past one.
2. **Warehouse-restricted users see company-wide financials**, matching the existing report endpoints. If warehouse restriction must also limit financial visibility, that is a policy decision (a candidate for a configurable setting) and was not changed here.
3. **Mock keyword planning is a demo.** A real model will choose tools and arguments, so its argument validation (already closed-schema) is the control. Real prompt-injection testing belongs to the adapter phase.
4. **Financial data is not sent to any provider yet.** Before it can be, the real adapter needs the privacy, retention and residency approvals and a decision on whether tool results may be forwarded to the model.
5. **No drill-down.** Row-level source links (documents, ledger) are intentionally absent; only report-level `api_path` and `ui_path` are returned.
6. **Account-level sensitivity.** Revenue and expense lines are visible to any role holding `reports.view`, as in the existing API. A field-level policy registry (for example for cost accounts) is not part of this PR.

## B7. Recommended next action

1. Review and merge AI-02A (#1548) first, then retarget and review AI-02B.
2. Provision budget caps through a reviewed operator path before any real adapter.
3. Next phase: the AI-03 UI (consent management and states). The real provider adapter stays blocked on the open gates (privacy, residency, billing owner and numeric caps).
