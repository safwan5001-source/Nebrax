# STORE-ADMIN-ADOPT-1A — Post-Provisioning Gap Pass

## Status
**1A_COMPLETE**

## Baseline
- Latest `main` (this pass): `3ef33e615f1f38edf9924206a10cdf71394e88f7` — "COM-STORE-PROVISION-1: Explicit tenant Storefront provisioning + AWJ-managed domain (#840)".
- PR #797 reference: merge SHA `c90c731d36a34600ab4d166d474fa9ccd9084bf9` — "docs(store): document Spree Dashboard adoption map", which introduced/updated `docs/plans/store/AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md` — the authoritative document that actually defines `STORE-ADMIN-ADOPT-1A` and `STORE-ADMIN-ADOPT-1B` (§7 of that file).
- PR #840 / merge SHA: `3ef33e615f1f38edf9924206a10cdf71394e88f7` (already merged, deployed, Production-verified per task baseline — not reopened or modified here).
- Current Storefront architecture: `SalesChannel` (commercial identity, `type=web`) → `Storefront` (hosted store identity/status/locale, `CompanyWide`) → `StorefrontDomain` (`awj_subdomain` auto-verified or `custom`, tenant-scoped). No branding/SEO/theme columns exist on `Storefront` by design (explicit in the model's docblock, deferred to future Store Configuration/Design work).

## Original 1A scope
From `docs/plans/store/AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md` §7, `STORE-ADMIN-ADOPT-1A — Store Admin Contract` ("Recommended first implementation slice when coding capacity is available"):

> - Add the minimum authenticated, tenant-scoped ERP admin contract required to read/manage the existing `SalesChannel`, `Storefront` and relevant domain data.
> - Reuse existing models and tenant invariants.
> - Enable the Commerce Workspace store selector and **View Store** against that safe admin contract.
> - Do not repurpose the public Host-resolved storefront API.
> - Do not add branding, SEO, checkout, shipping or payment-gateway configuration.
> - Prefer **no migration** in 1A unless repository evidence during implementation proves one is strictly necessary.
> - Add focused tenant-isolation, authorization and cross-tenant negative tests before broad UI/build tests.

The same document's Repository Evidence Pass (§6, dated 2026-09-12) records the gap this slice was meant to close: *"there is no tenant-scoped ERP admin API that lists/manages `SalesChannel`, `Storefront` or `StorefrontDomain`... Because of this gap, the current Commerce Workspace store selector and View Store action cannot safely become fully operational yet."*

A companion doc, `docs/plans/store/AWJ_COM_WS_2_COMMERCE_STORE_SELECTOR.md` (status at the time: "implemented on a feature branch, not merged"), specifies the exact 1A contract to the byte: `GET /api/commerce/workspace/storefronts`, response shape (`id`, `name`, `sales_channel_id`, `is_active`, `preview_url`), no RBAC beyond a `self_service` 403, `commerce.storefront` intentionally not gating this read, and the frontend selector/View Store wiring consuming it. This is the newest and most specific 1A evidence and is treated as authoritative alongside the adoption map; no conflict was found between the two documents.

## Original 1B scope
From the same file, `STORE-ADMIN-ADOPT-1B — Store Settings / Configuration` ("Only after 1A is stable"):

> - Define the smallest explicit AWJ Store Configuration contract.
> - Adapt the useful Spree settings information architecture to AWJ design system and Arabic-first RTL.
> - Introduce only commerce-owned settings with a clear persistence owner.
> - Products, inventory, pricing, customers and accounting remain links/read-only context to AWJ authority.
> - Any DB/API expansion requires a separate tenant-isolation and backward-compatibility review.

1B is settings/configuration (branding, SEO, storefront access toggles, checkout/shipping/payment-capture *settings*, etc.) layered on top of the 1A read/write admin contract — explicitly not started here, and not touched by this pass.

## Current implementation evidence

**Backend**
- `routes/api.php`: `GET commerce/workspace/storefronts` (no RBAC beyond the controller's `self_service` block — matches COM-WS-2's documented, intentional exception) and `POST commerce/workspace/storefronts` (`$perm('commerce.manage')`, added by #840).
- `App\Http\Controllers\Api\CommerceWorkspaceStorefrontsController::index/store` — tenant-scoped read (`CommerceWorkspaceStorefrontsService::listForCurrentTenant`) and explicit first-store provisioning (`StorefrontProvisioningService::provisionFirstStorefrontForCurrentTenant`).
- `App\Services\Commerce\CommerceWorkspaceStorefrontsService` — reads only active `Storefront` rows whose `SalesChannel` is `type=web` and same-tenant (double-checked in PHP in addition to `TenantScope`), returns `id/name/sales_channel_id/is_active/preview_url`; `preview_url` is server-built from an active+verified domain only (never a raw hostname/tenant_id echo).
- `App\Services\Commerce\StorefrontProvisioningService` — transactional, `tenants` row-locked (serializes concurrent provisioning for the same tenant), idempotent/converging (never duplicates a channel/store/domain), fails closed on any ambiguity (multiple active web channels, slug collisions, hostname collisions across tenants), builds the hostname exclusively from the server-trusted `tenants.slug` via `ManagedStorefrontHostname::forSlug()` — no client-supplied hostname/tenant/channel/store id anywhere in the path.
- RBAC: `commerce.manage` added to `App\Support\Rbac::MATRIX['owner'|'admin']` only (via the `*` wildcard architecture) — not granted to `staff`/`accountant`/`self_service`, matching the ticket's confirmed baseline.
- Catalog: `commerce.storefront` promoted `coming_soon` → `built` in `App\Support\ApplicationCatalog`, with an explicit comment that this does not auto-enable it per tenant and does not add new `EnsureApplicationActive` enforcement to Commerce Workspace routes in this batch.
- `Storefront` model docblock explicitly excludes branding/theme/SEO columns from this table ("Store Configuration/Design work, out of scope here").
- Tests: `tests/Feature/CommerceWorkspaceStorefrontsApiTest.php` (read-side tenant isolation), `tests/Feature/StorefrontProvisioningApiSecurityTest.php` (16 cases — including `guests_are_rejected`, `self_service_principals_cannot_provision`, `a_staff_user_without_commerce_manage_cannot_provision`, `an_accountant_without_commerce_manage_cannot_provision`, `tenant_a_cannot_provision_a_storefront_for_tenant_b`, `the_client_cannot_choose_the_generated_hostname`, `the_client_cannot_choose_verification_status_or_domain_type`, `a_hostname_collision_with_another_tenant_fails_closed_with_a_conflict`, `a_pending_custom_domain_is_left_untouched_by_provisioning_the_managed_domain`, resolver-side cross-tenant negative tests), `tests/Feature/StorefrontProvisioningServiceTest.php`, `tests/Feature/StorefrontProvisioningPostgresConcurrencyTest.php`, `tests/Feature/ManagedStorefrontHostnameTest.php`, `tests/Feature/CommerceModuleBoundaryTest.php` (still only allows this one commerce-named API path).
- No new migrations were added by #840 (`git show --stat` for the merge commit touches no `database/migrations/*` files) — matches the "prefer no migration" 1A directive.

**Frontend**
- `web/src/components/commerce-workspace/commerce-workspace-shell.tsx` — global Commerce Workspace header: multi-store `Dropdown` selector (only rendered when >1 store; otherwise shows the single/loading/empty/unavailable state), and a `View Store` (`عرض المتجر`) external link that only renders when the selected store has a sanitized `preview_url`.
- `web/src/app/(commerce)/commerce/stores/page.tsx` — dedicated Storefronts screen: loading/error/empty/ready states, `EmptyState` with "إنشاء متجر إلكتروني" gated on `hasPermission(..., 'commerce.manage')`, a table listing name / active-inactive badge / clickable preview URL per store, `provisionCommerceStorefront()` wired to the POST endpoint with a re-fetch-after-create (`refresh`) pattern (no optimistic/local mutation of the trusted catalog).
- `web/src/modules/commerce-workspace/store-context.tsx` / `stores.ts` — the single trusted client for the list+create contract; `resolveViewStoreUrl` only trusts server-provided `preview_url`.
- Tests: `web/src/app/(commerce)/commerce/stores/page.test.tsx`, `web/src/modules/commerce-workspace/stores.test.ts`, `web/src/components/commerce-workspace/commerce-workspace-shell.test.tsx` cover empty/ready/creating states and selector/View Store wiring.
- `web/src/app/(commerce)/commerce/domains/page.tsx` renders a generic `CommerceDestinationPage` placeholder ("destination pending") — this is pre-existing scaffolding for a future dedicated domain-management screen and was never claimed as part of 1A's contract; 1A's "relevant domain data" requirement is satisfied at the minimum viable level through `preview_url` in the stores list/selector, which is exactly what COM-WS-2 specified.

## Gap matrix

| Planned capability | Original phase | Current backend | Current frontend | Status | Evidence | Remaining gap | Recommended owner/PR |
|---|---|---|---|---|---|---|---|
| Tenant-scoped admin read of Storefront/SalesChannel | 1A | `GET commerce/workspace/storefronts` (`CommerceWorkspaceStorefrontsService`) | Store selector + `/commerce/stores` table | COMPLETE | COM-WS-2 doc matches shipped code byte-for-byte; `CommerceWorkspaceStorefrontsApiTest.php` | none | — |
| First Storefront provisioning (write) | 1A (new, added after the adoption map by #840) | `POST commerce/workspace/storefronts` (`StorefrontProvisioningService`) | "إنشاء متجر إلكتروني" action in empty state | COMPLETE | Production-verified (`alrshd`); `StorefrontProvisioningApiSecurityTest.php`, `StorefrontProvisioningServiceTest.php`, `...PostgresConcurrencyTest.php` | none | — |
| RBAC mutation boundary (`commerce.manage`) | 1A | `Rbac::MATRIX` owner/admin only, enforced on `POST` | UI gates the create button on the same permission | COMPLETE | `Rbac.php`; negative tests for staff/accountant/self_service/guest | none | — |
| AWJ-managed domain creation + authoritative public URL | 1A | `StorefrontProvisioningService::ensureManagedDomain`, `ManagedStorefrontHostname` | `preview_url` rendered as a link | COMPLETE | Production DB verification (verified/active/primary `awj_subdomain`) | none | — |
| Commerce Workspace store selector | 1A | n/a (frontend consumes GET) | `commerce-workspace-shell.tsx` dropdown | COMPLETE | `commerce-workspace-shell.test.tsx` | none | — |
| "View Store" action | 1A | n/a | Header link, gated on sanitized `preview_url` | COMPLETE | same as above | none | — |
| Tenant isolation / cross-tenant negative tests | 1A | n/a | n/a | COMPLETE | `tenant_a_cannot_provision_a_storefront_for_tenant_b`, `a_second_tenant_hostname_never_resolves_to_the_first_tenant_data`, etc. | none | — |
| Custom-domain admin visibility (hostname/type/verification/active beyond `preview_url`) | not explicitly in 1A's scope bullets | none (only computed `preview_url`) | `/commerce/domains` is a generic "destination pending" placeholder | OUT_OF_SCOPE (for 1A) | 1A scope text says "relevant domain data" satisfied at minimum viable level per COM-WS-2; a real domain-management screen was never specified for 1A | Full custom-domain read/verify UI | 1B or a dedicated `COM-DOMAIN-ADMIN` ticket |
| Activate / deactivate an existing Storefront | not in 1A's scope bullets | not built (no PUT/PATCH/delete route) | not built | NOT_STARTED / requires decision | 1A doc lists only read + provision + selector + View Store; deactivation of a live, publicly-resolved storefront is a new product/security decision (what happens to in-flight buyer traffic, cart/checkout sessions, SEO) | Explicit lifecycle contract | Requires Safwan's decision; likely 1B or a dedicated ticket, not 1A |
| Multiple storefronts per tenant (create 2nd+) | not in 1A/#840's scope | `StorefrontProvisioningService` only provisions the *first* store (explicit single-channel/slug convergence, fails closed on ambiguity) | selector already renders >1 if they existed, but nothing can create a 2nd | OUT_OF_SCOPE (new product decision) | Doc's provisioning is explicitly "first storefront"; multi-store is an unresolved product question (multiple `web` `SalesChannel`s, multiple product catalogs?) | New provisioning contract + product decision | Not 1A; needs explicit scoping before any PR |
| Storefront settings (branding/SEO/theme/checkout/shipping/payment) | 1B | none (columns deliberately absent) | none | OUT_OF_SCOPE for 1A (belongs to 1B) | `Storefront` model docblock; adoption map §7 explicitly excludes this from 1A | — | STORE-ADMIN-ADOPT-1B |

## What #840 superseded/completed
Everything the adoption map's §6 evidence pass flagged as the blocking gap for 1A is now built and Production-verified:
- The "no tenant-scoped ERP admin API" gap is closed by `GET/POST commerce/workspace/storefronts`.
- The store selector and View Store action, which the adoption map said "cannot safely become fully operational yet," are now fully operational against real data (verified against tenant `alrshd` in Production).
- First-storefront provisioning — which the original adoption map treated as a prerequisite gap, not a scoped feature of 1A itself — was additionally delivered by #840, going beyond what 1A's own bullets strictly required (1A only asked for read/manage of *existing* data) and closing what would otherwise have been the very next blocking step.
- `commerce.storefront` maturity promotion (`coming_soon` → `built`) removes the ambiguity noted in COM-WS-2 about whether this capability could ever gate the workspace read.

No old 1A planning item needs to be re-implemented.

## Remaining 1A work
None found. Every explicit bullet in `STORE-ADMIN-ADOPT-1A — Store Admin Contract` (adoption map §7) and every field/behavior in the more specific `AWJ_COM_WS_2_COMMERCE_STORE_SELECTOR.md` contract is present in shipped, tested, Production-verified code, with no gaps that are simultaneously (a) inside 1A's stated scope and (b) not yet built.

## Deferred to 1B
- Store Configuration contract: branding/logo, theme tokens, SEO, static pages/policies.
- Storefront access / guest checkout / address-requirement *settings* (as settings, not runtime behavior).
- Payment-capture-timing and shipping-method *settings* UI (persistence + admin form only; runtime payment/shipping orchestration stays AWJ-authoritative regardless of phase).
- Any richer Store Admin/settings UX generally, per the adoption map's phase split.

## Out of scope / parallel workstreams
- **Product Publication** (COM-WS-3) — not reopened; Storefront admin does not currently show product/catalog counts and none were added.
- **Cart / Checkout / Payments** — not inspected or touched.
- **Public/Mobile Commerce API** — not touched; the public `GET store/v1/storefront` Host-resolved path remains untouched and is explicitly not reused by the admin contract (verified in code and in COM-WS-2's own text).
- **Storefront renderer / public Storefront UI/design** — not touched.
- **App Builder / page-section builder / visual customization** — not touched; explicitly `LATER` in the adoption map's capability table and absent from both 1A and 1B scope quoted above.

## Security review
- **Tenant Isolation:** Both the read (`CommerceWorkspaceStorefrontsService`) and write (`StorefrontProvisioningService`) paths derive tenant identity exclusively from `TenantContext` (set by `SetTenant` from the authenticated user), never from client-supplied `tenant_id`/`storefront_id`/`hostname`/Host header. The read path additionally double-checks `tenant_id` in PHP after the `TenantScope` query as defense in depth. Negative tests explicitly cover cross-tenant provisioning attempts and cross-tenant hostname resolution. No defect found.
- **RBAC:** `POST` is gated by `commerce.manage` (owner/admin only, via the existing wildcard role architecture); `GET` intentionally carries no RBAC permission beyond blocking `self_service`, which is a pre-existing, explicitly documented (COM-WS-2, and re-confirmed in the current route comment) design decision, not a defect — read access here is workspace navigation, not a mutation boundary, and is consistent with how other Commerce Workspace destinations behave. No new permission was created in #840 or by this pass, and none is proposed.
- **Client authority:** Hostname, verification status, and domain type are always server-derived (`ManagedStorefrontHostname::forSlug()`, hard-coded `TYPE_AWJ_SUBDOMAIN`/`VERIFICATION_VERIFIED` in the service) — tests explicitly assert the client cannot choose the hostname, verification status, or domain type.
- **Domain authority:** Auto-verification is scoped exclusively to the `awj_subdomain` type the service itself generates from the trusted tenant slug; pre-existing pending `custom` domains are left untouched by provisioning (explicit test: `a_pending_custom_domain_is_left_untouched_by_provisioning_the_managed_domain`).

No Tenant Isolation, RBAC, or authority defect was found during this pass.

## Implementation decision
**Case A — 1A is effectively complete.** #840 plus pre-existing code fully satisfies the original 1A scope as documented in `AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md` §7 and the more specific `AWJ_COM_WS_2_COMMERCE_STORE_SELECTOR.md` contract, both Production-verified. The remaining items identified in the gap matrix (custom-domain admin UI, storefront activate/deactivate, multi-store) were never part of 1A's stated scope bullets — they require new product/security decisions (lifecycle of a live public storefront, custom-domain trust model, multi-store data model) and belong either to 1B or to a dedicated future ticket, not to a "small bounded gap" inside 1A. No implementation was made in this pass.

## Changes made
Analysis/documentation only. This report (`docs/plans/store/STORE-ADMIN-ADOPT-1A-GAP-PASS.md`) was written locally and is **not committed or pushed**, per the task's Case A instructions. No application code, routes, migrations, or tests were modified.

## Tests
No implementation occurred, so no test run was required or performed under the ticket's own rules (§18: "Tests if implementation occurs"). Verification for this pass was evidence-based, by reading:
- `routes/api.php` (both `commerce/workspace/storefronts` routes and their middleware),
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php`,
- `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php` and `StorefrontProvisioningService.php`,
- `app/Models/Storefront.php`,
- `app/Support/Rbac.php` and `app/Support/ApplicationCatalog.php`,
- the full test file listing for `tests/Feature/CommerceWorkspaceStorefrontsApiTest.php`, `StorefrontProvisioningApiSecurityTest.php` (16 named cases enumerated above), `StorefrontProvisioningServiceTest.php`, `StorefrontProvisioningPostgresConcurrencyTest.php`, `ManagedStorefrontHostnameTest.php`, `CommerceModuleBoundaryTest.php`,
- the frontend implementation (`commerce-workspace-shell.tsx`, `commerce/stores/page.tsx`, `store-context.tsx`, `stores.ts`) and its test files,
- and the merge commit's `--stat` diff confirming no migrations were added.

`git diff` between the current worktree and `origin/main` is empty (this worktree was fast-forwarded to `3ef33e615f1f38edf9924206a10cdf71394e88f7` to inspect the true post-#840 state; no other changes exist).

## Git
- Branch: none created (Case A — no implementation).
- PR: none opened.
- Base SHA: `3ef33e615f1f38edf9924206a10cdf71394e88f7` (latest `main` at time of this pass).
- Head SHA: same as base (no commits made).
- CI: not triggered (no push).

## Recommended next step
Move directly to **STORE-ADMIN-ADOPT-1B — Store Settings / Configuration**, starting with the smallest explicit AWJ Store Configuration contract (per the adoption map's own §7 guidance) — e.g. a single `storefront_settings`-style extension point for the first genuinely commerce-owned setting (storefront access on/off is the most self-contained candidate), rather than a broad settings surface in one PR. Do not start on Storefront activate/deactivate, custom-domain management, or multi-store until Safwan makes the explicit product/security decisions each of those requires — they are correctly kept out of both 1A and the default 1B starting point.
