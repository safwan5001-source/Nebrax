# AWJ Store Official Brand, Contact & Payment Marks — Task Queue V1

**Horizon:** AWJ Store Official Brand, Contact & Payment Marks Horizon V1  
**Base at definition:** `c1bdac3b3f1f7f5be7cfde6b918671d0cb7814e1`

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 0 | STORE-BRAND-0 | done | normal | horizon definition | Evidence matrix for marks/utility icons + current payment architecture inventory |
| 1 | STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1 | ready | normal | STORE-BRAND-0 | Close first-party asset/usage evidence for WhatsApp + seven social networks |
| 2 | STORE-BRAND-WA-SOCIAL-1 | blocked_on_asset_evidence | normal | STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1 | Official WhatsApp + seven supported social marks with Preview/Public parity |
| 3 | STORE-BRAND-APPS-1 | ready | normal | STORE-BRAND-0 | Verify/fix official App Store / Google Play badges in AppPromo + Footer |
| 4 | STORE-BRAND-CONTACT-1 | ready | normal | STORE-BRAND-0 | AWJ utility icons for phone/email/address/hours on Preview + Published |
| 5 | STORE-BRAND-PAY-EVIDENCE-1 | ready | high | STORE-BRAND-0 | Prove payment-method source-of-truth and classify implementation readiness |
| 6 | STORE-BRAND-PAY-1 | decision_gated | high | STORE-BRAND-PAY-EVIDENCE-1 | Render only truly supported/enabled official payment marks |
| 7 | STORE-BRAND-COMPOSE-1 | blocked | normal | WA/SOCIAL + APPS + CONTACT; PAY only if implementation-ready | Final Footer composition and shared mark component behavior |
| 8 | STORE-BRAND-QA-1 | blocked | high | implemented slices | Responsive RTL/LTR, accessibility, security, actual published-route parity |
| 9 | STORE-BRAND-CLOSE-1 | blocked | normal | all ready work closed | Closure report + durable state |

## STORE-BRAND-0 — Evidence Pass

No runtime implementation.

Create:

`docs/plans/store/AWJ_STORE_BRAND_ASSETS_EVIDENCE.md`

Required matrix:

`Capability | Current config/source | Current Preview | Current Published | Official/utility asset source | Usage rules | URL/capability validation | Tenant/RBAC | Gap | Classification | Next action`

Inspect at minimum:

- published Footer;
- WhatsApp floating/footer components;
- social presentation;
- AppPromo;
- App Store / Google Play current badge implementation;
- Web Customizer controls + preview;
- maintained storefront mirror;
- presentation normalizers / URL helpers;
- current payment capability/configuration/runtime inventory only, enough to locate candidate sources and boundaries;
- checkout/payment-method source if one exists;
- tests.

Do not duplicate the deep payment proof here. STORE-BRAND-PAY-EVIDENCE-1 owns the authoritative supported+enabled-method investigation and its decision classification.

For third-party marks, use authoritative first-party sources.

Classify each item:

- COMPLETE
- IMPLEMENTATION_READY
- ASSET_EVIDENCE_REQUIRED
- PRODUCT_DECISION_REQUIRED
- ARCHITECTURE_DECISION_REQUIRED
- DEFERRED
- OUT_OF_SCOPE

## STORE-BRAND-WA-SOCIAL-1

Definition of Done:

- official/permitted WhatsApp mark;
- official/permitted marks for Instagram, X, TikTok, Snapchat, YouTube, LinkedIn, Facebook;
- no unofficial substitutes;
- empty/invalid links do not render;
- preview does not navigate;
- published links remain safe;
- accessible name for every mark;
- Preview/Public parity;
- no new networks.

## STORE-BRAND-APPS-1

Definition of Done:

- first-party approved App Store badge;
- first-party approved Google Play badge;
- one-link and two-link states;
- no badge without valid corresponding URL;
- AppPromo and Footer use aligned semantics;
- Preview/Public parity;
- correct aspect ratio / minimum-size handling from evidence.

## STORE-BRAND-CONTACT-1

Definition of Done:

- coherent utility icons for current supported phone/email/address/hours fields;
- website icon only if a current supported website field is proven;
- no new contact schema/API field;
- absent values hide their icon/row;
- icons supplement readable text rather than replace it;
- RTL/LTR alignment verified;
- Preview/Public parity.

## STORE-BRAND-PAY-EVIDENCE-1

Evidence only unless implementation is proven safe.

Must answer:

- Where does AWJ currently define supported payment methods?
- Where does it define merchant/storefront-enabled payment methods?
- Is availability tenant/store/channel scoped?
- Is the same truth available to Preview and Published Storefront safely?
- Are mada/Visa/Mastercard/Apple Pay/Google Pay actually supported today, individually?
- Which are methods versus gateway/provider brands?
- What official brand assets and usage requirements apply?
- Can Footer marks be rendered without misrepresenting checkout capability?

If there is no authoritative enabled-method source, stop this payment slice and create a Decision Packet. Do not hard-code a decorative list.

A PRODUCT_DECISION_REQUIRED / ARCHITECTURE_DECISION_REQUIRED / DEFERRED result here is a valid resolved state for this horizon and **does not block** STORE-BRAND-COMPOSE-1, QA-1, or CLOSE-1 for the non-payment scope.

## STORE-BRAND-PAY-1

Runs only if PAY-EVIDENCE-1 classifies a concrete implementation as ready.

Definition of Done:

- official marks only;
- rendered set derives from authoritative supported+enabled capability;
- tenant/store isolation preserved;
- unsupported/disabled methods hidden;
- Preview/Public semantics aligned;
- no gateway/provider confusion;
- no settlement/accounting behavior change;
- component can be reused later by Checkout without redesigning Checkout now.

## STORE-BRAND-COMPOSE-1

Definition of Done:

- one Footer implementation;
- semantic groups remain clear;
- no visually noisy logo wall;
- brand and utility icons have consistent optical sizing without distorting official assets;
- mobile and desktop intentionally composed;
- no horizontal overflow.

## STORE-BRAND-QA-1

Widths:

390 / 430 / 768 / 1024 / 1280 / 1440

Locales:

ar RTL / en LTR

Capture actual rendered evidence for:

- merchant Web Customizer;
- Published Storefront;
- AppPromo;
- Footer;
- floating WhatsApp where configured.

The maintained dev mirror may supplement but never replace production-route evidence.

## STORE-BRAND-CLOSE-1

Close only after:

- all ready tasks are merged and POST_MERGE_REVIEW PASS;
- no unresolved P1/P2;
- external asset provenance is durable;
- payment decision state is explicit;
- actual deployment state is reported truthfully;
- `docs/autonomous-engineering/CURRENT-STATE.md` is updated.

No automatic next horizon.


## STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1 — Official asset registry

Documentation/evidence only.

Definition of Done:

- exact first-party source recorded for WhatsApp, Instagram, X, TikTok, Snapchat, YouTube, LinkedIn, Facebook;
- exact asset/variant intended for AWJ recorded;
- permitted storefront/social-link usage recorded;
- local-host vs first-party-remote consumption rule recorded;
- recolor/modify/clear-space/minimum-size rules recorded where applicable;
- any permission/license restriction identified explicitly;
- no runtime code;
- owner decision is already recorded to proceed with authentic official marks, including TikTok;
- WA-SOCIAL-1 promoted when every mark it will render has a confirmed first-party asset/variant.

Do not substitute an unofficial icon pack. Brand-use restrictions remain documented risk, not an implementation blocker unless they expose a technical/security issue.
