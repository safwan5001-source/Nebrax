# AWJ Commerce — Wholesale Merchant Workspace (UI)

**Scope.** The merchant/administrator interface for wholesale operations inside the existing Commerce Workspace (`/commerce`). It is **not** the wholesale buyer storefront. Frontend only: no backend, migration, permission, accounting, VAT, ZATCA, payment or stock change. **Wholesale is not activated** — `commerce.wholesale_buyer_enabled` stays off and nothing here can open it.

| | |
|---|---|
| Branch | `claude/wholesale-merchant-workspace-ui-3hx9wy` |
| PR | _filled after opening (see PR description)_ |
| Base SHA | `310f1400a2ee05890b55e517e4a10fd77a7f810a` (`origin/main`) |
| Head SHA | _recorded in the PR description (the head moves when this report is amended)_ |
| Status | Ready for review. Not merged, not deployed, not enabled. |

## 1. Architecture (what was reused, what was added)

- **One Commerce navigation entry** ("الجملة / Wholesale" → `/commerce/wholesale`, permission `commerce.wholesale.manage`). The eleven sections live in an in-workspace section bar (`wholesale/components/subnav.tsx`), so Commerce navigation is not duplicated. A nav test pins this.
- **Channel = the active store's sales channel.** The shell already owns the store selector; no second selector was added. `WholesaleChannelProvider` reads `GET /commerce/channels/{id}/pricing-settings` once and derives a *readiness*: `no_channel · settings_unavailable · deployment_off · channel_not_marked · active`.
- **Gating, enforced in one place** (`SectionPage`): nothing renders and nothing is requested until hydration, the section's permission, and the section's channel requirement pass. Data sections (Orders, Buyers, Reports) require `active`; configuration sections (Catalog, Price lists, Offers, Shipping, Settings) need only a channel so a tenant can prepare while the global switch is off; Overview, Quotations and Payments need neither.
- **Reuse, no duplicated engines:** orders → existing `commerce/orders` client and `/commerce/orders/{id}` page (cancel stays there); catalog → product publication API; price lists → `price-lists` API + channel pricing-settings; offers → storefront offers API; quotations → `quotes` API and the existing `/quotes` screens; shipping → existing delivery-schedule/fulfilment panels; payments → `payment-methods` / `online-payment-methods`; partners → `partners` API.
- **i18n:** each section owns a typed ar/en dictionary (`defineMessages` — the English dictionary is typed against the Arabic keys; `expectMessageParity` guards empties and `{placeholders}`). Unknown server enum values are shown verbatim, never invented.
- **Honest unavailability:** `UnavailablePanel` states the exact blocker and a reference; it has no inputs or buttons.

## 2. Delivered sections and routes

| # | Section | Route | Permission (server-enforced) | Channel requirement |
|---|---|---|---|---|
| 1 | Overview | `/commerce/wholesale` | per card | none |
| 2 | Wholesale Orders | `/commerce/wholesale/orders` | `commerce.orders.view` | wholesale active |
| 3 | Buyers & Companies | `/commerce/wholesale/buyers` | `commerce.wholesale.manage` | wholesale active |
| 4 | Wholesale Catalog | `/commerce/wholesale/catalog` | `products.view` (write `products.manage`) | channel |
| 5 | Price Lists | `/commerce/wholesale/price-lists` | `invoices.view` (write `company.manage`) | channel |
| 6 | Offers & Discounts | `/commerce/wholesale/offers` | `commerce.manage` | channel |
| 7 | Quotations | `/commerce/wholesale/quotations` | `invoices.view` | none |
| 8 | Shipping & Delivery | `/commerce/wholesale/shipping` | `commerce.manage` | channel |
| 9 | Payments & Credit | `/commerce/wholesale/payments` | `payments.view` | none |
| 10 | Reports & Analytics | `/commerce/wholesale/reports` | `commerce.orders.view` | wholesale active |
| 11 | Wholesale Settings | `/commerce/wholesale/settings` | `commerce.channel_settings.manage` | channel |

All wholesale permissions are owner/admin-only by backend design (`*` only, never in `Rbac::MATRIX`).

## 3. Working API integrations (all existing, all authorized)

| Section | Endpoints |
|---|---|
| Overview | `GET commerce/orders?sales_channel_id=…&per_page=5` (list + `meta.total`), `GET commerce/wholesale/channels/{id}/memberships?status=…` (counts via `meta.total`), channel settings |
| Orders | `GET commerce/orders` (locked to the wholesale channel; URL cannot widen scope), `GET commerce/orders/{id}` (drawer; shows the server's `cancel_action` verdict, links to the full page) |
| Buyers | `GET commerce/wholesale/channels/{id}/memberships`, `POST commerce/wholesale/memberships/{id}/{approve\|reject\|suspend\|reinstate}` `{note ≤500}`; offered actions mirror `WholesaleMembershipService::TRANSITIONS`; server `reason` codes mapped to friendly text |
| Catalog | `GET /commerce/workspace/products/publication` (`storefront_id`), `GET/PUT /commerce/workspace/products/{id}/publication`, `GET …/storefronts/{id}/products[/{product}]`. Publish/unpublish reads the product's full publication first and changes only this store (the server replaces across all stores) |
| Price lists | `GET/POST/PUT/DELETE /price-lists`, `GET /price-lists/{id}`, `POST/DELETE /price-lists/{id}/items[/{item}]`, `GET /products?search=`, `GET /partners?type=customer`, `PUT commerce/channels/{id}/pricing-settings` with **only** `default_price_list_id` |
| Offers | `GET/POST/PATCH/DELETE /commerce/workspace/storefronts/{id}/offers`; `is_live`, reason, prices and % are shown as returned, never recomputed |
| Quotations | `GET /quotes`, `GET /partners?type=customer`; deep links to `/quotes`, `/quotes/new`, `/quotes/{id}` (issue/revise/convert stay in the existing screens) |
| Shipping | existing delivery-schedule + fulfilment endpoints via the embedded panels; read-only `GET /commerce/workspace/shipping-zones` |
| Payments & Credit | `GET /payment-methods`, `GET /online-payment-methods`, `GET /partners?type=customer&per_page=100` (`partners.view`) |
| Reports | `GET commerce/orders` counts by lifecycle / payment status / method / delivery / period (`meta.total`), membership counts by status; each card loads and fails independently |
| Settings | `GET/PUT commerce/channels/{id}/pricing-settings` (PUT body exactly `{wholesale_membership_enabled}` behind a confirm dialog) |

No request carries `tenant_id` (asserted in unit tests and in the browser spec).

## 4. Deferred functions and their exact blockers

Each is rendered in the UI as an `UnavailablePanel` with the same wording; none has a fake control.

| Function | Exact blocker |
|---|---|
| Customer-partner linking (buyer ↔ ERP customer) | No staff route exists. `CustomerPartnerLink` and its service are reachable only from customer self-service auth controllers; owner decision **D-B3** (staff UI, link endpoint, audit) is open. |
| Buyer-specific / tiered / volume / coupon wholesale pricing & discounts | An offer accepts no price or percentage; the storefront never passes the buyer to the price resolver. Owner decisions **D-B1…D-B6**, **D-M1/D-M2** open (`AWJ_H6_BATCH_I_PRICING_PRECEDENCE_MATRIX.md` §5–6). |
| Units, pack sizes, MOQ per product | No field or API exists; proposal B1 blocked on **D-M1**. |
| Minimum order amount, B2B VAT display, payment terms/credit at order time, COD allow-list, suspension policy | Read-only table of current behaviour vs. pending decisions (**D-M2, D-X1, D-P1, D-P2, D-S1**). Credit is **not** evaluated at wholesale order time (`Partner.credit_limit` applies when a credit invoice is posted). |
| Wholesale freight terms / per-buyer delivery terms | No model or API; depends on D-B3. |
| Revenue, AOV, top products, top buyers | No channel-scoped aggregate endpoint (`reports/sales` has no channel dimension). Reports shows counts only — it never sums a page of orders. |
| Order posting status in the order list | Not exposed or filterable by the list endpoint. |
| Configurable buyer-access policies | No settings model; shown as read-only facts. |
| Shipping-zone management | No management screen exists anywhere in the web app (read-only here). |
| Offers reordering by `position` | Backend field exists; out of scope for this batch. |

Known limits (stated in the UI): credit list inspects the latest 100 customers (API has no credit filter/total); quotes list has no server filters/pagination so search/status apply to the loaded list; price-coverage diagnostics page through ≤10×100 published products and show a "partial scan" notice instead of a total if the cap is hit.

## 5. Behaviour that matters for operators

- **Default deployment reality:** the global switch is off, so the API refuses to mark any channel wholesale (409 `wholesale_deployment_disabled`). The Settings toggle is disabled with an explanation in that state, and Orders/Buyers/Reports show a gate ("Wholesale is not enabled in this deployment") with no data request.
- **Marking a channel wholesale hides prices, cart and checkout from anyone who is not an approved buyer** (Batch F §4). The ON confirm dialog says so and that a retail DTC channel must not be marked.
- Every state-changing action is confirmed and toasts success/failure; the server remains the authority for every transition.

## 6. Screenshots

QA fixtures live only in `web/e2e/wholesale-workspace.spec.ts` (API fully intercepted in the browser; no backend, no production data, nothing shipped in app code). Desktop 1440 (Arabic RTL) and iPhone-class 390 (English LTR), light unless noted. All 11 sections were additionally captured in the other language/viewport (47 images total in the run; 25 committed).

| Section | Desktop (ar) | Mobile (en) |
|---|---|---|
| Overview | ![](assets/wholesale-workspace/overview-ar-desktop.png) | ![](assets/wholesale-workspace/overview-en-mobile.png) |
| Orders | ![](assets/wholesale-workspace/orders-ar-desktop.png) | ![](assets/wholesale-workspace/orders-en-mobile.png) |
| Buyers | ![](assets/wholesale-workspace/buyers-ar-desktop.png) | ![](assets/wholesale-workspace/buyers-en-mobile.png) |
| Catalog | ![](assets/wholesale-workspace/catalog-ar-desktop.png) | ![](assets/wholesale-workspace/catalog-en-mobile.png) |
| Price lists | ![](assets/wholesale-workspace/price-lists-ar-desktop.png) | ![](assets/wholesale-workspace/price-lists-en-mobile.png) |
| Offers | ![](assets/wholesale-workspace/offers-ar-desktop.png) | ![](assets/wholesale-workspace/offers-en-mobile.png) |
| Quotations | ![](assets/wholesale-workspace/quotations-ar-desktop.png) | ![](assets/wholesale-workspace/quotations-en-mobile.png) |
| Shipping | ![](assets/wholesale-workspace/shipping-ar-desktop.png) | ![](assets/wholesale-workspace/shipping-en-mobile.png) |
| Payments & credit | ![](assets/wholesale-workspace/payments-ar-desktop.png) | ![](assets/wholesale-workspace/payments-en-mobile.png) |
| Reports | ![](assets/wholesale-workspace/reports-ar-desktop.png) | ![](assets/wholesale-workspace/reports-en-mobile.png) |
| Settings | ![](assets/wholesale-workspace/settings-ar-desktop.png) | ![](assets/wholesale-workspace/settings-en-mobile.png) |

State screens: gated Buyers (deployment off, ar desktop) ![](assets/wholesale-workspace/buyers-gated-ar-desktop.png) · buyer detail drawer (ar mobile) ![](assets/wholesale-workspace/buyers-drawer-ar-mobile.png) · gated Overview, dark theme (en mobile) ![](assets/wholesale-workspace/overview-gated-en-dark-mobile.png)

## 7. Changed files

106 added, 4 modified (+ 25 screenshots and this report).
- **Modified (4):** `web/src/modules/commerce-workspace/nav.ts` (+1 group, 1 entry), `nav.test.ts` (see §8), `messages.ts` (2 ar + 2 en keys), `web/src/components/commerce-workspace/commerce-workspace-nav.tsx` (icon).
- **Added:** `web/src/modules/commerce-workspace/wholesale/**` (foundation: `nav`, `channel`, `channel-context`, `use-resource`, `messages/*`, `components/*`; sections: `overview`, `orders`, `buyers`, `catalog`, `price-lists`, `offers`, `quotations`, `shipping`, `payments`, `reports`, `settings` — each with `api`, `messages`, components and tests); 11 route pages + `layout.tsx` under `web/src/app/(commerce)/commerce/wholesale/`; `web/e2e/wholesale-workspace.spec.ts`; this report and `docs/audits/assets/wholesale-workspace/*`.

## 8. Test, build and CI results

| Check | Result |
|---|---|
| Vitest — wholesale + nav | 33 files / **200 tests** pass |
| Vitest — full web suite | **786 files / 9201 tests pass** (was 750 / 8923 at the last recorded baseline in `AWJ-WEB-RBAC-01`; none removed) |
| `npm run build` (Next 15) | **exit 0**; all 11 `/commerce/wholesale*` routes compiled |
| `tsc --noEmit` | 55 errors, **all in pre-existing test files outside this change** (same count recorded before this work); **0 in any wholesale file** |
| Lint | **Not run — the repo has no ESLint config** (`next lint` prompts to create one). Not introduced here. |
| Playwright `wholesale-workspace.spec.ts` | **52 / 52** (desktop + mobile × ar/en × 11 sections active; gated state; dark theme; no-permission sends no request; keyboard open/Esc of the buyer drawer). Each section: no horizontal overflow, no unexpected write request, no `tenant_id`, no console errors |
| DTC regression | existing `commerce-orders-o1b.spec.ts` **17 / 17** (desktop + mobile); the entire existing unit suite is green; **no existing test was weakened or removed** |
| Localization | `expectMessageParity` on every dictionary (identical keys, no empty values, matching placeholders); `i18n-keys` guard green |
| CI / CI Gate | _recorded in the PR after the first run_ |

**One existing assertion updated (disclosed):** `nav.test.ts` asserted `COMMERCE_WORKSPACE_NAV_GROUPS` has length 3 and listed the Commerce hrefs; they now expect 4 groups / the extra `/commerce/wholesale` href, with a new test pinning that Wholesale is a single guarded entry.

**Test-environment note (pre-existing, not from this change):** in dev mode next-intl logs `INVALID_KEY … appBuilder.builder.visibility.*` on every page (keys containing "."). The browser spec excludes exactly that noise and fails on any other console error.

## 9. Security and compatibility risks

- **Authority stays on the server.** Gating is UX only; every endpoint re-checks permission, tenant scope and channel type. Wholesale permissions are owner/admin via `*` only; the UI never grants or infers any.
- **Flag-on risk:** marking a retail channel wholesale would hide its prices/cart/checkout from the public. Mitigations: API 409 while the deployment switch is off; explicit confirm copy; the toggle is the only write on that screen. Residual: once the switch is on, an owner can still mark the wrong channel — recoverable by toggling off (audited, append-only).
- **Catalog publication** writes affect the store's live catalog (the store *is* the channel); mitigated by confirmation and by preserving other stores' publication.
- **Overview/Reports counts** come from live endpoints; list endpoints are tenant-scoped by `TenantScope`. Credit list is a 100-row sample, labelled as such.
- **Compatibility:** additive — one nav entry, new routes, no change to DTC routes/components; the Orders list/detail components are reused, not modified. Older servers lacking `cancel_action` simply hide the verdict.
- **Not verified here:** behaviour against a real backend with wholesale enabled (browser QA used intercepted fixtures; backend behaviour is covered by the H6 Batch E–I backend tests), real Resend delivery, the production proxy chain, and the shipping-zones/credit views with large datasets.

## 10. Recommended next action

1. Review and merge this PR (frontend-only, additive, dark by default).
2. Resolve the owner decisions that unblock the deferred rows, in this order: **D-B3** (buyer ↔ customer link: unblocks partner linking, buyer pricing, credit, per-buyer terms), **D-T1** (trusted client IP — the Batch H/I activation blocker), then **D-M1/D-M2/D-X1** (MOQ, minimum amount, B2B VAT display).
3. Add a channel-scoped orders aggregate endpoint (revenue/AOV/top products/top buyers) so Reports can go beyond counts.
4. Add the wholesale activation runbook (separate approval): operator confirms edge hop count (D-T1), Resend sender domain, then a coordinated decision to open `COMMERCE_WHOLESALE_BUYER_ENABLED`. **Do not enable wholesale without that explicit approval.**
5. Add an ESLint config so lint can gate this module (the repo has none today). Web CI already covers `web/**`.
