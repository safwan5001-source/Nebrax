# ACC-1 — Accounting Settings Foundation — Implementation Report

**Status:** DONE
**Task doc:** `docs/plans/accounting/ACC-1-accounting-settings-foundation.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`

## Summary

Implemented ACC-1 exactly as specified: a workspace + RBAC + navigation + i18n
foundation for Accounting Settings, with zero accounting posting behavior,
schema, Ledger, or Account Routing changes.

Delivered:
1. Two new RBAC permissions: `accounting_settings.view`, `accounting_settings.manage`.
2. A real authenticated workspace at `/accounting-settings`.
3. One sidebar leaf under the existing `accounting` group, permission-gated.
4. Direct-route permission protection beyond sidebar hiding (Forbidden state).
5. Arabic + English i18n for all new user-facing strings.
6. No backend controller/endpoint added — the page is static/read-only and
   required no data fetch, so adding one would have been speculative per the
   task doc's explicit instruction.

## Baseline check

Task doc's planning baseline: `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`.
Commits between that baseline and current `main` (`8666380...`) were checked:
only two non-docs commits landed (`PR-INV-2`, `PR-INV-3`, both inventory/UOM
hardening, unrelated to RBAC/sidebar/settings). No material divergence
affecting the ACC-1 contract — proceeded without stopping.

## Changed files

| File | Why |
|---|---|
| `app/Support/Rbac.php` | Added `accounting_settings.view`/`.manage` to `Rbac::PERMISSIONS` (assignable-permission catalog). Not added to `accountant`/`staff` matrices. |
| `tests/Feature/AccountingSettingsRbacTest.php` (new) | Verifies catalog membership + owner/admin wildcard access + accountant/staff default denial. |
| `web/src/app/(app)/accounting-settings/page.tsx` (new) | The hub workspace: Cost Centers real link, others "planned" with soon badge, Forbidden gate for users without `accounting_settings.view`. |
| `web/src/components/layout/sidebar.tsx` | Added one leaf to the existing `accounting` group: `{ href: '/accounting-settings', icon: SlidersHorizontal, key: 'accountingSettings', built: true, permission: 'accounting_settings.view' }`. No existing leaves moved. |
| `web/src/components/layout/__tests__/accounting-settings-nav.test.ts` (new) | Sidebar visibility test, mirrors the existing `developer-nav.test.ts` pattern for `isNavEntryVisible`. |
| `web/src/messages/ar.json` / `en.json` | New `nav.accountingSettings` label + new `accountingSettings` namespace (title, hubSubtitle, groupSetup, 4 destination title/description pairs, forbidden/forbiddenHint). |

## Design decisions worth flagging

- **No backend endpoint added.** The task doc says: "Only add a backend
  endpoint/controller if the existing application architecture genuinely
  requires one... Do not create speculative APIs." The hub page is fully
  static (labels + one real link to the already-independently-protected
  `/cost-centers`); it carries no sensitive or dynamic data. Adding a route
  purely to gate an inert page would have been speculative.
- **Direct-access protection pattern.** Mirrored the existing `DeveloperGate`
  precedent (`web/src/components/developer/developer-shell.tsx`): a
  client-side check against session-issued permissions (`hasPermission` /
  `Rbac::allows` mirror) shows a Forbidden `EmptyState` on direct navigation
  without `accounting_settings.view`, instead of relying on sidebar hiding
  alone. This is "the repository's actual RBAC pattern" for a hub-style page
  with no sensitive server data of its own — true enforcement for the one
  real destination (Cost Centers) already lives on its own protected API.
- **"General Accounting Settings" omitted**, not shown as a fake placeholder
  tile — no real backend-enforced setting exists yet, per the task doc's
  explicit instruction to omit rather than fake it.

## Tests run and results

**New tests:**
- `php artisan test --filter=AccountingSettingsRbacTest` → 3 passed (10 assertions).
- `npx vitest run .../accounting-settings-nav.test.ts` → 4 passed.

**Targeted regression (RBAC + Ledger sanity):**
- `php artisan test --filter="RoleTest|ApiRbacTest|DocumentCenterFoundationTest|AccountingSettingsRbacTest"` → 29 passed (565 assertions).
- `php artisan test --filter=LedgerTest` → 5 passed (10 assertions) — confirms Ledger untouched.

**Full backend suite:**
- `php artisan test` → **2453 passed**, 1 skipped, **25 failed**.
- All 25 failures are in `Fuel*Test` files, root cause `Call to undefined
  function App\Services\bcmul()` — the `bcmath` PHP extension is not
  installed in this session's environment. Unrelated to any file this PR
  touches.
- 1 additional pre-existing failure in `DocumentCenterSecureIntakeTest`
  (`a valid pdf is cou…`) — an environment-specific PDF-parsing quirk
  (`ملف PDF تالف أو غير مدعوم` on a fake-generated PDF fixture).
- **Verified both failure classes are pre-existing**: reproduced identically
  on `origin/main` with this branch's changes reverted (`git stash` +
  filtered re-run), before restoring the ACC-1 diff.

**Full frontend suite:**
- `npx vitest run` → 233 test files, **1489 tests, all passed**.
- `npx tsc --noEmit` → 3 pre-existing errors, all in test files this PR does
  not touch (`pos/settings/configuration/page.test.tsx`,
  `platform/integrations/gemini-card.test.tsx`,
  `platform/global-application-controls-card.test.tsx`). Nothing in any
  changed file.
- `npm run build` → succeeds; `/accounting-settings` route compiles
  (3.42 kB, 186 kB First Load JS), no build errors.

## Confirmation: no DB / posting-service changes

No migration created. No changes to `LedgerService`, `InvoiceService`,
`PurchaseService`, `PaymentService`, `ReturnService`, `InventoryService`,
`StocktakeService`, `StockPermitService`, or any other posting service.
`account_role_mappings` and any Account Role resolver/catalog are untouched
(reserved for ACC-2, not started). No historical journal data touched.

## RBAC behavior (owner/admin/accountant/staff)

| Role | `accounting_settings.view` | `accounting_settings.manage` |
|---|---|---|
| owner | ✅ (via `*`) | ✅ (via `*`) |
| admin | ✅ (via `*`) | ✅ (via `*`) |
| accountant | ❌ not granted by default | ❌ not granted by default |
| staff | ❌ not granted by default | ❌ not granted by default |

A tenant may still grant either permission to a custom role explicitly
(existing per-tenant `roles` table mechanism, unchanged by this PR) — this
is intended, matching how every other guarded permission in the catalog
(`developer.view`, `apps.view`, etc.) already behaves.

## Risks, blockers, remaining work

- **Risk:** low. Pure navigation/RBAC/i18n addition; no accounting behavior
  changed.
- **Known limitation (by design, not a defect):** the workspace's own
  direct-access gate is client-side only, since it has no server data to
  authorize a request against. This matches the existing `DeveloperGate`
  precedent and is safe because the only real functionality it links to
  (Cost Centers) is independently protected server-side.
- **Environment gaps unrelated to this PR** (documented, not fixed per task
  scope): `bcmath` PHP extension missing (25 Fuel* test failures); one
  PDF-parsing environment quirk in `DocumentCenterSecureIntakeTest`.
- **Remaining work:** ACC-2 (Semantic Account Routing Foundation) is next in
  the execution sequence per `AWJ_ACCOUNTING_SETTINGS_PLAN.md`, but was
  **not started** — out of scope for this task.

## Branch / PR / SHAs

- Branch: `claude/acc-1-accounting-settings-qr6y32`
- PR: https://github.com/safwan5001-source/Nebrax/pull/676
- Base SHA (`origin/main` at start of this task): `866638013d25f0374ee8bc03bc774619c5d75bcd`
- Head SHA: `26f6e8723ca6cbd3bfbefee377199eac64a366ff`

**No merge, no deploy performed.**

## Recommended next step

Review PR #676 in isolation. Once approved (and merged by Safwan, not by
this agent), begin ACC-2 — Semantic Account Routing Foundation per the
parent plan's execution sequence and its own prepared task document
(`ACC-2-semantic-account-routing-foundation.md`).
