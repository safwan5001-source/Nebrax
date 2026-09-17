# STORE-ADMIN-ADOPT-1B-GAP-PASS-2 — Commerce Workspace / Store Admin — Current-Main Execution Gap Pass

## Status
**READY_FOR_NEXT_SLICE** — Evidence/Gap Pass only. No implementation, no migration, no API/UI change, no merge, no deploy.

## Latest `main` SHA inspected
`706005124cdb0dd4dfd7a24a2bf996e75217281c` — "feat(storefront): honor Storefront.default_locale in Edge Middleware redirect (#850)".

## Confirmed baseline (not re-verified here, per ticket)
- **STORE-ADMIN-ADOPT-1A** — complete and closed (`STORE-ADMIN-ADOPT-1A-GAP-PASS.md`, status `1A_COMPLETE`).
- **COM-STORE-PROVISION-1** — complete, Production-verified (`Tenant → SalesChannel → Storefront → StorefrontDomain → Host resolution`).
- **STORE-ADMIN-ADOPT-1B-1 (Store Identity Settings)** — complete, merged, deployed (PR #846, commit `3185ed72`). `PUT /api/commerce/workspace/storefronts/{id}` mutates `name`/`default_locale`, gated by `commerce.manage`, tenant-isolated (404 not 403 on cross-tenant/unknown id), registered in `CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES`.
- **STORE-LOCALE-WIRING-1** — PR #850 merged and deployed, merge SHA `706005124cdb0dd4dfd7a24a2bf996e75217281c`. Public storefront Edge Middleware now resolves `Storefront.default_locale` for the bare-`/` first-visit redirect, at the precedence `path segment > spree_locale cookie > Storefront.default_locale > Accept-Language > static env fallback`. Its Production smoke test is deliberately deferred — **not touched or re-verified here**, per instruction.

This pass adds no new facts about these four items; it starts from them as ground truth and inspects everything downstream.

## 1. Current State

| Capability | Current State | Evidence | Classification |
|---|---|---|---|
| Store list (selector + `/commerce/stores` table) | Built and Production-verified | `GET commerce/workspace/storefronts`, `commerce-workspace-shell.tsx`, `commerce/stores/page.tsx` | COMPLETE |
| Store identity (name, default_locale) — read + write | Built and Production-verified | `PUT commerce/workspace/storefronts/{id}` (#846), `UpdateStorefrontIdentityRequest`, public `GET store/v1/storefront` reflects it, Edge Middleware honors it (#850) | COMPLETE |
| First-storefront provisioning | Built and Production-verified | `POST commerce/workspace/storefronts`, `StorefrontProvisioningService` | COMPLETE |
| Store lifecycle (activate/deactivate an existing live storefront) | No persistence write path, no API, no UI | `Storefront.is_active`/`sales_channels.is_active` are write-once-at-creation; no `PUT`/`PATCH` route touches either field; flagged `REQUIRES_PRODUCT_SECURITY_DECISION` in both prior gap passes, unchanged | REQUIRES_PRODUCT_DECISION |
| Multi-store (create a 2nd+ storefront per tenant) | Not built by design | `StorefrontProvisioningService` explicitly converges on "first storefront only", fails closed on ambiguity | REQUIRES_PRODUCT_DECISION |
| Storefront access toggle (as a distinct "commerce visible to buyers" setting) | Not built | Same underlying field as lifecycle (`is_active`); no separate contract exists | REQUIRES_PRODUCT_DECISION |
| Store general settings (timezone, other commerce toggles beyond name/locale) | Not built | No fields exist beyond `name`/`default_locale`/`slug`/`is_active` on `Storefront`; no timezone column anywhere in Commerce Workspace models | NOT_IMPLEMENTED |
| AWJ-managed domain visibility | Built (indirect, via `preview_url` only) | `CommerceWorkspaceStorefrontsService` computes `preview_url` from the active+verified `awj_subdomain` domain; no dedicated field-level exposure (hostname/type/verification/is_primary as discrete data) | PARTIAL |
| Custom-domain administration (add/verify/list/remove) | Not built | No `PUT`/`PATCH`/`DELETE`/`POST` route for `StorefrontDomain` anywhere in `routes/api.php`; `StorefrontDomain` is written only by `StorefrontProvisioningService`/`RegisterStorefrontDomainCommand` (server-derived) | NOT_IMPLEMENTED |
| Domain admin screen (`/commerce/domains`) | Placeholder only | `web/src/app/(commerce)/commerce/domains/page.tsx` renders `<CommerceDestinationPage titleKey="domains" />` — a generic "destination pending" component, no data fetch | NOT_IMPLEMENTED |
| Appearance / Branding (logo, colors, typography, theme tokens) | Parallel design workstream exists; zero Store Admin implementation | `AWJ_STOREFRONT_DESIGN_SYSTEM.md` (design spec, "implementation not started"), `AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md` (approved visual direction). No columns on `Storefront`/`SalesChannel` for branding/theme (explicit in the model docblock and migration comment). `/commerce/appearance` is a `CommerceDestinationPage` placeholder | PARALLEL_WORKSTREAM |
| Content (static pages, policies, banners, content blocks) | Not built, no nav entry at all | No route, no model, no nav item — `commerce-workspace-nav.tsx`'s `ICONS` map and `COMMERCE_WORKSPACE_NAV_GROUPS` contain no "content"/"pages"/"policies" destination; overlaps the Page/Section Builder, classified `LATER` in the adoption map | LATER |
| Categories/collections presentation | Not built as a Store Admin concept | Product taxonomy exists in AWJ (`ADAPT` in adoption map for presentation), but no Commerce Workspace screen surfaces it; out of this gap pass's product-publication boundary (COM-WS-3, separate) | NOT_IMPLEMENTED (parallel to COM-WS-3) |
| SEO (store SEO settings, page metadata, sitemap/robots/canonical) | Not built, no nav entry at all | No route, no model column, no nav item anywhere in Commerce Workspace. Storefront's public `name` already feeds `<title>`-adjacent metadata implicitly via the renderer, but no admin-configurable SEO fields exist | NOT_IMPLEMENTED |
| Shipping / Delivery (admin settings) | Placeholder only; no persistence, no contract | `web/src/app/(commerce)/commerce/delivery/page.tsx` is a `CommerceDestinationPage` placeholder. No `Shipment`/`ShippingMethod` model exists anywhere in `app/Models/`. `ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` is Accepted architecture direction only ("no implementation approval") | BLOCKED_BY_DEPENDENCY (Commerce Fulfillment entity, per ADR-03) |
| Integrations (commerce-specific) | Placeholder only; no commerce-specific integration contract exists | `web/src/app/(commerce)/commerce/integrations/page.tsx` is a `CommerceDestinationPage` placeholder. `DeveloperApiClientController` (AWJ Developer Platform / API keys) already exists and is explicitly AWJ-LINK per the adoption map — not to be duplicated | NOT_IMPLEMENTED (screen) / AWJ-LINK (underlying API-key capability) |
| Domain module boundary enforcement | Built and current | `CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES` is a hard allowlist covering exactly the routes above; any new commerce route must be added explicitly or CI fails | COMPLETE (as a guardrail, not a capability) |

## 2. Remaining Store Admin Scope

Stripped of everything already COMPLETE above, what genuinely remains to move Commerce Workspace / Store Admin toward closure, in order of how independently each can be executed:

1. **AWJ-managed domain admin visibility (read)** — expose the already-existing `StorefrontDomain` row(s) (hostname, type, `is_primary`, `is_active`, `verification_status`) as discrete admin-readable data on `/commerce/domains`, instead of only the folded `preview_url` string. This is additive read-only exposure of data that already exists and is already tenant-scoped — no new write authority.
2. **Custom-domain administration (write: add/verify/remove)** — a genuinely new write surface over `StorefrontDomain` for tenant-supplied custom hostnames. Larger and security-sensitive (DNS verification, hostname-uniqueness-across-tenants enforcement already proven in `StorefrontProvisioningService` must be reused, not reinvented).
3. **Storefront lifecycle (activate/deactivate)** — blocked on an explicit product/security decision (live-traffic/session/SEO semantics). Cannot be scoped into a PR slice until that decision exists.
4. **Store general settings expansion (timezone, etc.)** — no concrete field has been requested yet; `LATER` until a specific setting is named with a persistence owner.
5. **Content, SEO, Shipping-settings, commerce-specific Integrations** — each requires either a new persistence owner that does not exist today, or is blocked on a separate workstream (Fulfillment entity for Shipping; Page/Section Builder for Content; no requirement yet for SEO/Integrations screens).

Everything else claimed "remaining" in earlier documents (store identity read/write, provisioning, selector, View Store, tenant isolation tests) is now COMPLETE and must not be re-scoped.

## 3. Dependency Separation

Explicit, so slices below are not silently blocked by parallel work:

- **Cart / Checkout / Payments** — active parallel workstreams (COM-CHECKOUT-1A/1B/1C, Commerce API V1 guest cart). Store Admin's remaining scope (domains, lifecycle, settings) touches none of their code or contracts.
- **Product Publication (COM-WS-3)** — separate, already-shipped screen (`published-products`). Not reopened by any slice below.
- **Fulfillment / Shipment** — `ADR-03` is architecture direction only, no entity exists. Shipping-settings admin is **BLOCKED_BY_DEPENDENCY** on that entity landing first; do not build a settings UI with no runtime consumer.
- **Appearance workstream** — has its own approved design direction and spec docs (`AWJ_STOREFRONT_DESIGN_SYSTEM.md`, `AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md`). Store Admin must not duplicate branding/theme persistence; when that workstream is ready to implement, it defines its own persistence owner and its own slice.
- **Public/Mobile Commerce API** — `commerce/v1/*` routes are untouched by any slice below; domain-admin and lifecycle changes affect only the `commerce/workspace/*` admin surface and (for lifecycle, once decided) Host Resolution behavior, never the mobile/guest-cart contract.
- **App Builder / Page-Section Builder** — `LATER` in the adoption map; Content stays out of scope until that lands, to avoid building a narrow static-pages feature that the builder would later subsume or conflict with.
- **AWJ Developer Platform** — Integrations' underlying capability (API keys) is AWJ-LINK and already exists (`DeveloperApiClientController`); a future Integrations screen in Commerce Workspace would only link/deep-link to it, never fork a parallel credentials subsystem.

## 4. Recommended PR Slices

### STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read)
- **Exact scope:** Replace `/commerce/domains`'s placeholder with a read-only list of the current tenant's `StorefrontDomain` rows for their existing storefront(s): hostname, type (`awj_subdomain`/`custom`), `is_primary`, `is_active`, `verification_status`. Add one new `GET` route.
- **Persistence owner:** `StorefrontDomain` (existing table, existing columns) — no change.
- **API impact:** One new additive `GET` route, e.g. `GET /api/commerce/workspace/storefronts/{id}/domains`. Response is new (list of domain rows), no existing response shape changes.
- **Migration required:** No.
- **UI scope:** `/commerce/domains` gains a real table (reusing `DataTable` per `DESIGN_SYSTEM.md`); no create/verify actions yet.
- **Tenant isolation:** Identical double-check pattern as 1B-1's `update()` — resolve `{id}` via `Storefront::query()` (TenantScope) + explicit `tenant_id === TenantContext::id()` re-check before listing its domains; unknown/cross-tenant id → 404.
- **Security/RBAC:** `commerce.manage` (read of domain routing/verification state is sensitive enough to gate the same as identity write, not open to `self_service`/`staff`/`accountant`) — confirm with product owner if a lower bar (e.g. same-as-`index()`, no RBAC beyond `self_service`) is preferred instead, since this is a read not a write; default to the stricter `commerce.manage` unless told otherwise.
- **Tests required:** Feature test for tenant-scoped read, cross-tenant 404, `CommerceModuleBoundaryTest` allowlist update, frontend table render/empty-state test.
- **Dependencies:** None — pure additive read over existing data.
- **Explicit exclusions:** No add/verify/remove/primary-toggle actions (that is 1B-3). No DNS verification automation.
- **Estimated size:** S.

### STORE-ADMIN-ADOPT-1B-3 — Custom Domain Administration (Write)
- **Exact scope:** Let an owner/admin add a custom hostname for their storefront (creates a `pending` `StorefrontDomain` row), and remove one they added (never the AWJ-managed `awj_subdomain` row, which stays system-owned). Verification-status transition mechanism (manual confirm vs. automated DNS check) is an open product/security decision within this slice's own scoping, not assumed here.
- **Persistence owner:** `StorefrontDomain`.
- **API impact:** New `POST`/`DELETE` routes under `commerce/workspace/storefronts/{id}/domains`.
- **Migration required:** No (schema already supports `type=custom`, `verification_status=pending`).
- **UI scope:** Add-hostname dialog + remove action on the 1B-2 table.
- **Tenant isolation:** Must reuse `StorefrontProvisioningService`'s proven hostname-uniqueness-across-tenants enforcement pattern (`HostnameNormalizer`, global-uniqueness check bypassing `TenantScope` on the collision check only) — do not reinvent.
- **Security/RBAC:** `commerce.manage`. Hostname collision across tenants must fail closed (409), matching existing provisioning behavior. A client can never set `is_primary`, `is_active`, or `verification_status` directly at creation — server-derived only (`pending` always).
- **Tests required:** Positive add/remove, cross-tenant hostname collision (mirroring `a_hostname_collision_with_another_tenant_fails_closed_with_a_conflict`), RBAC negatives, cannot remove the AWJ-managed domain, `CommerceModuleBoundaryTest` update.
- **Dependencies:** Depends only on 1B-2 existing first (needs the list/table to attach actions to); does not depend on Appearance, Fulfillment, or Checkout.
- **Explicit exclusions:** No automated DNS verification pipeline (a genuinely separate, larger security-sensitive piece — flag as its own follow-up if the product owner wants it). No primary-domain switching in this slice unless explicitly requested.
- **Estimated size:** M.

### STORE-ADMIN-ADOPT-1B-4 — Storefront Lifecycle (Activate/Deactivate) — BLOCKED
- **Exact scope:** Cannot be defined yet. Requires an explicit product/security decision from the owner covering: instant vs. graduated deactivation, in-flight cart/checkout/session handling, SEO/link-sharing impact, and whether deactivation touches `Storefront.is_active`, `SalesChannel.is_active`, or both.
- **Persistence owner:** `Storefront`/`SalesChannel` jointly (once decided).
- **API impact:** Unknown until scoped.
- **Migration required:** unknown.
- **Dependencies:** Blocks on a product decision, not on other code.
- **Explicit exclusions:** Not to be folded into 1B-2 or 1B-3.
- **Estimated size:** Unscoped (do not estimate before the decision).

### STORE-ADMIN-ADOPT-1B-5 — Store General Settings Expansion — LATER
- **Exact scope:** No concrete field is currently requested beyond name/locale (already shipped) and lifecycle (blocked above). Timezone or other "commerce toggles" mentioned in the adoption map's original capability table have no named requirement today.
- **Disposition:** Do not create a speculative settings surface. Wait for an explicit next field with a stated persistence owner, exactly as 1B-1 did for name/locale.
- **Estimated size:** N/A until scoped.

### Shipping, Content, SEO, commerce-specific Integrations — not sliced
Each is either `BLOCKED_BY_DEPENDENCY` (Shipping needs a Fulfillment entity per ADR-03), `LATER` (Content overlaps the deferred Page/Section Builder), or has no active product requirement yet (SEO, Integrations screen). Per the adoption map's own classification discipline, no PR slice is proposed for these until a dependency lands or a requirement is stated. This is not silent deferral — it is recorded here explicitly so it is not re-investigated from scratch later.

## 5. TODAY Execution Order

1. **STORE-ADMIN-ADOPT-1B-2 (Domain Visibility — Read)** — independent. No blockers, no dependency on any parallel workstream, smallest safe next step, and it is the only remaining capability inside the Domains area that requires no new product decision.
2. **STORE-ADMIN-ADOPT-1B-3 (Custom Domain Administration — Write)** — depends only on 1B-2 (needs the read surface/table to exist first for its UI actions to attach to; the backend write endpoints could technically ship independently, but shipping write before read in the same screen is poor UX and untestable end-to-end without 1B-2's list).
3. **Stop here.** The next capability after domains — Storefront lifecycle (1B-4) — is explicitly blocked on a product/security decision that only Safwan can make (live-traffic/session/SEO semantics for deactivating a public storefront). Store general settings (1B-5), Shipping, Content, SEO, and commerce-specific Integrations are each blocked on either a named field requirement, a separate workstream landing (Fulfillment entity, Page/Section Builder), or simply have no active requirement yet. None of these should be started today without further scoping or a decision from the owner.

## 6. FIRST SLICE — READY FOR IMPLEMENTATION

```
STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read)

Goal: Replace the `/commerce/domains` placeholder with a real, tenant-scoped,
read-only list of the current tenant's StorefrontDomain rows, so an
owner/admin can see their AWJ-managed subdomain (and, later, any custom
domain) — hostname, type, primary flag, active flag, verification status —
instead of only the folded `preview_url` string the stores list already
shows. This closes the "domain admin visibility" gap explicitly flagged as
OUT_OF_SCOPE by STORE-ADMIN-ADOPT-1A-GAP-PASS.md and not yet started by
STORE-ADMIN-ADOPT-1B-SCOPE-1.md.

Repository scope (exact):
  Backend:
    - New route: GET /api/commerce/workspace/storefronts/{id}/domains
      Registered in routes/api.php immediately after the existing
      `commerce/workspace/storefronts/{id}` PUT route, inside the same
      route group/middleware stack (Sanctum auth, same pattern as the
      other three commerce/workspace/storefronts routes).
    - New controller action on CommerceWorkspaceStorefrontsController
      (e.g. `domains(Request $request, CommerceWorkspaceStorefrontsService
      $storefronts, string $id)`), OR a new
      CommerceWorkspaceStorefrontDomainsController if the existing
      controller is judged too large — implementer's judgment, but prefer
      the existing controller unless it already exceeds this codebase's
      normal file-size/readability convention (check neighboring
      controllers for precedent before deciding).
    - New method on CommerceWorkspaceStorefrontsService (or a small
      sibling service, e.g. CommerceWorkspaceStorefrontDomainsService)
      that: resolves the Storefront by {id} via `Storefront::query()`
      (TenantScope applies) + an explicit `tenant_id ===
      TenantContext::id()` re-check (mirroring the exact pattern already
      used in `update()`'s resolution and in
      `CommerceWorkspaceStorefrontsService::listForCurrentTenant()`);
      unknown id or cross-tenant id -> 404 (never 403, never a leak);
      then returns that Storefront's `storefront_domains` rows mapped to
      `{ id, hostname, type, is_primary, is_active, verification_status }`
      — no other fields, no raw internal columns beyond these five plus
      `id`.
    - Response shape: `{ "data": { "domains": [ {...}, ... ] } }`,
      following the same `{ data: {...} }` envelope convention already
      used by `index()`/`store()`/`update()` on this controller.

  Frontend:
    - web/src/app/(commerce)/commerce/domains/page.tsx: replace the
      `<CommerceDestinationPage titleKey="domains" />` placeholder with a
      real page using this project's existing `DataTable` component
      (per DESIGN_SYSTEM.md — dense, table-first, RTL). Columns: hostname,
      type (طبق تسمية أَوْج / مخصَّص), primary badge, active badge,
      verification-status badge. Loading/error/empty states follow the
      exact pattern already used in `commerce/stores/page.tsx`.
    - New client function in web/src/modules/commerce-workspace/
      (e.g. stores.ts or a new domains.ts sibling, following the existing
      single-trusted-client convention) — e.g.
      `fetchCommerceStorefrontDomains(storefrontId)`.
    - If the tenant has zero storefronts (no store provisioned yet), this
      page must render the same "no store yet" empty-state pattern already
      established elsewhere in Commerce Workspace, not a domains-specific
      empty state that duplicates that message.
    - If the tenant has exactly one storefront (the only case
      StorefrontProvisioningService supports today), the page needs no
      store-selector UI of its own — it can resolve the single active
      store from CommerceStoreProvider's existing context, the same way
      commerce-workspace-shell.tsx already does for View Store.

Contracts to reuse (do not reinvent):
  - TenantContext-derived tenant identity (never client-supplied).
  - The exact ownership-recheck pattern from
    CommerceWorkspaceStorefrontsController::update() /
    CommerceWorkspaceStorefrontsService (404-not-403 on cross-tenant/
    unknown id).
  - CommerceStoreProvider / store-context.tsx as the single trusted
    frontend store-identity source.
  - DataTable component and DESIGN_SYSTEM.md table conventions.

Prohibited changes:
  - No write route (POST/PUT/PATCH/DELETE) on StorefrontDomain — read
    only, this slice.
  - No change to StorefrontProvisioningService, ManagedStorefrontHostname,
    or ResolveStorefrontDomain — this slice only reads existing rows, it
    does not touch how they are created or how Host resolution works.
  - No change to the public GET /api/store/v1/storefront contract or the
    storefront/ Next.js app (STORE-LOCALE-WIRING-1's territory) —
    out of scope entirely.
  - No branding/theme/SEO/checkout/shipping/payment fields.
  - No multi-store assumptions beyond what already exists (the endpoint
    is per-storefront-id, so it is naturally multi-store-ready even
    though only one storefront exists per tenant today — do not add a
    "pick a store" UI beyond what CommerceStoreProvider already offers).

API contract:
  GET /api/commerce/workspace/storefronts/{id}/domains
  Auth: Sanctum (existing middleware group).
  Permission: commerce.manage (owner/admin only — same as the existing
    PUT route on this controller; do not use the weaker `self_service`-
    only exclusion that `index()` uses, since domain/verification state
    is more sensitive than the basic store list).
  Path param {id}: Storefront id, resolved and tenant-checked as
    described above. Unknown/cross-tenant -> 404 JSON error, standard
    Laravel abort(404, ...) shape already used elsewhere in this
    controller/service.
  Response 200: { "data": { "domains": [ { "id": uuid, "hostname":
    string, "type": "awj_subdomain"|"custom", "is_primary": bool,
    "is_active": bool, "verification_status":
    "pending"|"verified"|"failed" }, ... ] } }
    (empty array, not 404, if the storefront exists but somehow has zero
    domain rows — should not happen in practice since provisioning always
    creates one, but the contract must not error on it).

DB ownership: StorefrontDomain (existing table/columns, no migration).

Authorization: commerce.manage via Rbac::MATRIX (existing, owner/admin
  only) — no new permission introduced.

Tenant Isolation: Sanctum + TenantContext-derived tenant identity;
  explicit tenant_id re-check on the resolved Storefront before listing
  its domains; StorefrontDomain rows are then trivially scoped because
  they belong to that already-verified-owned Storefront (no separate
  cross-check needed on the domain rows themselves, since they are
  fetched via the Storefront relation, not by a client-supplied domain
  id).

Backward compatibility: Strictly additive — new route, new response
  shape, no change to any existing endpoint's contract. Existing
  `preview_url` computation in CommerceWorkspaceStorefrontsService is
  untouched.

Focused tests required:
  - Backend: owner/admin can list their own tenant's storefront domains
    and gets the expected shape; staff/accountant/self_service/guest are
    rejected; a storefront id belonging to another tenant returns 404
    (tenant-isolation negative test, same style as
    `tenant_a_cannot_provision_a_storefront_for_tenant_b`); an unknown id
    returns 404; response includes exactly one `awj_subdomain` row for a
    freshly provisioned storefront with no custom domains added.
  - CommerceModuleBoundaryTest.php: add the new GET URI to
    ALLOWED_COMMERCE_API_ROUTES — mandatory, the test fails closed
    otherwise.
  - Frontend: page.test.tsx-style test for domains/page.tsx covering
    loading/empty/ready/error states and the table rendering the
    expected columns; a unit test for the new client fetch function.

Frontend behavior:
  - Table-first, RTL, dense — no decorative treatment, per
    DESIGN_SYSTEM.md.
  - No actions in this slice (no add/remove/verify buttons) — pure
    display. A future 1B-3 PR adds those on top of this table.

Acceptance criteria:
  - GET .../storefronts/{id}/domains returns the correct domain list for
    the caller's own tenant's storefront, and 404 for any other tenant's
    id or an unknown id.
  - commerce.manage is required; staff/accountant/self_service/guest are
    rejected.
  - CommerceModuleBoundaryTest passes with the new route added to the
    allowlist.
  - /commerce/domains renders real domain data instead of the
    CommerceDestinationPage placeholder, matching loading/empty/error/
    ready states already established elsewhere in Commerce Workspace.
  - `php artisan test` (full suite, not --filter) passes.
  - `npm run build` in web/ succeeds.
  - No accounting entries are generated by this slice (it has none —
    confirm no LedgerService call was introduced, since this PR touches
    no financial data at all).

Stop conditions (do not proceed past these without asking):
  - If StorefrontDomain ever needs a field not already on the table to
    satisfy this contract — stop, this slice was scoped as "existing
    schema only."
  - If a tenant is found (in code, not assumed) to be able to have more
    than one Storefront today — stop and confirm the multi-store
    assumption before building any store-selection UI beyond what
    CommerceStoreProvider already provides, since
    StorefrontProvisioningService's "first storefront only" convergence
    is treated here as still authoritative.
  - If implementing this reveals that domain data is more naturally
    exposed by extending the existing `GET commerce/workspace/
    storefronts` list response instead of a new nested route — stop and
    confirm with the product owner before choosing that shape instead,
    since it changes an existing, already-consumed response contract
    (additive field is fine per 1B-1's precedent, but a new nested
    array on every list item is a bigger shape change than this slice
    was scoped for).
```

## 7. Files changed (this Gap Pass)
- `docs/plans/store/STORE_ADMIN_ADOPT_1B_GAP_PASS_2.md` (new — this report).

No application code, migration, route, or test file was touched.

## 8. Tests / checks performed
Evidence-based inspection only (no test execution required — no code changed):
- `routes/api.php` (`commerce/workspace/storefronts*` routes and middleware).
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php` (index/store/update).
- `app/Models/StorefrontDomain.php`, `app/Models/Storefront.php`.
- `tests/Feature/CommerceModuleBoundaryTest.php` (`ALLOWED_COMMERCE_API_ROUTES`, current 8 entries).
- `web/src/app/(commerce)/commerce/*/page.tsx` (all six destination screens: stores, published-products, appearance, domains, delivery, integrations).
- `web/src/components/commerce-workspace/commerce-workspace-nav.tsx` (confirms no Content/SEO nav entry exists at all).
- `docs/plans/store/AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md`, `STORE-ADMIN-ADOPT-1A-GAP-PASS.md`, `STORE-ADMIN-ADOPT-1B-SCOPE-1.md`, `STORE_LOCALE_WIRING_1_SCOPE_REPORT.md` (existing evidence, reused per ticket instruction, not re-derived from Spree).
- `docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md`, `AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md` (confirms Appearance's parallel workstream status).
- `docs/plans/store/ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` (confirms Shipping's dependency on an unbuilt Fulfillment entity — "Accepted — Architecture Direction... no implementation approval").
- `app/Http/Controllers/Api/DeveloperApiClientController.php` existence check (confirms Integrations' underlying AWJ-LINK capability already exists, no duplicate needed).
- `git log` on `docs/plans/store/`, `routes/api.php`, `app/Services/Commerce/`, `web/src/app/(commerce)` to confirm the exact chain of merged PRs (#840, #841, #843, #846, #849, #850) and that nothing has landed between #850 and current `main` for Commerce Workspace.

No classification in `AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md` §4 was changed. No new repository evidence surfaced that contradicts any existing classification there.

## 9. Risks / unresolved product decisions
- **Storefront lifecycle (activate/deactivate)** — genuinely unresolved; requires the owner's decision on live-traffic/session/SEO semantics before any slice can be scoped (restated from both prior gap passes, still true today).
- **1B-2's RBAC level for domain read** — this pass recommends `commerce.manage` (stricter than `index()`'s bare `self_service`-block) because verification/hostname state is more sensitive than the basic store list, but this is a judgment call worth a quick confirmation, not a blocking decision.
- **1B-3's verification mechanism** (manual vs. automated DNS check) is intentionally left unscoped inside its own slice description — it needs its own decision before implementation, not before 1B-2.
- **Multi-store** remains an explicit open product question (not addressed by any slice here) — every slice above is written to hold even if/when that changes, without assuming it won't.

## 10. Branch / PR
- **Branch:** `docs/store-admin-adopt-1b-gap-pass-2`
- **Base SHA:** `706005124cdb0dd4dfd7a24a2bf996e75217281c`
- **Head SHA:** (recorded after commit, see PR)
- **PR:** docs-only, ready for review (not draft) — see PR link in the hand-off message.

## 11. Exact next action
Hand `STORE-ADMIN-ADOPT-1B-2 — Domain Visibility (Read)` (§6 above) directly to a coding agent. It is fully scoped, requires no further Evidence Pass, and has no open product decision blocking it.
