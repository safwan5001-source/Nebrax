# STORE-TRUST-QA-1 — Verification

STATUS: Implemented. Awaiting exact-head CI and PRE_MERGE_REVIEW.
DATE: 2026-09-26
BASE: `cb16f671e58f75598655f7e6b47884c794abd6fd` (STORE-TRUST-COMPOSE-1 merge)

## Outcome

Responsive, direction, accessibility, and security checks of the shipped trust footer were run in Chromium. One P2 was found and fixed: an unbroken tagline, copyright, or compact-header store name widened the page. After the fix, measured `scrollWidth` matches the viewport (at most 1px, scrollbar rounding).

No remaining P1 or P2.

## Evidence surfaces

These are not the same thing:

| Surface | What was rendered | Authority |
|---|---|---|
| Published component | `/dev/trust-visual?surface=published` mounts `Footer`, `AppPromoBand`, and `StoreWhatsApp`. Links are built with `publishedSocialLinks`, `publishedWhatsAppHref`, and the same App Store / Play allow-list the storefront layout uses. | Same components as the published layout. Not the country/locale route. 404 when `NODE_ENV=production`. |
| Merchant preview | `web` `/dev/trust-visual` mounts `StorefrontPreviewCanvas` with click-to-edit handlers, the canvas `/commerce/appearance` mounts. | Not the authenticated production route. 404 in production. |
| Dev mirror | `/dev/trust-visual?surface=mirror` mounts the storefront customizer canvas without click-to-edit. Sampled at 390 and 1440, full scenario, both locales. | Not product authority. |
| Production route | `GET /us/ar` and `GET /us/en` on the storefront dev server. `/sa/ar` meta-refreshes to `/us/ar`. | Real layout and real `Footer`. This sandbox has no tenant presentation API, so the route is the empty state only. |

Shots: `docs/plans/store/store-trust-qa/`.

## Matrix

Widths 390, 430, 768, 1024, 1280, 1440. Locales Arabic RTL and English LTR.

| Scenario | Widths | Published component | Merchant preview |
|---|---|---|---|
| full | all six | pass | pass |
| empty, partial, unsafe, missing-identity, sbc-plain, apps-one | 390 and 1440 | pass | pass |
| long | 390, 768, 1440 | pass after the fix | pass after the fix |

Production route, empty trust footer, no horizontal overflow:

- Arabic RTL: 390, 430, 768, 1024, 1280, 1440. `lang=ar`, `dir=rtl`.
- English LTR: 390. `lang=en`, `dir=ltr`. The same empty `Footer` is the component shot at the other English widths on the fixture. Further English route shots were not taken because the local dev server exited.

States covered: empty, partial, fully configured, invalid URLs, long unbroken text, missing canonical identity, SBC off (empty), SBC on without a token, SBC on with a token, no app links, one app link, both app links.

## P2

Unbroken text overflowed the viewport.

- Footer tagline used `max-w-lg` without `overflow-wrap`, so a token inside the 200-character limit painted past the box. At 390 the published document was 1491px wide.
- The copyright line had the same failure for a long store name.
- The compact header column was `1fr auto 1fr`. The `auto` column sized to the unbroken name, so the merchant preview at 390 was 1460px wide.

Fix, kept to those nodes:

- `break-words` on the tagline and copyright in `Footer` and both preview canvases.
- Compact header grid is `1fr minmax(0,1fr) 1fr` on the published header and both previews. The web brand button is `min-w-0 max-w-full` so the existing truncate can shrink.

Remeasured long text after CSS load: published 390 and 1440 delta 0, preview 390 and 768 delta 0, preview 1440 delta 1, mirror 390 delta 0. Recaptured long shots match.

## Accessibility

- Trust groups are named headings. Identity, license, SBC, contact, and applications stay separate.
- Social controls have visible names, not icon-only marks.
- Store badges use the publisher `alt`.
- The floating WhatsApp control, when the published placement includes it, has an accessible name. The empty production route does not render it.
- Preview links do not open a new tab. A click on the English preview WhatsApp control stayed on the fixture URL.

## Security regression

- A decoy `verification.crNumber` (`DECOY-CR-NOT-CANONICAL`) is stored on the presentation and was absent from every passing shot. Legal CR/VAT come from the tenant identity prop.
- `javascript:` and `http://` social URLs, a non-`apps.apple.com` iOS URL, and a non-phone WhatsApp value do not render. A valid Instagram URL and a valid Play URL in the same scenario still render.
- Published external links use `target="_blank"` and `rel="noopener noreferrer"`.
- Preview does not load `seal.js`. The published seal container is present when a token is set. Script injection itself is covered by `Footer.test.tsx`, because the loader is a client effect.
- SBC on with a blank token is the text label only. SBC off hides the group even if a token is present in the input (covered by the existing footer test and the empty shots).
- Local tests: storefront Footer, URL allow-list, ExperienceBuilder, and commerce storefront parser, 31 passed, plus the new wrap test, 10 footer tests passed. Web ExperienceBuilder and presentation tests, 24 passed.
- PHP is not installed in this sandbox. The QA change does not alter PHP. CI on this PR runs the PHP suite.

## Self-review

### Implementer

The wrap fix is the smallest class change that removes the measured overflow. The fixture 404s in production. No storage, schema, payment, or new brand.

### Reviewer

Preview and published still disagree on heading level (`h3` vs `h2`) for the trust groups. Both expose a heading and a name. Not a P1 or P2. The dev mirror was sampled, not treated as the merchant editor.

### AWJ Guardian

No new government integration. The seal script URL is unchanged. No token is required to paint the text fallback. No finance or tax copy was added.

## Accounting impact

None.

## Tenant / branch isolation impact

None. The public identity path is still the resolved tenant. The decoy CR is not rendered.

## Security / authorization impact

The allow-list and `commerce.manage` authoring boundary are unchanged. The fix is presentational.

## Backward compatibility

No API or document change. Existing short taglines wrap the same way.

## API / DB / migration impact

None.

## Risks

English production-route shots exist at 390 only. Configured production-route shots do not exist here because there is no seeded tenant. The fixture uses the published components and helpers.

`measurements.json` originally kept the failed-attempt log for two Arabic long preview cells and for the production-route cells, even after those JPEGs were recaptured. Those superseded connection and timeout strings were removed. Cells with no JPEG (English production route above 390) stay marked not captured. Pixel measures that were never rewritten into the JSON remain in this report.

## Git state

- Branch: `feat/store-trust-qa-1`
- Base: `cb16f671e58f75598655f7e6b47884c794abd6fd`

## Recommended next task

STORE-TRUST-CLOSE-1 after this merges and post-merge review passes. Do not start another horizon. Do not deploy.
