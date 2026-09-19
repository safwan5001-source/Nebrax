# STORE-ADMIN-LIFECYCLE-VERIFY-1 — Store Lifecycle Repository Evidence & Implementation Scoping

## Status

**CASE B — Small lifecycle implementation required.**

Merchants cannot activate, deactivate, or re-activate a hosted storefront today. The schema, public fail-closed resolver, and admin identity/domain surfaces already exist. What is missing is a storefront-scoped write path for `Storefront.is_active` plus a truthful admin list/UI.

This is not CASE A: `is_active` is write-once at provisioning (except an implicit re-activate inside `StorefrontProvisioningService`), Identity PUT refuses it, GET list omits inactive rows and hard-codes `is_active: true`, and the `/commerce/stores` badge is cosmetic.

This is not CASE C: `Storefront.is_active` semantics are unambiguous, the public resolver already fails closed, SalesChannel coupling can be determined safely as **DO NOT COUPLE**, accounting/inventory have no current coupling, and no schema change is required.

Stop conditions from the ticket were evaluated and **not hit**. See [Risks](#risks).

---

## Repository Baseline

| Item | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Default branch | `main` |
| Latest `main` SHA at inspection | `50e66740b5e7757edd30e3dd7ae2304d8b9f325f` |
| Latest `main` subject | `feat(store): AWJ store customer account experience (STORE-UI-5) (#868)` |
| CUSTOM-DOMAIN-EDGE-3 / PR #870 merge SHA | `31db0857dd10a7f365e42bee41a64ca8f211b6a4` |
| EDGE-3 in ancestry of latest `main` | **Yes** (`git merge-base --is-ancestor 31db0857… HEAD` succeeded). EDGE-3 is the parent of STORE-UI-5. |

Confirmed prior Store Admin work **not reopened** here:

- Storefront provisioning (`COM-STORE-PROVISION-1`)
- Store Identity Settings (`STORE-ADMIN-ADOPT-1B-1`)
- Domain Visibility / custom domain lifecycle (`1B-2`, `1B-3A`, `1B-3B`)
- Railway Edge foundation + activation UX + live-ready Make Primary + provider-first Disconnect (`CUSTOM-DOMAIN-EDGE-1/2/3`)

Custom Domain production Railway setup/deployment remains **deferred** and is out of this pass.

Earlier gap passes (`STORE-ADMIN-ADOPT-1B-SCOPE-1.md`, `STORE_ADMIN_ADOPT_1B_GAP_PASS_2.md`) classified storefront access as `REQUIRES_PRODUCT_DECISION` / blocked `1B-4`. This document is that decision, derived from current `main` code rather than from those older snapshots.

---

## Current Storefront Model

**Authority:** `app/Models/Storefront.php`, migration `database/migrations/2026_09_20_010000_create_storefronts_table.php`, architecture `docs/plans/store/AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md` §1–2.

`Storefront` is a tenant-owned hosted storefront, **separate from** `SalesChannel`. Columns: `id`, `tenant_id`, `sales_channel_id`, `slug`, `name`, `is_active` (boolean, default `true`), `default_locale` (default `ar`), timestamps, soft deletes. `unique(tenant_id, slug)`.

`Storefront::booted()` requires the linked channel to be same-tenant and `type = web`. It does **not** require the channel to be active at save time.

### `Storefront.is_active` — current writers

| Writer | What it does |
|---|---|
| Model default / `Storefront::create` | Defaults `true`. Provisioning creates `'is_active' => true`. |
| `StorefrontProvisioningService::ensureStorefront()` | If a compatible storefront already exists and is inactive, **re-activates it** (`update(['is_active' => true])`). Test: `StorefrontProvisioningServiceTest::provisioning_reactivates_an_existing_inactive_compatible_storefront_instead_of_duplicating`. |
| `RegisterStorefrontDomainCommand` | Same re-activate-if-inactive converge (CLI, not HTTP). |
| Tests | Feature tests force-fill `false` to prove fail-closed public/publication behavior. |
| Identity PUT | **Cannot write it.** `UpdateStorefrontIdentityRequest` accepts only `name` / `default_locale`. `CommerceWorkspaceStorefrontsService::updateIdentityForCurrentTenant()` documents “لا `is_active`”. Test `the_client_cannot_mutate_protected_storefront_fields` sends `is_active: false` and asserts the row stays `true`. |
| Domain / Edge APIs | Do not write `Storefront.is_active`. |

There is **no** merchant Activate/Deactivate API.

### `Storefront.is_active` — current readers / runtime

| Consumer | Behavior when `false` |
|---|---|
| `ResolveStorefrontDomain` | 404, non-revealing. Query: `Storefront::query()->whereKey(...)->where('is_active', true)`. |
| `CommerceWorkspaceStorefrontsService::listForCurrentTenant()` | Row **omitted**. Query filters `where('is_active', true)` then hard-codes `'is_active' => true` in JSON. Test: `inactive_storefronts_are_omitted`. |
| Identity PUT presenter | Hard-codes `'is_active' => true` even if the row were inactive (PUT itself does not filter on `is_active`). |
| `CommerceProductPublicationService::webStorefronts()` | Inactive storefronts are not publishable. GET publication returns `stores: []`; PUT with that id is 422. Test: `inactive_store_or_channel_is_not_publishable`. Existing `CommerceListing` rows are **not deleted**. |
| Domain list / verify / make-primary / disconnect / edge | Resolve the storefront by id + tenant only — **do not** require `Storefront.is_active`. Domain admin still works on an inactive storefront. |
| Public `StorefrontConfigController` | Never reached: middleware 404s first. |

---

## Current SalesChannel Semantics

**Authority:** `app/Models/SalesChannel.php`, ADR-03, COM-7-P2 §1, `MobileSalesChannelResolver`.

`SalesChannel` is the **commercial origin** of a sale (`web` / `mobile` / `pos` / `external`). It is not a hosted store. Company-wide, no `branch_id` / `warehouse_id`. `is_active` defaults `true`.

A Storefront may bind only to `type = web`. Mobile commerce resolves a **different** `TYPE_MOBILE` row and never has a Storefront (`Storefront::booted()` rejects non-web). POS payment availability is `TYPE_POS`. Fulfillment policy, `CommerceListing`, `CommerceCart`, `CommerceCheckout`, and `CommerceOrder` all key off `sales_channel_id`.

### `SalesChannel.is_active` — current writers

Set at creation (`true`) by provisioning / `EnsureWebSalesChannelCommand`. **No admin HTTP write path** for this field. Tests force-fill `false` to prove resolver/list behavior.

Provisioning **refuses** to auto-fix an existing `slug=web` row that is inactive or non-web (`RuntimeException` / 422). It does not flip channel `is_active`.

### `SalesChannel.is_active` — current readers / runtime

| Consumer | Behavior when web channel `is_active = false` |
|---|---|
| `ResolveStorefrontDomain` | 404 even if Storefront and Domain are active. Test: `an_inactive_sales_channel_fails_closed`. |
| `ResolveStorefrontTenant` (dev-only, production-blocked) | No public context without an active web channel. |
| `ResolveCommerceChannel` / `MobileSalesChannelResolver` | Look at **mobile** `is_active`, not web. Independent row. |
| Workspace list | Store **remains listed**; `preview_url` becomes `null`. Test: `an_inactive_web_channel_keeps_the_store_but_clears_preview_url`. Hard-coded store `is_active: true` still. |
| Publication | Inactive channel storefronts excluded (`whereHas salesChannel is_active true`). |
| `CommercePriceResolver` | Resolves via `SalesChannel.default_price_list_id`. It checks **PriceList** `is_active`, not channel `is_active`. An inactive web channel can still be a pricing authority if some other caller passes its id. |
| Cart / Checkout services | Gate on **Product** `is_active` + published `CommerceListing` for the already-resolved channel. They do not re-check channel/storefront flags; public HTTP never reaches them when the resolver 404s. |
| POS / payments / fulfillment | Typed to other channel types or to `sales_channel_id` as a commercial key. Not hosted-storefront serving. |

**Conclusion:** `SalesChannel.is_active` is a **channel-open** flag for that commercial type. It is not “store is live for buyers”. The same web channel is also publication, pricing, cart, checkout, order, and fulfillment identity. Flipping it for store UX would have uncertain cross-module effects. See [SalesChannel Coupling Decision](#saleschannel-coupling-decision).

---

## Current StorefrontDomain Semantics

**Authority:** `app/Models/StorefrontDomain.php`, COM-7-P2 §3–7, EDGE-1/2/3 reports.

`StorefrontDomain` is the **sole production Host → Tenant/Storefront authority**. Global unique `hostname`. `is_active` defaults `true`. Public resolution also requires `verification_status = verified` (`isVerified()`). `is_primary` is exclusive per storefront among active primaries (partial unique index on `is_primary = true AND is_active = true`).

`is_active` here means **this hostname is eligible to resolve**, not “the store is on/off”.

### `StorefrontDomain.is_active` — current writers

| Writer | Behavior |
|---|---|
| Provisioning | Creates AWJ-managed domain `is_active = true`, `verified` immediately. Re-provision **re-activates** an existing matching AWJ domain if inactive/unverified. |
| Add custom domain | Creates `custom` with `is_active = true`, `pending`. |
| EDGE-3 Disconnect | **Temporarily** sets `is_active = false` as a Make-Primary fence, then deletes the row after provider `release()`. Restore `is_active = true` on 503. This is domain disconnect, not store deactivation. |
| Make Primary | Requires the domain `is_active` (and verified; custom also needs live Railway `ready`). Does not write storefront lifecycle. |
| Edge activate | Requires domain `isVerified()` **and** `is_active`. |

No Store Admin path turns a domain off as a substitute for store deactivation. Disconnect **deletes** a non-primary custom row. That must not be reused as “Deactivate Store”.

### `StorefrontDomain.is_active` — current readers / runtime

| Consumer | Behavior when domain `is_active = false` |
|---|---|
| `ResolveStorefrontDomain` | 404 before Storefront/Channel checks. Test: `an_inactive_domain_fails_closed`. |
| Workspace `preview_url` | Hostname omitted; store still listed if storefront is active. |
| Make Primary / Edge activate | 422 not eligible. |
| Domain list (1B-2) | Still returns the row with `is_active: false`. |

---

## Public Runtime Behavior

Production public path (`routes/api_storefront.php`, all `store/v1` routes):

```text
Host (or X-Storefront-Forwarded-Host + gateway secret)
  → HostnameNormalizer
  → StorefrontDomain by hostname
  → domain.is_active AND domain.isVerified()
  → TenantContext from domain.tenant_id
  → Storefront by id AND storefront.is_active
  → SalesChannel by storefront.sales_channel_id AND type=web AND channel.is_active
  → StorefrontContext
```

Any failed step: unified 404 `"تعذّر تحديد متجر صالح."` TenantContext forgotten. **Fail closed, non-revealing.**

Covered public surfaces on this middleware: categories, products, **media**, storefront config, **cart**, **checkout** (including complete). There is no public catalog/media/cart/checkout path that bypasses `ResolveStorefrontDomain` in production. The `{tenantSlug}` legacy group is not registered in `production` and `ResolveStorefrontTenant` additionally 404s there.

`commerce/v1/*` is **mobile** (`ResolveCommerceChannel` → `TYPE_MOBILE`). It does not use `Storefront.is_active`. Store deactivation must not be assumed to turn mobile off.

### Evidence matrix

Public `store/v1/*` (production resolver). “Serves” means the request is allowed past middleware; catalog still requires product `is_active` + published listing.

| Storefront | Web SalesChannel | Domain (active+verified) | Public `store/v1` | Workspace list today | `preview_url` today |
|---|---|---|---|---|---|
| active | active | active+verified | Serves | Listed, `is_active` JSON forced `true` | https URL |
| **inactive** | active | active+verified | **404** (`an_inactive_storefront_fails_closed`) | **Omitted** | n/a |
| active | **inactive** | active+verified | **404** (`an_inactive_sales_channel_fails_closed`) | Listed | `null` |
| active | active | **inactive** | **404** (`an_inactive_domain_fails_closed`) | Listed | `null` |
| active | active | unverified / failed | **404** | Listed | `null` |
| inactive | inactive | inactive | **404** | Omitted | n/a |
| inactive | active | inactive | **404** | Omitted | n/a |

Combinations fail closed at the first failing hop. Inactive storefront is sufficient to 404 even when domain and channel remain fully live.

**Inactive storefronts fail closed today.** No public API, catalog, media, cart, checkout, or storefront config remains accessible through the production Host path once `Storefront.is_active = false`. Do **not** modify the resolver for V1; it already implements the desired serving contract.

---

## Current Commerce Workspace Behavior

| Question | Answer | Evidence |
|---|---|---|
| Do inactive storefronts appear in Store Admin? | **No.** GET list omits them. | `listForCurrentTenant()` `where('is_active', true)`; `inactive_storefronts_are_omitted` |
| Can merchants modify `is_active`? | **No** dedicated API. Identity PUT ignores it. Provisioning POST will re-activate a compatible inactive first store. | Identity test; provisioning re-activate test |
| Does provisioning always create active stores? | **Yes.** Channel `true`, storefront `true`, AWJ domain `true` + `verified`. | `StorefrontProvisioningService` |
| Do GET storefront APIs expose lifecycle state? | Field exists but is **not truthful** for inactive rows (they are hidden; remaining rows hard-code `true`). | Presenter `'is_active' => true` |
| Can Identity PUT modify lifecycle? | **No.** | `UpdateStorefrontIdentityRequest`; protected-fields test |
| Frontend lifecycle controls? | Status badge Active/Inactive exists (`storesListActive` / `storesListInactive`) but listed stores are always Active. **No** Activate/Deactivate action, dialog, or copy. Domain “Activate” is Railway edge, not store lifecycle. | `web/src/app/(commerce)/commerce/stores/page.tsx`, `messages.ts`, `domains.ts` |
| Is the badge authoritative? | **Cosmetic.** It reads `isActive` from JSON that cannot currently be `false`. | list filter + hard-code |

Staff without `commerce.manage` can still GET the list (COM-WS-2). They would see a truthful badge after the list change, but must not get Activate/Deactivate buttons.

---

## Current RBAC / Tenant Isolation

Expected starting point is confirmed by current identity/provisioning/domain write routes.

| Actor | Identity PUT / Provision / Domain writes today | Required for lifecycle writes |
|---|---|---|
| Guest | 401 | 401 |
| `self_service` | 403 (controller + `commerce.manage` middleware) | 403 |
| Staff / accountant without `commerce.manage` | 403 | 403 |
| Cross-tenant storefront id | 404, non-revealing | 404 |
| Unknown storefront id | 404 | 404 |
| Owner / admin (`commerce.manage` via `*`) | 200/201 | 200 |

`commerce.manage` is in `Rbac::MATRIX` for owner/admin via `*`, **not** granted to accountant/staff/self_service.

Tenant authority is `SetTenant` → `TenantContext` only. Path `{id}` is a selector, never tenant authority. Same defense-in-depth as identity: `Storefront::query()` (TenantScope) + explicit `tenant_id === TenantContext::id()`.

GET list stays as today (no `commerce.manage`; self_service 403). Lifecycle writes match Identity PUT: `commerce.manage`.

---

## Provisioning Behavior

`POST /api/commerce/workspace/storefronts` (`StorefrontProvisioningService`):

- Explicit only (not on login/dashboard).
- Converges to one web channel + one `slug=main` storefront + one AWJ-managed hostname.
- **New store:** all three `is_active = true`; AWJ domain `verified` immediately; `is_primary` if no other active primary.
- **Re-call:** re-activates an inactive compatible storefront; re-activates/re-verifies matching AWJ domain; does **not** flip an inactive `slug=web` channel (fails closed).
- Locks `tenants` row then storefront/channel/domain rows.

**V1 decision:** keep provisioning semantics. Changing “provision re-activates” is out of scope. Dedicated Activate/Deactivate is the merchant control; POST provision remaining “ensure first storefront exists and is active” is backward compatible.

Newly provisioned stores stay **active immediately**. Lifecycle does not introduce draft/inactive-at-create.

---

## Deactivation Semantics

### Recommended V1 contract

**Deactivate Store** means:

```text
Storefront.is_active = false
```

and nothing else.

Public serving stops because `ResolveStorefrontDomain` already requires an active Storefront. Customers cannot browse, load media, mutate cart, or checkout on that host. Admin Commerce Workspace, identity, domains, edge, publication rows, orders, and accounting remain.

This is option **A** for domains: leave domains active/verified/primary/edge-bound; block serving through the inactive Storefront.

### Why this contract (repository-supported)

1. COM-7-P2 already defined `Storefront.is_active` as hosted-store serving, distinct from channel and domain flags.
2. The resolver already implements fail-closed on that flag (`StorefrontDomainResolutionApiTest::an_inactive_storefront_fails_closed`).
3. Schema already has the column (default `true`). No migration.
4. Domain `is_active` is a hostname eligibility / disconnect fence (EDGE-3). Mutating it would look like domain deletion-prep and fight Make Primary / Edge.
5. SalesChannel `is_active` is shared commercial identity (publication, pricing, mobile sibling types, fulfillment). See coupling decision.
6. Reversible: flipping the boolean back restores serving iff domain+channel still pass their own checks.

### What Deactivate Store does **not** mean in V1

- Not domain disconnect or deletion.
- Not clearing verification, primary, Railway provider id, DNS instructions, or TLS state.
- Not deactivating the web SalesChannel.
- Not unpublishing products, cancelling carts/checkouts/orders, or touching Invoice/payments/journals/inventory.
- Not closing POS, mobile, or external channels.
- Not a tenant-global kill switch.

---

## Reactivation Semantics

**Activate Store** means:

```text
Storefront.is_active = true
```

That is sufficient to restore public serving **when** the existing resolver chain is already healthy (active verified domain + active web channel). If a domain or channel is independently unhealthy, public stays 404 — correct fail-closed, not an Activate bug.

### Prerequisites that must **not** block V1 Activate

| Candidate gate | Verdict |
|---|---|
| Active web SalesChannel | Do not require in the Activate API. Resolver still 404s if the channel is down. Forcing channel repair here would couple lifecycle to channel admin that does not exist. |
| Valid primary domain | Do not require. Resolver does **not** require `is_primary` (COM-7-P2 / 1B-3B). |
| Verified domain | Do not require. Public already 404s without it. |
| Railway / `edge.status = ready` | **Must not require.** AWJ-managed stores have `edge = null` and must Activate without Railway. Custom-domain HTTPS is EDGE, not store lifecycle. |

Idempotent: Activate on an already-active row returns 200 with the same store payload. Deactivate on an already-inactive row likewise.

---

## Data Preservation

Deactivate / Activate must not change:

| Data | Evidence it is independent of `Storefront.is_active` |
|---|---|
| Identity (`name`, `default_locale`, `slug`) | Identity PUT writes name/locale only; slug is provisioning-owned |
| SalesChannel relationship | `sales_channel_id` untouched; model booted() still enforces web+same-tenant |
| Domains, primary, verification, tokens, `verified_at` | Domain services do not write storefront flags; deactivate must not call them |
| Edge/TLS (`edge_status`, provider id, DNS instructions, ready/checked timestamps) | EDGE-1/3 only |
| Theme / appearance (future) | No columns on Storefront today |
| Published products | `CommerceListing` keyed by `sales_channel_id`; publication **filters** inactive storefronts out of the chooser but does not delete listings |
| CommerceOrder / checkout / cart rows | Persist with `storefront_id` / `sales_channel_id`; public mutations 404 via resolver |
| Customer/cart tokens | Unreachable publicly while inactive; not purged |

Lifecycle is reversible and non-destructive.

---

## Domain / Edge Preservation

Prefer reversible semantics. **Do not mutate `StorefrontDomain.is_active` on store deactivate.**

EDGE-3 already uses domain `is_active = false` as a temporary Disconnect↔Make-Primary fence, then deletes the row. Reusing that flag for store-off would:

- make custom Make Primary 422 while the store is “paused”,
- block Edge activate,
- collide with Disconnect restore-on-503,
- look like domain teardown.

Store deactivation is **not** domain deletion. AWJ-managed domains stay. Custom domains stay. Primary stays. Verification stays. Railway binding stays.

---

## SalesChannel Coupling Decision

**DO NOT COUPLE.**

Repository evidence:

1. COM-7-P2 §1: SalesChannel is commercial origin; it “must not be overloaded with hosted-store concerns”.
2. `Storefront` is the hosted serving entity; its `is_active` already gates the public Host path.
3. The same `SalesChannel` type system serves **web, mobile, POS, external**. Mobile resolution is a different row and “decoupled from Storefront/host resolution entirely” (`MobileSalesChannelResolver`).
4. `CommerceListing`, `CommerceCart`, `CommerceCheckout`, `CommerceOrder`, `FulfillmentPolicy`, and `PaymentMethodChannelAvailability` are channel-keyed. Flipping web `is_active` is a commercial-channel shutdown, not a storefront pause.
5. `CommercePriceResolver` does not even consult channel `is_active` (only the linked PriceList’s `is_active`). Coupling store-off to the channel would still leave an unclear pricing story.
6. Workspace list already treats inactive **channel** as “store remains, preview cleared” and inactive **storefront** as “store omitted” — they are already different product meanings.
7. Provisioning will not auto-heal an inactive `slug=web` channel, so a coupled deactivate could leave the tenant unable to provision/converge without a channel-admin API that does not exist.
8. 1B-SCOPE-1 already refused to touch `sales_channels.is_active` from Store Identity for this reason.

V1 deactivating a Storefront therefore **must not** write `SalesChannel.is_active`.

---

## Accounting / Historical Data Safety

**No current coupling** between `Storefront.is_active` and Invoice, payments, journals, inventory, or CommerceOrder writes.

- ADR-01: `CommerceOrder != Invoice`; creating/confirming an order does not post a journal or Sales Invoice by itself.
- `CommerceOrder` docblock: no accounting/inventory effect at create/confirm.
- Checkout/cart `is_active` checks are **product** flags, not storefront flags.
- Public checkout is already unreachable after resolver 404.

Do **not** cancel, delete, or rewrite historical CommerceOrders, invoices, payments, or inventory when a store is deactivated. History stays intact. New buyer traffic stops.

---

## Concurrency / Locking

Current Storefront writers:

| Path | Lock |
|---|---|
| Provisioning | `tenants` `lockForUpdate`, then channel/storefront/domain locks |
| Identity PUT | **No** row lock; `forceFill` name/locale + save |
| Domain Make Primary / Disconnect / Edge | Locks **all domains of the storefront** (`lockedDomainForStorefront`, ordered by id) — not the Storefront row |

**Smallest safe V1 boundary:** one short DB transaction that `lockForUpdate()`s the **Storefront row** (tenant-scoped lookup), sets `is_active`, presents the store. Do not lock domains. Do not lock SalesChannel. Do not hold HTTP while calling Railway.

Races:

| Concurrent with | Outcome |
|---|---|
| Identity PUT | Distinct columns; last save wins on the row. Acceptable. Do not expand identity locking in this slice. |
| Domain Make Primary / Disconnect / Edge | Independent tables/columns. Store can go inactive while a domain remains primary/ready. Desired. |
| Provisioning | Provisioning may re-activate after deactivate (existing converge). Documented; do not change provisioning. Tenant lock + storefront lock serialize naturally if both lock the storefront row. |
| Concurrent Activate/Deactivate | Serialized on the storefront row; last committed state wins; both idempotent. |

No new locking architecture. Same family as identity (single row) plus the one `lockForUpdate` identity currently lacks, because lifecycle is a serving kill-switch.

---

## UX Recommendation

Smallest professional AWJ surface: existing `/commerce/stores` table only. Do **not** redesign Commerce Workspace.

| Element | V1 |
|---|---|
| Status badge | Keep; drive from truthful `is_active`. Active = positive, Inactive = muted. Existing AR/EN strings. |
| Deactivate Store | `commerce.manage` only, when `is_active === true`. |
| Confirmation | Dialog: customers will no longer be able to access or buy from this storefront. Settings, domains, orders, and catalog data are kept. Not a delete. |
| Activate Store | `commerce.manage` only, when `is_active === false`. |
| Loading / error | Disable actions while in-flight; toast/inline error; re-fetch catalog from server (same `refresh()` as provision/identity). No optimistic serving claim. |
| Preview / View Store | `preview_url` must be `null` when storefront is inactive so View Store does not send merchants to a 404 host. |
| Settings / Domains | Remain available on inactive stores (identity + domain admin already resolve without `is_active`). |
| AR / EN / RTL / mobile | `messages.ts` keys; existing table + dialog primitives; no new route. |

Domain page “تفعيل النطاق / Activate Domain” stays EDGE. Do not reuse that copy for store lifecycle.

---

## Backward Compatibility

- No migration.
- Public resolver unchanged.
- Identity PUT unchanged (still cannot set `is_active`).
- Domain/Edge contracts unchanged.
- Provisioning still creates active stores and still re-activates a compatible inactive first storefront.
- GET list **shape** (keys) unchanged: `id, name, sales_channel_id, is_active, preview_url, default_locale`.
- GET list **semantics** must expand: include inactive storefronts and return the real boolean. This is the one intentional compatibility adjustment — required so merchants can see and re-activate a paused store. Update `inactive_storefronts_are_omitted` rather than keep hiding the row.
- `preview_url` additionally null when the storefront itself is inactive (today that case is omitted entirely).
- Presenters that hard-code `'is_active' => true` must return `(bool) $storefront->is_active`.
- `CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES` must add the new URIs (allowlist is exact; CI fails closed otherwise).
- Publication remains filtered to active storefronts+channels (existing test stays).

---

## Risks

| Risk | Severity | Mitigation in V1 |
|---|---|---|
| GET list contract change (`inactive_storefronts_are_omitted`) | Medium, necessary | Document as intentional; update that test; keep response keys identical |
| POST provision re-activates after a merchant Deactivate | Low | Existing documented converge; out of scope to change; Activate remains the explicit UX |
| Merchant expects Domain/HTTPS to turn off | Low | Copy: store is paused; domains/DNS/TLS kept |
| Merchant expects POS/mobile to stop | Low if uncoupled | DO NOT COUPLE; copy can say “this hosted storefront” |
| Activate while domain/channel unhealthy → “Activate succeeded but site 404s” | Low | Do not over-gate Activate; preview_url null explains serving |
| Publication chooser hides inactive store | Informational | Existing behavior; listings preserved; do not reopen COM-WS-3 |
| Identity presenter still lying `is_active: true` if forgotten | Medium | Same presenter helper as list |
| Accidental resolver change | High if done | Explicit exclusion: no resolver edits |
| Using domain `is_active` or Disconnect as store-off | High | Explicit exclusion |

No stop-condition blockers remain.

---

## Implementation Recommendation

**One smallest PR:** `STORE-ADMIN-LIFECYCLE-1` — merchant-controlled Storefront serving flag.

### Migration

**NO.**

### Backend endpoints

Storefront-id scoped (safe for future multi-store). **No** tenant-global activate/deactivate.

```text
POST /api/commerce/workspace/storefronts/{id}/activate
POST /api/commerce/workspace/storefronts/{id}/deactivate
```

Empty bodies. Extra JSON fields ignored. Do **not** add `is_active` to Identity PUT.

Pattern matches `activate-edge` / cash-bank `deactivate`: explicit verbs, not a generic PATCH.

### Request / response

Request: `{}` or empty.

Response (same family as Identity PUT / Provision):

```json
{
  "data": {
    "store": {
      "id": "<uuid>",
      "name": "…",
      "sales_channel_id": "<uuid>",
      "is_active": false,
      "preview_url": null,
      "default_locale": "ar"
    }
  }
}
```

After Activate, `is_active` is `true` and `preview_url` follows existing rules (channel active + active verified domain → https URL, else null).

Errors:

| Case | HTTP |
|---|---|
| Guest | 401 |
| self_service / staff without `commerce.manage` | 403 |
| Unknown or cross-tenant `{id}` | 404 `"المتجر غير موجود."` |
| Idempotent same-state | 200 + current store |

### Service methods

On `CommerceWorkspaceStorefrontsService` (existing tenant/workspace authority; do not add a new service):

- `activateForCurrentTenant(string $storefrontId): ?array`
- `deactivateForCurrentTenant(string $storefrontId): ?array`

Shared private `setActiveForCurrentTenant(string $storefrontId, bool $active): ?array`:

1. Require `TenantContext`.
2. Transaction: `Storefront::query()->whereKey($id)->lockForUpdate()`.
3. `null` if missing or `tenant_id` mismatch.
4. Confirm linked `SalesChannel` is same-tenant `web` (same as list/identity). Do not write the channel.
5. `forceFill(['is_active' => $active])->save()` only if changed.
6. Return the same store presenter as identity — **actual** `is_active`, `preview_url` null when storefront or channel inactive or no authorized domain.

Also in this PR (not a second PR): `listForCurrentTenant()` / identity presenter:

- Drop `where('is_active', true)` on the storefront query.
- Return real `is_active`.
- `preview_url` only if **storefront** active **and** channel active **and** authorized domain (existing domain filter).

Do not change `CommerceProductPublicationService` filters.

Controller: two actions on `CommerceWorkspaceStorefrontsController`, `commerce.manage` + existing self_service 403. Register routes next to the identity PUT.

### Authorization

`TenantContext` + `commerce.manage`. No new permission.

### Frontend surface

- `web/src/modules/commerce-workspace/stores.ts` — `activateCommerceStorefront(id)` / `deactivateCommerceStorefront(id)`.
- `messages.ts` — AR/EN for actions, confirming deactivation, in-flight, success, failure. Do not collide with domain activate copy.
- `/commerce/stores` — badge truthful; Activate / Deactivate gated on `commerce.manage`; deactivation confirmation dialog; `refresh(storeId)` after success.
- Settings remains on inactive rows.

### Tests

Backend (new feature test, e.g. `CommerceWorkspaceStorefrontLifecycleApiTest`):

- Guest 401; self_service 403; staff without `commerce.manage` 403; cross-tenant 404; unknown 404.
- Deactivate sets only `Storefront.is_active = false`.
- Assert unchanged: `SalesChannel.is_active`, every domain `is_active` / `is_primary` / `verification_status` / `verified_at` / `edge_status` / `edge_provider_id`.
- Public `store/v1` products, media, storefront config, cart, checkout → 404 after deactivate (reuse Host helper from `StorefrontDomainResolutionApiTest`).
- Activate restores public 200 when domain+channel still healthy.
- Activate does **not** require Railway/edge ready (AWJ-managed fixture).
- Idempotent activate/deactivate.
- GET list includes inactive store with `is_active: false` and `preview_url: null` (replace `inactive_storefronts_are_omitted`).
- Identity PUT still cannot flip `is_active`.
- Provisioning re-activate test remains green (no provisioning edits).
- Publication inactive test remains green.
- `CommerceModuleBoundaryTest` allowlist:  
  `api/commerce/workspace/storefronts/{id}/activate`  
  `api/commerce/workspace/storefronts/{id}/deactivate`

Optional pgsql: two concurrent deactivate/activate on one row; no exception; final `is_active` is boolean consistent.

Frontend:

- Stores page: deactivate confirms then calls POST deactivate; activate calls POST activate; no custom-domain edge URLs.
- Badge inactive when catalog says so.
- User without `commerce.manage` sees badge, not actions.
- Messages AR/EN.

### Explicit exclusions

Do **not** implement or modify:

- Custom Domain Railway production setup / env / deploy
- Domain lifecycle, Disconnect, Make Primary, Edge activate/refresh
- Resolver / `ResolveStorefrontDomain` / `ResolveStorefrontTenant`
- Product publication write semantics (filter stays)
- Cart, Checkout, Payments, Shipping, Content, SEO, Appearance / Theme, Store Customizer
- Public/Mobile Commerce API (`commerce/v1`)
- App Builder
- Multi-store creation
- Accounting, inventory, order cancellation
- `SalesChannel.is_active` writes
- Provisioning create-as-draft
- Unrelated refactors

---

## Proposed Task ID

**STORE-ADMIN-LIFECYCLE-1**

Supersedes the blocked placeholder `STORE-ADMIN-ADOPT-1B-4` from `STORE_ADMIN_ADOPT_1B_GAP_PASS_2.md`. The 1B-4 name is stale relative to shipped 1B-3B + EDGE-1/2/3. Implementation should use `STORE-ADMIN-LIFECYCLE-1`.

This verification document remains `STORE-ADMIN-LIFECYCLE-VERIFY-1`.

---

## Next Action

Open **STORE-ADMIN-LIFECYCLE-1** from latest `main` (must include EDGE-3 `31db0857…`).

Implement only the slice above. Docs-only this PR. **Do not merge this verification PR as a substitute for implementation. Do not deploy. Do not start Railway production verification.**
