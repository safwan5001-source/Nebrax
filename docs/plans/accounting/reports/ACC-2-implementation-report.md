# ACC-2 — Semantic Account Routing Foundation — Implementation Report

**Status:** DONE
**Task doc:** `docs/plans/accounting/ACC-2-semantic-account-routing-foundation.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Migration strategy:** Clean Seeded Cutover (approved before this task; no Transitional Legacy Fallback)

## Summary

Implemented the ACC-2 semantic account-routing infrastructure exactly as scoped: static role catalog,
tenant-isolated explicit mappings, a fail-closed resolver, an immutable audit trail, and a narrow
API/UI — with **zero posting consumers**. No existing posting service, `LedgerService`, database schema
for accounting entities, or historical data was touched.

The approved Clean Seeded Cutover decision changes one thing relative to the task doc's original text:
there is **no legacy-code fallback at resolution time**. Every tenant (new, via registration; existing,
via a one-time backfill migration) is seeded an explicit mapping for every catalog role from day one, so
"unmapped" is not a state the resolver is ever expected to hit in normal operation — and when it does
(a defensive/future-proofing case, e.g. a role added to the catalog later without a backfill), it fails
closed exactly like an invalid mapping, never falling back to a hardcoded account code.

## Baseline check

Task doc's planning baseline: `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`. The user-provided merge SHA for
this task's starting point was `4963a6b5c1427c753b492dc7d43672c9a64e208e`; `origin/main` had advanced one
further commit (`6a4a53d...`, an unrelated Alerts & Notifications feature) by the time work started. Diff
reviewed: touches `InventoryService.php` (3 lines, unrelated to accounting routing), `Support/Settings.php`,
notification models/controllers/routes — no conflict with RBAC, `Account`, `Tenant`, or `AuthController`.
Proceeded from `6a4a53d` without stopping, per the "no material divergence" judgment call the task allowed.

## Changed files

| File | Why |
|---|---|
| `app/Support/AccountingRoles.php` (new) | Static catalog: the 13 approved V1 role keys with Arabic/English label+description, legacy code, domain, configurability. |
| `database/migrations/2026_09_07_010000_create_account_role_mapping_tables.php` (new) | `account_role_mappings` (unique per tenant+role, `account_id` FK `restrictOnDelete`) + `account_role_mapping_events` (immutable audit, no FK on snapshot columns so history survives a later account deletion). |
| `database/migrations/2026_09_07_020000_backfill_account_role_mappings.php` (new) | One-time, additive, idempotent backfill: seeds every existing tenant's missing role mappings to their legacy-code account. Touches no other table. |
| `app/Models/AccountRoleMapping.php`, `app/Models/AccountRoleMappingEvent.php` (new) | `CompanyWide` models (no `branch_id` in V1, per doc). Event model is update/delete-immutable (mirrors `TenantApplicationEvent`). |
| `app/Services/Accounting/AccountRoleMappingSeeder.php` (new) | Additive-only seeding used by both new-tenant registration and the backfill migration. Sets `TenantContext` itself for correctness regardless of caller state. |
| `app/Services/Accounting/AccountRoleResolver.php` (new) | Single-path resolver: explicit mapping → validate account exists/active/non-group → return, or fail closed. **No callers in this PR.** |
| `app/Services/Accounting/AccountRoutingService.php` (new) | CRUD + audit for the settings API: `list()`, `setMapping()`, `reset()`. Locks the tenant row during writes (same pattern as `TenantApplicationService`) to serialize concurrent mapping changes. |
| `app/Http/Requests/UpdateAccountRoleMappingRequest.php`, `app/Http/Controllers/Api/AccountRoutingController.php` (new) | `GET/PUT/DELETE /accounting-settings/account-routing[/{roleKey}]`. |
| `app/Http/Controllers/Api/AuthController.php` | One line added after `ChartOfAccountsSeeder::seed()`: seeds default role mappings for every new tenant. |
| `routes/api.php` | 3 new routes, gated by `accounting_settings.view`/`.manage` (from ACC-1). |
| `web/src/app/(app)/accounting-settings/account-routing/page.tsx` (new) | Real Account Routing workspace: roles grouped by domain, account picker (eligible accounts only), reset action, view-only banner. |
| `web/src/app/(app)/accounting-settings/page.tsx` | "Account Routing" tile now links to the real route instead of showing "planned" (this was ACC-1's own anticipated follow-up, not scope creep). |
| `web/src/messages/ar.json`, `en.json` | New copy for the Account Routing page and updated tile description. |
| `tests/Feature/AccountRoutingTest.php` (new, 22 tests), `web/.../account-routing/page.test.tsx` (new, 4 tests) | See Tests section. |

## Migrations / seeding

- `2026_09_07_010000_create_account_role_mapping_tables`: schema only, additive, reversible (`down()` drops both new tables).
- `2026_09_07_020000_backfill_account_role_mappings`: data-only, additive. Loops every `Tenant`, calls the same `AccountRoleMappingSeeder::seedDefaults()` used at registration. Idempotent — re-running fills gaps only, never overwrites an existing explicit mapping (verified by a dedicated test). `down()` intentionally does nothing (removing seeded mappings could discard a real owner decision made after this shipped; the schema migration's `down()` already removes the table if a full rollback is needed).
- Both ran cleanly on a fresh SQLite database and a fresh PostgreSQL 16 database in this session.

## Tests run and results

**New tests:**
- `php artisan test --filter=AccountRoutingTest` → **22 passed** (130 assertions) on SQLite; same 22 passed on PostgreSQL.
- `npx vitest run .../account-routing/page.test.tsx` → **4 passed**.

Test coverage maps directly to the doc's required list (adjusted per the approved cutover — items 7 and 10
below reflect that adjustment):
1. Tenant isolation (mapping write + read) — ✅ (`tenant_a_cannot_map_or_see_tenant_b_accounts`, `tenant_a_cannot_read_tenant_b_routing_state`)
2. Cross-tenant account UUID rejected — ✅ (same tests)
3. Inactive account rejected — ✅
4. Group account rejected — ✅
5. Unknown role rejected (write + reset) — ✅
6. Unique mapping per tenant/role — ✅ (DB constraint test + idempotency test)
7. *(Adjusted for cutover)* Every tenant has an explicit mapping to the exact legacy account from day one — ✅ (`registration_seeds_...`, `each_default_mapping_points_at_...`, `backfill_seeds_missing_mappings_...`)
8. Valid mapping resolves selected account — ✅
9. Explicit mapping later becoming invalid fails closed — ✅ (resolver + list-state tests)
10. *(Adjusted for cutover)* Reset restores the default by writing a **new explicit mapping**, never deletes the row — ✅
11. Mapping writes never touch `journal_lines` — ✅ (explicit test)
12. Audit created/changed/reset records actor + role + before/after snapshots, and is immutable — ✅
13. View/manage RBAC separation — ✅
14. Accountant/staff denied by default — ✅
15. Owner/admin via wildcard — ✅
16. Resolver doesn't touch cash/bank roles — ✅ (`catalog_does_not_define_generic_cash_or_bank_roles`)
17. Representative posting tests remain unchanged (zero consumers) — ✅ (full regression below)
18. SQLite migration/tests pass — ✅
19. PostgreSQL migration/tests pass — ✅
20. Frontend page tests/build/typecheck pass — ✅

**Targeted regression** (`RoleTest`, `ApiRbacTest`, `AccountingSettingsRbacTest`, `LedgerTest`, `AccountManagementTest`,
`InvoiceTest`, `PurchaseTest`, `ApiInvoiceTest`, `CashBankAccountTest`, `ChartOfAccountsDemoTest`, `RecurringInvoiceTest`):
all passed on both SQLite and PostgreSQL — confirms no regression in account creation/deletion guards,
invoice/purchase posting, or RBAC.

**Full backend suite — SQLite:** `php artisan test` (no filter) → **2475 passed, 1 skipped, 25 failed**
(17839 assertions, 322s). All 25 failures are pre-existing `Fuel*Test` failures (`Call to undefined function
App\Services\bcmul()` — the `bcmath` PHP extension is not installed in this environment). Verified as
pre-existing and unrelated in the prior ACC-1 session and reconfirmed here (identical failure set, identical
count).

**Full backend suite — PostgreSQL 16:** same command → **2476 passed, 25 failed** (17841 assertions, 676s).
Same pre-existing bcmath failures, nothing else. PostgreSQL was started fresh in this session
(`nibras`/`nibras` role, matching `ci.yml`'s pgsql matrix job) specifically to run this.

**Full frontend suite:** `npx vitest run` → 235 test files, **1506 passed**. `npx tsc --noEmit` → same 3
pre-existing errors in files this PR does not touch (`pos/settings/configuration/page.test.tsx` ×2,
`platform/integrations/gemini-card.test.tsx`, `platform/global-application-controls-card.test.tsx`).
`npm run build` → succeeds; `/accounting-settings/account-routing` compiles (5.02 kB, 188 kB First Load JS).

## Confirmation: zero posting-behavior / Ledger change

- `LedgerService`: not modified, not imported, not referenced by any new file.
- `InvoiceService`, `PurchaseService`, `PaymentService`, `ReturnService`, `InventoryService`,
  `StocktakeService`, `StockPermitService`: not modified. No `ACC_*` constant was replaced anywhere.
- `AccountRoleResolver` has **zero callers** in the codebase outside its own test — grep-verified before
  and after this PR's changes.
- No code in this PR reads, writes, or re-derives any `journal_lines`/`journal_entries` row (explicit test:
  `mapping_writes_never_create_or_touch_journal_lines`).
- No branch-specific routing added (`account_role_mappings` has no `branch_id`, models declare `CompanyWide`
  per the doc's V1 requirement).
- Fiscal periods, accounting date locks, Purchase Return / Supplier Refund behavior: untouched.
- ACC-3 was **not** started.

## RBAC behavior

| Role | `accounting_settings.view` | `accounting_settings.manage` |
|---|---|---|
| owner/admin | ✅ via `*` | ✅ via `*` |
| accountant/staff | ❌ not granted by default | ❌ not granted by default |
| custom role granted `accounting_settings.view` only | ✅ can view/GET | ❌ 403 on PUT/DELETE |

## Tenant isolation evidence

- Writing a mapping to an account ID belonging to another tenant is rejected with 422 ("الحساب غير موجود"),
  because `Account::whereKey()` passes through the existing `TenantScope` global scope and simply returns
  nothing for a foreign UUID — the same mechanism `ApiController::assertTenantOwned()` relies on elsewhere.
- The `eligible_accounts` list and every role's mapping state in the GET response are built from
  tenant-scoped queries only; a dedicated test confirms tenant B's custom account never appears in tenant
  A's response.
- `account_role_mappings` and `account_role_mapping_events` both use `BaseModel`/`BelongsToTenant`, so the
  same global scope applies automatically to every query against them.

## Audit evidence

Every write (`setMapping`, `reset`) creates exactly one `AccountRoleMappingEvent` row inside the same
transaction, recording `action` (`mapping_created`/`mapping_changed`/`mapping_reset`), `actor_user_id`,
and both `previous_account_id`/`previous_account_code` and `new_account_id`/`new_account_code` snapshots.
The model throws on `update()`/`delete()` after creation (mirrors `TenantApplicationEvent`), verified by a
test that asserts a `LogicException` on attempted mutation.

## Risks, blockers, remaining work

- **Risk:** low-medium. This is tenant-isolated financial *configuration* infrastructure — real money
  amounts aren't touched because nothing consumes the resolver yet, but the mapping table itself is a new
  surface with write access gated correctly.
- **New DB-level constraint to be aware of:** `account_role_mappings.account_id` uses `restrictOnDelete()`.
  Deleting an account that is currently mapped to a role now fails at the database level. This is only
  reachable in practice once a tenant explicitly maps a role to a **custom** account via the new UI — the
  13 default `is_system` accounts were already undeletable via `AccountManagementService`'s own guard.
- **Adaptation from the task doc, approved via the cutover decision:** "reset" (`DELETE`) does not delete
  the mapping row — it explicitly rewrites it to the default account. This was necessary to satisfy both
  the doc's UX intent ("reset restores default, never disables") and the mandate that no code path may
  silently fall back to the legacy code at read time. Documented above and in code comments.
- **Remaining work:** ACC-3 (Sales + Payment Counterparty Routing) is the first phase that gives
  `AccountRoleResolver` an actual caller. Not started — out of scope for this task.

## Branch / PR / SHAs

- Branch: `claude/acc-2-account-routing-foundation`
- PR: https://github.com/safwan5001-source/Nebrax/pull/679
- Base SHA (`origin/main` at start of this task): `6a4a53d71dec092267a0901598046b2e5d78f40d`
- Head SHA: `563a6e802a92822e5d0910919ef7b5962ca748a2`

**No merge, no deploy performed.**

## Recommended next step

Review PR #679 in isolation. Once approved (merged by Safwan, not by this agent), begin ACC-3 — Sales +
Payment Counterparty Routing per the parent plan's execution sequence and its prepared task document
(`ACC-3-sales-payment-account-routing.md`).
