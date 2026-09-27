# STORE-IDENTITY-MARKS-1 — Implementation Report

STATUS: Ready for owner review. Merge not performed. Deploy not performed.
DATE: 2026-09-27
Horizon: `docs/plans/store/AWJ_STORE_BUSINESS_IDENTITY_MARKS_HORIZON_V1.md`

## Summary

Canonical Commercial Registration and VAT number now render in the published footer, the storefront preview mirror, and the merchant preview as labeled facts with decorative AWJ utility icons. Missing values hide the row and the icon. The Saudi Business Center loader, tokenless `sbcVerified` fallback, and legal-name wording are unchanged. No official CR or VAT seal was added.

## Base SHA

Implementation branch point: `ba64e1692180e0e29b46ad1db5b86e170dbba261`.

That was `origin/main` before this work. It is the merge of PR #1078. PR #1077 is merged (`26092b28649156a6111d7797a9513e96290797ae`).

Before close, `origin/main` moved to `995e34a97d026e659973fe20512c8101aec7f871` (PR #1079, server-rendered tenant browser identity). That commit does not touch the identity-mark files. GitHub reports the pull request `MERGEABLE` against that tip. No rebase was required.

## Branch

`feat/store-business-identity-marks`

## PR

[#1080](https://github.com/safwan5001-source/Nebrax/pull/1080)

## Head SHA

Product implementation: `6ffecea47970dd9a3e03b2a48540578267357c35`.

CI recorded below was green on `6ed906894f3550834fbbacd7b8fcaaff14f55f44` (that commit only added the first version of this report). This documentation commit does not change runtime code. The pull request head is this commit; its check rollup is the gate for owner review.

## External Evidence: Salla + authoritative Saudi sources

Observed 2026-09-27. This is evidence, not permission to copy artwork.

### Salla

- Official help, VAT display, last updated 6 Feb 2025: [إظهار الرقم الضريبي أسفل المتجر](https://help.salla.sa/article/612750651). The merchant types a VAT number and may upload a tax-certificate image. Both can be turned off, in which case nothing is shown. The help text says the number appears at the bottom of the store, and clicking the VAT icon opens the merchant-uploaded certificate. That certificate is merchant media, not a ZATCA-hosted badge.
- Official help, merchant obligations: [الالتزامات المفروضة على التاجر وممارس التجارة الإلكترونية](https://help.salla.sa/article/106256457). Required store data includes the commercial-register name and number if any, the tax number and tax certificate, and e-store authentication with an approved body including منصة الأعمال. That is disclosure plus the existing authentication body, not a Ministry or ZATCA logo.
- Theme source, `SallaApp/theme-raed` `master`, `src/views/components/footer/footer.twig` (raw file read on this date):
  - VAT block renders only when `store.settings.tax.number` is set.
  - Visible text is `common.elements.tax_number` plus the number in bold.
  - `images/tax.png` from the Salla CDN (`alt="value added tax"`, 40×50) renders only when `store.settings.tax.certificate` is also set, and opens `<salla-modal>` of that uploaded image.
  - The theme footer does not render a commercial-registration number or a Ministry seal.
  - Trust badges are delegated to `<salla-trust-badges>`. Payments are `<salla-payments>`, which this horizon does not copy.
  - RTL uses logical spacing (`rtl:space-x-reverse`). A missing tax number removes the whole block.

`images/tax.png` is a Salla theme asset. It is not served by `zatca.gov.sa` and is not proof of an official VAT mark.

### Authoritative Saudi sources

- ZATCA brand identity, [zatca.gov.sa Authority Identity](https://zatca.gov.sa/en/MediaCenter/AuthorityIdentity/Pages/default.aspx), page last update shown as 10 Aug 2026. The page publishes the Authority logo (light and dark) and "ZATCA Identity Guidelines" for the Authority itself. It does not publish a merchant storefront VAT badge or a license to place the Authority logo beside a VAT number.
- Saudi Business Center e-commerce authentication, [business.sa service](https://business.sa/en/eservices/details/4d6e9d30-e989-4940-08ce-08dbf015747a) and the already contracted loader `https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js`. This is the official storefront trust mechanism. Ministry of Commerce points shoppers to `https://eauthenticate.saudibusiness.gov.sa/inquiry`.
- Ministry of Commerce, commercial-register QR ("رمزك التجاري"), news [07-12-19](https://mc.gov.sa/ar/mediacenter/News/Pages/07-12-19-01.aspx). That QR is issued per establishment. AWJ's public identity payload has no such code. Drawing one would invent verification.
- Ministry of Commerce repeatedly prohibits commercial use of the state emblem. That prohibition is why an official-looking government seal must not be drawn for CR or VAT.
- No source consulted prescribes an official storefront glyph for displaying a CR number or a VAT number.

## CR/VAT/SBC Mark Classification

| Mark | Classification | Why |
|---|---|---|
| SBC seal when a seal token exists | `OFFICIAL_EXTERNAL_MARK` | Government loader and `data-token`, unchanged. |
| SBC without a seal token | `TEXT_ONLY` | Existing contracted `sbcVerified` sentence. Not a drawn seal. |
| Commercial registration | `AWJ_UTILITY_ICON` | No proven official storefront mark. Lucide `ScrollText` supplements the visible label and value. |
| VAT number | `AWJ_UTILITY_ICON` | ZATCA logo and Salla `tax.png` are not authorized for this use. Lucide `Receipt` supplements the visible label and value. |
| ZATCA logo, Ministry emblem, Maroof, Salla `tax.png`, per-CR QR | `NOT_AUTHORIZED` | Not proven as a mark AWJ may place beside these facts, and several are explicitly the wrong artifact. |
| Legal name | `TEXT_ONLY` | Wording and visibility unchanged. No icon. |

## AWJ Decision

Do not copy Salla's certificate modal or `tax.png`. AWJ has no tax-certificate asset in the public identity contract, and adding one would be a new media/schema capability.

Show CR and VAT only from `business_identity`, each as label plus value, with a decorative utility icon from the same Lucide treatment as contact rows (`size-4`, `strokeWidth={1.75}`, `aria-hidden="true"`). Icons never replace the text and are not links. A blank or whitespace value removes that row and its icon. Business information and SBC stay separate groups. Payment brands stay out.

The storefront footer and storefront preview share `IdentityDetail`. The web merchant preview keeps a twin, matching the existing `ContactDetail` split. No generic brand renderer was added.

## Changed Files

- `storefront/src/components/store/IdentityDetail.tsx`
- `storefront/src/components/store/IdentityDetail.test.tsx`
- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `storefront/src/components/customizer/__tests__/ExperienceBuilder.test.tsx`
- `storefront/src/app/dev/trust-visual/page.tsx`
- `storefront/e2e/store-brand-qa.spec.ts`
- `web/src/modules/store-experience-builder/IdentityDetail.tsx`
- `web/src/modules/store-experience-builder/__tests__/IdentityDetail.test.tsx`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx`
- `web/src/app/dev/trust-visual/page.tsx`
- `web/e2e/store-brand-qa.spec.ts`
- this report

## Tests + exact results

Storefront unit tests (`pnpm test`): **93 files, 635 tests, all passed.**

Focused storefront vitest before the full run: IdentityDetail, Footer, SbcSeal, customizer ExperienceBuilder, customizer SbcSeal — **34 passed.**

Storefront `pnpm check` (Biome): **431 files, no fixes.**

Storefront `tsc --noEmit`: **passed with no errors.**

Web focused vitest: ExperienceBuilder **14 passed**, IdentityDetail **2 passed**, ContactDetail **1 passed.**

Web merchant Store Brand QA (`npx playwright test e2e/store-brand-qa.spec.ts --project=desktop`): **33 passed** (3.0m). Includes full 390–1440 Arabic/English, existing state matrix, and cr-only / vat-only / sbc-plain at 390 and 1440 in both locales.

Storefront Store Brand QA (`pnpm exec playwright test e2e/store-brand-qa.spec.ts --config=playwright.brand-qa.config.ts --project=chromium`): first full run **57 passed, 12 failed**. The 12 failures were `mirror full` reusing the published `rel=noopener` assertion. The mirror does not use that published-link contract, and this horizon does not change it. After a mirror-specific assertion, `mirror full` **12 passed** (27.9s). The other 57 had already passed in the same spec. Combined local result: **69 passed.**

## CI status

All checks on head `6ed906894f3550834fbbacd7b8fcaaff14f55f44` passed. `mergeStateStatus` was `CLEAN` before this documentation commit. Duplicate Core CI jobs are the two pushes of that same head; both passed. No failing or cancelled check.

| Check | Result | Run |
|---|---|---|
| storefront (lint + typecheck + test) | pass 59s | [36318829598](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829598) |
| web build (Next.js), includes `npm test` | pass 3m15s | [36318829597](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829597) |
| merchant preview visual QA | pass 2m22s | [36318829632](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829632) |
| published footer visual QA | pass 2m36s | [36318829632](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829632) |
| php artisan test (L11, sqlite) | pass 7m8s and 7m4s | [36318829683](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829683), [36318826738](https://github.com/safwan5001-source/Nebrax/actions/runs/36318826738) |
| php artisan test (L11, pgsql) | pass 20m8s and 19m42s | [36318829683](https://github.com/safwan5001-source/Nebrax/actions/runs/36318829683), [36318826738](https://github.com/safwan5001-source/Nebrax/actions/runs/36318826738) |

Mobile CI and runtime-smoke do not apply to these paths. This documentation commit re-requests the same workflows because the pull request still touches `storefront/**` and `web/**`. It does not change product behavior.

## Tenant/Security confirmation

No tenant isolation, RBAC, hostname resolution, or draft/public separation change. Identity values still come only from the resolved tenant `business_identity`. Legacy `verification.crNumber` is not rendered. The seal token is still not printed as text and is still not placed in the preview DOM. Preview still does not load `seal.js`. No cross-tenant fallback and no fabricated numbers.

## Accounting/Tax/ZATCA confirmation

No accounting, VAT calculation, ZATCA, invoice, checkout, or payment change. The VAT row is a display of the existing canonical number. It is not a tax determination and not a ZATCA mark.

## Preview ↔ Published verification

The same `IdentityDetail` semantics are used by:

- published `Footer.tsx`
- storefront `StorefrontPreviewCanvas.tsx` (dev mirror)
- web `StorefrontPreviewCanvas.tsx` (merchant preview)

Browser QA covered Arabic RTL and English LTR at 390, 430, 768, 1024, 1280, and 1440 for the full published fixture, the actual `/sa/{locale}` route, and the mirror. Merchant preview covered the same widths for the full scenario. cr-only, vat-only, and tokenless SBC were checked at 390 and 1440 in both locales on published, mirror, and merchant preview. Long legal names did not overflow. Absent CR/VAT rows and icons do not render. SBC with a token still mounts the official loader only on the published footer; previews stay on the inert editor state. Tokenless SBC remains the contracted `sbcVerified` sentence.

## Review findings and disposition

| Finding | Severity | Disposition |
|---|---|---|
| Mirror full QA reused the published `rel=noopener` check and failed | P2, in scope | Fixed before the pull request. Mirror now asserts identity, overflow, columns, RTL, and inert SBC without changing social-link behavior. |
| `<bdi>` split the label/value text and broke existing exact text queries, including a second match for the canonical number | P2, in scope | Removed. Label and value stay one text node, as before. |
| Salla certificate modal and `tax.png` | Out of scope | Not implemented. Classified `NOT_AUTHORIZED` for AWJ. |
| No other P1/P2 left open in this diff. | | |

## Risks / Remaining

- The utility icons are generic. They must not later be restyled into seals, shields, or checkmarks that imply government verification.
- Salla's uploaded tax certificate is a real merchant pattern and is intentionally not copied. A future horizon would need its own evidence and a storage decision.
- Store Brand QA screenshots are local test output and are not committed.
- `origin/main` gained PR #1079 after the branch point. There is no file overlap and GitHub could merge cleanly. Rebase was not performed.

## Merge: NOT PERFORMED

## Deploy: NOT PERFORMED

## Next Step

Owner review of the focused pull request. Do not merge or deploy without Safwan's explicit approval. Do not start another Store, Payment, or Trust horizon from this change.
