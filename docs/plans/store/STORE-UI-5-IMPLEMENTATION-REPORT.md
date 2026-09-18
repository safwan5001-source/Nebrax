# STORE-UI-5 — Customer Account Experience

## 1. Status

**COMPLETE pending visual re-review (correction round 1).** **Not merged, not deployed.**
`NO VISUAL APPROVAL = NO MERGE` is respected.

## 2. Git

| | |
|---|---|
| **Latest main SHA** | `30979a1bb499cfe8b0e656495805e50225027530` — STORE-UI-4 merge (PR #866) |
| **Base SHA** | `30979a1bb499cfe8b0e656495805e50225027530` (verified ancestor of this branch) |
| **Branch** | `feat/store-ui-5-customer-account` |
| **Head SHA** | `7c77b1778e0cdee0611945cd2c049c8cb25c0277` |
| **PR** | [#868](https://github.com/safwan5001-source/Nebrax/pull/868) |

`git merge-base --is-ancestor 30979a1bb499cfe8b0e656495805e50225027530 HEAD` holds.

## 3. The policy this pass operates under

The owner's design-first decision, recorded in
`docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`:

> **Missing backend capability does not block storefront design completion.
> It blocks production activation.**

So the customer-account journey is designed in full. Where a contract exists
the interaction is real (session login, register, logout, profile update).
Where none exists the surface is built, visibly inert, and recorded with the
exact missing contract. What design-first never licenses — inventing an API,
fabricating an order/payment/fulfilment state, faking a monetary value,
substituting browser storage for business persistence, presenting a
`CommerceOrder` as an invoice, weakening tenant isolation — was not done
anywhere in this diff.

## 4. Evidence pass — what was read, not assumed

Narrow, per the brief. The full Commerce architecture was not re-audited.

| Source | What it established |
|---|---|
| `routes/api_storefront.php` | Anonymous catalog / cart / checkout only. **No** account order-list, order-lookup, address-book, wishlist or saved-payment route. |
| `StorefrontCheckoutController::serializeOrder()` | The AWJ order shape is `{id, number, status, delivery_method, total, contact, delivery, items[], created_at}`. Status is not a fulfilment lifecycle. |
| `CommerceOrder` | Status is `draft \| confirmed` only. No payment_status, no fulfillment_status, no invoice document. |
| `customer/v1` login/me | Exists and is unwired. Swapping the storefront session onto it is an auth-architecture change and a stop condition. **Not done.** |
| Existing storefront session (`AuthContext`, `@/lib/data/customer`, Spree SDK login/logout/profile) | The live identity contract. Kept. |
| Leftover `OrderList` / `OrderDetail` / `CreditCardList` / `GiftCardList` | Spree account UI. Must not be presented as AWJ commerce truth. Left in the tree, unused by the new DTC routes. Gift-cards and credit-cards routes redirect away. |
| STORE-UI-3 `WishlistContext` | Page-lifetime in-memory favourites. `WISHLIST_CAPABILITY = design_only`. Reused; no second system, no `localStorage`. |
| STORE-UI-4 `CartLine` / `awjOrderLineView` / `formatMinorAmount` | Reused for order lines and money. The component never multiplies. |
| ADR-01 | `CommerceOrder != Invoice`. |
| ADR-04 | Payment Intent is architecture direction, no implementation approval. |
| The four required design documents | Design system, design-first policy, responsive baseline, STORE-UI-4 report. |

## 5. Capability matrix

| Capability | Existing UI | Backend contract | State | Action taken |
|---|---|---|---|---|
| Account overview | leftover Spree dashboard-ish account page | session identity only | **LIVE** (identity) + **DESIGN_ONLY** (recent orders) | Rebuilt as a customer landing: identity, honest recent-orders notice, destination list, logout. No fake metrics. |
| Profile | Spree update form | `updateCustomer` (existing session) | **LIVE** | Restyled. Name + email update through the existing contract. Phone is read-only — the session user has no phone field. Loading / success / validation / server error. |
| Orders | Spree `customer.orders.list` | none on `store/v1` | **DESIGN_ONLY** | New `AccountOrderList`. Live route renders empty + gated notice. Designed list lights up from `StorefrontOrder[]`. Spree list is not called. |
| Order detail | Spree `orders.get` | none on `store/v1` | **DESIGN_ONLY** | New `AccountOrderDetail` against `serializeOrder()`. Live route states lookup is unavailable. Never titled Invoice. |
| Order status | Spree payment/fulfilment badges | `draft \| confirmed` only | **DESIGN_ONLY** | Journey of four steps. Only **placed** lights up, and only when status is `confirmed`. Tracking absence is stated once under the journey. |
| Addresses | Spree address CRUD | checkout has one free-text address per checkout; no book | **DESIGN_ONLY** | List / card / add / edit / remove / default shape. Actions refuse, report no success, write no storage. |
| Wishlist | STORE-UI-3 heart | none | **DESIGN_ONLY** | Account page on the existing `WishlistContext`. Page-lifetime only. |
| Payment methods | Spree credit cards | none; ADR-04 unimplemented | **DESIGN_ONLY** | Empty + dashed method shapes. No provider name, no brand mark, no card field, no fake save. |
| Auth entry | Header icon + `MobileBottomNav` Account tab + `/account` | existing session | **LIVE** | Restyled sign-in / register / forgot / reset on `AccountAuthCard`. Routes and session actions unchanged. |
| Logout | existing `logout()` | existing session | **LIVE** | Explicit control on overview (mobile) and sidebar (desktop). Failure is shown; no optimistic fake success. |

Each `DESIGN_ONLY` entry's **exact missing contract** is written into
`lib/commerce/capabilities.ts` beside the declaration, and into the
design-first policy's register (§5.10–§5.15).

## 6. Implemented surfaces

### Account shell

Desktop (`lg+`): sidebar with identity, destinations, help, logout.
Mobile: no squeezed sidebar. Overview is the compact destination list; inner
pages get a "back to account" link. `MobileBottomNav` is unchanged — the
Account tab already owns `/account`.

### Overview

Customer landing, not an ERP dashboard. Identity, a gated recent-orders
notice (no fabricated orders), destination rows (orders, profile, addresses,
wishlist, payment methods, help), logout on handheld widths.

### Auth

`AccountSignIn`, register, forgot-password, reset-password share
`AccountAuthCard`. Password fields use a show/hide control with logical
`pe`/`end` placement. Session login/register/logout/profile update still go
through `AuthContext` → `@/lib/data/customer`.

### Orders

Card rows (not a squeezed table): number, date, `confirmed`/`draft` only,
item count, **server total** via `formatMinorAmount` in `<bdi>`. The preview
fixture's second line has `line_total ≠ unit_price × qty` so tests can prove
the UI prints the server figure.

### Order detail

Number, date, status, `AccountOrderStatus`, line items via `CartLine` +
`awjOrderLineView`, authoritative total, contact, delivery address/method, and
the same "no payment has been processed" note used on confirmation. No
Download Invoice / Tax Invoice / Receipt.

### Addresses / payment methods / wishlist

Designed and gated. Add/edit/remove/save refuse with the capability message.
Wishlist reuses `ProductCard` and `WishlistContext.favoriteIds`.

## 7. Responsive behaviour

Verified at 390 / 768 / 1440 (plus 430 / 1024 / 1280 by the same layout
tokens). Cards on a phone; sidebar + content from `lg`. No horizontal
overflow on any captured surface. Touch targets are `min-h-11`. Safe-area is
unchanged (`MobileBottomNav` already owns `pb-[env(safe-area-inset-bottom)]`).

## 8. RTL / LTR

Logical CSS (`ms`/`me`/`ps`/`pe`/`end`/`start`). Architecture test forbids
hardcoded `ml-`/`mr-`/`pl-`/`pr-`/`text-left`/`text-right` on the new AWJ
account files. Chevrons flip with `localeDirection`. Amounts sit in `<bdi>`.
Address join uses `، ` in `ar` and `, ` otherwise.

## 9. Data-authority decisions

- Order totals and line totals are the server's. Never `unit × qty`.
- Status vocabulary is `draft | confirmed`. Nothing is marked paid / shipped /
  delivered / out for delivery.
- No invoice claim.
- No fabricated customer, address, saved card, or monetary default on a live
  route. `ACCOUNT_ORDER_PREVIEW` is imported only by tests and
  `/dev/store-ui-5` (production `notFound()`).
- Profile success is the existing session contract's actual response.
- DESIGN_ONLY mutations never report success.

## 10. Tenant / security assessment

No stop condition was hit.

| Guardrail | Held how |
|---|---|
| Tenant isolation | Untouched |
| Storefront tenant context | Untouched |
| Customer session / auth architecture | Existing Spree session kept; `customer/v1` not swapped in |
| Cart / customer identity boundary | Untouched. Checkout still writes `customer_identity_id` null |
| Gateway secrets / server secrets | Untouched |
| Cross-tenant protection | Untouched |
| No browser storage as business persistence | Architecture test on the AWJ account files; address/payment tests spy `localStorage`/`cookie` |
| Authenticated layout | Still requires an access or refresh token before chrome; client shell still redirects a rejected session without revealing content |

## 11. Shared-component impact

Reused: `StoreContainer`, `Button`, `Field`/`Input`, `CartLine` /
`awjOrderLineView`, `ProductCard`, `ProductImage`, `formatMinorAmount`,
`WishlistContext`, `AuthContext`, `MobileBottomNav`, Header account icon.

New, account-scoped: `AccountShell`, `AccountOverview`, `AccountSignIn`,
`AccountAuthCard`, `AccountPasswordField`, `AccountOrderList`,
`AccountOrderDetail`, `AccountOrderStatus`, `AccountAddresses`,
`AccountPaymentMethods`, `AccountWishlist`, `AccountProfileForm`,
`AccountGatedNotice`, `AccountEmptyState`, `account-nav.ts`.

Leftover Spree `OrderList` / `OrderDetail` / `CreditCardList` / `GiftCardList`
are unused by AWJ DTC routes and skipped by the architecture test. Gift-cards
and credit-cards URLs redirect into the new account.

Locked surfaces from STORE-UI-1–4 were not redesigned.

## 12. Changed files

**New — account UI**
- `storefront/src/components/account/{AccountShell,AccountOverview,AccountSignIn,AccountAuthCard,AccountPasswordField,AccountOrderList,AccountOrderDetail,AccountOrderStatus,AccountAddresses,AccountPaymentMethods,AccountWishlist,AccountProfileForm,AccountGatedNotice,AccountEmptyState,account-nav}.tsx|ts`
- `storefront/src/app/.../account/(authenticated)/{payment-methods,wishlist}/page.tsx`
- `storefront/src/app/dev/store-ui-5/page.tsx` (dev-only harness; `notFound()` in production)
- `storefront/src/lib/commerce/account-preview.ts` (test/preview fixture only)

**Changed — routes**
- `account/page.tsx`, `register`, `forgot-password`, `reset-password`
- `account/(authenticated)/{orders,orders/[id],profile,addresses}` rebuilt
- `credit-cards` → redirect to `payment-methods`
- `gift-cards` → redirect to `/account`

**Changed — contracts / docs / i18n**
- `lib/commerce/capabilities.ts` (five new declarations)
- `contexts/AuthContext.tsx` (export the context for the preview harness)
- `contexts/WishlistContext.tsx` (`favoriteIds`)
- `messages/{ar,de,en,es,fr,pl}.json`
- `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` §5.10–§5.15
- `docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md` STORE-UI-5 scope

**Tests**
- `AccountOrderList`, `AccountOrderDetail`, `AccountOrderStatus`,
  `AccountAddresses`, `AccountPaymentMethods`, `AccountOverview`,
  `AccountShell.architecture`, plus existing `AuthenticatedAccountShell` and
  `WishlistContext`.

**Visual QA**
- `docs/plans/store/store-ui-5-visual-qa/*.png`

## 13. Tests and exact results

```
pnpm test          →  72 files, 527 tests passed
pnpm check         →  372 files, no fixes applied
pnpm check:locales →  ar/de/en/es/fr/pl all keys match en.json
pnpm exec tsc --noEmit → clean
pnpm build         →  Compiled successfully
```

New in this pass:

- server order total is printed rather than a multiplied line sum
- order detail prints the authoritative line total, not `unit × qty`
- CommerceOrder is never labelled an invoice
- lookup-unavailable renders the gated notice and no fabricated orders
- confirmed orders mark **placed** only; later steps stay untracked
- address add/edit/remove refuse, write no `localStorage`/cookie, report no success
- payment surface has no card fields, names no brand, writes no storage
- overview does not fabricate an order number
- architecture: no Spree SDK / Spree order-address-card data layer on AWJ
  account files; no physical-direction Tailwind; no payment-provider name;
  no invoice/receipt download; no browser storage as persistence

The leftover Spree files are skipped by the architecture test on purpose —
they are not mounted.

## 14. Build result

`pnpm build` compiled successfully in 31.3s. TypeScript finished clean.
All new account routes resolve:

- `/[country]/[locale]/account`
- `/account/{orders,orders/[id],profile,addresses,wishlist,payment-methods}`
- `/account/{register,forgot-password,reset-password}`
- `/dev/store-ui-5` is listed; the page calls `notFound()` when
  `NODE_ENV === "production"`

A sitemap `fetch failed` / `ECONNREFUSED` against the local Commerce API
appeared during page-data collection — the same local-backend-absent warning
as prior storefront builds, not a STORE-UI-5 regression. Static generation
still completed 68/68.

## 15. CI status

Not yet run at report time. No Laravel/PHP files were changed. If CI runs
Laravel with no PHP diff, that failure is inherited and is not in this scope.

## 16. Visual QA

Harness: development-only `/dev/store-ui-5` (Playwright + Chromium
headless-shell). Live account routes mount the same components; the harness
exists so the designed order list/detail can be reviewed without a lookup
contract. `ACCOUNT_ORDER_PREVIEW` is not a production default.

| Width | Locale | Surfaces |
|---|---|---|
| 390 | AR | overview, orders, order detail, addresses, wishlist, profile, payment (gated), logged-out, orders empty |
| 390 | EN | overview, orders, order detail |
| 768 | AR | overview |
| 768 | EN | order detail |
| 1440 | AR | overview, orders, addresses, profile |
| 1440 | EN | overview, order detail, wishlist, logged-out |

Screenshots: `docs/plans/store/store-ui-5-visual-qa/`.

**No horizontal overflow** at any captured width (`scrollWidth === clientWidth`
on every shot).

### Defects found and fixed during visual QA / tests

1. **Order-list money assertion stripped whitespace only on the expected
   string**, so a legitimate NBSP inside `<bdi>` failed the test. Both sides
   now strip `\s`.
2. **Address join always used an Arabic comma**, including in English. It
   now follows the locale.
3. **Overview "back to account" on the landing itself** in the preview when
   the shell keyed off `/dev/store-ui-5`. The harness now passes
   `pathnameOverride` so overview highlighting and the back link match the
   intended route.
4. **Leftover Spree gift-cards page** would have rendered inside the new
   shell. It redirects to `/account`. Credit-cards already redirected to
   payment-methods.

## 17. Known differences / gated capabilities

- Live `/account/orders` is empty + gated until
  `GET store/v1/account/orders` exists. The designed list is the preview.
- Live `/account/orders/[id]` states lookup is unavailable until
  `GET store/v1/account/orders/{id}` exists.
- Addresses, saved payment methods and wishlist persistence stay inert.
- Phone on profile is read-only: the session user contract has no phone.
- Gift cards are not part of the AWJ account.

## 18. Risks

- `AuthContext` is now exported so the preview can provide a session. Live
  consumers still go through `useAuth()`.
- Leftover Spree account components remain in the tree. They are unmounted
  and architecture-skipped; a future cleanup can delete them once wholesale
  no longer needs any sibling.
- Profile update still talks to the Spree customer endpoint. That is the
  live session contract; swapping to `customer/v1` is a later auth task.

## 19. Deferred backend contracts

Recorded in `capabilities.ts` and policy §5.10–§5.15:

- `GET store/v1/account/orders`
- `GET store/v1/account/orders/{id}`
- fulfilment lifecycle beyond `confirmed`
- `GET/POST/PATCH/DELETE store/v1/account/addresses`
- saved payment methods via a provider-hosted element (card data never
  through AWJ)
- wishlist persistence (already in §5.1)
- a customer identity to hang orders/addresses on (`customer_identity_id`
  is null today because the cart is an anonymous cookie)

Invoice / receipt remains **DEFERRED** (`CommerceOrder != Invoice`).

## 20. Scope confirmation

- no merge
- no deploy
- no accounting change
- no unauthorized backend / schema change
- no tenant-isolation weakening
- no fake persistence
- no client-authoritative commerce facts
- no STORE-UI-1–4 redesign
- no PR #794 work
- no payment-gateway implementation
- `customer/v1` was **not** swapped in (auth-architecture stop condition)

## 21. Visual correction round 1

Owner review of the first Visual QA accepted the implementation direction
and withheld visual approval. This round is visual only: no contract,
capability, auth, tenant or accounting change.

| Finding | Correction |
|---|---|
| Desktop 1440 under-uses the store container; sidebar too slight, content floating | Wider sticky sidebar (`lg:w-72` / `xl:w-80`), larger shell gap, overview destinations as a two-column grid so the main column is occupied without stretching a single row to the full remaining width |
| Mobile overview felt like a settings app | Removed the large pale icon tiles. Rows are `min-h-11` with a 16px line icon, tighter type, same destinations |
| Orders left a single card in a blank canvas | Quieter heading + one-line gated caption; empty state is start-aligned and compact, not a padded island |
| Order status was a 2×2 numbered grid repeating “not tracked” | Horizontal four-step journey. Only **placed** fills, and only when `confirmed`. The track is never filled (that would fake progress). Tracking absence is one caption under the journey |
| Order detail stacked too many cards | Number as the title (isolated in `<bdi>`), items/total as the commercial block, contact and delivery as typography — not extra cards. Payment honesty is one muted line under the total |
| Gated surfaces led with capability absence | One quiet `AccountGatedNotice` (no banner). Addresses and payments keep the intended surface only; the oversized empty panel is gone. Wishlist is notice + compact empty |
| Profile was an oversized card in empty canvas | Card chrome removed. Form is `max-w-2xl` with tighter field rhythm. Phone helper is stated once |
| Login felt tiny on desktop | Card is `max-w-lg` and vertically centered in the remaining viewport. Still an auth form, not a marketing page |

**Unchanged:** capability classifications, session contract, Spree-not-as-AWJ-truth, no browser storage, `CommerceOrder != Invoice`, no fabricated fulfilment.

Replacement Visual QA (9 captures) in
`docs/plans/store/store-ui-5-visual-qa/`:

- `mobile-390-ar-overview.png`
- `mobile-390-ar-orders.png`
- `mobile-390-ar-order-detail.png`
- `mobile-390-ar-addresses.png`
- `mobile-390-ar-payment.png`
- `mobile-390-ar-profile.png`
- `desktop-1440-ar-overview.png`
- `desktop-1440-en-order-detail.png`
- `desktop-1440-ar-profile.png`

## 22. Next step

Owner visual review of correction round 1. On approval, merge. The
`DESIGN_ONLY` account capabilities then become dedicated backend tasks
against UI that is already agreed, each with its contract already written
down.
