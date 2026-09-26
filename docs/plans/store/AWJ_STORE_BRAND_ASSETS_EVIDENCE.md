# AWJ Store Brand Assets — STORE-BRAND-0 Evidence Pass

**Task:** STORE-BRAND-0  
**Status:** Evidence complete / no runtime implementation  
**Base SHA:** `17664760028e0dcd868ca8c5953ea0b4f385cee8`  
**Date:** 2026-09-26

## 1. Scope and method

This pass inspected the current AWJ Store implementation first, then checked first-party brand sources where public evidence was available.

No runtime code, API, database, payment semantics, deployment configuration, or production release behavior is changed by this task.

Classification values:

- COMPLETE
- IMPLEMENTATION_READY
- ASSET_EVIDENCE_REQUIRED
- PRODUCT_DECISION_REQUIRED
- ARCHITECTURE_DECISION_REQUIRED
- DEFERRED
- OUT_OF_SCOPE

## 2. Current repository evidence

### Published Footer

Published storefront uses:

`storefront/src/components/layout/Footer.tsx`

Current behavior:

- phone/email/address/hours render as plain text;
- WhatsApp renders as text;
- social links render as localized text labels, not brand marks;
- App Store / Google Play render through `OfficialStoreBadge`;
- payment marks are intentionally absent.

This confirms the user's reported visual gap is real: Contact, WhatsApp, and Social currently do not have their desired icon/mark presentation on the published storefront.

### Preview

The Web Store Customizer and maintained storefront mirror have preview equivalents.

Current preview behavior mirrors the published semantics for:

- configured contact values;
- WhatsApp link visibility;
- social-link visibility;
- App Store / Google Play badges.

Social and WhatsApp are still textual/general presentation rather than official marks.

### URL safety

Current presentation URL helpers:

- require HTTPS for general external links;
- reject javascript/data/vbscript/file schemes;
- build WhatsApp destinations through normalized `wa.me` URLs;
- allow App Store links only on `apps.apple.com`;
- allow Google Play links only on `play.google.com` / `play.app.goo.gl`.

These security boundaries should remain unchanged.

### App Store / Google Play badges

AWJ already has an `OfficialStoreBadge` component in both published and preview trees.

Current asset sources:

- Apple:
  `https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/{locale}?size=250x83`
- Google:
  `https://play.google.com/intl/en_us/badges/static/images/badges/{locale}_badge_web_generic.png`

The badge is hidden unless the configured destination passes the store-specific host allow-list.

### Payment architecture inventory

AWJ already separates **PaymentMethod** from **PaymentGateway**.

`PaymentGateway` explicitly documents itself as an integration/provider layer, not the operational payment method.

Current gateway provider identifiers include:

- Stripe
- Tap
- PayTabs
- Checkout.com
- Custom

However the current storefront checkout contract is more restrictive:

- payment methods are fetched from the channel-specific backend endpoint;
- the backend exposes only methods enabled for that channel;
- default online-channel availability is empty unless the merchant enables a method;
- current Payment Intent methods are only:
  - `cod`
  - `pay_on_pickup`
- storefront code explicitly states: **no online/card method exists yet**.

Therefore gateway configuration is not evidence that mada/Visa/Mastercard/Apple Pay/Google Pay are currently accepted by the public storefront.

This makes a static payment-logo row unsafe.

## 3. External first-party evidence

### WhatsApp

First-party WhatsApp Help documents `wa.me` click-to-chat and provides an official **Chat on WhatsApp** branded button in approved variants/sizes. It instructs users to use the button as-is and not modify it.

Source:
https://faq.whatsapp.com/5913398998672934

WhatsApp Terms also state that WhatsApp trademarks/logos may only be used with express permission or in accordance with WhatsApp Brand Guidelines.

Source:
https://www.whatsapp.com/legal/terms-of-service

**Evidence conclusion:** official branded-button use is evidenced. Standalone WhatsApp glyph treatment for AWJ's floating/footer icon still needs exact Brand Guidelines evidence before implementation.

### X

X provides a first-party Brand Toolkit with downloadable X logo assets and requires compliance with X Trademark/Brand Guidelines.

Source:
https://about.x.com/en/who-we-are/brand-toolkit

**Evidence conclusion:** official asset source exists.

### Snapchat

Snap's first-party Brand Guidelines explicitly instruct use of the official Ghost logo available from the official source.

Source:
https://www.snap.com/brand-guidelines

**Evidence conclusion:** official asset source exists.

### LinkedIn

LinkedIn's first-party `[in]` Logo guidance explicitly permits use in a series of social-media icons showing participation in those sites, using approved variants only.

Source:
https://brand.linkedin.com/in-logo

The full LinkedIn wordmark has tighter licensing restrictions and is not the asset AWJ should use for a social-icon row.

**Evidence conclusion:** `[in]` mark is suitable in principle for AWJ's social-icon row if the downloaded approved asset and allowed variant are used unmodified.

### Apple App Store

Apple's official App Store Marketing Guidelines require Apple-provided badge artwork, prohibit modification, specify minimum onscreen badge height (40px), and provide localized badges. Apple also states that the badge should link to the app's App Store product page.

Source:
https://developer.apple.com/app-store/marketing/guidelines/

AWJ's current component:

- uses Apple's first-party badge service;
- uses 40px onscreen height;
- does not redraw the badge;
- renders only for an `apps.apple.com` destination;
- supports Arabic/English badge locale selection.

**Evidence conclusion:** current AWJ implementation aligns strongly with the documented Apple badge rules. Final task should verify exact current artwork/legal-line requirements and rendered visual parity, not replace it blindly.

### Google Play

AWJ currently consumes a first-party `play.google.com` badge image and only renders it for allow-listed Google Play destinations.

Google's current public marketing tooling/guideline surfaces are in transition; the historic badge-generator path has changed and current Partner Marketing Hub guidance should be checked at implementation time.

Official Android marketing resource entry:
https://developer.android.com/distribute/marketing-tools

**Evidence conclusion:** first-party asset provenance exists in current code, but the final Google Play badge-guideline check remains required before declaring the app-badge slice COMPLETE.

### Instagram / Facebook

Meta maintains first-party brand-resource pages for Instagram and Facebook.

Current public fetch from the research environment returns a login requirement rather than the actual downloadable rules/assets.

Known first-party locations:
https://about.meta.com/brand/resources/instagram/instagram-brand/
https://about.meta.com/brand/resources/facebookapp/logo/

**Evidence conclusion:** official source location is known, but exact downloadable-asset and usage evidence is not sufficiently captured in this pass.

### YouTube

YouTube maintains a first-party Brand Resource Center:

https://brand.youtube/

The official site exposes logo/icon/color/promotional asset sections, but this evidence pass did not capture the detailed permitted-use text required to commit a specific production icon asset.

**Evidence conclusion:** exact asset/usage evidence still required.

### TikTok

TikTok's current first-party developer Design Guidelines state that TikTok logos, icons, symbols, or designs may not be used without prior written permission. The same page exposes TikTok asset packs, but asset availability does not itself remove the permission requirement.

First-party source:
https://developers.tiktok.com/doc/getting-started-design-guidelines

**Evidence conclusion:** this is a permission gate, not merely an asset-discovery gap. AWJ must not render a TikTok mark in the storefront unless the applicable permission/authorization basis is established. Text-label fallback remains the safe current behavior.

## 4. Evidence matrix

| Capability | Current config/source | Current Preview | Current Published | Official / utility source | Usage / safety state | Tenant/RBAC | Gap | Classification | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Contact: phone | presentation.contact.phone | Text | Text | AWJ utility icon system | No external trademark | Existing commerce authoring boundary | Missing icon | IMPLEMENTATION_READY | CONTACT-1 |
| Contact: email | presentation.contact.email | Text | Text | AWJ utility icon system | No external trademark | Existing commerce authoring boundary | Missing icon | IMPLEMENTATION_READY | CONTACT-1 |
| Contact: address | presentation.contact.address | Text | Text | AWJ utility icon system | No external trademark | Existing commerce authoring boundary | Missing icon | IMPLEMENTATION_READY | CONTACT-1 |
| Contact: hours | presentation.contact.hours | Text | Text | AWJ utility icon system | No external trademark | Existing commerce authoring boundary | Missing icon | IMPLEMENTATION_READY | CONTACT-1 |
| WhatsApp destination | phone/message/placement | Present | Present | wa.me | Current URL construction is fail-closed | Existing commerce authoring boundary | Brand mark missing | ASSET_EVIDENCE_REQUIRED | SOCIAL-ASSET-EVIDENCE-1 |
| Instagram | social[] HTTPS URL | Text label | Text label | Meta brand resources | URL safety exists | Existing commerce authoring boundary | Exact approved mark evidence incomplete | ASSET_EVIDENCE_REQUIRED | SOCIAL-ASSET-EVIDENCE-1 |
| X | social[] HTTPS URL | Text label | Text label | X Brand Toolkit | Official source found | Existing commerce authoring boundary | Mark not implemented | IMPLEMENTATION_READY after shared asset pass | SOCIAL-ASSET-EVIDENCE-1 → WA-SOCIAL-1 |
| TikTok | social[] HTTPS URL | Text label | Text label | TikTok first-party developer guidelines / asset packs | Prior written permission required by current developer guidance | Existing commerce authoring boundary | Permission basis not established | PRODUCT_DECISION_REQUIRED | SOCIAL-ASSET-EVIDENCE-1 decision packet |
| Snapchat | social[] HTTPS URL | Text label | Text label | Snap Brand Guidelines | Official Ghost source found | Existing commerce authoring boundary | Mark not implemented | IMPLEMENTATION_READY after shared asset pass | SOCIAL-ASSET-EVIDENCE-1 → WA-SOCIAL-1 |
| YouTube | social[] HTTPS URL | Text label | Text label | brand.youtube | Official center found; exact usage text incomplete | Existing commerce authoring boundary | Exact approved production asset evidence incomplete | ASSET_EVIDENCE_REQUIRED | SOCIAL-ASSET-EVIDENCE-1 |
| LinkedIn | social[] HTTPS URL | Text label | Text label | LinkedIn [in] Logo | Social-icon lineup use explicitly supported | Existing commerce authoring boundary | Mark not implemented | IMPLEMENTATION_READY after shared asset pass | SOCIAL-ASSET-EVIDENCE-1 → WA-SOCIAL-1 |
| Facebook | social[] HTTPS URL | Text label | Text label | Meta brand resources | Official source location known | Existing commerce authoring boundary | Exact approved mark evidence incomplete | ASSET_EVIDENCE_REQUIRED | SOCIAL-ASSET-EVIDENCE-1 |
| App Store | apps.iosUrl | Official badge | Official badge | Apple Marketing Tools | Strong first-party alignment; safe host gate | Existing commerce authoring boundary | Final verification / visual QA | IMPLEMENTATION_READY (verification/fix-only) | APPS-1 |
| Google Play | apps.androidUrl | Official badge | Official badge | play.google.com asset | First-party asset; current guideline verification still needed | Existing commerce authoring boundary | Final guideline / visual QA | IMPLEMENTATION_READY (verification/fix-only) | APPS-1 |
| Payment method source | channel payment-method endpoint | Checkout only | Checkout only | AWJ backend | Channel-scoped enabled list exists | Tenant/channel scoped | Footer has no bridge | IMPLEMENTATION_READY for evidence task only | PAY-EVIDENCE-1 |
| mada | no proven storefront capability | None | None | not evaluated in this shallow pass | No proof of supported+enabled online method | n/a | Capability not proven | DEFERRED pending PAY-EVIDENCE-1 | PAY-EVIDENCE-1 |
| Visa | no proven storefront capability | None | None | not evaluated in this shallow pass | No card method exists in current storefront contract | n/a | Capability not proven | DEFERRED pending PAY-EVIDENCE-1 | PAY-EVIDENCE-1 |
| Mastercard | no proven storefront capability | None | None | not evaluated in this shallow pass | No card method exists in current storefront contract | n/a | Capability not proven | DEFERRED pending PAY-EVIDENCE-1 | PAY-EVIDENCE-1 |
| Apple Pay | no proven storefront capability | None | None | not evaluated in this shallow pass | No online/card method exists in current storefront contract | n/a | Capability not proven | DEFERRED pending PAY-EVIDENCE-1 | PAY-EVIDENCE-1 |
| Google Pay | no proven storefront capability | None | None | not evaluated in this shallow pass | No online/card method exists in current storefront contract | n/a | Capability not proven | DEFERRED pending PAY-EVIDENCE-1 | PAY-EVIDENCE-1 |

## 5. Decisions from STORE-BRAND-0

### Ready now

1. **STORE-BRAND-CONTACT-1**
   - no trademark dependency;
   - current fields already exist;
   - Preview/Published surfaces already exist;
   - implementation is presentation-only.

2. **STORE-BRAND-APPS-1**
   - treat as verification/fix-only;
   - do not replace current official badge mechanism unless a verified defect exists.

3. **STORE-BRAND-PAY-EVIDENCE-1**
   - current repository gives a strong starting point;
   - must prove the exact supported+enabled public-store semantics before any payment mark is rendered.

### New dependency-safe evidence slice required

Create:

**STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1**

Purpose:

- obtain/capture exact first-party downloadable asset and permitted-use evidence for WhatsApp, Instagram, YouTube, Facebook;
- for TikTok, document the prior-written-permission gate and determine whether AWJ has an applicable authorization basis;
- re-confirm X, Snapchat, and LinkedIn asset variants;
- decide local committed asset vs first-party remote asset only where the official terms allow it;
- produce a closed asset registry for WA-SOCIAL-1.

No runtime implementation in this evidence slice.

### Not ready yet

**STORE-BRAND-WA-SOCIAL-1** remains blocked on SOCIAL-ASSET-EVIDENCE-1.

This prevents AWJ from substituting an unofficial icon pack just to make the Footer look complete.

## 6. Payment architecture finding

The current code already has a truthful channel-scoped payment-method endpoint, but the public storefront currently states that no online/card method exists and Payment Intent methods are COD / Pay on Pickup only.

Therefore:

- do not infer accepted card/wallet brands from PaymentGateway provider configuration;
- do not show Visa/Mastercard/mada/Apple Pay/Google Pay in the Footer now;
- PAY-EVIDENCE-1 should determine whether current PaymentMethod records can truthfully map to customer-facing payment brands, and whether that state is safely available to Footer/Preview.

If that mapping does not already exist, PAY-1 must remain decision-gated/deferred rather than inventing a new payment architecture inside this horizon.

## 7. Production / merge boundary

This evidence task is documentation-only.

Future runtime-changing PRs in this horizon must respect the documented Railway auto-deploy merge gate: merging a runtime PR to `main` can have Production impact and therefore requires Safwan's explicit authorization for that impact before merge.

## 8. STORE-BRAND-0 conclusion

**STORE-BRAND-0: PASS**

No P1/P2 runtime finding was introduced by this evidence pass.

Next dependency-ready tasks:

- STORE-BRAND-CONTACT-1
- STORE-BRAND-APPS-1
- STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1
- STORE-BRAND-PAY-EVIDENCE-1

WA-SOCIAL-1 remains blocked until its first-party asset registry is complete.
