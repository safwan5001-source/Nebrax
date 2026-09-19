# STORE-UI-4 — AWJ Store Cart & Checkout Presentation

## 1. Status

Complete and ready for visual review. **Not merged, not deployed.**
`NO VISUAL APPROVAL = NO MERGE` is respected: this PR is open for the owner's
visual sign-off and nothing beyond it.

## 2. Base SHA

`b79e51f89e51166310900d723cda203577ff3bca` — the STORE-UI-3 merge (PR #860) and
the head of `main` when this branch was cut. Verified with
`git merge-base --is-ancestor`.

## 3. Branch

`claude/store-ui-4-cart-checkout`

## 4. The policy this pass operates under

The owner's design-first decision, recorded in
`docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`:

> **Missing backend capability does not block storefront design completion.
> It blocks production activation.**

So the whole journey — Product → Add to Cart → Cart → Checkout → Confirmation —
is designed. Where a contract exists the interaction is real; where none exists
the surface is built, visibly inert, and recorded with the exact missing
contract. What design-first never licenses (inventing an API, fabricating a
price/discount/stock/date, faking payment or order state, substituting browser
storage for business persistence, weakening tenant isolation) was not done
anywhere in this diff, and §25 below states how each guardrail was kept.

## 5. Evidence pass — what was read, not assumed

Narrow, per the brief. The full Commerce architecture was not re-audited.

| Source | What it established |
|---|---|
| `app/Services/Commerce/CommerceCartService.php` | The cart payload is `{status, items[], subtotal, currency, has_unavailable_items}`. **No tax, no shipping, no discount, no total.** A line carries `{id, product_id, product_variant_id, variant_descriptor, product_name, unit_key, unit_name, quantity, unit_price, line_total, available}` and **no image**. An unresolvable line is retained with `available: false` and **both amounts zeroed** (line 218). |
| `app/Services/Commerce/CommerceCheckoutService.php` | `DELIVERY_METHODS = ['pickup', 'standard']`, fixed in code. `updateDelivery()` writes `delivery_amount_minor => 0` unconditionally. `serialize()` adds `status`, `contact`, `delivery{method, amount, address}` over the cart. `complete()` revalidates, then creates exactly one `CommerceOrder`. |
| `app/Http/Controllers/Api/StorefrontCheckoutController.php` | `updateDelivery` accepts **`method` only**; any client-sent amount is a 422 before it reaches the service. `rejectUnknown()` refuses unknown keys on every mutation. `complete` requires `Idempotency-Key`; errors are `IDEMPOTENCY_KEY_REQUIRED` (400), `INVALID_IDEMPOTENCY_KEY` (400), `IDEMPOTENCY_CONFLICT` (409), `REVIEW_REQUIRED` (409). `serializeOrder()` returns `{id, number, status, delivery_method, total, contact, delivery, items[], created_at}`. |
| `app/Services/Commerce/CommerceOrderService.php` | `createFromCheckout()` sets `total` to the plain sum of the created line totals and the status to `confirmed`. No tax, no delivery, no payment. |
| `routes/api_storefront.php` | Three cart routes, five checkout routes. **No coupon route. No payment route.** Mutations sit behind `RequireStorefrontMutationGateway`. |
| `docs/plans/store/ADR-04-PAYMENT-INTENT-CAPTURE-REFUND.md` | Payment Intent is *Accepted — Architecture Direction … no implementation approval*. The boundary is agreed; nothing is built. |
| `storefront/src/lib/commerce/{cart,checkout}{,-types}.ts`, `lib/data/awj-checkout.ts`, `checkout-idempotency.ts` | The existing wiring: server actions, view models, and the per-checkout persisted Idempotency-Key. |
| `storefront/src/contexts/CartContext.tsx`, `components/cart/CartDrawer.tsx`, the cart and checkout pages | The surfaces this slice redesigns, and the Spree/wholesale boundary that must keep working. |
| The four required design documents | `AWJ_STOREFRONT_DESIGN_SYSTEM.md`, `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`, `AWJ_CART_V1_ARCHITECTURE.md`, `AWJ_CHECKOUT_V1_ARCHITECTURE.md`. |

## 6. Capability matrix

| Capability | State | Evidence / what backs it |
|---|---|---|
| View cart lines | **LIVE** | `GET store/v1/cart` |
| Change line quantity | **LIVE** | `PATCH store/v1/cart/items/{item}` |
| Remove a line | **LIVE** | `DELETE store/v1/cart/items/{item}` |
| Cart subtotal | **LIVE** | `subtotal.amount_minor`, server-computed |
| Unavailable-line handling | **LIVE** | `available`, `has_unavailable_items` |
| Variant descriptor on a cart line | **LIVE** (newly surfaced) | `variant_descriptor` was already in the payload and was being dropped by the storefront mapper. Now mapped and shown. |
| Cart line imagery | **LIVE** (via the catalogue) | The cart carries no image, so each line's own `product_id` is read back through `GET store/v1/products/{id}` — the same contract the listing uses. Fails soft to the neutral placeholder. |
| Cart → checkout handoff | **LIVE** | `POST store/v1/checkout` (create or resume) |
| Contact stage | **LIVE** | `PATCH store/v1/checkout/contact` |
| Address stage | **LIVE** | `PATCH store/v1/checkout/address` (seven free-text fields) |
| Delivery **method** | **LIVE** | `PATCH store/v1/checkout/delivery`, stored and carried onto the order |
| Delivery **price** | **DESIGN_ONLY** | `DELIVERY_PRICING_CAPABILITY`. Server-forced `0`; no pricing authority exists. Shown as "confirmed later", never as free. |
| Payment | **DESIGN_ONLY / GATED** | `PAYMENT_CAPABILITY`. No route, no model, ADR-04 unimplemented. Stage designed and visibly inert. |
| Coupons / promotions | **DESIGN_ONLY / GATED** | `COUPON_CAPABILITY`. No route; the cart payload has no discount field. Field designed, applies nothing. |
| Review / place order | **LIVE** | Read back from the server's checkout, never from the draft forms |
| Idempotent completion | **LIVE** | `POST store/v1/checkout/complete` + the persisted per-checkout key |
| Order confirmation | **LIVE** | `serializeOrder()`; `order.total` is the only total in the journey |
| Tax presentation | **DEFERRED** | `TAX_PRESENTATION_CAPABILITY`. No tax field anywhere; a zero would be an unsourced monetary claim. No row rendered. |
| Order tracking / status | **DEFERRED** | No fulfilment status and no guest order-lookup route |
| Invoice / receipt download | **DEFERRED** | `CommerceOrder != Invoice` (ADR-01); no document exists |
| Saved addresses / address book | **DEFERRED** | One address per checkout, and no customer identity to file one under |
| Express checkout on the AWJ surface | **DEFERRED** | No payment capability to express |

Each `DESIGN_ONLY` / `GATED` entry's **exact missing contract** is written into
`lib/commerce/capabilities.ts` beside the declaration, and into the design-first
policy's register (§5.2, §5.3, §5.8) in the five-item form the policy requires.

## 7. Cart page

Rebuilt on the store design system: `--store-*` tokens, `rounded-store`, the
same card treatment and rule-bar headings as the merged homepage and catalogue.

- Page header with the title and the server's item count.
- A warning banner when `has_unavailable_items` is true.
- The line list as one bordered card, `divide-y` between lines.
- The order summary as a sticky panel at `lg` and above, inline below the lines
  at narrower widths.
- Checkout as the primary action; "continue shopping" as a quiet secondary.

**Mobile deliberately has no sticky checkout bar.** `MobileBottomNav` is already
fixed to the bottom of every storefront page; a second fixed bar would sit on
top of it or push it out of the safe area. On a cart — a short list the shopper
scrolls to the end of anyway — the inline summary reaches the action just as
fast without fighting the shell.

## 8. The reusable cart line

`components/cart/CartLine.tsx`. One component at three densities (`page`,
`drawer`, `summary`), rendered by the cart page, the drawer, the checkout's
read-only item review and the order confirmation.

It takes a pre-formatted `CartLineView`, because three different authorities
produce lines — the AWJ cart, the AWJ order, and Spree's `LineItem` on the
wholesale surface — and each already carries its own authoritative money. The
adapters (`awjCartLineView`, `awjOrderLineView`, `spreeCartLineView`) map; the
component never multiplies, sums or converts an amount.

Shown per line: image, name (linked when there is something to link to), variant
descriptor, unit, per-unit price when the quantity is above one, quantity
control, remove control, and the **server's own line total** — never
`unitPrice × quantity` recomputed in the browser.

## 9. A real defect this pass fixed

The merged cart page and drawer printed `formatMinorAmount(line.unitPrice)` for
**every** line, including unavailable ones. Because
`CommerceCartService::serialize()` zeroes both amounts for a line it cannot
resolve, an unavailable product was rendering as **"٠٫٠٠ ر.س."** — a price of
zero beside a product, which reads as free.

An unavailable line now shows no money at all: the dimmed image, the name, the
unavailable badge, a disabled quantity control, an enabled remove button (the
one mutation the backend still allows), and "غير متاح" / "Not available" where
the total would be. Covered by a test that asserts no `٠٫٠٠` is rendered.

## 10. Cart drawer

Redesigned on the same tokens and rebuilt on `CartLine`, so the drawer is a view
of the cart rather than a second cart. It keeps both authorities: the root
layout mounts it inside the DTC provider (AWJ carts) and `WholesaleGate` mounts
its own inside a Spree provider. Express checkout still renders for Spree carts
only, and the wholesale "view cart" link is unchanged.

Line imagery is fetched only while the drawer is open.

## 11. Empty cart

`components/cart/CartEmptyState.tsx`, one component for the page and the drawer.
It states the fact and offers the one action that resolves it. It does **not**
fill the space with recommendations: AWJ exposes no product relationship
(design-first policy §5.5), and an arbitrary slice of the catalogue presented as
a suggestion would be a claim.

## 12. Order summary

`components/cart/CartSummary.tsx`, shared by the cart page and the checkout.

**There is deliberately no "Total" row before the order exists.** The cart
payload carries exactly one figure, `subtotal`. The checkout adds only
`delivery.amount`, which is a hard server-side `0`. Adding those two in the
browser and labelling the result "Total" would be a client-authoritative total —
a promise the server never made, and one that would silently become wrong the
day delivery pricing or tax lands while this component kept summing two of the
three figures.

So the panel shows: a delivery row (method, or "calculated at checkout", never a
price), the subtotal as the hero figure, and one line stating that the final
amount is confirmed when the order is placed. The **confirmation** shows a
total — `order.total`, which the server computed.

No tax row and no discount row are rendered. Neither figure exists in any
payload, and a zero in either place would be a monetary assertion with no
source.

## 13. Coupon field — DESIGN_ONLY

`components/cart/CouponField.tsx`, in the cart summary and the drawer footer.

Collects a code and, on submit, says that promotions are not enabled for this
store yet. It reports no discount, changes no displayed amount, claims no
acceptance, and makes no request — there is nothing to call. The typed value
lives in component state for the life of the page: **no cookie, no
`localStorage`**, asserted by a test that spies on `Storage.prototype.setItem`
and the `document.cookie` setter.

Missing contract, for later closure: `POST store/v1/cart/coupon {code}` and
`DELETE store/v1/cart/coupon`, plus — structurally the larger part — a
server-computed `discount` and `total` on the cart serializer, since a discount
the storefront derived from a subtotal would be a client-authoritative
calculation.

## 14. Six-stage checkout

`Contact → Address → Delivery → Payment → Review → Confirmation`, with a
progress ladder (`CheckoutProgress`) that reports position and is not a
navigation control.

Each stage owns one endpoint and saves on its own "continue", so the server
holds a complete stage or none of it. A refused save keeps the shopper on the
stage with the server's message; the flow never advances past something the
server rejected. Back navigation re-saves nothing.

Per-stage detail:

1. **Contact** — exactly the three fields `PATCH checkout/contact` accepts. No
   account creation, no marketing opt-in: the controller rejects unknown keys,
   and a consent checkbox would be a record with no home.
2. **Address** — the seven fields `PATCH checkout/address` accepts. Country and
   region are **text inputs, not selects**: AWJ exposes no country or region
   reference data, and a bundled ISO list would look authoritative while the
   backend validated none of it — and would quietly assert which countries this
   store ships to.
3. **Delivery** — the two real methods, each with a description and no price, no
   estimate and no date. One line states that the delivery charge is set by the
   store.
4. **Payment** — DESIGN_ONLY, see §15.
5. **Review** — everything read back from the server's checkout, not from the
   draft forms, with per-section edit links. A notice states exactly what
   placing the order does.
6. **Confirmation** — see §17.

## 15. Payment stage — DESIGN_ONLY / GATED

The journey has a payment moment, so the moment is designed. Nothing behind it
is pretended:

- **No provider is named and no brand mark is shown anywhere.** A payment mark
  is a commercial claim about who this store can charge you through, and the
  platform has made none. Enforced by an architecture test whose pattern covers
  providers and card schemes nobody has asked for, so reaching for any of them
  fails CI.
- **The three method types are shown dashed, dimmed and badged "not enabled",
  and none is selectable.** They are the shape of the choice, not an offer of
  it.
- **No card field exists in the component.** Card data must never pass through
  AWJ; when this activates, the provider's own element takes this space.
  Asserted by a test that counts zero `<input>` and zero `<form>`.
- **Continuing calls nothing.** Asserted by a flow test: three PATCHes for three
  real stages, and the payment stage adds none.

Missing contract: `GET store/v1/checkout/payment-methods`,
`POST store/v1/checkout/payment-intent`, `complete` requiring a settled or
authorised intent instead of confirming on its own, plus a server-verified
webhook receiver processed idempotently in a trusted tenant context.

## 16. Checkout shell and the MobileBottomNav decision

The AWJ checkout moved from `(storefront)` to a new `(store-checkout)` route
group. The URL is unchanged — a route group carries no segment — and the Spree
`(checkout)` group is untouched.

The shell drops the category rail, the search field, the cart button, the
marketing footer and `MobileBottomNav`, keeping one way out: a link back to the
cart. Two reasons, both structural:

1. Each of those is a way out of a flow the shopper has chosen to enter. A
   checkout that keeps offering the catalogue competes with itself.
2. `MobileBottomNav` is `fixed` to the bottom of the viewport. The place-order
   action needs that space on a phone, and stacking a second fixed bar is how a
   primary action ends up behind a tab bar or under the safe area.

`CartProvider`, the cart drawer and the toaster still come from the `[locale]`
layout above, so it is different chrome over the same session, not a different
app.

## 17. Confirmation

The first and only place in the journey that shows a total, and it shows the
server's `order.total`. Nothing is added up.

It states what `confirmed` actually means — a commercial commitment, with no
payment taken — as the screen's subject rather than a footnote. Saying "thank
you for your payment" here would be the single most damaging untruth this
storefront could tell.

It deliberately offers no tracking link, no delivery date, no shipment status
and no receipt download. `CommerceOrder != Invoice`, there is no guest
order-lookup route, and no fulfilment status exists. Printing the page is the
only "keep a copy" this storefront can honestly offer, and that is what the
secondary action does.

## 18. Failure states

| Failure | Source | Presentation |
|---|---|---|
| Empty cart at checkout | `cart.items.length === 0` | Named state, route back to the catalogue |
| Missing/expired cart or checkout | `not_found` from `createOrResume` or `complete` | Named state, route back to the cart |
| `review_required` — contact incomplete | 409 `error.details.items` | Banner listing the reasons, returned to the contact stage |
| `review_required` — delivery method missing | 409 | Banner, returned to the delivery stage |
| `review_required` — empty cart | 409 | Switches to the empty state |
| `review_required` — availability / price / stock | 409 | Banner, **stays on review**, where the refreshed lines carry the up-to-date `available` flags that explain the change |
| `idempotency_conflict` | 409 | The server's message; the persisted key is deliberately **kept** so a genuine replay still works |
| A refused stage save | Any PATCH failure | The server's message, stage unchanged |
| Transient/unknown error | Any | The server's message; success is never claimed |

## 19. Tenant / security assessment

No change to tenant resolution, storefront context, cart identity, the gateway
secret boundary, RBAC or any backend permission. `getCartLineImages` is a server
action calling the same tenant-scoped `store/v1` catalogue the listing uses; it
adds no new endpoint and reaches nothing new. The cart token stays HttpOnly and
server-side. No server secret reaches the browser. No accounting posting,
inventory or reservation behaviour was touched. `CommerceOrder` is still not an
`Invoice`.

## 20. Data-authority decisions

- Every amount is printed from a server field. Nothing is multiplied, summed,
  converted or rounded in a component.
- `lineTotal` is the backend's figure, never `unitPrice × quantity` — a test
  makes the two disagree in its fixture and asserts only the server's is shown.
- No total is computed before the server produces one.
- `updateAwjDelivery(method)` still takes one argument, so sending an amount is
  structurally impossible from the client.
- `variant_descriptor` was already authoritative and was being dropped; it is
  now mapped and shown rather than reconstructed from anything.

## 21. Shared-component impact

- `QuantityPickerField` / `ui/quantity-picker` — unchanged.
- `CartLine` is new; nothing outside cart/checkout renders it.
- `CartDrawer` is shared with the wholesale surface and keeps its Spree branch,
  its express-checkout behaviour and its existing "view cart" destination.
- `CartContext`, `ProductCard`, the header, the category rail and the footer are
  untouched. `MobileBottomNav` itself is untouched — it is simply not part of
  the checkout shell.

## 22. Locked surfaces (§26 of the brief)

Not redesigned, and not touched by this diff: `Header`, `CategoryNav`, `Footer`,
the homepage, `ProductCard` (its visual design was not reopened), product
listing, search, and the product-detail composition.

## 23. Out of scope (§27), honoured

No new backend API, no migration or schema change, no payment gateway
implementation, no shipping/logistics backend, no accounting change, no
inventory change, no invoice redesign, no Store Customizer, no merchant theme
editor, no customer-account redesign, no wishlist backend, no reviews backend,
no recommendation engine, no unrelated refactoring, nothing from PR #794.

## 24. Temporary QA infrastructure

The visual pass ran against a local mock of `store/v1` serving catalogue, cart
and checkout in the exact shapes the Laravel services return. Its amounts and
product names are QA fixtures, clearly local-only, and **none of it is in this
diff** — the mock and the Playwright drivers live in the session scratchpad and
the two working files were removed before the final test run. No fake merchant
fact is committed as a production default anywhere.

## 25. Security / accounting / tenant guardrails

| Guardrail | Held how |
|---|---|
| Tenant isolation preserved | No tenancy code touched; the one new server action uses the existing tenant-scoped catalogue client |
| Storefront context preserved | Unchanged |
| Cart identity / token boundary preserved | The cart token stays HttpOnly and server-side; no client-visible cart id was introduced |
| Gateway-secret boundary preserved | Mutations still go through the existing server-side transport |
| No server secret in the browser | Nothing added to client bundles beyond UI |
| No client-authoritative price | Every price is a server field |
| No client-authoritative tax | No tax is rendered at all |
| No client-authoritative discount | No discount is rendered at all; the coupon field applies nothing |
| No client-authoritative shipping amount | No delivery amount is rendered; the client cannot send one |
| No client-authoritative total | **No total is computed anywhere**; only `order.total` is shown |
| No fake payment state | The payment stage is inert and says so; the confirmation states no payment was taken |
| No fake order state | Order fields come from `serializeOrder()` |
| `CommerceOrder != Invoice` | No invoice, receipt or document is offered |
| No accounting posting change | None |
| No inventory / reservation change | None |
| No backend permission change | None |

## 26. Changed files

**New — cart**
- `storefront/src/components/cart/CartLine.tsx`
- `storefront/src/components/cart/CartSummary.tsx`
- `storefront/src/components/cart/CartEmptyState.tsx`
- `storefront/src/components/cart/CouponField.tsx`

**New — checkout**
- `storefront/src/components/checkout/CheckoutProgress.tsx`
- `storefront/src/components/checkout/awj/{StageShell,ContactStage,AddressStage,DeliveryStage,PaymentStage,ReviewStage,Confirmation,types}.tsx|ts`
- `storefront/src/app/[country]/[locale]/(store-checkout)/layout.tsx`
- `storefront/src/app/[country]/[locale]/(store-checkout)/checkout/page.tsx`

**New — data**
- `storefront/src/lib/data/cart-media.ts`
- `storefront/src/hooks/useCartLineImages.ts`

**Changed**
- `storefront/src/app/[country]/[locale]/(storefront)/cart/page.tsx` (rebuilt)
- `storefront/src/app/[country]/[locale]/(storefront)/checkout/page.tsx` (moved to the new group)
- `storefront/src/components/cart/CartDrawer.tsx` (rebuilt on `CartLine`)
- `storefront/src/components/checkout/AwjCheckoutFlow.tsx` (rebuilt as six stages)
- `storefront/src/lib/commerce/capabilities.ts` (four new declarations)
- `storefront/src/lib/commerce/cart-types.ts` (`variant_descriptor`, `product_variant_id`)
- `storefront/messages/{ar,de,en,es,fr,pl}.json`
- `docs/plans/store/AWJ_STOREFRONT_DESIGN_SYSTEM.md`
- `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`

**Tests**
- New: `CartLine.test.tsx`, `CartSummary.test.tsx`, `CouponField.test.tsx`, `PaymentStage.test.tsx`, `useCartLineImages.test.tsx`
- Extended: `AwjCheckoutFlow.test.tsx`, `AwjCheckoutFlow.architecture.test.ts`, `cart-types.test.ts`

## 27. Design-system document reconciliation

`AWJ_STOREFRONT_DESIGN_SYSTEM.md` said unsupported stages were to be *activated
only as backend capabilities exist*, and §11 said to scope *only against real
Commerce contracts available at implementation time*. Read literally, both meant
"omit it until the backend lands", which the owner's decision supersedes.

A new **Design-first reconciliation** section now states the rule explicitly:
design completeness is not gated on the backend; activation is gated on it
absolutely; and what design-first never licenses is unchanged. The checkout
stage list was corrected to the six stages, and §11's STORE-UI-4 scope was
rewritten to match.

The design-first policy's register gained §5.2 (Payment), §5.3 (Coupons) and a
rewritten §5.8 (Shipping/delivery pricing, plus the separate deferred tax case),
each with all five items the policy requires.

## 28. Visual QA method

Playwright + the pre-installed Chromium, driven through the whole journey rather
than screenshotting routes in isolation: the cart, the drawer opened from the
catalogue, then each checkout stage reached by actually filling and submitting
the previous one, through to a placed order.

Widths 390 / 768 / 1024 / 1440, in Arabic RTL and English LTR. Horizontal
overflow asserted on every capture.

## 29. Screenshots captured

Per locale and width: cart (fold and end), cart drawer, checkout stages 1–6
including the delivery stage before and after a method is chosen, the review
stage (fold and end), and the confirmation (fold and end). Plus the two cart
scenarios at 390 and 1440 in both locales: a cart containing an unavailable
line, and an empty cart with its checkout.

**No horizontal overflow at any width, on any surface, in either direction.**

## 30. Defects found and fixed during visual QA

1. **A false zero price on unavailable lines** (§9) — pre-existing in the merged
   cart and drawer, found by reading the serializer and confirmed on screen.
2. **The English checkout shell rendered Arabic chrome.** A bare
   `getTranslations(namespace)` in a server component of the new route group
   resolves to the configured default locale, not the segment's. Now resolved
   explicitly from the route's `locale` param.
3. **Cart line spacing.** `mt-auto` plus an oversized quantity control left the
   line total wrapping below the picker and drifting out of alignment at 390.
   The row is now a single non-wrapping line, and the per-unit price moved under
   the name where it belongs.
4. **A two-tone drawer body.** The scroll region showed the page background
   behind the last line; it is one surface now.
5. **The order confirmation never loaded its line imagery.** `useCartLineImages`
   marked every requested product as "resolved" *before* its request came back,
   so an effect torn down before that request settled discarded the result while
   leaving the claim in place — the id was then never looked up again. React's
   development double-invoke hits this on any component that mounts with its ids
   already known, which is exactly the confirmation. The hook now releases its
   claim on teardown. Found on screen, root-caused in the hook, and covered by a
   test that was **verified to fail against the previous implementation** before
   the fix was restored.

## 31. Known visual differences

- **No delivery price, estimate or date** anywhere. None exists.
- **No payment methods offered** — the stage shows their shape, marked not
  enabled.
- **No total before the order**, for the reason in §12.
- **No tax line**, for the reason in §12.
- **No recommendations on the empty cart** and none on the confirmation.
- **Money is formatted `ar-SA` in every locale.** This is pre-existing
  storefront behaviour (`formatMinorAmount`, and `mappers.ts` for catalogue
  prices) and was not changed here — doing so would touch catalogue pricing and
  belongs in its own pass. Every amount is wrapped in `<bdi>` so it isolates
  correctly inside English text.

## 32. Risks

- `CartDrawer` is shared with wholesale. Its Spree branch is preserved and its
  test still passes, but the blast radius is wider than the DTC cart alone.
- The checkout route moved between route groups. The URL is unchanged and the
  production build resolves it, but anything holding a route-group-relative path
  would need checking.
- `getCartLineImages` issues one catalogue request per distinct product in the
  cart. It runs only on surfaces that render imagery, is memoised per mount and
  fails soft, but it is real traffic that did not exist before.

## 33. Deferred, with contracts recorded

Tax presentation, order tracking, invoice/receipt, saved addresses, express
checkout on the AWJ surface, and the two `DESIGN_ONLY` capabilities awaiting
activation (payment, coupons) plus delivery pricing. Each is in the design-first
register or in `capabilities.ts` with the contract that would close it.

## 34. Tests

```
npx vitest run     →  65 files, 506 tests passed  (31 new in this pass)
pnpm check         →  347 files, no fixes applied
pnpm check:locales →  all 6 locales in sync
npx tsc --noEmit   →  clean
pnpm build         →  Compiled successfully
```

New in this pass: the server's line total is printed rather than a recomputed
one · an unavailable line shows no money · the variant descriptor is shown · an
unavailable line is never linked · the summary density offers no controls · the
coupon is declared `design_only`, answers with the capability message, refuses
an empty code and **writes nothing to browser storage** · the payment stage is
declared `design_only`, says it is not enabled, offers no selectable method and
collects no card data · the summary renders no total, no tax row and no discount
row, and never calls the unpriced delivery free · the checkout starts on contact
and shows one stage at a time · each stage saves to its own endpoint as the
shopper advances · **the payment stage calls no server action** · back
navigation re-saves nothing · the contact stage blocks until name and phone are
entered · a refused save keeps the shopper on the stage · no total before the
order and the server's total after · a stock `review_required` stays on review.

Plus four on `useCartLineImages`: an in-flight result survives an effect re-run
(the §30.5 regression, checked against the old implementation), a product is
requested once rather than once per render, a disabled surface requests nothing,
and a failed lookup leaves the placeholder rather than breaking the line.

Architecture guards extended from one file to the whole AWJ checkout directory,
and two new ones added: no payment provider or card scheme may be named
anywhere, and the payment stage may collect no card data.

## 35. Build

`pnpm build` compiles successfully. `/[country]/[locale]/checkout` resolves from
the new route group; `/[country]/[locale]/cart` and the Spree
`/[country]/[locale]/checkout/[id]` are unchanged.

## 36. Confirmation

- Nothing was merged and nothing was deployed.
- No backend API, migration or schema was added or changed.
- No authoritative persistence was faked, and no browser storage stands in for
  business persistence.
- No checkout, payment, shipping, coupon, tax, delivery-date or inventory fact
  was manufactured.
- No client-authoritative price, tax, discount, shipping amount or total exists
  in this diff.
- Tenant isolation, storefront context, cart identity and the gateway-secret
  boundary are unchanged.
- Locked surfaces were not redesigned.
- Temporary mock infrastructure was removed before the final test run.

## 37. Next step

The owner's visual review. On approval, merge; the two `DESIGN_ONLY`
capabilities and delivery pricing then become dedicated backend tasks against UI
that is already agreed, each with its contract already written down.
