# STORE-ADMIN-ADOPT-1B — First Slice Scope Pass

## Status
READY_FOR_FIRST_SLICE

## Baseline
- Latest `main` at the time of this pass: `e9abd3f82e1d6f51549e796168fb08b6f8eb56f6` — "docs(store): STORE-ADMIN-ADOPT-1A post-provisioning gap pass (#841)" (docs-only).
- PR #841 formally closed `STORE-ADMIN-ADOPT-1A-GAP-PASS.md` with **Status: 1A_COMPLETE**. Not reopened here.
- PR #840 (`COM-STORE-PROVISION-1`, merge SHA `3ef33e615f1f38edf9924206a10cdf71394e88f7`) — merged, deployed, Production-verified. The `Tenant → SalesChannel → Storefront → StorefrontDomain` architecture, secure Host Resolution, and the explicit first-store provisioning flow it introduced are treated as authoritative and are not redesigned by this pass.
- This pass is analysis/scoping only: no migration, no implementation PR, no merge, no deploy.

## Authoritative 1B intent
Derived from `docs/plans/store/AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md` §7 (`STORE-ADMIN-ADOPT-1B — Store Settings / Configuration`) and re-confirmed, unmodified, by `docs/plans/store/STORE-ADMIN-ADOPT-1A-GAP-PASS.md` ("Deferred to 1B" section):

> - Define the smallest explicit AWJ Store Configuration contract.
> - Adapt the useful Spree settings information architecture to AWJ design system and Arabic-first RTL.
> - Introduce only commerce-owned settings with a clear persistence owner.
> - Products, inventory, pricing, customers and accounting remain links/read-only context to AWJ authority.
> - Any DB/API expansion requires a separate tenant-isolation and backward-compatibility review.

The adoption map's capability table (§4) explicitly classifies "Store general settings form" as **ADAPT** ("Strong candidate: name, locale, timezone, storefront access and commerce toggles mapped to AWJ Store settings") and "Store language" as **AWJ-COMMERCE** ("Arabic primary + English; RTL/LTR follows AWJ policy"). `docs/plans/store/AWJ_STORE_LANGUAGE_DECISION.md` independently confirms store default language is meant to come from "إعدادات المتجر/أَوْج" (store/AWJ settings) — i.e. it is documented product intent, not an invented field.

The Gap Pass's own "Recommended next step" suggested "storefront access on/off" as the most self-contained 1B candidate. This task's ticket (§6) explicitly overrides that suggestion: storefront access/active-state must **not** be auto-selected as the first slice because of live-traffic/session/SEO/Host-Resolution risk, and is classified `REQUIRES_PRODUCT_SECURITY_DECISION` below unless a future ticket defines its exact lifecycle semantics. This report follows the ticket's instruction, not the Gap Pass's suggestion.

## Existing Store Configuration surface

**Models / schema (evidence: `app/Models/Storefront.php`, `app/Models/SalesChannel.php`, `app/Models/StorefrontDomain.php`, their migrations)**

| Field | Table | Semantic meaning | Mutable today? | Admin API today? | Commerce Workspace exposure today? |
|---|---|---|---|---|---|
| `storefronts.name` | `storefronts` | Store display name, publicly served by `StorefrontConfigController` | Set only at creation (`ProvisionStorefrontRequest::name`, optional); no update path exists once the store converges | No PUT/PATCH route exists | Read-only, shown in `/commerce/stores` table |
| `storefronts.default_locale` | `storefronts` | Store default display locale (`ar`/`en` per `AWJ_STORE_LANGUAGE_DECISION.md`), publicly served by `StorefrontConfigController` | Hard-coded to `'ar'` everywhere it is set (model default, `StorefrontProvisioningService`, `RegisterStorefrontDomainCommand`); no code path ever writes anything else | No PUT/PATCH route exists | Not surfaced anywhere in the UI |
| `storefronts.is_active` | `storefronts` | Storefront-level active flag (distinct from `sales_channels.is_active`) | Set only at creation (`true`), no update path | No PUT/PATCH route exists | Read-only badge in `/commerce/stores` |
| `storefronts.slug` | `storefronts` | Storefront identifier, `unique(tenant_id, slug)`, used to seed hostname generation via `ManagedStorefrontHostname` | Set only at creation, converges on `'main'` | No PUT/PATCH route exists | Not surfaced |
| `sales_channels.is_active` | `sales_channels` | Whether the commercial channel itself is open; gates `preview_url` computation in `CommerceWorkspaceStorefrontsService` | Set only at creation | No PUT/PATCH route for this field | Read-only, folds into `is_active`/`preview_url` in `/commerce/stores` |
| `sales_channels.default_price_list_id` | `sales_channels` | Pricing authority link | Guarded by a `saving()` invariant (must be an active price list belonging to the active tenant) | No admin route touches this today | Not surfaced |
| `storefront_domains.*` (`hostname`, `type`, `is_primary`, `is_active`, `verification_status`) | `storefront_domains` | Domain routing state, the sole public Tenant/Storefront resolution authority | Written only by `StorefrontProvisioningService`/`RegisterStorefrontDomainCommand`; server-derived only | No admin CRUD/verify route exists | Only exposed indirectly as a computed `preview_url` string |

No branding, logo, theme, SEO, checkout, shipping, or payment-capture columns exist on any Commerce Workspace model. This is by explicit design: `Storefront`'s own docblock states "لا علامة تجارية ولا قالب ولا SEO هنا (أعمدة عمل Store Configuration/Design لاحقة، خارج هذا الجدول صراحةً)" and the `create_storefronts_table` migration repeats the same statement.

**APIs**
- `GET /api/commerce/workspace/storefronts` — tenant-scoped list read, no RBAC beyond a `self_service` block (COM-WS-2, unchanged by #840/#841).
- `POST /api/commerce/workspace/storefronts` — first-store provisioning, `commerce.manage` (owner/admin only).
- `GET /api/store/v1/storefront` (public, Host-resolved via `StorefrontConfigController`) — serves `name` and `default_locale` only, to anonymous storefront visitors. This is the **consumer** of the two fields identified as the strongest 1B candidate below; it is not touched by this proposal, only read from.
- No `PUT`/`PATCH`/`DELETE` route exists anywhere in `routes/api.php` for `Storefront`, `SalesChannel`, or `StorefrontDomain`.
- `tests/Feature/CommerceModuleBoundaryTest.php::ALLOWED_COMMERCE_API_ROUTES` is a hard allowlist of exact commerce URIs (by URI, not by verb — GET/PUT already share one URI for `products/{id}/publication`). Any new commerce route, including a new verb on a new URI such as `commerce/workspace/storefronts/{id}`, must be added to this list or the test fails closed. This is binding evidence that the module boundary is actively enforced, not aspirational.

**UI**
- `web/src/app/(commerce)/commerce/stores/page.tsx` — the only screen that reads store identity today (name, active badge, preview URL). No settings/edit affordance exists.
- `web/src/app/(commerce)/commerce/appearance/page.tsx` — a `CommerceDestinationPage` placeholder ("destination pending"). This is reserved for future branding/theme work (LATER in the adoption map, and explicitly out of scope for this ticket per §5).
- `web/src/app/(commerce)/commerce/domains/page.tsx` — also a placeholder; domain admin visibility was explicitly deferred past 1A in the Gap Pass's matrix ("Full custom-domain read/verify UI... 1B or a dedicated COM-DOMAIN-ADMIN ticket").
- `web/src/modules/commerce-workspace/store-context.tsx` / `stores.ts` — the single trusted client boundary for store data (`CommerceStoreProvider`, `provisionCommerceStorefront`); any new mutation must be added here, not as an ad hoc `fetch`.

## Ownership map

| Setting / field | Authoritative owner | Notes |
|---|---|---|
| Store display name (`storefronts.name`) | `Storefront` (Commerce) | Already the field served to public storefront visitors; genuinely commerce-owned, not ERP tenant identity (`tenants.name` is separate and already used as the pre-Storefront fallback in `StorefrontConfigController`). |
| Store default locale (`storefronts.default_locale`) | `Storefront` (Commerce), constrained by AWJ-wide language policy | Per `AWJ_STORE_LANGUAGE_DECISION.md`, AWJ (not Spree, not a store-invented i18n system) is "مصدر الحقيقة لإعدادات لغة المتجر" — the allowed value set (`ar`, `en`) is an AWJ policy decision, but which one is default for a given store is commerce-owned. |
| Storefront active/inactive, public availability | `Storefront`/`SalesChannel` jointly | Explicitly excluded from this first slice per ticket §6 — classified `REQUIRES_PRODUCT_SECURITY_DECISION` below. |
| Slug / hostname | `Storefront` + `StorefrontDomain`, server-derived | Not a user-editable "setting" today; changing it after go-live is a routing/SEO-breaking operation with its own decision needs (not proposed here). |
| SalesChannel commercial identity/behavior (`is_active`, `default_price_list_id`) | `SalesChannel` (Commerce) | Pricing authority stays with `PriceList`; `SalesChannel` only links to it. Not touched by this slice. |
| Domain routing state | `StorefrontDomain` | Domain admin (verify/add/remove) is its own future workstream (COM-DOMAIN-ADMIN, per Gap Pass), not 1B-1. |
| Products, inventory, pricing, customers, accounting | AWJ ERP authorities (`Product`, stock/valuation services, `Partner`, `LedgerService`) | Never duplicated into Store Configuration, per adoption map §2 and the ticket's non-negotiable boundary. |

## Candidate slices

| Candidate | User value | Existing persistence | New API | Migration | Security complexity | Cross-workstream dependency | Recommended disposition |
|---|---|---|---|---|---|---|---|
| Store identity: edit `name` (+ `default_locale`) on an existing Storefront | High — closes an obvious gap (name is set once at provisioning and can never be corrected/localized since) | Yes (`storefronts.name`, `storefronts.default_locale`) | Yes, one new `PUT` route + tenant-owned single-resource update | No | Low — same ownership pattern as `POST .../storefronts` (`commerce.manage`, tenant-scoped, no client-supplied identifiers) | None active (Host Resolution, public config endpoint only *read* these fields, unaffected by who can write them) | **GOOD_FIRST_SLICE** |
| Storefront active/inactive toggle | High but dangerous | Yes (`storefronts.is_active`, `sales_channels.is_active`) | Yes | No | High — live buyer traffic, Host Resolution, cart/checkout sessions, SEO | Cart/Checkout (active elsewhere) | **REQUIRES_PRODUCT_DECISION** (ticket §6 mandates this classification unless lifecycle semantics are defined elsewhere; none found) |
| Branding / logo | Medium | No | Yes | Yes (new columns/table) | Medium (asset upload/storage) | Appearance is its own visual design direction (`/commerce/appearance` placeholder, LATER in adoption map) | **SEPARATE_WORKSTREAM** |
| Theme/appearance tokens | Medium | No | Yes | Yes | Medium | Same as above — explicitly excluded by ticket §5 | **SEPARATE_WORKSTREAM** |
| SEO settings (meta title/description) | Medium | No | Yes | Yes | Low-medium | None found blocking it technically, but not documented as smallest-slice-worthy; no existing consumer of SEO fields exists yet (no public rendering surface reads them) | **LATER_1B** |
| Static pages / policies | Medium | No | Yes | Yes (content storage) | Medium (safe rendering of merchant content) | Overlaps storefront renderer, which is out of scope here | **SEPARATE_WORKSTREAM** |
| Checkout settings (guest checkout, address requirements) | Medium | No | Yes | Yes | Low as settings-only, but any UI implies a consumer | Checkout is an active parallel workstream (ticket §5) | **SEPARATE_WORKSTREAM** |
| Shipping settings | Medium | No | Yes | Yes | Low as settings-only | Fulfillment/shipment is its own ADR (`ADR-03`) and not yet a settled entity per the adoption map ("Fulfillment / shipment / tracking... Requires real commerce fulfillment entity") | **SEPARATE_WORKSTREAM** |
| Payment-capture settings | Medium | No | Yes | Yes | Higher — touches payment orchestration boundary even as "settings only" | Payments implementation is explicitly active elsewhere (ticket §5) | **SEPARATE_WORKSTREAM** |
| SalesChannel commercial identity edit (name/slug/price list) | Low-medium | Yes (`sales_channels.*`) | Yes | No | Medium — `default_price_list_id` already has a non-trivial `saving()` invariant; editing risks silently changing price resolution for a live channel | Pricing authority (`PriceList`) | **LATER_1B** |

## Recommended first slice

Exactly one:

```
STORE-ADMIN-ADOPT-1B-1 — Store Identity Settings (name + default locale)

Goal: Let an authenticated owner/admin correct/localize the display name and
default locale of their tenant's existing Storefront — the two fields that
are already the sole payload of the public GET /api/store/v1/storefront
endpoint — closing the gap that these are currently write-once at
provisioning time with no correction path.

Persistence owner: Storefront (existing `storefronts.name`,
`storefronts.default_locale` columns).

Existing schema reused: yes — no new column, no new table.

Migration: no.

Backend: exact proposed contract
  PUT /api/commerce/workspace/storefronts/{id}
  Auth: Sanctum, tenant-scoped via TenantContext/SetTenant (unchanged pattern).
  Permission: commerce.manage (same as POST .../storefronts; owner/admin only,
    matches existing Rbac::MATRIX entry — no new permission introduced).
  Path param {id}: resolved via Storefront::query() (TenantScope applies) +
    an explicit tenant_id === TenantContext::id() re-check in the service,
    mirroring the same defense-in-depth pattern CommerceWorkspaceStorefrontsService
    already uses for the list read. A storefront id belonging to another
    tenant, or a non-existent id, returns 404 — never 403 (no existence
    leak), and is never resolved by trusting a client-supplied tenant_id.
  Request body: { "name"?: string (nullable, max:255, matches
    ProvisionStorefrontRequest's existing rule for the same field),
    "default_locale"?: "ar" | "en" }.
    - default_locale validated against a small explicit allow-list (["ar",
      "en"], mirroring AWJ_STORE_LANGUAGE_DECISION.md's two currently
      supported languages) — not a free string, so a typo/garbage locale can
      never silently become the storefront's public default.
    - Both fields optional/independent (a caller may update only one).
    - Empty-string/whitespace-only name rejected the same way the create
      path already treats an empty optional name (falls back to existing
      value, never silently blanks a live public-facing name).
  Response: same shape family as POST's `{ data: { store: {...} } }`,
    re-using CommerceWorkspaceStorefrontsService's existing per-store array
    shape (id, name, sales_channel_id, is_active, preview_url) plus
    default_locale added to that shape for both GET and PUT responses (a
    genuinely new field the workspace list did not previously need to
    return, since it wasn't editable and had no UI use yet).
  No self_service exception needed here beyond the existing role check
    pattern: commerce.manage is already never granted to self_service, so
    the explicit self_service block used by index()/store() is redundant
    for this route but may be kept for defense-in-depth consistency with
    the two existing actions on this controller.

Frontend: exact minimal UI surface
  On the existing web/src/app/(commerce)/commerce/stores/page.tsx table: add
  a "settings" row action (gated on commerce.manage, same hasPermission
  check the page already performs for "إنشاء متجر إلكتروني") that opens a
  small dialog/form with exactly two fields — store name (text input) and
  default language (a 2-option ar/en selector) — Save/Cancel, using the
  project's existing dialog/form primitives and RTL-first layout per
  DESIGN_SYSTEM.md (dense, operational, no decorative treatment). No new
  route/page; no new top-level nav entry. The dialog re-fetches
  (CommerceStoreProvider's existing refresh() pattern) after a successful
  save rather than optimistically mutating local state, matching the
  existing provisionCommerceStorefront() convention.
  New client function in web/src/modules/commerce-workspace/stores.ts,
  e.g. updateCommerceStorefrontIdentity(id, { name?, default_locale? }),
  as the single trusted client for this contract (no ad hoc fetch calls).

Permission: commerce.manage (existing; owner/admin only; not added to
  accountant/staff/self_service).

Tenant boundary: TenantContext-derived only, both for authentication and for
  resolving which Storefront row {id} may refer to. No client-supplied
  tenant_id/storefront_id is ever trusted as authority — only used to look
  up a row that must then independently prove it belongs to the caller's
  tenant, exactly like the existing SalesChannel/Storefront saving()
  invariants and CommerceWorkspaceStorefrontsService's read path already do.

Explicit exclusions:
  - No is_active / storefront-access toggle (REQUIRES_PRODUCT_SECURITY_DECISION,
    per ticket §6 — not this slice).
  - No slug/hostname edit (routing/SEO-breaking; not proposed here).
  - No SalesChannel field edit (default_price_list_id, channel name/slug) —
    LATER_1B.
  - No branding/logo/theme/SEO/static-pages fields — SEPARATE_WORKSTREAM
    (Appearance has its own direction; /commerce/appearance stays a
    placeholder untouched by this slice).
  - No checkout/shipping/payment-capture settings — active parallel
    workstreams, untouched.
  - No multi-store creation and no change to StorefrontProvisioningService's
    "first storefront only" behavior.
  - No new EnsureApplicationActive enforcement on Commerce Workspace routes
    (follows the exact precedent already set for GET/POST
    commerce/workspace/storefronts, which intentionally added none — see
    routes/api.php comment above the existing routes and the Gap Pass's own
    text: "لا إنفاذ EnsureApplicationActive جديد على مسارات مساحة عمل
    Commerce في هذه الدفعة").

Tests required:
  - Backend feature tests (extending the existing
    CommerceWorkspaceStorefrontsApiTest.php or a sibling file):
    - owner/admin can update name and/or default_locale of their own tenant's
      storefront; response reflects the new values.
    - staff/accountant/self_service/guest are all rejected (403/401), mirroring
      StorefrontProvisioningApiSecurityTest.php's existing negative-test style.
    - a storefront id belonging to a different tenant returns 404, never
      leaks existence or another tenant's data (tenant isolation negative
      test, same style as
      "tenant_a_cannot_provision_a_storefront_for_tenant_b").
    - default_locale rejects any value outside ["ar", "en"] (422).
    - name accepts null/omitted (no-op on that field) without blanking an
      existing value; whitespace-only name rejected.
    - GET /api/store/v1/storefront (public, existing StorefrontConfigController)
      reflects an updated name/default_locale after a PUT — proves the public
      consumer path is genuinely wired to the same persisted row, without
      modifying that public controller itself.
  - CommerceModuleBoundaryTest.php: add the new PUT URI to
    ALLOWED_COMMERCE_API_ROUTES (the test fails closed otherwise — this is
    not optional).
  - Frontend: a test for the new dialog/action on
    commerce/stores/page.test.tsx (permission-gated visibility, submit calls
    the new client function, refresh happens on success) and a unit test for
    updateCommerceStorefrontIdentity in stores.ts, following the existing
    test patterns in that directory.
```

## Proposed persistence contract
No new table, no new column. Reuses `storefronts.name` (already `string`, already fillable, already nullable-safe via existing validation precedent) and `storefronts.default_locale` (already `string(10)`, already defaulted to `'ar'`). The only behavioral change is that these two columns become writable after creation, through one new guarded endpoint, instead of being write-once-at-provisioning. Default behavior for any row (new or pre-existing) is unchanged until an owner/admin explicitly calls the new endpoint — no backfill, no default-value migration, nothing to reconcile for tenants that never touch this feature.

## Proposed API contract
See "Recommended first slice → Backend" above for the full contract (route, permission, request/response shape, validation, tenant-boundary handling). No implementation is included in this pass.

## Proposed UI scope
See "Recommended first slice → Frontend" above. Scoped to a small dialog/action on the existing `/commerce/stores` screen; no new page, no new nav entry, no touching `/commerce/appearance` or `/commerce/domains` placeholders.

## Tenant Isolation / RBAC
- **Authenticated ERP admin only**: Sanctum, same as every other Commerce Workspace route.
- **TenantContext authoritative**: identical pattern to `StorefrontProvisioningService`/`CommerceWorkspaceStorefrontsService` — tenant identity is read exclusively from `TenantContext` (set by `SetTenant` from the authenticated user), never from any client-supplied field, header, or Host.
- **Resource ownership check**: the target `Storefront` row must independently prove `tenant_id === TenantContext::id()` after lookup (defense in depth beyond `TenantScope`, matching the existing double-check pattern in `CommerceWorkspaceStorefrontsService::listForCurrentTenant()` and `Storefront::booted()`'s channel-ownership check).
- **No client-supplied tenant_id authority**: request body carries only `name`/`default_locale`; the `{id}` path parameter identifies *which* row to update, not *whose* tenant to act as.
- **Permission**: `commerce.manage`, already defined in `Rbac::MATRIX` for owner/admin only (via the `*` wildcard architecture), not extended to `staff`/`accountant`. This reuses existing repository evidence rather than proposing a new permission, as the ticket requires unless evidence proves otherwise — none was found favoring a different or new permission.
- **`self_service` forbidden**: already structurally impossible via RBAC (`commerce.manage` is never granted to `self_service`); the controller's existing explicit `self_service` block on the other two actions may optionally be mirrored here for consistency, though it is redundant given the RBAC gate.
- **Cross-tenant identifiers fail closed**: a `{id}` from another tenant resolves to "not found" (404), never a silent no-op 200 and never a 403 that would leak existence. This mirrors the "resolved from an unavailable list" pattern already used for `SalesChannel::default_price_list_id` ownership checks.
- **IDOR risk evaluated**: the only path-supplied identifier is the storefront `{id}` itself; without the tenant-ownership re-check this would be a textbook IDOR (any owner/admin of any tenant could rename or relocalize any other tenant's storefront by guessing/enumerating a UUID). The re-check is mandatory and is explicitly called out as a required test case above (`tenant_a_cannot_...`-style negative test), not left implicit.

## Backward Compatibility
- **Existing provisioned stores**: unaffected until an owner/admin explicitly calls the new endpoint; existing `name`/`default_locale` values are untouched by this change (no migration, no backfill).
- **Storefront Host Resolution**: untouched — this slice does not add, remove, or reinterpret any `StorefrontDomain`/hostname logic.
- **Public storefront** (`GET /api/store/v1/storefront`, `StorefrontConfigController`): untouched code-wise; it will simply reflect an updated `name`/`default_locale` the next time it is called after a PUT, which is the intended, documented purpose of those two columns — not a new coupling.
- **`GET /api/commerce/workspace/storefronts`**: response shape gains one additive field (`default_locale`) to each store entry; this is a strictly additive change (existing consumers reading known keys are unaffected — `commerce-workspace-shell.tsx`'s selector/View-Store logic does not need to change).
- **`POST /api/commerce/workspace/storefronts`**: untouched; still create/converge-only, still accepts only an optional `name` at creation time, still never accepts `default_locale` at creation (remains hard-coded `'ar'` at provisioning — this slice only adds a *later* correction path, it does not change what provisioning itself accepts).
- **Commerce Workspace selector / View Store**: unaffected; both already resolve store identity from the same list endpoint being additively extended.
- **Tenants without a Storefront**: unaffected — the new route only ever operates on an existing, resolved `{id}` belonging to the caller's tenant; a tenant with zero storefronts has nothing to update and receives the same "create your first store" empty state as today.

## Dependencies
Explicitly identified parallel workstreams this slice does **not** enter or depend on, per ticket §5 and the adoption map:
- Product Publication (COM-WS-3) — separate workstream, untouched.
- Cart / Checkout / Payments implementation — active elsewhere, untouched; this slice touches neither runtime behavior nor settings for any of these.
- Public/Mobile Commerce API — untouched; only the existing public `GET store/v1/storefront` *consumer* of the two fields is affected, and only by reflecting new values, not by any code change to that controller.
- Storefront visual renderer / App Builder — untouched; no rendering logic depends on `name`/`default_locale` beyond the existing public config endpoint.
- Appearance/branding/theme direction (`/commerce/appearance`) — untouched; this slice is deliberately scoped away from anything visual/theme-related.
- Domain admin (`/commerce/domains`, COM-DOMAIN-ADMIN) — untouched; no `StorefrontDomain` field is read or written by this slice.
- Storefront active/inactive lifecycle — explicitly not entered; left as `REQUIRES_PRODUCT_SECURITY_DECISION` (see Risks/open decisions).

## Explicit exclusions
Restated from the "Recommended first slice" block above: no active/inactive toggle, no slug/hostname edit, no `SalesChannel` field edits, no branding/theme/SEO/static-pages, no checkout/shipping/payment-capture settings, no multi-store creation, no new `EnsureApplicationActive` enforcement on Commerce Workspace routes.

## Migration assessment
Not required. Both fields (`storefronts.name`, `storefronts.default_locale`) already exist, are already `fillable`, and are already the exact payload the public storefront config endpoint serves. The only gap is a missing *write* path after initial provisioning — a pure API/service/UI gap, not a schema gap. This satisfies the ticket's §7 strong preference for a no-migration first slice without misusing any existing field for an unrelated purpose (both fields are used for exactly their documented, pre-existing meaning).

## Required tests for implementation
See the "Tests required" block inside "Recommended first slice" above (backend positive/negative/tenant-isolation/validation cases, the mandatory `CommerceModuleBoundaryTest.php` allowlist update, and frontend permission/wiring tests). Per `CLAUDE.md`'s pre-PR protocol, a full `php artisan test` run (not `--filter`) would be required before any implementation PR — not performed in this analysis-only pass.

## Risks / open decisions
- **Storefront active/inactive / storefront-access toggle** is the most obviously "next" setting after this slice, but per ticket §6 it is deliberately **not** decided here. It requires an explicit product/security decision from Safwan covering: what happens to in-flight buyer sessions/carts/checkouts when a live store is deactivated, whether deactivation is instant or graduated (e.g. a maintenance-mode page vs. a hard 404/blocked Host resolution), and how this interacts with SEO and already-shared storefront links. No repository documentation defines these semantics today (the Gap Pass explicitly flags this same gap and defers it). Recommendation: treat as its own follow-up ticket, not folded into 1B-1 or silently added later inside the same PR.
- **`default_locale` allow-list**: this proposal hard-limits the value set to `["ar", "en"]` to match `AWJ_STORE_LANGUAGE_DECISION.md`'s currently-decided languages. If a future AWJ-wide policy adds a third language, this allow-list must be updated centrally (ideally sourced from one shared list rather than duplicated ad hoc) — flagged here so it isn't silently hardcoded twice later.
- **Redundant `self_service` guard**: the existing controller's explicit `self_service` block on `index()`/`store()` is structurally redundant once `commerce.manage` gates a route (RBAC already excludes `self_service`). This slice's PUT route does not strictly need it, but keeping it for local-file consistency is a minor style choice, not a security question — left to implementation-time judgment.

## Recommended implementation PR
One bounded PR: `STORE-ADMIN-ADOPT-1B-1 — Store Identity Settings (name + default locale)`, containing exactly:
1. One new backend route (`PUT /api/commerce/workspace/storefronts/{id}`), its controller action, a small request-validation class, and the tenant-ownership check in the existing/adjacent service layer.
2. The additive `default_locale` field on the existing list-read response shape.
3. The `CommerceModuleBoundaryTest.php` allowlist update for the new URI.
4. The described backend feature tests (positive, RBAC-negative, tenant-isolation-negative, validation, and public-endpoint-reflects-update).
5. The described minimal frontend settings dialog on `/commerce/stores`, its client function, and its tests.

No other file, model, migration, or route is touched. This is a pure additive, no-migration, single-ownership slice consistent with `STORE-ADMIN-ADOPT-1B`'s documented "smallest explicit... contract... clear persistence owner" intent.

## Git status
- Branch: `main` (this pass made no branch; analysis performed directly against latest `main`).
- Base SHA: `e9abd3f82e1d6f51549e796168fb08b6f8eb56f6`.
- Head SHA: same as base — no commits were made in this worktree. This report was written locally for hand-off; it has not been committed or pushed by this session, per the task's instruction that the outer session commits/pushes it.
