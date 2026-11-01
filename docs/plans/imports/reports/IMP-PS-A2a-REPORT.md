# IMP-PS-A2a — Application key `accounting.partner_statements` (explicit-enable-only) and gates

**Scope (owner, 2026-11-01):** PS-A2a only, per `AWJ_IMP_PS_A2_EXECUTION_PLAN.md` §6/§7. **Not built:** matching engine (A2c), statement-source/report changes (A2b), close/void (A3), Track B. **No journal entries, no financial or ZATCA change, no migration, no new permission, no deploy, no Railway/environment change.** Base: `main@384ee6b1c588f9cea151e9bcf7f2b3af52e0720c`.

## What changed
| Area | Change |
|---|---|
| `ApplicationCatalog` | New key **`accounting.partner_statements`**: group `accounting`, `built`, not mandatory, depends on `accounting.ledger`, operational gate, `explicit_enable_only = true`. New optional catalogue attribute `explicit_enable_only` (default `false`, normalised in `all()`/`find()`), reader `isExplicitEnableOnly($key)`, and a contract check (the attribute needs a built, non-mandatory capability). It is the **only** key that sets it. |
| `TenantApplicationService` | `statusFor()` and `navVisibility()`: no stored decision + `explicit_enable_only` ⇒ **`disabled`** for legacy *and* new tenants. Every other key keeps the existing default (legacy undecided ⇒ enabled, new ⇒ disabled). The data probe gains `accounting.partner_statements => PartnerStatementReconciliation exists` so disabling an app that holds statements **suspends** it (read-only) instead of hiding history. |
| `PlatformApplicationOverrideService` | The global-summary default status duplicated the legacy rule; it now honours `explicit_enable_only` so the platform console and the runtime agree. |
| `ImportJobDomain` | `partner_statement` → `'app' => 'accounting.partner_statements'`. `ImportJobAccess` already calls `EnsureApplicationActive::authorize` when `app` is set, so job create / read / apply / list filtering are gated by the same code as static routes (no second implementation). |
| `routes/api.php` | `EnsureApplicationActive:accounting.partner_statements` on the four `partner-statements/import/*` routes, after the permission middleware (same order as every other domain). |
| Web | Application display name in `applications.keys` (ar/en) so the screen shows a name, not the technical key. No new screen. |
| Tests | `ApplicationCatalogTest` and `TenantApplicationTest` counts/keys (45 → 46); `PartnerStatementImportTest` asserts the new `app` binding and gains two job-gating tests; new `PartnerStatementApplicationGateTest` (9 tests). |
| Docs | Horizon Tracker (slice row, next slice, D-PS-08/D-PS-13 pointers) and this report. |

## Activation model (D-PS-13) — no new system
- **Absent decision ≠ enabled.** No row is written implicitly (tested), for tenants registered before `ENFORCEMENT_CUTOVER_AT` and after it.
- **Enabling** uses the existing paths only: `POST /applications/enable` (`apps.manage`, owner/admin) or the platform console `enableForPlatform`; both write the state row and the audit event (tested for the tenant path). Dependencies (`accounting.ledger`, mandatory) are checked by the existing code.
- **Disabling** keeps existing P2 semantics: no data ⇒ `disabled` (all routes 403); statements exist ⇒ `suspended` (GET/HEAD allowed, any POST refused).
- **RBAC is untouched and independent:** enabling grants nothing (an accountant stays refused after enable; `Rbac::MATRIX` still has no `partner_statements.*`), and RBAC never bypasses a disabled app (an owner is refused while it is disabled). `partners.view`, partner/branch visibility and tenant isolation are enforced exactly where PS-A1 put them; `registerTenant()` still auto-enables all built keys, so the PS-A1 suite ran unchanged against the gate.

## Tests (SQLite + PostgreSQL)
| Run | Result |
|---|---|
| `PartnerStatement*` (SQLite) | 47 passed (610 assertions) + 2 PostgreSQL-only skipped |
| `PartnerStatement* + ApplicationCatalog + TenantApplication` (PostgreSQL) | 76 passed (766 assertions) |
| Wider backend filter (`Application|Platform|Import|Nav|Entitlement|Rbac|Branch|Commercial|Role`, SQLite) | 1804 passed, 40 skipped (PostgreSQL-only), **5 failed — all `Fuel*` tests that call `bcmul`/`bcadd` (no `bcmath` in this sandbox; CI has it)**; no application/platform/import/RBAC/branch/entitlement failure |
| Web `components/platform`, `modules/imports`, `modules/roles` | 174 passed; 1 failure in `confirm-dialog.test.tsx` that **also fails on a clean `main` in this sandbox** (focus-trap in jsdom) — file untouched |
- **Mutation controls (each fails ≥ 1 test, then restored):** `statusFor` rule removed (3) · `navVisibility` rule removed (1) · override-summary parity removed (1) · job-domain `app` binding removed (3) · data probe removed (2) · route middleware removed (5). Restored run: 47 passed.
- **New-test coverage:** catalogue shape and uniqueness of the attribute · legacy tenant undecided ⇒ disabled while `purchases.cycle`/`hr.employees` stay enabled · new tenant undecided ⇒ disabled · explicit enable opens the four routes + nav + audit event · RBAC independence both ways · disable without data ⇒ 403 everywhere · disable with data ⇒ suspended (GET 200, POST 403) · per-tenant isolation · platform summary parity · import jobs: disabled blocks read/apply/list and writes nothing, re-enable restores, suspended keeps reads and refuses new jobs.

## Risks and disclosures
1. **The key is visible but off by default everywhere.** `GET /applications` and `/applications/nav-state` list it (`enabled:false`); no sidebar entry exists (no screen yet), so nothing in the UI links to it. Tenants must enable it explicitly until the owner decides otherwise.
2. **`suspended` blocks `inspect`/`preview`** (they are POST) — consistent with the platform rule "GET/HEAD only", even though both are read-only computations. Accepted; revisit only if the owner wants preview under suspension.
3. **Commercial entitlements untouched** (operational gate). If the owner later wants plan-based sales of this capability, it becomes a separate commercial decision.
4. **Shared code touched:** `ApplicationCatalog`, `TenantApplicationService`, `PlatformApplicationOverrideService`. The new attribute defaults to `false` and only one key sets it; the existing application/platform/entitlement/import/RBAC suites were re-run locally (above) and run in CI.
5. Local note: the PS-A1 sandbox failures (no `bcmath`, missing mirror folders) are environmental; CI is the authority.

## Next step (on owner approval, not started)
PS-A2b — candidate source over the statement report: three additive row keys (D-PS-10) with golden-snapshot tests and the reversal/role-filter characterisation test. Then PS-A2c (engine) and PS-A3.
