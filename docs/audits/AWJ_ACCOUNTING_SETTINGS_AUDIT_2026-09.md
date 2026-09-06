# AWJ Accounting Settings — Architecture Audit (2026-09)

**Type:** Read-only architecture audit. No application code, migrations, schema, or behavior were changed to produce this document.
**Branch:** `claude/awj-accounting-settings-audit-xvwah3`
**Base SHA:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`
**Head SHA:** this commit (the audit document itself is the only change; see the commit that introduces this file)

---

## 1. Executive Summary

AWJ's accounting core is solid and centralized: every business document posts through one primitive, `LedgerService::post()`, and correction only happens through `LedgerService::reverse()`. Balance validation, group-account rejection, and disabled-account rejection are enforced inside that one chokepoint, so any future "Accounting Settings" work can sit *around* this core without touching it.

What is genuinely missing, confirmed by exhaustive search rather than assumption:

- **No semantic account-routing layer.** Every posting service (`InvoiceService`, `PurchaseService`, `ReturnService`, `InventoryService`, `PaymentService`, `ExpenseService`, `AssetService`, `PayrollService`, `CreditNoteService`, `PosExchangeService`, `EmployeeCustodyService`, `CashBankAccountService`, `StocktakeService`, `StockPermitService`, `InventoryOpeningService`, fuel-station services) hardcodes its own `private const ACC_*` account-code strings and resolves them at runtime via `Account::where('code', $code)`. There is no table, model, or config mapping a semantic role (e.g. `sales_revenue`) to a tenant's chosen account. Per CLAUDE.md's own prohibition, these codes are implementation details, not application-level identities — but today the codes *are* the only identity that exists.
- **No fiscal year / fiscal period entity.** Confirmed ABSENT by full-repo search — no year-end close, no P&L-to-retained-earnings closing journal (account 3120 "Retained Earnings" is seeded but never posted to by any service), no reopen workflow.
- **No accounting period lock.** Confirmed ABSENT — every write path (manual journals, inventory openings, and by extension all document services that share the same date-acceptance pattern) accepts an arbitrary caller-supplied date with only format validation, never a business-rule check against a locked range.
- **Cost centers are real but asymmetric.** Header-level cost center exists on purchases and journal lines; a genuine percentage/amount/basis-points line-level allocation table exists **only for invoices** (`invoice_line_cost_center_allocations`). Purchases and inventory movements have no line-level allocation equivalent.
- **Settings infrastructure exists and is reusable**, but only for simple typed policy flags — `App\Support\Settings` is a JSON blob on `tenants.settings`, grouped by domain (`finance`, `sales`, `inventory`, …), with unknown-key stripping as its only structural guard. It is the right home for *scalar policy toggles* (e.g. "require cost center on manual journals: yes/no"), and the wrong home for anything relational (account routing, fiscal periods, period locks) — those need dedicated tables, exactly as `InventoryOpening`, `SettlementType`, and `CostCenter` already do.

This audit recommends a **routing foundation as its own new subsystem** (`AccountingRole` catalog + `AccountRoleMapping` tenant table), introduced with **zero behavior change** — existing hardcoded constants keep working as the fallback — and consumed opt-in, flow by flow, in small PRs. Fiscal periods and period locks are new bounded-context tables enforced centrally in `LedgerService`/`ManualJournalService`/etc., not in the UI. Cost-center settings should surface the existing model, not rebuild it.

---

## 2. Current Architecture

### 2.1 The posting chokepoint

`app/Services/Accounting/LedgerService.php`:

- `post(array $lines, array $meta = []): JournalEntry` — validates balance (`Σdebit === Σcredit`, ≥2 lines, all positive, no line both debit+credit — `validateBalanced()` lines 140-169), resolves `branch_id` (explicit `meta['branch_id']` key, including explicit `null`, wins; otherwise falls back to the active `BranchContext`), wraps everything in `DB::transaction`, rejects posting to `is_group` or `!is_active` accounts (`assertPostable()`, lines 174-183), creates `JournalEntry` (status always `posted`) + `JournalLine` rows, and updates `AccountBalance` snapshots atomically.
- `reverse(JournalEntry $entry, ?string $date, ?string $reason): JournalEntry` — locks the entry (`lockForUpdate`), rejects if not `posted` (checked twice to close a race), creates a mirrored entry with swapped debit/credit and `reversal_of` set, flips the original to `status='reversed'`.
- No update/delete path exists for posted entries anywhere in the codebase — immutability is structural (no method exists to do it), not merely conventional.

Schema (`database/migrations/2025_01_01_000002_create_accounting_core.php`):
- `journal_entries`: `tenant_id, number, entry_date, description, status(draft|posted|reversed), source_type, source_id, reversal_of, created_by, posted_at`. Unique `(tenant_id, number)`.
- `journal_lines`: `tenant_id, journal_entry_id, account_id, debit, credit (bigint halalas), description, partner_type, partner_id`. **No tax field. No currency/exchange-rate field.**
- `cost_center_id` added later (`…000026_create_cost_centers.php`), `branch_id` added later (`…000032_add_branch_to_documents_and_journal_lines.php`) — both nullable FKs, both indexed.

### 2.2 Chart of Accounts

`ChartOfAccountsSeeder` seeds a fixed tree per tenant matching the CLAUDE.md reference codes (1110…5180). `Account` (`app/Models/Account.php`) fields: `tenant_id, parent_id, code, name, name_en, type, normal_balance, is_group, is_system, currency(default SAR, unused for FX), is_active`. Delete is guarded structurally (`booted()` `deleting`): a system account, an account with children, or an account with journal history cannot be deleted — only disabled. Uniqueness is `(tenant_id, code)`, per-tenant not global.

**No semantic-role column exists on `accounts`.** The only per-entity overrides that exist today are ad hoc: `products.sales_account_id` / `products.cogs_account_id` (nullable, no FK constraint) consumed directly in `InvoiceService::post()`, and `fuel_stations.default_inventory_account_id` / `default_revenue_account_id` / `default_cogs_account_id` consumed in `FuelSaleService`. These are two independent, unrelated precedents for "override the default account for this entity" — proof that the *need* for routing already exists in the codebase, informally, twice.

### 2.3 Manual journals — a separate, already-correct feature

Manual journals (`ManualJournal` / `ManualJournalLine`, `ManualJournalService`, `ManualJournalController`, routes at `routes/api.php:394-401`) are explicitly documented in their own migration as "independent draft documents until posted via LedgerService; this migration/controllers never write journal_entries/journal_lines directly." This is the existing template for how a *new* Accounting Settings feature (e.g. period locks, or a future "recurring journal template") should relate to the ledger: draft state of its own, `LedgerService::post()` as the only door into `journal_entries`.

### 2.4 Document → account resolution → LedgerService (mapped flows)

| Source document | Service | Account constants (all `private const`, hardcoded) | `ledger->post()` call site |
|---|---|---|---|
| Invoice | `InvoiceService.php` | `ACC_CASH=1110, ACC_RECEIVABLE=1130, ACC_SALES=4110, ACC_SHIPPING=4130, ACC_ADJUSTMENT=5170, ACC_VAT_OUTPUT=2120` (+ per-product `sales_account_id` override) | line 921 |
| Purchase | `PurchaseService.php` | `ACC_INVENTORY=1140, ACC_INPUT_VAT=1150, ACC_EXPENSE=5150, ACC_PAYABLE=2110, ACC_ADJUSTMENT=5170` | line 446 |
| Sales return | `ReturnService.php` | `ACC_SALES=4110, ACC_OUTPUT_VAT, ACC_CASH, ACC_RECEIVABLE` (+ separate COGS-reversal entry against `ACC_COGS=5110`/`ACC_DAMAGE=5180`) | lines 414, 478-480 |
| Purchase return | `ReturnService.php` | `ACC_INVENTORY=1140, ACC_EXPENSE=5150, ACC_INPUT_VAT=1150` | line 639 |
| Stock movement / COGS on sale | `InventoryService.php` | `ACC_INVENTORY=1140, ACC_COGS=5110, ACC_OPENING=3130, ACC_PAYABLE=2110` | lines 50, 278 |
| Payment (receipt/disbursement) | `PaymentService.php` | `ACC_RECEIVABLE=1130, ACC_PAYABLE=2110` + **dynamic** cash/bank account resolved from `cash_bank_accounts` via `resolveForPayment()` — the one flow that is *already* partially "routed" rather than hardcoded | line 319 |
| Expense | `ExpenseService.php` | `ACC_CASH=1110, ACC_BANK=1120, ACC_PAYABLE=2110, ACC_INPUT_VAT=1150` | line 163 |
| Asset acquisition/depreciation | `AssetService.php` | `ACC_CASH, ACC_BANK, ACC_PAYABLE, ACC_INPUT_VAT=1150, ACC_ACCUM_DEP=1230, ACC_DEP_EXPENSE=5160` | (multiple) |
| Payroll | `PayrollService.php` | `5120, 2130, 2140, 2150, 1110, 1120` | (multiple) |
| Credit note | `CreditNoteService.php` | `1110, 1130, 2120, 4110, 2110, 1150, 5115` | (multiple) |
| Inventory opening | `InventoryOpeningService.php` | `ACC_INVENTORY=1140, ACC_OPENING=3130` | line ~336 (single entry for the whole document) |
| Employee custody | `EmployeeCustodyService.php` | `ACC_CUSTODY=1160` | — |
| Stocktake / stock permits | `StocktakeService.php`, `StockPermitService.php` | `ACC_INVENTORY=1140, ACC_VARIANCE/ACC_ADJUSTMENT=5180` | — |
| POS exchange | `PosExchangeService.php` | `ACC_CASH=1110, ACC_RECEIVABLE=1130` | — |
| Fuel sale / supply / corporate fuel | `FuelSaleService.php`, `FuelSupplyReceivingService.php`, `CorporateFuelAuthorizationService.php` | `5110, 1140, 2110, 1130` (+ per-station override accounts) | — |

**Every code in this table is a private constant local to its own service.** There is no shared registry, no single place that says "sales_revenue = whatever the tenant configured." Changing a code today means editing PHP in N services.

### 2.5 Cost centers

`CostCenter` model (`BranchScoped`, so branch-visible per tenant's `share_cost_centers` setting), table `cost_centers` (`code`, `name`, `is_active`, unique `(tenant_id, code)`). `journal_lines.cost_center_id` is nullable and threaded through by every posting service that supports it.

Line-level percentage/amount/basis-points allocation exists **only for invoices**: `invoice_line_cost_center_allocations` (`mode: percent|amount`, `basis_points` unsigned int where 10000 = 100.00%, `amount` bigint halalas, `position` for remainder absorption). Purchases only have a header-level `purchases.cost_center_id`. Inventory movements have no cost-center concept at line level at all.

### 2.6 Currency / tax on journal lines

No multi-currency: `grep exchange_rate` across the whole repo returns zero hits. `accounts.currency` and `tenants.currency` exist as string labels (default `SAR`) but are never consumed by any conversion logic — this is a single-currency system today, regardless of the stored column.

`journal_lines` has **no tax column** — VAT is posted as its own separate line against `2120`/`1150`, never as a tag on another line. Tax rate/amount live on `invoice_lines.tax_rate`/`line_tax` and `purchase_lines.tax_rate`/`line_tax`, computed and never user-entered (consistent with CLAUDE.md's "derived totals" rule).

### 2.7 Fiscal periods / period locks — confirmed ABSENT

Exhaustive grep across `app/`, `database/migrations/`, `routes/`, `tests/` for `fiscal`, `FiscalYear`, `FiscalPeriod`, `accounting_period`, `period_start`/`period_end` (accounting sense), `opening_balance` (year-level), `closing`, `retained_earnings`, `reopen`, `lock`, `locked_period`, `period_lock`, `closing_date`, `lock_date` returns **zero** accounting-relevant hits. The only near-miss terms are unrelated domains: `PayrollRun` period fields, POS session cash open/close, fuel-station shift close, document-review reopen, investigation-case reopen — none of these is a fiscal-period or lock concept.

Account `3120` "Retained Earnings" is seeded by `ChartOfAccountsSeeder` but **never posted to** by anything in the codebase. Account `3130` "Opening Balances" is used, but only for one-time partner/product/inventory opening entries (`PartnerService`, `InventoryService`, `InventoryOpeningService`) — not year-end closing.

Every write path that takes a date (`ManualJournalService::create`/`post`, `StoreManualJournalRequest`, `InventoryOpeningService`, `ImportInventoryOpeningRequest`) validates the date only for *format*, never against a business-rule boundary. There is no middleware named or shaped like a period lock anywhere in `app/Http/Middleware/`.

Audit-trail infrastructure is domain-siloed, not generic: POS (`PosAuditService` over `PosSessionEvent`), Document Center (`DocumentSourceAuditLogger`), Fuel, Platform Integration each have their own bespoke append-only event table. None cover core financial write paths (invoices, purchases, payments, manual journals). `ManualJournalTest::it_never_reopens_a_posted_manual_journal_for_editing_or_deletion` shows immutability today is enforced structurally, not via a logged trail.

### 2.8 Settings infrastructure

`App\Support\Settings` (`app/Support/Settings.php`): a static facade over a single JSON column, `tenants.settings` (added by `…000017_add_settings_to_tenants.php`), cast to `array`. `DEFAULTS` const enumerates groups (`company, sales, inventory, purchases, finance, reports, zatca, numbering, document_intelligence, fuel_stations`) and every allowed key with its default. `group()` merges stored values with defaults, **dropping unknown keys** (`array_intersect_key`). `put()` mirrors the same intersection before writing back the whole `settings` blob. No caching layer — every call re-reads. No group-level validation inside `Settings` itself; that's delegated to per-group `FormRequest` classes (`UpdateFinanceSettingsRequest`, etc.).

`App\Support\BranchSettings` is the same pattern under a separate top-level `branches` key, deliberately kept as its own group specifically because `Settings::put()` fully replaces a group by its known-key set and would silently erase a co-located owner's keys — a real, documented footgun worth remembering when adding a new `accounting` settings group.

The finance settings "hub" (`/finance-settings` in the frontend, `FinanceSettingsController` in the backend) is **not one model** — it's a page that links out to several independently-modeled entities (`ExpenseCategory`, `SettlementType`, `EmployeeCustody`) plus one JSON settings group (`financial_alerts_enabled`, `alert_check_window_days`, `allow_negative_transfer_balance`). This composition pattern — a settings hub page assembling several purpose-built backends — is the direct precedent for how Accounting Settings should be built.

`App\Support\Rbac`: role→permission `MATRIX` with a per-tenant `roles` table taking precedence when present (fallback to `MATRIX` if absent/unmigrated). Existing accounting-relevant permission keys: `accounts.view/manage`, `payments.view/manage`, `expenses.view/manage`, `cost_centers.view/manage`, `reports.view`, `company.manage`, `zatca.view`. **No `accounting.*` or `settings.*` namespaced keys exist** — every existing settings screen reuses the nearest domain permission (finance settings uses `payments.*`; report settings uses `reports.view`/`company.manage`).

`App\Support\ApplicationCatalog` has `accounting.ledger` (mandatory, built) and `finance.operations` (built, gates expense/custody routes) — but **no catalog key exists for "accounting settings" or "finance settings"**; those screens are gated by RBAC only, not by `EnsureApplicationActive`. Notably, `settlement-types` routes aren't even app-gated today (an existing minor inconsistency, not something this audit is asked to fix).

`CompanyWide` (marker interface, e.g. `SettlementType`) vs. `BranchScoped` (trait + global scope, e.g. `ExpenseCategory`, `CostCenter`) vs. `BelongsToBranch` (write-tagging only, no filtering) are the three classifications any new model must pick, per CLAUDE.md's non-negotiable rule and `BranchIsolationGuardTest`.

### 2.9 Frontend

Sidebar (`web/src/components/layout/sidebar.tsx`) already has an `accounting` group (`دليل الحسابات` → `/accounts`, `القيود اليومية` → `/journal-entries`, `assets`, `مراكز التكلفة` → `/cost-centers`, and a `cheques` placeholder with no `built:true`), sitting in the same `SUPER_GROUPS.finance` bucket as the `finance` group (which already ends in a `financeSettings` → `/finance-settings` hub link). Item/group visibility is gated per `appKey` via `GET /applications/nav-state`.

**Discovered inconsistency, not part of this task to fix:** two journal-entry route trees exist on disk — `web/src/app/(app)/journal-entries/` (wired into the sidebar as `manualJournals`) and `web/src/app/(app)/manual-journals/` (present on disk, **not referenced anywhere in `GROUPS`**). This should be resolved (confirm which is current, remove or wire the other) before or alongside any new accounting-settings frontend work, since a new settings page will link to "manage journals" and must point at the live route.

`DESIGN_SYSTEM.md` mandates: RTL-first, dense hero tables, single identity color via tokens (no raw hex), no gradients/heavy shadows/decorative icon boxes, explicit empty/loading/error states, desktop-first with table→card mobile fallback, mandatory Riyal glyph `₁` (U+20C1) via `formatRiyal`. `finance-settings/page.tsx` is explicitly documented in `DESIGN_SYSTEM.md` as the existing settings-hub pattern (card grid, some cards `href:null` showing "قريباً").

---

## 3. Gap Matrix

| Capability | Current AWJ State | Reusable Foundation | Gap | Risk | Recommendation |
|---|---|---|---|---|---|
| Ledger posting engine / immutability | COMPLETE | `LedgerService`, tests (`LedgerTest`) | none | — | Reuse unchanged; never modify |
| Manual journals | COMPLETE | `ManualJournal(Service/Controller)`, tests (`ManualJournalTest`) | none for v1 scope | — | Reuse as template for draft→post pattern |
| Chart of accounts / account lifecycle | COMPLETE | `Account`, `ChartOfAccountsSeeder`, delete guards | No semantic-role column | Low (additive) | Add routing layer beside it, don't touch schema of `accounts` |
| Cost centers (entity, journal integration) | COMPLETE | `CostCenter`, `journal_lines.cost_center_id`, tests (`CostCenterTest`, `CostCenterReportTest`) | none | — | Surface existing model in Settings UI; no backend change |
| Cost-center line allocation — invoices | COMPLETE | `invoice_line_cost_center_allocations`, tests (`InvoiceCostCenterAllocationTest`) | none | — | Reuse pattern |
| Cost-center line allocation — purchases | FOUNDATION_ONLY | header `purchases.cost_center_id` only | No line-level table | Medium (reporting granularity gap, not correctness) | New migration mirroring invoice allocation table; separate PR |
| Cost-center line allocation — inventory | ABSENT | none | Full gap | Low priority | Explicit non-goal unless a use case appears |
| Tenant Settings JSON facade | COMPLETE for scalar policy | `App\Support\Settings`, `BranchSettings` | Not relational-safe (no FK, no audit, whole-group overwrite) | Medium if misused for routing | Use only for scalar accounting policy flags |
| Semantic account routing | ABSENT | Two informal precedents (`products.sales_account_id`, fuel station defaults) | No role catalog, no mapping table, no resolver | High (any change today = code deploy) | New `AccountingRole` + `AccountRoleMapping`, additive, opt-in per flow |
| Fiscal year / period entity | ABSENT | none | Full gap | High for future year-end close correctness | New bounded domain, dedicated tables, no shortcuts via Settings JSON |
| Year-end closing journal | ABSENT | `LedgerService::post()` can produce it once designed | Full gap | High | Design only in this audit; do not implement yet |
| Accounting period lock | ABSENT | none | Full gap | High (financial-control gap today) | Central guard invoked from every posting service, not UI-only |
| Multi-currency / exchange rate | ABSENT | `currency` columns exist as unused labels | Full gap | Low (explicitly out of scope for AWJ today) | Non-goal; do not build speculatively |
| Tax on journal lines | ABSENT (posted as separate lines) | Existing VAT line pattern works | None — by design | — | Keep as-is; do not add a tax column to `journal_lines` |
| Generic audit logging for accounting | PARTIAL (domain-siloed patterns exist) | POS/DocumentCenter audit-event tables as a pattern | No accounting-specific audit trail | Medium | New `AccountingSettingsAuditEvent`-style table per CLAUDE.md pattern, scoped to settings changes only |
| RBAC namespace for accounting settings | ABSENT | `Rbac::PERMISSIONS`, per-tenant `roles` table | No `accounting.*`/`settings.*` keys | Low | Add `accounting_settings.view`/`accounting_settings.manage` permissions |
| ApplicationCatalog gating for settings | ABSENT | `accounting.ledger` mandatory key exists | No catalog key for the settings surface itself | Low | Reuse `accounting.ledger` as the governing capability (mandatory ⇒ always visible); do not invent a new gate for something that must always be reachable |
| Frontend home for Accounting Settings | Sidebar group + hub pattern exist | `accounting` sidebar group, `finance-settings` hub component pattern | No dedicated route yet | Low | New `/accounting-settings` (or extend the `accounting` sidebar group with a settings leaf) — see §10 |

---

## 4. Recommended Target Architecture

### 4.1 Semantic Account Roles

Introduce a **static catalog**, mirroring `ApplicationCatalog`'s own pattern (a PHP const array is the source of truth for the *shape* of roles, not tenant data):

```php
App\Support\AccountingRoles::ROLES = [
    'sales_receivable'      => ['group' => 'sales',     'normal_balance' => 'debit',  'account_type' => 'asset'],
    'sales_revenue'         => ['group' => 'sales',     'normal_balance' => 'credit', 'account_type' => 'revenue'],
    'sales_returns'         => ['group' => 'sales', ...],
    'sales_discount'        => ...,
    'cogs'                  => ['group' => 'inventory', ...],
    'purchase_payable'      => ['group' => 'purchases', ...],
    'purchases_or_inventory'=> ...,
    'purchase_returns'      => ...,
    'purchase_discount'     => ...,
    'inventory_asset'       => ...,
    'inventory_adjustment_gain' => ...,
    'inventory_adjustment_loss' => ...,
    'inventory_damage'      => ...,
    'tax_output'            => ...,
    'tax_input'             => ...,
    'cash'                  => ...,
    'bank'                  => ...,
    // retained_earnings is deliberately NOT in v1 — it belongs to the fiscal-period closing
    // design (§4.4), which is a separate, later decision.
];
```

This list is **derived from §2.4's table**, not invented — every role above already exists as a hardcoded constant in some service today. It is not final; each routing PR (§5) only adds the roles that specific PR's flow actually needs.

### 4.2 Tenant Mapping

New table `account_role_mappings`: `tenant_id, role_key, account_id, branch_id (nullable), created_by, timestamps`. Unique `(tenant_id, role_key, branch_id)` where `branch_id IS NULL` means "tenant default" (matching the existing partial-unique-index pattern used elsewhere in this codebase, e.g. numbering). `CompanyWide` classification for the tenant-default row set; branch-specific rows are an explicit, later opt-in — **do not build branch-level routing in the same PR as the tenant-level foundation.**

### 4.3 Resolution — `AccountRoutingService`

```php
AccountRoutingService::resolve(string $roleKey, ?string $branchId = null): Account
```

Order: branch-specific mapping (if `$branchId` given and a row exists) → tenant-default mapping (row with `branch_id = null`) → **hardcoded fallback constant already in the calling service**. This is why the migration is safe: every existing service keeps its `private const ACC_*` as the last-resort default, so a tenant that never configures anything behaves exactly as today. A missing *required* mapping never means "silently guess" — it means "fall back to the code's own constant," which is a real, tested, already-shipped value, not a guess.

**Explicitly not adopted in v1:** line override → product/category mapping → branch mapping → transaction mapping → tenant default. That five-level precedence is deferred. Today AWJ has exactly one informal per-entity override precedent (`products.sales_account_id`) and it is already special-cased inside `InvoiceService`. Folding it into a generic precedence chain is a real design decision with real conflict cases (what wins when a product has `sales_account_id` set *and* the tenant has since re-routed `sales_revenue` to a different account?) that deserves its own audited PR once the tenant-default layer has shipped and been observed in production. Recommending it "automatically," as the task instructions themselves warn against, would be premature.

### 4.4 Posted documents freeze resolved account IDs

Non-negotiable: `JournalLine.account_id` is already resolved and stored at post time (this is how the ledger works today, unconditionally). A later change to `account_role_mappings` **never** rewrites historical `journal_lines`. This requires no new code — it is already true, because `LedgerService::post()` writes concrete `account_id`s, not role keys. The routing layer only decides *which* account ID to pass in at the moment of posting a new document. This must be verified as an explicit test invariant (§6) precisely because it is easy to violate accidentally (e.g. a report or reprint path that re-resolves the role at render time instead of reading the stored `account_id`).

### 4.5 Disabled/deleted mapped account

`Account::deleting` guard already prevents deletion of any account with journal history or system flag — a mapped account with real postings physically cannot be deleted today. It *can* be disabled (`is_active=false`). `AccountRoutingService::resolve()` must check `is_active` and, if the mapped account is disabled, behave exactly like "no mapping configured" (fall back to the hardcoded constant) **and** surface a warning to `owner`/`admin` on the settings screen — never silently post to a disabled account (which `LedgerService::assertPostable()` already rejects at the ledger layer regardless, so this is defense in depth, not the only guard).

### 4.6 Fiscal Periods (design only — no implementation)

New bounded context, new tables, deliberately **not** reusing `App\Support\Settings`:

- `fiscal_years` (`tenant_id, code, start_date, end_date, status: open|closed`, `CompanyWide`).
- `fiscal_periods` (`tenant_id, fiscal_year_id, start_date, end_date, status: open|closed`, `CompanyWide`) — monthly/quarterly subdivisions, optional for v1 (a fiscal year with no sub-periods is a valid minimal implementation).
- Closing is a **new explicit journal-posting operation** through the existing `LedgerService::post()` — never a direct write. It debits every revenue/expense account's net balance and credits/debits `retained_earnings` (3120, finally put to use). This is a full feature in its own right (PR-ACC-SET-8, §5) and is *designed* here, not built.
- Reopening a closed year requires a **reversal of the closing journal** via `LedgerService::reverse()`, not a status flip alone — otherwise the ledger and the `fiscal_years.status` flag disagree.

### 4.7 Accounting Period Locks

A `locked_periods` table (`tenant_id, branch_id (nullable = tenant-wide), start_date, end_date, locked_by, locked_at, reason`), `CompanyWide` by default (branch-level locking is a later, explicit extension — same reasoning as §4.2).

**Enforcement lives server-side, in one place reused by every write path**, not per-controller and not in the UI: a `PeriodLockGuard::assertMutable(string $tenantId, string $effectiveDate, ?string $branchId): void` called at the **start** of every posting service's transaction (`InvoiceService::post`, `PurchaseService::post`, `ReturnService::post`, `PaymentService::post`, `ExpenseService::post`, `ManualJournalService::post`, `InventoryOpeningService::post`, `AssetService`, `PayrollService`, POS-generated postings, and the bulk-import paths that eventually call these same services). It throws before any `LedgerService::post()` call, so a locked period simply cannot produce a journal entry — full stop, no matter which document type or entry point (API, POS, import) originated the request.

**Reversal in a locked period:** a `LedgerService::reverse()` call must be allowed to target an entry whose *original* `entry_date` falls inside a now-locked period, because correcting a mistake discovered after close is exactly what reversal exists for — but the **reversal's own `entry_date`** (the date parameter passed to `reverse()`) is itself subject to the same `PeriodLockGuard` check, dated at *today* (or whatever date the accountant picks for the correcting entry), not the original entry's date. In other words: locking the past does not forbid correcting the past, it forbids *dating a new posting inside* the locked range. This distinction must be a named test case (§6).

### 4.8 Cost Centers

No architecture change recommended. `CostCenterTest`, `CostCenterReportTest`, `InvoiceCostCenterAllocationTest` already prove end-to-end correctness for the invoice path. Accounting Settings should only **surface** existing `CostCenter` CRUD (which already has a working page at `/cost-centers`) inside the settings workspace as a navigational convenience, and optionally add the purchase-line allocation table from the gap matrix — as its own separate PR, not bundled into the settings UI PR.

---

## 5. Required Architecture Decisions

1. **What belongs in Tenant Settings (`App\Support\Settings`)?** Only scalar, non-relational policy flags with a fixed default and no foreign key — e.g. `require_cost_center_on_manual_journal: bool`, `default_rounding_account_policy: enum`. Never an account ID, a period boundary, or anything that needs its own audit trail or uniqueness constraint across rows.
2. **What requires dedicated database entities?** Account role mappings, fiscal years/periods, period locks, purchase-line cost-center allocations — all four are relational, need FKs, need row-level audit, and/or need concurrency control (locking) that a JSON blob cannot provide safely.
3. **How should semantic Account Roles be represented?** A static PHP catalog (`AccountingRoles::ROLES`, mirroring `ApplicationCatalog`) for the *shape*, plus a per-tenant `account_role_mappings` table for the *value*. Never encode the role as a column on `accounts` itself (an account's meaning is tenant-assigned, not intrinsic to the account row, and one account could theoretically serve more than one role for some tenants).
4. **How should Account Routing resolve an account?** `AccountRoutingService::resolve(role, branchId)`: branch mapping → tenant mapping → existing hardcoded constant fallback (§4.3). No product/category precedence in v1.
5. **What should happen when a required mapping is missing?** Fall back to the existing hardcoded default — never throw, never silently pick an arbitrary account. This preserves 100% backward compatibility on day one of the feature shipping.
6. **What should happen if a mapped account is disabled/deleted?** Deletion is already structurally impossible for an account with journal history (existing guard). Disabled ⇒ treat as "unmapped," fall back to hardcoded default, surface a warning in the settings UI.
7. **How should branch overrides interact with tenant defaults?** Branch row wins if present; otherwise tenant default; branch-level mapping is a later opt-in extension, not v1.
8. **Should posted documents freeze resolved account IDs?** Yes — already true today structurally (`journal_lines.account_id` is concrete at post time); must be protected by a regression test, not new code.
9. **How should historical journals behave after routing changes?** Untouched. A routing change only affects documents posted *after* the change. This must be a named test (§6): change a mapping, re-fetch an old journal entry, assert its `account_id` is unchanged.
10. **Where should accounting-period lock enforcement live?** Server-side, in a single reusable guard (`PeriodLockGuard`) called at the top of every posting service's `post()` method — never only in the frontend/UI.
11. **How should reversal documents behave in locked periods?** The reversal's own posting date is checked against the lock; the original entry's date is not re-checked (§4.7).
12. **Which existing cost-center implementation should be reused unchanged?** `CostCenter` model, `journal_lines.cost_center_id`, and the invoice-side `invoice_line_cost_center_allocations` — all reused as-is; only the settings *UI* surface is new.
13. **Which settings require new permissions?** All of them — none of today's permission keys are a good semantic fit. Add `accounting_settings.view` / `accounting_settings.manage` (owner/admin by default in `Rbac::MATRIX`, and addable to the per-tenant `roles` table like every other permission).
14. **Which settings require audit logging?** Account routing changes, period locks (creation/removal), and fiscal-year close/reopen — all three directly affect financial-statement correctness and must be logged with actor, timestamp, and before/after values, following the existing domain-siloed audit-event table pattern (e.g. `AccountingSettingsAuditEvent`), not a generic cross-cutting logger (there isn't one, and building one is out of scope here).

---

## 6. Proposed PR Plan

Each PR is independently reviewable, independently revertible, and additive (no existing behavior changes unless explicitly noted).

**PR-ACC-SET-1 — Accounting Settings workspace (read-only shell)**
- Scope: new `/accounting-settings` frontend route (or a leaf added to the existing `accounting` sidebar group) presenting a card-grid hub, following the `finance-settings/page.tsx` pattern exactly. Cards: "الإعدادات العامة", "توجيه الحسابات", "الفترات المالية", "قفل الفترات", "مراكز التكلفة" — all except "مراكز التكلفة" initially `href: null` ("قريباً") until their own PRs land; "مراكز التكلفة" links straight to the existing `/cost-centers` page (no new backend).
- Migrations: none. API changes: none (or one trivial `GET /applications/nav-state`-style read if the sidebar entry needs its own flag — reuse `accounting.ledger`, do not invent a new catalog key).
- Accounting impact: none. Tenant-isolation impact: none (pure navigation).
- Tests: frontend route renders, sidebar entry visible under existing RBAC (`accounts.view` or new `accounting_settings.view`, see PR-2).
- Rollback: delete the route/component; zero data risk.

**PR-ACC-SET-2 — General accounting policies (Settings group + permission)**
- Scope: add `accounting` group to `Settings::DEFAULTS` (e.g. `require_cost_center_on_manual_journal`, future placeholders), `AccountingSettingsController` (`GET/PUT /settings/accounting`), `UpdateAccountingSettingsRequest`, add `accounting_settings.view`/`accounting_settings.manage` to `Rbac::PERMISSIONS` and `MATRIX` (owner/admin).
- Migrations: none (reuses `tenants.settings` JSON column). API: 2 new endpoints. UI: general-settings card becomes live.
- Accounting impact: none until a flag is actually consumed by a posting service in a later PR.
- Tests: settings round-trip, unknown-key stripping, RBAC enforcement, tenant isolation (tenant A cannot read/write tenant B's group).
- Rollback: trivial — new endpoints unused elsewhere.

**PR-ACC-SET-3 — Semantic account roles + routing foundation**
- Scope: `AccountingRoles` static catalog, `account_role_mappings` migration + model (`CompanyWide`), `AccountRoutingService::resolve()`, `AccountRoutingController` (`GET/PUT /settings/accounting/routing`). **No posting service is modified in this PR** — the resolver exists and is tested, but nothing calls it yet.
- Dependencies: PR-2 (permission key).
- Migrations: yes (new table only, additive). API: new endpoints. UI: routing card becomes live (list roles, assign accounts, validate account type/normal_balance compatibility with the role's declared shape).
- Accounting impact: **zero** — nothing consumes the resolver yet, so no posting behavior can change.
- Tests: mapping CRUD, tenant isolation, uniqueness constraint, cross-tenant account injection (assigning tenant B's account to tenant A's mapping must be rejected), disabled-account handling.
- Rollback: drop table, remove endpoints; nothing else depends on it yet.

**PR-ACC-SET-4 — Sales routing (opt-in)**
- Scope: `InvoiceService` calls `AccountRoutingService::resolve('sales_revenue'|'sales_receivable'|'sales_returns'|'tax_output', ...)` with the existing `ACC_*` constant as the fallback parameter, replacing direct constant reads only for these roles.
- Dependencies: PR-3.
- Accounting impact: **only for tenants who configure a mapping** — unmapped tenants get byte-identical postings to today (this must be a regression test: run the full existing `LedgerTest`/invoice posting test suite with zero mappings configured and assert identical journal output before/after this PR).
- Tests: existing invoice-posting tests unchanged and green; new tests for mapped-tenant routing; historical-document stability (post before mapping, add mapping, re-fetch old journal — unchanged).
- Rollback: revert the resolver calls back to direct constants; `account_role_mappings` rows become inert data, no cleanup required.

**PR-ACC-SET-5 — Purchase routing (opt-in)** — same shape as PR-4, for `PurchaseService` roles (`purchase_payable`, `purchases_or_inventory`, `purchase_returns`, `tax_input`).

**PR-ACC-SET-6 — Inventory routing (opt-in)** — same shape, for `InventoryService`/`InventoryOpeningService` roles (`inventory_asset`, `inventory_adjustment_gain/loss`, `inventory_damage`, `cogs`).

**PR-ACC-SET-7 — Accounting period locks**
- Scope: `locked_periods` migration + model (`CompanyWide`), `PeriodLockGuard`, wired into every posting service listed in §4.7 at the top of each `post()`/`create()` transaction, `LockedPeriodController` (`GET/POST/DELETE /settings/accounting/period-locks`).
- Dependencies: PR-2 (permission).
- Migrations: yes. API: new endpoints + new exception type (`PeriodLockedException` → HTTP 422) surfaced consistently across every affected controller.
- Accounting impact: real behavior change — this PR **can** reject postings that succeeded before, by design, only for dates inside a lock a tenant explicitly created. Must ship with a clear error message and be off (no locks exist) by default for every tenant.
- Tests: every write path in §2.7's list, individually, both inside and outside a lock; reversal-in-locked-period case (§4.7); concurrent lock creation vs. in-flight posting (race test); manual-journal and POS-generated documents specifically, since those are the two paths most likely to be missed.
- Rollback: disable the guard behind a settings flag if a production issue is found, or revert the PR — no data migration needed since locks are additive rows.

**PR-ACC-SET-8 — Fiscal periods + year-end closing**
- Scope: `fiscal_years`/`fiscal_periods` migrations + models, closing-journal generation service (posts through `LedgerService::post()`), reopen-via-reversal flow, `FiscalYearController`.
- Dependencies: PR-7 (closing a year should also lock it — natural integration, not a hard requirement).
- This is the largest and riskiest PR in the plan; strongly recommend splitting further at implementation time (e.g. 8a = fiscal year CRUD with no closing logic, 8b = closing journal generation, 8c = reopen) once this audit is acted on.
- Tests: closing journal balances to zero net income moved to retained earnings; reopen produces a correct reversal; closing an already-closed year is rejected; concurrent close attempts.

**PR-ACC-SET-9 — Cost-center settings integration + purchase-line allocation (optional)**
- Scope: settings-hub card links to existing `/cost-centers`; separately, if approved, add `purchase_line_cost_center_allocations` mirroring the invoice table.
- Dependencies: none beyond PR-1.
- Accounting impact: additive reporting granularity only; no existing behavior changes.

---

## 7. Test Strategy

Required test coverage, mapped to existing test-file conventions (`tests/Feature/*Test.php`):

- **Tenant isolation:** every new table (`account_role_mappings`, `locked_periods`, `fiscal_years`) gets a dedicated cross-tenant read/write rejection test, plus inclusion in `BranchIsolationGuardTest`'s classification check (`CompanyWide`).
- **Cross-tenant account injection:** attempting to map a role to an `Account` belonging to a different tenant must fail — explicit test in PR-3.
- **Branch isolation:** if/when branch-level mapping ships, a branch-scoped mapping from tenant A branch 1 must not leak into branch 2.
- **Missing account mapping:** resolver falls back correctly; posting succeeds identically to pre-routing behavior.
- **Disabled account mapping:** resolver falls back, ledger's own `assertPostable` remains the final backstop even if the fallback logic had a bug.
- **Account deletion protection:** already covered by existing `Account::booted()` guard — add a test that a *mapped* account additionally cannot be deleted (defense-in-depth, since journal history already blocks it once used).
- **Historical document/journal stability:** post, change mapping, re-fetch — `journal_lines.account_id` unchanged. This is the single most important regression test in the whole plan.
- **Routing changes:** old documents unaffected; new documents pick up new mapping immediately.
- **Concurrent settings changes:** two admins updating the same mapping/lock simultaneously — last-write-wins is acceptable but must not corrupt data (DB constraint, not application-level lock, is the real guard here).
- **Locked periods:** every write path in §2.7/§4.7 individually, both directions (inside lock rejected, outside lock allowed).
- **Reversal in locked periods:** original date locked, reversal date unlocked → allowed; reversal date itself inside a lock → rejected (§4.7).
- **Sales/purchase posting, sales/purchase returns, inventory adjustments, COGS, taxes, cost-center allocations, manual journals:** existing test suites (`LedgerTest`, `ManualJournalTest`, `CostCenterTest`, `CostCenterReportTest`, `InvoiceCostCenterAllocationTest`, `InventoryOpeningPostingTest`, `InventoryOpeningImportTest`) must remain 100% green, unmodified in assertions, throughout every PR in §6 — any red test here means a routing/lock change altered existing behavior and the PR must be reworked, not the test.
- **API bypass attempts:** direct `POST /manual-journals/{id}/post` (or equivalent) with a date inside a lock must be rejected at the service layer even if a hypothetical future UI forgot to check client-side — this is exactly why §4.7 insists on a server-side guard.

No financial or security test may be reduced, skipped, or weakened for convenience, per the task's mandatory rule — this audit assumes and requires the same standard when the PRs above are implemented.

---

## 8. Risks

- **PR-7 (period locks) and PR-8 (fiscal close) are the only PRs in this plan with real behavior change.** Everything before them is additive-and-inert by construction. Sequencing matters: do not build fiscal-year closing before period locks exist, or a closed year has no enforcement keeping new documents out of it.
- **The routing fallback chain (§4.3) must be implemented as "no mapping ⇒ literally call the same private constant that exists today,"** not as "no mapping ⇒ look up a generic 'default' role that itself needs configuring." Any deviation from this reintroduces exactly the deployment-risk problem routing is meant to solve.
- **`Settings::put()`'s whole-group overwrite behavior** (documented in §2.8 for `BranchSettings`) is a real footgun if a future PR carelessly adds accounting policy keys to an *existing* group instead of a new `accounting` group — must use a dedicated group.
- **The `journal-entries` vs `manual-journals` route duplication in `web/`** (§2.9) should be resolved before PR-1 ships a settings hub that links to "manage your journals," or the link may point at a stale/orphaned page.
- **No generic audit-log service exists** — PR-7/8/3's audit requirements (§5.14) will each need their own small audit-event table, following the existing domain-siloed pattern; do not attempt to retrofit a generic cross-cutting logger as part of these PRs, that is a separate, larger initiative.

---

## 9. Explicit Non-Goals

- Multi-currency / exchange-rate support — no evidence of demand in the current codebase; do not build speculatively.
- Tax columns on `journal_lines` — the existing separate-VAT-line pattern is correct and complete; do not change it.
- Product/category-level routing precedence — deferred pending real usage data from the tenant-default layer (§4.3).
- A generic cross-cutting audit-log framework — out of scope; reuse the existing per-domain event-table pattern instead.
- Journal custom fields, asset custom fields — explicitly deferred per the task brief; not designed in this audit.
- Branch-level account routing and branch-level period locks — the tenant-level foundation ships first; branch overrides are a later, separately-audited extension.
- Rebuilding cost centers — the existing implementation is COMPLETE for its current scope and must be reused unchanged.

---

## 10. Frontend / UX Placement

Recommended: extend the existing `accounting` sidebar group (already present, already in `SUPER_GROUPS.finance`) with a new leaf item — `accountingSettings` → `/accounting-settings` — rather than inventing a second settings hub. This mirrors the existing `finance` group's own `financeSettings` leaf exactly, keeping one settings-hub-per-domain-group convention instead of two competing patterns. `/accounting-settings` itself follows the `finance-settings/page.tsx` card-grid component precedent (`ITEMS` array, `href: null` for not-yet-built cards showing "قريباً"), inheriting `DESIGN_SYSTEM.md` tokens with zero new component invention. Warehouses/inventory settings remain under Products & Inventory, unaffected — nothing in this audit's findings suggests moving them.

Before PR-1 ships, resolve the `journal-entries`/`manual-journals` route duplication noted in §2.9/§8 so the settings hub links to a single, confirmed-current journals page.

---

## 11. Recommended First Implementation PR

**PR-ACC-SET-1** (workspace shell) is safe to build immediately with zero accounting risk — it is pure navigation and contains no migrations, no new writes, no changed posting behavior. It also forces early resolution of the `journal-entries`/`manual-journals` duplication (§9's flagged risk) since the hub will need to link somewhere real.

**PR-ACC-SET-3** (routing foundation, resolver built but not yet consumed by any posting service) is the recommended first *backend* PR, because every subsequent routing PR (4/5/6) depends on it and it is provably zero-risk: nothing calls `AccountRoutingService::resolve()` until PR-4 ships, so PR-3 cannot change a single journal entry produced by the system, and its own test suite fully exercises the new table's tenant isolation and validation before anything real depends on it.

---

## 12. Files Inspected (representative, not exhaustive)

**Backend — ledger core:** `app/Services/Accounting/LedgerService.php`, `app/Models/JournalEntry.php`, `app/Models/JournalLine.php`, `app/Models/Account.php`, `app/Models/AccountBalance.php`, `app/Services/Accounting/ChartOfAccountsSeeder.php`, `database/migrations/2025_01_01_000002_create_accounting_core.php`, `database/migrations/2025_01_01_000026_create_cost_centers.php`, `database/migrations/2025_01_01_000032_add_branch_to_documents_and_journal_lines.php`.

**Backend — manual journals:** `app/Models/ManualJournal.php`, `app/Models/ManualJournalLine.php`, `app/Services/Accounting/ManualJournalService.php`, `app/Http/Controllers/Api/ManualJournalController.php`, `database/migrations/2025_01_01_000077_create_manual_journals.php`, `tests/Feature/ManualJournalTest.php`.

**Backend — document posting services:** `app/Services/Accounting/InvoiceService.php`, `PurchaseService.php`, `ReturnService.php`, `InventoryService.php`, `PaymentService.php`, `ExpenseService.php`, `AssetService.php`, `PayrollService.php`, `CreditNoteService.php`, `InventoryOpeningService.php`, `EmployeeCustodyService.php`, `StocktakeService.php`, `StockPermitService.php`, `PosExchangeService.php`, `PosSessionService.php`, `CashBankAccountService.php`; `app/Services/FuelSaleService.php`, `FuelSupplyReceivingService.php`, `CorporateFuelAuthorizationService.php`.

**Backend — cost centers:** `app/Models/CostCenter.php`, `database/migrations/2025_01_01_000076_create_invoice_line_cost_center_allocations.php`, `database/migrations/2025_01_01_000047_add_cost_center_to_purchases.php`, `tests/Feature/CostCenterTest.php`, `CostCenterReportTest.php`, `InvoiceCostCenterAllocationTest.php`.

**Backend — settings/RBAC/catalog:** `app/Support/Settings.php`, `app/Support/BranchSettings.php`, `app/Support/Rbac.php`, `app/Support/ApplicationCatalog.php`, `app/Services/TenantApplicationService.php`, `app/Http/Middleware/EnsureApplicationActive.php`, `app/Http/Middleware/EnsurePermission.php`, `app/Http/Controllers/Api/FinanceSettingsController.php`, `app/Models/SettlementType.php`, `app/Models/ExpenseCategory.php`, `app/Tenancy/CompanyWide.php`, `app/Tenancy/BranchScoped.php`, `app/Tenancy/BelongsToBranch.php`, `database/migrations/2025_01_01_000017_add_settings_to_tenants.php`.

**Frontend:** `web/src/components/layout/sidebar.tsx`, `web/src/components/layout/nav-visibility.ts`, `web/src/app/(app)/finance-settings/page.tsx`, `web/src/app/(app)/settings/page.tsx`, `web/src/app/(app)/cost-centers/page.tsx`, `web/src/app/(app)/journal-entries/`, `web/src/app/(app)/manual-journals/`, `web/src/app/(app)/accounts/page.tsx`, `web/src/lib/api.ts`, `web/src/lib/money.ts`, `DESIGN_SYSTEM.md`.

**Tests referenced:** `tests/Feature/LedgerTest.php`, `ManualJournalTest.php`, `CostCenterTest.php`, `CostCenterReportTest.php`, `InvoiceCostCenterAllocationTest.php`, `AccountManagementTest.php`, `AccountSettingsTest.php`, `BranchIsolationGuardTest.php`, `ChartOfAccountsDemoTest.php`, `CashBankAccountTest.php`, `InventoryOpeningPostingTest.php`, `InventoryOpeningImportTest.php`, `JournalEntryListApiTest.php`.

---

*Audit conducted read-only. No migrations, models, services, controllers, routes, or UI were created or modified. No `php artisan test` run was required for this audit since no code changed; the PR plan in §6 requires a full green `php artisan test` run before each individual PR, per repository policy.*
