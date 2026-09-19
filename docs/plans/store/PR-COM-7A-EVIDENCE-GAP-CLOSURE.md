# PR-COM-7A — Cart / Checkout Commercial Validation
## Evidence & Gap Closure Report

> هذه الجولة فحص وتوثيق فقط. لا تعديل على كود التطبيق، لا migration، لا
> refactor، لا إصلاح لأي Gap، لا implementation PR، لا Merge، لا Deploy،
> لا Production Release. كل حكم أدناه مدعوم بدليل repository من
> `origin/main` الحالي، لا بافتراض.

---

## 1. Executive Summary

السؤال الأساسي: *"What requirements originally assigned to PR-COM-7A are
already implemented by the current Cart / Checkout / Commerce code, and
what exact gaps — if any — remain?"*

الإجابة المدعومة بالدليل: **كل متطلبات COM-7A الجوهرية — كما هي معرّفة في
`AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` §PR-COM-7A ومعماريّات
Cart/Checkout المعتمدة — منفّذة ومختبَرة على `main` الحالي** عبر سلسلة
الـPRs المستقلة التي نُفّذت بعد تقرير COM-6C التاريخي (الذي ذكر وقتها أن
COM-7A لم يبدأ): Cart V1 (COM-CART-2)، Checkout V1 (COM-CHECKOUT-1A/1B)،
Cart One-Shot Lifecycle، وسلسلة Public/Mobile Commerce API (PR-1 → PR-5،
آخرها PR #877 المدموج).

من أصل **26 متطلباً** مستخرجاً حرفياً من وثائق السلطة:

- **23 IMPLEMENTED** — بدليل كود + اختبارات خضراء على SQLite وPostgreSQL.
- **0 PARTIALLY_IMPLEMENTED**، **0 MISSING**.
- **1 SUPERSEDED** — variant identity في سطور الطلب (نُفّذت لاحقاً عبر
  مسار VAR-COM-1 المستقل؛ وهي أصلاً خارج إغلاق COM-7A بحكم Master Plan
  Phase 14).
- **2 OWNER_DECISION_REQUIRED** — كلاهما قرار **policy** غير محسوم في
  وثائق السلطة نفسها، وكلاهما **موثَّق كمؤجَّل بعلم المالك** ولا يشكّل
  Gap برمجياً قابلاً للإغلاق دون قرار جديد:
  1. توقيت/ربط الحجز المخزوني (ADR-02 §5 — "partially undecided" بنصّ
     الوثيقة؛ CHECKOUT-1B يتحقق من التوفّر لحظياً فقط ولا يحجز — بنصّ
     `AWJ_CHECKOUT_V1_ARCHITECTURE.md` §8).
  2. سياسة اكتمال بيانات التواصل/التوصيل لكل طريقة توصيل (P2 المؤجَّل
     المعروف من PR #836؛ لا policy معتمدة تربط حقول العنوان/الهاتف
     بـ`pickup`/`standard`).

**Closure Classification: COM-7A FUNCTIONALLY COMPLETE — DOCUMENTATION
CLOSURE ONLY**. لا حاجة لأي Code PR. القراران المفتوحان أعلاه لا يخصّان
إغلاق COM-7A — يخصّان مراحل لاحقة (Fulfillment/ADR-02، وسياسة بيانات
التوصيل) — ويوثَّقان هنا حتى لا يضيعا.

---

## 2. Current Repository State

- **Evidence baseline at inspection:** `93fd702481b5db15fc88fcd42054fb21b49390b7`
  (PR #877 merge SHA). The documentation branch was later fast-forwarded to
  current `main` before this report was committed; no production code was
  changed by this documentation closure.
- **Repository cleanliness at inspection:** worktree clean before the report.
- **Merged implementation history:** COM-0 → COM-6C; COM-7-P0 → P2B;
  COM-CART-2; COM-CHECKOUT-1A/1B; Cart One-Shot Lifecycle; Public/Mobile
  Commerce API V1 PR-1 → PR-5; VAR-COM-1 and VAR-INV-1.

---

## 3. Original COM-7A Contract

From `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` §PR-COM-7A:

> **Goal:** server-authoritative checkout validation.
> Validate at checkout:
> - listing/channel availability;
> - current commercial pricing;
> - ATS/reservation policy;
> - customer/guest required data;
> - fulfillment source;
> - shipping selection;
> - totals/currency;
> - idempotency key.
> **Client totals are never authority.**

COM-7A depends on COM-6A/6B (authenticated ownership) and COM-6C (immutable
snapshot). Complementary authorities: `AWJ_CART_V1_ARCHITECTURE.md`,
`AWJ_CHECKOUT_V1_ARCHITECTURE.md`,
`PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`, ADR-02, ADR-03, and
COM-6A/6B/6C implementation reports.

---

## 4. Requirement Evidence Matrix

| ID | Requirement | Evidence | Status | Notes |
|---|---|---|---|---|
| COM-7A-01 | listing/channel availability at completion | `CommerceCheckoutService::revalidateAndPrice()`; unpublished-product completion tests | IMPLEMENTED | — |
| COM-7A-02 | current commercial pricing | `CommercePriceResolver::resolve()` at completion; unresolved-price tests | IMPLEMENTED | — |
| COM-7A-03 | ATS availability check | locked `ProductWarehouseStock` minus active reservations; insufficient-stock test | IMPLEMENTED | instantaneous check only |
| COM-7A-04 | reservation timing policy | `CommerceOrderReservationService::reserve()` exists but checkout does not call it; ADR-02 §5 says policy remains partially undecided | OWNER_DECISION_REQUIRED | **P2** |
| COM-7A-05 | required customer/guest data | completion requires `contact_name` and `delivery_method`; shared validators | IMPLEMENTED | — |
| COM-7A-06 | delivery/contact completeness per method | phone optional; address fields not mapped to pickup/standard policy | OWNER_DECISION_REQUIRED | **P2** |
| COM-7A-07 | fulfillment source | `FulfillmentPolicyService::resolveWarehouseFor()`; missing policy → review-required | IMPLEMENTED | — |
| COM-7A-08 | server-authoritative shipping selection | known delivery methods; no client monetary authority | IMPLEMENTED | shipping pricing engine deferred |
| COM-7A-09 | server-authoritative totals/currency | integer minor units; tenant currency; server recomputation | IMPLEMENTED | — |
| COM-7A-10 | completion idempotency key | required on checkout completion in web/mobile | IMPLEMENTED | — |
| COM-7A-11 | client totals never authority | narrow validators; no client price/total/currency authority | IMPLEMENTED | — |
| COM-7A-12 | product eligibility | product active + channel listing + tenant scope | IMPLEMENTED | — |
| COM-7A-13 | quantity/cart validation | positive quantities; unavailable-line behavior; consumed-cart rejection | IMPLEMENTED | — |
| COM-7A-14 | commercial revalidation before commitment | product/listing/unit/variant/price/stock revalidated at completion | IMPLEMENTED | — |
| COM-7A-15 | customer identity | guest supported; identity server-derived; authenticated commerce adoption deferred by architecture | IMPLEMENTED | — |
| COM-7A-16 | Partner authority | trusted CustomerContext/CustomerPartnerLink only; guest null | IMPLEMENTED | — |
| COM-7A-17 | immutable order snapshot | CommerceOrderSnapshot created atomically; confirmed snapshot frozen | IMPLEMENTED | — |
| COM-7A-18 | one order per purchase cycle | completion atomically creates order, completes checkout, consumes cart | IMPLEMENTED | unique checkout/order guard |
| COM-7A-19 | idempotency replay/conflict | same key → same order; different key → conflict | IMPLEMENTED | — |
| COM-7A-20 | tenant isolation | Cart/Checkout/Order/Product/Listing/Channel/Identity/Partner scoped | IMPLEMENTED | cross-tenant/channel tests |
| COM-7A-21 | web/mobile parity | shared services and semantics; intended storefront-id difference only | IMPLEMENTED | — |
| COM-7A-22 | historical consumed-cart backfill | authoritative CommerceOrder linkage + explicit tenant matching | IMPLEMENTED | migration tests |
| COM-7A-23 | consumed-cart replay edge case | order-linked completed Checkout preferred over newer open Checkout | IMPLEMENTED | lifecycle test |
| COM-7A-24 | consumed token expiry | status remains consumed; expired token cannot authorize replay | IMPLEMENTED | lifecycle tests |
| COM-7A-25 | accounting/payment/ZATCA/inventory boundary | no unauthorized ledger/payment/invoice/ZATCA/stock/reservation writes | IMPLEMENTED | zero-side-effect tests |
| COM-7A-26 | variant identity in completed order lines | implemented later through VAR-COM-1 / VAR-INV-1 | SUPERSEDED | outside COM-7A closure |

**Totals:** IMPLEMENTED = 23 · PARTIALLY_IMPLEMENTED = 0 · MISSING = 0 ·
SUPERSEDED = 1 · OWNER_DECISION_REQUIRED = 2.

---

## 5. Cart Lifecycle Evidence

The approved contract is **One Cart = One Purchase Cycle = Maximum One Order**.
Successful completion changes `active → consumed`; consumed carts are immutable,
cannot start a new checkout, and require a new Cart/token for a new purchase.
Token expiry does not demote consumed to expired.

`CommerceCheckoutService::complete()` consumes the cart in the same transaction
as order creation and checkout completion. `CommerceCartService::findByToken()`
keeps consumed terminal while enforcing `expires_at`. The one-shot lifecycle
test suite covers successful completion, failed review rollback, consumed-cart
mutation rejection, second-order prevention, new-token behavior, and web parity.

---

## 6. Checkout Commercial Validation Evidence

`CommerceCheckoutService::complete()` follows the approved sequence:
transaction → lock checkout/cart → verify context → revalidate lines/prices/stock
→ recompute totals → enforce idempotency → create exactly one CommerceOrder →
mark checkout completed → consume cart → commit.

`revalidateAndPrice()` checks active product, published listing on the resolved
channel, variant identity, legal unit, resolved server price, unit conversion,
and instantaneous availability for tracked stock. Failures aggregate into
review-required response and do not create an order.

---

## 7. Pricing / Listing Authority

`CommercePriceResolver` remains the pricing authority. Channel context comes
from trusted `StorefrontContext`, not client input. Pricing/listing eligibility
is revalidated at completion rather than trusted from an old cart snapshot.
Currency comes from `Tenant.currency`. `CommerceListing` remains an eligibility
boundary, not an inventory or price authority.

---

## 8. Customer Identity / Partner Authority

Guest checkout remains fully supported: checkout-created orders have null
`customer_identity_id` and `partner_id`, with no client authority to inject
either. Authenticated Customer Platform integration uses trusted
`CustomerContext` and `CustomerPartnerLink`; adoption by the public mobile
surface remains separately governed by the approved architecture.

PR #877 added standalone guest order status with signed `X-Order-Reference`
bound to order + tenant + channel; bare order ID is never ownership proof.

---

## 9. Immutable Snapshot Evidence

`CommerceOrderService::createFromCheckout()` creates the order snapshot in the
same completion transaction. Confirmed snapshots are frozen through service and
model guards. Order lines retain product/unit/price/variant descriptor snapshots,
preserving commercial evidence after later catalog changes.

---

## 10. Idempotency / Replay / Duplicate Order Safety

`Idempotency-Key` is required on checkout completion only. Key hash and request
fingerprint are persisted on CommerceCheckout. Same key/fingerprint replays the
same order; a different key after completion conflicts and cannot create a second
order. Database uniqueness on `commerce_orders.commerce_checkout_id` is an
additional guard. PostgreSQL concurrency tests prove one-order behavior.

---

## 11. Tenant Isolation

Cart/Checkout queries scope to trusted sales-channel and storefront/mobile
context in addition to tenant scope. Product, listing, order, snapshot, identity,
Partner and reservation data remain tenant-owned. Historical raw backfill joins
match `tenant_id` explicitly. Cross-tenant, cross-channel and web/mobile boundary
tests fail closed.

---

## 12. PostgreSQL / Concurrency Evidence

Targeted PostgreSQL evidence executed during the inspection:

| Suite | Tests | Evidence |
|---|---:|---|
| StorefrontCheckoutCompletionPostgresConcurrencyTest | 2 | concurrent completion → exactly one order |
| StorefrontCheckoutPostgresConcurrencyTest | 2 | checkout create/resume concurrency |
| StorefrontCartPostgresConcurrencyTest | 9 | cart mutation/line merge concurrency |
| CommerceOrderReservationPostgresConcurrencyTest | 3 | reservation correctness |
| CommerceCartConsumedStatusMigrationTest | 13 | constraint/backfill/down behavior |
| CommerceCartOneShotLifecycleTest | 13 | lifecycle on PostgreSQL |

**Total PostgreSQL: 42 passed, 0 failed.**

---

## 13. Web vs Mobile Semantic Parity

Both surfaces share `CommerceCartService`, `CommerceCheckoutService` and
`PublicApiIdempotency`. Contact/address/delivery validation semantics are aligned.
The intended identity transport differs (web cookie vs `X-Cart-Token`), while
storefront context is non-null for web and null for mobile by design. No
unintended semantic drift was identified.

---

## 14. Accounting / Payment / Inventory Boundary

Checkout completion does **not** create journal entries/lines, stock movements,
invoices, payments, ZATCA documents, or inventory reservations. Inventory use at
completion is an availability read only. `CommerceOrder != Invoice`; commercial
order status is distinct from payment and fulfillment status. No unexpected
coupling was identified.

---

## 15. Known Deferred Items

1. **Contact/delivery completeness (P2):** name required; phone optional; address
   fields are not yet mapped to delivery methods. This requires an explicit
   product policy and is not silently fixed by COM-7A.
2. **Variant identity:** no longer deferred; later implemented through the VAR
   track and remains outside COM-7A closure.

---

## 16. Real Remaining Gaps

**No proven code gap remains inside the decided COM-7A authority.**

| # | Item | Owner decision required | Severity |
|---|---|---|---|
| G1 | Inventory reservation timing/binding | Resolve ADR-02 §5: when/how instantaneous availability becomes an actual allocation preventing oversell | P2 |
| G2 | Delivery-data completeness policy | Define required address/phone fields for `pickup` vs `standard` | P2 |

There is no P1. These are policy decisions and must not be implemented by
inventing defaults.

---

## 17. Closure Classification

> ## **COM-7A FUNCTIONALLY COMPLETE — DOCUMENTATION CLOSURE ONLY**

All requirements with decided authority are implemented and tested. G1/G2 are
explicit policy decisions, not narrow code defects. Therefore no code closure PR
is justified at this stage.

---

## 18. Proposed Next Action

1. Accept this report as COM-7A documentation closure.
2. In a later tiny docs-only change, mark COM-7A complete in the Master Plan if
   the owner wants the roadmap status updated.
3. Track G1 under the reservation/fulfillment policy path and G2 under product
   delivery policy; neither should be smuggled into COM-7A implementation.

---

## 19. Git State

- **Branch:** `docs/com-7a-evidence-gap-closure`
- **Evidence Base SHA:** `93fd702481b5db15fc88fcd42054fb21b49390b7` (PR #877 merge SHA)
- **Branch sync:** fast-forwarded to the then-current `main` before committing this report; no production code changed.
- **Files changed:** `docs/plans/store/PR-COM-7A-EVIDENCE-GAP-CLOSURE.md` only.
- **Tests executed on evidence baseline:**
  - SQLite: **264 passed, 1 skipped (PG-only by design), 0 failed** across 14 targeted suites.
  - PostgreSQL: **42 passed, 0 failed** across 6 targeted suites.

FINAL STATUS: READY FOR OWNER REVIEW
