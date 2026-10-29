# AWJ — Commerce Order Cancellation: Beta Readiness Review

- **Reviewed main:** `e9761194fd2788bfb40b7c72a025ac475aafb9f2` (includes O3a-1 #1774, O3a-2a #1775, O3a-2b #1777, O3b #1780, O3c #1781)
- **Scope guard:** review only. Nothing was merged, deployed or activated on any shared/published environment. The gate was turned on **only** inside a throwaway local process (see §2).
- **Side PR (separate, unmerged):** #1784 — one-line staff-UI copy fix found in the E2E (§3.2).

## Decision (revised for the Beta context)

**Owner-stated context (added after the first review):** AWJ currently has **no real customers or tenants — every existing account is experimental.** The first version of this report returned NO-GO for the shared deployment mainly because the flag is global (one switch for all tenants). With only experimental accounts that is **not a blocker**: the blast radius of a global switch is experimental data only. The mandatory tests (tenant isolation, RBAC, payment refusal, compatibility) are unchanged and all pass.

**GO** for enabling `COMMERCE_ORDER_CANCELLATION_ENABLED=true` on the current (experimental-only) deployment, **subject to**:
1. **Owner confirms the deployment state** (§1.2) — still BLOCKED from this environment. Block if the cancellation-facts migration is not applied, or if the backend or storefront predates `e9761194`, or the staff web predates `f3d9f5635` (§6 minimum revisions).
2. **Explicit owner approval of the activation itself** (this review performed no activation).
3. **Right after activation, run the §5 smoke on the live experimental tenant** — including the storefront confirmation/customer surfaces that could not be browser-tested here (§2), with a sandbox payment gateway.
4. Rollback is **switch-off only** (§6): the flag may be turned off at any time, but no layer may be reverted below its minimum compatible revision.
5. Re-open this decision (back to NO-GO for that scope) **before** the first real tenant is onboarded if the flag is still global: either pilot per tenant (allowlist PR) or accept the global switch knowingly.

Residual items that remain true but are no longer blocking in this context: the flag is global; deployment state unverified; storefront/customer browser E2E pending; no un-cancel path by design.

## Summary table

| # | Condition | Result |
|---|---|---|
| 1a | Merged code compatible with the hosting setup (Render Docker + entrypoint migrations) | PASS (by inspection) |
| 1b | What is actually deployed | **BLOCKED** (no hosting access) |
| 1c | Flag default closed; activation / rollback mechanism; non-mutating gate verification | PASS (global flag acceptable in the experimental-only context) |
| 2 | Browser E2E (staff UI) on isolated stack | PASS (partial scope, see §2) |
| 2b | Browser E2E of storefront confirmation / account / payment-return | **BLOCKED** (needs gate + seeded storefront stack; account order pages are `design_only`) |
| 3 | Public `status` consumer audit | PASS — no blocking gap; 1 minor staff-UI copy bug fixed in #1784 |
| 4 | Safety verification (isolation, RBAC, paid-order refusal, single release, no accounting, no provider call under lock, late_capture, closed default) | PASS |

## 1. Deployment readiness

### 1.1 Compatibility with hosting — PASS (inspection)
- Backend ships as a Docker image (`render.yaml`, `deploy/DEPLOY.md`); `deploy/entrypoint.sh` runs `php artisan migrate --force` on **every boot** (5 retries, `exit 1` on failure, so the previous healthy version keeps serving), then `config:cache` + `route:cache`.
- The only schema change in the cancellation chain is `2026_12_13_010000_add_cancellation_facts_to_commerce_orders` (4 nullable columns, an index, and DB guard triggers/functions on PostgreSQL). Additive; `down()` refuses once any cancelled order exists (fix-forward only).
- Local migration + full cancellation suites pass on SQLite and PostgreSQL 16 (below).
- Storefront (`storefront/vercel.json`): Vercel deploys `main` automatically (`git.deploymentEnabled.main = true`). The backend Blueprint declares no `autoDeploy` override.

### 1.2 What is actually deployed — BLOCKED
This environment has no access to Render/Railway/Vercel dashboards or the production database, so "merged" ≠ "deployed" cannot be resolved here. **Do not assume.** Verification commands for the owner:
- Render → service `nibras-api` → Events: last deploy is *successful* and at/after merge of #1781 (commit `e9761194`).
- DB: `SELECT migration FROM migrations ORDER BY id DESC LIMIT 5;` must list `2026_12_13_010000_add_cancellation_facts_to_commerce_orders`.
- Vercel: the storefront and `web/` production deployments reference `e9761194` (or later).
- **Gate probe (non-mutating, replaces the earlier GET suggestion — P2 on #1785).** Send an authorized `POST /api/commerce/orders/00000000-0000-0000-0000-000000000000/cancel` with a deliberately **invalid** body, e.g. `{"reason":"__gate_probe__"}`:
  - gate **closed** → **404** (the controller checks the gate first);
  - gate **open** → **422** with a validation error on `reason` (validation runs **before** the order lookup, so a nonexistent UUID is fine and no order is ever read for cancellation, let alone cancelled — an invalid reason can never pass validation).
  - Required conditions for the 404-vs-422 distinction to be meaningful: (a) a valid Sanctum token (else 401); (b) a user holding `commerce.orders.cancel` and a tenant with `commerce.storefront` enabled — otherwise the route middleware answers **403 regardless of the gate**; (c) the id must be UUID-shaped — a non-UUID id gets a routing 404 whatever the gate says; (d) never send a valid `reason` value.
  - Proven by `CommerceOrderCancellationTest::the_non_mutating_gate_probe_tells_a_closed_gate_from_an_open_one` (closed → 404 / open → 422 for both a nil UUID and a real order id; the real order stays uncancelled and `world()` unchanged; 401 without token, 403 for an unauthorised user in both states, routing 404 for a non-UUID).

### 1.3 Flag, activation and rollback — PASS with caveat
- `config/commerce.php`: `'order_cancellation_enabled' => (bool) env('COMMERCE_ORDER_CANCELLATION_ENABLED', false)`. It appears in **no** `render.yaml`, `.env.example` or deploy file ⇒ closed everywhere by default.
- Read at runtime in exactly 3 places (`CommerceStaffOrderCancellationController` → 404 when closed; `CommerceOrderLifecycleService::cancelAction` → hides the staff `cancel_action`; `CommercePaymentIntentController` → legacy intent-cancel delegation).
- **Activate:** set `COMMERCE_ORDER_CANCELLATION_ENABLED=true` on the backend service and restart/redeploy (config is `config:cache`d at boot, so a restart is required). **Rollback:** unset/`false` + restart — the route returns to 404, the legacy intent-cancel route is byte-for-byte as before, and **already-cancelled orders stay cancelled** (the public contract keeps reading `cancelled`; the facts and DB guards remain). No data migration is involved either way.
- **Caveat:** the flag is **global** (all tenants of that deployment); `commerce.orders.cancel` is held only by `owner`/`admin`. Acceptable while every tenant is experimental; revisit before onboarding the first real tenant.

## 2. Browser E2E

Environment: throwaway local stack — SQLite file in the session scratchpad, `php artisan serve` with `COMMERCE_ORDER_CANCELLATION_ENABLED=true` set **only in that process**, `next dev` for `web/`, Playwright/Chromium. Not shared, not published, torn down afterwards. Seed: 1 tenant, owner, storefront, 2 COD orders (one awaiting collection, one collected).

| Scenario | Result | Evidence |
|---|---|---|
| Cancel an unpaid order from the staff UI (dialog, reason select, confirm) | PASS | order showed «ملغى»; the cancel button disappeared |
| Cancelled state in staff list and detail (AR) | PASS | list shows cancelled; both orders listed |
| English + mobile (390 px) of the cancelled detail | PASS | "Cancelled / This order is cancelled. It remains a historical record…"; no horizontal scroll |
| Rejection after collection | PASS | collected order offers no cancel action; direct API call → **409 `payment_collected`** |
| Re-submit cancel | PASS | second POST (different reason) → **200**; original reason `customer_request` preserved |
| No token | PASS | 401 |
| No accounting/stock side effects | PASS | after cancel: journal_entries 0, stock_movements 0, invoices 0, payments 0, credit_notes 0; intent `cancelled`; order DB status still `confirmed` with `cancelled_at` set |
| Payment/reservation behaviour (online intent, live attempt, release, late capture) | PASS via feature tests (§4) — not reproducible in a browser without a payment provider |
| Storefront confirmation replay, customer account list/detail, payment-return in a browser | **BLOCKED** | needs the storefront gateway + domain stack and a lost-response replay; the account order pages are `ACCOUNT_ORDER_LOOKUP_CAPABILITY = design_only` (not wired to live data). Covered instead by component tests (ar/en/de/es/fr/pl) and the backend replay/contract tests. Not bypassed. |

## 3. Compatibility audit

### 3.1 Consumers of the public order `status`
| Consumer | Finding |
|---|---|
| Storefront account list / detail / status | Handles `cancelled` (O3c). The pages themselves are `design_only` (no live lookup yet). |
| Storefront checkout confirmation + flow | Handles a cancelled replay (O3c follow-up); never starts payment for it. |
| Payment return | Driven by `payment-status` (has `cancelled`); no order-status assumption. |
| Staff web (`commerce-workspace/orders`) | Uses `lifecycle_status`; handles `cancelled` (one copy bug, §3.2). |
| Mobile (`mobile/lib`) | No order `status` handling exists (checkout/orders are only a documented contract). |
| App Builder (`contracts/app-builder`, `DataResourceRegistry`) | No order status consumption. |
| Order notifications | None found (`app/Notifications`, `app/Mail` don't reference `CommerceOrder`). |
| Generated API clients | None (no openapi-generator/orval/openapi-typescript in the repo). |
| `contracts/flowers-journey/11-order.json` | A confirmed order; unchanged and valid. |
| Backend payment/posting paths | `CommercePayable::assertStillPayable` checks `status === confirmed` **and** intent `pending` — a cancelled order's intent is `cancelled`, so payment start is refused (defense relies on the intent; the ADR text says it also checks `cancelled_at` — LOW, defence-in-depth only, not a reachable defect because both change in one transaction). |

**Gap statement:** no in-repo consumer breaks on `cancelled`. External strict clients (the owner's own apps/integrations) that enumerate `draft | confirmed` are the residual risk (documented as an intentional enum extension in OpenAPI and the O3c report); unreachable while the gate is closed.

### 3.2 Confirmed small defect → separate PR #1784
Staff order detail header still said "The order can be cancelled from this screen when eligible" on an already-cancelled order. One-line fix + test, no behaviour change (`claude/commerce-orders-cancelled-header-note`, unmerged).

(Observation, not a defect: the staff detail shows two badges for a cancelled order — lifecycle and payment status — because they are separate dimensions by ADR-28.)

## 4. Safety verification — PASS

Suites run on main `e9761194`:
- SQLite: `CommerceOrderCancellation*`, `CommerceIntentCancelSeparation`, `OnlineOrderStockHold`, `CommerceOrderPublicCancelled*`, `CommerceStaffOrder*`, `CommerceModuleBoundary`, `CommerceApiOpenApi`, `CommerceCustomerOrder`, `CommerceOrderStatus`, `StorefrontOnlinePayment`, `PaymentAttemptReconciler` → **217 passed, 10 skipped (3306 assertions)**.
- PostgreSQL 16 (real concurrency, pcntl, no skips): cancellation + concurrency + public contract + stock hold + reconciler + online payment → **176 passed (2165 assertions)**.

| Requirement | Evidence (tests) |
|---|---|
| Tenant isolation / IDOR | `another_tenants_user_cannot_cancel_and_the_id_cannot_be_guessed`; public: foreign reference/customer → uniform 404 |
| RBAC | `only_an_explicitly_authorized_staff_member_can_cancel`; permission held by owner/admin only; warehouse-restricted users refused; disabled capability blocks |
| No direct cancel of paid orders | rows 2, 5–8: collected / authorized / captured / paid / posted → 409; `cancel_vs_capture`, `cancel_vs_cod_collection` race tests (one winner) |
| Hold released once | row 3 + `cancel_vs_the_sweeper…one_release`, `two_concurrent_cancellations_are_idempotent_with_one_effect` |
| No ledger/stock/invoice/payment on cancel | `cancellation_creates_no_entry_invoice_payment_credit_note_or_stock_movement`; E2E counts above |
| No provider call under DB locks | `the_provider_is_not_contacted_while_an_outer_transaction_is_open…`, PG `the_provider_is_contacted_only_after_commit_with_no_row_lock_held…`; static guard `the_lifecycle_service_never_uses_the_public_cancel_provider_calls_or_accounting_services` |
| late_capture + retry | `a_capture_arriving_after_the_cancellation_is_a_late_capture…`, row 9 variants, `a_provider_failure_after_the_commit_leaves_a_consistent_cancelled_order_and_the_reconciler_finishes_it` |
| Closed by default | `the_deployment_gate_is_closed_by_default_and_a_closed_gate_is_a_uniform_404`, `with_the_gate_closed_the_legacy_intent_cancel_route_is_unchanged` |

## 5. Staged rollout plan (pilot accounts)

1. **Verify deployment state** (§1.2). Block here if the migration is not applied or the backend is older than `e9761194`.
2. **Activation scope.** With only experimental tenants, the current deployment can be used directly (global flag). Before the first real tenant: use a dedicated deployment or a per-tenant allowlist (small separate PR).
3. **Pre-flight on the pilot:** run the migration; confirm POST cancel is 404 before the flag, 200/409 after; confirm `commerce.orders.cancel` is held only by the intended owner/admin users.
4. **Pilot scenarios (manual, with a sandbox payment gateway):** COD cancel; online order unpaid with/without a live attempt; attempt authorized/captured (expect 409); repeat cancel; late capture after cancel (expect `late_capture` review, no auto-refund); customer-side read via the guest reference and `me/orders`; storefront confirmation replay after lost response.
5. **Observe 1–2 weeks:** reconciler/sweeper health, `late_capture` count, any 409 `payment_captured` support tickets, no `journal_entries` created by cancellations.
6. Only then ask for the shared-production decision (separately authorised).

## 6. Rollback plan

**Principle: roll back by switching the feature off, never by reverting code to a version that cannot read or display cancelled orders.** Cancelled orders are permanent data; every deployed component that reads orders must keep understanding them.

1. **Switch off:** set `COMMERCE_ORDER_CANCELLATION_ENABLED=false` (or remove it) → restart (config cache). Effect: the cancel route returns 404, `cancel_action` is hidden in the staff UI, the legacy intent-cancel route is restored.
2. **What the switch does NOT do:** it prevents **new** cancellations only. Orders already cancelled **stay cancelled** — `cancelled_at` and the DB guards remain, the public contract keeps reading `status: "cancelled"` (+ `cancellation.cancelled_at`), their payment intents stay cancelled and their reservations stay released. There is no un-cancel (ADR-28); the remedy for a wrongly cancelled order is a new order.
3. **Do NOT roll back to an older build of any layer (this replaces the earlier "frontend rollback is unconditionally safe" statement — P2 on #1785).** Minimum compatible revisions once any order may have been cancelled:

| Layer | Minimum compatible revision | Why an older build is unsafe |
|---|---|---|
| Backend (Render) | `e9761194fd2788bfb40b7c72a025ac475aafb9f2` (O3c, #1781) | Older backends still return `status: "confirmed"` for a cancelled order, so buyers/guests would see it as active. Below O3a-1 (`e46efc8da`) the schema guards make a code rollback impossible once cancelled rows exist (`down()` refuses). |
| Storefront (Vercel) | `e9761194fd2788bfb40b7c72a025ac475aafb9f2` (O3c, #1781; includes the confirmation-replay fix in `AwjOrderConfirmation`/`AwjCheckoutFlow` and the account list/detail/status handling) | A pre-O3c storefront renders `success.heading` + `success.notPaidNote` unconditionally in `Confirmation.tsx`, so a shopper replaying checkout completion after a lost response would see a **cancelled** order presented as successfully placed (and could be redirected to pay for it). |
| Staff web (`web/`) | `f3d9f5635` (O3b, #1780) | Older staff UIs don't read `lifecycle_status` and would show a cancelled order as `confirmed`. |
| #1784 (header note) | optional, cosmetic | Not a compatibility requirement. |

   These are the SHAs of the approved squash merges on `main` (verified with `git log -S` on the introducing symbols). If a rollback of a layer is unavoidable, roll back to a build that **contains** the SHA above (e.g. a revert of unrelated later commits), never to one that predates it.
4. **Schema:** never roll back migration `2026_12_13_010000_add_cancellation_facts_to_commerce_orders` once a cancelled order exists (`down()` refuses by design; fix forward only).
5. **Rollback checklist:** (a) flip the flag off and restart; (b) confirm with the §1.2 probe that it now returns 404; (c) confirm the three layers are still at or above the minimums above; (d) spot-check one already-cancelled order on the storefront confirmation/guest read and the staff detail — it must still read "Cancelled".

## 7. Residual risks
- Global (not per-tenant) flag → blast radius = whole deployment.
- Deployment state unverified from here (and the three-layer minimum revisions in §6 must be verified there too).
- Rolling a layer back below its §6 minimum revision would mis-display already-cancelled orders as active/placed — forbidden by the rollback plan.
- No browser E2E for the storefront/customer surfaces (blocked as above); component + contract tests only.
- No un-cancel / "wrongly cancelled" recovery path by design.
- Cancelling a **paid** online order still requires the separate refund/return track (RT) — out of scope; staff are refused with a safe code.
- External strict clients of the public `status` enum (owner-controlled apps) — unreachable until the gate opens; coordinate before pilot.
- `CommercePayable` relies on the intent status (not `cancelled_at`) — LOW defence-in-depth gap.

## 8. Conditions for GO (see Decision)
1. Owner confirms deployment state per §1.2, including that backend/storefront ≥ `e9761194` and staff web ≥ `f3d9f5635` (§6).
2. Explicit owner approval to activate (not performed by this review).
3. Merge #1784 (cosmetic, optional but recommended).
4. Run the §5.4 scenarios on the live experimental tenant right after activation with a sandbox gateway and attach results.
