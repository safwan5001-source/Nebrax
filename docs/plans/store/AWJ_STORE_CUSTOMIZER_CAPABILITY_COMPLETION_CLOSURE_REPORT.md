# AWJ Store Customizer Capability Completion — Closure

**Status:** Closed for implementation-ready work. No deploy.  
**Date:** 2026-09-26

## Identity

| | |
|---|---|
| Horizon base used by the executor | `a48c132e820b1c39da032f0f46ec29de4d136f7d` (#1027). The horizon document's older verified base was `1a0cac9863e48eb4eb2e4870e1f0aa70878382af`. |
| Reviewed head | `dbe88f4775f6bde49f85907e589d9aa8c1316afb` |
| Implementation merge SHA | `ebd799c0dd449935be97c7cfbf7d2db3baca8c9b` |
| Squash parent | `222fb9bfc77af79ea14b66b54ab680b2eaecabc1` (#1028 had landed on main first) |

## Pull request

| PR | Branch | Reviewed head | Merge SHA | What |
|---|---|---|---|---|
| [#1029](https://github.com/safwan5001-source/Nebrax/pull/1029) | `horizon/store-customizer-capabilities` | `dbe88f4775f6bde49f85907e589d9aa8c1316afb` | `ebd799c0dd449935be97c7cfbf7d2db3baca8c9b` | Banner, benefits, custom content, featured ids, app promo, chrome nesting, offers left gated |

Single-parent squash. Customizer path diff against the reviewed head was empty. `PRE_MERGE_REVIEW: PASS` and `POST_MERGE_REVIEW: PASS` are on the PR. This closure document is a follow-up on main after that merge.

## Completed capabilities

| Capability | Classification | What shipped |
|---|---|---|
| Banner | complete | Title, subtitle, CTA label, https or same-site href, https image. Edit, draft, preview, publish, public band. |
| Benefits | complete | Up to 6 plain-text items. Blank rows stay in the editor and are omitted on the public page. |
| Custom content | complete | Up to 8 heading or paragraph blocks. No HTML execution. Heading ids are prefixed with the section id. |
| Featured | complete | Up to 8 product ids. No price, stock, tax, or discount fields. Public page calls tenant-scoped `fetchProduct` and drops misses. |
| App promo | complete | Uses existing `apps` ios/android URLs and name. Hidden when both URLs are empty. No QR. |
| Chrome click-to-edit | complete | Header and footer are not buttons. Logo is a button and is not also a link. |
| Offers | PRODUCT_DECISION_REQUIRED | Still gated. Content stripped. Public homepage skips the section. Packet: `AWJ_STORE_CUSTOMIZER_OFFERS_DECISION_PACKET.md`. |

Presentation version stays 2. Empty content is omitted so older `{id,type,visible}` documents stay stable. `presentation: null` still renders the default implemented stack (hero, categories, new arrivals, wholesale).

## Tests and CI

Local this session (storefront only; PHP is not installed here):

| Command | Result |
|---|---|
| `pnpm exec biome check .` | pass |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm check:locales` | ar/de/es/fr/pl match en |
| `vitest` presentation tests | 5 files, 28 passed |

Web unit tests were run on the implementation commit before the biome and heading-id follow-ups (those commits did not change `web/`). This session did not re-run them. Web `tsc --noEmit` still reports pre-existing errors in unrelated tests; the experience-builder files were not in that list. Web CI is `npm run build`, not the unit suite.

CI on reviewed head `dbe88f4` (pull_request, and push where the path filter matched):

- php artisan test sqlite pass
- php artisan test pgsql pass
- storefront lint + typecheck + test pass
- web build pass

Post-merge CI on `ebd799c`:

- php sqlite + pgsql pass — [36197971569](https://github.com/safwan5001-source/Nebrax/actions/runs/36197971569)
- storefront pass — [36197972243](https://github.com/safwan5001-source/Nebrax/actions/runs/36197972243)
- web build pass — [36197971673](https://github.com/safwan5001-source/Nebrax/actions/runs/36197971673)

## Visual QA

Not browser-captured. No merchant session and no populated published store were available in the implementation sandbox. Widths 390, 430, 768, 1024, 1280, 1440 were not screenshotted.

Static check of the new public bands: no physical `left`/`right` utilities. Layout is stacked or grid (`sm`/`md`/`lg`) and inherits document direction. That is not a visual pass.

The storefront `/dev` customizer harness was not updated. The merchant surface is the web experience builder, and that preview canvas renders the completed sections. Offers stay a dashed gate there.

## Security, tenant, compatibility, performance

- Tenant isolation and `commerce.manage` were not widened. Saves still go through the existing presentation draft/publish API and the server normalizer.
- Draft is not public. The storefront reads `readPublishedPresentation` only.
- Prices, discounts, tax, stock, and availability stay server-owned. Featured stores ids only.
- Text is React text, not HTML. Banner images are https. CTA hrefs are https or a same-site path (not `//`). Offers content is stripped.
- No migration. No new object storage. Version stays 2.
- A published featured band can issue up to 8 product requests per section. Misses are dropped. No new query layer.

## Remaining

| Classification | Items |
|---|---|
| PRODUCT_DECISION_REQUIRED | Offers, until an authoritative promotions engine exists. Recommended option in the packet: leave the section gated. Branding file storage was already deferred and was not reopened. |
| DEFERRED | Undo/redo, version history, Market, Floral. |
| Not verified | Browser visual QA at the named widths, RTL and LTR, on the merchant canvas and the published homepage. |
| Harness drift | Storefront dev customizer canvas still shows dashed placeholders for types the web builder now renders. |

## Decision gate

Offers only. Independent work did not stop for it. Do not invent discounts.

## Not done

- Production deploy, release, or production migration.
- A promotions engine.
- Another horizon.
