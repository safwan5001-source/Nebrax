# AWJ Commerce — H6 Batch K: native wholesale buyer session, cart and checkout

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-k` |
| PR | __PR__ |
| Base SHA (origin/main, #1823 merge) | `a5f4ea7ceea4c44851b7873bac0fa43d0c7f0b3e` |
| Head SHA | __HEAD__ |

**Status.** Wholesale is **not** activated (`commerce.wholesale_buyer_enabled` stays off); nothing merged, deployed or run against live data; email verification is untouched; no VAT, credit, MOQ or minimum-order policy was added; no second checkout engine was created; the Spree wholesale routes and checkout are **not** removed (parity is unproven) and the Spree exit is **not** complete. Prepared for ChatGPT review.

## 1. The precise gap this batch closed

Batches H–J built the backend contract (approved membership re-checked on every request, order ownership, approved price precedence, fail-closed unavailable state). What was missing was on the **storefront side only**:

| Missing boundary | Evidence | Closed by |
|---|---|---|
| The buyer's session reached `store/v1` **catalogue reads only**; `storefrontCartRequest` (the single transport for cart, checkout, payment-method and payment-intent calls) never sent it, so an approved buyer's cart/checkout calls arrived anonymous and were refused (401). A Batch G guard test *forbade* forwarding it. | `config.ts`; `wholesale-buyer.architecture.test.ts` | §3.1 |
| A refusal (signed out / not approved / suspended / no eligible price) surfaced as the backend's raw text or a generic toast; an unavailable product read as "Out of stock". | `actionResult`, `CartContext`, `ProductCard` | §3.3–3.4 |
| No machine-readable reason for "unavailable for wholesale" on cart add/update. | `StorefrontCartController` | §3.2 |

The native wholesale host already runs the AWJ-native cart and checkout (the `(storefront)` and `(store-checkout)` route groups on the `dtc` surface): once the token flows, there is **one** cart and **one** checkout for both. The Spree-backed `(wholesale)` surface is a separate legacy path and is untouched.

## 2. The completed buyer journey (actual routes)

| Step | Storefront route / action | Backend route (`store/v1`) | Boundary enforced |
|---|---|---|---|
| Register | `/buyer/register` → `registerBuyer` | `POST auth/register` | neutral 202; verification mail (Batch H) |
| Confirm e-mail | `/buyer/verify?token=` (click-to-confirm) → `verifyBuyerEmail` | `POST auth/verify-email` | token hashed, single-use, bound to tenant + channel |
| Sign in | `/buyer/sign-in` → `signInBuyer` | `POST auth/login` | unverified refused; per-tenant+IP and per-email limits unchanged |
| Membership | `/buyer/membership` | `GET wholesale/membership`, `POST wholesale/application` | pending / rejected / suspended / approved shown |
| Browse | `/products`, product page | `GET products`, `GET products/{id}` | 401 → sign-in gate, 403 → approval gate; approved precedence; unavailable state |
| Cart | `/cart`, drawer | `GET cart`, `POST cart/items`, `PATCH/DELETE cart/items/{id}` | **buyer token now forwarded**; membership + price re-checked on every call |
| Checkout | `/checkout` stages: contact → address → delivery → (gift/schedule) → payment → review | `POST checkout`, `PATCH checkout/{contact,address,delivery,gift,schedule,payment}`, `GET checkout/payment-methods` | same; payment method = what the channel offers (no new policy) |
| Confirm | review → confirmation | `POST checkout/complete` + `Idempotency-Key` | membership re-checked under lock, prices re-resolved under lock, replay by key, order owned by the buyer, line price source recorded |

"Address selection" in the native checkout is the existing typed contact/address stage; there is no saved-address book for buyer identities and none was invented.

## 3. What changed

### 3.1 Session propagation (storefront transport)
`storefrontCartRequest` now reads the buyer token **server-side** from the HttpOnly cookie (`awj_buyer_session`: HttpOnly, SameSite=Lax, host-only, `Secure` in production) and sends it only as the `X-Customer-Token` header on the server-to-server call, together with the forwarded host and gateway secret it already sent.
- Never in a URL, request body, log, browser storage or a returned value (architecture test).
- A caller-supplied header of that name is **discarded** (case-insensitive); the identity can come only from the server-held session.
- No buyer cookie ⇒ the request is byte-identical to before (every DTC visitor): header set unchanged (tested).
- Tenant/channel binding, revocation and membership checks are the backend's, on every request (Batches G–J); the token is host-scoped and the backend binds it to the channel the forwarded host resolves to.
- ERP administrator authentication is not involved anywhere (buyer identities are a separate system).
- CSRF: the buyer actions are Next.js server actions (framework origin/host check), cookies are SameSite=Lax HttpOnly, and the backend refuses mutations without the gateway secret. No additional CSRF token was added; this is the existing posture.
- Login rate limiting is untouched; no forwarded-visitor-IP header is read or trusted (D-T1 remains open).

### 3.2 Backend: machine-readable unavailable reason
`CommerceCartLineNotPurchasableException` carries an optional `reason`; `StorefrontCartController::store/update` answer **422 `validation_failed` with `error.details.reason = "unavailable_for_wholesale"`** only when a wholesale channel has no eligible price. Every other refusal, and every non-wholesale channel, is `abort(422)` exactly as before (tested). No migration; no new error code.

### 3.3 Storefront states (AR/EN mobile-first, existing components and tokens)
| State | Where it appears |
|---|---|
| Login required | cart view and drawer (gate card → buyer sign-in), toast on a refused cart/checkout action |
| Email verification required | existing register "check your email" / verify / resend pages and the sign-in resend link (Batch H); sign-in failures stay indistinguishable by design |
| Membership pending / rejected / suspended / approved | existing `/buyer/membership` panel; cart view for a not-approved buyer links there; approved copy now states that ordering is available (was "not available yet") |
| Product unavailable for wholesale | card, quick view and product page show "Not available for wholesale" instead of "Out of stock"; add-to-cart disabled; the line toast says so |
| Cart / checkout validation failure | checkout shows the store's localized wording for a wholesale refusal and keeps the existing per-line `review_required` reasons (e.g. "price could not be confirmed") |

All strings exist in the six locales (`ar en de es fr pl`, parity check green). No redesign.

### 3.4 Action results
`actionResult` and the checkout actions gain an **additive** `purchaseIssue` (`sign_in_required` | `approval_required` | `unavailable_for_wholesale`), present only for a wholesale refusal; every other result is byte-identical (tested).

## 4. Evidence

### 4.1 Backend (SQLite and PostgreSQL) — `WholesalePricePrecedenceTest` now 30 tests (+4)
The unavailable reason on add and update (and its absence on DTC); the full journey (login-equivalent token → cart → checkout → payment methods → complete) producing **one** order owned by the authenticated buyer, priced 500×2 (partner) + 900 (channel fallback), idempotent replay by key, no invoice/payment/journal entry; suspended buyer retains the cart row untouched, is refused 403 on read, add, update and complete, and the same cart resumes on reinstatement; a cart cookie from one wholesale channel never resolves on another and `complete` returns 404 with no order. Batch J's 26 tests (precedence, isolation, revoked session, browser price override, price-list change between cart and checkout, provenance, DTC) still pass unchanged, with the PostgreSQL race tests (concurrent price-list deactivation vs checkout).

### 4.2 Storefront
- `cart-buyer-token.test.ts` (5): token sent as header with host + gateway secret and never cached; never in URL or body; absent ⇒ DTC request unchanged; caller cannot supply or override it.
- Architecture guard rewritten (disclosed in §7): the token reaches cart/checkout/payment **only** through the one transport; `getBuyerToken` is imported by exactly three modules; header-only placement.
- Classifier, `actionResult` additivity, `CartContext` (access issue, localized toast, DTC untouched), `CartEmptyState` (en + ar), mappers (null price, flag only when unavailable).
- Totals: tsc 0; Biome 5 warnings / 3 infos (unchanged baseline); vitest 250 files, 3,572 passed; locale parity OK; `pnpm build` exit 0.

### 4.3 DTC compatibility
No DTC response shape changed: no `wholesale_availability`, no `error.details.reason`, no extra `actionResult` key, no extra request header, no `wholesale_unavailable` on the view model. The DTC cart/checkout/order/price/offer/flowers suites pass unchanged on both engines.

### 4.4 Payment and accounting invariants
No accounting, VAT, ZATCA, payment-capture, order-lifecycle or cancellation code changed, no migration, no policy added. A wholesale order still posts nothing and captures nothing (asserted in the journey test). No payment capture is initiated by any test.

## 5. Test results

| Gate | Result |
|---|---|
| Affected backend suites, SQLite | 810 passed, 41 skipped (PostgreSQL-only) |
| Same suites, PostgreSQL | 851 passed |
| Full backend suite, SQLite | __FULLSUITE__ |
| Storefront tsc / Biome / vitest / locales / ratchet / build | 0 / baseline / 3,572 passed / OK / OK / exit 0 |
| CI / CI Gate | __CI__ |

Environment note: `Fuel*` tests need `ext-bcmath`, absent locally only.

## 6. Spree dependency counts (ratchet)
| Metric | Before | After |
|---|---|---|
| spree_value_imports | 4 | 4 |
| spree_type_imports | 4 | 4 |
| spree_client_access | 52 | 52 |
| spree_wrapper_imports | 69 | 69 |
| spree_env_reads | 9 | 9 |

Unchanged **deliberately**: no legacy wholesale route is removed. The native replacement is implemented and tested at unit/integration level, but there is no browser end-to-end run against a real wholesale deployment and no operator parity evidence, so per the brief the guarded legacy behaviour is preserved. The `(wholesale)` route group and the Spree wholesale cart remain.

## 7. Existing tests changed (disclosure)
1. `wholesale-buyer.architecture.test.ts` — the Batch G test "the buyer token rides ONLY on price-bearing catalogue reads — never cart, checkout, payment or orders" encoded the *interim* rule that held until the backend contract existed. It is replaced by a stricter test of the new rule (single transport, header-only, three importers) and the old assertion that no feature module references the token is **kept** as its own test.
2. `CartContext.test.tsx` — the provider reads `getAwjCartState()` instead of `getAwjCart()`; the existing cases are unchanged in meaning (an adapter keeps them readable), four new wholesale cases added.
3. `wholesale-buyer-ui.test.tsx` — the Batch G test "approved copy is honest that online ordering is not available yet" asserted copy that is no longer true; it now asserts the new copy (ordering available) and the absence of the old claim.
Nothing was skipped or weakened; no backend test was modified.

## 8. Remaining blockers and risks
1. **Not activated and not proven in a browser.** No end-to-end run of sign-in → cart → checkout in a real browser against a wholesale deployment exists; coverage is unit/integration + build. This is the main reason the Spree wholesale routes stay.
2. **Trusted visitor IP (D-T1)** still open: all buyers share one gateway login bucket; no forwarded IP is trusted.
3. **Production mail** (`MAIL_MAILER=resend`, `RESEND_KEY`, sender domain) unverified — buyers cannot verify e-mail without it.
4. **Payment**: methods are exactly what the channel offers; online payment remains behind its own gates; wholesale terms/credit/COD policy, MOQ, minimum order and B2B tax display remain undecided (D-M1/M2/X1/P1/P2).
5. A signed-out buyer sees a gate in the cart; the *quick sign-in return-to-cart* redirect is not implemented (the buyer returns via the normal navigation).
6. Offers never discount on wholesale (Batch J decision) — owner confirmation pending.

## 9. Recommended Batch L
1. **Browser end-to-end proof** against a seeded wholesale staging tenant (Playwright, no payment capture): register → verify → sign in → apply → approve (staff) → browse → add → checkout → order, plus suspended and revoked-session paths, in Arabic and English; record the evidence.
2. Operator evidence for the storefront→API proxy chain (D-T1) and then the signed visitor identity.
3. Owner decisions: MOQ, minimum order, B2B tax display, terms/COD.
4. Only after (1): retire the Spree wholesale routes slice by slice behind the ratchet, keeping the legacy path until parity is shown.
