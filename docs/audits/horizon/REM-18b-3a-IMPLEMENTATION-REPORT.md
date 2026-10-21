# REM-18b-3a: Implementation report: ZATCA rollout controls foundation

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration, no tenant activation, no live ZATCA transmission.** Branch `claude/rem-18b-3a-rollout-controls`. PR number, Head SHA and CI are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction "REM-18b-3a: ZATCA Rollout Controls Foundation", on the decisions approved after the REM-18b-3 decision review (dedicated tables, disabled by default, tenant activation plus platform emergency stop, append-only audit). |
| Base | `origin/main` = `e69995d799fd3450a1740500026329dd981b3e72` (contains #1588 `f919de6` and #1592 `ba2a6dc`). |
| Scope | Schema (two tables, triggers on both engines), two platform-operational models, one service, value objects, tests, docs. |
| Not in this PR | Reading the controls from `CreditNoteService::post` (REM-18b-3c) · F2 fences (3b) · credit-note issuance · any API or UI · any activation · changes to accounting, ZATCA allocation, signing, submission or dispatch configuration. |

## 1. Architecture and decisions

### 1.1 Meaning of the state

| Scope | Row absent | `enabled = true` | `enabled = false` |
|---|---|---|---|
| `tenant` | **Disabled** (the state after any deployment) | Activation allowed for this tenant | Disabled |
| `platform` | No stop recorded (baseline) | Stop lifted / never engaged | **Emergency stop**: overrides every tenant activation |

Effective state = tenant control `enabled` **and** no platform stop. Reasons returned: `enabled`, `platform_stop`, `tenant_not_configured` (no row), `tenant_disabled`, `no_tenant_context` (fail-closed helper). The only feature key today is `credit_note_issuance`; adding another needs a migration (the key list is a database CHECK).

### 1.2 Tables (`2026_11_21_010000_create_zatca_rollout_control_tables.php`)

* `zatca_rollout_controls`: `id`, `scope`, `tenant_id` (nullable, CASCADE), `feature_key`, `enabled`, `version`, timestamps.
* `zatca_rollout_control_events`: `id`, `control_id` (RESTRICT), `scope`, `tenant_id` (nullable, CASCADE), `feature_key`, `version`, `previous_enabled`, `new_enabled`, `platform_administrator_id` (RESTRICT, so a hard admin delete cannot erase the audit), `reason` (3 to 500 characters), `occurred_at`, `created_at`.
* **Identity:** two partial unique indexes, one per `(tenant_id, feature_key)` and one for platform scope, because a `NULL` `tenant_id` never collides in an ordinary unique index. Unique `(control_id, version)` on events.
* **The migration inserts no row.**

### 1.3 Database guards (PostgreSQL plpgsql and SQLite triggers, same cases tested on both)

| ID | Guard |
|---|---|
| C1/E4 | Shape: scope in `platform`/`tenant`, platform rows without a tenant and tenant rows with one, known feature, events with version at least 1, `previous <> new`, reason 3 to 500 characters (PostgreSQL CHECK; SQLite insert triggers) |
| C2 | A control can be created only in its baseline state at version 0 (tenant disabled, platform without a stop), so **an insert alone can neither activate nor stop anything** |
| C3 | `enabled` changes only by inserting an audit event: an AFTER INSERT trigger on events applies the new state with a compare-and-swap on (identity, previous version, previous state). A direct `UPDATE` of a control is rejected unless it matches the event just inserted for the next version. Identity columns are frozen. |
| C4 | `DELETE` of a control is rejected (always for platform rows; for tenant rows while the tenant row exists, so the tenant purge cascade still works). `TRUNCATE` rejected (PostgreSQL). |
| E1/E2/E3 | Events: `UPDATE` always rejected; `DELETE` rejected (always for platform events, while the tenant exists for tenant events); `TRUNCATE` rejected |

### 1.4 Service `App\Services\Accounting\ZatcaRolloutControlService`

* **Reads** (`effectiveForTenant`, `effectiveForCurrentTenant`): one SQL statement fetches the tenant and platform rows together, so a caller sees one consistent snapshot; no locks. Missing tenant control means disabled; a platform stop overrides; no tenant context returns disabled.
* **Writes** (`setTenantState`, `setPlatformState`): only for a `PlatformAdministrator` that is **active and not soft-deleted, re-read inside the transaction** (a stale model is not trusted) and held with a shared lock until commit. Inputs are validated first: known feature, UUID tenant id, existing non-deleted tenant, reason length. Each change inserts one event; the trigger applies the state, so state and audit are atomic. Asking for the state that already holds writes nothing (no row, no event). The first change creates the control row with `INSERT … ON CONFLICT DO NOTHING` and then re-reads it under a lock, so a creation race cannot abort a PostgreSQL transaction.
* **Authorization model:** the repository has no platform role model; platform administrators have only `is_active`. "Authorized" therefore means an active platform administrator. There is **no HTTP route, no artisan command and no tenant-facing path** (a test scans routes and `app/`).
* **Models** `ZatcaRolloutControl` and `ZatcaRolloutControlEvent` are plain operational models like the `Platform*` ones, not tenant-scoped `BaseModel`s, because the platform row has no tenant and platform administrators never pass `SetTenant`. Tenant isolation comes from explicit tenant-bound reads in the service and from the database constraints. Both models refuse update and delete before reaching the database.

### 1.5 Locking strategy and the lock order for REM-18b-3c

Writers:

* tenant scope: platform administrator row (`FOR SHARE`) → **tenant anchor** (`tenants` row, `FOR UPDATE`) → control row (`FOR UPDATE`) → event insert;
* platform scope: platform administrator row (`FOR SHARE`) → platform control row (`FOR UPDATE`) → event insert.

Taking the tenant anchor **before** the control is the same order every writer of that tenant uses (`LedgerService`/`AccountingDateGuard` lock the anchor before reading anything), so a control change serializes with that tenant's postings, and no path takes a control before the anchor, so no lock cycle is possible. Concurrent changes of one control serialize on its row lock; a racing duplicate is also stopped by `UNIQUE(control_id, version)` and the trigger's compare-and-swap.

**Contract for REM-18b-3c** (reader inside the credit-note posting transaction):

`credit note → source invoice → tenant anchor (LedgerService) → … → chain head (ZatcaChainAllocator) → read the rollout state`

The rollout state is read **last**, **once per transaction**, in **one statement** (`effectiveForCurrentTenant()`), **without taking any lock**. A tenant change queues behind a posting that holds the anchor, so that posting reads the old value consistently; the platform stop applies to every transaction that reads after it commits, and a transaction that already read "enabled" completes (the READ COMMITTED snapshot of one statement), which is the intended behaviour, not a risk window.

## 2. Files

| File | Kind |
|---|---|
| `database/migrations/2026_11_21_010000_create_zatca_rollout_control_tables.php` | new (tables, indexes, guards on both engines, guarded `down()`) |
| `app/Models/ZatcaRolloutControl.php`, `ZatcaRolloutControlEvent.php` | new |
| `app/Services/Accounting/ZatcaRolloutControlService.php` | new |
| `app/Support/ZatcaRolloutState.php`, `ZatcaRolloutChange.php`, `ZatcaRolloutControlException.php` | new |
| `tests/Feature/ZatcaRolloutControlTest.php` | new, 23 tests, both engines |
| `tests/Feature/ZatcaRolloutControlPostgresTest.php` | new, 6 fork-based tests; **fails rather than skips** on PostgreSQL if `pcntl` is missing |
| `CLAUDE.md`, task queue | docs |

Untouched: `CreditNoteService`, `InvoiceService`, `ZatcaService`, `ZatcaChainAllocator`, submission classes, routes, resources, `Settings`, F1, and every existing migration. **No journal entry is created or changed.**

## 3. Tests and CI

Local results (CI is the authority):

| Run | Result |
|---|---|
| `ZatcaRolloutControlTest`, SQLite | 23 passed (173 assertions) |
| `ZatcaRolloutControlTest`, PostgreSQL 16 | 23 passed (175 assertions) |
| `ZatcaRolloutControlPostgresTest`, PostgreSQL 16 (`pcntl_fork`) | 6 passed (156 assertions); ran, not skipped; the tables and triggers were verified clean and enabled afterwards |
| Related guards (`ZatcaChainSchemaTest`, `BranchIsolationGuardTest`), SQLite | passed (72 passed, 7 skipped with the rollout tests) |
| Full suite, SQLite | 8051 passed, 27 failed, 157 skipped (70484 assertions) |
| Full suite, PostgreSQL 16 (`lock_timeout=60s`, as CI) | 8204 passed, 27 failed, 4 skipped (71975 assertions) |

The 27 failures are environmental and identical to the previous slices: 26 `Fuel*` (`bcmath` is not installed in this container; CI has it) plus `AiPaidProviderDisabledTest` on SQLite or `StorefrontMediaApiTest` on PostgreSQL (both also fail without this change). No ZATCA XML, signing or allocation code changed, so the SDK harness was not re-run locally; CI runs the advisory conformance job because `app/Services/Accounting/Zatca*` changed.

Covered: default disabled state and no rows after deployment; tenant isolation (also through the tenant-context helper); platform emergency stop and its release; authorized and unauthorized changes (inactive, soft-deleted, unsaved and stale administrators); invalid scope, tenant, feature and reason; atomic event logging (a failure while writing the event leaves no control row); event immutability, delete and truncate protection; duplicate controls for both scopes; baseline-only creation; compare-and-swap rejection of mismatched events; migration rollback refusal and re-application; hard and soft tenant deletion; concurrency (identical enables, alternating changes, first platform stop race, queuing behind an anchor lock with a lock-free reader, repeated races with posting-style transactions without deadlock, a killed process).

## 4. Security and tenant isolation

* No tenant-facing API, route, controller or console command exists; a test asserts nothing outside the service, models and value objects mentions the tables.
* Nothing reads the controls yet, so no behaviour changes for any tenant. The service is not referenced by posting, allocation, signing or submission code (asserted).
* Reasons and events carry no secrets; exception messages are fixed text with a short reason code.
* Every deletion or overwrite path that would silently clear an emergency stop or a history entry is closed in the database, not only in code.

## 5. Migration and rollback

* Additive: two tables, two partial unique indexes, triggers and plpgsql functions. No existing table is altered; no row is read or written.
* `down()` refuses whenever either table has any row, in every environment and without a bypass flag; when both are empty it drops the tables (and the functions on PostgreSQL). Tested on both engines, including re-application.
* Once a control or event exists the migration is forward-only by construction (delete and truncate are blocked). Deployment order against REM-18b-3b/3c has no dependency: the tables are inert until 3c reads them.
* Old application versions are unaffected because they never touch these tables.

## 6. Remaining risks and open points

| Item | State |
|---|---|
| Platform baseline | Absent platform row means "no stop" as approved. The alternative (require an explicit platform "armed" row, fail-closed on absence) is stricter and costs one extra operational step; say so if preferred, it is a small change. |
| Authorization granularity | Any active platform administrator may change controls (no role model exists). A narrower permission needs a platform role design. |
| No operator surface | There is deliberately no route, command or UI to change controls in this slice, so activation needs a code path that does not exist yet (REM-18b-3 follow-up or an operational runbook). |
| Test cleanup of platform rows | Platform rows cannot be deleted by any application path; the PostgreSQL test cleanup disables user triggers briefly inside `try/finally` and re-enables them. Verified clean after the run. |
| Hard tenant purge | Removes that tenant's controls and events with it, exactly like its other data; retention remains the REM-36 decision. Platform rows and events are never removed. |
| Feature list is a database CHECK | A second feature needs a migration (intentional: unknown keys can never be stored). |

## 7. Branch, PR, SHAs

Branch `claude/rem-18b-3a-rollout-controls`; Base `e69995d799fd3450a1740500026329dd981b3e72`; the Draft PR number, Head SHA and CI are on the PR.

## 8. Recommended next step

Review this slice, then **REM-18b-3b**: fence F2 on `credit_notes` (immutable issued identity, status consistency, F2b gated by this activation table), still without issuing anything. REM-18b-3c then wires `CreditNoteService::post` and reads this state as specified in §1.5.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO TENANT ACTIVATION. NO LIVE ZATCA TRANSMISSION.**
