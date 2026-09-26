# AWJ Store Official Brand, Contact & Payment Marks Horizon — Resume Note

**Status:** STORE-BRAND-WA-SOCIAL-1 and STORE-BRAND-APPS-1 done and in Production. CONTACT-1 and PAY-EVIDENCE-1 remain ready.  
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

`STORE-BRAND-APPS-1` — done.

- PR: [#1066](https://github.com/safwan5001-source/Nebrax/pull/1066)
- Merge SHA: `316005750560add32b26dc5adad024efd5541ad9` (on `main`)
- POST_MERGE_REVIEW: PASS for that Merge SHA
- Production auto-deploy SUCCESS on that SHA for storefront, Nebrax/web, nibras-api, and awj-scheduler (Vercel storefront and Vercel nebrax also SUCCESS). No manual deploy.
- Arabic App Store artwork uses `ar-AR`. Google Play displays at 60px so the padded official artwork stays at least 40px. Host allow-lists and live publisher URLs were kept.

Dependency-ready next tasks:

- `STORE-BRAND-CONTACT-1`
- `STORE-BRAND-PAY-EVIDENCE-1`

`STORE-BRAND-COMPOSE-1` stays blocked until CONTACT-1 is done. PAY-1 stays decision-gated.

Safwan has explicitly authorized authentic official marks, including TikTok. The social asset evidence gate is closed. WA-SOCIAL-1 is merged; do not reopen it unless a regression appears.

## Key payment gate

Before any mada / Visa / Mastercard / Apple Pay / Google Pay mark is shown, prove that the method is actually supported and enabled for the relevant storefront.

If no authoritative enabled-method source exists, stop the payment slice at a Decision Gate. This is a valid resolved state and does not block the remaining non-payment horizon work.

## Deployment

No manual Deploy / Production Release is authorized by this horizon definition.

Existing Railway auto-deploy behavior must be reported truthfully. Because a runtime merge to `main` may itself deploy Production, runtime-changing PRs stop before merge unless Safwan explicitly authorizes that Production impact (or a separately authorized deployment gate removes the automatic effect). Do not change deployment configuration in this horizon.

## End behavior

No automatic next horizon after closure.


## STORE-BRAND-0 key finding

Published Footer renders official WhatsApp and social marks (STORE-BRAND-WA-SOCIAL-1, PR #1064, Merge SHA `4739ecd6928c0ad506824e9a57939b3f35b08439`). Contact rows are still text-only. App Store / Google Play badges are verified and in Production (STORE-BRAND-APPS-1, PR #1066, Merge SHA `316005750560add32b26dc5adad024efd5541ad9`).

The storefront payment contract currently exposes channel-enabled PaymentMethod rows, but its Payment Intent methods are COD / Pay on Pickup and it explicitly has no online/card method yet. Do not infer Visa/Mastercard/mada/Apple Pay/Google Pay support from PaymentGateway provider configuration.
