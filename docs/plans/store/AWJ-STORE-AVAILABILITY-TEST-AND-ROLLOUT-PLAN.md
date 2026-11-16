# AWJ Store Availability Policies — Acceptance, Tests, Rollout
**Status:** Proposed — documentation only; no CI/tests executed for this documentation PR.
**Date:** 2026-10-15

## Acceptance matrix
| Scenario | Expected |
|---|---|
| Existing store / no new config | Auto; catalog, cart, checkout and ledger behavior unchanged |
| New store / unconfigured setting | Auto |
| Auto + warehouse ATS 0 | Current unavailable result; no new fallback |
| Auto + warehouse missing | Preserve nullable unknown response; never falsely report known stock |
| Custom / By stock: on hand 25, reservations 0 in selected warehouse | Orderable for 1..25 base units (subject to all other checks) |
| Custom / By stock: stock in another warehouse only | Unavailable from selected warehouse |
| Custom / By stock: active reservations exhaust balance | Unavailable; release/expiry restores availability correctly |
| Custom / Always + verified non-stock product | Orderable without stock reservation/issue; checkout still validates prices/fulfillment/payment |
| Custom / Always + inventory-tracked product | Reject unsafe policy or show explicit ineligible reason; direct merchant to MTO if applicable; no bypass/negative issue |
| Custom / Made to order + eligible product | Explicit MTO copy/validated lead time; separate accepted-order and ready-to-fulfill states; no stock issue until approved fulfillment contract |
| Custom / MTO + incomplete lead time/workflow | Cannot activate without safe explicit server validation |
| Product override + Store Custom | Product takes precedence only in same storefront/channel |
| Product override + Store Auto | Legacy Auto remains effective; override dormant and explained in merchant UI |
| Missing/unavailable delivery slots | Order delivery not promised even when product orderable |
| Multiple variants | Availability/eligibility resolved at selected variant; no sibling-stock leakage |
| Duplicate checkout/payment retry | Idempotent; no duplicate reservations, movements or orders |
| Cross-tenant/store/warehouse/variant payload | Reject without identity leaks; no state change |
| POS/ERP/mobile/external clients | Existing documented contracts unchanged unless separately approved |
| Configuration transition while cart active | Revalidation at checkout; historical committed orders immutable |

## Required testing
- Unit: precedence, eligibility, unknown values, variant selection, lead time and status mapping.
- Feature: permission/tenant isolation, data validation, persistence/audit, public resource compatibility.
- Integration: cart add/update/merge, checkout preparation/complete, reservation lifecycle, fulfillment and cancellation.
- PostgreSQL concurrency: same final stock unit, parallel checkout, payment retry and reservation collision.
- Accounting: no unapproved stock movements, COGS, GL entries, VAT/ZATCA differences, product costing drift.
- Frontend/mobile: Arabic RTL and English LTR, settings controls, accessibility, catalog/PDP/cart/checkout copy, zero/unknown/error states, visual regression.
- CI: targeted suites then full security/financial/tenant regression and build; release gating.
- Production smoke only after explicit approval: one known stock-tracked SKU and one safe non-stock/MTO test SKU, no destructive stock mutation and no live payment without explicit approval.

## Proposed incremental delivery — NOT authorized by this plan
1. Architecture audit / finalize open ADR questions, finalize enum/scope/migration and accounting applicability.
2. Backend policy persistence, validation, audit and effective resolver **behind disabled feature gate**. Test legacy untouched.
3. Merchant UI for store settings + product override, gated, dense AWJ design.
4. Storefront read presentation after backend contract; support null/unknown and lead-time.
5. Cart/checkout/order workflow enabling eligible Always and MTO only after hardening, accounting and concurrency test approval.
6. E2E visual QA, final MD implementation report with changed files, tests, build/CI, risks, base/head SHA and PR; explicit approval before merge and deploy.

## Review checklist
- [ ] Resolve PRD/ADR open decisions with Safwan
- [ ] Confirm authoritative non-stock classification and accounting flow in current code
- [ ] Approve precise API/database contracts separately
- [ ] Confirm default Auto + rollback
- [ ] Verify no production mutation in analysis/docs stage
- [ ] Approve implementation slices individually

## Additional must-pass scenarios
- Product override saved under Auto is *dormant*; switching to Custom applies it only if eligible; switching back restores historical behavior with no inventory mutations.
- Checkout cannot accept an MTO order without a server-approved lifecycle and truthful lead-time/delivery commitment; neither product cards nor payment confirmation can imply ready-to-ship.
- Lead-time absent, zero, invalid, cutoff crossed, timezone boundary, nonworking day and slot before minimum date: explicit safe rejection.
- Cancellation before/after preparation, payment failure/refund, partial fulfillment and retries: accounting and reservation outcomes must be proven per dedicated ADR; no invented stock issue/negative physical stock.
- Same product published on stores A/B with different policies: no cross-store configuration leak; trusted host resolves the correct channel, tenant enforced.
- Public API `in_stock: null` and legacy consumers, SEO structured data, current carts and existing orders preserve backward compatibility and snapshot correctness.

## Review disposition
P1/P2 issues from PR review are **addressed at requirements level** but not all resolved technically. Do not mark the ADR Accepted or implement Always/MTO until authoritative non-stock classification and MTO lifecycle evidence is collected and explicitly approved.
