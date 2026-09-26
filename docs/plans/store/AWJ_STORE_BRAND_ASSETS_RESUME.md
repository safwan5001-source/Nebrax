# AWJ Store Official Brand, Contact & Payment Marks Horizon — Resume Note

**Status:** STORE-BRAND-0 evidence complete. No runtime implementation started.  
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

Dependency-ready next tasks:

- `STORE-BRAND-WA-SOCIAL-1`
- `STORE-BRAND-CONTACT-1`
- `STORE-BRAND-APPS-1`
- `STORE-BRAND-PAY-EVIDENCE-1`

Safwan has explicitly authorized authentic official marks, including TikTok. The social asset evidence gate is closed.

## Key payment gate

Before any mada / Visa / Mastercard / Apple Pay / Google Pay mark is shown, prove that the method is actually supported and enabled for the relevant storefront.

If no authoritative enabled-method source exists, stop the payment slice at a Decision Gate. This is a valid resolved state and does not block the remaining non-payment horizon work.

## Deployment

No manual Deploy / Production Release is authorized by this horizon definition.

Existing Railway auto-deploy behavior must be reported truthfully. Because a runtime merge to `main` may itself deploy Production, runtime-changing PRs stop before merge unless Safwan explicitly authorizes that Production impact (or a separately authorized deployment gate removes the automatic effect). Do not change deployment configuration in this horizon.

## End behavior

No automatic next horizon after closure.


## STORE-BRAND-0 key finding

Published Footer currently renders contact, WhatsApp, and social values without the requested icons/official marks. App Store / Google Play already use first-party badge URLs in Preview and Published.

The storefront payment contract currently exposes channel-enabled PaymentMethod rows, but its Payment Intent methods are COD / Pay on Pickup and it explicitly has no online/card method yet. Do not infer Visa/Mastercard/mada/Apple Pay/Google Pay support from PaymentGateway provider configuration.
