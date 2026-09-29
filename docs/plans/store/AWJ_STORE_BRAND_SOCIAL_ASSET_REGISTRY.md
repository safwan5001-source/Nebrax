# AWJ Store Social Brand Asset Registry — STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1

**Task:** STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1  
**Status:** PASS / evidence registry closed  
**Base SHA:** `687b0733fec5d8ed3b9fa50e65632c3c03fa0664`  
**Date:** 2026-09-26  
**Runtime changes:** none

## 1. Objective

Close the exact first-party source and intended asset variant for the WhatsApp + social marks that AWJ will render in Store Customizer Preview and Published Storefront.

Safwan's owner decision is already recorded: AWJ will use the authentic official marks, including TikTok. Known brand-use restrictions remain documented risk and do not block implementation.

## 2. Global implementation rules

For every external brand mark:

- use a first-party official asset only;
- do not redraw or trace the mark;
- do not substitute Lucide, Font Awesome, Simple Icons, an AI-generated icon, or any other unofficial icon-pack version;
- do not arbitrarily recolor, reshape, crop, rotate, stretch, outline, or add effects;
- preserve the official asset's aspect ratio;
- use the approved icon/glyph variant intended for compact social-link presentation rather than a full wordmark where an official compact mark exists;
- keep an accessible text name via `aria-label`;
- the mark remains a link affordance, not a claim that AWJ is affiliated with or endorsed by the platform;
- invalid/empty destination URLs continue to fail closed;
- Preview must not navigate; Published links open safely with `noopener noreferrer`.

### Asset storage rule

When the official first-party page exposes a downloadable asset/pack, implementation should vendor the **exact downloaded official bytes** in the storefront/web asset tree so Preview and Published do not depend on an uncontrolled third-party runtime request.

Do not convert/retrace the geometry into a hand-authored SVG.

If the first-party source only exposes a hosted official asset and does not provide a downloadable file, use that first-party source according to its documented pattern rather than copying an unofficial substitute.

## 3. Registry

| Brand | AWJ intended compact mark | First-party source | Evidence / usage relevant to AWJ | Planned asset handling | Status |
|---|---|---|---|---|---|
| WhatsApp | Official WhatsApp glyph from Meta/WhatsApp brand resources; use the official provided variant appropriate to the footer/floating background | https://about.meta.com/brand/resources/whatsapp/whatsapp-brand and WhatsApp Help `Chat on WhatsApp` guidance | WhatsApp Help explicitly supports branded website/mobile contact affordances, requires the official button to be used as-is, and `wa.me` is the current first-party click-to-chat route | Obtain exact official glyph/asset from Meta brand resource; vendor exact bytes if downloadable; no redraw | READY |
| Instagram | Official Instagram **Glyph** / compact icon from Meta brand resources | https://about.meta.com/brand/resources/instagram/icons/ | Meta maintains the first-party Instagram icon resource. Research environment requires login, but source location is first-party and the asset class is explicit | Obtain exact official Glyph from Meta resource; vendor exact bytes if downloadable; preserve provided variant | READY |
| X | Official **X logo** compact mark | https://about.x.com/en/who-we-are/brand-toolkit | X Brand Toolkit publishes downloadable X logo assets and binds use to X trademark/brand guidelines | Download from toolkit and vendor exact official asset; no modification | READY |
| TikTok | Official TikTok compact logo/icon from the first-party asset pack | https://developers.tiktok.com/doc/getting-started-design-guidelines | TikTok developer guidance exposes Logo/Button asset packs and states written-permission restrictions. Owner decision explicitly authorizes AWJ to proceed with the authentic mark; restriction remains recorded risk | Download exact first-party asset from TikTok pack and vendor unchanged | READY — owner-authorized |
| Snapchat | Official **Ghost logo** | https://www.snap.com/brand-guidelines | Snap explicitly says to use only the official Ghost logo available from its download | Download official Ghost asset and vendor exact bytes unchanged | READY |
| YouTube | Official compact **YouTube icon** from the YouTube Brand Resource Center, not a hand-built play triangle | https://brand.youtube/youtube-logo | YouTube's first-party Brand Resource Center exposes official logo/icon assets and variants | Use the official compact icon asset supplied by YouTube; vendor exact official bytes when downloaded | READY |
| LinkedIn | Official **[in] Logo** rather than the LinkedIn wordmark | https://brand.linkedin.com/in-logo | LinkedIn explicitly permits the [in] Logo in a series of social-media icons and provides approved blue/black/white variants; shape/color must not be modified | Download the approved [in] Logo variant appropriate to the footer background and vendor exact bytes | READY |
| Facebook | Official Facebook compact logo / **f** mark from Meta brand resources | https://about.meta.com/brand/resources/facebook/logo/ | Meta maintains the first-party Facebook logo resource. Research environment requires login, but source location is first-party | Obtain exact official compact Facebook mark from Meta resource and vendor exact bytes if downloadable | READY |

## 4. Per-brand notes

### WhatsApp

Current AWJ `wa.me` URL construction already matches WhatsApp's official click-to-chat pattern.

WhatsApp Help confirms:

- `https://wa.me/<number>` click-to-chat;
- an official branded contact button exists for websites/mobile;
- the official button is available in approved variants/sizes;
- the official branded treatment must not be modified.

For AWJ's compact Footer/Floating treatment, use the standalone official WhatsApp glyph from Meta's first-party WhatsApp brand resource rather than a generic chat bubble.

The floating control and footer link keep their existing destination semantics; this task changes only visual brand treatment.

### Instagram

Use Meta's official Instagram Glyph/compact icon, not the Instagram wordmark.

Do not substitute an unofficial SVG copied from an icon library.

### X

Use the official X logo from the X Brand Toolkit.

AWJ is linking to the merchant's configured X profile; it must not use partnership lockups, account-name lockups, or any asset that implies an X partnership.

### TikTok

Use the official TikTok asset from TikTok's own developer asset pack.

TikTok's current developer guidance says its logos/icons may not be used without prior written permission. Safwan has explicitly directed AWJ to proceed with the authentic official mark. Record this as known brand-use risk; do not downgrade to an unofficial substitute.

### Snapchat

Use only the official Ghost logo as Snap instructs.

Do not synthesize a ghost silhouette.

### YouTube

Use the official compact YouTube icon from YouTube's Brand Resource Center.

Do not recreate the red rounded rectangle/play symbol in CSS or SVG.

### LinkedIn

Use the `[in]` Logo, because LinkedIn expressly allows that asset in a social-media icon lineup.

Do not use the full LinkedIn Logo/wordmark: LinkedIn's separate wordmark guidance requires an existing brand/trademark license.

Use only one of LinkedIn's supplied approved color variants; no custom recolor.

### Facebook

Use the compact Facebook mark from Meta's first-party Facebook resource.

Do not use an icon-library approximation.

## 5. Visual composition decision

The social row is a set of authentic brand marks, **not** a monochrome AWJ icon set.

Therefore:

- do not normalize all external marks by recoloring them into AWJ theme colors;
- normalize only the surrounding hit-area, spacing, alignment, and maximum visual box;
- preserve each mark's official aspect ratio and supplied color treatment;
- target a consistent interaction area (minimum 44px touch target) while allowing the actual mark artwork to keep its own optical size;
- do not stretch marks to identical width/height.

Contact utilities remain separate: phone/email/address/hours use AWJ's maintained Lucide icon system because they are semantic UI symbols, not third-party brands.

## 6. Preview / Published contract

The same shared brand-mark registry/component behavior should power:

- Merchant Web Customizer Preview;
- maintained storefront customizer mirror;
- Published Footer;
- WhatsApp floating action where configured.

Requirements:

- identical mark selection for a given network;
- Preview prevents navigation;
- Published uses the sanitized existing destination;
- icon-only link has localized accessible name;
- no mark when its link/value is absent or invalid;
- no new social network is introduced.

## 7. Evidence sources

First-party sources reviewed for this slice:

- WhatsApp Help — click to chat / official branded button:
  https://faq.whatsapp.com/5913398998672934
- WhatsApp / Meta brand resource:
  https://about.meta.com/brand/resources/whatsapp/whatsapp-brand
- Instagram / Meta brand resource:
  https://about.meta.com/brand/resources/instagram/icons/
- Facebook / Meta brand resource:
  https://about.meta.com/brand/resources/facebook/logo/
- X Brand Toolkit:
  https://about.x.com/en/who-we-are/brand-toolkit
- TikTok for Developers — Design Guidelines / Asset Packs:
  https://developers.tiktok.com/doc/getting-started-design-guidelines
- Snap Brand Guidelines:
  https://www.snap.com/brand-guidelines
- YouTube Brand Resource Center:
  https://brand.youtube/
  https://brand.youtube/youtube-logo
- LinkedIn [in] Logo guidance:
  https://brand.linkedin.com/in-logo

## 8. Gate result

**STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1: PASS**

Every supported social network now has:

- a first-party source;
- a named intended official asset/variant;
- an implementation handling rule;
- a no-substitution rule.

No additional product decision is required before implementing the official marks.

Promote:

**STORE-BRAND-WA-SOCIAL-1 → READY**

Runtime implementation remains subject to the Horizon's Production auto-deploy merge gate.
