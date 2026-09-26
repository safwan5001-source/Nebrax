# STORE-TRUST-CLOSE-1 — Horizon closure

STATUS: Closing. This document is the closure record for AWJ Store Trust, Business Identity & External Brands V1.
DATE: 2026-09-26
HORIZON BASE: `e69a8e115f4dc2ef420a24b429be5b79fefd1e8d`
DEFINITION PR: [#1047](https://github.com/safwan5001-source/Nebrax/pull/1047)

No deploy. No production release. No production migration. No new horizon is started by this close.

## Verdict

Every ready task in the queue is merged and post-merge reviewed. There is no unresolved P1 or P2 inside this horizon. Official marks that shipped have a recorded source and a recorded AWJ decision. Preview and published trust groups carry the same semantics. Responsive, accessibility, and security QA is recorded. Business Documents stay deferred because durable storage is not authorized. Promotions stay out of scope.

## Completed tasks

| Task | PR | Merge SHA | POST_MERGE_REVIEW |
|---|---|---|---|
| STORE-TRUST-0 | [#1048](https://github.com/safwan5001-source/Nebrax/pull/1048) | `fa237e392bd4a5bfd1ffc19e3800aaa81e6e53bc` | PASS. PHP run [36239684948](https://github.com/safwan5001-source/Nebrax/actions/runs/36239684948) |
| STORE-TRUST-STATE-1 | [#1049](https://github.com/safwan5001-source/Nebrax/pull/1049) | `f7db2b5bf1cd86e6dfc79c962e862bc7136e78b7` | PASS. PHP run [36240798438](https://github.com/safwan5001-source/Nebrax/actions/runs/36240798438) |
| STORE-TRUST-BIZ-1 | [#1050](https://github.com/safwan5001-source/Nebrax/pull/1050) | `a4d6cfe0e7d76310aa2ab6de51ddd08027fcec7a` | PASS. PHP [36241059823](https://github.com/safwan5001-source/Nebrax/actions/runs/36241059823), storefront [36241059889](https://github.com/safwan5001-source/Nebrax/actions/runs/36241059889), web [36241059859](https://github.com/safwan5001-source/Nebrax/actions/runs/36241059859) |
| STORE-TRUST-SBC-1 | [#1051](https://github.com/safwan5001-source/Nebrax/pull/1051) | `13b2582fbc513ad3c5b22d5abdfced2290ceb578` | PASS. PHP run [36241964595](https://github.com/safwan5001-source/Nebrax/actions/runs/36241964595). Did not rebuild [#926](https://github.com/safwan5001-source/Nebrax/pull/926) (`7c1dd55c7e7cd2e8e9d80f3cf52f65b260947d48`) |
| STORE-TRUST-WA-1 | [#1052](https://github.com/safwan5001-source/Nebrax/pull/1052) | `c6d1372c30be7096df2a523171ad36fdecbc2b5c` | PASS. PHP [36242071649](https://github.com/safwan5001-source/Nebrax/actions/runs/36242071649), storefront [36242071671](https://github.com/safwan5001-source/Nebrax/actions/runs/36242071671) |
| STORE-TRUST-SOCIAL-1 | [#1053](https://github.com/safwan5001-source/Nebrax/pull/1053) | `5c4c6500d1d9b9a17f043b4d914ff76bec4e8109` | PASS. PHP [36243279120](https://github.com/safwan5001-source/Nebrax/actions/runs/36243279120), storefront [36243279118](https://github.com/safwan5001-source/Nebrax/actions/runs/36243279118), web [36243279114](https://github.com/safwan5001-source/Nebrax/actions/runs/36243279114) |
| STORE-TRUST-APPS-1 | [#1054](https://github.com/safwan5001-source/Nebrax/pull/1054) | `abe269a3d6fafcac60fb34ddf058b5302f2d4ab3` | PASS. PHP [36244420209](https://github.com/safwan5001-source/Nebrax/actions/runs/36244420209), storefront [36244420219](https://github.com/safwan5001-source/Nebrax/actions/runs/36244420219), web [36244420223](https://github.com/safwan5001-source/Nebrax/actions/runs/36244420223) |
| STORE-TRUST-COMPOSE-1 | [#1055](https://github.com/safwan5001-source/Nebrax/pull/1055) | `cb16f671e58f75598655f7e6b47884c794abd6fd` | PASS. PHP [36245636636](https://github.com/safwan5001-source/Nebrax/actions/runs/36245636636), storefront [36245636641](https://github.com/safwan5001-source/Nebrax/actions/runs/36245636641), web [36245636632](https://github.com/safwan5001-source/Nebrax/actions/runs/36245636632) |
| STORE-TRUST-QA-1 | [#1056](https://github.com/safwan5001-source/Nebrax/pull/1056) | `37b7f88b9bb08b19e4f1d0aca5b7ab4e4fe3496f` | PASS. PHP [36251570726](https://github.com/safwan5001-source/Nebrax/actions/runs/36251570726), storefront [36251570822](https://github.com/safwan5001-source/Nebrax/actions/runs/36251570822), web [36251570723](https://github.com/safwan5001-source/Nebrax/actions/runs/36251570723). Reviewed head `e562978c5783c6fd3359dce7a39460046e16a964` |

PRE_MERGE_REVIEW: PASS is on each of those PRs, naming the reviewed head.

## What shipped

Public legal name, commercial registration, and VAT come from the resolved tenant. `verification.crNumber` is not a public identity. The merchant license is a separate group. The store display name stays distinct.

One footer. Trust groups stay separate: identity, merchant license, Saudi Business Center, communication, applications. The published seal loads `https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js` only when a token is present. Preview does not execute that script. SBC on without a token is a text label, not a verification result.

WhatsApp keeps the existing placements. Published links use `target="_blank"` and `rel="noopener noreferrer"`. Preview does not navigate. There is no official WhatsApp glyph. The floating control is a generic icon plus an accessible name.

Social networks are only Instagram, X, TikTok, Snapchat, YouTube, LinkedIn, and Facebook. Names are visible text. No icon files were added. Only `https` URLs render. Preview does not navigate.

App Store and Google Play badges are `<img>` elements pointed at the live publisher URLs, height class `h-10`, only beside an allow-listed URL (`apps.apple.com` exactly; `play.google.com` or `play.app.goo.gl`). No badge binary is in the repo. Footer and App Promo share that rule. None, one, or both links are valid states.

## Preview ↔ Published parity

Merchant preview and the published footer show the same groups and the same fail-closed URL rules. Differences that remain, and are not defects:

- Preview trust headings are `h3`. Published trust headings are `h2`. Both are named headings.
- Preview links do not open a new tab. Published external links do.
- Preview SBC is inert. Published SBC may load the government script only with a token.
- The storefront `/dev` mirror is not the merchant editor and is not product authority.

## QA

Evidence: `docs/plans/store/STORE-TRUST-QA-1-IMPLEMENTATION-REPORT.md` and `docs/plans/store/store-trust-qa/`.

Widths 390, 430, 768, 1024, 1280, and 1440. Arabic RTL and English LTR. Merchant preview and published components. Production route `/us/ar` empty footer at all six widths. `/us/en` empty footer at 390. Configured states are not on the live route in the sandbox because there is no seeded tenant presentation API; the fixture mounts the same Footer and the same public helpers.

One P2 was found and fixed before merge: an unbroken tagline, copyright, or compact-header name widened the page. After the fix, measured overflow is at most 1px (scrollbar rounding). No remaining P1 or P2.

Security regression recorded in that report: decoy CR absent, unsafe social and store URLs hidden, published `rel="noopener noreferrer"`, preview does not load `seal.js`.

## Official asset provenance

External evidence and the AWJ decisions are in `docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_EVIDENCE.md` §3 and §4.

| Mark | What shipped | Decision |
|---|---|---|
| WhatsApp | Generic control and accessible name. No official glyph. | Official artwork was not retrieved, and AWJ does not know that the merchant uses the WhatsApp Business app or API. |
| Social networks | Localized visible names. No icon files. | Official icon downloads require accepting the publisher guidelines. No official file was copied. No substitute icon pack. |
| App Store / Google Play | Live first-party badge URLs, unmodified, only with an allow-listed store URL. | Badge guidelines permit that use. No binary, no redraw, no translation of the artwork. |
| Saudi Business Center | Existing seal script and text fallback from #926. | SBC-1 verified it. This horizon did not add a new government integration. |

## Deferred and out of scope

- Business Documents Viewer stays deferred. It needs durable media storage. Not missing horizon work.
- Owner storage decision remains `KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`. PR [#1044](https://github.com/safwan5001-source/Nebrax/pull/1044) stays open and was not merged. No `DOCUMENT_DURABLE_STORAGE_ENABLED`. No local-disk workaround.
- Promotions and offers stay gated until a future authoritative Promotions Engine. Not this horizon.
- No new storage provider, schema migration, public API, legal-identity authority, or finance/tax/payment change.

## Known limitations

- English production-route screenshots exist at 390 only. The other English widths are the published fixture.
- This sandbox cannot photograph a configured production route without a tenant presentation API.
- Preview and published heading levels differ (`h3` / `h2`). Not a P1 or P2.

## Accounting, tenancy, security

No accounting impact. Public identity is still the resolved tenant. Authoring stays behind the existing `commerce.manage` presentation API. No new route or migration.

## Self-review

### Implementer

This task is documentation. It does not change runtime, storage, or brands.

### Reviewer

The table matches the merged SHAs and the POST_MERGE comments on those PRs. QA-1's post-merge runs are filled before this PR is reviewed. #1044 is still open.

### AWJ Guardian

Closing does not authorize storage, a documents viewer, promotions, a deploy, or a new horizon.

## Next

Stop. Do not start a storage horizon, a Promotions Engine, or another theme horizon from this close.
