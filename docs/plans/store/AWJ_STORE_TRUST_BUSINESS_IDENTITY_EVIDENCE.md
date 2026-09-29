# STORE-TRUST-0 — Evidence Pass

**Horizon:** AWJ Store Trust, Business Identity & External Brands V1  
**Status:** Evidence only. No runtime change.  
**Verified `origin/main`:** `e69a8e115f4dc2ef420a24b429be5b79fefd1e8d`  
**Horizon definition merge:** PR #1047, same SHA  
**Preceding SBC merge:** PR #926, merge SHA `7c1dd55c7e7cd2e8e9d80f3cf52f65b260947d48`  
**Date:** 2026-09-26  
**No deploy. No storage activation. No new schema.**

This pass classifies the current store. It does not implement the next task.

## 1. What was inspected

Repository surfaces, not memory:

- `app/Support/Commerce/StorefrontPresentationNormalizer.php` and the TypeScript twins in `storefront/src/lib/presentation/config.ts`, `web/src/modules/store-experience-builder/presentation/config.ts`, and `storefront/src/components/customizer` (dev mirror).
- Public read: `app/Http/Controllers/Api/StorefrontConfigController.php`.
- Published footer: `storefront/src/components/layout/Footer.tsx`, `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`.
- Published home app band: `storefront/src/components/home/AppPromoBand.tsx`, `page.tsx`.
- Merchant Web Customizer: `web/src/app/(commerce)/commerce/appearance/page.tsx`, `web/src/modules/store-experience-builder/*`.
- Maintained dev mirror, not product authority: `storefront/src/app/dev/store-ui-6/page.tsx`, `storefront/src/app/dev/customizer-visual/page.tsx`, `storefront/src/components/customizer/*`.
- Contracts already on main: `docs/AWJ_STORE_BUSINESS_IDENTITY_SBC_UX_BASELINE.md`, `docs/AWJ_STORE_SBC_VERIFICATION_V1_CONTRACT.md`.
- Tests: `StorefrontPublicIdentityTest`, `StorefrontPresentationPublicRuntimeTest`, `StorefrontPresentationNormalizerTest`, footer/SBC component tests, customizer `ExperienceBuilder` tests.
- Open PR #1044 (not merged).

## 2. PR #926 and PR #1044

PR #926 is merged. SBC on current main is that implementation. This horizon must not rebuild it.

PR #1044 was re-read on 2026-09-26:

| Field | Observed |
|---|---|
| State | Open, not draft, not merged |
| Mergeability | `MERGEABLE` / `CLEAN` |
| Head | `7d322222afcace1fe68ed73a88712edeb1ab1ecb` |
| Base | `0f36355573b3de746211bd1bed0a6f888f0bba0a` (stale relative to current main) |
| Files | Four docs only: branding evidence, decision packet, pass note, `CURRENT-STATE.md` |
| Decision inside the branch | Option 1, key `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED` |

Automatic merge is not authorized. Merging it would also replay a `CURRENT-STATE.md` edit written against a stale base. STORE-TRUST-STATE-1 must copy the owner decision onto current main as documentation only.

The execution order for this horizon repeats the same owner decision. That removes the open infrastructure gate for this horizon. It does not authorize uploads, a bucket, `DOCUMENT_DURABLE_STORAGE_ENABLED`, local container disk, or a Business Documents viewer.

## 3. External evidence

Observed on 2026-09-26 from the publisher's own pages. This section is evidence, not permission invented by AWJ.

### Saudi Business Center

Already contracted on main. The only approved runtime integration is the government loader:

`https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js`

AWJ does not host, redraw, or mirror the seal. The customizer must not execute the loader. Text **موثّق في منصة الأعمال** is an AWJ presentation label when `show_in_storefront` is on, including when the loader is absent or fails. It is not an AWJ verification result. Source: `docs/AWJ_STORE_SBC_VERIFICATION_V1_CONTRACT.md` §4 and §7.1.

### WhatsApp

- Brand center: [WhatsApp Brand Resources](https://whatsappbrand.com/) (redirects into Meta's brand center).
- Observed rule: use only official artwork; do not modify, recolor, combine with another mark, or make it the dominant feature.
- Observed condition on the brand page's business-presence section: the logo may be used to promote a business presence on WhatsApp when the business uses the WhatsApp Business app or the WhatsApp Business API, with a clear call to action unless the logo sits beside other social icons.
- Asset download is behind an on-site acceptance control. No unmodified official file was retrieved into this repository.

### Social networks already in the product contract

No new network was added.

| Network | Official source consulted | What was established |
|---|---|---|
| Instagram | [Instagram brand resources](https://about.meta.com/brand/resources/instagram/instagram-brand/) | Official assets only. Do not modify or imply partnership. Mentioning a handle does not need a Meta review. Download requires accepting the guidelines. |
| Facebook | [Meta brand resource center](https://about.meta.com/brand/resources/) | Same family of rules: official assets, no modification, no implied partnership. |
| X | Brand toolkit is first-party at `https://about.x.com/en/who-we-are/brand-toolkit`. Not fetched as a binary. | Not used as permission to redraw the mark. |
| TikTok | `https://www.tiktok.com/branding` | Not used as permission to redraw the mark. |
| Snapchat | Snap brand guidelines are first-party via Snapchat's brand site. | Not used as permission to redraw the mark. |
| YouTube | Google/YouTube brand resources. | Not used as permission to redraw the mark. |
| LinkedIn | LinkedIn brand site. | Not used as permission to redraw the mark. |

No official icon file was copied into the repo. Unofficial icon packs, Lucide substitutes for those marks, screenshots, and generated marks are not evidence of permission.

### App Store

- Guidelines: [App Store Marketing Resources and Identity Guidelines](https://developer.apple.com/app-store/marketing/guidelines/).
- Use the official badge as a call to action to get the app. Do not modify, angle, animate, or translate "App Store" yourself. Arabic is a provided localization. Minimum on-screen height 40px. Clear space is one quarter of the badge height (one tenth only in very tight layouts). When another store badge is present, use the preferred black badge.
- Live first-party badge endpoint, confirmed `200 image/svg+xml` on 2026-09-26:
  - English: `https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us?size=250x83`
  - Arabic: `https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/ar-sa?size=250x83`
- The older `tools.applemediaservices.com` host redirects there. Bulk artwork download is a large zip behind an acceptance control and was not copied into git.

### Google Play

- Guidelines: [Android / Google Play brand guidelines](https://developer.android.com/distribute/marketing-tools/brand-guidelines) and the badge page linked from [Google Play brand and marketing](https://play.google.com/intl/en-GB_ALL/console/about/brand-and-marketing).
- Use the "Get it on Google Play" badge only to send people to content on Google Play. Do not recolor, rearrange, or rebuild it. Minimum digital height 28px. Clear space is one quarter of the height. When placed with another store badge, the Play badge must be the same height or taller. Use the localized badge for the page language. Do not keep an outdated copy.
- Live first-party PNG, confirmed `200 image/png` on 2026-09-26:
  - `https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png`
  - `https://play.google.com/intl/en_us/badges/static/images/badges/ar_badge_web_generic.png`

## 4. AWJ decisions taken from that evidence

These are AWJ decisions for this horizon. They are not new product options left open.

1. **Storage.** Stay on `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`. STATE-1 only writes that decision onto current main. Do not merge #1044 as a shortcut.
2. **SBC artwork.** Keep the government loader. Do not add a local seal file. Do not treat "ON without a token" as a defect: the existing contract already shows the text label whenever `show_in_storefront` is true, and the loader only when a token exists.
3. **WhatsApp mark.** Do not ship the official WhatsApp glyph in this horizon. AWJ does not know that the merchant uses the WhatsApp Business app or API, and no official file was obtained. Keep the current generic control plus the accessible name "Contact on WhatsApp" / "التواصل عبر واتساب". The generic Lucide icon is not presented as the WhatsApp logo.
4. **Social marks.** Do not add icon glyphs. Keep text links for the seven supported networks, with a readable network name and an accessible name. Empty and non-https URLs stay hidden.
5. **App badges.** Evidence permits the official badges. Render them with `<img>` pointed at the live first-party URLs above, only beside a URL that already passes the store-host allow-list. Do not commit badge binaries, do not inline or edit the SVG, and do not draw a substitute. If the image fails, the link and its accessible name remain. Arabic uses the Arabic badge; other storefront locales use the matching official badge when that URL is the publisher's, otherwise the English official badge rather than a translated redraw.
6. **URL policy.** Do not invent a new social-host allow-list. Social stays https-only, as normalized today. App links stay on the existing store-host helpers. One defect is in scope for APPS-1: `isSafeAppStoreUrl` currently accepts any `*.apple.com` host, which is wider than an App Store product URL. Tighten it to `apps.apple.com` only, in every twin (PHP, storefront, web). `itunes.apple.com` is not required; current normalizer tests do not depend on it. Play stays `play.google.com` and `play.app.goo.gl`.
7. **Legal identity.** Public CR, VAT, and legal name come only from the resolved Tenant via `business_identity`. `verification.crNumber` stays in stored documents for compatibility and must not be rendered as the CR. No Customizer field may edit CR, VAT, or legal name.
8. **No Decision Packet.** Nothing in this pass needs a new storage provider, verification authority, legal-identity source, external brand, schema, or finance change.

## 5. Capability matrix

| Capability | Current merchant input | Canonical source | Draft persistence | Public payload | Preview (Web Customizer) | Published | Official asset source | Usage permission | URL validation | Tenant/RBAC | Gap | Classification | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Legal name | None in Customizer. Company settings own it. | `Tenant.name` | Not in presentation JSON | `business_identity.legal_name` | Shown when non-empty | Footer shows it | n/a | n/a | n/a | Public read uses resolved storefront tenant. `StorefrontPublicIdentityTest` covers host isolation and nulls. | Web verification panel shows CR only, not legal name. | IMPLEMENTATION_READY | BIZ-1: read-only legal name beside CR. Do not add an editor. |
| Commercial Registration | Web Customizer: read-only output of company CR. Dev mirror still edits `verification.crNumber`. | `Tenant.cr_number` | Legacy `verification.crNumber` still stored and is not authority | Both `business_identity.cr_number` and legacy `presentation.verification.crNumber` | Web preview uses canonical CR. Dev mirror renders the legacy field under "merchant provided". | Footer uses canonical CR only | n/a | n/a | n/a | Same identity tests. Draft writes stay on `commerce.manage` presentation routes. | Dev mirror can show a different CR from the Tenant. Public JSON still echoes the legacy field, which the contract allows as non-authoritative. | IMPLEMENTATION_READY | BIZ-1: mirror must not render or edit a second CR. Do not strip the legacy JSON field. |
| VAT number | No Customizer editor. | `Tenant.vat_number` | Not a presentation field | `business_identity.vat_number` | Shown when non-empty | Footer shows it | n/a | n/a | n/a | Same | Web panel does not show the read-only VAT value. | IMPLEMENTATION_READY | BIZ-1: read-only VAT next to CR. |
| Store display name | `branding.displayName` plus live `Storefront.name` | `Storefront.name`, with presentation display name as the customer-facing override already shipped | `branding.displayName` | `data.name` is the storefront name; presentation carries display name | `previewStoreName` | `publishedStoreName` | n/a | n/a | n/a | Storefront row is tenant-scoped in `StorefrontConfigController` | None that collapses it into legal name. Legal name is a separate footer line. | COMPLETE | None |
| Footer business identity | Presentation controls tagline, logo, copyright, contact. Identity values are not edited here. | Tenant for legal fields; storefront for the wordmark | Presentation document | Identity object plus presentation | Web preview groups legal name / CR / VAT under "Business information", separate from SBC | Same grouping in `Footer.tsx` | n/a | n/a | n/a | n/a | Contact, social, identity, and SBC share one lower band. License is in the web preview and absent from the published footer. | IMPLEMENTATION_READY | COMPOSE-1 regroups. BIZ-1 aligns the license line: published footer gains the existing merchant-provided license in its own group, not inside CR/VAT or SBC. |
| SBC | `authentication_number`, `seal_token`, `show_in_storefront` | Presentation only. Not a verification authority. | Normalized on the presentation document | `authentication_number` forced to `""`. `seal_token` forced to `""` unless show is true. | Inert status. No `seal.js`. Token is not placed on a loader. | `SbcSeal` loads `seal.js` only with a token. Text label remains the fallback. | Government loader cited above | Contract §7.1: do not copy the seal | Token is an opaque string, not a URL | Public runtime test checks token redaction per storefront | No P1 found in this pass. Post-merge confirmation is still required. | IMPLEMENTATION_READY | SBC-1: re-verify security and parity; fix only a proven defect. Do not rebuild #926. |
| WhatsApp | enabled, phone, message, placement `floating` / `footer` / `both` | Presentation | Same | Full whatsapp object on the published presentation | Web preview `preventDefault`s and does not navigate. Floating control uses Lucide `MessageCircle` plus `aria-label`. | `wa.me` link, `rel="noopener noreferrer"`. Invalid phone hides the control. | Brand center cited above | Official glyph not permitted for this horizon (see §4.3) | `buildWhatsAppUrl` requires E.164-like digits. Non-https cannot be produced. | Merchant route is the existing presentation API | Dev mirror footer link does not `preventDefault`. Product surface does. No `target="_blank"` on the published link. | IMPLEMENTATION_READY | WA-1: keep placements and the generic control; published links get `target="_blank"` with the existing `rel`; mirror gets the same non-navigation as web. Do not add the official logo. |
| Social | Up to 8 rows: network enum, https URL, enabled | Presentation. Networks are fixed: Instagram, X, TikTok, Snapchat, YouTube, LinkedIn, Facebook. | `social[]` | Enabled https links only are rendered; empty URL omitted | Web preview does not navigate | Text of the raw network key, `rel="noopener noreferrer"` | Brand pages cited above | Official icons not obtained. Do not draw substitutes. | https only. No new host allow-list. | Existing normalizer tests | Raw key `instagram` is a weak visible name. No accessible name beyond that text. Published links have no `target="_blank"`. | IMPLEMENTATION_READY | SOCIAL-1: localized visible names, accessible names, `target="_blank"`, preview/public parity. No new network. No icon pack. |
| App Store link | `apps.iosUrl`, `showFooterLinks` | Presentation | Normalizer clears non-matching hosts | Stored iosUrl after normalization | Web preview shows the words "App Store" for any https URL, before save | Footer uses `isSafeAppStoreUrl` | Apple badge endpoint cited above | Official badge may be used unmodified, only with a real allow-listed URL | Helper is wider than `apps.apple.com` | Normalizer tests reject `example.com` | Preview host check is weaker than publish. Badge is text, not the official badge. | IMPLEMENTATION_READY | APPS-1 |
| Google Play link | `apps.androidUrl`, `showFooterLinks` | Presentation | Host-gated on save | Same | Same preview weakness | Footer uses `isSafePlayStoreUrl` | Play badge PNG cited above | Official badge only with a real Play URL. Play badge height >= App Store badge height. | `play.google.com` or `play.app.goo.gl`, https only | Same | Text label instead of the official badge | IMPLEMENTATION_READY | APPS-1 |
| App Promo | `appName`, `showHomepageSection` toggles the `appPromo` section | Presentation. No claim without a URL. | Section visibility | Band renders stored URLs | Customizer can show the band from section visibility | `AppPromoBand` returns null when both URLs are empty. One or both URLs render as text buttons. It does not re-check the host helper. | Same badges | Same | Depends on the normalizer having already stripped bad hosts | n/a | Text buttons; no host re-check at render | IMPLEMENTATION_READY | APPS-1: same badge component as the footer, host re-check at render, none/one/both states |
| Public minimization | n/a | Server | n/a | Identity is three nullable strings. No tenant id in this payload. SBC auth number blanked. Seal token blanked when hidden. | Preview is authenticated merchant UI and may show the token the merchant typed. | Public footer does not print the authentication number or the raw token as text. The token is on `data-token` only when show is on, which the loader requires. | n/a | n/a | n/a | Covered by public runtime and identity tests | Legacy `verification.crNumber` remains in the public presentation JSON by the SBC contract. It must stay non-rendered. | COMPLETE | Do not add a new public resource. BIZ-1 must not start rendering that legacy field. |
| Tenant / `commerce.manage` | Appearance page uses the selected storefront and company profile | Server storefront context | Existing draft/publish services | Cross-tenant storefront row is filtered by `tenant_id` | Company identity is the signed-in company hook, not a client-supplied tenant id | Public config cannot be aimed at another tenant by presentation JSON | n/a | n/a | n/a | Existing feature tests | No new route in this horizon | COMPLETE | Later tasks add negative tests only when they touch the read or write path. |
| RTL / responsive | Locale `ar` / `en` on the customizer | Existing storefront direction | n/a | n/a | Preview sets `dir` from locale | Footer uses logical CSS (`end`, grid). Not yet re-shot for this horizon. | n/a | n/a | n/a | n/a | No new screenshots at 390–1440 for the trust footer | IMPLEMENTATION_READY | QA-1 after the slices land. Dev mirror screenshots are not product authority. |
| Branding storage | Data URL or https logo, 512 KiB, SVG rejected | Presentation JSON in PostgreSQL | Unchanged | Unchanged | Unchanged | Unchanged | n/a | n/a | Existing logo sanitizer | n/a | Durability cap remains. Owner chose to keep it. | DEFERRED | STATE-1 records the decision. No upload work. |
| Business documents | Not in the customizer | Document storage, locked | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Needs durable storage the owner did not authorize | DEFERRED | Leave deferred in the closure report. |
| Promotions / offers | Visible-but-gated | Resolved owner deferral until a Promotions Engine | Offers section cannot gain content | Unpublished | Gated | Not a trust surface | n/a | n/a | n/a | n/a | Out of this horizon | OUT_OF_SCOPE | Do not touch. |

## 6. Proven gaps the later tasks may fix

No gap below needs a new table, a new public API shape, a new brand, or a storage provider.

1. Web Customizer verification panel shows canonical CR only. Add read-only legal name and VAT from the same company object. Remove any editable CR from the dev mirror and stop the mirror preview from painting `verification.crNumber` as CR.
2. Published footer does not show `verification.licenseNumber`, while the Web Customizer preview does. Show that existing license in a merchant-provided group on the published footer, separate from Business Identity and from SBC.
3. SBC stays as shipped. SBC-1 is a verification pass.
4. WhatsApp and social: accessible names, `target="_blank"` plus existing `rel="noopener noreferrer"` on published external links, preview does not navigate. No official social/WhatsApp artwork.
5. App Store / Play: official badges from the live URLs in §3, host re-check at render, `apps.apple.com` only, none/one/both, footer and App Promo.
6. Composition after those slices: four distinct footer groups (identity, SBC, communication/social, applications) inside the existing `Footer` and the existing web preview canvas. Do not add a third footer.
7. QA-1 then records 390 / 430 / 768 / 1024 / 1280 / 1440 in Arabic RTL and English LTR on the merchant customizer and the published storefront. The `/dev` mirror is optional and non-authoritative.

## 7. Promotion

After this evidence merges:

| Task | Status | Reason |
|---|---|---|
| STORE-TRUST-STATE-1 | ready | Documentation reconciliation only |
| STORE-TRUST-BIZ-1 | ready | Gaps in §6.1 and §6.2 |
| STORE-TRUST-SBC-1 | ready | #926 is on main |
| STORE-TRUST-WA-1 | ready | §4.3 bounds the artwork |
| STORE-TRUST-SOCIAL-1 | ready | §4.4 bounds the artwork |
| STORE-TRUST-APPS-1 | ready | §4.5 and §4.6 |
| STORE-TRUST-COMPOSE-1 | pending | Waits until BIZ, SBC, WA, SOCIAL, and APPS are merged and post-merge reviewed |
| STORE-TRUST-QA-1 | pending | Waits until the implemented slices it must photograph exist |
| STORE-TRUST-CLOSE-1 | pending | Waits until ready work is closed |

## 8. Explicitly not started

No UI, runtime, migration, upload, badge binary, deploy, or production release was changed in this task.
