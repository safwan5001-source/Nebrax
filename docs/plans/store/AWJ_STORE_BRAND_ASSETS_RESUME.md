# AWJ Store Official Brand, Contact & Payment Marks Horizon — Resume Note

**Status:** WA/SOCIAL, APPS-1, and CONTACT-1 are done. PAY-EVIDENCE-1 resolved at Decision Gate; PAY-1 deferred. COMPOSE-1 is next.  
**Definition base:** `c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`

## Objective

Complete the storefront's visible mark/icon layer with:

- official WhatsApp and supported social-network marks;
- official App Store / Google Play badges;
- AWJ utility icons for current phone/email/address/hours fields;
- official payment-method marks only when real supported+enabled payment capability is proven;
- Preview ↔ Published parity.

## Truth rules

- Third-party marks require first-party evidence.
- Utility icons use AWJ's maintained UI icon system.
- Empty/invalid links do not render.
- Payment logos are never decorative claims.
- No new payment integration, contact field, social network, or finance behavior is authorized.

## Current state

`STORE-BRAND-0` — PASS.

`STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1` — PASS.

Official registry: `docs/plans/store/AWJ_STORE_BRAND_SOCIAL_ASSET_REGISTRY.md`.

`STORE-BRAND-WA-SOCIAL-1` — done.

- PR: [#1064](https://github.com/safwan5001-source/Nebrax/pull/1064)
- Merge SHA: `4739ecd6928c0ad506824e9a57939b3f35b08439` (on `main`)
- POST_MERGE_REVIEW: PASS for that Merge SHA
- Production auto-deploy SUCCESS on that SHA for storefront, Nebrax/web, nibras-api, and awj-scheduler (Vercel storefront and Vercel nebrax also SUCCESS). No manual deploy.

Closed slices:

- `STORE-BRAND-APPS-1` — PR #1066, Merge SHA `316005750560add32b26dc5adad024efd5541ad9`.
- `STORE-BRAND-CONTACT-1` — PR #1068, Merge SHA `5802fc30b673e1be8b7fff8943d733d55b5df7a0`.
- `STORE-BRAND-PAY-EVIDENCE-1` — resolved at Decision Gate; see `AWJ_STORE_BRAND_PAY_EVIDENCE_DECISION.md`.

Next task: `STORE-BRAND-COMPOSE-1`.

`STORE-BRAND-PAY-1` is deferred until a server-authoritative card/wallet supported+enabled capability model exists.

Safwan has explicitly authorized authentic official marks, including TikTok. The social asset evidence gate is closed. WA-SOCIAL-1 is merged; do not reopen it unless a regression appears.

## Key payment gate

Before any mada / Visa / Mastercard / Apple Pay / Google Pay mark is shown, prove that the method is actually supported and enabled for the relevant storefront.

PAY-EVIDENCE-1 confirmed that the existing channel-enabled `PaymentMethod` source does not model card-network/wallet acceptance. Current Commerce Payment Intent supports only `cod` / `pay_on_pickup`; mada, Visa, Mastercard, Apple Pay, and Google Pay are not proven storefront capabilities.

Result: Decision Gate resolved, `STORE-BRAND-PAY-1` deferred. This does not block the remaining non-payment horizon work.

## Deployment

No manual Deploy / Production Release is authorized by this horizon definition.

Existing Railway auto-deploy behavior must be reported truthfully. Because a runtime merge to `main` may itself deploy Production, runtime-changing PRs stop before merge unless Safwan explicitly authorizes that Production impact (or a separately authorized deployment gate removes the automatic effect). Do not change deployment configuration in this horizon.

## End behavior

No automatic next horizon after closure.


## STORE-BRAND-0 key finding

Published Footer now has official WhatsApp/social marks, verified official App Store / Google Play badges, and AWJ utility icons for phone/email/address/hours with Preview/Public parity.

The storefront payment contract exposes channel-enabled `PaymentMethod` rows, but its Payment Intent methods are only COD / Pay on Pickup and it explicitly has no online/card method yet. Do not infer Visa/Mastercard/mada/Apple Pay/Google Pay support from `PaymentGateway` provider configuration.
