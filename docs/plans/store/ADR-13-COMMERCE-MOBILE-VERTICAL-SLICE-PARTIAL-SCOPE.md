# ADR-13 — Commerce Mobile Vertical Slice: Partial Scope Accepted

**Status:** Accepted — Owner Decision
**Date:** 2026-09-22
**Scope:** authorizes a partial end-to-end Commerce Mobile vertical-slice verification, using only currently-merged capabilities, as its own independently-accepted deliverable — explicitly not the full vertical slice originally named in `TASK-QUEUE.md`.

## Context

`TASK-QUEUE.md` originally gated `COM-MOBILE-VERTICAL-TEST-1` on "selected vertical slice complete," implicitly assuming the slice must wait for every remaining capability (payments, shipping, promotions). Repository evidence (Decision/Evidence Packet, delivered 2026-09-22) found this assumption unnecessary: 84 Commerce/Customer/Storefront feature-test files already cover every merged capability in isolation, but no test exercises a full, stitched customer journey in one scenario, and no OpenAPI/contract artifact exists for `/commerce/v1` at all (only the older `/api/v1` surface has one). Both guest and authenticated customer journeys are fully executable today, end-to-end, using only merged capabilities.

## AWJ Decision (owner-authorized)

1. **A partial vertical slice, covering only currently-merged capabilities, is authorized now** as its own accepted deliverable — not contingent on Payments (`ADR-09`) or Shipping (`ADR-10`) landing first.
2. **Required coverage:**
   - **Guest journey:** catalog → cart → checkout → order completion → signed guest order lookup.
   - **Authenticated customer journey:** authentication → catalog → cart/cart identity → saved address → checkout → order completion → order history list/detail.
3. **A machine-checked `/commerce/v1` OpenAPI contract is established**, following the existing `docs/openapi/public-api-v1.yaml` / `PublicApiOpenApiContractTest` convention where applicable, closing the gap that surface has had since it was first built.
4. **The full vertical slice remains explicitly not-done** until the payment and shipping legs (once `ADR-09`/`ADR-10` are implemented) are incorporated into the end-to-end verification. This partial slice must not be reported or recorded as "vertical slice complete."
5. **Extend incrementally** — as Payments and Shipping land, their legs are added to the same slice test(s)/contract rather than starting a new, separate verification effort.

## Open Decisions (still not made — explicitly out of scope here)

None — this decision is fully self-contained; the only prior open question (whether "done" requires a payment/shipping leg) is resolved by §4 above: it does, and this pass is explicitly partial.

## Consequences

### Benefits
Proves real composition risk (token handoff across cart→checkout→order, snapshot correctness, guest-vs-customer identity boundaries) now, rather than leaving it unverified for the months a payment/shipping vendor decision may take; produces a durable `/commerce/v1` contract artifact usable by any future real mobile client or App Builder consumer.

### Costs / trade-offs
Does not prove a payment or real-shipping leg — by design, and must not be mistaken for full vertical-slice completion in any future status report.

## References
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md`
- `docs/openapi/public-api-v1.yaml` (existing convention for the contract artifact shape)
- `docs/plans/commerce/COM-MOBILE-VERTICAL-SLICE-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
