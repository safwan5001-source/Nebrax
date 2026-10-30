# AWJ Commerce — H6 Batch I: Wholesale activation blockers — trust boundaries and B2B contracts

| | |
|---|---|
| Branch | `claude/commerce-h6-batch-i` |
| PR | __PR__ |
| Base SHA (origin/main, #1819 merge) | `26fd3c139bcf6aabe839b078f0aa3cb9bd85f7da` |
| Head SHA | __HEAD__ |

**Status.** No production code changed. Nothing merged, deployed or activated; `commerce.wholesale_buyer_enabled` stays off; Spree is untouched and the Spree exit is **not** complete. This batch converts every open wholesale blocker into either a proven negative test or a precise, owner-approvable specification, because none of the blockers has an approved contract or verifiable provenance yet.

## 1. Outcome by phase

| Phase | Result |
|---|---|
| 1 · Trusted visitor IP | **Stopped, fail-closed retained.** New evidence gathered; provenance of the visitor address still cannot be proven for production. Added negative tests; wrote the exact verification the operator must run and a ready-to-build signed design. |
| 2 · B2B pricing | **Specified, not changed.** Explicit precedence matrix of what the resolver does today (17 pinned tests), plus a proposed matrix and decisions D-B1…D-B6 awaiting approval. Two findings worth the owner's attention (§3). |
| 3 · Commercial rules | **Audited and documented.** Existing behaviour vs proposed contracts for MOQ, minimum amount, VAT, terms/credit, COD, suspension; 6 new characterization tests. |
| 4 · Safe implementation | Only tests and documents: nothing is backed by an approved contract, so no behavioural change was made. |

## 2. Findings and root causes

### 2.1 Visitor identity (Phase 1)
- **Root cause (unchanged):** every `store/v1` request reaches Laravel from the storefront server, so `REMOTE_ADDR` is the gateway for all visitors; the IP limiter dimension is one shared bucket (20/min per tenant). Per-email limits are unaffected.
- **New evidence:** `render.yaml` and `vercel.json` indicate the storefront is intended for Vercel; Vercel's documentation states it **overwrites** `X-Forwarded-For` and does not forward external IPs. That would make a gateway-computed address trustworthy *if* Vercel is the outermost edge.
- **Why that is not proof:** it is vendor documentation, not an observation of this deployment; the repo also ships a storefront `Dockerfile` and has Railway-hosted backend evidence; a CDN/WAF in front would change the answer; no record exists of what the storefront actually receives. A signature would authenticate *who sent* the value, not *what the value is* (see addendum §1). Implementing it now is the speculative fix the brief forbids.
- **Decision:** retained fail-closed; the exact operator checklist and a ready design (HMAC over visitor | timestamp | host, ±60 s, feature flag, default off) are in `AWJ_H6_BATCH_I_TRUSTED_VISITOR_IP_ADDENDUM.md`.

### 2.2 Pricing (Phase 2)
Details and the full matrix: `AWJ_H6_BATCH_I_PRICING_PRECEDENCE_MATRIX.md`. Two behaviours surfaced by characterization that the owner should know:
1. **Selection-before-lookup (m1b):** once a partner price list is chosen, an item missing from it falls back to the **base price**, never to the channel list, even when the channel list has a price.
2. **Silent retail fallback (m5b):** if a wholesale channel's default list is deactivated after assignment, the resolver quietly returns the **retail base price** with no error (assignment itself refuses an inactive list, but later deactivation is allowed). On a wholesale channel that is a plausible mispricing path.
Additionally: partner lists are gated by a **POS** setting (`apply_customer_price_list`) and price lists have **no validity dates**, so "expired" is not representable. No storefront path passes a partner to the resolver, so buyer-specific pricing is not active.
Cross-tenant / cross-channel attempts are rejected or ignored in every case tested (m8a–d); a channel list that cannot be resolved in the tenant fails closed.

### 2.3 Commercial rules (Phase 3)
Details: `AWJ_H6_BATCH_I_COMMERCIAL_RULES_CONTRACT.md`. Verified today: no MOQ, no minimum amount, no tax on orders, no credit/terms evaluation at order time, wholesale offers the same payment methods as retail, ordering creates no invoice/payment/journal/stock movement, and suspension retains the cart while blocking every boundary.

## 3. Completed (this PR)

| Item | Evidence |
|---|---|
| Phase 1 negative tests: direct API access (wrong / empty / missing gateway secret, no gateway headers) never reaches login or consumes the legitimate gateway's budget; mismatched secret fails closed even with forged visitor headers | `StorefrontClientIpBoundaryTest` (now 7 tests, SQLite + PostgreSQL) |
| Pricing precedence characterization, 17 tests covering active/inactive/absent partner and channel lists, POS toggle, no-validity-dates, buyer-agnostic resolver, DTC guest, cross-channel, cross-tenant partner / channel list / partner list | `CommercePricePrecedenceMatrixTest` (SQLite + PostgreSQL) |
| Commercial-rules characterization, 6 tests (no MOQ, no minimum amount, no tax added and no tax columns, no accounting side-effects, credit terms inert, same payment methods as DTC, suspended cart retained) | `WholesaleCartCheckoutBoundaryTest::characterization_*` |
| Three decision documents | trusted-IP addendum, pricing matrix, commercial-rules contract |

*Review fix (Codex P2, verified real, my own defect):* the direct-access test reused accumulated `withHeaders()` state, so its "no secret" and "no gateway headers" cases still sent earlier headers and did not exercise absence. It now flushes headers per case and asserts none remain; with truly absent headers the API still answers the uniform 404 (SQLite and PostgreSQL).

*Assumption corrected by testing:* three of my first-draft expectations were wrong (`priceListId` is set even when the item is missing, an inactive default list cannot be assigned, POS settings live under `sales_config.pos`); the tests were corrected to the real behaviour, never the other way round. No existing test was modified or weakened.

## 4. Deferred decisions (need the owner)

| ID | Decision | Recommended |
|---|---|---|
| D-T1 | Operator verifies the real chain (checklist in addendum §5); then choose signed visitor identity vs tenant+email caps | Verify first; signed identity if Vercel is outermost |
| D-B1 | Partner list without the item: fall through to the channel list? | Yes |
| D-B2 | Decouple partner pricing from the POS toggle | Yes, wholesale-scoped setting, default off |
| D-B3 | Buyer↔partner link: who creates it, mandatory? | Staff-only; optional for now |
| D-B4 | Roll-out of buyer pricing across listing/detail/cart/checkout | One per-channel switch, tested for parity |
| D-B5 | Wholesale channel with no list item or an inactive list | Unavailable, never retail |
| D-B6 | Price-list validity dates | Not now |
| D-M1 / D-M2 | MOQ and minimum order amount | Per channel, off by default |
| D-X1 | B2B tax display inclusive vs exclusive | Decide before any checkout wiring; EXT-05 dependency |
| D-P1 / D-P2 | Credit terms; COD for wholesale | After D-B3; per-channel allow-list |
| D-S1 | Suspended buyer's open cart | Retain (today) |
| D-I1 / D-V1 | Production mail transport; verification TTL | From Batch H, unchanged |

## 5. Risks and blockers
- **Shared gateway IP bucket** remains: one actor can exhaust the tenant's login IP budget (availability, not confidentiality). Wholesale is disabled everywhere, so there is no live exposure.
- **Silent retail fallback on a wholesale channel (m5b)** is a latent mispricing risk once wholesale is active; resolve through D-B5 before activation.
- **Checkout wiring stays deferred:** the storefront still does not forward the buyer token to cart/checkout; MOQ, minimum amount, VAT, terms and buyer pricing are all undecided.
- Production mail (`MAIL_MAILER=resend`, `RESEND_KEY`, sender domain) from Batch H is still unverified.

## 6. Verification

| Gate | Result |
|---|---|
| Affected backend suites (wholesale, buyer verification, client-IP, pricing, cart/checkout/order, price lists, module boundary, flowers, public API rate limit), SQLite | 589 passed, 39 skipped (PostgreSQL-only) |
| Same suites, PostgreSQL | 628 passed |
| Tenant isolation / authorization / negative cases | Covered by the above (matrix m8a–d, direct-access, forged headers, cross-tenant) |
| Storefront / web | **No files changed** under `storefront/` or `web/`; storefront checks and builds are exercised by CI |
| CI / CI Gate | __CI__ |

Environment note: `Fuel*` tests need `ext-bcmath`, absent locally only. No production code changed, so a full local backend run was not repeated; CI runs it.

## 7. Modified files
- Tests: `tests/Feature/StorefrontClientIpBoundaryTest.php` (+2), `tests/Feature/WholesaleCartCheckoutBoundaryTest.php` (+6), `tests/Feature/CommercePricePrecedenceMatrixTest.php` (new).
- Docs: `docs/audits/AWJ_H6_BATCH_I_TRUSTED_VISITOR_IP_ADDENDUM.md`, `…_PRICING_PRECEDENCE_MATRIX.md`, `…_COMMERCIAL_RULES_CONTRACT.md`, this report.

## 8. Spree dependency
Not touched (no `storefront/` change): ratchet unchanged at spree_value_imports=4, spree_type_imports=4, spree_client_access=52, spree_wrapper_imports=69, spree_env_reads=9. The legacy Spree checkout remains the live path; the Spree exit is not complete.

## 9. Recommended next step
Get three answers, in this order, then build: (1) operator evidence for the storefront chain (30 minutes, checklist in the addendum) → implement the signed visitor identity; (2) owner answers D-B1/D-B2/D-B5 → implement buyer pricing with a single per-channel switch and listing/detail/cart/checkout parity tests; (3) owner answers D-M1/D-M2/D-X1 → implement MOQ and minimum amount as per-channel settings. Only after all three, wire the buyer token through cart and checkout.
