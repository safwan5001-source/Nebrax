# AWJ Store Official Brand, Contact & Payment Marks Horizon V1

**Status:** Proposed / owner-authorized for definition only  
**Repository:** `safwan5001-source/Nebrax`  
**Base main SHA:** `c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`  
**Preceding horizon:** AWJ Store Trust, Business Identity & External Brands V1 — CLOSED  
**No manual Deploy / Production Release authorization**

## 1. Objective

Complete the visual trust layer of the AWJ storefront with authentic, correctly sourced brand marks and consistent utility icons across merchant authoring, preview, and the published storefront.

This horizon covers:

- official WhatsApp mark;
- official supported social-network marks;
- official App Store / Google Play badges;
- AWJ-standard contact/utility icons;
- payment-method marks only when backed by real supported/enabled payment capability;
- Preview ↔ Published parity;
- responsive, accessibility, security, and brand-usage verification.

This horizon must not create a decorative “logo wall” that claims unsupported capabilities.

## 2. Core product rule

Every visible mark must communicate truth.

### External brand marks

Use only first-party official assets or usage patterns supported by authoritative brand guidance. Do not use:

- AI-generated brand marks;
- hand-redrawn approximations;
- unofficial icon packs as substitutes for official marks;
- screenshot crops;
- arbitrary recoloring or geometry changes;
- copied assets whose provenance or permission is unclear.

### Contact / utility icons

Phone, email, address/location, business hours, and similar non-brand utilities may use AWJ's maintained UI icon system (for example the project's existing Lucide usage) because these are semantic utility symbols, not third-party trademarks.

### Payment marks

A payment mark may appear only when AWJ can prove that the corresponding payment method is actually supported and enabled for the relevant storefront/channel.

Examples to investigate, not pre-authorized assumptions:

- mada
- Visa
- Mastercard
- Apple Pay
- Google Pay

Do not show a payment brand merely because the asset exists.

## 3. Mandatory evidence rule

Before adding or changing any third-party mark or badge, record evidence for:

- official first-party source;
- exact approved mark/badge;
- intended storefront context;
- permitted colors and variants;
- minimum size / clear-space / aspect-ratio rules where specified;
- localization rules;
- whether local hosting is permitted;
- whether hot-linking/remote serving is required or discouraged;
- whether alteration/recoloring is permitted;
- linking requirements;
- attribution requirements;
- restrictions relevant to checkout, footer, app promotion, or merchant previews.

Clearly separate:

**External evidence**

from

**AWJ Decision / Proposal**.

If usage permission or product truth is unresolved, stop at a Decision Gate. Do not guess.

## 4. Scope

### A. WhatsApp

- official WhatsApp mark when evidence permits;
- current phone/message semantics remain unchanged;
- current placements remain: floating / footer / both;
- preview does not navigate;
- published storefront uses safe external-link behavior;
- mark hidden when the destination is invalid or disabled;
- accessible name remains available.

### B. Supported social networks

Current supported networks only:

- Instagram
- X
- TikTok
- Snapchat
- YouTube
- LinkedIn
- Facebook

For each:

- verify official mark source and usage;
- render the permitted mark beside/instead of the current text treatment as appropriate;
- preserve accessible names;
- invalid/empty URLs fail closed;
- no new network is introduced;
- preview and published storefront remain semantically identical.

### C. App Store / Google Play

- use the official App Store badge;
- use the official Google Play badge;
- preserve current `iosUrl` / `androidUrl` contracts;
- badge appears only for a valid destination;
- support one-link and two-link states;
- render in App Promo and Footer where current product settings permit;
- Preview ↔ Published parity;
- no claim that an app exists without a configured valid link.

### D. Contact / utility icons

Add a coherent AWJ utility-icon treatment for currently supported contact fields:

- phone;
- email;
- address/location;
- business hours;
- website only if a current supported field exists.

Rules:

- use the existing AWJ icon system rather than external brand assets;
- do not invent new contact fields in this horizon;
- hide icon + row when the corresponding value is absent;
- keep text readable; icons must not become the only accessible label;
- RTL/LTR alignment must be intentional.

### E. Payment method marks

First prove the runtime/source-of-truth for payment availability.

Only after that evidence may the horizon render official marks for methods that are both:

1. supported by AWJ's actual payment capability; and
2. enabled/available for the relevant storefront.

Required behavior:

- Preview must reflect the same source-of-truth semantics as Published;
- disabled/unsupported methods do not render;
- payment method must not be confused with payment gateway/provider;
- no static hard-coded marks presented as accepted payment methods without capability evidence;
- Footer rendering must be reusable by Checkout later, but Checkout redesign is out of scope.

If no authoritative enabled-payment-method source currently exists, classify this slice as PRODUCT_DECISION_REQUIRED or ARCHITECTURE_DECISION_REQUIRED and stop before implementation.

### F. Shared storefront composition

The final public Footer must remain coherent and readable, with semantic groups rather than an undifferentiated icon strip:

1. store/business identity;
2. official trust / SBC;
3. contact information;
4. WhatsApp and social;
5. applications;
6. payment methods, only when truthful.

No duplicate Footer implementation.

## 5. Required surfaces

Changes must be verified on:

- Merchant Web Store Customizer;
- maintained storefront preview/dev mirror where applicable, marked non-authoritative;
- Published Storefront;
- App Promo;
- Footer;
- WhatsApp floating action where configured.

A feature is not complete merely because the asset exists in the repository.

## 6. Explicitly out of scope

- new social networks;
- new contact data fields;
- new payment gateway integration;
- enabling a payment method that does not already exist;
- checkout redesign;
- payment settlement/accounting changes;
- ZATCA changes;
- payment-provider onboarding;
- promotions / offers;
- persistent merchant media/storage architecture;
- Business Documents uploads;
- broad Store Customizer redesign;
- arbitrary external-brand asset library;
- manual Deploy / Production Release.

## 7. Invariants

Preserve:

- Tenant Isolation;
- `commerce.manage` authorization for merchant authoring;
- Draft/Public separation;
- URL sanitization and safe external-link behavior;
- existing presentation document backward compatibility;
- no arbitrary merchant HTML/JS;
- no secret/token exposure;
- no finance/accounting/payment semantics changes;
- no unsupported payment availability claims.

## 8. Visual / accessibility QA

Required widths:

- 390
- 430
- 768
- 1024
- 1280
- 1440

Locales:

- Arabic RTL
- English LTR

States:

- no contact data;
- partial contact data;
- complete contact data;
- no social links;
- one social link;
- all supported social links;
- WhatsApp off / footer / floating / both;
- App Store only;
- Google Play only;
- both app stores;
- invalid/unsafe external links;
- payment none / one / multiple, only where capability evidence supports them;
- long text;
- missing logo/identity values.

Verify:

- no horizontal overflow;
- brand marks keep correct proportions;
- touch targets are usable;
- icon-only links have accessible names;
- keyboard focus remains visible;
- Preview and Published semantics match.

## 9. Task sequence

Use:

`docs/plans/store/AWJ_STORE_BRAND_ASSETS_TASK_QUEUE.md`

All implementation is dependency-safe and evidence-first.

## 10. Horizon gates

Every implementation PR requires:

Evidence → Architecture/Decision as needed → Scope/DoD → focused tests → risk tests → implementer self-review → reviewer → AWJ Guardian → exact-head CI → PRE_MERGE_REVIEW PASS → merge only with the applicable owner authorization → POST_MERGE_REVIEW PASS.

No manual deploy.

Note: Railway production may currently auto-deploy merges from `main`. This horizon must record actual deployment state truthfully, but must not modify deployment configuration or trigger a deploy without separate owner authorization.

## 11. Horizon end

Close only when:

- every ready slice is merged and post-reviewed;
- every external mark in use has provenance/usage evidence;
- Contact icons, Social/WhatsApp marks, and App badges render on the actual published storefront;
- payment marks either render from a proven truthful capability source or are explicitly left behind a documented decision gate;
- Preview ↔ Published parity is recorded;
- responsive/accessibility/security QA is recorded;
- closure report and durable current state are updated.

Do not automatically start a payment-integration, storage, checkout, or new-brand horizon after closure.
