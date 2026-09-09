# CUS-COM-GATE-1 — Customer Platform ↔ Commerce Integration Gate

**Status:** Documentation/architecture alignment only — no application code, no migration, no test changed

**Date:** 2026-09-09

**Base SHA:** `001fe92fc89bdec72b8c39f694d976cd97dd6c3e` (`origin/main` immediately after merged PR #743)

**Scope:** reconcile `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` Phase 6 with the now-merged shared AWJ Customer Platform foundation (`CUS-FOUNDATION-1`, PR #743), and record whether Commerce may resume Phase 6 without building a duplicate customer identity/auth system.

## 1. Purpose

`CUS-ARCH-0` (architecture) already identified — and its §11.4 already drafted — the exact Commerce Master Plan amendment this gate applies, on the explicit condition that `CUS-FOUNDATION-1` merges first. `CUS-FOUNDATION-1` is now merged (PR #743, `origin/main` HEAD `001fe92f...`, replacing prior HEAD `83bea87f...`, which was `CUS-ARCH-0`'s own Base SHA). This document:

1. records the merged Customer Platform foundation's actual, verified shape (not the pre-merge proposal — the implementation report's real class/method names);
2. applies the CUS-ARCH-0 §11.4 amendment to the Commerce Master Plan's Phase 6 (done — see the Master Plan diff);
3. documents the guest/authenticated ownership model and `CustomerContext` integration contract Commerce must follow;
4. states the revised dependency graph and the exact next implementation PR;
5. renders the Commerce Resumption Gate verdict.

This is a documentation/architecture task only. No Commerce service, model, migration, `CustomerIdentity`/`CustomerContext`/`Partner` implementation, accounting, ledger, invoice, ZATCA, inventory, or POS file is modified.

## 2. Evidence labels used

| Label | Meaning |
|---|---|
| **AWJ VERIFIED** | Proven by reading the actual merged repository code/migrations at `origin/main` after PR #743, not by any planning document alone. |
| **ADR APPROVED** | Stated in a merged ADR (ADR-01..05) or in `CUS-ARCH-0`/`CUS-FOUNDATION-1-APPROVED-IMPLEMENTATION-DECISIONS.md`. |
| **DERIVED** | A reasoned conclusion from the above where no single source states it directly. |
| **OPEN / REQUIRES VERIFICATION** | Genuinely undecided or a repository/plan mismatch — flagged, not resolved by guessing. |

## 3. Merged Customer Platform foundation status

**AWJ VERIFIED** (read directly from `app/Models/CustomerIdentity.php`, `app/Models/CustomerPartnerLink.php`, `app/Tenancy/CustomerContext.php`, and `database/migrations/2026_09_11_010000_create_customer_digital_access_foundation.php` on `origin/main` after PR #743):

- `App\Models\CustomerIdentity` exists — a tenant-owned, `CompanyWide`, Sanctum-authenticatable principal, distinct from `User` and `Partner`. Fields: display name, original/normalized email, optional original/E.164 phone, hashed password, `email_verified_at`, active flag, last-login, soft deletes. No commercial/accounting fields.
- `App\Models\CustomerPartnerLink` exists — tenant-owned, records identity↔Partner link with `active|revoked` status, method (`staff_verified_claim`; `invitation` remains disabled pending a real proof-delivery channel), and audit metadata. Enforced by a partial unique index on `(tenant_id, customer_identity_id) WHERE status = 'active'` — at most one active link per identity; one Partner may have many linked identities.
- `App\Tenancy\CustomerContext` exists — request-scoped, established only after tenant resolution (`ResolveCustomerTenant`) + Sanctum authentication + `EnsureCustomerPrincipal`. Its **actual public API** (verified by reading the class, not assumed from the pre-merge proposal, which used slightly different method names):

  ```php
  CustomerContext::tenantId(): string
  CustomerContext::customerIdentityId(): string
  CustomerContext::linkedPartnerId(): ?string
  CustomerContext::hasPartnerLink(): bool
  CustomerContext::isEstablished(): bool
  ```

  All getters throw `LogicException` if the context was never established for the request — there is no silent "unset" read.
- Customer API surface is live under `/api/customer/v1/{tenantSlug}/...` (register/login/logout/me only; verification/recovery/invitation endpoints remain deliberately disabled pending a real production delivery channel — **AWJ VERIFIED**, `PR-CUS-FOUNDATION-1-IMPLEMENTATION-REPORT.md` "Verification, recovery, and invitation").
- Global staff principal hardening is merged: the complete internal staff route group now runs `auth:sanctum → EnsureUserPrincipal → SetTenant → SetBranch`, closing the `CUS-ARCH-0` §12.1 security blocker that had to precede any customer token issuance.
- `PR-CUS-FOUNDATION-1-IMPLEMENTATION-REPORT.md` itself already declares **`COMMERCE CUSTOMER FOUNDATION GATE: PASS`** at the Foundation level (i.e., the Customer Platform foundation is complete and sound on its own terms). This document (`CUS-COM-GATE-1`) answers the separate, Commerce-side question: *given that foundation, may Commerce's own Phase 6 now proceed against it without building a duplicate system?*

**AWJ VERIFIED — unchanged on the Commerce side** (read directly from `app/Models/CommerceOrder.php`, `app/Services/Commerce/CommerceOrderService.php`, and the COM-5A migration): `CommerceOrder` still has only a nullable, raw, caller-supplied `partner_id` — no `customer_identity_id` column, no `CustomerContext` consumption anywhere in `CommerceOrderService::create()`. This confirms the `CUS-ARCH-0` §11.2 finding is still accurate post-merge and is exactly the integration gap Phase 6 must close. **Not fixed in this task** — schema/service change is out of scope here, per the task's own boundary.

## 4. Superseded Commerce assumptions

**ADR APPROVED (superseded by `CUS-ARCH-0`, applied to the Master Plan in this gate):**

The original Commerce Master Plan Phase 6 (`PR-COM-6A — Commerce Customer Account foundation`, `PR-COM-6B — Commerce authentication & ownership guard`, `PR-COM-6C — Customer addresses & immutable order address snapshot`) assumed Commerce would build **its own** tenant-scoped customer account, **its own** authentication/ownership guard, and a combined addresses+snapshot PR. That assumption predates `CUS-ARCH-0` and is now superseded: a shared, AWJ-wide Customer Platform exists and must be the only customer identity/auth system in AWJ. The Master Plan's Phase 6 section has been rewritten (preserving the original text, collapsed, for historical record) — see the diff in `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`.

`ADR-05 — Customer / Mobile Identity Boundary` is **not** superseded at the conceptual level — its principles (`Customer Account != User != Partner`, guest checkout supported, Partner remains commercial authority, phone-first capability preserved, ownership-based authorization) are exactly what `CUS-ARCH-0` implements in concrete model/service form. `CUS-ARCH-0` supersedes ADR-05 only in *naming and implementation detail* (e.g., "Customer Account" → `CustomerIdentity`). ADR-05 itself is not edited by this gate — it remains the conceptual boundary ADR; `CUS-ARCH-0` is the authoritative detailed decision.

There was also a previously-recorded plan/implementation mismatch (`CUS-ARCH-0` §11.2, and independently confirmed by `PR-COM-5A-IMPLEMENTATION-REPORT.md` §20/§21): the old Master Plan text for `PR-COM-5A` said the order must preserve customer/contact/address snapshots, but the merged COM-5A migration deliberately omitted all address/contact fields and deferred them to "Phase 6 (Customer Account/identity)" — which, at COM-5A's implementation time, did not yet have a defined shape. This gate resolves that open item: the deferred snapshot responsibility now has a concrete home (revised `PR-COM-6C`, §7 below).

## 5. Revised Phase 6

Applied verbatim to the Master Plan (full text there; summarized here):

**Locked naming** (restated, not re-derived):

```text
Partner            = AWJ commercial/accounting Customer Master.
CustomerIdentity    = shared AWJ customer-facing authentication principal.
CustomerContext     = server-derived shared customer context.
User                = ERP staff principal.
```

- **PR-COM-6A — Commerce ↔ Shared Customer Platform Context Integration.** Wires Commerce to consume `CustomerContext` (`tenantId()`, `customerIdentityId()`, `linkedPartnerId()`, `hasPartnerLink()`) as the sole ownership authority. No new identity model, no new auth. Guest commerce remains fully supported (context simply absent). No public `customer_identity_id`/`partner_id`/`tenant_id` accepted as ownership authority from request input.
- **PR-COM-6B — Commerce Customer Ownership & Authorization Integration.** Applies existing `CustomerContext` + existing Customer Platform authentication (`EnsureCustomerPrincipal`, `ResolveCustomerTenant`, the same IDOR pattern already proven by `NotificationController`/`SelfServiceController`) to Commerce resources. Explicitly **not** a new login/register/token subsystem — that already shipped in `CUS-FOUNDATION-1`.
- **PR-COM-6C — Immutable Commerce Order Customer/Contact/Address Snapshots.** Commerce's responsibility is narrowed to exactly the immutable order-time snapshot needed for historical correctness and checkout — not a reusable address book. Saved/reusable customer addresses are Customer Platform's future responsibility (`CUS-CONTACT-1`, unscheduled) and are **not** required to resume Commerce.

## 6. Guest/authenticated ownership model

**ADR APPROVED / DERIVED**, restated from `CUS-ARCH-0` §10.2 and the task's locked checkout policy:

| Case | `customer_identity_id` (future column) | Linked `partner_id` | Snapshot |
|---|---|---|---|
| Guest checkout | `null`, always | `null`, always — no automatic Partner creation, no matching by email/phone/name | Immutable checkout-entered contact/shipping/billing data, sufficient for order history/fulfillment |
| Authenticated, unlinked | server-derived from `CustomerContext::customerIdentityId()` | `null` (no active link) | Same as guest, but attributable to a real, ownable account |
| Authenticated, linked | server-derived from `CustomerContext::customerIdentityId()` | server-derived from `CustomerContext::linkedPartnerId()`, **only if `hasPartnerLink()` is true** | May default from Partner's current flat address, but is still captured as an immutable snapshot at order time — Partner's address changing later never rewrites a past order |

Non-negotiable ownership derivation rule (`CUS-ARCH-0` §10.2, restated): a Commerce order-ownership lookup is conceptually

```php
CommerceOrder::query()
    ->whereKey($orderId)
    ->where('customer_identity_id', $customerContext->customerIdentityId())
    ->firstOrFail();
```

— TenantScope remains defense in depth, but ownership filtering by server-derived identity is mandatory since two customers share one tenant. IDs not owned by the caller return a non-enumerating 404.

**Checkout policy (locked):** Guest + Authenticated Account checkout, both supported. Browsing/cart/checkout must never require account creation unless a later explicit product decision changes this. Guest activity must never automatically create `CustomerIdentity`, `Partner`, or `CustomerPartnerLink`. No silent Partner matching by email, phone, or name — ever, at any layer, including inside future Commerce checkout code.

## 7. CustomerContext integration contract

**AWJ VERIFIED** (§3 above) — Commerce (from `PR-COM-6A` onward) must call `CustomerContext` exactly as every other authenticated-customer consumer does: read it, never construct it, never accept its values from request input. It must not expose password hashes, raw tokens, verification challenges, or any staff `User`/RBAC surface — already true of the merged class (§3).

`hasPartnerLink()` is the only gate for using `linkedPartnerId()`'s value as a real Partner reference in Commerce logic — a `null` from `linkedPartnerId()` when `hasPartnerLink()` is `false` must never be silently coerced into "no Partner intended" vs. "not yet checked" ambiguity; callers must always check `hasPartnerLink()` first, matching the class's own defensive design (all getters throw if the context was never established).

## 8. Partner relationship

**ADR APPROVED**, restated: Partner remains the single AWJ commercial/accounting Customer Master. Commerce order confirmation and reservation orchestration (COM-5A/5B) already never create or require a Partner — this is unchanged and remains correct after the gate. A future authenticated `CommerceOrder`'s optional Partner reference is **read-only from Commerce's perspective** — it is derived from the existing `CustomerPartnerLink`, never created, edited, or merged by any Commerce code path. The exact business/financial milestone at which an unlinked guest/identity's order might ever resolve to a real Partner (e.g., for invoicing) remains **OPEN**, explicitly deferred to the Commerce-to-Invoice bridge (Phase 10), per `CUS-ARCH-0` §15 and Master Plan §19 item 7 — not a Phase 6 decision, and not decided by this gate.

## 9. Immutable snapshot responsibility

**ADR APPROVED**, per `CUS-ARCH-0` §9.2 and applied to the revised `PR-COM-6C` (§5 above):

- **Commerce owns:** the immutable order-time snapshot of customer/contact/shipping/billing data sufficient for order history and fulfillment. This is historical evidence captured once, at checkout/confirmation, structurally the same pattern already established by COM-4A (price snapshot) and COM-5A (product name/UOM/price snapshot on `CommerceOrderLine`) — no new snapshot *philosophy* is being invented, only a new snapshot *scope*.
- **Customer Platform owns:** any future saved/reusable customer address book (`CUS-CONTACT-1`) and future contact/address book capability generally. **Not built in this gate**, and explicitly **not required** for Commerce to resume Phase 6.
- **No shared Contact/Address model is introduced by this gate** — none is needed; Partner's existing flat address fields plus a guest/unlinked checkout's own direct entry are sufficient inputs to the snapshot that `PR-COM-6C` will define and persist.

## 10. Deferred Customer Platform capabilities — explicitly NOT blockers

Per the task's explicit instruction, none of the following are implemented by this gate, and none block Commerce resumption:

- Customer Portal UI;
- saved address book (`CUS-CONTACT-1`);
- `CUS-CONTACT-1-MIN` (locked `NOT REQUIRED BEFORE COMMERCE RESUMES` since `CUS-ARCH-0`, reconfirmed still true post-`CUS-FOUNDATION-1`);
- memberships;
- subscriptions;
- loyalty;
- attendance;
- B2B customer roles / multi-Partner access;
- customer financial UI (invoice/payment/statement reads);
- recovery/invitation flows that require a proof-delivery channel AWJ does not yet have (email/SMS provider) — these remain deliberately disabled in the merged foundation, per `PR-CUS-FOUNDATION-1-IMPLEMENTATION-REPORT.md`.

## 11. Revised dependency graph

```text
COM-0 -> COM-1A -> COM-1B -> COM-2A -> COM-2B -> COM-3 -> COM-4A -> COM-5A -> COM-5B   (all merged)
                                                                                  |
                                                                                  v
                                                                    CUS-FOUNDATION-1 (merged, PR #743)
                                                                                  |
                                                                                  v
                                                                              COM-6A
                                                            Commerce ↔ Shared Customer Platform
                                                                    Context Integration
                                                                                  |
                                                                                  v
                                                                              COM-6B
                                                              Commerce Customer Ownership
                                                                    & Authorization
                                                                                  |
                                                                                  v
                                                                              COM-6C
                                                          Immutable Commerce Order Customer/
                                                              Contact/Address Snapshots
                                                                                  |
                                                                                  v
                                                                        COM-7A -> COM-7B
                                                                     (Cart/Checkout -> Public/Mobile API)
                                                                                  |
                                                                                  v
                                                              COM-8A -> COM-8B -> COM-8C   (Payments)
                                                                                  |
                                                                                  v
                                                                        COM-9A / COM-9B   (Fulfillment)
                                                                                  |
                                                                                  v
                                                                     COM-10A -> COM-10B   (Invoice bridge)
```

No change to already-completed `COM-0` through `COM-5B` history. `CUS-FOUNDATION-1` is a genuine hard prerequisite of `COM-6A` (not parallelizable, unlike the original Master Plan's looser "can proceed partly in parallel" language, written before `CUS-FOUNDATION-1` existed) — it is now merged, so `COM-6A` is unblocked.

## 12. Exact next implementation PR

**`PR-COM-6A` — Commerce ↔ Shared Customer Platform Context Integration.**

Dependencies satisfied: `PR-COM-5B` merged (PR #737); `CUS-FOUNDATION-1` merged (PR #743, `origin/main` commit `001fe92fc89bdec72b8c39f694d976cd97dd6c3e`). No further Customer Platform work is required before `COM-6A` can be scoped and started as its own task.

## 13. REQUIRES VERIFICATION items

Carried forward from `CUS-ARCH-0`/`CUS-FOUNDATION-1` — genuinely open, not invented or resolved by this gate:

1. **Production verification/recovery delivery channel** (email/SMS provider) — still absent; verification, recovery, and invitation endpoints remain disabled in the merged foundation until this is selected and approved. Does not block `COM-6A`/`6B`/`6C` (none of them require verification/recovery to be enabled — an unverified identity simply cannot log in yet, which is a Foundation-level concern, not a Commerce one).
2. **Exact `CommerceOrder` schema for customer-identity ownership + Partner + snapshot fields** — deliberately not decided by this gate, per the task's explicit instruction not to implement schema changes here. Column names, nullability details, and exact snapshot field list are `PR-COM-6A`/`6C` implementation-time decisions.
3. **Customer-to-Partner resolution/creation milestone** for guest/unlinked orders reaching the Invoice bridge — open, deferred to Phase 10 (`CUS-ARCH-0` §15, Master Plan §19 item 7).
4. **`ContactController::update()` ownership-validation gap** noted in `CUS-ARCH-0` §3.5 — unrelated to Commerce resumption (Contact is not used for Commerce ownership/snapshots); recorded here only so it is not lost, not actioned by this gate.

No item above blocks the Commerce Resumption Gate verdict in §15 — each is either genuinely out of Phase 6's scope (items 3, 4) or an implementation-time detail correctly left for `PR-COM-6A`/`6C` itself (items 1, 2), not a missing foundation capability.

## 14. Git

- **Base SHA:** `001fe92fc89bdec72b8c39f694d976cd97dd6c3e` — `origin/main` immediately after merged PR #743.
- **Branch:** `claude/cus-com-gate-1-commerce-integration-gate`
- **Files changed:** `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (Phase 6 rewrite + §16/§19 updates + header amendment note), `docs/plans/customers/CUS-COM-GATE-1-COMMERCE-INTEGRATION-GATE.md` (this file, new).
- **No application code, migration, or test changed.**

## 15. Commerce Resumption Gate verdict

The merged Customer Platform foundation (`CustomerIdentity`, `CustomerPartnerLink`, `CustomerContext`, tenant-safe routing, staff/customer principal separation, ownership/IDOR patterns — all AWJ VERIFIED in §3) is sufficient to begin the revised Commerce Phase 6 (`PR-COM-6A`) without Commerce creating any duplicate customer identity, credential, or authentication system. Guest checkout remains fully supported independent of any Customer Platform capability. No blocking gap was found between what Phase 6 needs and what is merged.

**COMMERCE RESUMPTION GATE: PASS**
