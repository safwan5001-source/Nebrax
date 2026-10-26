# AWJ Store — Product Availability Settings (PRD)
**Status:** Proposed for Safwan review — requirements direction agreed, not implementation authorization
**Date:** 2026-10-15
**Scope:** All AWJ native storefronts; merchant store-level default + product override. Docs only.

## 1. Problem and goal
Today published storefront products can display «غير متوفر» despite company-level stock if the channel's fixed fulfillment warehouse has no Available-to-Sell. AWJ must support inventory-tracked merchandise, legitimately non-stock sales, and goods prepared on demand without falsifying stock. This feature is tenant-safe and preserves the currently deployed behavior by default.

## 2. Merchant-facing settings
At **Store > Delivery & Channel Settings > Product availability** (location proposal, verify navigation before implementation):
- **الوضع التلقائي (الحالي)** [default for every existing/new store in V1]: preserve existing warehouse-scoped Available-to-Sell calculation and cart/checkout enforcement, without behavior changes.
- **سياسة توفر المنتجات**: merchant chooses the store's default:
  1. **حسب المخزون** — sale only if warehouse Available-to-Sell is sufficient.
  2. **متوفر دائمًا** — may accept ordering without a stock balance **for verified non-stock products only in V1**. For physical stock-tracked goods, do not silently bypass stock. Merchant intent to sell physical goods before preparation is handled separately by **حسب الطلب** after its order/fulfillment/accounting contract is approved; merchant-facing validation must explain ineligible choices.
  3. **حسب الطلب** — eligible goods are orderable before preparation and labeled «حسب الطلب»; lead time and delivery promises must be explicit and validated by server. Physical inventory/fulfillment/COGS semantics require approved architecture before activation.

UI: selecting Auto hides policy subchoices. Choosing policy opens radio selection and explanation; preview must not claim delivery slots exist. No stock quantities or secrets exposed publicly.

At product level: **استخدام إعدادات المتجر (الافتراضي)**, **حسب المخزون**, **متوفر دائمًا**, **حسب الطلب**. The latter are explicit overrides; merchant changes are audited and permission-checked. A product override takes precedence **only in Custom mode**; in Auto mode all overrides are dormant and current behavior is unchanged.

## 3. Effective policy / precedence proposal
1. Store **Auto** → historical runtime behavior, no product overrides applied.
2. Store **Custom** + eligible store-specific product override → product policy.
3. Store **Custom** without override → store default policy.
All overrides must be scoped to the resolved tenant and store/channel. Do not silently turn an inventory-tracked product into a non-stock product. A cross-store sale of the same SKU must not mutate core Product inventory classification.

## 4. Customer-facing behavior
| Effective mode | Catalog/PDP | Add to cart and checkout |
|---|---|---|
| Auto | Current `in_stock` semantics | Current enforcement |
| By stock | «متوفر» only with positive ATS; availability rechecked for requested quantity | Atomic reservation under existing rules; insufficient ATS rejected |
| Always available | «متوفر»/add to cart only if non-stock eligibility verified | No stock reservation/movement merely because of presentation; server validates eligibility |
| Made to order | «حسب الطلب» plus truthful preparation lead time, not instant-ready claim | Server handles explicit order commitment; no invented physical stock, no automatic negative issue |

Delivery zone, schedule, cutoff, capacity, pricing, taxes and publication are **independent hard checks**. «متوفر دائمًا» never means «التوصيل متاح دائمًا». Handle missing configuration explicitly; do not convert unknown `null` into false or guaranteed true.

## 5. Open decisions — must be resolved in ADR review before implementation
- **Resolved in this draft:** Store Auto overrides every custom choice; product overrides are editable but inactive while Auto is selected, with explanatory UI.
- Non-stock product classification and accounting lifecycle used today; whether true non-stock catalog SKUs can be configured from merchant UI.
- Made-to-order eligibility for tracked physical products; precise inventory consumption, reservation, fulfillment, cancellation and COGS timing (no implicit oversell).
- Lead time schema, purchase-quantity limits, variants and multi-warehouse semantics.
- Store-specific product overrides vs global product configuration; compatibility with mobile/external sales channels and products shared by multiple stores.
- Migration, API contract/versioning and rollback strategy; no database/API changes approved by this PRD.

## 6. Non-goals
No modifications to inventory valuation, ledger, POS, purchasing, ZATCA, invoice posting, stock transaction rules, or other channel contracts. No inventory fabrication, forced negative balances, per-store physical inventory copies, or changes to existing published listing records. No production rollout in documentation phase.

## 7. Success criteria
Existing stores and products unchanged without opt-in. Merchant can understand effective policy and source. Stock-tracked products still respect real warehouse ATS. Made-to-order does not promise immediate delivery. Server, not React, is authoritative. Tenant isolation, security and auditability hold. All critical negative tests pass before any merge/deploy.

## 8. Explicit boundaries of availability versus order fulfillment
- **Catalog availability** is an indication; **order acceptance** requires server eligibility, price, publication, shipping/delivery and checkout checks; **ready to dispatch** requires fulfillment clearance. These are separate states and must not be collapsed.
- Made-to-order requests may be accepted for eligible physically tracked goods before they are assembled, but must **not** immediately create fictional stock, issue inventory, recognize COGS or promise same-day delivery. Preparation/production, material consumption, inventory receipt/issue, cancellation/refund and posting rules remain **implementation blockers** until a dedicated approved lifecycle specification exists.
- Draft lead-time contract proposal: bounded positive integer `preparation_lead_time_days` with specified calendar/business-day semantics, channel timezone, cutoff and eligible delivery date validation performed server-side. No default invented estimate; absent/invalid lead time blocks MTO activation.
- Existing user intent is not satisfied by merely rendering «متوفر» while rejecting add-to-cart. Customer-visible purchase path must be genuine and only enabled once the underlying lifecycle is safe.
