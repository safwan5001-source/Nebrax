# AWJ Store Official Brand, Contact & Payment Marks Horizon — Resume Note

**Status:** Definition proposed. No implementation started.  
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

## First task

`STORE-BRAND-0` — evidence only.

## Key payment gate

Before any mada / Visa / Mastercard / Apple Pay / Google Pay mark is shown, prove that the method is actually supported and enabled for the relevant storefront.

If no authoritative enabled-method source exists, stop at a Decision Gate.

## Deployment

No manual Deploy / Production Release is authorized by this horizon definition.

Existing Railway auto-deploy behavior must be reported truthfully if merges later cause production deployment; do not change deployment configuration in this horizon.

## End behavior

No automatic next horizon after closure.
