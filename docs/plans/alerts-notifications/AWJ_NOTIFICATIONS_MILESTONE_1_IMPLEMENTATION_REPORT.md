# AWJ Alerts & Notifications — Milestone 1 Implementation Report

**Date:** 2026-09-06
**Scope:** PR-NOTIF-1 → PR-NOTIF-2 → PR-NOTIF-3 only, per
`docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md`
(reference commit `de6dd1ded14645b30a09842bff091ecfba3571df` on
`docs/alerts-notifications-master-plan`).
**Implementation branch:** `claude/awj-notifications-milestone-1-3vxzvi`, built from
`origin/main` at `6a49a956f19e91911662467d9cdf197ce0a295af`.
**Status:** All three checkpoints complete, committed, pushed. **No PR opened, nothing
merged, nothing deployed** — per standing instruction, pull requests are only created on
explicit request, and the master plan itself requires Safwan's explicit approval before
any merge/deploy.

---

## 1. Executive summary

Milestone 1 delivers the first end-to-end slice of the AWJ Notification Center:

1. **PR-NOTIF-1** — a dedicated, tenant/recipient-isolated notification delivery table
   and service, with a minimal list/unread-count/mark-read API. No producer, no UI.
2. **PR-NOTIF-2** — a topbar Bell and a full `/notifications` workspace consuming that
   API, with tabs, unread badge, mark actions, and safe source navigation.
3. **PR-NOTIF-3** — the first real producer: Low Stock / Out of Stock detection reusing
   `products.reorder_level`/`quantity_on_hand` exactly as specified, wired into the three
   places that actually change stock quantity, plus two new tenant settings.

Every checkpoint was implemented, tested (SQLite + PostgreSQL locally, matching CI's
`nibras`/`nibras` database convention), and committed separately before moving to the
next. No stop condition in the master plan's §6 was triggered. One test in PR-NOTIF-1
had to be corrected during PR-NOTIF-3 (see §20) because PR-NOTIF-3 legitimately filled in
a placeholder the test depended on being empty — this is documented, not hidden.

**No accounting, ZATCA, or POS behavior was touched.** No new financial entries exist in
this milestone, so there is no journal table to review — the pre-PR protocol in
`CLAUDE.md` ("اكتب القيد المحاسبي الناتج لكل عملية مالية جديدة") does not apply because no
new financial operation was added; this is stated explicitly rather than fabricated.

---

## 2. What was implemented (by checkpoint)

### PR-NOTIF-1 — Notification Foundation
- `notifications` table (additive), `App\Models\Notification` (classified `CompanyWide`),
  `App\Services\NotificationService::deliver()` as the sole write path, `App\Support\NotificationActions`
  as the server-side action allowlist, and `App\Http\Controllers\Api\NotificationController`
  exposing list / unread-count / mark-one-read / mark-all-read.

### PR-NOTIF-2 — Notification Center UI
- `NotificationBell` component (topbar), a compact panel (tabs, states, mark actions),
  a full `/notifications` workspace page, a typed API client (`web/src/lib/notifications.ts`),
  a minimal additive `onOpenChange` prop on the shared `Dropdown` primitive, demo-mode
  mock handlers/seed data, and bilingual (ar/en) message strings.

### PR-NOTIF-3 — Inventory Alerts + Settings
- `inventory_stock_alerts` table + `App\Models\InventoryStockAlert` (one row per product,
  active/resolved + cycle), `App\Services\Accounting\InventoryAlertService` as the single
  lifecycle/dedup/recipient-resolution engine, three call sites wired in
  `InventoryService` (`applyReceipt`, `applyIssue`, `recordSaleCogs`) via `DB::afterCommit`,
  a reconciliation command `inventory:scan-alerts` (hourly), two new tenant settings, the
  first real `NotificationActions` entry (`view_product`), and the matching frontend
  action mapping + settings toggle UI.

---

## 3. Changed files

### PR-NOTIF-1
| File | Type |
|---|---|
| `database/migrations/2026_09_06_020000_create_notifications_table.php` | new |
| `app/Models/Notification.php` | new |
| `app/Support/NotificationActions.php` | new |
| `app/Services/NotificationService.php` | new |
| `app/Http/Resources/NotificationResource.php` | new |
| `app/Http/Controllers/Api/NotificationController.php` | new |
| `routes/api.php` | modified (4 new routes) |
| `tests/Feature/NotificationApiTest.php` | new (14 tests originally, now 15 — see §20) |

### PR-NOTIF-2
| File | Type |
|---|---|
| `web/src/lib/notifications.ts` | new |
| `web/src/components/layout/notification-bell.tsx` | new |
| `web/src/components/layout/notification-bell.test.tsx` | new (later extended in PR-NOTIF-3) |
| `web/src/components/layout/topbar.tsx` | modified (1 line: `<NotificationBell />`) |
| `web/src/components/ui/dropdown.tsx` | modified (added optional `onOpenChange` prop) |
| `web/src/app/(app)/notifications/page.tsx` | new |
| `web/src/lib/mock-data.ts` | modified (demo handlers + seed data) |
| `web/src/messages/ar.json`, `en.json` | modified (new `notifications` namespace) |

### PR-NOTIF-3
| File | Type |
|---|---|
| `database/migrations/2026_09_06_030000_create_inventory_stock_alerts_table.php` | new |
| `app/Models/InventoryStockAlert.php` | new |
| `app/Services/Accounting/InventoryAlertService.php` | new |
| `app/Services/Accounting/InventoryService.php` | modified (3 one-line hooks) |
| `app/Console/Commands/ScanInventoryAlertsCommand.php` | new |
| `routes/console.php` | modified (1 new scheduled entry) |
| `app/Support/Settings.php` | modified (2 new keys in `inventory` group) |
| `app/Http/Requests/UpdateInventorySettingsRequest.php` | modified (2 new validated keys) |
| `app/Support/NotificationActions.php` | modified (first real entry: `view_product`) |
| `tests/Feature/InventoryAlertServiceTest.php` | new (16 tests) |
| `tests/Feature/InventoryAlertTriggerTest.php` | new (3 tests) |
| `tests/Feature/NotificationApiTest.php` | modified (see §20) |
| `web/src/lib/notifications.ts` | modified (registered `view_product`) |
| `web/src/app/(app)/inventory-settings/products/page.tsx` | modified (2 new toggles) |
| `web/src/components/layout/notification-bell.test.tsx` | modified (updated + 1 new test) |
| `web/src/messages/ar.json`, `en.json` | modified (5 new keys each) |

No file outside these lists was touched. No accounting, ZATCA, POS, or unrelated module
file was modified anywhere in this milestone.

---

## 4. Migrations / schema

### `notifications` (PR-NOTIF-1)
```
id (uuid, pk), tenant_id (fk tenants, cascade), recipient_id (fk users, cascade),
category (string, 'alert'|'update'), type (string, dot-namespaced), severity (string,
'info'|'warning'|'critical'), title (string), message (text),
source_type (string, nullable), source_id (uuid, nullable), action (string, nullable),
data (json, nullable), dedupe_key (string), read_at (timestamp, nullable), timestamps.

unique(tenant_id, recipient_id, dedupe_key)
index(tenant_id, recipient_id, read_at, created_at)
index(tenant_id, recipient_id, category, created_at)
```
Purely additive. No existing table touched. No `financial_control_alerts` change.

### `inventory_stock_alerts` (PR-NOTIF-3)
```
id (uuid, pk), tenant_id (fk tenants, cascade), branch_id (fk branches, nullable, null-on-delete),
product_id (fk products, cascade), status (string, 'active'|'resolved'),
type (string, 'low_stock'|'out_of_stock' — last known), cycle (unsigned int, default 1),
quantity_on_hand (int, snapshot only), reorder_level (int, snapshot only),
first_detected_at, last_detected_at, resolved_at (nullable), timestamps.

unique(tenant_id, product_id)   -- one row per product
index(tenant_id, status)
```
Purely additive. Does not touch `products`, `stock_movements`, `journal_entries`, or any
accounting table. Both migrations verified on SQLite and PostgreSQL (`migrate:fresh`
clean on both, matching CI's `nibras`/`nibras`/`secret` PostgreSQL convention).

---

## 5. API contracts

All under `auth:sanctum + SetTenant + SetBranch`, in the "always available" route group
(no `EnsureActiveSubscription`, no RBAC permission — this is self-owned inbox data, and
the Bell must work even with an expired subscription):

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/notifications` | Paginated list for the authenticated user. Filters: `category` (alert\|update), `read` (read\|unread), `per_page`. |
| GET | `/api/notifications/unread-count` | `{ data: { count: N } }` for the authenticated user. |
| POST | `/api/notifications/{id}/read` | Marks one owned notification read (404 if not owned — same convention as the rest of the codebase). |
| POST | `/api/notifications/mark-all-read` | Marks all of the authenticated user's unread notifications read; returns `{ data: { updated: N } }`. |

No create/update/delete endpoint is exposed to normal clients. Only
`NotificationService::deliver()` (server-side, no route) creates rows.

No PR-NOTIF-3 endpoint was added for `InventoryStockAlert` — it has no client-facing API;
it is purely internal producer state, consumed only through the notifications API above.
The existing `GET/PUT /api/inventory-settings` endpoints gained two new keys (no route
change).

---

## 6. Notification lifecycle (PR-NOTIF-1/2)

`unread → read` only, one-directional (no "unread" action, matching the plan). Reading a
notification never touches its source. Idempotency: `NotificationService::deliver()` checks
`(tenant_id, recipient_id, dedupe_key)` inside a transaction, and additionally catches a
unique-constraint violation and re-queries — safe under a genuine two-writer race, not
just a sequential re-check.

---

## 7. Inventory Alert lifecycle (PR-NOTIF-3)

One `InventoryStockAlert` row per product. `status`: `active` | `resolved`. `cycle`
increments only when transitioning from `resolved`/absent → `active`.

| Transition | Alert effect | Notification effect |
|---|---|---|
| Normal → Low | create/reactivate, `cycle += 1` | 1 new notification (dedupe key includes the new cycle) |
| Low → unchanged Low | update snapshot fields only | none (same dedupe key) |
| Low → Out | same row, same `cycle`, `type` changes | 1 new notification (dedupe key changes because `type` changed) |
| Out → unchanged Out | update snapshot fields only | none |
| Low/Out → Normal | `status = resolved`, `resolved_at = now()` | **none** (plan does not require a recovery notification; historical notifications keep their read state untouched) |
| Recovered → drops again | new `cycle` | 1 new notification (new cycle → new dedupe key) |

Exact fingerprint/idempotency identity: **`"inventory.{type}:{alert_id}:{cycle}"`**,
passed as `dedupe_key` to `NotificationService::deliver()`. This is documented in code
(`InventoryAlertService` class docblock) as the single source of truth for this identity.

---

## 8. Deduplication / idempotency implementation

- **Notification foundation:** pre-check by `(tenant_id, recipient_id, dedupe_key)`
  inside `DB::transaction`, with a `QueryException` (unique-violation) catch that
  re-queries and returns the existing row instead of raising — safe under retry and
  under genuine concurrent delivery.
- **Inventory alerts:** `InventoryAlertService::evaluateProduct()` locks the product row
  and the alert row (`lockForUpdate`) inside its own transaction before deciding whether
  this is a new cycle; the resulting dedupe key (type + alert id + cycle) is then handed
  to the same `NotificationService::deliver()` idempotency path. Verified directly by
  `InventoryAlertServiceTest::concurrent_or_retried_evaluation_is_idempotent` and
  `unchanged_condition_does_not_duplicate_alert_or_notification`.
- **Trigger safety:** `queueEvaluation()` defers the actual evaluation to
  `DB::afterCommit()`, so a transaction that rolls back never creates an alert or a
  notification — verified end-to-end by
  `InventoryAlertTriggerTest::a_rolled_back_transaction_never_delivers_a_notification`.

---

## 9. Recipient resolution

- **Foundation (PR-NOTIF-1):** recipient is always an explicit, server-supplied
  `recipient_id`, verified to belong to the given `tenant_id` before any row is written.
  No client ever supplies a recipient list.
- **Inventory (PR-NOTIF-3):** `InventoryAlertService::resolveRecipients()` — active tenant
  users with `products.manage` (conservative: the audience that can act on a reorder, not
  everyone who can merely view products), further filtered by branch visibility: a
  product tagged with a specific `branch_id` only reaches users who can access that
  branch; a product with `branch_id = null` (shared/company-wide) reaches everyone,
  matching the existing `branch_id IS NULL` convention used throughout
  `ApiController::scopeToActiveBranch`/`whereBranchIn`. This mirrors — but does not
  reuse verbatim, because `User::canAccessBranch(null)` returns `false` for a restricted
  user, which would have been the *opposite* of the intended "shared record visible to
  all" semantics — so the null-check is applied explicitly at the call site.

---

## 10. Tenant Isolation / RBAC / security

- `Notification` and `InventoryStockAlert` both extend `BaseModel` (tenant-scoped by
  the existing `TenantScope` global scope) and are additionally filtered explicitly by
  `recipient_id` (notifications) or queried with an explicit `tenant_id` (alerts) —
  never relying on ambient scope alone for a security boundary, consistent with the
  rest of the codebase's "a record ID alone is never sufficient authorization" rule.
- `Notification` and `InventoryStockAlert` are both explicitly classified for the branch
  isolation guard (`CompanyWide` and `BelongsToBranch` respectively); `BranchIsolationGuardTest`
  passes with both new models present.
- Every mutating endpoint re-derives ownership server-side; a 404 (not 403) is returned
  for a correctly-formatted but unauthorized ID, matching the existing convention.
- `NotificationActions::ALLOWED` is the single, server-owned allowlist for what a
  notification's `action` may be; an unregistered action, or one whose declared
  `source_type` doesn't match, is rejected at `deliver()` time — this is exercised by
  dedicated tests in both PR-NOTIF-1 (generic contract) and implicitly re-verified in
  PR-NOTIF-3 (the one real producer uses exactly this contract).
- `NotificationService::deliver()`'s metadata (`data`) validator blocks any key
  containing `cost`, `price`, `token`, `secret`, `password`, `credential`, `key`, `url`,
  `link`, `href` (case-insensitive substring), rejects non-scalar values, and rejects any
  string value that looks like a URL — enforced in code, not just by producer discipline.
  `InventoryAlertServiceTest::notification_payload_never_leaks_cost_or_purchase_price`
  additionally proves the actual inventory producer's payload contains only
  `quantity_on_hand`/`reorder_level`.

---

## 11. Settings added/changed

All within the **existing** `inventory` settings group (`App\Support\Settings::DEFAULTS`,
read/written via `GET/PUT /api/inventory-settings`) — no new settings table, no new group
created for this:

| Key | Default | Meaning |
|---|---|---|
| `low_stock_notifications_enabled` | `false` | Enables the Low Stock notification producer for the tenant. |
| `out_of_stock_notifications_enabled` | `false` | Enables the Out of Stock notification producer for the tenant. |

Both default to `false` for every tenant (new and existing alike), mirroring the exact
precedent set by `finance.financial_alerts_enabled` — a new automatic detection/notification
capability is never silently turned on. A disabled type is treated identically to "condition
absent" for lifecycle purposes: if a setting is turned off while an alert is active, the
next evaluation silently resolves it (no notification) rather than leaving a stale active row.

No recipient-role setting was added (the master plan makes this explicitly optional,
"only if it can be expressed safely"); recipients are currently a fixed, conservative
`products.manage` policy. This is a deliberate minimal-scope choice — see §18.

---

## 12. UI surfaces (PR-NOTIF-2, extended by PR-NOTIF-3)

- **Topbar Bell** — unread badge (`1..99+`, no badge at 0), aria-label announces the
  unread count, opens a `Dropdown`-based panel.
- **Panel** — tabs الكل/تنبيهات/تحديثات, loading (skeleton)/empty/error+retry/data states,
  mark-one (click row) / mark-all (footer, disabled at zero unread), safe source link
  (only rendered when the notification's `action` is a registered one — verified for both
  the unregistered and the real `view_product` case), "view all" link to `/notifications`.
  Data loads lazily on open via a new, minimal, backward-compatible `onOpenChange` prop
  on the shared `Dropdown` component; unread count polls every 60s and refreshes on open
  and after mark actions.
- **`/notifications` workspace** — full history with server-side pagination (backend
  `meta`), category tabs, read-state filter pills, severity/status badges, mark actions,
  safe source link, dense `DataTable` presentation with a responsive mobile record view.
- **`/inventory-settings/products`** — two new toggles (Low Stock / Out of Stock
  notifications) added to the existing settings screen, same `Switch` component and card
  layout as the four existing toggles on that page.

RTL/LTR, Arabic/English, and light/dark all reuse existing primitives/tokens with zero
new hardcoded values; verified in tests against the real `ar.json`/`en.json` message
files (not mocked translations) for both locales, and manually in a browser via
Playwright against the demo build (screenshots captured locally, not committed).

---

## 13. Tests executed and exact results

### Backend — focused, per checkpoint
| Suite | Tests | Result |
|---|---|---|
| `NotificationApiTest` (PR-NOTIF-1, later adjusted in PR-NOTIF-3) | 15 | ✅ all pass |
| `BranchIsolationGuardTest` | 4 | ✅ all pass (both new models classified) |
| `InventoryAlertServiceTest` (PR-NOTIF-3) | 16 | ✅ all pass |
| `InventoryAlertTriggerTest` (PR-NOTIF-3) | 3 | ✅ all pass |
| `InventoryTest`, `ApiInventoryTest`, `InvoiceInventoryApiTest`, `InventoryOpeningPostingTest`, `InventoryReportTest`, `InventoryBalanceExportTest`, `DiagnoseInventoryTest` (regression around the touched `InventoryService`) | 63 | ✅ all pass |

### Backend — full suite (`php artisan test`, no filter)
- **SQLite:** 2472 passed, 25 failed, 1 skipped (17788 assertions).
- **PostgreSQL** (local `nibras`/`nibras`/`secret`, matching `ci.yml`'s service exactly): 2473 passed, 25 failed (17790 assertions).
- **The 25 failures are pre-existing and unrelated to this milestone** on both engines —
  confirmed by inspection, not assumption:
  - 24 are `Fuel*Test` failures, all `Error: Call to undefined function App\Services\bcmul()`
    inside `FuelCostBasisService` — this sandbox has no `bcmath` PHP extension loaded
    (`php -m | grep bcmath` returns nothing), while `ci.yml` explicitly installs
    `bcmath` in its extension list (line ~80). This is a sandbox gap, not a code defect.
  - 1 is `DocumentCenterSecureIntakeTest > a valid pdf is cou…`, which needs
    `pdftoppm`/`pdfinfo` (`poppler-utils`); `ci.yml` explicitly installs `poppler-utils`
    (line ~86), also absent from this sandbox.
  - No Notification-, InventoryAlert-, InventoryService-, or branch-isolation-related
    test is in either failure list, on either engine.

### Frontend
- `npm test` (Vitest): **233 test files / 1498 tests passed**, 0 failed, before and after
  every checkpoint's frontend changes (1497 after PR-NOTIF-2, 1498 after PR-NOTIF-3's one
  added test).
- `npm run build` (Next.js 15, includes full type-check + lint): **compiles successfully**
  after every checkpoint; `/notifications` route present in the build output.
- Manual verification: `next dev` + Playwright (Chromium) against the demo build —
  confirmed the Bell renders with the correct badge, the panel lists seeded demo
  notifications with correct severities/timestamps/tabs, and `/notifications` renders the
  same data with working tabs/filters/pagination.

---

## 14. SQLite / PostgreSQL results

Covered in §13. Both engines: `migrate:fresh` clean, full suite green apart from the 25
pre-existing/environment-only failures documented above, present identically on both
engines (confirming they are unrelated to database engine or to this milestone).

---

## 15. Frontend build

`npm run build` succeeds after PR-NOTIF-2 and again after PR-NOTIF-3 (final state). One
real TypeScript issue was found and fixed during PR-NOTIF-2 (a control-flow narrowing
quirk in the pre-existing, very large `mockApi()` function caused `"GET"`/`"POST"` literal
comparison errors for the newly added demo routes); fixed by introducing a locally-scoped
`notificationMethod: string` variable rather than reusing the ambient narrowed `m`
variable — a 3-line, self-contained fix with no behavior change to any existing route in
that function.

---

## 16. CI status

Not run on GitHub Actions in this session (no CI trigger was requested and nothing was
pushed as a PR to run it against). Locally reproduced both CI jobs faithfully:
- `ci.yml`'s PHP matrix (`sqlite`, `pgsql`) — reproduced exactly, including the
  `nibras`/`nibras`/`secret` PostgreSQL service convention.
- `web-ci.yml` (`npm run test` then `npm run build`) — reproduced exactly.

Both are green apart from the pre-existing, environment-only gaps documented in §13,
which `ci.yml`'s own extension/tooling installation steps confirm are not present in a
real CI run.

---

## 17. Accounting / stock / ZATCA non-regression confirmation

- **No new journal entries.** Grep-level and test-level confirmation: nothing in this
  milestone calls `LedgerService::post()` or writes to `journal_entries`/`journal_lines`.
  `InventoryAlertServiceTest::evaluation_never_modifies_stock_quantity_valuation_or_accounting_entries`
  asserts `JournalEntry::count()` is unchanged across both a direct evaluation and a full
  tenant scan.
- **No stock/valuation mutation.** The same test asserts `quantity_on_hand` and
  `avg_cost` are byte-for-byte unchanged after evaluation. `InventoryAlertService` only
  ever reads `Product`; it never calls `->update()` on it.
- **Existing inventory behavior unchanged.** The full pre-existing inventory/invoice
  regression suite (63 tests across 7 files, §13) passes unmodified — the only change to
  `InventoryService` is one line appended after each of the three existing
  `$product->update([...])` calls, calling `app(InventoryAlertService::class)->queueEvaluation($product->id)`;
  nothing about the existing quantity/cost/ledger logic in those three methods changed.
- **ZATCA/POS untouched.** No file under any ZATCA or POS path was modified in this
  milestone; the full ZATCA test suite runs as part of the full-suite results in §13 with
  no new failures.
- **Existing product-list Low/Out semantics unchanged.** `ProductListFilters` was not
  modified. `InventoryAlertServiceTest::service_condition_matches_product_list_filters_stock_state`
  cross-checks the producer's boolean condition against `ProductListFilters::apply()`'s
  SQL `stock_state` filter for five boundary cases, proving they agree without merging
  the two code paths (a query-builder filter and a loaded-model boolean check are
  different shapes; the test is the safety net that keeps them in sync).

---

## 18. Risks and remaining issues

1. **`NotificationActions::ALLOWED` and `notificationHref()`'s `ACTION_PATHS` are two
   parallel registries (backend PHP const, frontend TS object)** that must be kept in
   sync by hand for every future action. This is a deliberate, minimal design (no shared
   codegen), consistent with "avoid unnecessary abstraction," but it is a manual
   discipline point for PR-NOTIF-4 onward.
2. **True concurrent-writer idempotency is exercised by code review and the DB unique
   constraint, not by a genuine multi-thread test** — PHPUnit in this project's setup is
   single-process/single-connection per test, so the `QueryException`-catch branch in
   `NotificationService::deliver()` is proven by inspection and by the DB constraint
   itself, not by observing two real concurrent writers collide. This is the same
   limitation the master plan anticipated ("to the extent supported by project test
   patterns").
3. **No recipient-role setting.** Recipients are a fixed `products.manage` policy today.
   If a tenant wants a narrower or different audience (e.g. warehouse staff without full
   product management rights), that requires a follow-up decision — explicitly deferred
   per the master plan ("only if it can be expressed safely... do not build the full
   PR-NOTIF-7 preferences system here").
4. **Demo-mode `ACTION_PATHS` seed data doesn't exercise `view_product`.** The three demo
   notifications seeded in `mock-data.ts` all have `action: null`; the new `view_product`
   entry is verified by unit tests and by the live PR-NOTIF-3 backend integration tests,
   but not by an additional demo-mode click-through. Low risk, easy follow-up.
5. **Fuel-station inventory is out of scope.** Per the master-plan-cited research, Fuel
   operations track liters through a separate set of services and never touch
   `products.quantity_on_hand` the same way; this milestone's inventory alerts do not
   apply to fuel and were never intended to (no fuel setting was touched).

No stop condition from the master plan's §6 was triggered at any point.

---

## 19. Branch / PR / Base SHA / Head SHA

| Checkpoint | Branch | Base SHA | Head SHA | PR |
|---|---|---|---|---|
| PR-NOTIF-1 | `claude/awj-notifications-milestone-1-3vxzvi` | `6a49a956f19e91911662467d9cdf197ce0a295af` (origin/main) | `17ddc9fb2665701b7b1cd0ac84c28d090adc4436` | not opened (not requested) |
| PR-NOTIF-2 | `claude/awj-notifications-milestone-1-3vxzvi` | `17ddc9fb2665701b7b1cd0ac84c28d090adc4436` | `ad7212d74456243de8e4c6bdbba05bbb6cd701fa` | not opened (not requested) |
| PR-NOTIF-3 | `claude/awj-notifications-milestone-1-3vxzvi` | `ad7212d74456243de8e4c6bdbba05bbb6cd701fa` | `433d0b959d4bb77e61b7703fc03a6cd8acec381c` | not opened (not requested) |

All three commits are on the single milestone branch, pushed to `origin`, in strict
sequential order, each independently reviewable (`git show <head sha>` per checkpoint)
and each attributable to exactly one checkpoint's scope. Nothing has been merged into
`main`.

---

## 20. Deviations from the Master Plan

1. **One PR-NOTIF-1 test had to be corrected during PR-NOTIF-3, not a new deviation in
   architecture.** `NotificationApiTest::unregistered_action_is_rejected` originally used
   `'view_product'` as its example of an *unregistered* action, which was correct at the
   time (§5.1 explicitly required `NotificationActions::ALLOWED` to start empty). When
   PR-NOTIF-3 legitimately added `view_product` as the first real entry, that test's
   premise became false and the full-suite run caught it immediately (a real, non-flaky
   failure — not a pre-existing one). Fixed by renaming the test's fixture action to
   `not_a_real_action` and adding a new test
   (`a_registered_action_still_requires_its_exact_matching_source_type`) that proves
   registration alone is insufficient — the `source_type` must still match. This is
   exactly the kind of interaction the master plan's checkpoint structure anticipates
   ("if PR-NOTIF-2 exposes a material flaw... stop and report" — this was not a flaw,
   just an example value that stopped being a valid negative case; it is reported here
   for transparency rather than silently amended).
2. **`Dropdown` gained one new optional prop (`onOpenChange`).** The master plan says "do
   not redesign the Topbar" — this is not a Topbar change; it's a one-line, fully
   backward-compatible addition to a shared, already-reused primitive (every existing
   caller is unaffected, verified by the full frontend suite). This was necessary because
   there was no existing way to know when a `Dropdown`-based panel opened in order to
   lazy-load its content, and inventing a parallel bespoke panel component instead of
   reusing `Dropdown` would have been a larger, less consistent change.
3. **No settings UI beyond the existing `/inventory-settings/products` screen.** The
   master plan doesn't require a new screen; the two new toggles were added to the
   existing, already-correct location for inventory policy settings.
4. **No dedicated `/inventory-alerts` browsing screen.** The master plan's §5.3 requires
   the producer + settings + notification wiring; it does not require a standalone alert
   list UI, and none was built — the Notification Center (PR-NOTIF-2) is the only
   user-facing surface for these alerts, consistent with "the smallest backward-compatible
   domain state mechanism needed to prove lifecycle and deduplication."

No other deviation. No accounting, ZATCA, POS, or per-warehouse threshold change was made
or considered necessary.

---

## 21. Recommended next step

Milestone 1 (PR-NOTIF-1 → PR-NOTIF-2 → PR-NOTIF-3) is complete and internally consistent.
Recommended before any merge:

1. **Owner review** of this report and a diff review of the three commits on
   `claude/awj-notifications-milestone-1-3vxzvi` (`git log 6a49a956f..433d0b9 --oneline`).
2. **A real CI run** (push as a PR, or re-run `ci.yml`/`web-ci.yml` in an environment with
   `bcmath`/`poppler-utils` installed) to get a fully clean signal with zero failures,
   since this sandbox's 25 pre-existing failures are environment gaps that CI itself does
   not have.
3. Once approved, **do not start PR-NOTIF-4** (Financial + ZATCA integration) without a
   new, separate explicit approval, per the master plan's §7 and this task's boundary.

This report and the three commits are the complete Milestone 1 deliverable.
