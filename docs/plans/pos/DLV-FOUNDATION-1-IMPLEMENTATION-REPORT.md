# DLV-FOUNDATION-1 — Implementation Report

**Task:** DLV-FOUNDATION-1 — tenant-scoped delivery-platform configuration foundation  
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)  
**Evidence base:** `docs/plans/pos/DLV-EVIDENCE-1-REPORT.md` (merged, PR #1171, `c0098d38762fc2d113ab189fd7d85acebe0f5c8f`)  
**Base SHA (`origin/main` at start):** `c0098d38762fc2d113ab189fd7d85acebe0f5c8f`  
**Branch:** `claude/fervent-tesla-vwm7os`  
**PR / Head SHA:** recorded in the PR and the final report (a report cannot contain its own commit hash).

## 1. What was built

A configuration-only layer **over** the existing `SalesChannel(type=external)` (decision DG-5, resolved in DLV-EVIDENCE-1). No new channel authority.

| Concept | Implementation |
|---|---|
| Platform identity | `delivery_platform_profiles`: `(tenant, platform_key, sales_channel_id)`; catalog of six keys (`DeliveryPlatformCatalog`). Identity is immutable. |
| Channel link | `SalesChannel(type=external, is_active)` with slug `delivery-<platform>` (`the_chefz` → `delivery-the-chefz`). The service creates the channel, or links an existing unlinked external channel whose slug matches. |
| Configuration | `delivery_platform_profile_versions`: append-only (`updating`/`deleting` throw). Holds `collection_mode` (`platform_collected`/`merchant_collected`, **data only**), `external_reference_policy` (`required`/`optional`/`none`), display names, `logo_asset_key` (opaque key, not a URL), `is_active`, `change_reason`, `created_by`, `effective_from`. |
| Branch overrides | `delivery_platform_version_overrides`: rows **belong to a version** (`unique(version, branch)`), immutable, `NULL` field = inherit. Every new version carries a full snapshot (unchanged overrides copied, edited ones replaced). |
| Resolution | `DeliveryPlatformConfigService::resolve(profile, ?branch, ?versionId, ?at)`: by version id (stable meaning forever), by timestamp, or latest; branch override applied from the same version. |
| API | `GET delivery-platforms[/catalog\|/{id}\|/{id}/versions\|/{id}/resolve]` (`invoices.view`), `POST`/`PUT delivery-platforms` (`company.manage`), all under `EnsureApplicationActive:sales.pos`. Routes use `whereUuid`. |

**Explicitly not built (invariants):** settlement counterparty (DG-1), accounting posting, any change to invoice/payment/ledger/`gateway_clearing`, POS checkout/close, Delivery Hub, provider API/webhooks, commission, settlement, VAT assumptions, channel pricing. `Store` overrides are not implemented: a store is an *external* vendor/store identifier (connector territory, evidence gap G7), so only **branch** overrides exist (designed in the evidence report).

## 2. Database / schema (additive only)

Migrations `2026_10_21_010000/020000/030000`: three new tables, no existing table touched, no data backfill.

- `delivery_platform_profiles`: `unique(tenant_id, platform_key)`, `unique(tenant_id, sales_channel_id)`; FKs to `tenants` (cascade), `sales_channels` (restrict).
- `delivery_platform_profile_versions`: `unique(profile, version_number)` (named `dpp_versions_profile_number_unique`), index `(tenant, profile, effective_from)`; `created_by → users` null-on-delete.
- `delivery_platform_version_overrides`: `unique(version, branch)`, index `(tenant, branch)`; FKs restrict.
- Index names verified ≤ 63 chars on PostgreSQL.

## 3. Versioning / history behavior

- Every edit (policy, display, activation, override) = one new version in a single transaction after `lockForUpdate` on the profile row; no-op edits create nothing (idempotent).
- `null` on update means "unchanged" (a `null` `is_active` never deactivates; a `null` `branch_overrides` never clears; only `[]` clears).
- A branch-restricted actor can set/replace only overrides for their own branches and cannot erase overrides of branches they do not hold.
- Failures are atomic (no partial version/orphan override).
- `is_active` on the profile row is a mirror of the latest version; history of activation lives in versions.

## 4. Tenant / Branch / RBAC proof (tests)

Foreign `SalesChannel` rejected with the same message as a non-existent id (no existence leak) · foreign branch rejected (service, model, HTTP) · cross-tenant profile/version/resolve/update → 404 · version of another profile not resolvable even in the same tenant · branch-restricted users: override outside scope → 422, resolve outside scope → 404, overrides outside scope hidden in responses · `staff`/`accountant` can read but not mutate (403) · `self_service` cannot read · unauthenticated → 401 · disabled `sales.pos` → 403 · `BranchIsolationGuardTest` (profile/version `CompanyWide`, override `BelongsToBranch`) .

## 5. Backward compatibility proof (tests)

- Channel counts for `web`/`mobile`/`pos` unchanged after configuring all six platforms (+6 `external` only).
- `StorefrontProvisioningService` still produces exactly one active `web` channel with delivery channels present; `Storefront` still refuses a non-web channel; `MobileSalesChannelResolver` fails closed on a delivery channel.
- A full POS cash cycle (open session → checkout → closing preview) in a tenant configured with all six platforms as `platform_collected` produces **identical** journal lines, payments, invoice totals and close preview to an unconfigured tenant.
- Config endpoints create zero journal entries, invoices, payments, stock movements or payment methods.

## 6. Tests

See the PR/final report for exact counts and results (sqlite, PostgreSQL, CI). New files: `DeliveryPlatformProfileDomainTest`, `DeliveryPlatformVersioningTest`, `DeliveryPlatformApiTest`, `DeliveryPlatformBackwardCompatibilityTest`. Mutation spot-checks (removing version immutability, override carry-forward, version-id resolution, no-op detection) each made the intended tests fail.

## 7. Findings / deferred (not fixed here)

- **Deferred:** Store (external vendor/store id) overrides — blocked on the connector mapping design (EVIDENCE-1 G7 / DG-6).
- **Deferred:** settlement counterparty field — DG-1.
- **Note:** `PaymentMethodChannelAvailabilityService` already treats `type=external` channels like any non-POS channel; delivery channels therefore appear in that policy surface. No behavior change; recorded for DLV-POS-1.
- **Note:** `sales.pos` gating reuses an existing catalog key; a dedicated delivery capability key/permissions remain DG-9.

## 8. Dependency readiness

No downstream task becomes dependency-ready: ACCOUNTING-1 (DG-1/2/3), POS-1 (DG-2/8/9) and HUB-1 (DG-6/9) are each blocked by open Decision Gates. See `TASK-QUEUE.md`.
