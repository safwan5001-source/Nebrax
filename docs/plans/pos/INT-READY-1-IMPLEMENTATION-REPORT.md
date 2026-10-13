# INT-READY-1 — Implementation Report

STATUS: PR open for review (#1381). Not merged. Not deployed.
DATE: 2026-10-13
TASK: provider readiness manifest and server gate for delivery-platform native integrations (backend only)
HORIZON: Integrations Center — Slice 1 of the Track U/P plan in `DLV-INTEGRATIONS-UX-DESIGN-1.md` §11
BASE: PR #1380 merged (`638eb3fc9930e800d372b8940c2e06b021f18786`). INT-UX-1 and INT-UX-2 were **not** started.

## Outcome

A backend-owned, static readiness manifest for the six delivery platforms; a read-only endpoint that exposes it; and a reusable server gate that rejects any connect/sync attempt with `409 provider_not_ready`. **No provider is ready: every `connect_enabled` and `sync_enabled` is `false`.** Nothing calls the gate yet, because no connect, authorize or sync route exists (by design).

| Platform | `technical` | Derived `ux_state` | `connect_enabled` | `sync_enabled` |
|---|---|---|---|---|
| HungerStation | `OWNER_GATE` | `AWAITING_PROVIDER_APPROVAL` | false | false |
| Jahez | `BLOCKED` | `NOT_SUPPORTED` | false | false |
| Mrsool | `BLOCKED` | `NOT_SUPPORTED` | false | false |
| Keeta | `OWNER_GATE` | `AWAITING_PROVIDER_APPROVAL` | false | false |
| Ninja | `BLOCKED` | `NOT_SUPPORTED` | false | false |
| The Chefz | `BLOCKED` | `NOT_SUPPORTED` | false | false |

Source of every value: `docs/plans/pos/DLV-PROVIDER-READINESS-1-REPORT.md` §1 and §4.1-§4.6 (verification date 2026-10-11). Order is the UI registry order, not a ranking.

## Repository evidence / root cause

- Readiness existed only as prose in the evidence report; no code could express "this provider may not be connected" (GAP-1 in `DLV-INTEGRATIONS-UX-DESIGN-1.md` §1.3).
- Existing family to imitate: `App\Support\DeliveryPlatformCatalog` (static identity keys). Existing endpoints for the same screen family are gated `invoices.view` + `sales.pos` (`routes/api.php`, `delivery-platforms/*`).
- `DeliveryConnectorAccount` status is only `configured|disabled` (Connector Core). The AWJ-HMAC ingress is not a provider connection and stays untouched.
- New files land in directories already copied wholesale by `setup.sh`, `.github/workflows/ci.yml` and `deploy/assemble.sh` (`app/Support`, `app/Services/DeliveryHub`, `app/Http/Controllers/Api`, `tests/Feature`); no copy list changes were required.

## Approach chosen

1. **Manifest** `App\Support\DeliveryProviderReadiness` — `final`, constants only. Fields per platform: `technical`, `evidence_ref`, `evidence_date`, `auth_method` (null), `connect_enabled`, `sync_enabled`. `uxState()` derives the provider-level UX state (design §4.2): `BLOCKED → NOT_SUPPORTED`; `OWNER_GATE → AWAITING_PROVIDER_APPROVAL`; `READY` without `connect_enabled → AWAITING_PROVIDER_APPROVAL`; `READY` with `connect_enabled → READY_TO_CONNECT`. `validate()` rejects contradictory manifests: catalog keys must match exactly; connect only when `READY`; connect requires a declared `auth_method`; sync requires connect; flags must be real booleans; exact field set.
2. **Gate** `App\Services\DeliveryHub\DeliveryProviderReadinessGate` — `canConnect/canSync/assertConnectable/assertSyncable`. Throws the existing `DeliveryConnectorException('provider_not_ready', 'هذا التكامل غير متاح بعد.', 409)`. Fail-closed: an unknown key, wrong case or empty string behaves exactly like a not-ready provider. The constructor validates its rows, so a contradictory manifest cannot produce a gate. The optional `$rows` argument exists only so tests can exercise the positive path.
3. **Endpoint** `GET /api/delivery-platforms/readiness` → `DeliveryProviderReadinessController::index`, middleware `invoices.view` + `EnsureApplicationActive:sales.pos`. No database access, no writes. Response per row: `platform_key`, `name`, `name_en`, `technical`, `ux_state`, `connect_enabled`, `sync_enabled`, `evidence_date`, and `evidence_ref` **only** for users holding `delivery_connector.view` (owner/admin or a custom role granted it).

## Why this approach fits AWJ

Reuses the catalog pattern and the existing permission and application gates (no new permission, per the design). Keeps the gate independent of the UI (R-GATE-2) and independent of tenant data (R-GATE-3). Keeps manual POS attribution (ladder step A) and the AWJ-signed ingress unchanged. A manifest flip is forced to be its own reviewed PR because the freeze test duplicates the table and must be edited in the same change (R-GATE-4).

## Changed files

| File | Change |
|---|---|
| `app/Support/DeliveryProviderReadiness.php` | New. Manifest, derivation, validation. |
| `app/Services/DeliveryHub/DeliveryProviderReadinessGate.php` | New. Server gate (not wired to any route). |
| `app/Http/Controllers/Api/DeliveryProviderReadinessController.php` | New. Read-only endpoint. |
| `routes/api.php` | +1 import, +1 `GET` route (before `delivery-platforms/{id}`). |
| `tests/Feature/DeliveryProviderReadinessTest.php` | New. 24 tests. |
| `docs/plans/pos/INT-READY-1-IMPLEMENTATION-REPORT.md` | This report. |

No migration, no model, no permission/`Rbac` change, no frontend, no translation file, no workflow.

## Tests and exact results

Local runs used the repository's own `setup.sh` assembly (`/home/user/nibras-app`, Laravel 11, PHP 8.3.6, SQLite). `php artisan key:generate` was needed locally because the sandbox `.env` had an empty `APP_KEY`; this is environment setup, not a repository change.

| Run | Result |
|---|---|
| `php artisan test --filter=DeliveryProviderReadinessTest` | **24 passed, 281 assertions** |
| Mutation check: temporarily set Keeta to `READY` + `connect_enabled=true` in the assembled copy | 8 of 24 tests failed (frozen table, contradictory-row, gate, endpoint, ladder tests), then restored byte-for-byte |
| Route-inventory pattern check against sample URIs (`…/{key}/connect`, `…/{id}/authorize` flagged; `delivery-connectors/{id}/rotate-secret`, `delivery-hub/orders`, `delivery-platforms/readiness` not flagged) | as expected |
| `--filter='Delivery\|BranchIsolationGuardTest\|ApplicationAccessGateGuardTest\|RoleTest\|PublicApiWriteSurfaceTest\|CommerceModuleBoundaryTest\|WebhookSignatureTest'` | 405 passed, 2 skipped, **13 failed**; the 13 are in `StorefrontMediaDeliveryTest`, `FuelReconciliationTest`, `FuelSupplyReceivingApiTest` (matched only because their names contain "Delivery") |
| Same three classes on **pristine `main`** (my files removed, `routes/api.php` from `main`) | **20 failed, 7 passed** — the failures pre-exist and are independent of this change (local-environment dependent) |
| Full suite, SQLite, branch (`php artisan test`) | Still running when this report was committed; the final count is given in the hand-off message and is not claimed here |

Tests added cover: frozen manifest vs evidence, order, validity and exact catalog coverage; UX-state derivation; nine contradictory-row cases; missing/extra/malformed rows; the gate for all six platforms plus unknown, empty and wrong-case keys (code `provider_not_ready`, status 409); the positive path with injected valid rows (connect-only, connect+sync, sync without flag refused); gate refuses to build on a contradictory manifest; endpoint contents for an owner; staff/accountant receive the same data without `evidence_ref`; unauthenticated 401, `self_service` 403, `sales.pos` disabled 403; GET-only (405 for POST/PUT/PATCH/DELETE) and request parameters cannot flip a flag; identical payload for two tenants and no tenant id in the body; no INSERT/UPDATE/DELETE during the request (`DB::listen`, excluding the Sanctum token `last_used_at` update) and unchanged journal/invoice/payment/stock/profile/connector/hub counts; ladder independence (creating a Keeta manual profile and an AWJ-signed ingress account leaves readiness identical); no route containing connect/authorize/oauth/callback/link/sync/pair/credential/token under delivery/provider/integration URIs; the readiness route is a single guarded `GET`.

## Build / lint / typecheck

PHP-only change. No frontend files changed, so `npm run build` and `web-ci.yml` are not applicable. All new PHP files load and run under the test suite; there is no separate PHP linter configured in the repository.

## CI

`ci.yml` (`php artisan test`, sqlite and pgsql) runs on every push and pull request; `web-ci.yml` is path-filtered to `web/**` and is not expected to trigger. When this report was committed, the jobs for PR #1381 were **in progress**. No Green is claimed here; the observed result for the exact head is read from the PR checks and stated in the hand-off message.

## Pre-merge review

- PRE_MERGE_REVIEW: **not stamped** — requires CI green on the exact Head SHA (Gate 9). Any later head change invalidates it.
- Reviewed Head SHA: the PR head at hand-off (a report-only commit may follow the code SHA; the code is unchanged by it)
- Findings / resolution: none open (see Self-review).

## Merge

- Merge status: **not merged** (stopped before merge by instruction).
- Merge SHA: none.

## Post-merge review

POST_MERGE_REVIEW: not started (nothing merged).

## Self-review

### Implementer
- The manifest values were copied from the evidence report, not from memory, and are pinned by a duplicated table in the test.
- The gate has no database, network, filesystem or container dependency beyond the static manifest.
- The endpoint cannot be influenced by request input; it never reads the tenant.
- No existing file other than `routes/api.php` was touched, and that change is additive (3 lines).

### Reviewer
- The gate is intentionally unreachable from HTTP today. This is documented in the class docblock and here so nobody reads it as an oversight; the first adapter task must call it before any outbound step.
- `evidence_ref` is a path to an internal document, so it is limited to `delivery_connector.view`. `technical` (`OWNER_GATE`/`BLOCKED`) is visible to every `invoices.view` user; the UI must translate it into tenant-friendly copy (design §3.2), and the endpoint documents the stable `ux_state` for that purpose.
- Manifest key order differs from `DeliveryPlatformCatalog::keys()` on purpose (UI registry order, design §5.2); a test pins it.
- Route-inventory test uses a name pattern. A future legitimate route whose URI contains one of those words under delivery/provider/integration would fail it and need a deliberate edit — the intended friction.

### AWJ Guardian
| Risk | Result |
|---|---|
| A provider becomes connectable by editing data | Impossible through any API or tenant setting; only a code change that must also edit the frozen test. |
| Contradictory manifest (connect on a blocked provider, sync without connect) | `validate()` throws; the gate refuses to construct. |
| Unknown or malformed platform key bypasses the gate | Fail-closed with the same code. |
| Client forces readiness through query/body | Ignored; verified. |
| Cross-tenant leakage / tenant data in the response | Static data, identical across tenants, no tenant id in the body. |
| Writes or financial side effects | None; `DB::listen` proves no write statements, and financial/connector/hub counts are unchanged. |
| Internal evidence path exposure | Only to `delivery_connector.view`. |
| Readiness mistaken for the manual-attribution state | Test proves A and the ingress account do not change B. |
| External connection | None. No HTTP client, no credential, no provider SDK. |

## Accounting impact

None. No journal entry, invoice, payment, VAT, commission, settlement or stock movement is created or changed, so no journal-entry table applies. The `LedgerService`, `InvoiceService`, `PaymentService` and `InventoryService` are not referenced.

## Tenant / branch isolation impact

The endpoint serves platform-level static data and never reads tenant-owned rows; it is identical for every tenant. Authentication and tenant resolution still go through the existing middleware group. Branch scope is irrelevant to the payload (no branch-owned data).

## Security / authorization impact

No new permission. Access = `invoices.view` + `sales.pos` (the same gate as the delivery-platforms screen). `evidence_ref` additionally requires `delivery_connector.view`. No secret, token or credential exists in this slice.

## Backward compatibility

Additive only: one new `GET` route; no existing route, model, permission, response shape, migration or behavior changed. The AWJ-signed ingress, manual POS attribution, Delivery Hub and the channel report are untouched (their suites are unchanged).

## API / DB / migration impact

API: `GET /api/delivery-platforms/readiness` (new, read-only). DB: none. Migration: none. OpenAPI documents are not affected (internal API).

## External research used

**External Evidence:** none gathered in this slice. The data come from the repository's own evidence packet `DLV-PROVIDER-READINESS-1` (official sources read on 2026-10-11). Provider pages were not re-fetched; the manifest records that date. A stale date can only err toward "not ready", never toward enabling a provider.
**AWJ Decision:** keep every provider unready; derive UX states exactly as design §4.2; expose a minimal tenant-safe payload.
**Rejected / Not Adopted:** a database table or tenant-editable readiness; wiring the gate into `DeliveryConnectorAccountService::create` (the signed ingress is a different capability); returning `auth_method` or the commercial/financial columns before they carry information; an HTTP middleware for the gate (no route exists to attach it to).
**Visual research:** not applicable to a backend-only slice. It remains mandatory for INT-UX-1 (design §12.2) and was deliberately not claimed here.

## Risks / remaining work

| Risk | Note |
|---|---|
| Gate is unused until an adapter task exists | Intended. A future route that forgets to call it would be unguarded; INT-UX-2's invariant test and the route-inventory test here are the backstops, and the adapter brief must list the call as an acceptance criterion. |
| Evidence date is 2026-10-11 | Re-verify before any flip, in that flip's PR. |
| `technical` enum visible to all `invoices.view` users | Low sensitivity; UI maps it to tenant copy. |
| PostgreSQL not run locally | The sandbox cannot start a local PostgreSQL; the `pgsql` CI job is the proof. |
| Local-environment failures unrelated to this change (Fuel*, StorefrontMediaDelivery) | Reproduced on pristine `main`; CI environment is the reference. |

## Discovered backlog

- INT-UX-1 reconciliation items from the approved design image (see "Recommended next dependency-ready task").
- Decide DP-C, DP-F before INT-UX-4/5 as already recorded in `DLV-INTEGRATIONS-UX-DESIGN-1.md` §10.

## Git state

- Branch: `feat/int-ready-1-provider-readiness-manifest`
- PR: #1381 — https://github.com/safwan5001-source/Nebrax/pull/1381
- Base SHA: `638eb3fc9930e800d372b8940c2e06b021f18786` (`origin/main` at start; PR #1380 merge)
- Code SHA (feature commit): `0c0da2904c3a552810e19f05b6d36307fd9312dd`
- Head SHA: the PR head (this file cannot embed its own commit hash; it follows the code SHA above with documentation-only changes)

## Recommended next dependency-ready task

**INT-UX-1** (Integration Center shell, navigation and landing). It does not depend on this slice's endpoint, but INT-UX-2 does, and this endpoint is now available for it. Before INT-UX-1 starts:

1. Run the mandatory visual benchmark (desktop + mobile, RTL + LTR, empty/error/permission states) and record it as External Evidence.
2. Reconcile the approved image with the design spec:
   - The image shows the active card badge **«ضمن التصميم»** in green; `DESIGN_SYSTEM.md` reserves semantic green for financial meaning and the spec §5.0 maps "Available/healthy" to the neutral tone. Choose one explicitly.
   - The image labels the other three cards «توسع مستقبلي». The spec requires planned categories to be non-interactive, with no link/button/status dot/count, and to say that no external integrations are available yet. The four-card layout is compatible if the three cards render as inert (non-focusable) tiles with that wording.
   - The image subtitle «إدارة الخدمات والتطبيقات المرتبطة بأَوْج» should not imply working integrations; align it with spec `subtitle`/`category.deliveryDesc`.
   - «القسم الأول» on the Delivery card must not be read as a launch promise (spec R-COPY-3: no dates or "coming soon" claims).

**Merge ≠ Deploy.** No production release is authorized.
