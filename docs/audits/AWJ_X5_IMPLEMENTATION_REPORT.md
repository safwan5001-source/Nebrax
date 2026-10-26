# AWJ X5 — Spree Checkout Route Closure (+ H0 X4 verification record)

- **Branch:** `claude/h0-x4-record-x5-checkout-routes`
- **Base SHA:** `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b` (origin/main, X4-FIX #1763)
- **Head SHA / PR / CI:** see the PR description (filled after push)
- **Status:** In PR. Not merged, not deployed.

## Part A — X4 verification record
The Horizon tracker records the X4/X4-FIX merges and Railway Beta deployment (owner statement), plus the owner's 4 manual visual checks (AR policy, EN policy LTR, unwritten links hidden, separate storefront does not expose another tenant's policy). The record states its limits: manual visual only, not exhaustive production verification; security/isolation coverage comes from CI automated tests. Not verified: other policies, other tenants/hosts, mobile, canonical/noindex live, 503 live, `policy_availability` performance, absence of Spree env vars in the deployed environment (ENV0), checkout/account static links. Deferred and recorded without scope: `X4-LINKS` (static policy links in checkout footer/consent/account — touches checkout/registration, needs explicit owner permission) and `UI-DEF1` (typography/footer polish).

## Part B — Routes examined and decisions
| Route | Owner | Decision |
|---|---|---|
| `(checkout)/checkout/[id]` | legacy Spree checkout (`CheckoutProvider`, Spree cart/orders) | **Gated**: 404 unless wholesale add-on configured |
| `(checkout)/confirm-payment/[id]` | legacy Spree | **Gated** (same) |
| `(checkout)/order-placed/[id]` | legacy Spree | **Gated** (same) |
| `(store-checkout)/checkout` | AWJ-native | **Unchanged** (static segment beats `checkout/[id]`) |
| `(store-checkout)/checkout/payment-return` | AWJ-native (PAY-H4-05) | **Unchanged** |
| `(wholesale)/wholesale/*` | opt-in wholesale add-on, already `notFound()` when disabled | Unchanged |
| `CartDrawer` link | AWJ cart → `${basePath}/checkout`; Spree branch kept for wholesale pages | Unchanged (existing test asserts AWJ link) |
| `api/webhooks/spree` | webhook, not a checkout route | Unchanged |

**Ambiguity noted, not changed:** the legacy flow hard-codes `/en` in its order-placed redirect; it is wholesale-only and now unreachable without wholesale config, so no change was made.

## Design
`(checkout)/layout.tsx` is now a server component: `if (!isWholesaleEnabled()) notFound();` then renders `CheckoutShell` (the former client layout, moved unchanged to `CheckoutShell.tsx`). `notFound()` yields a plain 404 for every locale/country: no redirect, no unsafe checkout state, no API details exposed, no tenant data involved. With wholesale configured, behavior is identical to before.

## Changed files
- `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md`, this report
- `storefront/src/app/[country]/[locale]/(checkout)/layout.tsx` (new gate), `CheckoutShell.tsx` (moved), `layout.test.tsx`
- `storefront/src/app/__tests__/checkout-routes.test.ts` (structural guard)
- `storefront/src/lib/data/__tests__/no-spree-env.test.ts` (X5 block)
- `storefront/scripts/spree-ratchet/baseline.json`

## ⚠ Ratchet baseline increase — owner approval required
`spree_wrapper_imports` 76 → 77: the new gate imports `isWholesaleEnabled` from `@/lib/spree`, because wholesale config is defined there. No honest alternative exists (a re-export wrapper would only hide the import). The gate is a *closing* control, but the count rises by exactly one line (`(checkout)/layout.tsx: 1`). It disappears when the legacy group is deleted (ENV0/X-final).

## Tests and results
- Focused: layout gate (disabled → 404, shell never built; enabled → shell; locale independent), structural route guard (legacy pages only in `(checkout)`, gate precedes shell, AWJ routes exist and import nothing from Spree, no checkout-shaped paths elsewhere), No-Spree block (legacy layout 404 with Spree spies untouched; AWJ checkout page loads) — 34 passed.
- Full storefront vitest: 237 files passed / 16 skipped; 3404 passed / 16 skipped.
- `tsc --noEmit` clean; biome check: no errors (pre-existing warnings only); `check:spree-ratchet` OK at new baseline; `next build` succeeds.
- GitHub CI: see PR.

## Compatibility and security
- AWJ cart/checkout/guest/payment-return unaffected. Wholesale deployments unaffected.
- Any bookmarked legacy `/checkout/<id>` URL on a non-wholesale store now returns 404 (intended).
- No payment, accounting, tax, calculation, schema or X4 changes.

## Remaining ENV0
Verify in the deployed environment that no SPREE_* variables exist and legacy paths return 404 live; delete the legacy group and wholesale remnants; X4-LINKS; formal sign-off.

## Next action
Owner review of the +1 ratchet baseline, then merge decision; afterwards ENV0 live verification of the 404s. No Merge. No Deploy.
